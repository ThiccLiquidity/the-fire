// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";
import {FireGroups} from "../../src/cards/FireGroups.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness, MockBurner} from "../Mocks.sol";
import {InvRouter} from "./InvRouter.sol";

/// @dev Drives the whole card system (sale, packs, cards, PDA) with bounded random actions by several actors, and
///      keeps ghost accounting the invariant test checks against the contracts.
contract CardsHandler is Test {

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant BPS = 10_000;
    bytes32 constant DEALT = keccak256("CardDealt(uint256,uint256,uint256,uint256,bool,bool,uint256)"); // fire, serial indexed
    bytes32 constant GRADED = keccak256("Graded(uint256,uint256)");
    uint256 public constant FIRES = 5; // fires 1..5 are configured in the card contract

    // ---------------------------------------------------------------- system
    FireSale public sale;
    FireGroups public groups;
    FireCredits public credits;
    FirePacks public packs;
    FireCards public cards;
    RecipeDealer public dealer;
    FirePsa public psa;
    MockERC20 public paper;
    MockERC20 public plank;
    MockUSDG public usdg;
    MockMill public press;
    MockFeed public ethFeed;
    MockFeed public plankFeed;
    MockFeed public paperFeed;
    MockBurner public burner;
    InvRouter public router;
    MockRandomness public cardRng;
    MockRandomness public psaRng;
    address public owner;
    address public revenue;
    address public burnW;
    address public paperW = address(0xBA9E5);

    address[] public actors;
    uint256[] public pressIds;
    uint256[] public dropFires; // fires with a drop configured (each once)
    mapping(uint256 => bool) public hasDrop;

    // ---------------------------------------------------------------- environment
    uint256 public time;
    int256 public ethPx = 3_333e8;
    int256 public plankPx = 1e9;
    int256 public paperPx = 0.05e18;
    bool public routerPumped;

    // ---------------------------------------------------------------- initial balances (per actor)
    uint256 public constant PAPER0 = 1_000_000e18;
    uint256 public constant PLANK0 = 1e40;
    uint256 public constant USDG0 = 1e15;
    uint256 public constant ETH0 = 1_000_000 ether;

    // ---------------------------------------------------------------- ghosts
    uint256 public ghostPaperBurned; // PAPER every successful action should have burned, by the rules
    uint256 public ghostProtectEth; // ETH paid for cases and grades (all of it goes to the burner)
    uint256[3] public ghostPaid; // per currency (0 PLANK, 1 ETH, 2 USDG): what buyers paid
    uint256[3] public ghostBurnShare; // per currency: the burn share of what they paid
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public ghostBoughtIn; // fire, group, wallet
    mapping(address => uint256) public ghostBurned;
    mapping(address => uint256) public ghostBurnCreditsUsed;
    mapping(uint256 => mapping(address => uint256)) public ghostPicks;
    mapping(uint256 => mapping(address => uint256)) public ghostPicksUsed;
    mapping(uint256 => uint256[6]) internal _ghostMat;
    mapping(uint256 => uint256) public ghostCards;
    mapping(uint256 => uint256) public ghostGrade;
    mapping(uint256 => uint256) public ghostGradedTimes;
    mapping(uint256 => uint256[]) internal _gradingIds; // the cards of each grading (FirePsa keeps only their hash)

    uint256[] internal _cardReqs; // card randomness requests not yet delivered
    uint256[] internal _psaReqs; // PDA randomness requests not yet delivered
    uint256 public revealsFinished;

    // violations seen during actions (checked by the invariant test)
    string public violation;

    mapping(string => uint256) public calls;

    constructor() {
        owner = address(0xA11CE0);
        revenue = address(0xBEEF);
        burnW = address(0xB0B);
        time = 1_800_000_000;
        vm.warp(time);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        press = new MockMill(address(plank), 0);
        ethFeed = new MockFeed(ethPx);
        plankFeed = new MockFeed(plankPx);
        paperFeed = new MockFeed(paperPx);
        router = new InvRouter(plank, _perEth(), _perUsdg());
        cardRng = new MockRandomness();
        psaRng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        cardRng.setFire(address(cards));
        credits = new FireCredits(owner, address(cards), 1e18);
        groups = new FireGroups();
        sale = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(plankFeed), paperUsd: address(0), router: address(router), revenueWallet: revenue, plankBurner: burnW, paperBurner: paperW, credits: address(credits),
            groups: address(groups)
        }));
        groups.setSale(address(sale));
        burner = new MockBurner(address(plank), address(usdg));
        psa = new FirePsa(owner, address(cards), address(burner));
        psaRng.setFire(address(psa));
        vm.startPrank(owner, owner);
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        credits.setSale(address(sale));
        cards.setRandomness(address(cardRng));
        cards.setPsa(address(psa));
        psa.setRandomness(address(psaRng));
        vm.stopPrank();
        for (uint256 f = 1; f <= FIRES; f++) _configureCards(f, 2 + f % 3);

        for (uint256 i; i < 4; i++) {
            address u = address(uint160(0xA000 + i));
            actors.push(u);
            paper.mint(u, PAPER0);
            plank.mint(u, PLANK0);
            usdg.mint(u, USDG0);
            vm.deal(u, ETH0);
            vm.startPrank(u, u);
            paper.approve(address(sale), type(uint256).max);
            paper.approve(address(psa), type(uint256).max);
            plank.approve(address(sale), type(uint256).max);
            usdg.approve(address(sale), type(uint256).max);
            vm.stopPrank();
            pressIds.push(press.mint(u));
            if (i < 2) pressIds.push(press.mint(u)); // two actors hold a second press
        }
    }

    // ================================================================ bootstrap (not a target)

    /// @dev Fire 1 sells out to the actors (10 packs each) and is opened and dealt, so everyone starts with 60 cards.
    function bootstrap() external {
        FireSale.DropConfig memory c;
        c.start = uint64(time + 1);
        c.packs = 40;
        c.plankBurnBps = 3_000;
        c.paperCapUsd = 1e8;
        c.regularWalletsFor = 1 hours;
        c.creditsPerPick = 1;
        c.groups = new FireGroups.Group[](1);
        c.groups[0] = _openGroup(40, 250_000_000, 1e18);
        c.groups[0].perWallet = 10;
        vm.prank(owner, owner);
        sale.configureDrop(1, c);
        hasDrop[1] = true;
        dropFires.push(1);
        _setTime(time + 1);
        for (uint256 i; i < actors.length; i++) _buy(actors[i], 1, 0, 10, FireSale.Pay.PLANK, 0);
        (, bool closed,,,,) = cards.fires(1);
        require(closed, "bootstrap: fire 1 not closed");
        for (uint256 i; i < actors.length; i++) _open(actors[i], 1, 10);
        while (_cardReqs.length > 0) _deliverCard(0, uint256(keccak256(abi.encode("boot", _cardReqs.length))));
        _process(type(uint256).max);
        require(cards.balanceOf(actors[0]) == 60, "bootstrap: cards");
        calls["bootstrapPacks"] = calls["packsChecked"];
        calls["packsChecked"] = 0;
        calls["buy.ok"] = 0;
        calls["open.ok"] = 0;
    }

    // ================================================================ helpers

    modifier at() {
        vm.warp(time);
        _;
    }

    function _configureCards(uint256 fire, uint256 n) internal {
        string[] memory names = new string[](n);
        string[] memory cats = new string[](n);
        for (uint256 i; i < n; i++) { names[i] = string.concat("Char", vm.toString(i)); cats[i] = string.concat("Cat ", vm.toString(i)); }
        vm.startPrank(owner, owner);
        dealer.setRecipe(fire, StandardRecipe.build());
        dealer.setCharacters(fire, names, cats);
        cards.setDealer(fire, address(dealer));
        cards.setImagesBase(fire, "ipfs://x/");
        vm.stopPrank();
    }

    function _perEth() internal view returns (uint256) { return uint256(ethPx) * 1e10 / uint256(plankPx); }
    function _perUsdg() internal view returns (uint256) { return 1e30 / uint256(plankPx); }

    function _setRouterRates() internal {
        uint256 e = _perEth();
        uint256 u = _perUsdg();
        if (routerPumped) { e = e * 85 / 100; u = u * 85 / 100; }
        router.setRates(e, u);
    }

    function _refreshFeeds() internal {
        ethFeed.set(ethPx);
        plankFeed.set(plankPx);
        paperFeed.set(paperPx);
    }

    function _setTime(uint256 t) internal {
        time = t;
        vm.warp(t);
    }

    function _actor(uint256 seed) internal view returns (address) { return actors[seed % actors.length]; }

    /// A Fire with a drop; three times in four, a live one if there is any.
    function _fire(uint256 seed) internal view returns (uint256) {
        uint256 n = dropFires.length;
        if (n == 0) return 1 + seed % FIRES;
        if (seed % 4 != 0) {
            for (uint256 j; j < n; j++) {
                uint256 f = dropFires[(seed / 4 + j) % n];
                bool live = sale.status(f).live;
                if (live) return f;
            }
        }
        return dropFires[(seed / 4) % n];
    }

    /// Buyers waiting for a drop that hasn't opened yet: half the time, jump to its start (feeds kept fresh).
    function _waitFor(uint256 fire, uint256 seed) internal {
        uint256 st = sale.dropOf(fire).start;
        if (seed % 2 == 0 && st > time) {
            _setTime(st);
            _refreshFeeds();
        }
    }

    /// Two times in three, the most packs this buyer can take from the group right now (so drops sell out); else a
    /// random 1..12.
    function _n(address a, uint256 fire, uint256 g, uint256 n) internal view returns (uint256) {
        if (n % 3 == 0) return bound(n, 1, 12);
        if (g >= groups.groupCount(fire)) return 1;
        uint256 left = groups.openLeft(fire, g);
        uint256 m = left < 12 ? left : 12;
        uint256 per = groups.groupOf(fire, g).perWallet;
        if (per != 0) {
            uint256 bought = groups.boughtIn(fire, g, a);
            uint256 room = per > bought ? per - bought : 0;
            if (room < m) m = room;
        }
        return m == 0 ? 1 : m;
    }

    function _flag(string memory why) internal {
        if (bytes(violation).length == 0) violation = why;
    }

    /// An open group: anyone, `price` and `ppp` PAPER a pack, any coin, opens with the drop, until sold.
    function _openGroup(uint64 n, uint128 price, uint128 ppp) internal pure returns (FireGroups.Group memory g) {
        g.packs = n;
        g.coins = 7;
        g.afterGroup = 255;
        g.rollTo = 255;
        g.priceUsd = price;
        g.paper = ppp;
    }

    /// The press ids `a` holds now (the NFT gate's access).
    function _pressAccess(address a) internal view returns (FireGroups.Access memory acc) {
        uint256[] memory buf = new uint256[](pressIds.length);
        uint256 k;
        for (uint256 i; i < pressIds.length; i++) if (press.ownerOf(pressIds[i]) == a) buf[k++] = pressIds[i];
        acc.nftIds = new uint256[](k);
        for (uint256 i; i < k; i++) acc.nftIds[i] = buf[i];
    }

    /// Up to `k` serials owned by `a`, from a random start. `forReveal`: only ungraded, not pending.
    function _owned(address a, uint256 k, uint256 seed, bool forReveal) internal view returns (uint256[] memory ids) {
        uint256 total = cards.nextSerial() - 1;
        uint256[] memory buf = new uint256[](k);
        uint256 got;
        if (total == 0) return new uint256[](0);
        uint256 s0 = seed % total;
        for (uint256 j; j < total && got < k; j++) {
            uint256 s = (s0 + j) % total + 1;
            (bool exists,, uint256 grade) = cards.gradeInfo(s);
            if (!exists || cards.ownerOf(s) != a) continue;
            if (forReveal && (grade != 0 || psa.pending(s))) continue;
            buf[got++] = s;
        }
        ids = new uint256[](got);
        for (uint256 i; i < got; i++) ids[i] = buf[i];
    }

    // ================================================================ buying

    function buyWithPlank(uint256 actorSeed, uint256 fireSeed, uint256 groupSeed, uint256 n) external at {
        calls["buyWithPlank"]++;
        _buyFrom(actorSeed, fireSeed, groupSeed, n, FireSale.Pay.PLANK, 0);
    }

    function buyWithEth(uint256 actorSeed, uint256 fireSeed, uint256 groupSeed, uint256 n, uint256 extra) external at {
        calls["buyWithEth"]++;
        _buyFrom(actorSeed, fireSeed, groupSeed, n, FireSale.Pay.ETH, bound(extra, 0, 1 ether));
    }

    function buyWithUsdg(uint256 actorSeed, uint256 fireSeed, uint256 groupSeed, uint256 n) external at {
        calls["buyWithUsdg"]++;
        _buyFrom(actorSeed, fireSeed, groupSeed, n, FireSale.Pay.USDG, 0);
    }

    /// A press holder (or anyone) claims from the drop's first NFT-gated group with the presses it holds.
    function claimPress(uint256 pressSeed, uint256 fireSeed, bool asOwner, uint256 actorSeed) external at {
        calls["claimPress"]++;
        uint256 pid = pressIds[pressSeed % pressIds.length];
        address a = asOwner ? press.ownerOf(pid) : _actor(actorSeed);
        uint256 fire = _fire(fireSeed);
        uint256 count = groups.groupCount(fire);
        for (uint256 g; g < count; g++) {
            if (groups.groupOf(fire, g).gate != FireGroups.Gate.NFT) continue;
            _buy(a, fire, g, 1, FireSale.Pay.PLANK, 0);
            return;
        }
    }

    function _buyFrom(uint256 actorSeed, uint256 fireSeed, uint256 groupSeed, uint256 n, FireSale.Pay pay, uint256 extra) internal {
        address a = _actor(actorSeed);
        uint256 fire = _fire(fireSeed);
        _waitFor(fire, n);
        uint256 count = groups.groupCount(fire);
        uint256 g = count == 0 ? 0 : groupSeed % count;
        _buy(a, fire, g, _n(a, fire, g, n), pay, extra);
    }

    struct Buy {
        address a;
        uint256 fire;
        uint256 g;
        uint256 n;
        FireSale.Pay pay;
        uint256 cost;
        uint256 openLeft;
        uint256 bal;
    }

    /// One purchase, checked against the rules from outside: the quote is what's charged, the group was open with
    /// that many left, its wallet limit and NFT allowances hold.
    function _buy(address a, uint256 fire, uint256 g, uint256 n, FireSale.Pay pay, uint256 extra) internal {
        if (g >= groups.groupCount(fire)) return;
        Buy memory b = Buy(a, fire, g, n, pay, 0, groups.openLeft(fire, g), _balance(a, pay));
        try sale.quote(fire, g, n, pay) returns (uint256 c, uint256) { b.cost = c; } catch { return; }
        FireGroups.Access memory acc = _pressAccess(a);
        vm.prank(a, a);
        try sale.buy{value: pay == FireSale.Pay.ETH ? b.cost + extra : extra}(fire, g, n, pay, b.cost, type(uint256).max, acc) {
            _bought(b, acc);
        } catch {}
    }

    function _bought(Buy memory b, FireGroups.Access memory acc) internal {
        FireGroups.Group memory G = groups.groupOf(b.fire, b.g);
        uint256 paid = b.bal - _balance(b.a, b.pay);
        if (paid != b.cost) _flag("paid != quote (or the refund is off)");
        if (b.n > b.openLeft) _flag("bought more than the group had open");
        if (G.priceUsd != 0 && G.coins & (1 << uint8(b.pay)) == 0) _flag("paid in a coin the group doesn't take");
        ghostBoughtIn[b.fire][b.g][b.a] += b.n;
        if (G.perWallet != 0 && ghostBoughtIn[b.fire][b.g][b.a] > G.perWallet) _flag("group wallet limit exceeded");
        if (G.gate == FireGroups.Gate.NFT) {
            if (acc.nftIds.length == 0) _flag("NFT group sold to a wallet with no NFT");
            for (uint256 i; i < acc.nftIds.length; i++) {
                if (groups.usedWith(b.fire, b.g, acc.nftIds[i]) > G.perNft) _flag("an NFT used past its allowance");
            }
        }
        ghostPaid[uint8(b.pay)] += paid;
        ghostBurnShare[uint8(b.pay)] += paid * sale.dropOf(b.fire).plankBurnBps / BPS;
        ghostPaperBurned += b.n * G.paper;
        calls["buy.ok"]++;
    }

    function _balance(address a, FireSale.Pay pay) internal view returns (uint256) {
        return pay == FireSale.Pay.PLANK ? plank.balanceOf(a) : pay == FireSale.Pay.ETH ? a.balance : usdg.balanceOf(a);
    }

    function passPress(uint256 pressSeed, uint256 toSeed) external at {
        uint256 pid = pressIds[pressSeed % pressIds.length];
        address from = press.ownerOf(pid);
        address to = _actor(toSeed);
        if (from == to) return;
        vm.prank(from, from);
        press.transferFrom(from, to, pid);
    }

    function useCredits(uint256 actorSeed, uint256 fireSeed, uint256 n) external at {
        calls["useCredits"]++;
        uint256 fire = _fire(fireSeed);
        address a = _actor(actorSeed);
        for (uint256 i; i < actors.length; i++) {
            if (credits.credits(_actor(actorSeed % 64 + i)) > 0) { a = _actor(actorSeed % 64 + i); break; }
        }
        n = bound(n, 1, 3);
        uint8 cg = sale.dropOf(fire).creditGroup;
        uint256 per = cg < groups.groupCount(fire) ? groups.groupOf(fire, cg).paper : 0;
        vm.prank(a, a);
        try credits.useCredits(fire, n, type(uint256).max) {
            ghostBurnCreditsUsed[a] += n; // all credits (burn and picked) are one pool now
            ghostPaperBurned += n * per;
            calls["useCredits.ok"]++;
        } catch {}
    }

    // ================================================================ cards, suggestions

    function burnCards(uint256 actorSeed, uint256 k, uint256 seed) external at {
        calls["burnCards"]++;
        address a = _actor(actorSeed);
        uint256[] memory ids = _owned(a, bound(k, 1, 30), seed, false);
        if (ids.length == 0) return;
        vm.prank(a, a);
        try credits.burnCards(ids) {
            ghostBurned[a] += ids.length;
            calls["burnCards.ok"]++;
        } catch {
            _flag("burnCards of own cards reverted");
        }
    }

    function suggest(uint256 actorSeed) external at {
        calls["suggest"]++;
        address a = _actor(actorSeed);
        vm.prank(a, a);
        credits.suggest("A fox made of embers", type(uint256).max);
        ghostPaperBurned += 1e18;
    }

    // ================================================================ owner

    /// A drop of 1 to 3 groups: maybe a press group first (PAPER only, timed, leftovers on or nowhere), an open group
    /// with random coins, wallet limit and timing, and an until-sold group after it.
    function configureDrop(
        uint256 fireSeed,
        uint256 startIn,
        uint256 nPacks,
        uint256 shape,
        uint256 limit,
        uint256 window,
        uint256 bps,
        uint256 price,
        uint256 ppp
    ) external at {
        calls["configureDrop"]++;
        uint256 fire = 2 + fireSeed % (FIRES - 1);
        uint256 count = 1 + shape % 3;
        FireSale.DropConfig memory c;
        c.start = uint64(time + bound(startIn, 1, 2 hours));
        c.plankBurnBps = uint16(bps % 3 == 0 ? 3_000 : bound(bps, 0, BPS));
        c.regularWalletsFor = uint32(window % 4 == 0 ? 0 : bound(window, 1 hours, 48 hours));
        c.creditsPerPick = 1;
        c.creditGroup = uint8(shape / 3 % 4 == 3 ? 255 : (shape / 3 % 4) % count);
        c.groups = new FireGroups.Group[](count);
        uint64 total;
        for (uint256 i; i < count; i++) {
            uint256 seed = uint256(keccak256(abi.encode(shape, nPacks, i)));
            FireGroups.Group memory g = _openGroup(uint64(bound(seed, i == 0 ? 1 : 0, 8)), uint128(bound(price, 1e6, 1e10)), uint128(bound(ppp, 1, 3e18)));
            if (i == 0 && count > 1 && seed % 2 == 0) {
                g.gate = FireGroups.Gate.NFT; // press holders: PAPER only
                g.nft = address(press);
                g.perNft = uint32(1 + seed % 2);
                g.priceUsd = 0;
                g.coins = 0;
            } else {
                g.coins = uint8(1 + (seed >> 8) % 7);
                g.perWallet = uint32(bound(limit, 0, 6));
            }
            if (i + 1 < count) {
                g.duration = uint32(bound(seed >> 16, 1 hours, 8 hours));
                g.rollTo = (seed >> 24) % 3 == 0 ? 255 : uint8(i + 1 + (seed >> 32) % (count - i - 1));
            }
            if (i > 0 && (seed >> 40) % 2 == 0) g.afterGroup = uint8(i - 1);
            if ((seed >> 48) % 4 == 0) g.startDelay = uint32(bound(seed >> 56, 0, 2 hours));
            total += g.packs;
            c.groups[i] = g;
        }
        c.packs = total;
        vm.prank(owner, owner);
        try sale.configureDrop(fire, c) {
            if (!hasDrop[fire]) { hasDrop[fire] = true; dropFires.push(fire); }
            calls["configureDrop.ok"]++;
        } catch {}
    }

    function pickSuggestions(uint256 fireSeed, uint256 k) external at {
        calls["pickSuggestions"]++;
        uint256 fire = _fire(fireSeed);
        uint256 total = credits.suggestionCount();
        if (total == 0) return;
        bool fresh = credits.sessionFire() != fire || credits.currentRound() == 0;
        uint32 round = fresh ? credits.currentRound() : credits.sessionRound();
        k = bound(k, 1, 3);
        uint256[] memory buf = new uint256[](k);
        uint256 got;
        for (uint256 i; i < total && got < k; i++) {
            (,, bool granted, uint32 r) = credits.suggestions(i);
            if (!granted && r == round) buf[got++] = i;
        }
        if (got == 0) return;
        uint256[] memory ids = new uint256[](got);
        for (uint256 i; i < got; i++) ids[i] = buf[i];
        vm.prank(owner, owner);
        try credits.pickSuggestions(fire, ids) {
            for (uint256 i; i < got; i++) {
                (address by,,,) = credits.suggestions(ids[i]);
                ghostPicks[fire][by] += 1;
            }
            calls["pickSuggestions.ok"]++;
        } catch {}
    }

    /// A new recipe for a Series (the Standard recipe with another Full Art weight), which only works until the
    ///    Series' first pack.
    function setRecipe(uint256 fireSeed, uint256 n) external at {
        calls["setRecipe"]++;
        uint256 fire = 2 + fireSeed % (FIRES - 1);
        RecipeDealer.Recipe memory r = StandardRecipe.build();
        r.types[StandardRecipe.FULL_ART].weight = uint64(bound(n, 1, 5_000));
        vm.prank(owner, owner);
        try dealer.setRecipe(fire, r) {
            calls["setRecipe.ok"]++;
        } catch {}
    }

    function endDrop(uint256 fireSeed) external at {
        calls["endDrop"]++;
        vm.prank(owner, owner);
        try sale.endDrop(_fire(fireSeed)) { calls["endDrop.ok"]++; } catch {}
    }

    function closeSoldOut(uint256 fireSeed) external at {
        try sale.close(_fire(fireSeed)) { calls["close.ok"]++; } catch {}
    }

    // ================================================================ opening

    function open(uint256 actorSeed, uint256 fireSeed, uint256 count) external at {
        calls["open"]++;
        // the first actor (from a random one) holding sealed packs of a closed Fire
        for (uint256 i; i < actors.length; i++) {
            address a = _actor(actorSeed % 64 + i);
            for (uint256 j; j < FIRES; j++) {
                uint256 fire = 1 + (fireSeed % FIRES + j) % FIRES;
                uint256 bal = packs.balanceOf(a, fire);
                (, bool closed,,,,) = cards.fires(fire);
                if (bal == 0 || !closed) continue;
                _open(a, fire, bound(count, 1, bal < 10 ? bal : 10));
                return;
            }
        }
    }

    function _open(address a, uint256 fire, uint256 count) internal {
        vm.prank(a, a);
        try cards.open(fire, count) {
            _cardReqs.push(cardRng.last());
            calls["open.ok"]++;
        } catch {}
    }

    function deliverCards(uint256 pick, uint256 word) external at {
        calls["deliverCards"]++;
        if (_cardReqs.length == 0) return;
        _deliverCard(pick % _cardReqs.length, word);
    }

    function _deliverCard(uint256 i, uint256 word) internal {
        uint256 id = _cardReqs[i];
        _cardReqs[i] = _cardReqs[_cardReqs.length - 1];
        _cardReqs.pop();
        cardRng.fulfill(id, word);
    }

    /// Any number of cards per call, so packs are often split across calls.
    function process(uint256 max) external at {
        calls["process"]++;
        _process(bound(max, 1, 40));
    }

    /// The site's keeper: delivers every outstanding word (in a random order) and deals everything.
    function keeper(uint256 seed) external at {
        calls["keeper"]++;
        while (_cardReqs.length > 0) {
            seed = uint256(keccak256(abi.encode(seed)));
            _deliverCard(seed % _cardReqs.length, seed);
        }
        _process(type(uint256).max);
    }

    // a pack being dealt across process calls
    uint256[6] internal _mats;
    uint256 public inPack;
    uint256 internal _packOpen;
    uint256 internal _packFire;

    function _process(uint256 max) internal {
        vm.recordLogs();
        uint256 n;
        for (uint256 f = 1; f <= FIRES && n < max; f++) n += cards.process(f, max - n);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(cards) || logs[i].topics[0] != DEALT) continue;
            seen++;
            uint256 fire = uint256(logs[i].topics[1]);
            (uint256 openIndex, uint256 cardType,,,) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            if (inPack == 0) { _packOpen = openIndex; _packFire = fire; }
            if (openIndex != _packOpen || fire != _packFire) _flag("a pack's cards span opens or Fires");
            if (cardType > 5) _flag("card type out of range");
            _mats[inPack++] = cardType;
            _ghostMat[fire][cardType] += 1;
            ghostCards[fire] += 1;
            if (inPack == 6) {
                _checkPack(_mats);
                inPack = 0;
            }
        }
        if (seen != n || n > max) _flag("process count is off");
    }

    /// Straight odds: no per-pack guarantees to check, only that every card is a Standard type (done per card).
    function _checkPack(uint256[6] memory mats) internal {
        for (uint256 k; k < 6; k++) if (mats[k] > 5) _flag("card type out of range");
        calls["packsChecked"]++;
    }

    function ghostMat(uint256 fire, uint256 m) external view returns (uint256) { return _ghostMat[fire][m]; }

    // ================================================================ PDA

    function reveal(uint256 actorSeed, uint256 k, uint256 seed) external at {
        calls["reveal"]++;
        address a = _actor(actorSeed);
        uint256[] memory ids = _owned(a, bound(k, 1, 10), seed, true);
        if (ids.length == 0) return;
        uint256 cost = psa.quote(0, ids.length, FirePsa.Pay.ETH);
        vm.prank(a, a);
        try psa.protect{value: cost}(new uint256[](0), ids, FirePsa.Pay.ETH, cost) returns (uint256 index) {
            _gradingIds[index] = ids;
            ghostProtectEth += cost;
            _psaReqs.push(psaRng.last());
            calls["reveal.ok"]++;
        } catch {
            _flag("grading own ungraded cards reverted");
        }
    }

    /// Case some of an actor's ungraded, uncased cards (their wear freezes for good).
    function caseCards(uint256 actorSeed, uint256 k, uint256 seed) external at {
        calls["case"]++;
        address a = _actor(actorSeed);
        uint256[] memory ids = _owned(a, bound(k, 1, 5), seed, true);
        uint256 m;
        for (uint256 i; i < ids.length; i++) {
            (,,, bool cased,,) = cards.wearOf(ids[i]);
            if (!cased) ids[m++] = ids[i];
        }
        if (m == 0) return;
        assembly { mstore(ids, m) }
        uint256 cost = psa.quote(m, 0, FirePsa.Pay.ETH);
        vm.prank(a, a);
        try psa.protect{value: cost}(ids, new uint256[](0), FirePsa.Pay.ETH, cost) {
            ghostProtectEth += cost;
            calls["case.ok"]++;
            for (uint256 i; i < m; i++) {
                (,,, bool cased,,) = cards.wearOf(ids[i]);
                if (!cased) _flag("a cased card isn't cased");
            }
        } catch {
            _flag("casing own uncased cards reverted");
        }
    }

    function deliverPsa(uint256 pick, uint256 word) external at {
        calls["deliverPsa"]++;
        if (_psaReqs.length == 0) return;
        uint256 i = pick % _psaReqs.length;
        uint256 id = _psaReqs[i];
        _psaReqs[i] = _psaReqs[_psaReqs.length - 1];
        _psaReqs.pop();
        psaRng.fulfill(id, word);
    }

    function finish(uint256 seed) external at {
        calls["finish"]++;
        uint256 n = psa.gradingCount();
        if (n == 0) return;
        uint256 s0 = seed % n;
        for (uint256 j; j < n; j++) {
            uint256 idx = (s0 + j) % n;
            FirePsa.Grading memory r = psa.gradingOf(idx);
            if (!r.ready || r.done) continue;
            vm.recordLogs();
            psa.finish(idx, _gradingIds[idx]);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 i; i < logs.length; i++) {
                if (logs[i].emitter != address(psa) || logs[i].topics[0] != GRADED) continue;
                uint256 serial = uint256(logs[i].topics[1]);
                uint256 g = abi.decode(logs[i].data, (uint256));
                if (g == 0 || g > 10) _flag("grade out of 1..10");
                if (ghostGradedTimes[serial]++ > 0) _flag("grade set twice");
                ghostGrade[serial] = g;
            }
            revealsFinished++;
            calls["finish.ok"]++;
            return;
        }
    }

    function setPaperPrice(uint256 px) external at {
        paperPx = int256(bound(px, 1e15, 1e18)); // $0.001 .. $1
        paperFeed.set(paperPx);
    }

    /// The grade can never be one the rules say is impossible: below 5 for a card that spent under a month uncased.
    function checkGradeFloor(uint256 serial) external view returns (bool ok) {
        (bool exists,, uint256 grade,, uint256 age,) = cards.wearOf(serial);
        if (!exists || grade == 0) return true;
        return grade >= 5 || age > 31 days;
    }

    // ================================================================ transfers

    /// Try to move a card; a card waiting for its grade must never move.
    function transferCard(uint256 serialSeed, uint256 toSeed, bool preferPending) external at {
        calls["transferCard"]++;
        uint256 total = cards.nextSerial() - 1;
        if (total == 0) return;
        uint256 s = serialSeed % total + 1;
        if (preferPending) {
            for (uint256 j; j < total; j++) {
                uint256 t = (serialSeed % total + j) % total + 1;
                (bool ex,,) = cards.gradeInfo(t);
                if (ex && cards.gradePending(t)) { s = t; break; }
            }
        }
        (bool exists,,) = cards.gradeInfo(s);
        if (!exists) return;
        address from = cards.ownerOf(s);
        address to = _actor(toSeed);
        if (from == to) to = _actor(toSeed % 64 + 1);
        bool wasPending = cards.gradePending(s);
        vm.prank(from, from);
        try cards.transferFrom(from, to, s) {
            if (wasPending) _flag("a pending card was transferred");
            calls["transferCard.ok"]++;
        } catch {
            if (!wasPending) _flag("a plain transfer reverted");
            else calls["transferCard.blocked"]++;
        }
    }

    // ================================================================ environment

    function warp(uint256 dt) external at {
        calls["warp"]++;
        bool refresh = dt % 8 != 1; // now and then the feeds go stale
        _setTime(time + (dt % 5 == 0 ? bound(dt, 12 hours, 3 days) : bound(dt, 0, 3 hours)));
        if (refresh) _refreshFeeds();
    }

    function setPrices(uint256 e, uint256 p) external at {
        calls["setPrices"]++;
        ethPx = int256(bound(e, 100e8, 10_000e8));
        plankPx = int256(bound(p, 1e8, 1e10));
        _refreshFeeds();
        _setRouterRates();
    }

    function routerMood(bool fail, bool pumped) external at {
        calls["routerMood"]++;
        router.setFail(fail);
        routerPumped = pumped;
        _setRouterRates();
    }

    // ================================================================ views for the invariant test

    function actorCount() external view returns (uint256) { return actors.length; }
    function dropFireCount() external view returns (uint256) { return dropFires.length; }
    function cardReqsLeft() external view returns (uint256) { return _cardReqs.length; }
}
