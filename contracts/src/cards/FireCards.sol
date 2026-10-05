// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {IDealer} from "./IDealer.sol";

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
 * @notice The cards. Every card is a unique ERC-721 (token id = its global serial). This contract is the permanent
 *         part: the cards, the opening queue, randomness, serials, editions, PDA grades and the metadata. What a
 *         Series' cards are is up to its dealer (IDealer; the first one is RecipeDealer), set per Series by the owner
 *         and fixed once the Series' first pack is minted.
 *
 *         How a pack is opened:
 *         1. When a Series goes out, the seller closes it: the pack count freezes. Its dealer works out the pool
 *            from that count (for RecipeDealer, from the Series' recipe). Each Series stands alone.
 *         2. A holder calls open(): their sealed packs are burned and fresh drand randomness is requested. Nothing
 *            about the packs existed before this; their cards depend on randomness that doesn't exist yet. (The
 *            leftover pool is public, so the very last pack of a Series gets exactly what's left: a cost of exact
 *            totals.)
 *         3. When the randomness arrives, anyone calls process(maxCards) (the site or the keeper, right away).
 *            Packs are dealt strictly in the order they were opened, up to `maxCards` cards per call, so a pack of
 *            any size can be dealt over several calls. The result depends only on the random words and the order of
 *            open() calls, never on who processes or how the work is split, and the Series' totals come out exact.
 *         Each pack gets the next block of serials, in a shuffled order (a serial says nothing about its slot).
 *         Cards are minted without the receiver callback, so no holder's contract can stall the queue for others.
 *
 *         The owner sets each Series' dealer and image folder before its packs sell, can move the image folder until
 *         it locks the Series, and sets the royalty. Nobody can change a card once it is dealt.
 */
contract FireCards is ERC721, ERC2981, Ownable2Step {
    using Strings for uint256;

    /// @dev An open's randomness can be asked for again only after a full day with no answer. drand publishes each
    ///      round's number ~30s before anyone delivers it, so a short wait would let an opener who dislikes the cards
    ///      they can already see re-roll while the keeper is down. Anyone (the site, the keeper) can deliver a word.
    uint256 public constant REREQUEST_AFTER = 1 days;
    uint96 public constant MAX_ROYALTY_BPS = 1_000;
    /// @dev Last resort if randomness is gone for good: an open with no answer this long can be cancelled and its
    ///      packs go back to the holder, sealed. (A week is far past any normal delay.)
    uint256 public constant CANCEL_AFTER = 7 days;
    /// @dev Packs up to this many cards are shuffled whole in memory (cheap); bigger ones card by card (Feistel).
    uint256 internal constant SHUFFLE_IN_MEMORY = 256;

    IFirePacks public immutable PACKS;
    IRandomnessSource public randomness;
    address public seller;
    /// @notice The PDA reveal contract (FirePsa): the only one that can set a card's grade, once.
    address public psa;

    struct FireInfo {
        IDealer dealer;
        bool closed;
        bool locked; // image folder frozen
        uint32 cardsPerPack; // read from the dealer at the Series' first deal
        uint64 packs; // frozen at close
        uint64 dealt; // packs fully dealt
    }

    struct Open {
        address to;
        uint64 requestedAt;
        bool ready;
        uint64 fire;
        uint64 count; // packs (0 once cancelled)
        uint64 packsDone; // progress while dealing
        uint32 cardInPack;
        uint256 requestId;
        uint256 word;
        uint64 packBase; // first serial of the pack being dealt
    }

    mapping(uint256 fire => FireInfo) public fires;
    mapping(uint256 fire => string) public imagesBase;
    uint256 public nextSerial = 1;

    Open[] public opens;
    uint256 public head; // next open to deal
    mapping(uint256 requestId => uint256) internal _openOf; // open index + 1

    /// @dev Per card: fire (bits 0-63), card type (64-95), character (96-127), edition (128-191), holo frame (192),
    ///      holo picture (193), grade 0 = unrevealed (200-207), dealer extra (208-239).
    mapping(uint256 tokenId => uint256) internal _card;
    mapping(bytes32 => uint64) internal _editions; // (fire, character, type) -> cards dealt so far
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
    event DealerSet(uint256 indexed fire, address dealer);
    event FireLocked(uint256 indexed fire);
    event ImagesBaseSet(uint256 indexed fire, string imagesBase);
    event FireClosed(uint256 indexed fire, uint256 packs);
    event PacksOpened(uint256 indexed openIndex, address indexed holder, uint256 indexed fire, uint256 count, uint256 requestId);
    event OpenReady(uint256 indexed openIndex, uint256 word);
    event CardDealt(uint256 indexed openIndex, uint256 indexed serial, uint256 fire, uint256 cardType, bool holoFrame, bool holoPicture, uint256 character);
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
    error NotStuck();
    error BadLength();
    error NotHolder();
    error NotPsa();
    error AlreadyGraded();
    error BadGrade();
    error BadText();
    error GradingInProgress();
    error RoyaltyTooHigh();
    error BadDeal();

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

    /// @notice Choose a Series' dealer (the contract that decides its cards), which must already have the Series set
    ///         up. Allowed until the Series' first pack is minted, it is locked or it closes, whichever comes first.
    function setDealer(uint256 fire, address dealer) external onlyOwner {
        if (fire > type(uint64).max) revert BadLength(); // cards store the Series in 64 bits
        FireInfo storage f = fires[fire];
        if (f.locked || f.closed || PACKS.minted(fire) != 0) revert FireIsLocked();
        if (dealer == address(0)) revert ZeroAddress();
        if (!IDealer(dealer).ready(fire)) revert NotConfigured();
        f.dealer = IDealer(dealer);
        emit DealerSet(fire, dealer);
    }

    /// @notice Where a Series' card images live (ipfs://<CID>/ or ar://<id>/). Allowed until the Series is locked, even
    ///         after its packs are selling: only where the images live changes, never what a card is.
    function setImagesBase(uint256 fire, string calldata base) external onlyOwner {
        if (fire > type(uint64).max) revert BadLength();
        if (fires[fire].locked) revert FireIsLocked();
        _checkText(base);
        imagesBase[fire] = base;
        emit ImagesBaseSet(fire, base);
        if (nextSerial > 1) emit BatchMetadataUpdate(1, nextSerial - 1);
    }

    /// @notice Freeze a Series' image folder (and with it everything else about the Series).
    function lockFire(uint256 fire) external onlyOwner {
        if (address(fires[fire].dealer) == address(0)) revert NotConfigured();
        fires[fire].locked = true;
        emit FireLocked(fire);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        emit RoyaltySet(receiver, bps);
        _setDefaultRoyalty(receiver, bps);
    }

    // ---------- the Series goes out ----------

    /// @notice The seller closes a Series when it goes out: the pack count is frozen. (Its dealer lays out the pool
    ///         from it at the first deal; closing never depends on the dealer.)
    function closeFire(uint256 fire) external {
        if (msg.sender != seller) revert NotSeller();
        FireInfo storage f = fires[fire];
        if (f.closed) revert FireIsClosed();
        if (address(f.dealer) == address(0)) revert NotConfigured();
        uint256 packs = PACKS.minted(fire);
        f.closed = true;
        f.packs = uint64(packs);
        emit FireClosed(fire, packs);
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
        if (uint8(d >> 200) != 0) revert AlreadyGraded();
        _card[serial] = d | (grade << 200);
        emit MetadataUpdate(serial);
    }

    /// @notice For the PDA contract: whether a card exists, its Series and its grade (0 = unrevealed).
    function gradeInfo(uint256 serial) external view returns (bool exists, uint256 fire, uint256 grade) {
        if (_ownerOf(serial) == address(0)) return (false, 0, 0);
        uint256 d = _card[serial];
        return (true, uint64(d), uint8(d >> 200));
    }

    // ---------- opening ----------

    /// @notice Open `count` sealed packs from `fire` (burned now; cards are dealt once the randomness arrives).
    function open(uint256 fire, uint256 count) external returns (uint256 index) {
        if (count == 0 || count > type(uint64).max) revert BadCount();
        if (!fires[fire].closed) revert FireNotClosed();
        PACKS.burnForOpen(msg.sender, fire, count);
        uint256 id = randomness.request();
        index = opens.length;
        Open storage o = opens.push();
        o.to = msg.sender;
        o.requestedAt = uint64(block.timestamp);
        o.fire = uint64(fire);
        o.count = uint64(count);
        o.requestId = id;
        _openOf[id] = index + 1;
        emit PacksOpened(index, msg.sender, fire, count, id);
    }

    /// @dev Randomness callback: only stores the word (cheap, can't fail); dealing happens in process(maxCards).
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

    /// @notice Deal ready opens, oldest first, until one isn't ready or `maxCards` cards are dealt. Anyone may call.
    ///         A pack can be split across calls. Returns the cards dealt.
    function process(uint256 maxCards) public returns (uint256 dealt) {
        uint256 h = head;
        while (dealt < maxCards && h < opens.length) {
            Open storage o = opens[h];
            if (!o.ready) break;
            uint256 count = o.count;
            uint256 j = o.packsDone;
            uint256 k = o.cardInPack;
            uint256 base = k == 0 ? 0 : o.packBase;
            if (j < count) {
                FireInfo storage f = fires[o.fire];
                Chunk memory c = Chunk(h, o.to, o.fire, 0, base, _perPack(o.fire, f));
                uint256 per = c.per;
                uint256 word = o.word;
                while (j < count && dealt < maxCards) {
                    if (k == 0) {
                        c.base = nextSerial;
                        nextSerial = c.base + per;
                    }
                    uint256 n = per - k < maxCards - dealt ? per - k : maxCards - dealt;
                    c.seed = _r(word, j);
                    _dealChunk(c, f.dealer, k, n);
                    k += n;
                    dealt += n;
                    if (k == per) {
                        k = 0;
                        j++;
                        uint64 done = f.dealt + 1;
                        f.dealt = done;
                        // the Series' last pack: every card of it now shows "k of N" as its Edition
                        if (done == f.packs) emit BatchMetadataUpdate(1, nextSerial - 1);
                    }
                }
                base = c.base;
            }
            if (j < count) {
                o.packsDone = uint64(j);
                o.cardInPack = uint32(k);
                o.packBase = uint64(base);
                break;
            }
            h++;
        }
        head = h;
    }

    function pending() external view returns (uint256 queued, uint256 readyAtHead) {
        queued = opens.length - head;
        for (uint256 h = head; h < opens.length && opens[h].ready; h++) readyAtHead++;
    }

    function _perPack(uint256 fire, FireInfo storage f) private returns (uint256 per) {
        per = f.cardsPerPack;
        if (per == 0) {
            per = f.dealer.cardsPerPack(fire);
            if (per == 0 || per > type(uint32).max) revert BadDeal();
            f.cardsPerPack = uint32(per);
        }
    }

    function _r(uint256 seed, uint256 i) private pure returns (uint256 v) {
        assembly {
            mstore(0, seed)
            mstore(32, i)
            v := keccak256(0, 64)
        }
    }

    struct Chunk {
        uint256 openIndex;
        address to;
        uint256 fire;
        uint256 seed;
        uint256 base; // the pack's first serial
        uint256 per; // cards per pack
    }

    /// @dev Cards `k` .. `k + n - 1` of one pack: the dealer decides them; each goes to its place in the pack's block of
    ///      serials (a shuffle of the pack, the same however the dealing is split).
    function _dealChunk(Chunk memory c, IDealer dealer, uint256 k, uint256 n) private {
        uint256[] memory got = dealer.deal(c.fire, c.seed, k, n);
        if (got.length != n) revert BadDeal();
        uint256 key = _r(c.seed, 8);
        if (c.per <= SHUFFLE_IN_MEMORY) {
            uint256[] memory order = _shuffle(key, c.per);
            for (uint256 i; i < n; i++) _mintCard(c, got[i], c.base + order[k + i]);
        } else {
            for (uint256 i; i < n; i++) _mintCard(c, got[i], c.base + _place(key, k + i, c.per));
        }
    }

    /// @dev A uniform shuffle of a pack's positions (Fisher-Yates), for packs small enough to shuffle whole each call.
    function _shuffle(uint256 key, uint256 per) private pure returns (uint256[] memory order) {
        order = new uint256[](per);
        for (uint256 i; i < per; i++) order[i] = i;
        for (uint256 i = per - 1; i > 0; i--) {
            uint256 j = _r(key, i) % (i + 1);
            (order[i], order[j]) = (order[j], order[i]);
        }
    }

    function _mintCard(Chunk memory c, uint256 a, uint256 serial) private {
        uint256 t = uint32(a);
        uint256 character = uint32(a >> 32);
        uint64 edition = ++_editions[keccak256(abi.encode(c.fire, character, t))];
        _card[serial] = c.fire | (t << 64) | (character << 96) | (uint256(edition) << 128) | (((a >> 64) & 3) << 192)
            | (uint256(uint32(a >> 96)) << 208);
        _mint(c.to, serial); // no receiver callback: nobody can stall the queue
        emit CardDealt(c.openIndex, serial, c.fire, t, (a >> 64) & 1 == 1, (a >> 65) & 1 == 1, character);
    }

    /// @dev Where card `i` of a bigger pack of `per` goes in the pack's block: a keyed 4-round Feistel shuffle of
    ///      [0, 2^(2h)) walked back into [0, per). Stateless, so a pack dealt in pieces lands the same way.
    function _place(uint256 key, uint256 i, uint256 per) private pure returns (uint256 x) {
        if (per < 2) return 0;
        uint256 half = (_bits(per - 1) + 1) / 2;
        uint256 mask = (1 << half) - 1;
        x = i;
        do {
            uint256 l = x >> half;
            uint256 r = x & mask;
            for (uint256 round; round < 4; round++) {
                (l, r) = (r, l ^ (_r(key, (round << 128) | r) & mask));
            }
            x = (l << half) | r;
        } while (x >= per);
    }

    function _bits(uint256 v) private pure returns (uint256 n) {
        while (v != 0) {
            v >>= 1;
            n++;
        }
    }

    // ---------- reading Series and cards ----------

    /// @notice A Series is set up enough to sell: it has a dealer that has it, and it isn't closed.
    function ready(uint256 fire) external view returns (bool) {
        FireInfo storage f = fires[fire];
        return address(f.dealer) != address(0) && !f.closed && f.dealer.ready(fire);
    }

    function isClosed(uint256 fire) external view returns (bool) {
        return fires[fire].closed;
    }

    /// @notice Cards per pack of a Series (0 with no dealer yet).
    function cardsPerPack(uint256 fire) external view returns (uint256) {
        FireInfo storage f = fires[fire];
        if (f.cardsPerPack != 0) return f.cardsPerPack;
        return address(f.dealer) == address(0) ? 0 : f.dealer.cardsPerPack(fire);
    }

    function characterCount(uint256 fire) external view returns (uint256) {
        IDealer d = fires[fire].dealer;
        return address(d) == address(0) ? 0 : d.characterCount(fire);
    }

    struct Card {
        uint256 fire;
        uint256 cardType; // index into the Series' types (its dealer's)
        bool holoFrame;
        bool holoPicture;
        uint256 character;
        uint256 edition;
        uint256 editionOf; // 0 until every pack of the Series is dealt
        uint256 grade; // 0 = unrevealed
        uint256 extra; // dealer-defined
    }

    function cardOf(uint256 serial) public view returns (Card memory c) {
        _requireOwned(serial);
        uint256 d = _card[serial];
        c.fire = uint64(d);
        c.cardType = uint32(d >> 64);
        c.character = uint32(d >> 96);
        c.edition = uint64(d >> 128);
        c.holoFrame = (d >> 192) & 1 == 1;
        c.holoPicture = (d >> 193) & 1 == 1;
        c.grade = uint8(d >> 200);
        c.extra = uint32(d >> 208);
        FireInfo storage f = fires[c.fire];
        if (f.dealt == f.packs) c.editionOf = _editions[keccak256(abi.encode(c.fire, c.character, c.cardType))];
    }

    function tokenURI(uint256 serial) public view override returns (string memory) {
        Card memory c = cardOf(serial);
        IDealer.CardText memory t = fires[c.fire].dealer.cardText(c.fire, c.cardType, c.character, c.extra);
        string memory json = string.concat(
            '{"name":"', t.typeName, " ", t.characterName, " #", serial.toString(),
            '","image":"', imagesBase[c.fire], imageName(c.character, t.typeSlug, c.holoFrame, c.holoPicture, c.grade),
            '","attributes":', _attributes(c, t, serial), "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice A card's shared image in its Series' image folder (see imageName).
    function imageFile(uint256 serial) external view returns (string memory) {
        Card memory c = cardOf(serial);
        IDealer.CardText memory t = fires[c.fire].dealer.cardText(c.fire, c.cardType, c.character, c.extra);
        return imageName(c.character, t.typeSlug, c.holoFrame, c.holoPicture, c.grade);
    }

    /// @notice Image file names: c<character>-<type slug>-<holo>-<grade>.webp, where holo is none|frame|picture|full and
    ///         grade is u (unrevealed) or 1-10 (each grade has its own image, wear frame and PDA seal included). The
    ///         Card Studio's export names files the same way.
    function imageName(uint256 character, string memory slug, bool holoFrame, bool holoPicture, uint256 grade)
        public
        pure
        returns (string memory)
    {
        return string.concat(
            "c", character.toString(), "-", slug, "-", _holo(holoFrame, holoPicture), "-",
            grade == 0 ? "u" : grade.toString(), ".webp"
        );
    }

    function _attributes(Card memory c, IDealer.CardText memory t, uint256 serial) private pure returns (string memory) {
        string memory edition = c.editionOf == 0 ? c.edition.toString() : string.concat(c.edition.toString(), " of ", c.editionOf.toString());
        string memory head_ = string.concat( // in two parts: one concat of everything is too deep for the stack
            '[{"trait_type":"Character","value":"', t.characterName,
            '"},{"trait_type":"Category","value":"', t.category,
            '"},{"trait_type":"Material","value":"', t.typeName,
            '"},{"trait_type":"Holo","value":"', _holoLabel(c.holoFrame, c.holoPicture)
        );
        return string.concat(
            head_,
            '"},{"trait_type":"Series","value":', c.fire.toString(), ',"display_type":"number"},{"trait_type":"Edition","value":"', edition,
            '"},{"trait_type":"Serial","value":', serial.toString(), ',"display_type":"number"},{"trait_type":"PDA","value":"',
            c.grade == 0 ? "Unrevealed" : string.concat("PDA ", c.grade.toString()), '"}', t.extraAttributes, "]"
        );
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

    /// @dev The image folder goes into JSON as-is: no quotes, backslashes or control characters.
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
