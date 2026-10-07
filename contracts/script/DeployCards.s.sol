// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";
import {FirePacks} from "../src/cards/FirePacks.sol";
import {FireCards} from "../src/cards/FireCards.sol";
import {FireSale} from "../src/cards/FireSale.sol";
import {FirePsa} from "../src/cards/FirePsa.sol";
import {RecipeDealer} from "../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../src/cards/CardsRenderer.sol";
import {PaperBurner} from "../src/cards/PaperBurner.sol";
import {PlankBurner} from "../src/cards/PlankBurner.sol";
import {FireCredits} from "../src/cards/FireCredits.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface ICardsDrandRouter {
    function requestFee() external view returns (uint256);
}

interface ICardsFeed {
    function decimals() external view returns (uint8);
}

interface ICardsPlankTwap {
    function PAIR() external view returns (address);
    function ETH_USD() external view returns (address);
}

interface ICardsPaperTwap {
    function PAPER() external view returns (address);
    function ETH_USD() external view returns (address);
    function PLANK_USD() external view returns (address);
    function PLANK() external view returns (address);
    function WETH() external view returns (address);
    function USDG() external view returns (address);
    function FACTORY() external view returns (address);
}

interface ICardsV2Router {
    function WETH() external view returns (address);
    function factory() external view returns (address);
}

interface ICardsV2Factory {
    function getPair(address a, address b) external view returns (address);
}

interface ICardsPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * Deploys every Omni card contract (see ../docs/cards-contracts.md and ../docs/omni-economy.md) and wires them:
 *   FirePacks (sealed packs), FireCards (cards), CardsRenderer (card metadata), RecipeDealer + RecipeCompiler (deal each
 *   Series from its recipe), FireSale (the pack sale), FireCredits (free pack credits, card burning, suggestions),
 *   PlankBurner (holds the PLANK burn share when a sale's swap can't run, and burns it later), FirePsa (cases and PDA
 *   grading), PaperBurner (case and grading fees buy and burn PAPER), and a drand adapter for each of FireCards and
 *   FirePsa.
 * Checks every input before sending anything.
 *
 *   forge script script/DeployCards.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --slow --broadcast \
 *     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
 *
 * Sign with a Foundry keystore (cast wallet import deployer --interactive) or --ledger. Never --private-key.
 *
 * Settings (.env.example, card contracts section):
 *   DRAND_ROUTER      the OpenDrandRouter from DeployInfra.s.sol (it has no owner)
 *   OWNER             the multisig (Safe) that will own everything. Afterwards it must call acceptOwnership() on
 *                     FirePacks, FireCards, RecipeDealer, FireCredits, FirePsa and PaperBurner (Ownable2Step). FireSale
 *                     is owned by OWNER from deployment. PlankBurner has no owner.
 *                     A plain wallet is refused unless ALLOW_EOA_OWNER=true.
 *   ROYALTY_RECEIVER, ROYALTY_BPS (500 = 5%, max 1000)
 *   PACK_IMAGE_BASE   folder of the pack art (fire<N>.webp); can be set later
 *   PAPER, PLANK, USDG, WETH, MILL (the Paper Press NFT)
 *   ETH_USD_FEED      Chainlink ETH/USD; PLANK_USD_FEED the PlankUsdTwap (DeployTwap.s.sol); PAPER_USD_FEED the PaperUsdTwap (DeployInfra.s.sol),
 *                     never the PAPER pool itself. Both feeds must be built on this PAPER/PLANK and ETH_USD_FEED.
 *   V2_ROUTER         Uniswap V2 router (buys the PLANK that each sale burns, and the PAPER that fees burn)
 *   REVENUE_WALLET    gets 70% of every sale (the PLANK burn share goes to PlankBurner when its swap can't go through)
 *   SUGGESTION_PAPER  PAPER wei per character suggestion to start (default 1e18 = 1 PAPER; 0 = free). The owner can
 *                     change it later (FireCredits.setSuggestionRules). Every other sale number is set per drop.
 *
 * DRAND_ROUTER, PLANK_USD_FEED and PAPER_USD_FEED are read from deployments/<chainId>.json (written by steps 1 and 2)
 * when not set. When it broadcasts it adds every contract it deployed (and its inputs) to that file; VerifyDeploy.s.sol
 * then checks the result.
 *
 * Left for the owner afterwards, per Series (script/ConfigureSeries.s.sol builds these calls from the studio's recipe
 * JSON): RecipeDealer.setRecipe and setCharacters (appendCharacters for long lists), FireCards.setDealer and
 * setImagesBase, optionally FirePsa.setOdds, then FireSale.configureDrop from the JSON's "sale" block (which locks the
 * Series); and FireCredits.pickSuggestions.
 */
contract DeployCards is Deployments {
    struct Params {
        address router; // drand
        address owner;
        address royaltyTo;
        uint96 royaltyBps;
        string packBase;
        address paper;
        address plank;
        address usdg;
        address weth;
        address press;
        address ethUsd;
        address plankUsd;
        address paperUsd;
        address v2Router;
        address revenueWallet;
        uint256 suggestionPaper; // PAPER wei per character suggestion to start (the owner can change it later)
    }

    struct Deployed {
        FirePacks packs;
        FireCards cards;
        RecipeDealer dealer;
        OpenVRFAdapter adapter;
        FireSale sale;
        FirePsa psa;
        OpenVRFAdapter psaAdapter;
        RecipeCompiler compiler;
        CardsRenderer renderer;
        PaperBurner burner;
        FireCredits credits;
        PlankBurner plankBurner;
    }

    function run() external returns (Deployed memory d) {
        Params memory p = Params({
            router: _addr("DRAND_ROUTER", "OpenDrandRouter"),
            owner: vm.envAddress("OWNER"),
            royaltyTo: vm.envAddress("ROYALTY_RECEIVER"),
            royaltyBps: uint96(vm.envUint("ROYALTY_BPS")),
            packBase: vm.envOr("PACK_IMAGE_BASE", string("")),
            paper: vm.envAddress("PAPER"),
            plank: vm.envAddress("PLANK"),
            usdg: vm.envOr("USDG", address(0)),
            weth: vm.envAddress("WETH"),
            press: vm.envAddress("MILL"),
            ethUsd: vm.envAddress("ETH_USD_FEED"),
            plankUsd: _addr("PLANK_USD_FEED", "PlankUsdTwap"),
            paperUsd: _addr("PAPER_USD_FEED", "PaperUsdTwap"),
            v2Router: vm.envAddress("V2_ROUTER"),
            revenueWallet: vm.envAddress("REVENUE_WALLET"),
            suggestionPaper: vm.envOr("SUGGESTION_PAPER", uint256(1e18))
        });
        check(p);

        vm.startBroadcast();
        d = deploy(p, msg.sender);
        vm.stopBroadcast();

        console.log("FirePacks  ", address(d.packs));
        console.log("FireCards  ", address(d.cards));
        console.log("RecipeDealer", address(d.dealer));
        console.log("FireSale   ", address(d.sale));
        console.log("FireCredits", address(d.credits));
        console.log("PlankBurner", address(d.plankBurner));
        console.log("FirePsa    ", address(d.psa));
        console.log("PaperBurner", address(d.burner));
        console.log("CardsRenderer", address(d.renderer));
        console.log("RecipeCompiler", address(d.compiler));
        console.log("Adapter (cards)", address(d.adapter));
        console.log("Adapter (PDA)  ", address(d.psaAdapter));
        console.log("Next: the OWNER multisig calls acceptOwnership() on FirePacks, FireCards, RecipeDealer, FireCredits, FirePsa and PaperBurner.");
        _recordCards(d, p);
    }

    function _recordCards(Deployed memory d, Params memory p) internal {
        string[] memory names = new string[](15);
        address[] memory addrs = new address[](15);
        (names[0], addrs[0]) = ("FirePacks", address(d.packs));
        (names[1], addrs[1]) = ("FireCards", address(d.cards));
        (names[2], addrs[2]) = ("CardsRenderer", address(d.renderer));
        (names[3], addrs[3]) = ("RecipeDealer", address(d.dealer));
        (names[4], addrs[4]) = ("RecipeCompiler", address(d.compiler));
        (names[5], addrs[5]) = ("PlankBurner", address(d.plankBurner));
        (names[6], addrs[6]) = ("FireCredits", address(d.credits));
        (names[7], addrs[7]) = ("FireSale", address(d.sale));
        (names[8], addrs[8]) = ("PaperBurner", address(d.burner));
        (names[9], addrs[9]) = ("FirePsa", address(d.psa));
        (names[10], addrs[10]) = ("CardsAdapter", address(d.adapter));
        (names[11], addrs[11]) = ("PsaAdapter", address(d.psaAdapter));
        (names[12], addrs[12]) = ("OpenDrandRouter", p.router);
        (names[13], addrs[13]) = ("PlankUsdTwap", p.plankUsd);
        (names[14], addrs[14]) = ("PaperUsdTwap", p.paperUsd);
        string[] memory inNames = new string[](11);
        address[] memory inAddrs = new address[](11);
        (inNames[0], inAddrs[0]) = ("PAPER", p.paper);
        (inNames[1], inAddrs[1]) = ("PLANK", p.plank);
        (inNames[2], inAddrs[2]) = ("USDG", p.usdg);
        (inNames[3], inAddrs[3]) = ("WETH", p.weth);
        (inNames[4], inAddrs[4]) = ("MILL", p.press);
        (inNames[5], inAddrs[5]) = ("ETH_USD_FEED", p.ethUsd);
        (inNames[6], inAddrs[6]) = ("V2_ROUTER", p.v2Router);
        (inNames[7], inAddrs[7]) = ("REVENUE_WALLET", p.revenueWallet);
        (inNames[8], inAddrs[8]) = ("ROYALTY_RECEIVER", p.royaltyTo);
        (inNames[9], inAddrs[9]) = ("OWNER", p.owner);
        (inNames[10], inAddrs[10]) = ("UNIV2_FACTORY", ICardsV2Router(p.v2Router).factory());
        _record(names, addrs, inNames, inAddrs, p.owner, msg.sender);
    }

    /// @dev Split out so tests can run the exact same steps.
    function deploy(Params memory p, address deployer) public returns (Deployed memory d) {
        d.packs = new FirePacks(deployer);
        d.cards = new FireCards(deployer, address(d.packs));
        d.compiler = new RecipeCompiler();
        d.dealer = new RecipeDealer(deployer, address(d.cards), address(d.compiler));
        require(address(d.dealer.CARDS()) == address(d.cards) && address(d.dealer.PACKS()) == address(d.packs), "dealer wiring");
        d.renderer = new CardsRenderer(address(d.cards));
        d.adapter = new OpenVRFAdapter(p.router, address(d.cards));
        require(d.adapter.FIRE() == address(d.cards), "adapter points elsewhere");
        uint8 usdgDecimals = p.usdg == address(0) ? 0 : IERC20Metadata(p.usdg).decimals();
        d.plankBurner = new PlankBurner(p.plank, p.usdg, usdgDecimals, p.weth, p.v2Router, p.ethUsd, p.plankUsd);
        d.credits = new FireCredits(deployer, address(d.cards), p.suggestionPaper);
        d.sale = new FireSale(FireSale.Config({
            owner: p.owner, paper: p.paper, plank: p.plank, usdg: p.usdg, weth: p.weth, press: p.press,
            packs: address(d.packs), cards: address(d.cards), ethUsd: p.ethUsd, plankUsd: p.plankUsd, paperUsd: p.paperUsd,
            router: p.v2Router, revenueWallet: p.revenueWallet, plankBurner: address(d.plankBurner), credits: address(d.credits)
        }));
        d.credits.setSale(address(d.sale)); // set once; it checks the sale points back here and sells the same cards
        require(address(d.credits.sale()) == address(d.sale) && d.sale.CREDITS() == address(d.credits), "credits wiring");
        require(d.sale.plankBurner() == address(d.plankBurner) && address(d.plankBurner.ROUTER()) == address(d.sale.ROUTER())
            && address(d.plankBurner.PLANK_USD()) == p.plankUsd && address(d.plankBurner.ETH_USD()) == p.ethUsd,
            "PlankBurner wiring");
        d.burner = new PaperBurner(deployer, p.paper, p.plank, p.usdg, usdgDecimals, p.weth, p.v2Router);
        d.burner.setFeeds(p.ethUsd, p.plankUsd, p.paperUsd);
        _setRoutes(d.burner, p);
        d.psa = new FirePsa(deployer, address(d.cards), address(d.burner));
        d.psaAdapter = new OpenVRFAdapter(p.router, address(d.psa));
        require(d.psaAdapter.FIRE() == address(d.psa), "PDA adapter points elsewhere");

        d.packs.setCards(address(d.cards));
        d.packs.setSeller(address(d.sale));
        d.cards.setSeller(address(d.sale));
        d.cards.setRandomness(address(d.adapter));
        d.cards.setPsa(address(d.psa));
        d.cards.setRenderer(address(d.renderer));
        d.psa.setRandomness(address(d.psaAdapter));
        d.packs.setDefaultRoyalty(p.royaltyTo, p.royaltyBps);
        d.cards.setDefaultRoyalty(p.royaltyTo, p.royaltyBps);
        if (bytes(p.packBase).length > 0) d.packs.setPackImageBase(p.packBase);

        d.packs.transferOwnership(p.owner);
        d.cards.transferOwnership(p.owner);
        d.dealer.transferOwnership(p.owner);
        d.credits.transferOwnership(p.owner);
        d.psa.transferOwnership(p.owner);
        d.burner.transferOwnership(p.owner);
    }

    /// @dev The burner's starting routes: straight to PAPER, or through PLANK (where most PAPER liquidity sits).
    function _setRoutes(PaperBurner b, Params memory p) internal {
        address[][] memory r = new address[][](2);
        r[0] = _path2(p.weth, p.paper);
        r[1] = _path3(p.weth, p.plank, p.paper);
        b.setRoutes(PaperBurner.Pay.ETH, r);
        r[0] = _path2(p.plank, p.paper);
        r[1] = _path3(p.plank, p.weth, p.paper);
        b.setRoutes(PaperBurner.Pay.PLANK, r);
        if (p.usdg != address(0)) {
            r[0] = _path3(p.usdg, p.weth, p.paper);
            r[1] = new address[](4);
            (r[1][0], r[1][1], r[1][2], r[1][3]) = (p.usdg, p.weth, p.plank, p.paper);
            b.setRoutes(PaperBurner.Pay.USDG, r);
        }
    }

    function _path2(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        (r[0], r[1]) = (a, b);
    }

    function _path3(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function check(Params memory p) public view {
        require(p.router.code.length > 0, "DRAND_ROUTER has no code on this chain");
        require(p.v2Router.code.length > 0, "V2_ROUTER has no code on this chain");
        require(p.paper.code.length > 0 && p.plank.code.length > 0 && p.weth.code.length > 0, "PAPER / PLANK / WETH missing");
        require(p.press.code.length > 0, "MILL (the press NFT) has no code on this chain");
        require(p.ethUsd.code.length > 0 && p.plankUsd.code.length > 0, "ETH_USD_FEED / PLANK_USD_FEED missing");
        require(p.usdg == address(0) || p.usdg.code.length > 0, "USDG has no code on this chain");
        require(p.paperUsd.code.length > 0, "PAPER_USD_FEED has no code on this chain");
        require(p.owner != address(0) && p.royaltyTo != address(0), "OWNER / ROYALTY_RECEIVER missing");
        require(p.owner.code.length > 0 || vm.envOr("ALLOW_EOA_OWNER", false), "OWNER should be a multisig (set ALLOW_EOA_OWNER=true to override)");
        require(p.revenueWallet != address(0), "REVENUE_WALLET must be set");
        require(p.royaltyBps <= 1000, "ROYALTY_BPS above 10%");

        // The randomness wiring is permanent: make sure DRAND_ROUTER returns a zero requestFee() like the
        // OpenDrandRouter (not, say, an adapter or the PAPER feed printed next to it).
        (bool ok, bytes memory ret) = p.router.staticcall(abi.encodeCall(ICardsDrandRouter.requestFee, ()));
        require(ok && ret.length == 32 && abi.decode(ret, (uint256)) == 0, "DRAND_ROUTER is not the OpenDrandRouter");
        // The price math assumes these decimals.
        require(IERC20Metadata(p.paper).decimals() == 18, "PAPER is not 18 decimals");
        require(IERC20Metadata(p.plank).decimals() == 18, "PLANK is not 18 decimals");
        require(ICardsFeed(p.ethUsd).decimals() == 8, "ETH_USD_FEED must have 8 decimals (Chainlink ETH/USD)");
        require(ICardsFeed(p.plankUsd).decimals() == 18, "PLANK_USD_FEED must be the 18-decimal PlankUsdTwap");
        require(ICardsFeed(p.paperUsd).decimals() == 18, "PAPER_USD_FEED must be the 18-decimal PaperUsdTwap");
        // the feeds must be built on this PAPER, this PLANK pool and this ETH/USD feed
        require(ICardsPlankTwap(p.plankUsd).ETH_USD() == p.ethUsd, "PLANK_USD_FEED uses a different ETH_USD_FEED");
        require(ICardsPaperTwap(p.paperUsd).PAPER() == p.paper, "PAPER_USD_FEED prices a different PAPER");
        require(ICardsPaperTwap(p.paperUsd).ETH_USD() == p.ethUsd, "PAPER_USD_FEED uses a different ETH_USD_FEED");
        require(ICardsPaperTwap(p.paperUsd).PLANK_USD() == p.plankUsd, "PAPER_USD_FEED uses a different PLANK_USD_FEED");
        address pair = ICardsPlankTwap(p.plankUsd).PAIR();
        address t0 = ICardsPair(pair).token0();
        address t1 = ICardsPair(pair).token1();
        require((t0 == p.plank && t1 == p.weth) || (t1 == p.plank && t0 == p.weth), "PLANK_USD_FEED is not on the PLANK/WETH pool");
        // the router must trade on the same WETH and the same PLANK pool the price comes from, or every burn swap
        // would quietly fail over to PlankBurner
        require(ICardsV2Router(p.v2Router).WETH() == p.weth, "V2_ROUTER uses a different WETH");
        require(ICardsV2Factory(ICardsV2Router(p.v2Router).factory()).getPair(p.plank, p.weth) == pair,
            "V2_ROUTER's factory doesn't own the PLANK_USD_FEED pool");
        // the PAPER price must come from the same tokens and the same factory, or it never finds the PAPER pools
        require(ICardsPaperTwap(p.paperUsd).PLANK() == p.plank, "PAPER_USD_FEED looks for a different PLANK");
        require(ICardsPaperTwap(p.paperUsd).WETH() == p.weth, "PAPER_USD_FEED uses a different WETH");
        require(ICardsPaperTwap(p.paperUsd).USDG() == p.usdg, "PAPER_USD_FEED uses a different USDG");
        require(ICardsPaperTwap(p.paperUsd).FACTORY() == ICardsV2Router(p.v2Router).factory(), "PAPER_USD_FEED reads a different factory");
    }
}
