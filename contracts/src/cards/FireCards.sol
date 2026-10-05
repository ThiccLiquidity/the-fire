// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {CardRules} from "./CardRules.sol";

interface IRandomnessSource {
    function request() external returns (uint256 requestId);
    function answered(uint256 requestId) external view returns (bool);
}

interface IFirePacks {
    function burnForOpen(address from, uint256 fire, uint256 amount) external;
    function returnPacks(address to, uint256 fire, uint256 amount) external;
    function minted(uint256 fire) external view returns (uint256);
}

/**
 * @title FireCards
 * @notice The cards. Every card is a unique ERC-721 (token id = its global serial).
 *
 *         How a pack is opened:
 *         1. When a Series goes out, the seller closes it: the contract freezes the pack count and works out the Series'
 *            pool from that count and the Series' Diamond setting (CardRules.computePool, ported exactly from the
 *            studio). Each Series stands alone: nothing carries over from earlier Series.
 *         2. A holder calls open(): their sealed pack is burned and fresh drand randomness is requested. Nothing about
 *            the pack existed before this; its cards depend on randomness that doesn't exist yet. (The leftover
 *            pool is public, so the very last pack of a Series gets exactly what's left: a cost of exact totals.)
 *         3. When the randomness arrives, anyone calls process(maxOpens) (the site or the keeper, right away).
 *            Packs are dealt strictly in the order they were opened, each drawing its 6 cards from what is left of
 *            the Series' pool while keeping the pack guarantees (slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6
 *            Fire-or-better). The result of a pack depends only on the random words and the order of open() calls,
 *            so nobody can gain by choosing when to process, and the Series' totals come out exact.
 *         Cards are minted without the receiver callback, so no holder's contract can stall the queue for others.
 *
 *         The owner configures each Series before its packs sell (its characters, names and categories, where its
 *         images live, and how many Diamonds it makes: at least 1), can move a Series' image folder until it locks
 *         it, and sets the royalty. Nobody can change a card once it is dealt.
 */
contract FireCards is ERC721, ERC2981, Ownable2Step {
    using Strings for uint256;

    uint256 public constant MAX_OPEN = 10;
    /// @dev An open's randomness can be asked for again only after a full day with no answer. drand publishes each
    ///      round's number ~30s before anyone delivers it, so a short wait would let an opener who dislikes the cards
    ///      they can already see re-roll while the keeper is down. Anyone (the site, the keeper) can deliver a word.
    uint256 public constant REREQUEST_AFTER = 1 days;
    uint96 public constant MAX_ROYALTY_BPS = 1_000;
    uint256 public constant MAX_DIAMONDS = 1_000;
    /// @notice Longest category text, in bytes (UTF-8).
    uint256 public constant MAX_CATEGORY_BYTES = 32;
    /// @notice Longest card name, in bytes (UTF-8).
    uint256 public constant MAX_NAME_BYTES = 64;
    /// @dev Last resort if randomness is gone for good: an open with no answer this long can be cancelled and its
    ///      packs go back to the holder, sealed. (A week is far past any normal delay.)
    uint256 public constant CANCEL_AFTER = 7 days;

    IFirePacks public immutable PACKS;
    IRandomnessSource public randomness;
    address public seller;
    /// @notice The PDA reveal contract (FirePsa): the only one that can set a card's grade, once.
    address public psa;

    struct FireInfo {
        bool closed;
        bool locked; // metadata frozen
        uint8 characterCount;
        uint32 packs; // frozen at close
        uint32 dealt; // packs dealt so far
        uint32 packsLeft; // packs not yet dealt (each still needs a Fire-or-better for slot 6)
        uint32 fireLeft; // Fire-or-better cards left, by tier
        uint32 charcoalLeft;
        uint32 diamondLeft;
        uint32 flexWoodLeft; // Wood beyond slot 4, available for slot 5
    }

    struct Open {
        address to;
        uint32 fire;
        uint16 count;
        uint64 requestedAt;
        bool ready;
        uint256 requestId;
        uint256 word;
    }

    mapping(uint256 fire => FireInfo) public fires;
    mapping(uint256 fire => uint256[5]) public poolOf; // the Series' pool at close, for anyone to check
    mapping(uint256 fire => string[]) internal _names;
    mapping(uint256 fire => string[]) internal _categories;
    mapping(uint256 fire => string) public imagesBase;

    /// @notice Diamonds the owner set for a Series (0 = not set, which means 1). See diamondsFor.
    mapping(uint256 fire => uint256) public diamondsOf;
    uint256 public nextSerial = 1;

    Open[] public opens;
    uint256 public head; // next open to deal
    mapping(uint256 requestId => uint256) internal _openOf; // open index + 1

    /// @dev Per card: fire (bits 0-31), material (32-39), holo frame (40), holo picture (41), character (48-55),
    ///      edition (64-95), grade 0 = unrevealed (96-103).
    mapping(uint256 tokenId => uint256) internal _card;
    mapping(bytes32 => uint32) internal _editions; // (fire, character, material) -> cards dealt so far
    /// @notice A PDA reveal is waiting for its randomness: the card can't move until its grade is set, so nobody can
    ///         sell a card whose (already public) grade they know is bad as "Unrevealed".
    mapping(uint256 tokenId => bool) public gradePending;

    event RandomnessSet(address source);
    event PsaSet(address psa);
    event Rerequested(uint256 indexed openIndex, uint256 requestId);
    event OpenCancelled(uint256 indexed openIndex, address indexed holder, uint256 fire, uint256 count);
    event RoyaltySet(address receiver, uint96 bps);
    event GradePending(uint256 indexed tokenId, bool pending);
    event MetadataUpdate(uint256 tokenId); // ERC-4906
    event SellerSet(address seller);
    event FireConfigured(uint256 indexed fire, uint256 characters, string imagesBase);
    event FireLocked(uint256 indexed fire);
    event ImagesBaseSet(uint256 indexed fire, string imagesBase);
    event DiamondsSet(uint256 indexed fire, uint256 diamonds);
    event FireClosed(uint256 indexed fire, uint256 packs, uint256[5] pool);
    event PacksOpened(uint256 indexed openIndex, address indexed holder, uint256 indexed fire, uint256 count, uint256 requestId);
    event OpenReady(uint256 indexed openIndex, uint256 word);
    event CardDealt(uint256 indexed openIndex, uint256 indexed serial, uint256 fire, uint256 material, bool holoFrame, bool holoPicture, uint256 character);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId); // ERC-4906

    error AlreadySet();
    error ZeroAddress();
    error NotSeller();
    error NotRandomness();
    error FireIsClosed();
    error FireNotClosed();
    error FireIsLocked();
    error NotConfigured();
    error BadCount();
    error NothingLeft();
    error NotStuck();
    error BadLength();
    error NotHolder();
    error NotPsa();
    error AlreadyGraded();
    error BadGrade();
    error BadText();
    error GradingInProgress();
    error RoyaltyTooHigh();
    error BadDiamonds();

    constructor(address owner_, address packs_) ERC721("Omni Cards", "OMNICARD") Ownable(owner_) {
        if (packs_ == address(0)) revert ZeroAddress();
        PACKS = IFirePacks(packs_);
    }

    // ---------- owner setup ----------

    function setRandomness(address source) external onlyOwner {
        if (address(randomness) != address(0)) revert AlreadySet();
        if (source == address(0)) revert ZeroAddress();
        randomness = IRandomnessSource(source);
        emit RandomnessSet(source);
    }

    function setSeller(address s) external onlyOwner {
        if (seller != address(0)) revert AlreadySet();
        if (s == address(0)) revert ZeroAddress();
        seller = s;
        emit SellerSet(s);
    }

    function setPsa(address p) external onlyOwner {
        if (psa != address(0)) revert AlreadySet();
        if (p == address(0)) revert ZeroAddress();
        psa = p;
        emit PsaSet(p);
    }

    /// @notice A Series' characters (names and categories, in the studio's order) and where its card images live
    ///         (ipfs://<CID>/ or ar://<id>/). Allowed until the Series is locked or its first pack is minted,
    ///         whichever comes first (setImagesBase can still move the image folder until the lock). Names are 0 to
    ///         MAX_NAME_BYTES bytes; categories are free text, one per character (1 to MAX_CATEGORY_BYTES bytes), set
    ///         in the studio.
    function configureFire(uint256 fire, string[] calldata names, string[] calldata categories, string calldata base)
        external
        onlyOwner
    {
        if (fire > type(uint32).max) revert BadLength(); // cards store the Series in 32 bits
        FireInfo storage f = fires[fire];
        if (f.locked) revert FireIsLocked();
        // once its packs are selling, a Series' characters are fixed (names can't change under buyers, and the number
        // of characters caps suggestion picks)
        if (PACKS.minted(fire) != 0) revert FireIsLocked();
        _checkText(base);
        for (uint256 i; i < names.length; i++) {
            if (bytes(names[i]).length > MAX_NAME_BYTES) revert BadText();
            _checkText(names[i]);
        }
        for (uint256 i; i < categories.length; i++) {
            uint256 n = bytes(categories[i]).length;
            if (n == 0 || n > MAX_CATEGORY_BYTES) revert BadText();
            _checkText(categories[i]);
        }
        if (names.length == 0 || names.length > 255 || names.length != categories.length) revert BadLength();
        if (f.closed && names.length != f.characterCount) revert BadLength(); // dealt cards point at these indexes
        delete _names[fire];
        delete _categories[fire];
        for (uint256 i; i < names.length; i++) {
            _names[fire].push(names[i]);
            _categories[fire].push(categories[i]);
        }
        f.characterCount = uint8(names.length);
        imagesBase[fire] = base;
        emit FireConfigured(fire, names.length, base);
        if (nextSerial > 1) emit BatchMetadataUpdate(1, nextSerial - 1);
    }

    /// @notice Move a Series' image folder (say, re-pinned elsewhere). Allowed until the Series is locked, even after
    ///         its packs are selling: only where the images live changes, never what a card is.
    function setImagesBase(uint256 fire, string calldata base) external onlyOwner {
        FireInfo storage f = fires[fire];
        if (f.locked) revert FireIsLocked();
        if (f.characterCount == 0) revert NotConfigured();
        _checkText(base);
        imagesBase[fire] = base;
        emit ImagesBaseSet(fire, base);
        if (nextSerial > 1) emit BatchMetadataUpdate(1, nextSerial - 1);
    }

    /// @notice How many Diamonds a Series makes (1 to MAX_DIAMONDS; never more than one per pack). Fixed the same way
    ///         its characters are: not once the Series is locked, its packs are selling, or it is closed.
    function setDiamonds(uint256 fire, uint256 n) external onlyOwner {
        if (n == 0 || n > MAX_DIAMONDS) revert BadDiamonds();
        FireInfo storage f = fires[fire];
        if (f.locked || f.closed || PACKS.minted(fire) != 0) revert FireIsLocked();
        diamondsOf[fire] = n;
        emit DiamondsSet(fire, n);
    }

    /// @notice The Diamond setting a Series uses: what the owner set, or 1.
    function diamondsFor(uint256 fire) public view returns (uint256) {
        uint256 d = diamondsOf[fire];
        return d == 0 ? 1 : d;
    }

    function lockFire(uint256 fire) external onlyOwner {
        if (fires[fire].characterCount == 0) revert NotConfigured();
        fires[fire].locked = true;
        emit FireLocked(fire);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        emit RoyaltySet(receiver, bps);
        _setDefaultRoyalty(receiver, bps);
    }

    // ---------- the Series goes out ----------

    /// @notice The seller closes a Series when it goes out: the pack count is frozen and the pool is worked out.
    function closeFire(uint256 fire) external {
        if (msg.sender != seller) revert NotSeller();
        FireInfo storage f = fires[fire];
        if (f.closed) revert FireIsClosed();
        if (f.characterCount == 0) revert NotConfigured();
        uint256 packs = PACKS.minted(fire);
        uint256[5] memory pool = CardRules.computePool(packs, diamondsFor(fire));
        f.closed = true;
        f.packs = uint32(packs);
        f.packsLeft = uint32(packs);
        f.fireLeft = uint32(pool[CardRules.FIRE]);
        f.charcoalLeft = uint32(pool[CardRules.CHARCOAL]);
        f.diamondLeft = uint32(pool[CardRules.DIAMOND]);
        f.flexWoodLeft = uint32(pool[CardRules.WOOD] - packs);
        poolOf[fire] = pool;
        emit FireClosed(fire, packs, pool);
    }

    /// @notice The seller burns cards for their holder (the sale contract's burnCards, which counts them toward free
    ///         pack credits). The holder is whoever called the seller, so no approval is needed and nobody else's
    ///         cards can be burned.
    function burnFor(address from, uint256[] calldata ids) external {
        if (msg.sender != seller) revert NotSeller();
        for (uint256 i; i < ids.length; i++) {
            if (_ownerOf(ids[i]) != from) revert NotHolder();
            _burn(ids[i]);
        }
    }

    /// @notice The PDA contract marks cards whose reveal is waiting for randomness (they can't be transferred until
    ///         graded) and clears the mark.
    function setGradePending(uint256 serial, bool pending_) external {
        if (msg.sender != psa) revert NotPsa();
        gradePending[serial] = pending_;
        emit GradePending(serial, pending_);
    }

    /// @notice The PDA contract sets a card's grade (1-10), once. Its image switches to that grade's image.
    function setGrade(uint256 serial, uint256 grade) external {
        if (msg.sender != psa) revert NotPsa();
        if (gradePending[serial]) {
            delete gradePending[serial];
            emit GradePending(serial, false);
        }
        if (grade == 0 || grade > 10) revert BadGrade();
        _requireOwned(serial);
        uint256 d = _card[serial];
        if (uint8(d >> 96) != 0) revert AlreadyGraded();
        _card[serial] = d | (grade << 96);
        emit MetadataUpdate(serial);
    }

    /// @notice For the PDA contract: whether a card exists, its Series and its grade (0 = unrevealed).
    function gradeInfo(uint256 serial) external view returns (bool exists, uint256 fire, uint256 grade) {
        if (_ownerOf(serial) == address(0)) return (false, 0, 0);
        uint256 d = _card[serial];
        return (true, uint32(d), uint8(d >> 96));
    }

    // ---------- opening ----------

    /// @notice Open `count` sealed packs from `fire` (burned now; cards are dealt once the randomness arrives).
    function open(uint256 fire, uint256 count) external returns (uint256 index) {
        if (count == 0 || count > MAX_OPEN) revert BadCount();
        if (!fires[fire].closed) revert FireNotClosed();
        PACKS.burnForOpen(msg.sender, fire, count);
        uint256 id = randomness.request();
        index = opens.length;
        opens.push(Open(msg.sender, uint32(fire), uint16(count), uint64(block.timestamp), false, id, 0));
        _openOf[id] = index + 1;
        emit PacksOpened(index, msg.sender, fire, count, id);
    }

    /// @dev Randomness callback: only stores the word (cheap, can't fail); dealing happens in process(maxOpens).
    function onRandomness(uint256 requestId, uint256 word) external {
        if (msg.sender != address(randomness)) revert NotRandomness();
        uint256 i = _openOf[requestId];
        if (i == 0) return; // stale request (replaced by rerequest)
        Open storage o = opens[i - 1];
        if (o.ready) return;
        o.word = word;
        o.ready = true;
        delete _openOf[requestId];
        emit OpenReady(i - 1, word);
    }

    /// @notice If an open's randomness never arrived (a day on, and the router has no answer), anyone can ask again.
    function rerequest(uint256 index) external {
        Open storage o = opens[index];
        if (o.ready || block.timestamp < o.requestedAt + REREQUEST_AFTER || randomness.answered(o.requestId)) revert NotStuck();
        delete _openOf[o.requestId];
        uint256 id = randomness.request();
        o.requestId = id;
        o.requestedAt = uint64(block.timestamp);
        _openOf[id] = index + 1;
        emit Rerequested(index, id);
    }

    /// @notice If an open's randomness has had no answer for CANCEL_AFTER (randomness gone for good), anyone can
    ///         cancel it: its packs go back to the holder, sealed, and the queue moves on.
    function cancelOpen(uint256 index) external {
        Open storage o = opens[index];
        if (o.ready || block.timestamp < o.requestedAt + CANCEL_AFTER || randomness.answered(o.requestId)) revert NotStuck();
        delete _openOf[o.requestId];
        uint256 count = o.count;
        o.count = 0; // dealt as nothing when the queue reaches it
        o.ready = true;
        PACKS.returnPacks(o.to, o.fire, count);
        emit OpenCancelled(index, o.to, o.fire, count);
    }

    /// @notice Deal ready opens, oldest first, until one isn't ready or `maxOpens` are done. Anyone may call.
    function process(uint256 maxOpens) public returns (uint256 done) {
        uint256 h = head;
        while (done < maxOpens && h < opens.length && opens[h].ready) {
            Open memory o = opens[h];
            for (uint256 j; j < o.count; j++) _dealPack(h, o.to, o.fire, uint256(keccak256(abi.encode(o.word, j))));
            h++;
            done++;
        }
        head = h;
    }

    function pending() external view returns (uint256 queued, uint256 readyAtHead) {
        queued = opens.length - head;
        for (uint256 h = head; h < opens.length && opens[h].ready; h++) readyAtHead++;
    }

    function _r(uint256 seed, uint256 i) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i)));
    }

    /// @dev One pack: draws slot 6 from the Fire-or-better cards left, slot 5 from the flexible pile (the
    ///      Fire-or-better cards not needed for later packs' slot 6, plus spare Wood), then character and holo per
    ///      card, then mints the six in a shuffled order so a serial says nothing about its slot.
    function _dealPack(uint256 openIndex, address to, uint256 fire, uint256 seed) private {
        FireInfo storage f = fires[fire];
        if (f.packsLeft == 0) revert NothingLeft();
        uint256[6] memory mats = [uint256(0), 0, 0, CardRules.WOOD, 0, 0];

        // slot 6: uniform over the Fire-or-better cards left
        mats[5] = _drawBP(f, _r(seed, 6));
        f.packsLeft--;
        // slot 5: the flex pile holds (BP left - packs still needing slot 6) BP cards plus the spare Wood
        uint256 bpLeft = uint256(f.fireLeft) + f.charcoalLeft + f.diamondLeft;
        uint256 flexBP = bpLeft - f.packsLeft;
        if (_r(seed, 5) % (flexBP + f.flexWoodLeft) < flexBP) {
            mats[4] = _drawBP(f, _r(seed, 7));
        } else {
            mats[4] = CardRules.WOOD;
            f.flexWoodLeft--;
        }
        f.dealt++;
        // the Series' last pack: every card of it now shows "k of N" as its Edition (these 6 included)
        if (f.dealt == f.packs) emit BatchMetadataUpdate(1, nextSerial + 5);

        // mint order: shuffle the six
        uint256[6] memory order = [uint256(0), 1, 2, 3, 4, 5];
        uint256 s = _r(seed, 8);
        for (uint256 i = 5; i > 0; i--) {
            uint256 k = (s >> (i * 8)) % (i + 1);
            (order[i], order[k]) = (order[k], order[i]);
        }
        for (uint256 i; i < 6; i++) _mintCard(openIndex, to, fire, mats[order[i]], _r(seed, 100 + i), f.characterCount);
    }

    function _drawBP(FireInfo storage f, uint256 r) private returns (uint256 m) {
        uint256 total = uint256(f.fireLeft) + f.charcoalLeft + f.diamondLeft;
        uint256 x = r % total;
        if (x < f.fireLeft) { f.fireLeft--; return CardRules.FIRE; }
        x -= f.fireLeft;
        if (x < f.charcoalLeft) { f.charcoalLeft--; return CardRules.CHARCOAL; }
        f.diamondLeft--;
        return CardRules.DIAMOND;
    }

    function _mintCard(uint256 openIndex, address to, uint256 fire, uint256 material, uint256 seed, uint256 characters) private {
        uint256 character = _r(seed, 1) % characters;
        (bool hf, bool hp) = CardRules.rollHolo(material, _r(seed, 2), _r(seed, 3));
        bytes32 key = keccak256(abi.encode(fire, character, material));
        uint32 edition = ++_editions[key];
        uint256 serial = nextSerial++;
        _card[serial] = fire | (material << 32) | (uint256(hf ? 1 : 0) << 40) | (uint256(hp ? 1 : 0) << 41) | (character << 48)
            | (uint256(edition) << 64);
        _mint(to, serial); // no receiver callback: nobody can stall the queue
        emit CardDealt(openIndex, serial, fire, material, hf, hp, character);
    }

    // ---------- reading cards ----------

    struct Card {
        uint256 fire;
        uint256 material;
        bool holoFrame;
        bool holoPicture;
        uint256 character;
        uint256 edition;
        uint256 editionOf; // 0 until every pack of the Series is dealt
        uint256 grade; // 0 = unrevealed
    }

    function cardOf(uint256 serial) public view returns (Card memory c) {
        _requireOwned(serial);
        uint256 d = _card[serial];
        c.fire = uint32(d);
        c.material = uint8(d >> 32);
        c.holoFrame = (d >> 40) & 1 == 1;
        c.holoPicture = (d >> 41) & 1 == 1;
        c.character = uint8(d >> 48);
        c.edition = uint32(d >> 64);
        c.grade = uint8(d >> 96);
        FireInfo storage f = fires[c.fire];
        if (f.dealt == f.packs) c.editionOf = _editions[keccak256(abi.encode(c.fire, c.character, c.material))];
    }

    function tokenURI(uint256 serial) public view override returns (string memory) {
        Card memory c = cardOf(serial);
        string memory name = c.character < _names[c.fire].length ? _names[c.fire][c.character] : "";
        string memory json = string.concat(
            '{"name":"', _materialLabel(c.material), " ", name, " #", serial.toString(),
            '","image":"', imagesBase[c.fire], imageFile(c),
            '","attributes":', _attributes(c, name, serial), "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice The card's shared image in its Series' image folder: c<character>-<material>-<holo>-<grade>.webp, where
    ///         material is paper|wood|fire|coal|diamond, holo is none|frame|picture|full and grade is u (unrevealed) or
    ///         1-10 (each grade has its own image, wear frame and PDA seal included). The Card Studio's export names
    ///         files the same way.
    function imageFile(Card memory c) public pure returns (string memory) {
        return string.concat(
            "c", c.character.toString(), "-", _lower(c.material), "-", _holo(c.holoFrame, c.holoPicture), "-",
            c.grade == 0 ? "u" : c.grade.toString(), ".webp"
        );
    }

    function _attributes(Card memory c, string memory name, uint256 serial) private view returns (string memory) {
        string memory edition = c.editionOf == 0 ? c.edition.toString() : string.concat(c.edition.toString(), " of ", c.editionOf.toString());
        string memory cat = c.character < _categories[c.fire].length ? _categories[c.fire][c.character] : "";
        string memory head = string.concat( // in two parts: one concat of everything is too deep for the stack
            '[{"trait_type":"Character","value":"', name,
            '"},{"trait_type":"Category","value":"', cat,
            '"},{"trait_type":"Material","value":"', _materialLabel(c.material),
            '"},{"trait_type":"Holo","value":"', _holoLabel(c.holoFrame, c.holoPicture)
        );
        return string.concat(
            head,
            '"},{"trait_type":"Series","value":', c.fire.toString(), ',"display_type":"number"},{"trait_type":"Edition","value":"', edition,
            '"},{"trait_type":"Serial","value":', serial.toString(), ',"display_type":"number"},{"trait_type":"PDA","value":"',
            c.grade == 0 ? "Unrevealed" : string.concat("PDA ", c.grade.toString()), '"}]'
        );
    }

    function _materialLabel(uint256 m) private pure returns (string memory) {
        return ["Paper", "Wood", "Fire", "Coal", "Diamond"][m];
    }

    function _lower(uint256 m) private pure returns (string memory) {
        return ["paper", "wood", "fire", "coal", "diamond"][m];
    }

    function _holo(bool f, bool p) private pure returns (string memory) {
        return f && p ? "full" : f ? "frame" : p ? "picture" : "none";
    }

    function _holoLabel(bool f, bool p) private pure returns (string memory) {
        return f && p ? "Full" : f ? "Frame" : p ? "Picture" : "None";
    }

    /// @dev A card being graded can be burned but not transferred.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0) && gradePending[tokenId]) revert GradingInProgress();
    }

    /// @dev Names, categories and the image folder go into JSON as-is: no quotes, backslashes or control characters.
    function _checkText(string calldata t) private pure {
        bytes calldata b = bytes(t);
        for (uint256 i; i < b.length; i++) {
            if (b[i] == '"' || b[i] == "\\" || uint8(b[i]) < 0x20) revert BadText();
        }
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return id == bytes4(0x49064906) || super.supportsInterface(id);
    }
}
