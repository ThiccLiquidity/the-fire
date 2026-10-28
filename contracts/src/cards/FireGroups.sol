// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

interface IGroupsSale {
    function GROUPS() external view returns (address);
}

/**
 * @title FireGroups
 * @notice The groups of each drop (docs/drop-groups.md): who can buy, how many, at what price, when, and where unsold
 *         packs go. Split out of FireSale for contract size: FireSale keeps payments, minting, pricing and closing,
 *         and is the only contract that can write here (set once at deploy). No owner.
 *
 *         A drop's total packs are split into 1 to 6 groups. Each group:
 *         - `gate`: OPEN (anyone), NFT (holders of one ERC-721, checked live; `perNft` packs per NFT id per drop, so
 *           an NFT passed around never buys again once its allowance is used) or SNAPSHOT (a Merkle proof of
 *           (wallet, allowance), double-hashed like OpenZeppelin's StandardMerkleTree of ["address","uint256"]).
 *         - `priceUsd` (8 decimals; 0 = none) in the `coins` it accepts (PLANK = 1, ETH = 2, USDG = 4), and/or `paper`
 *           per pack (PAPER wei, capped by the drop's dollar ceiling in FireSale). Both 0 = free.
 *         - `perWallet` (0 = no limit), on top of the gate's own allowance. `limitFor` (0 = the whole time): the
 *           per-wallet limit only applies for this long after the group opened; then a wallet buys as many as it
 *           likes (perTx, maxPerTx and the gate still apply). Needs a perWallet.
 *         - Timing: it opens `startDelay` after the drop's start (`afterGroup` = NONE) or after group `afterGroup`
 *           ends (a lower index); it ends when its packs are gone for good, or `duration` after it opened
 *           (0 = until its packs are gone), whichever is first.
 *         - `rollTo`: where its unsold packs go when it ends: a higher group (added to its capacity) or NONE (never
 *           made: the Series closes smaller).
 *         - `idle` (0 = off): it also ends once no pack has sold in it for `idle` seconds (counted from when it
 *           opened, then from each sale), exactly as if its duration had run out. `perTx`: most packs per purchase.
 *         - `unlimited`: no pack count at all (an "after sell-out" group): it sells until nobody has bought for `idle`
 *           (or its duration runs out). Needs a rising tax and `idle`, rolls nowhere, and adds on top of the total.
 *         - `taxBps` (0 = off), a rising tax: the k-th pack sold in the group (k = 1 for its first) costs
 *           priceUsd * (1 + taxBps/10000)^k. The base price splits like any sale; the tax above it all goes to
 *           LiquidityBurner (FireSale). Its capacity is its own packs (nothing may roll into it).
 *         - `plankBurnBps` / `paperBurnBps`: how its dollar payments split (FireSale): both shares go to
 *           LiquidityBurner in the coin paid (it pairs PAPER with PLANK and burns the liquidity; the two names are
 *           kept from when they burned PLANK and PAPER apart), the rest to the revenue wallet. Together at most 100%,
 *           so a group can send everything it takes to liquidity (10000 together).
 *
 *         "Gone for good": a group whose packs are all sold ends the moment its last pack goes, unless a group that
 *         rolls into it is still open or yet to open (more packs may still arrive), in which case it ends when the
 *         last of those has ended with nothing to pass on. So a sold-out group's leftovers-to-be still sell.
 *
 *         Everything is computed from the config, the start, and each group's sold count and last sale time: nothing
 *         has to be poked when a group's time runs out. Packs that can still sell = the unsold packs of every group
 *         that hasn't ended; when that reaches 0 the Series closes (FireSale).
 */
contract FireGroups {
    uint8 public constant NONE = 255;
    uint256 public constant MAX_GROUPS = 6;
    /// @dev Longest a group's delay or duration may be, so every timed group always ends.
    uint256 public constant MAX_WINDOW = 30 days;
    /// @dev Most a group's rising tax may be per pack (50%), and most any pack's price may be of its base price
    ///      (r^k <= 1e9), so the maths never overflows. A safety bound, not a sales cap: at 4% it's pack ~528, by
    ///      which point a $2.50 pack costs ~$2.5 billion. A finite taxed group must fit it; an unlimited one refuses
    ///      buys past it (PriceTooHigh) and simply idles out.
    uint256 public constant MAX_TAX_BPS = 5_000;
    uint256 public constant MAX_TAX_GROWTH = 1e9;
    /// @dev Basis points in 100%: a group's two burn shares together are at most this.
    uint256 public constant BPS = 10_000;
    /// @dev An unlimited group's capacity, internally (its sold count is 64-bit). Views show it as type(uint256).max.
    uint256 internal constant UNLIMITED = type(uint64).max;
    uint8 public constant PLANK = 1;
    uint8 public constant ETH = 2;
    uint8 public constant USDG = 4;

    enum Gate { OPEN, NFT, SNAPSHOT }

    /// @notice One group, as the owner sets it (FireSale.DropConfig.groups).
    struct Group {
        uint64 packs; // its own packs (leftovers rolled in come on top)
        Gate gate;
        uint8 coins; // accepted for the dollar price: PLANK 1 | ETH 2 | USDG 4 (ETH includes buyWithEthAll)
        uint8 afterGroup; // NONE = opens with the drop; else opens when that (lower) group ends
        uint8 rollTo; // NONE = unsold packs are never made; else a higher group gets them
        uint32 startDelay; // seconds after the drop's start / the group before it ends
        uint32 duration; // longest it stays open, seconds (0 = until its packs are gone)
        uint32 perWallet; // most packs one wallet takes in this group (0 = no limit)
        uint32 limitFor; // perWallet only applies this long after the group opened, seconds (0 = the whole time)
        uint32 perNft; // NFT gate: packs per NFT id per drop
        uint16 taxBps; // rising tax (0 = off): the k-th pack sold costs priceUsd * (1 + taxBps/10000)^k; the part
        // above priceUsd is the tax and all of it buys and burns PAPER. Needs a price; no group may roll into it
        uint16 plankBurnBps; // with paperBurnBps: the share of this group's dollar payments that goes to LiquidityBurner
        uint16 paperBurnBps; // (1000 + 2000 = 30%); the two together are at most 10000 (100%); the rest goes to the
        // revenue wallet. The rising tax is apart: all of it goes to LiquidityBurner
        uint128 priceUsd; // dollars per pack, 8 decimals (0 = no dollar price)
        uint128 paper; // PAPER wei per pack (0 = none)
        address nft; // NFT gate: the ERC-721
        uint32 idle; // ends once no pack has sold in it for this long (from opening, then from each sale); 0 = off
        uint32 perTx; // most packs in one purchase in this group (0 = the drop's maxPerTx); credits ignore it
        bool unlimited; // no pack count (packs must be 0): needs taxBps and idle (so the price caps demand and it
        // always ends on its own), and rolls nowhere. It adds on top of the drop's total
        bytes32 root; // SNAPSHOT gate: Merkle root of (wallet, allowance) leaves
    }

    /// @notice How a buyer shows it may buy in a gated group: NFT ids it holds (NFT gate), or its allowance and a
    ///         Merkle proof (SNAPSHOT gate). Ignored by OPEN groups.
    struct Access {
        uint256[] nftIds;
        uint256 allowance;
        bytes32[] proof;
    }

    enum State { UPCOMING, OPEN, ENDED }

    /// @notice A group for the site: its config and where it stands now.
    struct GroupView {
        Group config;
        State state;
        uint256 capacity; // its packs + leftovers rolled in from groups that have ended (unlimited: type(uint256).max)
        uint256 sold; // packs taken from it (bought, free and credit packs)
        uint256 left; // capacity - sold (what it can still sell, or passed on once it has ended)
        uint256 opensAt; // when it opened / opens (for an upcoming group: at the latest; 0 = when the group before
        // it, which runs until sold, sells out)
        uint256 endsAt; // when it ended, or ends if nothing more sells (duration, or idle since its last sale; 0 =
        // until its packs are gone)
        uint256 limitUntil; // when its per-wallet limit lifts (opensAt + limitFor; 0 = no timer, or not known yet)
    }

    struct Sched {
        uint64 start;
        uint8 count;
        uint64[6] sold;
        uint64[6] lastSaleAt;
    }

    /// @dev Group timing worked out for now, by index (lower groups first: they only depend on lower ones).
    struct Calc {
        uint256[6] opensAt;
        uint256[6] endsAt;
        uint256[6] cap;
        bool[6] ended;
        uint256[6] rollersOpen; // groups that may still roll packs into this one (not ended, or passing on)
        uint256[6] rollersEnd; // the latest end of those that have
        uint256 left; // packs that can still sell, all finite groups
        bool unlimitedOpen; // an unlimited group hasn't ended: no end to what can still sell
    }

    /// @notice The only writer (FireSale), set once by the deployer.
    address public sale;
    address public immutable DEPLOYER;

    mapping(uint256 fire => Sched) internal sched;
    mapping(uint256 fire => Group[6]) internal groups;
    /// @notice Packs a wallet took in a group (bought or free; credit packs aren't counted).
    mapping(uint256 fire => mapping(uint256 group => mapping(address => uint256))) public boughtIn;
    /// @notice Packs taken with an NFT id in an NFT-gated group, whoever held it.
    mapping(uint256 fire => mapping(uint256 group => mapping(uint256 id => uint256))) public usedWith;

    event SaleSet(address sale);

    error NotSale();
    error AlreadySet();
    error BadConfig();
    error BadGroup(uint256 index);
    error GroupNotOpen();
    error SoldOut();
    error WalletLimit();
    error NotAllowed();
    error NftUsed();
    error CoinNotAccepted();
    error PerTxLimit();
    error PriceTooHigh();

    constructor() {
        DEPLOYER = msg.sender;
    }

    /// @notice The sale, once, by the deployer. It must point back here.
    function setSale(address s) external {
        if (msg.sender != DEPLOYER) revert NotSale();
        if (sale != address(0)) revert AlreadySet();
        if (s == address(0) || IGroupsSale(s).GROUPS() != address(this)) revert BadConfig();
        sale = s;
        emit SaleSet(s);
    }

    modifier onlySale() {
        if (msg.sender != sale) revert NotSale();
        _;
    }

    // ================================================================ FireSale

    /// @notice Set (or, before the drop opens, reset: FireSale checks that) a drop's groups. Reverts BadConfig for the
    ///         drop as a whole (1 to 6 groups, their packs adding up to `total` (unlimited groups have none: they add
    ///         on top), a valid `creditGroup`, which is neither taxed nor unlimited) and
    ///         BadGroup(i) for a group that's wrong.
    function configure(uint256 fire, uint64 start, uint64 total, Group[] calldata gs, uint8 creditGroup) external onlySale {
        uint256 n = gs.length;
        if (n == 0 || n > MAX_GROUPS || (creditGroup != NONE && creditGroup >= n)) revert BadConfig();
        uint256 sum;
        for (uint256 i; i < n; i++) {
            Group calldata g = gs[i];
            _check(g, i, n);
            if (g.rollTo != NONE && gs[g.rollTo].taxBps != 0) revert BadGroup(i); // a taxed group's packs are fixed
            sum += g.packs;
            groups[fire][i] = g;
        }
        if (sum != total || total == 0) revert BadConfig();
        // free packs come from a fixed, untaxed group: they never move a taxed price or mint on top of the total
        if (creditGroup != NONE && (gs[creditGroup].taxBps != 0 || gs[creditGroup].unlimited)) revert BadConfig();
        Sched storage s = sched[fire];
        s.start = start;
        s.count = uint8(n);
    }

    /// @dev One group's rules: indices point the right way (so there are no cycles), every time is bounded, a price
    ///      has a coin, its two burn shares together are at most 100%, the gate has what it needs and nothing it doesn't, and free packs are never open to all.
    function _check(Group calldata g, uint256 i, uint256 n) internal view {
        bool ok = (g.afterGroup == NONE || g.afterGroup < i) && (g.rollTo == NONE || (g.rollTo > i && g.rollTo < n))
            && g.startDelay <= MAX_WINDOW && g.duration <= MAX_WINDOW && g.idle <= MAX_WINDOW && g.coins <= 7
            && (g.priceUsd == 0 || g.coins != 0) && g.limitFor <= MAX_WINDOW && (g.limitFor == 0 || g.perWallet != 0)
            && uint256(g.plankBurnBps) + g.paperBurnBps <= BPS;
        if (g.gate == Gate.OPEN) ok = ok && g.nft == address(0) && g.perNft == 0 && g.root == 0 && (g.priceUsd | g.paper) != 0;
        else if (g.gate == Gate.NFT) ok = ok && g.nft.code.length > 0 && g.perNft != 0 && g.root == 0;
        else ok = ok && g.root != 0 && g.nft == address(0) && g.perNft == 0;
        if (g.taxBps != 0) {
            ok = ok && g.taxBps <= MAX_TAX_BPS && g.priceUsd != 0
                && (g.unlimited || _growthOk(1e18 + uint256(g.taxBps) * 1e14, g.packs));
        }
        // unlimited: always ends on its own (idle), its price caps demand (tax), and no endless leftovers to pass on
        if (g.unlimited) ok = ok && g.packs == 0 && g.taxBps != 0 && g.idle != 0 && g.rollTo == NONE;
        if (!ok) revert BadGroup(i);
    }

    /// @notice Take `n` packs from group `g` for `buyer`, paying in `coin` (PLANK 1, ETH 2, USDG 4): the group must
    ///         be open with `n` left, take that coin (if it has a dollar price), and let the buyer in (gate, wallet
    ///         limit). Returns the dollar price of these packs (8 decimals) and its rising tax part, the group's PAPER
    ///         per pack, the packs that can still sell after these (0: the Series is done), and the group's PLANK and
    ///         PAPER burn shares (basis points) for FireSale's split.
    function take(uint256 fire, uint256 g, address buyer, uint256 n, uint8 coin, Access calldata a)
        external
        onlySale
        returns (uint256 usd8, uint256 tax8, uint256 paper, uint256 left, uint256 plankBps, uint256 paperBps)
    {
        (usd8, tax8, paper, left) = _take(fire, g, buyer, n, coin, a);
        Group storage G = groups[fire][g];
        (plankBps, paperBps) = (G.plankBurnBps, G.paperBurnBps);
    }

    function _take(uint256 fire, uint256 g, address buyer, uint256 n, uint8 coin, Access calldata a)
        internal
        returns (uint256 usd8, uint256 tax8, uint256 paper, uint256 left)
    {
        uint256 sold;
        uint256 opens;
        (left, sold, opens) = _takeFrom(fire, g, n);
        Group storage G = groups[fire][g];
        (usd8, tax8) = _price(G, sold, n);
        paper = G.paper;
        if (usd8 != 0 && G.coins & coin == 0) revert CoinNotAccepted();
        if (G.perTx != 0 && n > G.perTx) revert PerTxLimit();
        _admit(fire, g, G, buyer, n, a, opens);
    }

    /// @dev The gate and the wallet limit (until `limitFor` after the group opened at `opens`); counts the buyer's
    ///      packs.
    function _admit(uint256 fire, uint256 g, Group storage G, address buyer, uint256 n, Access calldata a, uint256 opens)
        internal
    {
        uint256 mine = boughtIn[fire][g][buyer] + n;
        uint256 lf = G.limitFor;
        if (G.perWallet != 0 && mine > G.perWallet && (lf == 0 || block.timestamp < opens + lf)) revert WalletLimit();
        Gate gate = G.gate;
        if (gate == Gate.SNAPSHOT) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(buyer, a.allowance))));
            if (!MerkleProof.verifyCalldata(a.proof, G.root, leaf)) revert NotAllowed();
            if (mine > a.allowance) revert WalletLimit();
        } else if (gate == Gate.NFT) {
            _useNfts(usedWith[fire][g], G.nft, G.perNft, buyer, n, a.nftIds);
        }
        boughtIn[fire][g][buyer] = mine;
    }

    /// @notice Take `n` credit packs from group `g` (the drop's credit group): open, with `n` left. Gate, price, coins
    ///         and wallet limit don't apply (a credit was earned). Returns its PAPER per pack and the packs left.
    function takeCredit(uint256 fire, uint256 g, uint256 n) external onlySale returns (uint256 paper, uint256 left) {
        (left,,) = _takeFrom(fire, g, n);
        paper = groups[fire][g].paper;
    }

    /// @dev Returns what can still sell after these packs, the group's sold count before them, and when it opened.
    function _takeFrom(uint256 fire, uint256 g, uint256 n) internal returns (uint256, uint256, uint256) {
        Calc memory c = _calc(fire);
        Sched storage s = sched[fire];
        if (g >= s.count || c.opensAt[g] == 0 || block.timestamp < c.opensAt[g] || c.ended[g]) revert GroupNotOpen();
        uint256 sold = s.sold[g];
        if (sold + n > c.cap[g]) revert SoldOut();
        s.sold[g] = uint64(sold + n);
        s.lastSaleAt[g] = uint64(block.timestamp);
        // a sale only ends groups with nothing left (this one, or ones waiting on it), so the rest is the same less n
        return (c.unlimitedOpen ? type(uint256).max : c.left - n, sold, c.opensAt[g]);
    }

    // ================================================================ the rising tax

    /// @dev `n` packs of group G after `sold`: n * priceUsd, plus the tax when it has one. Packs k = sold+1 .. sold+n
    ///      cost P * r^k (r = 1 + taxBps/10000), so together P * r^(sold+1) * (r^n - 1) / (r - 1), in 18-decimal
    ///      fixed point, rounded up (never under the price). Bounded: sold + n <= packs and r^packs <= MAX_TAX_GROWTH.
    function _price(Group storage G, uint256 sold, uint256 n) internal view returns (uint256 usd8, uint256 tax8) {
        uint256 p = G.priceUsd;
        uint256 base = n * p;
        uint256 t = G.taxBps;
        if (t == 0 || n == 0) return (base, 0);
        uint256 r = 1e18 + t * 1e14;
        if (!_growthOk(r, sold + n)) revert PriceTooHigh(); // past the safety bound: unbuyable
        uint256 total = Math.mulDiv(p * _rpow(r, sold + 1), _rpow(r, n) - 1e18, (r - 1e18) * 1e18, Math.Rounding.Ceil);
        tax8 = total > base ? total - base : 0;
        usd8 = base + tax8;
    }

    /// @dev x^n, 18-decimal fixed point, by squaring (x squared only while a higher bit remains, so every value
    ///      stays at most x^n).
    function _rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        z = 1e18;
        while (n > 0) {
            if (n & 1 == 1) z = z * x / 1e18;
            n >>= 1;
            if (n > 0) x = x * x / 1e18;
        }
    }

    /// @dev r^n <= MAX_TAX_GROWTH (18-decimal r), worked out without ever overflowing.
    function _growthOk(uint256 r, uint256 n) internal pure returns (bool) {
        uint256 lim = MAX_TAX_GROWTH * 1e18;
        uint256 z = 1e18;
        while (n > 0) {
            if (n & 1 == 1) {
                z = z * r / 1e18;
                if (z > lim) return false;
            }
            n >>= 1;
            if (n > 0) {
                if (r > lim) return false;
                r = r * r / 1e18;
            }
        }
        return true;
    }

    /// @dev The NFT gate: spend `n` packs of allowance (`per` per id) across `ids` in order, each owned by the buyer
    ///      right now.
    function _useNfts(mapping(uint256 => uint256) storage used, address nft, uint256 per, address buyer, uint256 n, uint256[] calldata ids)
        internal
    {
        for (uint256 i; i < ids.length && n > 0; i++) {
            uint256 id = ids[i];
            (bool ok, bytes memory ret) = nft.staticcall(abi.encodeWithSelector(0x6352211e, id)); // ownerOf
            if (!ok || ret.length < 32 || abi.decode(ret, (address)) != buyer) revert NotAllowed();
            uint256 u = used[id];
            if (u >= per) continue;
            uint256 k = per - u < n ? per - u : n;
            used[id] = u + k;
            n -= k;
        }
        if (n == 0) return;
        if (ids.length == 0) revert NotAllowed(); // no NFT named
        revert NftUsed(); // the NFTs named have no allowance left
    }

    // ================================================================ timing

    function _calc(uint256 fire) internal view returns (Calc memory c) {
        Sched storage s = sched[fire];
        uint256 n = s.count;
        uint256 now_ = block.timestamp;
        for (uint256 i; i < n; i++) {
            Group storage G = groups[fire][i];
            uint256 base = G.afterGroup == NONE ? s.start : c.endsAt[G.afterGroup];
            uint256 opens = base == 0 ? 0 : base + G.startDelay;
            // leftovers rolled in from ended lower groups are already in c.cap[i] (never for an unlimited group)
            uint256 cap = G.unlimited ? UNLIMITED : c.cap[i] + G.packs;
            uint256 sold = s.sold[i];
            uint256 end = _deadline(G, opens, s.lastSaleAt[i]);
            bool ended;
            if (opens != 0 && now_ >= opens) {
                if (end != 0 && now_ >= end) ended = true;
                if (sold == cap && c.rollersOpen[i] == 0) {
                    // gone for good: when the last pack went or the last group rolling in ended, whichever was later
                    uint256 t = _max(_max(opens, s.lastSaleAt[i]), c.rollersEnd[i]);
                    if (end == 0 || t < end) end = t;
                    ended = true;
                }
            }
            c.opensAt[i] = opens;
            c.endsAt[i] = end;
            c.cap[i] = cap;
            c.ended[i] = ended;
            if (!ended) {
                if (G.unlimited) c.unlimitedOpen = true;
                else c.left += cap - sold;
            }
            uint256 to = G.rollTo;
            if (to == NONE) continue;
            if (ended) {
                c.cap[to] += cap - sold;
                if (end > c.rollersEnd[to]) c.rollersEnd[to] = end;
            }
            // still open, or ended but packs may still pass through it from a group that hasn't ended
            if (!ended || c.rollersOpen[i] != 0) c.rollersOpen[to] += 1;
        }
    }

    /// @dev When a group ends if nothing more sells (0 = not known yet, or until its packs are gone): its duration
    ///      after it opened, or `idle` after it opened or last sold, whichever is first.
    function _deadline(Group storage G, uint256 opens, uint256 lastSale) internal view returns (uint256 end) {
        if (opens == 0) return 0;
        if (G.duration != 0) end = opens + G.duration;
        uint256 idle = G.idle;
        if (idle != 0) {
            uint256 e = _max(opens, lastSale) + idle;
            if (end == 0 || e < end) end = e;
        }
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    // ================================================================ views

    function groupCount(uint256 fire) external view returns (uint256) {
        return sched[fire].count;
    }

    /// @notice Packs that can still sell, in every group that hasn't ended (0 = the Series is done;
    ///         type(uint256).max while an unlimited group hasn't ended).
    function remaining(uint256 fire) external view returns (uint256) {
        Calc memory c = _calc(fire);
        return c.unlimitedOpen ? type(uint256).max : c.left;
    }

    /// @notice What group `g` can sell right now (0 if it isn't open).
    function openLeft(uint256 fire, uint256 g) external view returns (uint256) {
        Calc memory c = _calc(fire);
        if (g >= sched[fire].count || c.opensAt[g] == 0 || block.timestamp < c.opensAt[g] || c.ended[g]) return 0;
        if (groups[fire][g].unlimited) return type(uint256).max;
        return c.cap[g] - sched[fire].sold[g];
    }

    /// @notice When the drop's schedule is over at the latest: every timed group has ended and every group that runs
    ///         until sold has opened (unless it waits on one that runs until sold). Fixed by the config (`idle` only
    ///         ever ends a group sooner, so it's left out: this is the latest). An unlimited group that has opened
    ///         adds its own end: while it is open, when it ends if nothing more sells (it moves with each sale; it
    ///         always comes, since idle ends it and its price caps how long sales can go on). 0 = no drop.
    function scheduleEnd(uint256 fire) external view returns (uint256 over) {
        Sched storage s = sched[fire];
        uint256[6] memory latest;
        bool unlimited;
        for (uint256 i; i < s.count; i++) {
            Group storage G = groups[fire][i];
            latest[i] = (G.afterGroup == NONE ? s.start : latest[G.afterGroup]) + G.startDelay + G.duration;
            if (latest[i] > over) over = latest[i];
            if (G.unlimited) unlimited = true;
        }
        if (!unlimited) return over;
        Calc memory c = _calc(fire);
        for (uint256 i; i < s.count; i++) {
            if (groups[fire][i].unlimited && c.opensAt[i] != 0 && block.timestamp >= c.opensAt[i] && c.endsAt[i] > over) {
                over = c.endsAt[i];
            }
        }
    }

    /// @notice Every group of a drop, with its state now.
    function groupsOf(uint256 fire) external view returns (GroupView[] memory v) {
        Calc memory c = _calc(fire);
        Sched storage s = sched[fire];
        v = new GroupView[](s.count);
        for (uint256 i; i < v.length; i++) {
            GroupView memory x = v[i];
            x.config = groups[fire][i];
            x.sold = s.sold[i];
            bool unl = x.config.unlimited;
            x.capacity = unl ? type(uint256).max : c.cap[i];
            x.left = unl ? (c.ended[i] ? 0 : type(uint256).max) : c.cap[i] - x.sold;
            x.opensAt = c.opensAt[i];
            x.endsAt = c.endsAt[i];
            uint256 lf = x.config.limitFor;
            if (lf != 0 && x.opensAt != 0) x.limitUntil = x.opensAt + lf;
            x.state = c.ended[i] ? State.ENDED : c.opensAt[i] != 0 && block.timestamp >= c.opensAt[i] ? State.OPEN : State.UPCOMING;
        }
    }

    /// @notice What `n` more packs of group `g` cost right now in dollars (8 decimals), and the rising tax part of it.
    function priceOf(uint256 fire, uint256 g, uint256 n) external view returns (uint256 usd8, uint256 tax8) {
        if (g >= sched[fire].count) revert BadGroup(g);
        return _price(groups[fire][g], sched[fire].sold[g], n);
    }

    /// @notice A group's config.
    function groupOf(uint256 fire, uint256 g) external view returns (Group memory) {
        if (g >= sched[fire].count) revert BadGroup(g);
        return groups[fire][g];
    }

    /// @notice Packs `wallet` took in each group of a drop.
    function boughtBy(uint256 fire, address wallet) external view returns (uint256[] memory b) {
        b = new uint256[](sched[fire].count);
        for (uint256 i; i < b.length; i++) b[i] = boughtIn[fire][i][wallet];
    }
}
