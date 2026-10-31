// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";
import {FirePacks} from "../src/cards/FirePacks.sol";
import {FireCards} from "../src/cards/FireCards.sol";
import {IDealer} from "../src/cards/IDealer.sol";
import {FireSale} from "../src/cards/FireSale.sol";
import {FirePsa} from "../src/cards/FirePsa.sol";
import {FireCredits} from "../src/cards/FireCredits.sol";
import {FireGroups} from "../src/cards/FireGroups.sol";
import {FireProfiles} from "../src/cards/FireProfiles.sol";
import {FireGames} from "../src/cards/FireGames.sol";
import {FireMarket} from "../src/cards/FireMarket.sol";
import {RecipeDealer} from "../src/cards/RecipeDealer.sol";
import {CardsRenderer} from "../src/cards/CardsRenderer.sol";
import {LiquidityBurner} from "../src/cards/LiquidityBurner.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {PlankUsdTwap} from "../src/PlankUsdTwap.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";
import {MorningWood} from "../src/press/MorningWood.sol";

interface IOwnable2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

interface IVFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IVToken {
    function decimals() external view returns (uint8);
}

interface IVPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IVRouter {
    function factory() external view returns (address);
}

interface IVFactory {
    function getPair(address a, address b) external view returns (address);
}

interface IVRoyalty {
    function royaltyInfo(uint256, uint256) external view returns (address, uint256);
}

/**
 * Read-only check of a deployment (docs/deploy.md, step 4): everything in deployments/<chainId>.json has code, every
 * owner is the hardware wallet the deploy recorded as OWNER (or it still has to accept), every set-once link points
 * where it should, the feeds are live, and nothing is paused or locked by mistake. Prints OK / WAIT / FAIL per line
 * and fails if any FAIL.
 *
 *   forge script script/VerifyDeploy.s.sol --rpc-url $env:RPC
 *
 * The expected owner is the deployments file's OWNER (an OWNER setting overrides it). SERIES=7,8 limits the Series
 * checked (default: ids 0..SERIES_SCAN, 64). Nothing is sent and no key is needed.
 *
 * KEEPERS (the keeper addresses, comma-separated, as given to DeployCards) must be set: the file doesn't record them,
 * and without them nobody is checked to be allowed to run LiquidityBurner (FAIL). ROYALTY_BPS (as given to DeployCards)
 * and EDITOR (the Morning Wood editor, as given to DeployPress) are checked when set.
 */
contract VerifyDeploy is Deployments {
    uint256 internal fails;
    uint256 internal waits;

    function _ok(bool cond, string memory what) internal {
        if (cond) console.log(string.concat("OK    ", what));
        else {
            fails++;
            console.log(string.concat("FAIL  ", what));
        }
    }

    function _wait(string memory what) internal {
        waits++;
        console.log(string.concat("WAIT  ", what));
    }

    function _eq(address a, address b, string memory what) internal {
        _ok(a == b && a != address(0), string.concat(what, a == b ? "" : string.concat(" (is ", vm.toString(a), ", expected ", vm.toString(b), ")")));
    }

    function run() external {
        string[18] memory names = _contractNames();
        console.log(string.concat("deployments file: ", deploymentsFile()));
        for (uint256 i; i < names.length; i++) {
            address a = deployed(names[i]);
            if (a == address(0) && keccak256(bytes(names[i])) == keccak256("FireProfiles")) continue; // optional: _profiles()
            if (a == address(0) && keccak256(bytes(names[i])) == keccak256("FireMarket")) continue; // optional: _market()
            _ok(a != address(0) && a.code.length > 0, string.concat(names[i], " has code at ", vm.toString(a)));
        }
        if (fails > 0) {
            console.log("Stopping: deploy first (or the file points at the wrong chain).");
            revert("VerifyDeploy: FAIL");
        }
        address owner = vm.envOr("OWNER", deployedInput("OWNER"));
        _owners(owner);
        _wiring();
        _feeds();
        _locks();
        _profiles();
        _market();
        _games();
        _tokens();
        _twaps();
        _drandRouter();
        _royalties();
        _psaSettings();
        _press(owner);
        console.log(string.concat("\n", vm.toString(fails), " FAIL, ", vm.toString(waits), " WAIT"));
        if (fails > 0) revert("VerifyDeploy: FAIL");
    }

    function _owners(address owner) internal {
        require(owner != address(0), "no OWNER in the deployments file (set OWNER, the hardware wallet)");
        console.log(string.concat("INFO  expected owner (the hardware wallet): ", vm.toString(owner)));
        string[8] memory owned = ["FirePacks", "FireCards", "RecipeDealer", "FireCredits", "FirePsa", "LiquidityBurner", "FireSale", "FireGames"];
        for (uint256 i; i < owned.length; i++) {
            IOwnable2 c = IOwnable2(deployed(owned[i]));
            address o = c.owner();
            if (o == owner) {
                _ok(c.pendingOwner() == address(0), string.concat(owned[i], " owned by the hardware wallet, nothing pending"));
            } else if (c.pendingOwner() == owner) {
                _wait(string.concat(owned[i], ": the hardware wallet still has to acceptOwnership() (script/AcceptOwnership.s.sol; owner now ", vm.toString(o), ")"));
            } else {
                _ok(false, string.concat(owned[i], " owner is ", vm.toString(o), ", not the hardware wallet ", vm.toString(owner)));
            }
        }
    }

    function _wiring() internal {
        FirePacks packs = FirePacks(deployed("FirePacks"));
        FireCards cards = FireCards(deployed("FireCards"));
        FireSale sale = FireSale(payable(deployed("FireSale")));
        FirePsa psa = FirePsa(payable(deployed("FirePsa")));
        OpenVRFAdapter ca = OpenVRFAdapter(payable(deployed("CardsAdapter")));
        OpenVRFAdapter pa = OpenVRFAdapter(payable(deployed("PsaAdapter")));
        address router = deployed("OpenDrandRouter");

        _eq(packs.cards(), address(cards), "FirePacks.cards is FireCards");
        _eq(packs.seller(), address(sale), "FirePacks.seller is FireSale");
        _eq(address(cards.PACKS()), address(packs), "FireCards.PACKS is FirePacks");
        _eq(cards.seller(), address(sale), "FireCards.seller is FireSale");
        _eq(cards.psa(), address(psa), "FireCards.psa is FirePsa");
        _eq(address(cards.renderer()), deployed("CardsRenderer"), "FireCards.renderer is CardsRenderer");
        _eq(address(CardsRenderer(deployed("CardsRenderer")).CARDS()), address(cards), "CardsRenderer.CARDS is FireCards");
        if (address(cards.randomness()) == address(ca)) _ok(true, "FireCards.randomness is the cards adapter");
        else _wait(string.concat("FireCards.randomness was switched to ", vm.toString(address(cards.randomness())), " (check the announcement)"));
        if (address(psa.randomness()) == address(pa)) _ok(true, "FirePsa.randomness is the PDA adapter");
        else _wait(string.concat("FirePsa.randomness was switched to ", vm.toString(address(psa.randomness())), " (check the announcement)"));
        _eq(ca.FIRE(), address(cards), "cards adapter serves FireCards");
        _eq(address(ca.ROUTER()), router, "cards adapter uses the OpenDrandRouter");
        _eq(pa.FIRE(), address(psa), "PDA adapter serves FirePsa");
        _eq(address(pa.ROUTER()), router, "PDA adapter uses the OpenDrandRouter");
        _wiringSale();
    }

    function _wiringSale() internal {
        FirePacks packs = FirePacks(deployed("FirePacks"));
        FireCards cards = FireCards(deployed("FireCards"));
        FireSale sale = FireSale(payable(deployed("FireSale")));
        FireCredits credits = FireCredits(deployed("FireCredits"));
        RecipeDealer dealer = RecipeDealer(deployed("RecipeDealer"));
        _eq(address(dealer.CARDS()), address(cards), "RecipeDealer.CARDS is FireCards");
        _eq(address(dealer.PACKS()), address(packs), "RecipeDealer.PACKS is FirePacks");
        _eq(address(dealer.COMPILER()), deployed("RecipeCompiler"), "RecipeDealer.COMPILER is RecipeCompiler");
        _eq(address(sale.PACKS()), address(packs), "FireSale.PACKS is FirePacks");
        _eq(address(sale.CARDS()), address(cards), "FireSale.CARDS is FireCards");
        _eq(sale.CREDITS(), address(credits), "FireSale.CREDITS is FireCredits");
        _eq(address(credits.sale()), address(sale), "FireCredits.sale is FireSale");
        _eq(address(credits.CARDS()), address(cards), "FireCredits.CARDS is FireCards");
        _eq(address(sale.GROUPS()), deployed("FireGroups"), "FireSale.GROUPS is FireGroups");
        _eq(FireGroups(deployed("FireGroups")).sale(), address(sale), "FireGroups.sale is FireSale (its only writer)");
        _eq(sale.liquidity(), deployed("LiquidityBurner"), "FireSale.liquidity is LiquidityBurner");
        address rev = deployedInput("REVENUE_WALLET");
        if (rev != address(0)) _eq(sale.revenueWallet(), rev, "FireSale.revenueWallet is REVENUE_WALLET");
        _eq(address(sale.PLANK_USD()), deployed("PlankUsdTwap"), "FireSale.PLANK_USD is PlankUsdTwap");
        _eq(address(sale.PAPER_USD()), deployed("PaperUsdTwap"), "FireSale.PAPER_USD is PaperUsdTwap");
        address ethUsd = deployedInput("ETH_USD_FEED");
        if (ethUsd != address(0)) _eq(address(sale.ETH_USD()), ethUsd, "FireSale.ETH_USD is ETH_USD_FEED");
        _wiringBurners();
    }

    function _wiringBurners() internal {
        FireSale sale = FireSale(payable(deployed("FireSale")));
        FirePsa psa = FirePsa(payable(deployed("FirePsa")));
        LiquidityBurner liq = LiquidityBurner(payable(deployed("LiquidityBurner")));
        address ethUsd = deployedInput("ETH_USD_FEED");
        address v2 = deployedInput("V2_ROUTER");
        if (v2 != address(0)) {
            _eq(address(sale.ROUTER()), v2, "FireSale.ROUTER is V2_ROUTER");
            _eq(address(liq.ROUTER()), v2, "LiquidityBurner.ROUTER is V2_ROUTER");
            address pool = IVFactory(IVRouter(v2).factory()).getPair(deployedInput("PAPER"), deployedInput("PLANK"));
            _ok(pool != address(0), "V2_ROUTER's factory has the PAPER/PLANK pool");
            _eq(address(liq.PAIR()), pool, "LiquidityBurner.PAIR is the PAPER/PLANK pool");
        }
        // its short PAPER average reads the PAPER side of that pool (PAIR.price0/1CumulativeLast)
        _ok(liq.PAPER_IS_TOKEN0() == (IVPair(address(liq.PAIR())).token0() == address(liq.PAPER())),
            "LiquidityBurner's short PAPER average reads the PAPER side of its pool");
        _eq(address(psa.CARDS()), deployed("FireCards"), "FirePsa.CARDS is FireCards");
        _eq(address(psa.BURNER()), address(liq), "FirePsa pays LiquidityBurner");
        _eq(FireGames(deployed("FireGames")).LIQUIDITY(), address(liq), "FireGames pays LiquidityBurner");
        _eq(address(liq.plankUsd()), deployed("PlankUsdTwap"), "LiquidityBurner.plankUsd is PlankUsdTwap");
        _eq(address(liq.paperUsd()), deployed("PaperUsdTwap"), "LiquidityBurner.paperUsd is PaperUsdTwap");
        if (ethUsd != address(0)) _eq(address(liq.ethUsd()), ethUsd, "LiquidityBurner.ethUsd is ETH_USD_FEED");
        _ok(liq.routesOf(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PAPER).length > 0
            && liq.routesOf(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PLANK).length > 0
            && liq.routesOf(LiquidityBurner.Pay.PLANK, LiquidityBurner.Side.PAPER).length > 0,
            "LiquidityBurner has ETH and PLANK routes");
        address[] memory keepers = vm.envOr("KEEPERS", ",", new address[](0));
        if (keepers.length == 0) {
            _ok(false, "KEEPERS not set here, so the keepers' run rights weren't checked: set $env:KEEPERS = \"<main>,<backup>\" (the keeper addresses given to DeployCards) and run again");
        }
        for (uint256 i; i < keepers.length; i++) _ok(liq.keeper(keepers[i]), "a keeper in KEEPERS may run LiquidityBurner");
    }

    /// Royalty receivers and rates (FireCards, FirePacks, MorningWood): to ROYALTY_RECEIVER, at most 10%, and at
    /// ROYALTY_BPS when it is set here (MorningWood starts at 2.5%).
    function _royalties() internal {
        address royaltyTo = deployedInput("ROYALTY_RECEIVER");
        uint256 want = vm.envOr("ROYALTY_BPS", type(uint256).max);
        string[3] memory names = ["FireCards", "FirePacks", "MorningWood"];
        for (uint256 i; i < names.length; i++) {
            address a = deployed(names[i]);
            if (a == address(0)) continue;
            (address to, uint256 bps) = IVRoyalty(a).royaltyInfo(1, 10_000);
            if (royaltyTo != address(0)) _eq(to, royaltyTo, string.concat(names[i], " royalty goes to ROYALTY_RECEIVER"));
            bool cards = i < 2;
            if (cards && want != type(uint256).max) {
                _ok(bps == want, string.concat(names[i], " royalty is ROYALTY_BPS (", vm.toString(bps), " bps)"));
            } else {
                _ok(bps <= 1_000, string.concat(names[i], " royalty at most 10% (", vm.toString(bps), " bps)"));
            }
        }
        if (want == type(uint256).max) console.log("INFO  ROYALTY_BPS not set here: royalty rates checked only against the 10% cap");
    }

    function _tokenEq(address a, string memory input, string memory what) internal {
        address want = deployedInput(input);
        if (want == address(0) && a == address(0)) return; // e.g. no USDG on this chain
        _eq(a, want, string.concat(what, " is ", input));
    }

    function _unitOk(uint256 unit, string memory what) internal {
        address usdg = deployedInput("USDG");
        uint256 want = usdg == address(0) ? 0 : 10 ** IVToken(usdg).decimals();
        _ok(unit == want, string.concat(what, ".USDG_UNIT matches USDG's decimals (", vm.toString(unit), ")"));
    }

    /// The token immutables against the inputs: LiquidityBurner has no withdraw, so a wrong token there traps its coins.
    function _tokens() internal {
        FireSale sale = FireSale(payable(deployed("FireSale")));
        LiquidityBurner liq = LiquidityBurner(payable(deployed("LiquidityBurner")));
        FirePsa psa = FirePsa(payable(deployed("FirePsa")));
        _tokenEq(address(sale.PAPER()), "PAPER", "FireSale.PAPER");
        _tokenEq(address(sale.PLANK()), "PLANK", "FireSale.PLANK");
        _tokenEq(address(sale.USDG()), "USDG", "FireSale.USDG");
        _tokenEq(sale.WETH(), "WETH", "FireSale.WETH");
        _unitOk(sale.USDG_UNIT(), "FireSale");
        _tokenEq(address(liq.PAPER()), "PAPER", "LiquidityBurner.PAPER");
        _tokenEq(address(liq.PLANK()), "PLANK", "LiquidityBurner.PLANK");
        _tokenEq(address(liq.USDG()), "USDG", "LiquidityBurner.USDG");
        _tokenEq(liq.WETH(), "WETH", "LiquidityBurner.WETH");
        _tokenEq(address(psa.PLANK()), "PLANK", "FirePsa.PLANK");
        _tokenEq(address(psa.USDG()), "USDG", "FirePsa.USDG");
        if (deployedInput("USDG") != address(0)) {
            _ok(liq.routesOf(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PAPER).length > 0
                && liq.routesOf(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PLANK).length > 0,
                "LiquidityBurner has USDG routes (USDG gets spent)");
        }
    }

    /// The price feeds are built on the recorded pool, tokens and ETH/USD feed (DeployCards.check, after the fact).
    function _twaps() internal {
        PlankUsdTwap pt = PlankUsdTwap(deployed("PlankUsdTwap"));
        PaperUsdTwap ppt = PaperUsdTwap(deployed("PaperUsdTwap"));
        address pair = address(pt.PAIR());
        if (deployedInput("PLANK_WETH_V2_PAIR") != address(0)) _tokenEq(pair, "PLANK_WETH_V2_PAIR", "PlankUsdTwap.PAIR");
        (address t0, address t1) = (IVPair(pair).token0(), IVPair(pair).token1());
        (address plank, address weth) = (deployedInput("PLANK"), deployedInput("WETH"));
        _ok((t0 == plank && t1 == weth) || (t0 == weth && t1 == plank), "PlankUsdTwap's pool is PLANK/WETH");
        _ok(pt.PLANK_IS_TOKEN0() == (t0 == plank), "PlankUsdTwap reads the PLANK side of its pool");
        _tokenEq(address(pt.ETH_USD()), "ETH_USD_FEED", "PlankUsdTwap.ETH_USD");
        _tokenEq(ppt.PAPER(), "PAPER", "PaperUsdTwap.PAPER");
        _tokenEq(ppt.WETH(), "WETH", "PaperUsdTwap.WETH");
        _tokenEq(ppt.USDG(), "USDG", "PaperUsdTwap.USDG");
        _tokenEq(ppt.PLANK(), "PLANK", "PaperUsdTwap.PLANK");
        _tokenEq(address(ppt.ETH_USD()), "ETH_USD_FEED", "PaperUsdTwap.ETH_USD");
        _eq(address(ppt.PLANK_USD()), address(pt), "PaperUsdTwap.PLANK_USD is PlankUsdTwap");
        if (deployedInput("UNIV2_FACTORY") != address(0)) _tokenEq(address(ppt.FACTORY()), "UNIV2_FACTORY", "PaperUsdTwap.FACTORY");
        _ok(IVToken(address(pt)).decimals() == 18 && IVToken(address(ppt)).decimals() == 18, "PLANK/USD and PAPER/USD have 18 decimals");
        address ethUsd = deployedInput("ETH_USD_FEED");
        if (ethUsd != address(0)) _ok(IVToken(ethUsd).decimals() == 8, "ETH_USD_FEED has 8 decimals");
    }

    function _uintAt(address a, bytes memory call) internal view returns (bool ok, uint256 v) {
        bytes memory ret;
        (ok, ret) = a.staticcall(call);
        ok = ok && ret.length == 32;
        if (ok) v = abi.decode(ret, (uint256));
    }

    /// The randomness is permanent: the router must be the OpenDrandRouter (no fee, drand quicknet, 90 s delay).
    function _drandRouter() internal {
        address router = deployed("OpenDrandRouter");
        (bool ok1, uint256 fee) = _uintAt(router, abi.encodeWithSignature("requestFee()"));
        (bool ok2, uint256 chainHash) = _uintAt(router, abi.encodeWithSignature("CHAIN_HASH()"));
        (bool ok3, uint256 delay) = _uintAt(router, abi.encodeWithSignature("MIN_DELAY()"));
        (bool ok4, uint256 period) = _uintAt(router, abi.encodeWithSignature("PERIOD()"));
        (bool ok5, uint256 genesis) = _uintAt(router, abi.encodeWithSignature("GENESIS()"));
        _ok(ok1 && ok2 && ok3 && ok4 && ok5 && fee == 0 && chainHash == 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3
            && delay == 90 && period == 3 && genesis == 1727521075,
            "OpenDrandRouter is the real one (no fee, drand quicknet, 90 s delay)");
    }

    /// FirePsa's batch size and prices: within the contract's bounds, and the defaults unless changed on purpose.
    function _psaSettings() internal {
        FirePsa psa = FirePsa(payable(deployed("FirePsa")));
        (uint256 b, uint256 c, uint256 g) = (psa.maxBatch(), psa.caseUsd18(), psa.gradeUsd18());
        _ok(b > 0 && b <= psa.MAX_BATCH_CAP() && c > 0 && g > 0 && c <= psa.MAX_PRICE_USD18() && g <= psa.MAX_PRICE_USD18(),
            string.concat("FirePsa: up to ", vm.toString(b), " cards a batch, case $", _usd18(c), ", grade $", _usd18(g)));
        if (b != 20 || c != 0.05e18 || g != 1e18) _wait("FirePsa batch size or prices changed from the defaults (20, $0.05, $1): check that was meant");
    }

    /// The Morning Wood (DeployPress): owner, editor, where its money goes, its ETH/USD feed, its tokens and prices.
    function _press(address owner) internal {
        address a = deployed("MorningWood");
        if (a == address(0)) {
            _wait("MorningWood not deployed (script/DeployPress.s.sol:DeployPress)");
            return;
        }
        MorningWood press = MorningWood(payable(a));
        _ok(a.code.length > 0, string.concat("MorningWood has code at ", vm.toString(a)));
        if (press.owner() == owner) _ok(press.pendingOwner() == address(0), "MorningWood owned by the hardware wallet, nothing pending");
        else if (press.pendingOwner() == owner) _wait("MorningWood: the hardware wallet still has to accept (script/DeployPress.s.sol:AcceptPress)");
        else _ok(false, string.concat("MorningWood owner is ", vm.toString(press.owner()), ", not the hardware wallet"));
        address editor = vm.envOr("EDITOR", address(0));
        if (editor != address(0)) _eq(press.editor(), editor, "MorningWood.editor is EDITOR");
        else if (press.editor() == address(0)) _wait("MorningWood has no editor yet (the owner calls setEditor)");
        else console.log(string.concat("INFO  MorningWood.editor is ", vm.toString(press.editor()), " (set EDITOR here to check it)"));
        _ok(press.editor() != owner || owner == address(0), "MorningWood.editor is not the owner's hardware wallet");
        _eq(press.paperBurner(), deployed("LiquidityBurner"), "MorningWood pays LiquidityBurner");
        address ethUsd = deployedInput("ETH_USD_FEED");
        if (ethUsd != address(0)) _eq(address(press.ethUsd()), ethUsd, "MorningWood.ethUsd is ETH_USD_FEED");
        _tokenEq(address(press.PAPER()), "PAPER", "MorningWood.PAPER");
        _tokenEq(address(press.USDG()), "USDG", "MorningWood.USDG");
        _unitOk(press.USDG_UNIT(), "MorningWood");
        _ok(!press.paused(), "MorningWood not paused");
        (uint256 pp, uint256 usd, uint256 lp) = (press.paperPerCopy(), press.usdPerCopy(), press.letterPaper());
        _ok(pp <= press.MAX_PAPER() && usd <= press.MAX_USD8() && lp <= press.MAX_PAPER(), string.concat(
            "MorningWood prices: ", _usd18(pp), " PAPER + $", _usd8(usd), " a copy, ", _usd18(lp), " PAPER a letter"));
        if (pp != 1e18 || usd != 5e6 || lp != 1e18) _wait("MorningWood prices changed from the defaults (1 PAPER + $0.05, 1 PAPER): check that was meant");
    }

    /// 18-decimal amount as "1.25" (two places).
    function _usd18(uint256 v) internal pure returns (string memory) {
        uint256 cents = v / 1e16;
        return _cents(cents);
    }

    function _usd8(uint256 v) internal pure returns (string memory) {
        return _cents(v / 1e6);
    }

    function _cents(uint256 cents) internal pure returns (string memory) {
        uint256 c = cents % 100;
        return string.concat(vm.toString(cents / 100), ".", c < 10 ? "0" : "", vm.toString(c));
    }

    /// FireProfiles (names and profile pictures): optional, a deploy made before it existed adds it with
    /// script/DeployProfiles.s.sol. Until then the site hides profiles.
    function _profiles() internal {
        address a = deployed("FireProfiles");
        if (a == address(0)) {
            _wait("FireProfiles not deployed: the site hides profiles until script/DeployProfiles.s.sol runs");
            return;
        }
        _eq(address(FireProfiles(a).CARDS()), deployed("FireCards"), "FireProfiles.CARDS is FireCards");
    }

    /// FireMarket (cards and packs for sale, no owner): optional, a deploy made before it existed adds it with
    /// script/DeployMarket.s.sol. Until then the site hides the market.
    function _market() internal {
        address a = deployed("FireMarket");
        if (a == address(0)) {
            _wait("FireMarket not deployed: the site hides the market until script/DeployMarket.s.sol runs");
            return;
        }
        _eq(address(FireMarket(a).CARDS()), deployed("FireCards"), "FireMarket.CARDS is FireCards");
        _eq(address(FireMarket(a).PACKS()), deployed("FirePacks"), "FireMarket.PACKS is FirePacks");
    }

    /// FireGames (the game room) and its prizes in FireCredits: paper football is game 1 at 1 PAPER, prizes allowed.
    /// Paid play stays closed (WAIT) until the owner sets the server's signer and the Series; prizes go out once the
    /// owner sets the prizeAwarder (the server's wallet).
    function _games() internal {
        FireGames g = FireGames(deployed("FireGames"));
        FireCredits credits = FireCredits(deployed("FireCredits"));
        address paper = deployedInput("PAPER");
        if (paper != address(0)) _eq(address(g.PAPER()), paper, "FireGames.PAPER is PAPER");
        _ok(g.entryOf(1) == 1e18 && g.capUsdOf(1) == 10_000_000, "FireGames: paper football (game 1) costs 1 PAPER a run, at most $0.10 of PAPER");
        _eq(address(g.paperUsd()), deployed("PaperUsdTwap"), "FireGames prices the ceiling with the PaperUsdTwap");
        _ok(credits.prizeGame(1), "FireCredits allows prizes for paper football (game 1)");
        _eq(address(credits.psa()), deployed("FirePsa"), "FireCredits gives case and grading prizes through FirePsa");
        _eq(FirePsa(payable(deployed("FirePsa"))).couponIssuer(), address(credits), "FirePsa takes coupons only from FireCredits");
        _ok(!g.paused(), "FireGames not paused");
        _ok(g.gameOpen(1), "FireGames: paper football open");
        if (g.signer() == address(0) || g.series() == 0) {
            _wait("FireGames: paid play closed until the owner sets the server's signer (setSigner) and the Series (setSeries)");
        } else {
            console.log(string.concat("INFO  FireGames signer ", vm.toString(g.signer()), ", Series ", vm.toString(g.series())));
        }
        if (credits.prizeAwarder() == address(0)) _wait("FireCredits.prizeAwarder unset: only the owner can award prizes until it's the server's wallet");
        else console.log(string.concat("INFO  FireCredits.prizeAwarder ", vm.toString(credits.prizeAwarder())));
    }

    function _feeds() internal {
        (, int256 eth,, uint256 ethAt,) = IVFeed(deployedInput("ETH_USD_FEED") != address(0) ? deployedInput("ETH_USD_FEED") : address(FireSale(payable(deployed("FireSale"))).ETH_USD())).latestRoundData();
        _ok(eth > 0 && block.timestamp - ethAt <= 25 hours, string.concat("ETH/USD feed live (updated ", vm.toString((block.timestamp - ethAt) / 60), " min ago)"));
        PlankUsdTwap pt = PlankUsdTwap(deployed("PlankUsdTwap"));
        (, int256 plank,,,) = pt.latestRoundData();
        (, uint32 lastTs) = pt.last();
        if (plank > 0 && block.timestamp - lastTs <= 2 hours) {
            _ok(true, string.concat("PLANK/USD live (last checkpoint ", vm.toString((block.timestamp - lastTs) / 60), " min ago)"));
        } else {
            _wait(string.concat("PLANK/USD not live yet (last checkpoint ", vm.toString((block.timestamp - lastTs) / 60), " min ago): the keeper checkpoints it every 30 min"));
        }
        PaperUsdTwap ppt = PaperUsdTwap(deployed("PaperUsdTwap"));
        (, int256 paper,,,) = ppt.latestRoundData();
        if (paper > 0) _ok(true, "PAPER/USD live");
        else if (address(ppt.pair()) != address(0)) _wait("PAPER/USD: pool adopted, first price after one 20 h window");
        else if (ppt.candidate() != address(0)) _wait("PAPER/USD: a candidate pool is waiting out its 20 h");
        else _wait("PAPER/USD: no PAPER pool with $10 found yet (packs take the set PAPER, no ceiling; fees wait)");
    }

    function _locks() internal {
        FireSale sale = FireSale(payable(deployed("FireSale")));
        FireCards cards = FireCards(deployed("FireCards"));
        _ok(!sale.paused(), "FireSale not paused");
        _ok(!FirePsa(payable(deployed("FirePsa"))).paused(), "FirePsa not paused");
        uint256[] memory list = vm.envOr("SERIES", ",", new uint256[](0));
        uint256 n = list.length;
        if (n == 0) {
            uint256 scan = vm.envOr("SERIES_SCAN", uint256(64));
            list = new uint256[](scan + 1);
            for (uint256 f; f <= scan; f++) list[f] = f;
            n = list.length;
        }
        uint256 configured;
        for (uint256 i; i < n; i++) {
            uint256 f = list[i];
            (IDealer d, bool closed, bool locked,,,) = cards.fires(f);
            if (address(d) == address(0) && !locked) continue;
            configured++;
            FireSale.Drop memory drop = sale.dropOf(f);
            if (locked && drop.start == 0) {
                _ok(false, string.concat("Series ", vm.toString(f), " is locked but has no drop: locked by mistake? (lockFire)"));
            } else {
                console.log(string.concat(
                    "INFO  Series ", vm.toString(f), closed ? ": closed" : locked ? ": locked, drop set" : ": set up, not locked (batch A done, batch B not yet)"
                ));
            }
        }
        if (configured == 0) console.log("INFO  no Series set up yet");
        console.log(string.concat("INFO  drops set up and not closed: ", vm.toString(sale.activeDrops())));
    }
}
