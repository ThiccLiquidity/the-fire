// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness} from "../Mocks.sol";
import {InvRouter} from "./InvRouter.sol";

/// @dev Drives the whole card system (sale, packs, cards, PDA) with bounded random actions by several actors, and
///      keeps ghost accounting the invariant test checks against the contracts.
contract CardsHandler is Test {
    function _na() internal pure returns (FireSale.Access memory a) {
        a.proof = new bytes32[](0);
    }

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant BPS = 10_000;
    bytes32 constant DEALT = keccak256("CardDealt(uint256,uint256,uint256,uint256,bool,bool,uint256)");
    bytes32 constant GRADED = keccak256("Graded(uint256,uint256)");
    uint256 public constant FIRES = 5; // fires 1..5 are configured in the card contract

    // ---------------------------------------------------------------- system
    FireSale public sale;
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
    InvRouter public router;
    MockRandomness public cardRng;
    MockRandomness public psaRng;
    address public owner;
    address public revenue;
    address public burnW;

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
    uint256[3] public ghostPaid; // per currency (0 PLANK, 1 ETH, 2 USDG): what buyers paid
    uint256[3] public ghostBurnShare; // per currency: the burn share of what they paid
    mapping(uint256 => mapping(address => uint256)) public ghostPreLiftPaid;
    mapping(address => uint256) public ghostBurned;
    mapping(address => uint256) public ghostBurnCreditsUsed;
    mapping(uint256 => mapping(address => uint256)) public ghostPicks;
    mapping(uint256 => mapping(address => uint256)) public ghostPicksUsed;
    mapping(uint256 => mapping(address => bool)) public ghostStarterBy;
    mapping(uint256 => mapping(uint256 => bool)) public ghostPressUsed;
    mapping(uint256 => uint256[5]) internal _ghostMat;
    mapping(uint256 => uint256) public ghostCards;
    mapping(uint256 => uint256) public ghostGrade;
    mapping(uint256 => uint256) public ghostGradedTimes;

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
        dealer = new RecipeDealer(owner, address(cards));
        cardRng.setFire(address(cards));
        sale = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            press: address(press), packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(plankFeed), router: address(router), revenueWallet: revenue, burnWallet: burnW,
            paperPerSuggestion: 1e18
        }));
        psa = new FirePsa(owner, address(cards), address(paper), address(paperFeed));
        psaRng.setFire(address(psa));
        vm.startPrank(owner, owner);
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
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
        FireSale.DropConfig memory c = FireSale.DropConfig({start: uint64(time + 1), packs: 40, starters: 0, plankOnly: 0,
            walletLimit: 10, starterWindow: 0, liftAfter: 1 hours, plankBurnBps: 3_000, priceUsd: 250_000_000, paperPerPack: 1e18, holderWindow: 0, holderRoot: bytes32(0), maxPerTx: 0});
        vm.prank(owner, owner);
        sale.configureDrop(1, c);
        hasDrop[1] = true;
        dropFires.push(1);
        _setTime(time + 1);
        for (uint256 i; i < actors.length; i++) _buyPlank(actors[i], 1, 10);
        (, bool closed,,,,) = cards.fires(1);
        require(closed, "bootstrap: fire 1 not closed");
        for (uint256 i; i < actors.length; i++) _open(actors[i], 1, 10);
        while (_cardReqs.length > 0) _deliverCard(0, uint256(keccak256(abi.encode("boot", _cardReqs.length))));
        _process(type(uint256).max);
        require(cards.balanceOf(actors[0]) == 60, "bootstrap: cards");
        calls["bootstrapPacks"] = calls["packsChecked"];
        calls["packsChecked"] = 0;
        calls["buyWithPlank.ok"] = 0;
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
        dealer.setRecipe(fire, StandardRecipe.build(1));
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
                bool live = sale.phase(f).live;
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

    /// Two times in three, the most packs this buyer can take right now (so drops sell out); else a random 1..12.
    function _n(address a, uint256 fire, uint256 n) internal view returns (uint256) {
        if (n % 3 == 0) return bound(n, 1, 12);
        uint256 left = sale.phase(fire).paidLeft;
        FireSale.Drop memory d = sale.dropOf(fire);
        uint256 m = left < 12 ? left : 12;
        if (_preLift(fire)) {
            uint256 bought = sale.paidBought(fire, a);
            uint256 room = d.walletLimit > bought ? d.walletLimit - bought : 0;
            if (room < m) m = room;
        }
        return m == 0 ? 1 : m;
    }

    function _flag(string memory why) internal {
        if (bytes(violation).length == 0) violation = why;
    }

    function _preLift(uint256 fire) internal view returns (bool) {
        FireSale.Drop memory d = sale.dropOf(fire);
        return time < uint256(d.start) + d.liftAfter;
    }

    function _countPreLift(uint256 fire, address a, uint256 n, bool preLift) internal {
        if (!preLift) return;
        ghostPreLiftPaid[fire][a] += n;
        if (ghostPreLiftPaid[fire][a] > sale.dropOf(fire).walletLimit) _flag("wallet limit exceeded before liftAfter");
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

    function buyWithPlank(uint256 actorSeed, uint256 fireSeed, uint256 n) external at {
        calls["buyWithPlank"]++;
        address a = _actor(actorSeed);
        uint256 fire = _fire(fireSeed);
        _waitFor(fire, n);
        _buyPlank(a, fire, _n(a, fire, n));
    }

    function _buyPlank(address a, uint256 fire, uint256 n) internal {
        uint256 cost;
        try sale.quotePlank(fire, n) returns (uint256 c) { cost = c; } catch { return; }
        FireSale.Drop memory d = sale.dropOf(fire);
        bool preLift = _preLift(fire);
        uint256 bal = plank.balanceOf(a);
        vm.prank(a, a);
        try sale.buyWithPlank(fire, n, cost, type(uint256).max, _na()) {
            uint256 paid = bal - plank.balanceOf(a);
            if (paid != cost) _flag("PLANK paid != quote");
            ghostPaid[0] += paid;
            ghostBurnShare[0] += paid * d.plankBurnBps / BPS;
            ghostPaperBurned += n * d.paperPerPack;
            _countPreLift(fire, a, n, preLift);
            calls["buyWithPlank.ok"]++;
        } catch {}
    }

    function buyWithEth(uint256 actorSeed, uint256 fireSeed, uint256 n, uint256 extra) external at {
        calls["buyWithEth"]++;
        address a = _actor(actorSeed);
        uint256 fire = _fire(fireSeed);
        _waitFor(fire, n);
        n = _n(a, fire, n);
        uint256 cost;
        try sale.quoteEth(fire, n) returns (uint256 c) { cost = c; } catch { return; }
        FireSale.Drop memory d = sale.dropOf(fire);
        bool preLift = _preLift(fire);
        uint256 bal = a.balance;
        vm.prank(a, a);
        try sale.buyWithEth{value: cost + bound(extra, 0, 1 ether)}(fire, n, type(uint256).max, _na()) {
            uint256 paid = bal - a.balance;
            if (paid != cost) _flag("ETH paid != quote (refund)");
            ghostPaid[1] += paid;
            ghostBurnShare[1] += paid * d.plankBurnBps / BPS;
            ghostPaperBurned += n * d.paperPerPack;
            _countPreLift(fire, a, n, preLift);
            calls["buyWithEth.ok"]++;
        } catch {}
    }

    function buyWithUsdg(uint256 actorSeed, uint256 fireSeed, uint256 n) external at {
        calls["buyWithUsdg"]++;
        address a = _actor(actorSeed);
        uint256 fire = _fire(fireSeed);
        _waitFor(fire, n);
        n = _n(a, fire, n);
        uint256 cost = sale.quoteUsdg(fire, n);
        FireSale.Drop memory d = sale.dropOf(fire);
        bool preLift = _preLift(fire);
        uint256 bal = usdg.balanceOf(a);
        vm.prank(a, a);
        try sale.buyWithUsdg(fire, n, cost, type(uint256).max, _na()) {
            uint256 paid = bal - usdg.balanceOf(a);
            if (paid != cost) _flag("USDG paid != quote");
            ghostPaid[2] += paid;
            ghostBurnShare[2] += paid * d.plankBurnBps / BPS;
            ghostPaperBurned += n * d.paperPerPack;
            _countPreLift(fire, a, n, preLift);
            calls["buyWithUsdg.ok"]++;
        } catch {}
    }

    function claimStarter(uint256 pressSeed, uint256 fireSeed, bool asOwner, uint256 actorSeed) external at {
        calls["claimStarter"]++;
        uint256 pid = pressIds[pressSeed % pressIds.length];
        address a = asOwner ? press.ownerOf(pid) : _actor(actorSeed);
        uint256 fire = _fire(fireSeed);
        uint256 per = sale.dropOf(fire).paperPerPack;
        vm.prank(a, a);
        try sale.claimStarter(fire, pid, type(uint256).max) {
            if (ghostStarterBy[fire][a]) _flag("two starters for one wallet");
            if (ghostPressUsed[fire][pid]) _flag("one press used twice");
            ghostStarterBy[fire][a] = true;
            ghostPressUsed[fire][pid] = true;
            ghostPaperBurned += per;
            calls["claimStarter.ok"]++;
        } catch {}
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
            if (sale.credits(_actor(actorSeed % 64 + i)) > 0) { a = _actor(actorSeed % 64 + i); break; }
        }
        n = bound(n, 1, 3);
        uint256 per = sale.dropOf(fire).paperPerPack;
        vm.prank(a, a);
        try sale.useCredits(fire, n, type(uint256).max) {
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
        try sale.burnCards(ids) {
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
        sale.suggest("A fox made of embers");
        ghostPaperBurned += 1e18;
    }

    // ================================================================ owner

    function configureDrop(
        uint256 fireSeed,
        uint256 startIn,
        uint256 nPacks,
        uint256 starters,
        uint256 plankOnly,
        uint256 limit,
        uint256 lift,
        uint256 window,
        uint256 bps,
        uint256 price,
        uint256 ppp
    ) external at {
        calls["configureDrop"]++;
        uint256 fire = 2 + fireSeed % (FIRES - 1);
        FireSale.DropConfig memory c;
        c.start = uint64(time + bound(startIn, 1, 2 hours));
        c.packs = uint32(bound(nPacks, 1, 16));
        c.starters = uint32(bound(starters, 0, 4));
        c.plankOnly = plankOnly % 2 == 0 ? 0 : uint32(bound(plankOnly, 0, c.packs));
        c.walletLimit = uint32(bound(limit, 1, 6));
        c.liftAfter = uint32(lift % 4 == 0 ? 48 hours : bound(lift, 1 hours, 8 hours));
        c.starterWindow = uint32(bound(window, c.starters > 0 ? 1 : 0, c.liftAfter));
        c.plankBurnBps = uint16(bps % 3 == 0 ? 3_000 : bound(bps, 0, BPS));
        c.priceUsd = uint128(bound(price, 1e6, 1e10)); // 1 cent .. $100
        c.paperPerPack = uint128(bound(ppp, 1, 3e18));
        vm.prank(owner, owner);
        try sale.configureDrop(fire, c) {
            if (!hasDrop[fire]) { hasDrop[fire] = true; dropFires.push(fire); }
            calls["configureDrop.ok"]++;
        } catch {}
    }

    function pickSuggestions(uint256 fireSeed, uint256 k) external at {
        calls["pickSuggestions"]++;
        uint256 fire = _fire(fireSeed);
        uint256 total = sale.suggestionCount();
        if (total == 0) return;
        bool fresh = sale.sessionFire() != fire || sale.currentRound() == 0;
        uint32 round = fresh ? sale.currentRound() : sale.sessionRound();
        k = bound(k, 1, 3);
        uint256[] memory buf = new uint256[](k);
        uint256 got;
        for (uint256 i; i < total && got < k; i++) {
            (,, bool granted, uint32 r) = sale.suggestions(i);
            if (!granted && r == round) buf[got++] = i;
        }
        if (got == 0) return;
        uint256[] memory ids = new uint256[](got);
        for (uint256 i; i < got; i++) ids[i] = buf[i];
        vm.prank(owner, owner);
        try sale.pickSuggestions(fire, ids) {
            for (uint256 i; i < got; i++) {
                (address by,,,) = sale.suggestions(ids[i]);
                ghostPicks[fire][by] += 1;
            }
            calls["pickSuggestions.ok"]++;
        } catch {}
    }

    function setOdds(uint256 fireSeed, uint256 seed) external at {
        uint256 fire = 1 + fireSeed % FIRES;
        uint64[10] memory odds;
        uint256 left = 10_000;
        for (uint256 g; g < 9; g++) {
            uint256 o = uint256(keccak256(abi.encode(seed, g))) % (left + 1);
            odds[g] = uint64(o);
            left -= o;
        }
        odds[9] = uint64(left);
        vm.prank(owner, owner);
        try psa.setOdds(fire, odds) { calls["setOdds.ok"]++; } catch {}
    }

    /// The Series' Diamond setting (small numbers, so it often exceeds the pack count and the cap kicks in): a new
    ///    Standard recipe, which only works until the Series' first pack.
    function setDiamonds(uint256 fireSeed, uint256 n) external at {
        calls["setDiamonds"]++;
        uint256 fire = 2 + fireSeed % (FIRES - 1);
        n = bound(n, 1, 20);
        vm.prank(owner, owner);
        try dealer.setRecipe(fire, StandardRecipe.build(n)) {
            diamondsOf[fire] = n;
            calls["setDiamonds.ok"]++;
        } catch {}
    }

    /// The Diamond setting each Series was last given (1 by default).
    mapping(uint256 => uint256) public diamondsOf;

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
        uint256 n = cards.process(max);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(cards) || logs[i].topics[0] != DEALT) continue;
            seen++;
            uint256 openIndex = uint256(logs[i].topics[1]);
            (uint256 fire, uint256 cardType,,,) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            if (inPack == 0) { _packOpen = openIndex; _packFire = fire; }
            if (openIndex != _packOpen || fire != _packFire) _flag("a pack's cards span opens or Fires");
            if (cardType > 4) _flag("card type out of range");
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

    function _checkPack(uint256[6] memory mats) internal {
        uint256 p; uint256 w; uint256 b;
        for (uint256 k; k < 6; k++) {
            if (mats[k] == 0) p++;
            else if (mats[k] == 1) w++;
            else b++;
        }
        if (p < 3) _flag("pack with fewer than 3 Paper");
        if (p > 3) _flag("pack with more than 3 Paper");
        if (w < 1) _flag("pack with no Wood");
        if (b < 1) _flag("pack with no Fire-or-better");
        calls["packsChecked"]++;
    }

    function ghostMat(uint256 fire, uint256 m) external view returns (uint256) { return _ghostMat[fire][m]; }

    // ================================================================ PDA

    function reveal(uint256 actorSeed, uint256 k, uint256 seed) external at {
        calls["reveal"]++;
        address a = _actor(actorSeed);
        uint256[] memory ids = _owned(a, bound(k, 1, 10), seed, true);
        if (ids.length == 0) return;
        uint256 per = psa.paperPerReveal();
        vm.prank(a, a);
        try psa.reveal(ids, per * ids.length) {
            _psaReqs.push(psaRng.last());
            ghostPaperBurned += per * ids.length;
            calls["reveal.ok"]++;
        } catch {
            _flag("reveal of own ungraded cards reverted");
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
        uint256 n = psa.revealCount();
        if (n == 0) return;
        uint256 s0 = seed % n;
        for (uint256 j; j < n; j++) {
            uint256 idx = (s0 + j) % n;
            FirePsa.Reveal memory r = psa.revealOf(idx);
            if (!r.ready || r.done) continue;
            vm.recordLogs();
            psa.finish(idx);
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
