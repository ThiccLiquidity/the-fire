// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IPlankBurnFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface IPlankBurnTwap {
    function prev() external view returns (uint256 cum, uint32 ts);
    function last() external view returns (uint256 cum, uint32 ts);
}

interface IPlankBurnRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts);
}

/**
 * @title PlankBurner
 * @notice Holds the PLANK burn share of a pack sale when FireSale can't swap it right away (a stale PLANK price or a
 *         failed swap), and burns it later. Whatever it holds (ETH or USDG) it can only spend buying PLANK, straight to
 *         the dead address; PLANK sent here goes to the dead address as is. Anyone can call `flush`. There is no owner
 *         and no withdraw: the router, tokens and price feeds are fixed at deploy.
 *
 *         Routes: ETH -> PLANK (WETH/PLANK pool), USDG -> WETH -> PLANK.
 *
 *         Guard: the buy must get at least SWAP_MIN_BPS (95%) of what the PLANK price feed (PlankUsdTwap, a 30-minute
 *         average) says it is worth. If the whole amount wouldn't, it tries half, then a quarter, ... (MAX_HALVINGS
 *         times), so a backlog drains in pieces the pool can take. If no piece passes, or a price is missing or stale,
 *         nothing is spent and the next flush tries again.
 */
contract PlankBurner is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Pay { PLANK, ETH, USDG }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant SWAP_MIN_BPS = 9_500;
    uint256 public constant MAX_HALVINGS = 6; // smallest piece tried: 1/64 of what's held
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant PLANK_WINDOW_MAX = 2 hours;

    IERC20 public immutable PLANK;
    IERC20 public immutable USDG; // address(0) = no USDG
    uint256 public immutable USDG_UNIT;
    address public immutable WETH;
    IPlankBurnRouter public immutable ROUTER;
    IPlankBurnFeed public immutable ETH_USD; // 8 decimals (Chainlink)
    IPlankBurnFeed public immutable PLANK_USD; // 18 decimals (PlankUsdTwap)

    event Burned(Pay indexed pay, uint256 spent, uint256 plankOut);
    event Waiting(Pay indexed pay, uint256 amount);

    error ZeroAddress();
    error BadPay();

    constructor(address plank, address usdg, uint8 usdgDecimals, address weth, address router, address ethUsd, address plankUsd) {
        if (plank == address(0) || weth == address(0) || router == address(0) || ethUsd == address(0) || plankUsd == address(0)) {
            revert ZeroAddress();
        }
        PLANK = IERC20(plank);
        USDG = IERC20(usdg);
        USDG_UNIT = 10 ** usdgDecimals;
        WETH = weth;
        ROUTER = IPlankBurnRouter(router);
        ETH_USD = IPlankBurnFeed(ethUsd);
        PLANK_USD = IPlankBurnFeed(plankUsd);
    }

    receive() external payable {}

    /// @notice Spend everything held in `pay` on PLANK and burn it, if the guard allows (trying smaller pieces of a
    ///         backlog). PLANK held goes straight to the dead address. Returns the PLANK burned. Anyone can call it.
    function flush(Pay pay) external nonReentrant returns (uint256 out) {
        if (pay == Pay.PLANK) {
            out = PLANK.balanceOf(address(this));
            if (out > 0) {
                PLANK.safeTransfer(DEAD, out);
                emit Burned(pay, out, out);
            }
            return out;
        }
        if (pay == Pay.USDG && address(USDG) == address(0)) revert BadPay();
        uint256 held = pay == Pay.ETH ? address(this).balance : USDG.balanceOf(address(this));
        if (held == 0) return 0;
        address[] memory path = _path(pay);
        uint256 amount = held;
        uint256 minOut;
        for (uint256 k; ; k++) {
            minOut = _minPlank(pay, amount);
            if (minOut != 0 && _quote(path, amount) >= minOut) break;
            if (minOut == 0 || k == MAX_HALVINGS || amount < 2) {
                emit Waiting(pay, held);
                return 0;
            }
            amount /= 2;
        }
        uint256 before = PLANK.balanceOf(DEAD);
        bool ok;
        if (pay == Pay.ETH) {
            try ROUTER.swapExactETHForTokens{value: amount}(minOut, path, DEAD, block.timestamp) {
                ok = true;
            } catch {}
        } else {
            USDG.forceApprove(address(ROUTER), amount);
            try ROUTER.swapExactTokensForTokens(amount, minOut, path, DEAD, block.timestamp) {
                ok = true;
            } catch {}
            USDG.forceApprove(address(ROUTER), 0);
        }
        if (!ok) {
            emit Waiting(pay, held);
            return 0;
        }
        out = PLANK.balanceOf(DEAD) - before;
        if (amount < held) emit Waiting(pay, held - amount);
        emit Burned(pay, amount, out);
    }

    /// @notice Least PLANK a buy of `amount` must get right now (0 = a price is missing: it would wait).
    function minPlank(Pay pay, uint256 amount) external view returns (uint256) {
        if (pay == Pay.PLANK || (pay == Pay.USDG && address(USDG) == address(0))) return 0;
        return _minPlank(pay, amount);
    }

    function _path(Pay pay) internal view returns (address[] memory path) {
        if (pay == Pay.ETH) {
            path = new address[](2);
            (path[0], path[1]) = (WETH, address(PLANK));
        } else {
            path = new address[](3);
            (path[0], path[1], path[2]) = (address(USDG), WETH, address(PLANK));
        }
    }

    function _quote(address[] memory path, uint256 amountIn) internal view returns (uint256) {
        try ROUTER.getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            return amounts[amounts.length - 1];
        } catch {
            return 0;
        }
    }

    /// @dev SWAP_MIN_BPS of what `amount` is worth in PLANK at the PLANK feed's price; 0 = a price is missing.
    function _minPlank(Pay pay, uint256 amount) internal view returns (uint256) {
        uint256 plank = _plankUsd();
        if (plank == 0) return 0;
        uint256 usd18;
        if (pay == Pay.USDG) {
            usd18 = amount * 1e18 / USDG_UNIT;
        } else {
            uint256 eth = _feed(ETH_USD, ETH_FEED_MAX_AGE);
            if (eth == 0) return 0;
            usd18 = amount * eth * 1e10 / 1e18;
        }
        return usd18 * 1e18 / plank * SWAP_MIN_BPS / BPS;
    }

    /// @dev USD per PLANK, 18 decimals; 0 if missing, stale, or averaged over too long a window.
    function _plankUsd() internal view returns (uint256 p) {
        p = _feed(PLANK_USD, PLANK_FEED_MAX_AGE);
        if (p == 0) return 0;
        (bool ok1, bytes memory r1) = address(PLANK_USD).staticcall(abi.encodeCall(IPlankBurnTwap.prev, ()));
        (bool ok2, bytes memory r2) = address(PLANK_USD).staticcall(abi.encodeCall(IPlankBurnTwap.last, ()));
        if (ok1 && ok2 && r1.length >= 64 && r2.length >= 64) {
            (, uint32 t0) = abi.decode(r1, (uint256, uint32));
            (, uint32 t1) = abi.decode(r2, (uint256, uint32));
            if (t1 < t0 || t1 - t0 > PLANK_WINDOW_MAX) return 0;
        }
    }

    /// @dev A feed's answer if fresh, else 0 (never reverts).
    function _feed(IPlankBurnFeed f, uint256 maxAge) internal view returns (uint256) {
        (bool ok, bytes memory ret) = address(f).staticcall(abi.encodeCall(IPlankBurnFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return 0;
        (, int256 px,, uint256 at,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (px <= 0 || at > block.timestamp || block.timestamp - at > maxAge) return 0;
        return uint256(px);
    }
}
