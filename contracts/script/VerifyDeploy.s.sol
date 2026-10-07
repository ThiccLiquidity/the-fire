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
import {RecipeDealer} from "../src/cards/RecipeDealer.sol";
import {CardsRenderer} from "../src/cards/CardsRenderer.sol";
import {PaperBurner} from "../src/cards/PaperBurner.sol";
import {PlankBurner} from "../src/cards/PlankBurner.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {PlankUsdTwap} from "../src/PlankUsdTwap.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";

interface IOwnable2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

interface IVFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
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
        string[15] memory names = _contractNames();
        console.log(string.concat("deployments file: ", deploymentsFile()));
        for (uint256 i; i < names.length; i++) {
            address a = deployed(names[i]);
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
        console.log(string.concat("\n", vm.toString(fails), " FAIL, ", vm.toString(waits), " WAIT"));
        if (fails > 0) revert("VerifyDeploy: FAIL");
    }

    function _owners(address owner) internal {
        require(owner != address(0), "no OWNER in the deployments file (set OWNER, the hardware wallet)");
        console.log(string.concat("INFO  expected owner (the hardware wallet): ", vm.toString(owner)));
        string[7] memory owned = ["FirePacks", "FireCards", "RecipeDealer", "FireCredits", "FirePsa", "PaperBurner", "FireSale"];
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
        _eq(sale.plankBurner(), deployed("PlankBurner"), "FireSale.plankBurner is PlankBurner");
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
        PaperBurner burner = PaperBurner(payable(deployed("PaperBurner")));
        PlankBurner plankBurner = PlankBurner(payable(deployed("PlankBurner")));
        address ethUsd = deployedInput("ETH_USD_FEED");
        address v2 = deployedInput("V2_ROUTER");
        if (v2 != address(0)) {
            _eq(address(sale.ROUTER()), v2, "FireSale.ROUTER is V2_ROUTER");
            _eq(address(burner.ROUTER()), v2, "PaperBurner.ROUTER is V2_ROUTER");
            _eq(address(plankBurner.ROUTER()), v2, "PlankBurner.ROUTER is V2_ROUTER");
        }
        _eq(address(psa.CARDS()), deployed("FireCards"), "FirePsa.CARDS is FireCards");
        _eq(address(psa.BURNER()), address(burner), "FirePsa pays PaperBurner");
        _eq(address(burner.plankUsd()), deployed("PlankUsdTwap"), "PaperBurner.plankUsd is PlankUsdTwap");
        _eq(address(burner.paperUsd()), deployed("PaperUsdTwap"), "PaperBurner.paperUsd is PaperUsdTwap");
        _eq(address(plankBurner.PLANK_USD()), deployed("PlankUsdTwap"), "PlankBurner.PLANK_USD is PlankUsdTwap");
        if (ethUsd != address(0)) {
            _eq(address(burner.ethUsd()), ethUsd, "PaperBurner.ethUsd is ETH_USD_FEED");
            _eq(address(plankBurner.ETH_USD()), ethUsd, "PlankBurner.ETH_USD is ETH_USD_FEED");
        }
        _ok(burner.routesOf(PaperBurner.Pay.ETH).length > 0 && burner.routesOf(PaperBurner.Pay.PLANK).length > 0, "PaperBurner has ETH and PLANK routes");
        address royaltyTo = deployedInput("ROYALTY_RECEIVER");
        if (royaltyTo != address(0)) {
            (address r1,) = FireCards(deployed("FireCards")).royaltyInfo(1, 10_000);
            (address r2,) = FirePacks(deployed("FirePacks")).royaltyInfo(1, 10_000);
            _eq(r1, royaltyTo, "FireCards royalty goes to ROYALTY_RECEIVER");
            _eq(r2, royaltyTo, "FirePacks royalty goes to ROYALTY_RECEIVER");
        }
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
