// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Stand-ins for a local rehearsal on plain anvil (ops/rehearsal), where Robinhood Chain's tokens, pools, Chainlink
// and drand aren't there. NEVER deployed to a real chain: DevStack.s.sol refuses chain 4663.

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";

/// Mintable ERC-20 with chosen decimals (PAPER, PLANK, USDG, WETH stand-ins).
contract DevToken is ERC20 {
    uint8 private immutable DEC;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        DEC = d;
    }

    function decimals() public view override returns (uint8) {
        return DEC;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Chainlink-style ETH/USD feed (8 decimals). set() is what a Chainlink update would do.
contract DevFeed {
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 a) {
        set(a);
    }

    function set(int256 a) public {
        answer = a;
        updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// Uniswap V2 pair stand-in: fixed reserves, real cumulative-price bookkeeping (what the TWAP feeds read).
contract DevPair {
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    /// Set the reserves of `tokenA`/`tokenB` (any order), accruing the cumulative prices up to now first.
    function setReserves(address tokenA, uint112 a, uint112 b) external {
        (uint112 r0, uint112 r1) = tokenA == token0 ? (a, b) : (b, a);
        _update();
        reserve0 = r0;
        reserve1 = r1;
    }

    function _update() internal {
        uint32 ts = uint32(block.timestamp);
        unchecked {
            uint32 dt = ts - blockTimestampLast;
            if (dt > 0 && reserve0 != 0 && reserve1 != 0) {
                price0CumulativeLast += ((uint256(reserve1) << 112) / reserve0) * dt;
                price1CumulativeLast += ((uint256(reserve0) << 112) / reserve1) * dt;
            }
        }
        blockTimestampLast = ts;
    }
}

contract DevFactory {
    mapping(address => mapping(address => address)) public getPair;

    function createPair(address a, address b) external returns (address p) {
        require(getPair[a][b] == address(0), "exists");
        p = address(new DevPair(a, b));
        getPair[a][b] = p;
        getPair[b][a] = p;
    }
}

/// Uniswap V2 router stand-in: quotes from the pairs' reserves (0.3% fee); a swap mints the output token at that quote
/// (the reserves don't move). `setFail` makes every swap revert (to show a burn share waiting in PlankBurner).
contract DevRouter {
    address public immutable WETH;
    address public immutable factory;
    bool public fail;

    constructor(address weth, address f) {
        WETH = weth;
        factory = f;
    }

    function setFail(bool f) external {
        fail = f;
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        require(path.length >= 2, "path");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i + 1 < path.length; i++) {
            address p = DevFactory(factory).getPair(path[i], path[i + 1]);
            require(p != address(0), "no pair");
            (uint112 r0, uint112 r1,) = DevPair(p).getReserves();
            (uint256 rIn, uint256 rOut) = path[i] == DevPair(p).token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
            require(rIn > 0 && rOut > 0, "no liquidity");
            uint256 x = amounts[i] * 997;
            amounts[i + 1] = x * rOut / (rIn * 1000 + x);
        }
    }

    function swapExactETHForTokens(uint256 minOut, address[] calldata path, address to, uint256)
        external
        payable
        returns (uint256[] memory amounts)
    {
        require(!fail, "router down");
        require(path[0] == WETH, "path");
        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        DevToken(path[path.length - 1]).mint(to, amounts[amounts.length - 1]);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory amounts)
    {
        require(!fail, "router down");
        require(ERC20(path[0]).transferFrom(msg.sender, address(this), amountIn), "transferFrom");
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        DevToken(path[path.length - 1]).mint(to, amounts[amounts.length - 1]);
    }
}

/// Paper Press stand-in (FireSale only needs an ERC-721 for press packs).
contract DevPress is ERC721 {
    uint256 public next = 1;

    constructor() ERC721("Paper Press (dev)", "MILL") {}

    function mint(address to) external returns (uint256 id) {
        id = next++;
        _mint(to, id);
    }
}

interface IDevConsumer {
    function rawFulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

/// OpenDrandRouter with the BLS check left out: same storage layout, ABI, round selection, word derivation and
/// fulfillMany, but any 64-byte "signature" proves a round. The rehearsal's local drand server makes them up. Used to
/// show the keeper's whole delivery path where real drand can't be reached; the rehearsal also proves one real
/// drand round (1000) through the real OpenDrandRouter.
contract DevDrandRouter {
    uint256 public constant GENESIS = 1727521075;
    uint256 public constant PERIOD = 3;
    uint256 public constant MIN_DELAY = 90;
    uint32 public constant MAX_CALLBACK_GAS = 1_000_000;
    bytes32 public constant CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;

    struct Request {
        address consumer;
        uint64 round;
        uint32 callbackGasLimit;
        bool fulfilled;
        bool delivered;
        uint256 randomWord;
        uint256 fee;
    }

    mapping(uint64 => bytes32) public roundRandomness;
    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;

    event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint64 round);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord);
    event CallbackAttempted(uint256 indexed requestId, bool success);

    function requestFee() external pure returns (uint256) {
        return 0;
    }

    function requestRandomness(uint32 callbackGasLimit) external payable returns (uint256 id) {
        require(msg.value == 0 && msg.sender.code.length != 0 && callbackGasLimit >= 25_000 && callbackGasLimit <= MAX_CALLBACK_GAS, "request");
        uint64 round = uint64((block.timestamp + MIN_DELAY - GENESIS + PERIOD - 1) / PERIOD + 1);
        id = nextRequestId++;
        requests[id] = Request(msg.sender, round, callbackGasLimit, false, false, 0, 0);
        emit RandomnessRequested(id, msg.sender, round);
    }

    function fulfill(uint256 id, bytes calldata signature) external {
        require(!requests[id].fulfilled, "AlreadyFulfilled");
        _fulfill(id, signature);
    }

    function fulfillMany(uint256[] calldata ids, bytes[] calldata signatures) external {
        require(ids.length == signatures.length, "length");
        for (uint256 i; i < ids.length; i++) if (!requests[ids[i]].fulfilled) _fulfill(ids[i], signatures[i]);
    }

    function _fulfill(uint256 id, bytes calldata signature) private {
        Request storage r = requests[id];
        require(r.consumer != address(0), "InvalidRequest");
        require(block.timestamp >= GENESIS + (uint256(r.round) - 1) * PERIOD, "NotReady");
        if (roundRandomness[r.round] == bytes32(0)) {
            require(signature.length == 64, "Invalid signature");
            roundRandomness[r.round] = sha256(signature);
        }
        r.randomWord = uint256(keccak256(abi.encode(CHAIN_HASH, roundRandomness[r.round], block.chainid, address(this), id, r.consumer)));
        r.fulfilled = true;
        emit RandomnessFulfilled(id, r.randomWord);
        (bool ok,) = r.consumer.call{gas: r.callbackGasLimit}(abi.encodeCall(IDevConsumer.rawFulfillRandomness, (id, r.randomWord)));
        r.delivered = ok;
        emit CallbackAttempted(id, ok);
    }

    function retryCallback(uint256 id, uint32 gas) external {
        Request storage r = requests[id];
        require(r.fulfilled && !r.delivered && gas >= r.callbackGasLimit && gas <= MAX_CALLBACK_GAS, "InvalidCallback");
        r.callbackGasLimit = gas;
        (bool ok,) = r.consumer.call{gas: gas}(abi.encodeCall(IDevConsumer.rawFulfillRandomness, (id, r.randomWord)));
        r.delivered = ok;
        emit CallbackAttempted(id, ok);
    }
}
