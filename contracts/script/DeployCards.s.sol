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
import {LiquidityBurner} from "../src/cards/LiquidityBurner.sol";
import {FireCredits} from "../src/cards/FireCredits.sol";
import {FireGroups} from "../src/cards/FireGroups.sol";
import {FireProfiles} from "../src/cards/FireProfiles.sol";
import {FireGames} from "../src/cards/FireGames.sol";
import {FireMarket} from "../src/cards/FireMarket.sol";
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
 *   Series from its recipe), FireSale (the pack sale), FireGroups (each drop's groups: who can buy, how many, when;
 *   only FireSale writes to it, no owner), FireCredits (free pack credits, card burning, suggestions),
 *   LiquidityBurner (every sale's liquidity share, each pack's PAPER, case and grading fees, suggestions and game
 *   entries: paired into PAPER/PLANK liquidity and burned, docs/liquidity-burn.md), FirePsa (cases and PDA grading),
 *   and a drand adapter for each of FireCards and FirePsa. Also FireProfiles (names and profile pictures; no owner) and FireMarket (cards and packs for sale; no owner, no fees;
 *   on an older deploy, add it with script/DeployMarket.s.sol). On a deploy made before it existed, add it
 *   on its own with script/DeployProfiles.s.sol. And FireGames (the game room's run entries, docs/paper-football.md):
 *   it adds paper football as game 1 (1 PAPER a run, fixed forever) and FireCredits allows prizes for game 1, but
 *   leaves the server's `signer` and the `series` unset, so paid play stays closed until the owner sets both.
 *   FireCredits' prizeAwarder stays unset too (the owner sets the game server's wallet).
 * Checks every input before sending anything.
 *
 *   forge script script/DeployCards.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --slow --broadcast \
 *     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
 *
 * The deployer is a throwaway hot wallet (Foundry keystore: cast wallet import deployer --interactive) that only pays
 * gas. Never --private-key.
 *
 * Settings (.env.example, card contracts section):
 *   DRAND_ROUTER      the OpenDrandRouter from DeployInfra.s.sol (it has no owner)
 *   OWNER             the hardware wallet (Ledger or Trezor) that will own everything. Afterwards it calls
 *                     acceptOwnership() on FirePacks, FireCards, RecipeDealer, FireCredits, FireSale, FirePsa,
 *                     LiquidityBurner and FireGames (Ownable2Step), all eight in one run of script/AcceptOwnership.s.sol
 *                     signed on the device, so a mistyped OWNER owns nothing (the deployer still does). FireGroups
 *                     has no owner.
 *                     Must not be the deployer.
 *   EXPECTED_CHAIN_ID the chain it must run on (default 4663, Robinhood Chain; set it for a rehearsal)
 *   ROYALTY_RECEIVER, ROYALTY_BPS (500 = 5%, max 1000)
 *   PACK_IMAGE_BASE   folder of the pack art (fire<N>.webp); can be set later
 *   PAPER, PLANK, USDG, WETH, MILL (the Paper Press NFT: recorded for the studio's Press-holder groups and ops/snapshot;
 *                     a drop's NFT groups name their collection themselves)
 *   ETH_USD_FEED      Chainlink ETH/USD; PLANK_USD_FEED the PlankUsdTwap (DeployTwap.s.sol); PAPER_USD_FEED the PaperUsdTwap (DeployInfra.s.sol),
 *                     never the PAPER pool itself. Both feeds must be built on this PAPER/PLANK and ETH_USD_FEED.
 *   V2_ROUTER         Uniswap V2 router (LiquidityBurner's buys and its PAPER/PLANK liquidity; its factory must already
 *                     have the PAPER/PLANK pool; LiquidityBurner averages that pool's own price over 30 minutes
 *                     for its guards, starting at deploy, so its first run can go 30 minutes after it)
 *   REVENUE_WALLET    gets the rest of every sale after the drop's liquidity shares
 *   KEEPERS           the keeper wallets (main and backup, comma-separated), allowed to run LiquidityBurner. Optional:
 *                     the owner can add them later (LiquidityBurner.setKeeper).
 *   SUGGESTION_PAPER  PAPER wei per character suggestion to start (default 1e18 = 1 PAPER; 0 = free). The owner can
 *                     change it later (FireCredits.setSuggestionRules). Every other sale number is set per drop.
 *
 * DRAND_ROUTER, PLANK_USD_FEED and PAPER_USD_FEED are read from deployments/<chainId>.json (written by steps 1 and 2)
 * when not set. When it broadcasts it adds every contract it deployed (and its inputs) to that file; VerifyDeploy.s.sol
 * then checks the result.
 *
 * Left for the owner afterwards, per Series (script/ConfigureSeries.s.sol builds these calls from the studio's recipe
 * JSON): RecipeDealer.setRecipe and setCharacters (appendCharacters for long lists), FireCards.setDealer and
 * setImagesBase, then FireSale.configureDrop from the JSON's "sale" block (which locks the
 * Series); and FireCredits.pickSuggestions.
 */
contract DeployCards is Deployments {
    /// @notice Paper football's FireGames id and entry (1 PAPER a run, docs/paper-football.md decision 13).
    uint256 public constant PAPER_FOOTBALL = 1;
    uint256 public constant PAPER_FOOTBALL_ENTRY = 1e18;
    /// @dev ...but never more than $0.10 of PAPER (8 decimals), fixed with the game (owner, Oct 27).
    uint256 public constant PAPER_FOOTBALL_CAP_USD = 10_000_000;

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
        LiquidityBurner liquidity;
        FireCredits credits;
        FireGroups groups;
        FireProfiles profiles;
        FireGames games;
        FireMarket market;
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
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(4663)), "not Robinhood Chain (4663; EXPECTED_CHAIN_ID for a rehearsal)");
        check(p);
        require(p.owner != msg.sender, "OWNER is the deployer: use a throwaway deployer and the hardware wallet as OWNER");

        address[] memory keepers = vm.envOr("KEEPERS", ",", new address[](0));
        vm.startBroadcast();
        d = deploy(p, msg.sender);
        // the deployer still owns LiquidityBurner until the owner accepts: let the keepers run it
        for (uint256 i; i < keepers.length; i++) d.liquidity.setKeeper(keepers[i], true);
        vm.stopBroadcast();
        if (keepers.length == 0) console.log("KEEPERS not set: the owner adds them with LiquidityBurner.setKeeper");

        console.log("FirePacks  ", address(d.packs));
        console.log("FireCards  ", address(d.cards));
        console.log("RecipeDealer", address(d.dealer));
        console.log("FireSale   ", address(d.sale));
        console.log("FireCredits", address(d.credits));
        console.log("FireGroups ", address(d.groups));
        console.log("FireProfiles", address(d.profiles));
        console.log("FireGames  ", address(d.games));
        console.log("FireMarket ", address(d.market));
        console.log("FirePsa    ", address(d.psa));
        console.log("LiquidityBurner", address(d.liquidity));
        console.log("CardsRenderer", address(d.renderer));
        console.log("RecipeCompiler", address(d.compiler));
        console.log("Adapter (cards)", address(d.adapter));
        console.log("Adapter (PDA)  ", address(d.psaAdapter));
        console.log("Next: the OWNER hardware wallet accepts the eight contracts: script/AcceptOwnership.s.sol --ledger (or --trezor).");
        _recordCards(d, p);
    }

    function _recordCards(Deployed memory d, Params memory p) internal {
        string[] memory names = new string[](18);
        address[] memory addrs = new address[](18);
        (names[0], addrs[0]) = ("FirePacks", address(d.packs));
        (names[1], addrs[1]) = ("FireCards", address(d.cards));
        (names[2], addrs[2]) = ("CardsRenderer", address(d.renderer));
        (names[3], addrs[3]) = ("RecipeDealer", address(d.dealer));
        (names[4], addrs[4]) = ("RecipeCompiler", address(d.compiler));
        (names[5], addrs[5]) = ("FireCredits", address(d.credits));
        (names[6], addrs[6]) = ("FireSale", address(d.sale));
        (names[7], addrs[7]) = ("LiquidityBurner", address(d.liquidity));
        (names[8], addrs[8]) = ("FirePsa", address(d.psa));
        (names[9], addrs[9]) = ("CardsAdapter", address(d.adapter));
        (names[10], addrs[10]) = ("PsaAdapter", address(d.psaAdapter));
        (names[11], addrs[11]) = ("OpenDrandRouter", p.router);
        (names[12], addrs[12]) = ("PlankUsdTwap", p.plankUsd);
        (names[13], addrs[13]) = ("PaperUsdTwap", p.paperUsd);
        (names[14], addrs[14]) = ("FireGroups", address(d.groups));
        (names[15], addrs[15]) = ("FireProfiles", address(d.profiles));
        (names[16], addrs[16]) = ("FireGames", address(d.games));
        (names[17], addrs[17]) = ("FireMarket", address(d.market));
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
        d.credits = new FireCredits(deployer, address(d.cards), p.suggestionPaper);
        address lpPair = ICardsV2Factory(ICardsV2Router(p.v2Router).factory()).getPair(p.paper, p.plank);
        d.liquidity = new LiquidityBurner(deployer, p.paper, p.plank, p.usdg, usdgDecimals, p.weth, p.v2Router, lpPair);
        d.liquidity.setFeeds(p.ethUsd, p.plankUsd, p.paperUsd);
        _setRoutes(d.liquidity, p);
        d.groups = new FireGroups();
        d.sale = new FireSale(FireSale.Config({
            owner: deployer, paper: p.paper, plank: p.plank, usdg: p.usdg, weth: p.weth,
            packs: address(d.packs), cards: address(d.cards), ethUsd: p.ethUsd, plankUsd: p.plankUsd, paperUsd: p.paperUsd,
            router: p.v2Router, revenueWallet: p.revenueWallet, liquidity: address(d.liquidity), credits: address(d.credits), groups: address(d.groups)
        }));
        d.credits.setSale(address(d.sale)); // set once; it checks the sale points back here and sells the same cards
        require(address(d.credits.sale()) == address(d.sale) && d.sale.CREDITS() == address(d.credits), "credits wiring");
        d.groups.setSale(address(d.sale)); // set once, by the deployer; it checks the sale points back here
        require(d.groups.sale() == address(d.sale) && address(d.sale.GROUPS()) == address(d.groups), "groups wiring");
        require(d.sale.liquidity() == address(d.liquidity) && address(d.liquidity.ROUTER()) == address(d.sale.ROUTER())
            && address(d.liquidity.plankUsd()) == p.plankUsd && address(d.liquidity.ethUsd()) == p.ethUsd
            && address(d.liquidity.paperUsd()) == p.paperUsd && address(d.liquidity.PAIR()) == lpPair, "LiquidityBurner wiring");
        d.psa = new FirePsa(deployer, address(d.cards), address(d.liquidity));
        d.psaAdapter = new OpenVRFAdapter(p.router, address(d.psa));
        require(d.psaAdapter.FIRE() == address(d.psa), "PDA adapter points elsewhere");
        d.profiles = new FireProfiles(address(d.cards)); // names and profile pictures; no owner
        d.market = new FireMarket(address(d.cards), address(d.packs), p.weth); // cards and packs for sale; no owner, no fees
        // the game room: paper football is game 1 at 1 PAPER a run (fixed forever), with prizes allowed in FireCredits.
        // signer and series stay 0, so paid play is closed until the owner sets both; the prizeAwarder stays unset.
        d.games = new FireGames(deployer, p.paper, address(d.liquidity));
        d.games.addGame(PAPER_FOOTBALL, PAPER_FOOTBALL_ENTRY, PAPER_FOOTBALL_CAP_USD);
        d.games.setPaperFeed(p.paperUsd);
        d.credits.setPrizeGame(PAPER_FOOTBALL, true);
        // game prizes can include free cases and gradings: FirePsa takes coupons only from FireCredits (both set once)
        d.psa.setCouponIssuer(address(d.credits));
        d.credits.setPsa(address(d.psa));
        require(d.psa.couponIssuer() == address(d.credits) && address(d.credits.psa()) == address(d.psa), "coupons wiring");
        require(address(d.games.PAPER()) == p.paper && d.games.LIQUIDITY() == address(d.liquidity) && d.games.entryOf(PAPER_FOOTBALL) == PAPER_FOOTBALL_ENTRY
            && d.games.capUsdOf(PAPER_FOOTBALL) == PAPER_FOOTBALL_CAP_USD && address(d.games.paperUsd()) == p.paperUsd
            && d.games.signer() == address(0) && d.games.series() == 0 && d.credits.prizeGame(PAPER_FOOTBALL)
            && d.credits.prizeAwarder() == address(0), "games wiring");

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
        d.sale.transferOwnership(p.owner);
        d.psa.transferOwnership(p.owner);
        d.liquidity.transferOwnership(p.owner);
        d.games.transferOwnership(p.owner);
    }

    /// @dev LiquidityBurner's starting routes. PAPER: straight, or through PLANK (where most PAPER liquidity sits).
    ///      PLANK: straight from WETH (its deepest pool). PLANK only ever buys PAPER.
    function _setRoutes(LiquidityBurner b, Params memory p) internal {
        address[][] memory r = new address[][](2);
        r[0] = _path2(p.weth, p.paper);
        r[1] = _path3(p.weth, p.plank, p.paper);
        b.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PAPER, r);
        r[0] = _path2(p.plank, p.paper);
        r[1] = _path3(p.plank, p.weth, p.paper);
        b.setRoutes(LiquidityBurner.Pay.PLANK, LiquidityBurner.Side.PAPER, r);
        address[][] memory one = new address[][](1);
        one[0] = _path2(p.weth, p.plank);
        b.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PLANK, one);
        if (p.usdg != address(0)) {
            r[0] = _path3(p.usdg, p.weth, p.paper);
            r[1] = new address[](4);
            (r[1][0], r[1][1], r[1][2], r[1][3]) = (p.usdg, p.weth, p.plank, p.paper);
            b.setRoutes(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PAPER, r);
            one[0] = _path3(p.usdg, p.weth, p.plank);
            b.setRoutes(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PLANK, one);
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
        // the router must trade on the same WETH and the same PLANK pool the price comes from, or LiquidityBurner's
        // buys would never pass their price check
        require(ICardsV2Router(p.v2Router).WETH() == p.weth, "V2_ROUTER uses a different WETH");
        require(ICardsV2Factory(ICardsV2Router(p.v2Router).factory()).getPair(p.plank, p.weth) == pair,
            "V2_ROUTER's factory doesn't own the PLANK_USD_FEED pool");
        require(ICardsV2Factory(ICardsV2Router(p.v2Router).factory()).getPair(p.paper, p.plank) != address(0),
            "V2_ROUTER's factory has no PAPER/PLANK pool for the liquidity");
        // the PAPER price must come from the same tokens and the same factory, or it never finds the PAPER pools
        require(ICardsPaperTwap(p.paperUsd).PLANK() == p.plank, "PAPER_USD_FEED looks for a different PLANK");
        require(ICardsPaperTwap(p.paperUsd).WETH() == p.weth, "PAPER_USD_FEED uses a different WETH");
        require(ICardsPaperTwap(p.paperUsd).USDG() == p.usdg, "PAPER_USD_FEED uses a different USDG");
        require(ICardsPaperTwap(p.paperUsd).FACTORY() == ICardsV2Router(p.v2Router).factory(), "PAPER_USD_FEED reads a different factory");
    }
}
