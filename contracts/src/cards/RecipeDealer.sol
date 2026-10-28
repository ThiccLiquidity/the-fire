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

interface IRecipeCompiler {
    function compile(RecipeDealer.Recipe calldata r) external pure returns (bytes memory plan, uint256 perPack);
}

/**
 * @title RecipeDealer
 * @notice Deals each Series from its own recipe: every pack has the same shape (its slots), and every card is rolled
 *         on its own from its slot's fixed odds. Every setting is per Series and is fixed once the Series' first pack
 *         is minted (or the Series is locked or closed), so a buyer always knows the odds. Every setting can be read
 *         here.
 *
 *         A recipe:
 *         - Card types, in any number. Each has a name (the "Material" trait), a file slug (image file names) and a
 *           rank (rarity order, for display). Holo: two independent rolls (frame, picture) at chances out of 1e18, or
 *           weights for none / frame / picture / full.
 *         - Slots, in pack order: each a number of cards and its own odds, one weight per card type (0 = never in this
 *           slot). Cards per pack = the slots' counts added up. "3 Paper, 1 Wood, 1 Wood or better, 1 Fire or better"
 *           is four slots.
 *         - Characters (names and categories), any number, added in batches if the list is long, and optional
 *           character weights (none = every character equally likely).
 *         - Optionally one type dealt exactly once per character per Series (`onePerCharacter`, the Standard's Full
 *           Art). It is in no slot; see below.
 *
 *         Dealing (FireCards calls it, in opening order): every card of every pack is rolled on its own: its type by
 *         its slot's weights, then its holo by that type's holo odds, then its character by the character weights. A
 *         card's chance = its slot's type odds x holo odds x character odds. All from the pack's drand randomness:
 *         per card keccak256(packSeed, position).
 *
 *         One per character: as each pack starts, it carries one of that type with chance (still owed) / (packs still
 *         to deal, this one included), for a character that hasn't had one yet, picked at random. That card takes the
 *         place of the pack's first card (in the Standard, one of its three Papers); the pack's other cards are rolled
 *         as always. By the Series' last pack every character has exactly one, at random places nobody can know ahead
 *         (each pack's own fresh randomness decides). A Series needs at least as many packs as characters for all of
 *         them to come out; packs never opened keep theirs. This is the dealer's only state.
 */
contract RecipeDealer is IDealer, Ownable2Step {
    // ================================================================ recipe

    enum HoloMode {
        Independent, // holo[0] = frame chance, holo[1] = picture chance, out of 1e18; holo[2..3] = 0
        Distribution // holo = weights of none, frame, picture, full (any total above 0)
    }

    struct CardType {
        string name; // 1..64 bytes, no quotes, backslashes or control characters
        string slug; // 1..32 bytes of [a-z0-9-], unique in the recipe
        uint32 rank; // rarity order for display (higher = rarer); ties allowed
        HoloMode holoMode;
        uint64[4] holo;
    }

    /// @notice `count` cards in a row of the pack, each rolled from these odds: one weight per card type (recipe
    ///         order; 0 = never in this slot), a type's chance = its weight / the slot's total (above 0).
    struct Slot {
        uint32 count; // at least 1
        uint64[] weights;
    }

    struct Recipe {
        CardType[] types;
        Slot[] slots; // in pack order; cards per pack = the counts added up (1 to MAX_CARDS_PER_PACK)
        uint32 onePerCharacter; // 1 + the type dealt exactly once per character per Series, in no slot (0 = none)
    }

    uint256 public constant HOLO_ONE = 1e18;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_CATEGORY_BYTES = 32;

    IDealerCards public immutable CARDS;
    IDealerPacks public immutable PACKS;
    /// @notice The recipe checker and compiler (stateless; its own contract for size).
    IRecipeCompiler public immutable COMPILER;

    struct Config {
        address plan; // the compiled recipe's code-storage chunk (MULTI_CHUNK: several, in _planData); 0 = no recipe
        uint32 cardsPerPack;
        uint32 typeCount;
        uint32 onePerCharacter; // as in the recipe: 1 + the type, 0 = none
    }

    address private constant MULTI_CHUNK = address(1);

    mapping(uint256 fire => Config) internal _config;
    mapping(uint256 fire => address[]) internal _recipeData; // abi.encode(recipe), in code-storage chunks
    mapping(uint256 fire => address[]) internal _planData; // the compiled recipe the dealing reads
    /// @dev Characters: setCharacters starts a fresh list (a new generation) instead of deleting the old one, so a
    ///      long list can always be replaced. Character weights belong to a generation too (a new list starts uniform).
    mapping(uint256 fire => uint256) internal _charGen;
    mapping(uint256 fire => mapping(uint256 gen => string[])) internal _nameLists;
    mapping(uint256 fire => mapping(uint256 gen => string[])) internal _categoryLists;
    /// @dev Cumulative character weights (one uint256 word per character), in code-storage chunks; none = uniform.
    mapping(uint256 fire => mapping(uint256 gen => address[])) internal _charOdds;
    /// @notice One-per-character cards dealt so far in a Series.
    mapping(uint256 fire => uint256) public onePerCharacterDealt;
    /// @dev The characters still owed one, as a sparse shuffle: entry i is _owed[fire][i] - 1 (or i when 0), for
    ///      i below (characters - dealt).
    mapping(uint256 fire => mapping(uint256 => uint256)) internal _owed;

    /// @dev Domain tag for the one-per-character roll (kept apart from the cards' own randomness).
    uint256 internal constant ONE_PER_TAG = uint256(keccak256("omni.dealer.onePerCharacter"));

    event RecipeSet(uint256 indexed fire, uint256 cardsPerPack, uint256 types, uint256 slots);
    event CharactersSet(uint256 indexed fire, uint256 count);
    event CharactersAdded(uint256 indexed fire, uint256 first, uint256 count);
    event CharacterWeightsSet(uint256 indexed fire, uint256 count, uint256 total);
    event OnePerCharacterDealt(uint256 indexed fire, uint256 indexed character, uint256 left);

    error RenounceDisabled();
    error FireIsLocked();
    error NotConfigured();
    error BadText();
    error BadLength();
    error BadDeal();
    error NotCards();
    /// @notice Character weights: one per character, each at least 1 (or none, for equal odds).
    error BadWeights();
    /// @notice Raised by RecipeCompiler (setRecipe and check pass it on): no types, no slots, or cards per pack (the
    ///         slots' counts added up) above 1,000.
    error BadRecipe(string why);
    /// @notice Raised by RecipeCompiler: a card type that isn't valid (or that no slot can deal), and why.
    error BadType(uint256 index, string why);
    /// @notice Raised by RecipeCompiler: a slot that isn't valid, and why.
    error BadSlot(uint256 index, string why);

    constructor(address owner_, address cards, address compiler) Ownable(owner_) {
        CARDS = IDealerCards(cards);
        PACKS = IDealerPacks(IDealerCards(cards).PACKS());
        COMPILER = IRecipeCompiler(compiler);
    }

    // ================================================================ owner

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Set (or replace) a Series' recipe. Until the Series' first pack is minted, it is locked or closed.
    function setRecipe(uint256 fire, Recipe calldata r) external onlyOwner {
        _checkOpen(fire);
        (bytes memory planBytes, uint256 perPack) = COMPILER.compile(r);
        _replace(_planData[fire], planBytes);
        Recipe memory m = r;
        _replace(_recipeData[fire], abi.encode(m));
        address first = _planData[fire].length == 1 ? _planData[fire][0] : MULTI_CHUNK;
        _config[fire] = Config(first, uint32(perPack), uint32(m.types.length), m.onePerCharacter);
        emit RecipeSet(fire, perPack, m.types.length, m.slots.length);
    }

    /// @notice Replace a Series' characters (names and categories, in image order: c0, c1, ...). At least one. The
    ///         new list starts with equal odds (set weights again with setCharacterWeights).
    function setCharacters(uint256 fire, string[] calldata names, string[] calldata categories) external onlyOwner {
        _checkOpen(fire);
        if (names.length == 0) revert BadLength();
        _charGen[fire] += 1;
        _addCharacters(fire, names, categories);
        emit CharactersSet(fire, names.length);
    }

    /// @notice Add characters after the ones already set (for long lists, in batches). Same lock as setCharacters.
    ///         If weights are set, they must be set again for the longer list before the Series is ready.
    function appendCharacters(uint256 fire, string[] calldata names, string[] calldata categories) external onlyOwner {
        _checkOpen(fire);
        uint256 first = _names(fire).length;
        _addCharacters(fire, names, categories);
        emit CharactersAdded(fire, first, names.length);
    }

    /// @notice Give the characters their own odds: one weight per character (in character order, each at least 1);
    ///         a character's chance is its weight over the total. An empty list = every character equally likely
    ///         (the default). Same lock as setCharacters.
    function setCharacterWeights(uint256 fire, uint64[] calldata weights) external onlyOwner {
        _checkOpen(fire);
        uint256 n = weights.length;
        address[] storage ptrs = _charOdds[fire][_charGen[fire]];
        if (n == 0) {
            while (ptrs.length != 0) ptrs.pop();
            emit CharacterWeightsSet(fire, 0, 0);
            return;
        }
        if (n != _names(fire).length) revert BadWeights();
        uint256[] memory cum = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; i++) {
            if (weights[i] == 0) revert BadWeights();
            total += weights[i];
            cum[i] = total;
        }
        _replace(ptrs, abi.encodePacked(cum));
        emit CharacterWeightsSet(fire, n, total);
    }

    // ================================================================ IDealer

    /// @notice A recipe, at least one character, and character weights either unset or one per character.
    function ready(uint256 fire) public view returns (bool) {
        if (_config[fire].plan == address(0)) return false;
        uint256 n = _names(fire).length;
        address[] storage w = _charOdds[fire][_charGen[fire]];
        return n != 0 && (w.length == 0 || _size(w) == n * 32);
    }

    function cardsPerPack(uint256 fire) external view returns (uint256) {
        return _config[fire].cardsPerPack;
    }

    function characterCount(uint256 fire) external view returns (uint256) {
        return _names(fire).length;
    }

    /// @notice FireCards only: cards `fromCard` .. `fromCard + count - 1` of a pack dealt from `seed` (each pack's
    ///         seed). The slot cards are `roll`; a pack's first card may instead be its one-per-character card.
    function deal(uint256 fire, uint256 seed, uint256 fromCard, uint256 count) external returns (uint256[] memory out) {
        if (msg.sender != address(CARDS)) revert NotCards();
        bytes memory p = _plan(fire);
        if (count == 0 || fromCard + count > _at(p, H_S)) revert BadDeal();
        (bytes memory cw, uint256 chars) = _charWeights(fire);
        out = _dealRange(p, cw, chars, seed, fromCard, count);
        uint256 one = _config[fire].onePerCharacter;
        if (fromCard == 0 && one != 0) _onePerCharacter(fire, p, one - 1, chars, seed, out);
    }

    /// @notice The slot cards of a pack from `seed`: each rolled on its own from keccak256(seed, position) at its
    ///         slot's odds, so this depends only on the seed and the Series' fixed settings (anyone can check a pack;
    ///         a pack's first card may have become its one-per-character card instead).
    function roll(uint256 fire, uint256 seed, uint256 fromCard, uint256 count) external view returns (uint256[] memory out) {
        bytes memory p = _plan(fire);
        if (count == 0 || fromCard + count > _at(p, H_S)) revert BadDeal();
        (bytes memory cw, uint256 chars) = _charWeights(fire);
        out = _dealRange(p, cw, chars, seed, fromCard, count);
    }

    /// @dev As a pack starts: with chance (still owed) / (packs still to deal, this one included) its first card
    ///      becomes type `t` for a character still owed one, picked at random. Certain once the packs left are no more
    ///      than the characters owed, so every character has exactly one by the Series' last pack.
    function _onePerCharacter(uint256 fire, bytes memory p, uint256 t, uint256 chars, uint256 seed, uint256[] memory out)
        internal
    {
        uint256 done = onePerCharacterDealt[fire];
        if (done >= chars) return;
        uint256 owed = chars - done;
        (,,,, uint64 packs, uint64 dealtPacks) = CARDS.fires(fire);
        uint256 left = packs > dealtPacks ? packs - dealtPacks : 1;
        uint256 r = _rand(seed, ONE_PER_TAG);
        if (left > owed && r % left >= owed) return;
        uint256 ch = _takeOwed(fire, _rand(r, 1) % owed, owed);
        onePerCharacterDealt[fire] = done + 1;
        (bool hf, bool hp) = _holo(p, t, _rand(r, 2), _rand(r, 3));
        out[0] = t | (ch << 32) | (hf ? 1 << 64 : 0) | (hp ? 1 << 65 : 0);
        emit OnePerCharacterDealt(fire, ch, owed - 1);
    }

    /// @dev Take entry `j` of the `owed` characters still owed; the last one owed takes its place.
    function _takeOwed(uint256 fire, uint256 j, uint256 owed) internal returns (uint256 ch) {
        ch = _owedAt(fire, j);
        _owed[fire][j] = _owedAt(fire, owed - 1) + 1;
    }

    function _owedAt(uint256 fire, uint256 i) internal view returns (uint256) {
        uint256 v = _owed[fire][i];
        return v == 0 ? i : v - 1;
    }

    /// @notice The characters still owed their one-per-character card (unordered), for collectors tracking which
    ///         are still out there. Empty when the Series has no such type or all are dealt.
    function onePerCharacterOwed(uint256 fire) external view returns (uint256[] memory chars) {
        if (_config[fire].onePerCharacter == 0) return chars;
        uint256 n = _names(fire).length;
        uint256 done = onePerCharacterDealt[fire];
        chars = new uint256[](done < n ? n - done : 0);
        for (uint256 i; i < chars.length; i++) chars[i] = _owedAt(fire, i);
    }

    /// @dev The character count and cumulative character weights ("" = equal odds) that dealing reads.
    function _charWeights(uint256 fire) internal view returns (bytes memory cw, uint256 chars) {
        chars = _names(fire).length;
        address[] storage w = _charOdds[fire][_charGen[fire]];
        cw = w.length == 0 ? bytes("") : _read(w);
        if (chars == 0 || (cw.length != 0 && cw.length != chars * 32)) revert NotConfigured();
    }

    /// @dev Cards `from` .. `from + count - 1`, each at its slot's odds.
    function _dealRange(bytes memory p, bytes memory cw, uint256 chars, uint256 seed, uint256 from, uint256 count)
        internal
        pure
        returns (uint256[] memory out)
    {
        out = new uint256[](count);
        uint256 at = HEADER + _at(p, H_T) * TW; // the first slot's record
        for (uint256 pos = from; pos < from + count; pos++) {
            while (pos >= _at(p, at)) at += SW_HEAD + _at(p, H_T); // the slot this card is in (a record starts with its end)
            out[pos - from] = _dealOne(p, at, cw, chars, _rand(seed, pos));
        }
    }

    /// @dev One card: type by its slot's weights (the slot record at word `s`), holo by the type's odds, character by
    ///      weight (uniform with no weights).
    function _dealOne(bytes memory p, uint256 s, bytes memory cw, uint256 chars, uint256 r) internal pure returns (uint256) {
        uint256 t = _search(p, s + SW_HEAD, 1, _at(p, H_T), r % _at(p, s + 1));
        (bool hf, bool hp) = _holo(p, t, _rand(r, 1), _rand(r, 2));
        uint256 r3 = _rand(r, 3);
        uint256 ch = cw.length == 0 ? r3 % chars : _search(cw, 0, 1, chars, r3 % _at(cw, chars - 1));
        return t | (ch << 32) | (hf ? 1 << 64 : 0) | (hp ? 1 << 65 : 0);
    }

    /// @dev The first of `n` cumulative weights (word `start + i * stride` of `d`) above `x`: binary search.
    function _search(bytes memory d, uint256 start, uint256 stride, uint256 n, uint256 x) internal pure returns (uint256 lo) {
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi) >> 1;
            if (_at(d, start + mid * stride) > x) hi = mid;
            else lo = mid + 1;
        }
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
    function check(Recipe calldata r) external view returns (uint256 perPack) {
        (, perPack) = COMPILER.compile(r);
    }

    /// @notice The shape and odds of a Series' packs, slot by slot (pack order): each slot's number of cards, its
    ///         weight for each type (recipe order; 0 = never in that slot) and their total. A card in slot s is type t
    ///         with chance weights[s][t] / totals[s], the same in every pack.
    function slotsOf(uint256 fire)
        external
        view
        returns (uint256[] memory counts, uint256[][] memory weights, uint256[] memory totals)
    {
        bytes memory p = _plan(fire);
        uint256 n = _at(p, H_T);
        uint256 k = _at(p, H_SLOTS);
        counts = new uint256[](k);
        weights = new uint256[][](k);
        totals = new uint256[](k);
        uint256 at = HEADER + n * TW;
        uint256 end;
        for (uint256 s; s < k; s++) {
            counts[s] = _at(p, at) - end;
            end = _at(p, at);
            totals[s] = _at(p, at + 1);
            uint256[] memory w = new uint256[](n);
            uint256 prev;
            for (uint256 t; t < n; t++) {
                uint256 c = _at(p, at + SW_HEAD + t);
                w[t] = c - prev;
                prev = c;
            }
            weights[s] = w;
            at += SW_HEAD + n;
        }
    }

    /// @notice The character odds of a Series: each character's weight (character order) and their total. With no
    ///         weights set every character has weight 1.
    function characterOddsOf(uint256 fire) external view returns (uint256[] memory weights, uint256 total) {
        uint256 n = _names(fire).length;
        weights = new uint256[](n);
        address[] storage w = _charOdds[fire][_charGen[fire]];
        if (w.length == 0) {
            for (uint256 i; i < n; i++) weights[i] = 1;
            return (weights, n);
        }
        bytes memory cw = _read(w);
        uint256 m = cw.length / 32 < n ? cw.length / 32 : n;
        uint256 prev;
        for (uint256 i; i < m; i++) {
            uint256 c = _at(cw, i);
            weights[i] = c - prev;
            prev = c;
        }
        total = prev;
    }

    /// @notice Chance (out of 1e18) that a card of a type comes out none / frame / picture / full holo.
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

    /// @dev Text that goes into the token JSON as-is: valid UTF-8, no quotes, backslashes or control characters.
    function _checkText(bytes memory b) internal pure {
        uint256 i;
        while (i < b.length) {
            uint8 c = uint8(b[i]);
            if (c < 0x80) {
                if (c < 0x20 || c == 0x22 || c == 0x5c || c == 0x7f) revert BadText();
                i++;
                continue;
            }
            uint256 n = c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : 0;
            if (n == 0 || i + n >= b.length) revert BadText(); // a lead byte with its continuation bytes missing
            uint8 lo = 0x80;
            uint8 hi = 0xbf;
            if (c == 0xe0) lo = 0xa0; // no overlong 3-byte forms
            else if (c == 0xed) hi = 0x9f; // no UTF-16 surrogates
            else if (c == 0xf0) lo = 0x90; // no overlong 4-byte forms
            else if (c == 0xf4) hi = 0x8f; // nothing past U+10FFFF
            uint8 c1 = uint8(b[i + 1]);
            if (c1 < lo || c1 > hi) revert BadText();
            for (uint256 k = 2; k <= n; k++) if (uint8(b[i + k]) & 0xc0 != 0x80) revert BadText();
            i += n + 1;
        }
    }

    // ================================================================ the compiled recipe (RecipeCompiler writes it)

    uint256 private constant H_T = 0; // types
    uint256 private constant H_S = 1; // cards per pack
    uint256 private constant H_SLOTS = 2; // slots
    uint256 private constant HEADER = 3;
    // Type record (TW words): holo mode, holo[0..3]
    uint256 private constant TW = 5;
    uint256 private constant T_HOLOMODE = 0;
    // Slot record (SW_HEAD + types words), after the type records, in pack order: the position just past the slot (its
    // end), its total weight, then the cumulative weight of each type (that type and every one before it)
    uint256 private constant SW_HEAD = 2;

    /// @dev A card's holo from two random words. Independent: frame and picture each hit below their chance.
    ///      Distribution: none / frame / picture / full by weight.
    function _holo(bytes memory p, uint256 t, uint256 r1, uint256 r2) internal pure returns (bool, bool) {
        uint256 mode;
        uint256 h0;
        uint256 h1;
        uint256 h2;
        uint256 h3;
        assembly {
            let rec := add(add(p, 32), shl(5, add(add(HEADER, mul(t, TW)), T_HOLOMODE)))
            mode := mload(rec)
            h0 := mload(add(rec, 32))
            h1 := mload(add(rec, 64))
            h2 := mload(add(rec, 96))
            h3 := mload(add(rec, 128))
        }
        if (mode == uint256(HoloMode.Independent)) return (r1 % HOLO_ONE < h0, r2 % HOLO_ONE < h1);
        uint256 y = r1 % (h0 + h1 + h2 + h3);
        if (y < h0) return (false, false);
        y -= h0;
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

    function _rand(uint256 a, uint256 b) internal pure returns (uint256 v) {
        assembly {
            mstore(0, a)
            mstore(32, b)
            v := keccak256(0, 64)
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

    function _size(address[] storage ptrs) internal view returns (uint256 total) {
        for (uint256 i; i < ptrs.length; i++) total += ptrs[i].code.length - 1;
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
