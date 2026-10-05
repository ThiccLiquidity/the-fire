// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {IDealer} from "./IDealer.sol";

interface IDealerCards {
    function PACKS() external view returns (address);
    function fires(uint256 fire)
        external
        view
        returns (address dealer, bool closed, bool locked, uint32 cardsPerPack, uint64 packs, uint64 dealt);
}

interface IDealerPacks {
    function minted(uint256 fire) external view returns (uint256);
}

/**
 * @title RecipeDealer
 * @notice Deals each Series from its own recipe: what card types it has, how many of each, how holo they are, what a
 *         pack holds and its characters. Every setting is per Series and is fixed once the Series' first pack is
 *         minted (or the Series is locked or closed), so a buyer always knows the odds. Everything is readable here.
 *
 *         A recipe:
 *         - Card types, in any number. Each has a name (the "Material" trait), a file slug (image file names), a rank
 *           ("X-or-better" slots use it) and a supply rule: a share of the Series' cards (parts per billion, rounded
 *           half up), a number per pack, an exact count, or the filler (whatever is left; exactly one type). Any rule
 *           can be capped at `maxPerPack` x packs. Holo: two independent rolls (frame, picture) at chances out of
 *           1e18, or explicit weights for none / frame / picture / full.
 *         - Slots: the pack, in groups. Each group is `count` cards that may be any type in a set: an explicit list
 *           of types, or a rank range. A group can require holo. Cards per pack = the sum of the counts.
 *         - Characters (names and categories), any number, added in batches if the list is long.
 *
 *         Every pack keeps its slots for any number of packs sold. Two group sets must be nested or disjoint (so the
 *         check stays exact and cheap), and every type must fit some group. When the Series closes with P packs the
 *         pool is worked out (`poolOf`): each type's rule, the filler takes the rest, then the floor: every group of
 *         slots must have enough cards that fit it. Short sets not holding the filler are topped up from the filler
 *         (into their lowest-ranked type); short sets holding the filler get cards back from types outside them that
 *         have more than their own slots need (lowest rank first, exact counts last). This always works and, for the
 *         Standard recipe, is exactly the studio's computePool.
 *
 *         Dealing (only FireCards calls it, in opening order): each pack's groups are filled most specific first. A
 *         card for a group is drawn by walking down the nested sets from the group's set: at each level, a part is
 *         chosen with weight equal to its cards not held back for later packs, and inside the innermost part a card
 *         type with weight equal to its cards left. So every later pack can still be filled, the Series' totals come
 *         out exact, and for the Standard recipe the odds are exactly the previous contract's. Then the holo rolls
 *         and a character (uniform), all from the pack's drand randomness.
 */
contract RecipeDealer is IDealer, Ownable2Step {
    // ================================================================ recipe

    enum Supply {
        Filler, // whatever is left once every other type has its number
        Share, // `amount` parts per billion of the Series' cards, rounded half up
        PerPack, // `amount` cards per pack
        Count // exactly `amount` cards
    }

    enum HoloMode {
        Independent, // holo[0] = frame chance, holo[1] = picture chance, out of 1e18; holo[2..3] = 0
        Distribution // holo = weights of none, frame, picture, full (any total above 0)
    }

    struct CardType {
        string name; // 1..64 bytes, no quotes, backslashes or control characters
        string slug; // 1..32 bytes of [a-z0-9-], unique in the recipe
        uint32 rank; // for rank-range slots ("Fire-or-better")
        Supply supply;
        uint128 amount;
        uint64 maxPerPack; // 0 = no cap; else at most maxPerPack x packs (before the floor)
        HoloMode holoMode;
        uint64[4] holo;
    }

    struct Slot {
        uint32 count; // cards of the pack under this rule (at least 1)
        uint32[] types; // the allowed types; when empty, every type with minRank <= rank <= maxRank
        uint32 minRank;
        uint32 maxRank;
        bool mustHolo; // the card is always holo (its type's holo odds, given it is holo)
    }

    struct Recipe {
        CardType[] types;
        Slot[] slots;
    }

    uint256 public constant SHARE_SCALE = 1e9;
    uint256 public constant HOLO_ONE = 1e18;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_CATEGORY_BYTES = 32;
    uint256 public constant MAX_SLUG_BYTES = 32;

    IDealerCards public immutable CARDS;
    IDealerPacks public immutable PACKS;

    struct Config {
        address plan; // the compiled recipe's code-storage chunk (MULTI_CHUNK: several, in _planData); 0 = no recipe
        uint32 cardsPerPack;
        uint32 typeCount;
        uint32 slotCount;
    }

    struct State {
        bool started; // the pool was laid out (the Series' first deal)
        uint64 packs;
        uint64 packsLeft; // packs not yet started
        uint32 characters; // fixed by then
    }

    address private constant MULTI_CHUNK = address(1);

    mapping(uint256 fire => Config) internal _config;
    mapping(uint256 fire => address[]) internal _recipeData; // abi.encode(recipe), in code-storage chunks
    mapping(uint256 fire => address[]) internal _planData; // the compiled recipe the dealing reads
    /// @dev Characters: setCharacters starts a fresh list (a new generation) instead of deleting the old one, so a
    ///      long list can always be replaced.
    mapping(uint256 fire => uint256) internal _charGen;
    mapping(uint256 fire => mapping(uint256 gen => string[])) internal _nameLists;
    mapping(uint256 fire => mapping(uint256 gen => string[])) internal _categoryLists;
    mapping(uint256 fire => State) internal _state;
    /// @dev Counts left while dealing, two uint128 per storage slot from keccak256(fire, CELLS_TAG): cell t = cards of
    ///      type t left; cells from typeCount on = cards left in each nested set of more than one type.
    uint256 private constant CELLS_TAG = 0x6f6d6e692e7265636970652e63656c6c73; // "omni.recipe.cells"

    event RecipeSet(uint256 indexed fire, uint256 cardsPerPack, uint256 types, uint256 slots);
    event CharactersSet(uint256 indexed fire, uint256 count);
    event CharactersAdded(uint256 indexed fire, uint256 first, uint256 count);
    event PoolSet(uint256 indexed fire, uint256 packs, uint256[] counts);

    error NotCards();
    error FireIsLocked();
    error NotConfigured();
    error NotClosed();
    error BadText();
    error BadLength();
    error BadDeal();
    error NothingLeft();
    /// @notice The recipe has no type, or more than one / no filler type.
    error BadFiller();
    error BadType(uint256 index, string why);
    error BadSlot(uint256 index, string why);
    /// @notice Two slot groups' type sets overlap without one holding the other.
    error NotNested(uint256 slotA, uint256 slotB);
    /// @notice No slot group can take this type.
    error TypeNeverDealt(uint256 index);
    /// @notice A must-be-holo slot allows a type that is never holo.
    error NeverHolo(uint256 slot, uint256 typeIndex);
    /// @notice Internal check that the pool fills every slot (never expected).
    error Infeasible();

    constructor(address owner_, address cards) Ownable(owner_) {
        CARDS = IDealerCards(cards);
        PACKS = IDealerPacks(IDealerCards(cards).PACKS());
    }

    // ================================================================ owner

    /// @notice Set (or replace) a Series' recipe. Until the Series' first pack is minted, it is locked or closed.
    function setRecipe(uint256 fire, Recipe calldata r) external onlyOwner {
        _checkOpen(fire);
        Recipe memory m = r;
        (uint256[] memory plan, uint256 perPack) = _compile(m);
        bytes memory planBytes = abi.encodePacked(plan);
        // dry runs: the floor holds for small, odd and huge Series (it is built to hold for every size)
        _pool(planBytes, 1);
        _pool(planBytes, 2);
        _pool(planBytes, 7);
        _pool(planBytes, 1_000_003);
        _replace(_planData[fire], planBytes);
        _replace(_recipeData[fire], abi.encode(m));
        address first = _planData[fire].length == 1 ? _planData[fire][0] : MULTI_CHUNK;
        _config[fire] = Config(first, uint32(perPack), uint32(m.types.length), uint32(m.slots.length));
        emit RecipeSet(fire, perPack, m.types.length, m.slots.length);
    }

    /// @notice Replace a Series' characters (names and categories, in image order: c0, c1, ...). At least one.
    function setCharacters(uint256 fire, string[] calldata names, string[] calldata categories) external onlyOwner {
        _checkOpen(fire);
        if (names.length == 0) revert BadLength();
        _charGen[fire] += 1;
        _addCharacters(fire, names, categories);
        emit CharactersSet(fire, names.length);
    }

    /// @notice Add characters after the ones already set (for long lists, in batches). Same lock as setCharacters.
    function appendCharacters(uint256 fire, string[] calldata names, string[] calldata categories) external onlyOwner {
        _checkOpen(fire);
        uint256 first = _names(fire).length;
        _addCharacters(fire, names, categories);
        emit CharactersAdded(fire, first, names.length);
    }

    // ================================================================ IDealer

    function ready(uint256 fire) public view returns (bool) {
        return _config[fire].plan != address(0) && _names(fire).length != 0;
    }

    function cardsPerPack(uint256 fire) external view returns (uint256) {
        return _config[fire].cardsPerPack;
    }

    function characterCount(uint256 fire) external view returns (uint256) {
        return _names(fire).length;
    }

    function deal(uint256 fire, uint256 seed, uint256 fromCard, uint256 count) external returns (uint256[] memory out) {
        if (msg.sender != address(CARDS)) revert NotCards();
        bytes memory p = _plan(fire);
        State storage st = _state[fire];
        if (!st.started) _start(fire, p, st);
        if (count == 0 || fromCard + count > _at(p, H_S)) revert BadDeal();
        uint256 left = st.packsLeft;
        if (fromCard == 0) {
            if (left == 0) revert NothingLeft();
            left -= 1;
            st.packsLeft = uint64(left);
        }
        _put(p, H_RT_CELLS, _cellBase(fire));
        _put(p, H_RT_CHARS, st.characters);
        _put(p, H_RT_LEFT, left);
        out = _dealRange(p, seed, fromCard, count);
    }

    function _dealRange(bytes memory p, uint256 seed, uint256 fromCard, uint256 count) internal returns (uint256[] memory out) {
        out = new uint256[](count);
        uint256 step = _at(p, H_STEPTAB); // the group record card `pos` belongs to
        uint256 end = _at(p, step + 1);
        for (uint256 i; i < count; i++) {
            uint256 pos = fromCard + i;
            while (pos >= end) {
                step += 4;
                end += _at(p, step + 1);
            }
            out[i] = _dealOne(p, step, _rand(seed, pos));
        }
    }

    /// @dev One card: its type (the group's set, walked down), holo and character.
    function _dealOne(bytes memory p, uint256 step, uint256 r) internal returns (uint256) {
        uint256 t = _draw(p, _at(p, step), r);
        (bool hf, bool hp) = _holo(p, t, _at(p, step + 2) != 0, _rand(r, 1), _rand(r, 2));
        return t | ((_rand(r, 3) % _at(p, H_RT_CHARS)) << 32) | (hf ? 1 << 64 : 0) | (hp ? 1 << 65 : 0);
    }

    function cardText(uint256 fire, uint256 cardType, uint256 character, uint256)
        external
        view
        returns (CardText memory c)
    {
        Recipe memory r = recipeOf(fire);
        if (cardType < r.types.length) {
            c.typeName = r.types[cardType].name;
            c.typeSlug = r.types[cardType].slug;
        }
        if (character < _names(fire).length) {
            c.characterName = _names(fire)[character];
            c.category = _categories(fire)[character];
        }
    }

    // ================================================================ views

    /// @notice A Series' recipe, as set.
    function recipeOf(uint256 fire) public view returns (Recipe memory r) {
        if (_config[fire].plan == address(0)) return r;
        r = abi.decode(_read(_recipeData[fire]), (Recipe));
    }

    /// @notice Whether a recipe is valid; reverts with the reason if not. Returns its cards per pack.
    function check(Recipe calldata r) external pure returns (uint256 perPack) {
        (, perPack) = _compile(r);
    }

    /// @notice The pool a recipe gives for `packs` packs (one count per type, in recipe order).
    function previewPool(Recipe calldata r, uint256 packs) external pure returns (uint256[] memory) {
        (uint256[] memory plan,) = _compile(r);
        (int256[] memory c,) = _pool(abi.encodePacked(plan), packs);
        return _toUint(c);
    }

    /// @notice The pool a Series' recipe gives for `packs` packs.
    function poolFor(uint256 fire, uint256 packs) public view returns (uint256[] memory) {
        if (_config[fire].plan == address(0)) revert NotConfigured();
        (int256[] memory c,) = _pool(_plan(fire), packs);
        return _toUint(c);
    }

    /// @notice A closed Series' pool, from its frozen pack count (empty before it closes).
    function poolOf(uint256 fire) external view returns (uint256[] memory) {
        (, bool closed,,, uint64 packs,) = CARDS.fires(fire);
        if (!closed || _config[fire].plan == address(0)) return new uint256[](0);
        return poolFor(fire, packs);
    }

    /// @notice Cards of each type not yet dealt, and packs not yet started (the pool until the first deal).
    function remainingOf(uint256 fire) external view returns (uint256[] memory left, uint256 packsLeft) {
        State memory st = _state[fire];
        if (!st.started) {
            (, bool closed,,, uint64 packs,) = CARDS.fires(fire);
            if (!closed || _config[fire].plan == address(0)) return (new uint256[](0), 0);
            return (poolFor(fire, packs), packs);
        }
        uint256 n = _config[fire].typeCount;
        left = new uint256[](n);
        uint256 base = _cellBase(fire);
        for (uint256 t; t < n; t++) left[t] = _cellAt(base, t);
        packsLeft = st.packsLeft;
    }

    /// @notice Chance (out of 1e18) that a card of a type comes out none / frame / picture / full holo, in a slot
    ///         that doesn't require holo.
    function holoOdds(uint256 fire, uint256 cardType) external view returns (uint256[4] memory o) {
        Recipe memory r = recipeOf(fire);
        CardType memory t = r.types[cardType];
        if (t.holoMode == HoloMode.Independent) {
            uint256 a = t.holo[0];
            uint256 b = t.holo[1];
            o[0] = (HOLO_ONE - a) * (HOLO_ONE - b) / HOLO_ONE;
            o[1] = a * (HOLO_ONE - b) / HOLO_ONE;
            o[2] = (HOLO_ONE - a) * b / HOLO_ONE;
            o[3] = a * b / HOLO_ONE;
        } else {
            uint256 total = uint256(t.holo[0]) + t.holo[1] + t.holo[2] + t.holo[3];
            for (uint256 i; i < 4; i++) o[i] = uint256(t.holo[i]) * HOLO_ONE / total;
        }
    }

    function characterOf(uint256 fire, uint256 i) external view returns (string memory name, string memory category) {
        return (_names(fire)[i], _categories(fire)[i]);
    }

    /// @notice Up to `count` characters from `from` (a page of a long list).
    function charactersOf(uint256 fire, uint256 from, uint256 count)
        external
        view
        returns (string[] memory names, string[] memory categories)
    {
        uint256 n = _names(fire).length;
        uint256 to = from + count > n ? n : from + count;
        uint256 k = to > from ? to - from : 0;
        names = new string[](k);
        categories = new string[](k);
        for (uint256 i; i < k; i++) {
            names[i] = _names(fire)[from + i];
            categories[i] = _categories(fire)[from + i];
        }
    }

    /// @notice The order a pack's cards are dealt in: for each position, the recipe slot (group) it fills. Groups
    ///         go most specific first (deepest nested set), ties in recipe order.
    function dealOrder(uint256 fire) external view returns (uint256[] memory slotOf) {
        bytes memory p = _plan(fire);
        slotOf = new uint256[](_at(p, H_S));
        uint256 step = _at(p, H_STEPTAB);
        uint256 i;
        for (uint256 g; g < _at(p, H_STEPS); g++) {
            for (uint256 c; c < _at(p, step + 1); c++) slotOf[i++] = _at(p, step + 3);
            step += 4;
        }
    }

    function stateOf(uint256 fire) external view returns (State memory) {
        return _state[fire];
    }

    // ================================================================ setup internals

    function _checkOpen(uint256 fire) internal view {
        if (fire > type(uint64).max) revert BadLength(); // cards store the Series in 64 bits
        (, bool closed, bool locked,,,) = CARDS.fires(fire);
        if (closed || locked || PACKS.minted(fire) != 0) revert FireIsLocked();
    }

    function _names(uint256 fire) internal view returns (string[] storage) {
        return _nameLists[fire][_charGen[fire]];
    }

    function _categories(uint256 fire) internal view returns (string[] storage) {
        return _categoryLists[fire][_charGen[fire]];
    }

    function _addCharacters(uint256 fire, string[] calldata names, string[] calldata categories) internal {
        if (names.length != categories.length) revert BadLength();
        string[] storage list = _names(fire);
        string[] storage cats = _categories(fire);
        if (list.length + names.length > type(uint32).max) revert BadLength(); // 32-bit character index
        for (uint256 i; i < names.length; i++) {
            if (bytes(names[i]).length > MAX_NAME_BYTES) revert BadText();
            _checkText(bytes(names[i]));
            uint256 n = bytes(categories[i]).length;
            if (n == 0 || n > MAX_CATEGORY_BYTES) revert BadText();
            _checkText(bytes(categories[i]));
            list.push(names[i]);
            cats.push(categories[i]);
        }
    }

    function _checkText(bytes memory b) internal pure {
        for (uint256 i; i < b.length; i++) {
            if (b[i] == '"' || b[i] == "\\" || uint8(b[i]) < 0x20) revert BadText();
        }
    }

    // ================================================================ the compiled recipe

    // Header words of the compiled plan
    uint256 private constant H_T = 0; // types
    uint256 private constant H_NODES = 1; // nested sets (node 0 = every type)
    uint256 private constant H_STEPS = 2; // slot groups
    uint256 private constant H_S = 3; // cards per pack
    uint256 private constant H_FILLER = 4;
    uint256 private constant H_TYPES = 5; // where the type records start
    uint256 private constant H_NODETAB = 6; // node n's record starts at word plan[H_NODETAB + n]
    uint256 private constant H_STEPTAB = 7; // groups in dealing order, 4 words each: node, count, mustHolo, slot
    uint256 private constant H_TRIM = 8; // types the floor takes back from, in order
    uint256 private constant H_DEPTH = 9; // nodes, deepest first
    // filled in memory while dealing (0 in the stored plan)
    uint256 private constant H_RT_CELLS = 10; // the Series' first cell slot
    uint256 private constant H_RT_CHARS = 11; // characters
    uint256 private constant H_RT_LEFT = 12; // packs still to come after the one being dealt
    uint256 private constant HEADER = 13;
    // Type record
    uint256 private constant TW = 10;
    uint256 private constant T_INNER = 0; // smallest node holding the type
    uint256 private constant T_SUPPLY = 2;
    uint256 private constant T_AMOUNT = 3;
    uint256 private constant T_CAP = 4;
    uint256 private constant T_HOLOMODE = 5;
    uint256 private constant T_HOLO = 6;
    // Node record
    uint256 private constant N_PARENT = 0;
    uint256 private constant N_DEPTH = 1;
    uint256 private constant N_K = 2; // slots per pack inside the set
    uint256 private constant N_SINGLE = 3; // type + 1 for a one-type set, else 0
    uint256 private constant N_CELL = 4; // its count's cell (a one-type set: the type's own cell)
    uint256 private constant N_LOWEST = 5; // lowest-ranked type
    uint256 private constant N_FILLER = 6; // holds the filler
    uint256 private constant N_NCHILD = 7;
    uint256 private constant N_NBARE = 8;
    uint256 private constant N_LIST = 9; // child nodes, then types in no child

    struct Build {
        uint256 T;
        uint256 W; // bitmap words
        uint256 nn;
        uint256 S;
        uint256 filler;
        uint256[][] sets;
        uint256[] size;
        uint256[] slotNode;
        uint256[] parent;
        uint256[] depth;
        uint256[] k;
        uint256[] inner;
        uint256[] cell;
    }

    function _compile(Recipe memory r) internal pure returns (uint256[] memory plan, uint256 perPack) {
        Build memory b;
        b.T = r.types.length;
        b.filler = _checkTypes(r.types);
        b.W = (b.T + 255) / 256;
        _buildSets(r, b);
        _buildTree(r, b);
        plan = _serialize(r, b);
        perPack = b.S;
    }

    function _checkTypes(CardType[] memory ts) internal pure returns (uint256 filler) {
        uint256 n = ts.length;
        if (n == 0 || n > type(uint32).max) revert BadFiller();
        uint256 fillers;
        bytes32[] memory slugs = new bytes32[](n);
        for (uint256 t; t < n; t++) {
            CardType memory c = ts[t];
            uint256 len = bytes(c.name).length;
            if (len == 0 || len > MAX_NAME_BYTES) revert BadType(t, "name length");
            _checkText(bytes(c.name));
            bytes memory s = bytes(c.slug);
            if (s.length == 0 || s.length > MAX_SLUG_BYTES) revert BadType(t, "slug length");
            for (uint256 i; i < s.length; i++) {
                bytes1 ch = s[i];
                if (!((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch == "-")) revert BadType(t, "slug characters");
            }
            slugs[t] = keccak256(s);
            for (uint256 u; u < t; u++) if (slugs[u] == slugs[t]) revert BadType(t, "slug repeated");
            if (c.supply == Supply.Filler) {
                fillers++;
                filler = t;
            } else if (c.supply == Supply.Share && c.amount > SHARE_SCALE) {
                revert BadType(t, "share above 100%");
            }
            if (c.holoMode == HoloMode.Independent) {
                if (c.holo[0] > HOLO_ONE || c.holo[1] > HOLO_ONE || c.holo[2] != 0 || c.holo[3] != 0) revert BadType(t, "holo chances");
            } else if (uint256(c.holo[0]) + c.holo[1] + c.holo[2] + c.holo[3] == 0) {
                revert BadType(t, "holo weights");
            }
        }
        if (fillers != 1) revert BadFiller();
    }

    function _buildSets(Recipe memory r, Build memory b) internal pure {
        uint256 G = r.slots.length;
        if (G == 0) revert BadSlot(0, "no slots");
        b.sets = new uint256[][](G + 1);
        b.slotNode = new uint256[](G);
        uint256[] memory all = new uint256[](b.W);
        for (uint256 t; t < b.T; t++) all[t >> 8] |= 1 << (t & 255);
        b.sets[0] = all;
        b.nn = 1;
        bool rootUsed;
        uint256[] memory covered = new uint256[](b.W);
        for (uint256 s; s < G; s++) {
            Slot memory sl = r.slots[s];
            if (sl.count == 0) revert BadSlot(s, "count");
            b.S += sl.count;
            uint256[] memory bm = new uint256[](b.W);
            if (sl.types.length > 0) {
                for (uint256 i; i < sl.types.length; i++) {
                    uint256 t = sl.types[i];
                    if (t >= b.T) revert BadSlot(s, "type index");
                    if (bm[t >> 8] & (1 << (t & 255)) != 0) revert BadSlot(s, "type repeated");
                    bm[t >> 8] |= 1 << (t & 255);
                }
            } else {
                if (sl.minRank > sl.maxRank) revert BadSlot(s, "rank range");
                bool any;
                for (uint256 t; t < b.T; t++) {
                    uint256 rk = r.types[t].rank;
                    if (rk >= sl.minRank && rk <= sl.maxRank) {
                        bm[t >> 8] |= 1 << (t & 255);
                        any = true;
                    }
                }
                if (!any) revert BadSlot(s, "no type in rank range");
            }
            for (uint256 w; w < b.W; w++) covered[w] |= bm[w];
            uint256 j;
            while (j < b.nn && !_same(b.sets[j], bm)) j++;
            if (j == b.nn) b.sets[b.nn++] = bm;
            if (j == 0) rootUsed = true;
            b.slotNode[s] = j;
            if (sl.mustHolo) {
                for (uint256 t; t < b.T; t++) {
                    if (bm[t >> 8] & (1 << (t & 255)) != 0 && !_canHolo(r.types[t])) revert NeverHolo(s, t);
                }
            }
        }
        if (b.S > type(uint32).max) revert BadSlot(G - 1, "too many cards per pack");
        if (!rootUsed) {
            for (uint256 t; t < b.T; t++) if (covered[t >> 8] & (1 << (t & 255)) == 0) revert TypeNeverDealt(t);
        }
    }

    function _buildTree(Recipe memory r, Build memory b) internal pure {
        uint256 nn = b.nn;
        b.size = new uint256[](nn);
        for (uint256 i; i < nn; i++) b.size[i] = _popcount(b.sets[i]);
        // nested or disjoint; each set's parent is the smallest set holding it
        b.parent = new uint256[](nn);
        for (uint256 i = 1; i < nn; i++) {
            uint256 best;
            for (uint256 j = 1; j < nn; j++) {
                if (i == j) continue;
                (bool disjoint, bool iInJ, bool jInI) = _relation(b.sets[i], b.sets[j]);
                if (!disjoint && !iInJ && !jInI) revert NotNested(_slotOf(b, i), _slotOf(b, j));
                if (iInJ && b.size[j] < b.size[best]) best = j;
            }
            b.parent[i] = best;
        }
        b.depth = new uint256[](nn);
        for (uint256 i = 1; i < nn; i++) {
            uint256 d;
            for (uint256 x = i; x != 0; x = b.parent[x]) d++;
            b.depth[i] = d;
        }
        b.k = new uint256[](nn);
        for (uint256 s; s < r.slots.length; s++) {
            uint256 x = b.slotNode[s];
            while (true) {
                b.k[x] += r.slots[s].count;
                if (x == 0) break;
                x = b.parent[x];
            }
        }
        b.inner = new uint256[](b.T);
        for (uint256 t; t < b.T; t++) {
            uint256 best;
            for (uint256 i = 1; i < nn; i++) {
                if (b.sets[i][t >> 8] & (1 << (t & 255)) != 0 && b.size[i] < b.size[best]) best = i;
            }
            b.inner[t] = best;
        }
        b.cell = new uint256[](nn);
        uint256 c = b.T;
        for (uint256 i = 1; i < nn; i++) {
            if (b.size[i] > 1) b.cell[i] = c++;
        }
        for (uint256 t; t < b.T; t++) if (b.size[b.inner[t]] == 1) b.cell[b.inner[t]] = t;
    }

    function _serialize(Recipe memory r, Build memory b) internal pure returns (uint256[] memory p) {
        uint256 T = b.T;
        uint256 nn = b.nn;
        uint256 G = r.slots.length;
        uint256 nodeWords = N_LIST * nn + (nn - 1) + T;
        p = new uint256[](HEADER + T * TW + nn + nodeWords + 4 * G + (T - 1) + nn);
        p[H_T] = T;
        p[H_NODES] = nn;
        p[H_STEPS] = G;
        p[H_S] = b.S;
        p[H_FILLER] = b.filler;
        uint256 at = HEADER;
        p[H_TYPES] = at;
        for (uint256 t; t < T; t++) {
            CardType memory c = r.types[t];
            p[at + T_INNER] = b.inner[t];
            p[at + 1] = c.rank;
            p[at + T_SUPPLY] = uint256(c.supply);
            p[at + T_AMOUNT] = c.amount;
            p[at + T_CAP] = c.maxPerPack;
            p[at + T_HOLOMODE] = uint256(c.holoMode);
            for (uint256 i; i < 4; i++) p[at + T_HOLO + i] = c.holo[i];
            at += TW;
        }
        p[H_NODETAB] = at;
        at += nn;
        for (uint256 x; x < nn; x++) {
            p[p[H_NODETAB] + x] = at;
            at = _writeNode(r, b, p, x, at);
        }
        p[H_STEPTAB] = at;
        // groups, most specific (deepest) first; ties keep recipe order
        for (uint256 d = _maxDepth(b) + 1; d > 0; d--) {
            for (uint256 s; s < G; s++) {
                if (b.depth[b.slotNode[s]] != d - 1) continue;
                p[at++] = b.slotNode[s];
                p[at++] = r.slots[s].count;
                p[at++] = r.slots[s].mustHolo ? 1 : 0;
                p[at++] = s;
            }
        }
        // the floor takes cards back from: rule-by-share / per-pack types first, then exact counts; lowest rank first
        p[H_TRIM] = at;
        for (uint256 pass; pass < 2; pass++) {
            uint256 start = at;
            for (uint256 t; t < T; t++) {
                if (t == b.filler || (r.types[t].supply == Supply.Count) != (pass == 1)) continue;
                uint256 i = at++;
                while (i > start && r.types[p[i - 1]].rank > r.types[t].rank) {
                    p[i] = p[i - 1];
                    i--;
                }
                p[i] = t;
            }
        }
        p[H_DEPTH] = at;
        for (uint256 d = _maxDepth(b) + 1; d > 0; d--) {
            for (uint256 x; x < nn; x++) if (b.depth[x] == d - 1) p[at++] = x;
        }
    }

    function _writeNode(Recipe memory r, Build memory b, uint256[] memory p, uint256 x, uint256 at)
        internal
        pure
        returns (uint256)
    {
        p[at + N_PARENT] = b.parent[x];
        p[at + N_DEPTH] = b.depth[x];
        p[at + N_K] = b.k[x];
        p[at + N_CELL] = b.cell[x];
        uint256 lowest = type(uint256).max;
        for (uint256 t; t < b.T; t++) {
            if (b.sets[x][t >> 8] & (1 << (t & 255)) == 0) continue;
            if (b.size[x] == 1) p[at + N_SINGLE] = t + 1;
            if (lowest == type(uint256).max || r.types[t].rank < r.types[lowest].rank) lowest = t;
        }
        p[at + N_LOWEST] = lowest;
        p[at + N_FILLER] = b.sets[x][b.filler >> 8] & (1 << (b.filler & 255)) != 0 ? 1 : 0;
        uint256 i = at + N_LIST;
        for (uint256 y = 1; y < b.nn; y++) {
            if (b.parent[y] == x && y != x) {
                p[i++] = y;
                p[at + N_NCHILD]++;
            }
        }
        for (uint256 t; t < b.T; t++) {
            if (b.inner[t] == x) {
                p[i++] = t;
                p[at + N_NBARE]++;
            }
        }
        return i;
    }

    function _maxDepth(Build memory b) internal pure returns (uint256 m) {
        for (uint256 i; i < b.nn; i++) if (b.depth[i] > m) m = b.depth[i];
    }

    function _slotOf(Build memory b, uint256 node) internal pure returns (uint256) {
        for (uint256 s; s < b.slotNode.length; s++) if (b.slotNode[s] == node) return s;
        return type(uint256).max;
    }

    function _canHolo(CardType memory t) internal pure returns (bool) {
        if (t.holoMode == HoloMode.Independent) return t.holo[0] > 0 || t.holo[1] > 0;
        return uint256(t.holo[1]) + t.holo[2] + t.holo[3] > 0;
    }

    function _same(uint256[] memory a, uint256[] memory c) internal pure returns (bool) {
        for (uint256 w; w < a.length; w++) if (a[w] != c[w]) return false;
        return true;
    }

    function _relation(uint256[] memory a, uint256[] memory c) internal pure returns (bool disjoint, bool aInC, bool cInA) {
        disjoint = true;
        aInC = true;
        cInA = true;
        for (uint256 w; w < a.length; w++) {
            if (a[w] & c[w] != 0) disjoint = false;
            if (a[w] & ~c[w] != 0) aInC = false;
            if (c[w] & ~a[w] != 0) cInA = false;
        }
    }

    function _popcount(uint256[] memory a) internal pure returns (uint256 n) {
        for (uint256 w; w < a.length; w++) {
            uint256 x = a[w];
            while (x != 0) {
                x &= x - 1;
                n++;
            }
        }
    }

    // ================================================================ the pool

    /**
     * @dev Pool for `packs` packs, from the compiled plan. 1. Each type's rule (cap applied), the filler the rest.
     *      2. Sets without the filler, deepest first: if short of their slots, top up their lowest-ranked type from the
     *      filler. 3. Sets holding the filler, from the filler up: if short, take cards back from types outside the set
     *      that have more than their own sets need (trim order), into the filler. Returns counts per type and per set.
     */
    function _pool(bytes memory p, uint256 packs) internal pure returns (int256[] memory c, int256[] memory sums) {
        c = _rules(p, packs);
        uint256 nn = _at(p, H_NODES);
        sums = new int256[](nn);
        for (uint256 t; t < c.length; t++) {
            for (uint256 x = _inner(p, t);; x = _nodeAt(p, x, N_PARENT)) {
                sums[x] += c[t];
                if (x == 0) break;
            }
        }
        _topUp(p, c, sums, packs);
        _takeBack(p, c, sums, packs);
        for (uint256 t; t < c.length; t++) if (c[t] < 0) revert Infeasible();
        for (uint256 x; x < nn; x++) if (sums[x] < int256(packs * _nodeAt(p, x, N_K))) revert Infeasible();
    }

    /// @dev Each type's rule (cap applied); the filler gets the rest (can be negative here).
    function _rules(bytes memory p, uint256 packs) internal pure returns (int256[] memory c) {
        uint256 T = _at(p, H_T);
        uint256 f = _at(p, H_FILLER);
        uint256 n = packs * _at(p, H_S);
        c = new int256[](T);
        int256 used;
        for (uint256 t; t < T; t++) {
            if (t == f) continue;
            uint256 base = _at(p, H_TYPES) + t * TW;
            uint256 rule = _at(p, base + T_SUPPLY);
            uint256 amt = _at(p, base + T_AMOUNT);
            uint256 x;
            if (rule == uint256(Supply.Share)) x = (amt * n + SHARE_SCALE / 2) / SHARE_SCALE;
            else if (rule == uint256(Supply.PerPack)) x = amt * packs;
            else x = amt;
            uint256 cap = _at(p, base + T_CAP);
            if (cap != 0 && x > cap * packs) x = cap * packs;
            c[t] = int256(x);
            used += int256(x);
        }
        c[f] = int256(n) - used;
    }

    /// @dev Sets without the filler, deepest first: if short of their slots, top up their lowest-ranked type.
    function _topUp(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs) internal pure {
        uint256 nn = sums.length;
        uint256 order = _at(p, H_DEPTH);
        for (uint256 i; i < nn; i++) {
            uint256 x = _at(p, order + i);
            if (_nodeAt(p, x, N_FILLER) != 0) continue;
            int256 short = int256(packs * _nodeAt(p, x, N_K)) - sums[x];
            if (short > 0) _move(p, c, sums, _at(p, H_FILLER), _nodeAt(p, x, N_LOWEST), short);
        }
    }

    /// @dev The filler can't go below 0, and sets holding it, from the filler up, take cards back if short.
    function _takeBack(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs) internal pure {
        uint256 f = _at(p, H_FILLER);
        uint256 fi = _inner(p, f);
        if (_nodeAt(p, fi, N_SINGLE) == 0 && c[f] < 0) _pull(p, c, sums, packs, type(uint256).max, -c[f]);
        for (uint256 x = fi;; x = _nodeAt(p, x, N_PARENT)) {
            int256 short = int256(packs * _nodeAt(p, x, N_K)) - sums[x];
            if (short > 0) _pull(p, c, sums, packs, x, short);
            if (x == 0) break;
        }
    }

    /// @dev Move `deficit` cards into the filler from types outside set `a`, without leaving any set short.
    function _pull(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs, uint256 a, int256 deficit)
        internal
        pure
    {
        uint256 last = _at(p, H_TRIM) + _at(p, H_T) - 1;
        for (uint256 i = _at(p, H_TRIM); i < last; i++) {
            uint256 t = _at(p, i);
            if (a != type(uint256).max && _inNode(p, t, a)) continue;
            int256 amt = _spare(p, c, sums, packs, t);
            if (amt <= 0) continue;
            if (amt > deficit) amt = deficit;
            _move(p, c, sums, t, _at(p, H_FILLER), amt);
            deficit -= amt;
            if (deficit == 0) return;
        }
        revert Infeasible();
    }

    /// @dev Cards of type `t` that can go to the filler without leaving a set short (sets not holding the filler).
    function _spare(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs, uint256 t)
        internal
        pure
        returns (int256 amt)
    {
        amt = c[t];
        for (uint256 x = _inner(p, t); _nodeAt(p, x, N_FILLER) == 0; x = _nodeAt(p, x, N_PARENT)) {
            int256 spare = sums[x] - int256(packs * _nodeAt(p, x, N_K));
            if (spare < amt) amt = spare;
        }
    }

    function _move(bytes memory p, int256[] memory c, int256[] memory sums, uint256 from, uint256 to, int256 amt)
        internal
        pure
    {
        c[from] -= amt;
        c[to] += amt;
        uint256 a = _inner(p, from);
        uint256 b = _inner(p, to);
        uint256 x = a;
        uint256 y = b;
        while (_nodeAt(p, x, N_DEPTH) > _nodeAt(p, y, N_DEPTH)) x = _nodeAt(p, x, N_PARENT);
        while (_nodeAt(p, y, N_DEPTH) > _nodeAt(p, x, N_DEPTH)) y = _nodeAt(p, y, N_PARENT);
        while (x != y) {
            x = _nodeAt(p, x, N_PARENT);
            y = _nodeAt(p, y, N_PARENT);
        }
        for (uint256 z = b; z != x; z = _nodeAt(p, z, N_PARENT)) sums[z] += amt;
        for (uint256 z = a; z != x; z = _nodeAt(p, z, N_PARENT)) sums[z] -= amt;
    }

    function _inNode(bytes memory p, uint256 t, uint256 a) internal pure returns (bool) {
        uint256 x = _inner(p, t);
        while (x != a) {
            if (x == 0) return false;
            x = _nodeAt(p, x, N_PARENT);
        }
        return true;
    }

    function _toUint(int256[] memory c) internal pure returns (uint256[] memory u) {
        u = new uint256[](c.length);
        for (uint256 i; i < c.length; i++) u[i] = uint256(c[i]);
    }

    // ================================================================ dealing internals

    /// @dev The Series' first deal: lay out its pool from the frozen pack count.
    function _start(uint256 fire, bytes memory p, State storage st) internal {
        (, bool closed,,, uint64 packs,) = CARDS.fires(fire);
        if (!closed) revert NotClosed();
        (int256[] memory c, int256[] memory sums) = _pool(p, packs);
        uint256 base = _cellBase(fire);
        for (uint256 t; t < c.length; t++) _setCell(base, t, uint256(c[t]));
        for (uint256 x = 1; x < sums.length; x++) {
            if (_nodeAt(p, x, N_SINGLE) == 0) _setCell(base, _nodeAt(p, x, N_CELL), uint256(sums[x]));
        }
        st.started = true;
        st.packs = packs;
        st.packsLeft = packs;
        st.characters = uint32(_names(fire).length);
        emit PoolSet(fire, packs, _toUint(c));
    }

    /// @dev One card for a group at set `x`: walk down the nested sets, each part weighted by its cards not held back
    ///      for the packs still to come (a type with no slots of its own: by its cards left). (Plan reads are inlined
    ///      here: this runs for every card.)
    function _draw(bytes memory p, uint256 x, uint256 r) internal returns (uint256 t) {
        uint256 d;
        uint256 tab;
        assembly {
            d := add(p, 32)
            tab := mload(add(d, shl(5, H_NODETAB)))
        }
        for (uint256 level;; level++) {
            uint256 rec;
            uint256 single;
            assembly {
                rec := mload(add(d, shl(5, add(tab, x))))
                single := mload(add(d, shl(5, add(rec, N_SINGLE))))
            }
            if (single != 0) {
                t = single - 1;
                break;
            }
            uint256 j = _pick(p, rec, _rand(r, 16 + level));
            uint256 id;
            uint256 nc;
            assembly {
                id := mload(add(d, shl(5, add(rec, add(N_LIST, j)))))
                nc := mload(add(d, shl(5, add(rec, N_NCHILD))))
            }
            if (j < nc) {
                x = id;
                continue;
            }
            t = id;
            break;
        }
        uint256 base;
        uint256 y;
        assembly {
            base := mload(add(d, shl(5, H_RT_CELLS)))
            y := mload(add(d, shl(5, add(add(mload(add(d, shl(5, H_TYPES))), mul(t, TW)), T_INNER))))
        }
        _dec(base, t);
        while (y != 0) {
            uint256 single;
            uint256 cell;
            assembly {
                let rec := mload(add(d, shl(5, add(tab, y))))
                single := mload(add(d, shl(5, add(rec, N_SINGLE))))
                cell := mload(add(d, shl(5, add(rec, N_CELL))))
                y := mload(add(d, shl(5, add(rec, N_PARENT))))
            }
            if (single == 0) _dec(base, cell);
        }
    }

    /// @dev Which part of set record `rec` (a child set, or a type in no child) a random number lands on.
    function _pick(bytes memory p, uint256 rec, uint256 rnd) internal view returns (uint256 j) {
        uint256 parts;
        uint256 total;
        assembly {
            let d := add(p, 32)
            parts := add(mload(add(d, shl(5, add(rec, N_NCHILD)))), mload(add(d, shl(5, add(rec, N_NBARE)))))
        }
        for (uint256 q; q < parts; q++) total += _weight(p, rec, q);
        if (total == 0) revert Infeasible();
        uint256 x = rnd % total;
        while (true) {
            uint256 w = _weight(p, rec, j);
            if (x < w) return j;
            x -= w;
            j++;
        }
    }

    /// @dev Weight of part `j` of set record `rec`: a child set's cards beyond what later packs need of it, or a free
    ///      type's cards left.
    function _weight(bytes memory p, uint256 rec, uint256 j) internal view returns (uint256 w) {
        uint256 have;
        uint256 need;
        assembly {
            let d := add(p, 32)
            let id := mload(add(d, shl(5, add(rec, add(N_LIST, j)))))
            let base := mload(add(d, shl(5, H_RT_CELLS)))
            let cell := id
            if lt(j, mload(add(d, shl(5, add(rec, N_NCHILD))))) {
                let crec := mload(add(d, shl(5, add(mload(add(d, shl(5, H_NODETAB))), id))))
                cell := mload(add(d, shl(5, add(crec, N_CELL))))
                need := mul(mload(add(d, shl(5, H_RT_LEFT))), mload(add(d, shl(5, add(crec, N_K)))))
            }
            have := and(shr(shl(7, and(cell, 1)), sload(add(base, shr(1, cell)))), 0xffffffffffffffffffffffffffffffff)
        }
        w = have - need; // checked: never below what later packs need
    }

    /// @dev A card's holo from two random words. Independent: frame and picture each hit below their chance (given
    ///      at least one hits, in a must-be-holo slot). Distribution: none / frame / picture / full by weight.
    function _holo(bytes memory p, uint256 t, bool must, uint256 r1, uint256 r2) internal pure returns (bool, bool) {
        uint256 mode;
        uint256 h0;
        uint256 h1;
        uint256 h2;
        uint256 h3;
        assembly {
            let rec := add(add(p, 32), shl(5, add(add(mload(add(p, add(32, shl(5, H_TYPES)))), mul(t, TW)), T_HOLOMODE)))
            mode := mload(rec)
            h0 := mload(add(rec, 32))
            h1 := mload(add(rec, 64))
            h2 := mload(add(rec, 96))
            h3 := mload(add(rec, 128))
        }
        if (mode == uint256(HoloMode.Independent)) {
            if (!must) return (r1 % HOLO_ONE < h0, r2 % HOLO_ONE < h1);
            // given at least one roll hits
            uint256 wf = h0 * (HOLO_ONE - h1);
            uint256 wp = (HOLO_ONE - h0) * h1;
            uint256 x = r1 % (wf + wp + h0 * h1);
            if (x < wf) return (true, false);
            if (x < wf + wp) return (false, true);
            return (true, true);
        }
        uint256 y = r1 % (must ? h1 + h2 + h3 : h0 + h1 + h2 + h3);
        if (!must) {
            if (y < h0) return (false, false);
            y -= h0;
        }
        if (y < h1) return (true, false);
        if (y < h1 + h2) return (false, true);
        return (true, true);
    }

    // ================================================================ low level

    function _at(bytes memory p, uint256 i) internal pure returns (uint256 v) {
        assembly {
            v := mload(add(add(p, 32), shl(5, i)))
        }
    }

    function _inner(bytes memory p, uint256 t) internal pure returns (uint256) {
        return _at(p, _at(p, H_TYPES) + t * TW + T_INNER);
    }

    function _nodeAt(bytes memory p, uint256 x, uint256 field) internal pure returns (uint256) {
        return _at(p, _at(p, _at(p, H_NODETAB) + x) + field);
    }

    function _rand(uint256 a, uint256 b) internal pure returns (uint256 v) {
        assembly {
            mstore(0, a)
            mstore(32, b)
            v := keccak256(0, 64)
        }
    }

    function _put(bytes memory p, uint256 i, uint256 v) internal pure {
        assembly {
            mstore(add(add(p, 32), shl(5, i)), v)
        }
    }

    function _cellBase(uint256 fire) internal pure returns (uint256 b) {
        assembly {
            mstore(0, fire)
            mstore(32, CELLS_TAG)
            b := keccak256(0, 64)
        }
    }

    function _cellAt(uint256 base, uint256 c) internal view returns (uint256 v) {
        assembly {
            v := and(shr(shl(7, and(c, 1)), sload(add(base, shr(1, c)))), 0xffffffffffffffffffffffffffffffff)
        }
    }

    function _setCell(uint256 base, uint256 c, uint256 v) internal {
        if (v > type(uint128).max) revert Infeasible();
        assembly {
            let slot := add(base, shr(1, c))
            let sh := shl(7, and(c, 1))
            sstore(slot, or(and(sload(slot), not(shl(sh, 0xffffffffffffffffffffffffffffffff))), shl(sh, v)))
        }
    }

    function _dec(uint256 base, uint256 c) internal {
        if (_cellAt(base, c) == 0) revert Infeasible();
        assembly {
            let slot := add(base, shr(1, c))
            sstore(slot, sub(sload(slot), shl(shl(7, and(c, 1)), 1)))
        }
    }

    /// @dev Data kept as contract code (cheap to read back): chunks of up to 24,000 bytes, each its own contract.
    function _replace(address[] storage ptrs, bytes memory data) internal {
        while (ptrs.length != 0) ptrs.pop();
        uint256 chunk = 24_000;
        for (uint256 off; off < data.length || off == 0; off += chunk) {
            uint256 len = data.length - off < chunk ? data.length - off : chunk;
            bytes memory code = abi.encodePacked(hex"63", uint32(len + 1), hex"80600e6000396000f300");
            bytes memory part = new bytes(len);
            for (uint256 i; i < len; i += 32) {
                assembly {
                    mstore(add(add(part, 32), i), mload(add(add(data, 32), add(off, i))))
                }
            }
            code = bytes.concat(code, part);
            address a;
            assembly {
                a := create(0, add(code, 32), mload(code))
            }
            if (a == address(0)) revert BadLength();
            ptrs.push(a);
            if (data.length == 0) break;
        }
    }

    /// @dev The compiled recipe (one chunk in the common case: read straight from its address).
    function _plan(uint256 fire) internal view returns (bytes memory out) {
        address a = _config[fire].plan;
        if (a == address(0)) revert NotConfigured();
        if (a == MULTI_CHUNK) return _read(_planData[fire]);
        uint256 sz = a.code.length - 1;
        out = new bytes(sz);
        assembly {
            extcodecopy(a, add(out, 32), 1, sz)
        }
    }

    function _read(address[] storage ptrs) internal view returns (bytes memory out) {
        uint256 n = ptrs.length;
        if (n == 0) revert NotConfigured();
        uint256 total;
        uint256[] memory sizes = new uint256[](n);
        address[] memory as_ = new address[](n);
        for (uint256 i; i < n; i++) {
            as_[i] = ptrs[i];
            sizes[i] = as_[i].code.length - 1;
            total += sizes[i];
        }
        out = new bytes(total);
        uint256 off;
        for (uint256 i; i < n; i++) {
            address a = as_[i];
            uint256 sz = sizes[i];
            assembly {
                extcodecopy(a, add(add(out, 32), off), 1, sz)
            }
            off += sz;
        }
    }
}
