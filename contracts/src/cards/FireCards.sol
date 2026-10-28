// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
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

interface ICardsRenderer {
    function tokenURI(uint256 serial) external view returns (string memory);
}

/**
 * @title FireCards
 * @notice The cards ("Omni Cards"). Every card is a unique ERC-721 (token id = its global serial). This contract is
 *         the permanent part: the cards, the opening queues, randomness, serials, print numbers, each card's wear state
 *         and PDA grade. What a Series' cards are is up to its dealer (IDealer; the first one is RecipeDealer), set
 *         per Series by the owner and fixed once the Series' first pack is minted. The metadata JSON comes from the
 *         renderer (CardsRenderer), set once.
 *
 *         How a pack is opened:
 *         1. When a Series goes out, the seller closes it: the pack count freezes. Each Series stands alone, with
 *            its own opening queue.
 *         2. A holder calls open(): their sealed packs are burned and fresh drand randomness is requested. Nothing
 *            about the packs existed before this; their cards depend on randomness that doesn't exist yet.
 *         3. When the randomness arrives, anyone calls process(fire, maxCards) (the site or the keeper, right away).
 *            A Series' packs are dealt strictly in the order they were opened, up to `maxCards` cards per call, so a
 *            pack of any size (up to MAX_CARDS_PER_PACK) can be dealt over several calls. The result depends only on
 *            the random words and the order of open() calls, never on who processes or how the work is split.
 *         Each pack gets the next block of serials, in a shuffled order (a serial says nothing about its slot).
 *         Cards are minted without the receiver callback, so no holder's contract can stall a queue for others.
 *
 *         Wear (docs/grading.md): each card keeps the time it was dealt and how many times it moved between wallets
 *         (the first MAX_MOVES count) while uncased and ungraded. Casing it, or asking for its grade, freezes both;
 *         the grading contract (FirePsa) turns them into odds. Only FirePsa can case a card or set its grade, once.
 *
 *         The owner sets each Series' dealer and image folder before its first pack is minted, and the royalty. The
 *         image folder locks at the first pack (the art people buy can never be swapped). Nobody can change a card
 *         once it is dealt.
 *
 *         Randomness source: the owner can switch it, but a switch waits 48 hours in public (`RandomnessProposed`,
 *         then `RandomnessSet` when anyone applies it). Only new opens use the new source. Each open remembers the source that took its request, only that
 *         source can answer it, and an open waiting on an old source can still be answered by it (or cancelled after
 *         CANCEL_AFTER). There is no re-request: one open, one request, one number.
 *
 *         Print number: each exact card (Series, character, type and holo look) is numbered in the order it is
 *         dealt: the first one opened is #1, the next #2, and so on. There is no "of N": the number is final the
 *         moment the card is dealt.
 */
contract FireCards is ERC721, ERC2981, Ownable2Step, ReentrancyGuard {
    uint96 public constant MAX_ROYALTY_BPS = 1_000;
    /// @dev Last resort if randomness is gone for good: an open with no answer this long after it was asked for
    ///      can be cancelled and its packs go back to the holder, sealed. Every drand round is public once it is
    ///      out, so a cancel only works while nobody has delivered the word, and anyone (the holder included) can
    ///      see it first: a holder who didn't like their word could sit on it and cancel for a re-roll. The window
    ///      must outlast any keeper outage (two keepers, alerting long before it ends); 24 hours is the owner's
    ///      choice.
    uint256 public constant CANCEL_AFTER = 24 hours;
    /// @dev A source that says it answered but never delivers can't hold a open forever: this long after the request,
    ///      anyone can cancel it whatever the source says.
    uint256 public constant FORCE_CANCEL_AFTER = 7 days;
    /// @dev How long a randomness switch waits after the owner names it (the first source, at deploy, doesn't).
    uint256 public constant RANDOMNESS_DELAY = 48 hours;
    /// @dev How long a ready open can sit at the head of its queue without being dealt (a dealer that can't deal
    ///      it) before anyone can skip it (`skipStuck`). Its word is known, so this too must outlast any keeper
    ///      outage; it stays long because it should only ever be needed for a dealer that can't deal.
    uint256 public constant SKIP_AFTER = 7 days;
    /// @dev Most cards in one pack: keeps one pack's shuffle and dealing inside a block.
    uint256 public constant MAX_CARDS_PER_PACK = 1_000;
    /// @dev Moves (wallet to wallet, uncased and ungraded) that count toward wear; more add nothing.
    uint256 public constant MAX_MOVES = 10;
    /// @dev Packs up to this many cards are shuffled whole in memory (cheap); bigger ones card by card (Feistel).
    uint256 internal constant SHUFFLE_IN_MEMORY = 256;
    /// @dev Domain tag for a pack's serial shuffle key (kept apart from the dealer's per-card randomness).
    uint256 internal constant SHUFFLE_TAG = uint256(keccak256("omni.cards.shuffle"));

    // card word layout
    uint256 internal constant B_TYPE = 64; // 32 bits
    uint256 internal constant B_CHAR = 96; // 32 bits
    uint256 internal constant B_PRINT = 128; // 40 bits: print number
    uint256 internal constant B_CLOCK = 168; // 40 bits: dealt-at time, or the frozen age once frozen
    uint256 internal constant B_HOLO_FRAME = 208;
    uint256 internal constant B_HOLO_PICTURE = 209;
    uint256 internal constant B_GRADE = 210; // 4 bits, 0 = ungraded
    uint256 internal constant B_FROZEN = 214;
    uint256 internal constant B_CASED = 215;
    uint256 internal constant B_MOVES = 216; // 4 bits
    uint256 internal constant B_EXTRA = 220; // 32 bits
    uint256 internal constant M40 = (1 << 40) - 1;

    IFirePacks public immutable PACKS;
    IRandomnessSource public randomness;
    /// @notice A randomness switch waiting for RANDOMNESS_DELAY (0 = none), and when it can be applied.
    address public pendingRandomness;
    uint64 public pendingRandomnessAt;
    address public seller;
    /// @notice The grading contract (FirePsa): the only one that can case a card or set its grade, once.
    address public psa;
    /// @notice Writes each card's metadata JSON (set once).
    ICardsRenderer public renderer;
    /// @notice Collection metadata (ERC-7572), set by the owner.
    string public contractURI;

    struct FireInfo {
        IDealer dealer;
        bool closed;
        bool locked; // frozen by the owner before any pack (the image folder also locks at the first pack)
        uint32 cardsPerPack; // read from the dealer at the Series' first deal
        uint64 packs; // frozen at close
        uint64 dealt; // packs fully dealt
    }

    struct Open {
        address to;
        uint64 requestedAt;
        uint64 readyAt;
        bool ready;
        uint64 count; // packs (0 once cancelled or skipped)
        uint64 packsDone; // progress while dealing
        uint32 cardInPack;
        address source; // the randomness source that took the request (only it can answer)
        uint96 requestId;
        uint64 packBase; // first serial of the pack being dealt
        uint256 word;
    }

    mapping(uint256 fire => FireInfo) public fires;
    mapping(uint256 fire => string) public imagesBase;
    uint256 public nextSerial = 1;

    /// @notice Each Series' opening queue, oldest first, and its head (next open to deal).
    mapping(uint256 fire => Open[]) internal _opens;
    mapping(uint256 fire => uint256) public headOf;
    /// @dev (source << 96 | requestId) -> (fire << 128) | (index + 1)
    mapping(uint256 request => uint256) internal _openOf;

    /// @dev Per card (see the B_ layout): Series, type, character, print number, clock, holo, grade, frozen,
    ///      cased, moves, dealer extra.
    mapping(uint256 tokenId => uint256) internal _card;
    /// @dev (fire, character, type, holo look) -> how many of that exact card have been dealt (its last print number)
    mapping(bytes32 => uint64) internal _prints;
    /// @notice A grading is waiting for its randomness: the card can't move until its grade is set.
    mapping(uint256 tokenId => bool) public gradePending;
    /// @dev When a card was dealt, kept once its clock first freezes (cased or sent for grading); until then the
    ///      card's clock is its deal time.
    mapping(uint256 tokenId => uint256) internal _dealtAt;

    event RandomnessSet(address source);
    event RandomnessProposed(address source, uint64 at);
    event PsaSet(address psa);
    event RendererSet(address renderer);
    event OpenCancelled(uint256 indexed fire, uint256 indexed openIndex, address indexed holder, uint256 count);
    event OpenSkipped(uint256 indexed fire, uint256 indexed openIndex, address indexed holder, uint256 packsBack);
    event RoyaltySet(address receiver, uint96 bps);
    event GradePending(uint256 indexed tokenId, bool pending);
    event Cased(uint256 indexed tokenId, uint256 age, uint256 moves);
    event Moved(uint256 indexed tokenId, uint256 moves);
    event MetadataUpdate(uint256 tokenId); // ERC-4906
    event SellerSet(address seller);
    event DealerSet(uint256 indexed fire, address dealer);
    event FireLocked(uint256 indexed fire);
    event ImagesBaseSet(uint256 indexed fire, string imagesBase);
    event FireClosed(uint256 indexed fire, uint256 packs);
    event PacksOpened(uint256 indexed fire, uint256 indexed openIndex, address indexed holder, uint256 count, uint256 requestId);
    event OpenReady(uint256 indexed fire, uint256 indexed openIndex, uint256 word);
    event CardDealt(uint256 indexed fire, uint256 indexed serial, uint256 openIndex, uint256 cardType, bool holoFrame, bool holoPicture, uint256 character);
    event ContractURIUpdated(); // ERC-7572

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
    error TooEarly();
    error BadLength();
    error NotHolder();
    error NotPsa();
    error AlreadyGraded();
    error AlreadyCased();
    error BadGrade();
    error BadText();
    error GradingInProgress();
    error RoyaltyTooHigh();
    error BadDeal();
    error BadRequest();
    error RenounceDisabled();

    constructor(address owner_, address packs_) ERC721("Omni Cards", "OMNICARD") Ownable(owner_) {
        if (packs_ == address(0)) revert ZeroAddress();
        PACKS = IFirePacks(packs_);
    }

    // ---------- owner setup ----------

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice The randomness source for new opens. The first one (at deploy) takes effect at once; a switch after
    ///         that waits RANDOMNESS_DELAY (48 h) from this call, so everyone sees it coming (`RandomnessProposed`),
    ///         then anyone applies it (`applyRandomness`). Calling it again replaces the waiting switch and restarts
    ///         the clock; naming the current source calls the switch off. Opens already waiting keep their own source.
    function setRandomness(address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        if (address(randomness) == address(0)) {
            randomness = IRandomnessSource(source);
            emit RandomnessSet(source);
            return;
        }
        bool off = source == address(randomness);
        pendingRandomness = off ? address(0) : source;
        pendingRandomnessAt = off ? 0 : uint64(block.timestamp + RANDOMNESS_DELAY);
        emit RandomnessProposed(pendingRandomness, pendingRandomnessAt);
    }

    /// @notice Anyone: put the waiting randomness switch into effect once RANDOMNESS_DELAY has passed.
    function applyRandomness() external {
        address source = pendingRandomness;
        if (source == address(0) || block.timestamp < pendingRandomnessAt) revert TooEarly();
        pendingRandomness = address(0);
        pendingRandomnessAt = 0;
        randomness = IRandomnessSource(source);
        emit RandomnessSet(source);
    }

    /// @notice Collection metadata for marketplaces (ERC-7572).
    function setContractURI(string calldata uri) external onlyOwner {
        contractURI = uri;
        emit ContractURIUpdated();
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

    function setRenderer(address r) external onlyOwner {
        if (address(renderer) != address(0)) revert AlreadySet();
        if (r == address(0)) revert ZeroAddress();
        renderer = ICardsRenderer(r);
        emit RendererSet(r);
    }

    /// @notice Choose a Series' dealer (the contract that decides its cards), which must already have the Series set
    ///         up. Allowed until the Series' first pack is minted, it is locked or it closes, whichever comes first.
    function setDealer(uint256 fire, address dealer) external onlyOwner {
        _checkOpen(fire);
        if (dealer == address(0)) revert ZeroAddress();
        if (!IDealer(dealer).ready(fire)) revert NotConfigured();
        uint256 per = IDealer(dealer).cardsPerPack(fire);
        if (per == 0 || per > MAX_CARDS_PER_PACK) revert BadDeal();
        fires[fire].dealer = IDealer(dealer);
        emit DealerSet(fire, dealer);
    }

    /// @notice Where a Series' card images live (ipfs://<CID>/ or ar://<id>/). Until the Series' first pack is minted
    ///         or the owner locks it: after that the art can never change.
    function setImagesBase(uint256 fire, string calldata base) external onlyOwner {
        _checkOpen(fire);
        bytes calldata b = bytes(base);
        if (b.length == 0) revert BadText();
        for (uint256 i; i < b.length; i++) {
            if (b[i] == '"' || b[i] == "\\" || uint8(b[i]) < 0x20 || uint8(b[i]) > 0x7e) revert BadText();
        }
        imagesBase[fire] = base;
        emit ImagesBaseSet(fire, base);
    }

    /// @notice Freeze a Series early (dealer and image folder), before its first pack. Needs a dealer, an image folder
    ///         and a pack size the dealer can deal (rechecked here: the recipe may have changed since setDealer).
    function lockFire(uint256 fire) external onlyOwner {
        if (!_lockable(fire)) revert NotConfigured();
        fires[fire].locked = true;
        emit FireLocked(fire);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        emit RoyaltySet(receiver, bps);
        _setDefaultRoyalty(receiver, bps);
    }

    function _checkOpen(uint256 fire) private view {
        if (fire > type(uint64).max) revert BadLength(); // cards store the Series in 64 bits
        FireInfo storage f = fires[fire];
        if (f.locked || f.closed || PACKS.minted(fire) != 0) revert FireIsLocked();
    }

    // ---------- the Series goes out ----------

    /// @notice The seller locks a Series when its drop is set up: from then its dealer, recipe, characters, odds and
    ///         image folder are fixed, before anyone can buy.
    function lockForSale(uint256 fire) external {
        if (msg.sender != seller) revert NotSeller();
        if (!fires[fire].locked) {
            if (!_lockable(fire)) revert NotConfigured(); // same checks as lockFire
            fires[fire].locked = true;
            emit FireLocked(fire);
        }
    }

    /// @notice The seller closes a Series when it goes out: the pack count is frozen.
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

    /// @notice The seller burns cards for their holder (the sale contract's burnCards). The holder is whoever called
    ///         the seller, so no approval is needed and nobody else's cards can be burned.
    function burnFor(address from, uint256[] calldata ids) external {
        if (msg.sender != seller) revert NotSeller();
        for (uint256 i; i < ids.length; i++) {
            if (_ownerOf(ids[i]) != from) revert NotHolder();
            _burn(ids[i]);
        }
    }

    // ---------- cases and grades (FirePsa only) ----------

    /// @notice Case a card: its wear (age and moves) freezes for good. Ungraded, uncased cards only.
    function setCased(uint256 serial) external {
        if (msg.sender != psa) revert NotPsa();
        _requireOwned(serial);
        if (gradePending[serial]) revert GradingInProgress();
        uint256 d = _card[serial];
        if ((d >> B_GRADE) & 15 != 0) revert AlreadyGraded();
        if ((d >> B_CASED) & 1 != 0) revert AlreadyCased();
        d = _freeze(serial, d) | (1 << B_CASED);
        _card[serial] = d;
        emit Cased(serial, (d >> B_CLOCK) & M40, (d >> B_MOVES) & 15);
        emit MetadataUpdate(serial);
    }

    /// @notice A grading is waiting for randomness (the card can't move, and its wear stops counting), or was
    ///         cancelled (an uncased card's clock runs again from where it stopped).
    function setGradePending(uint256 serial, bool pending_) external {
        if (msg.sender != psa) revert NotPsa();
        uint256 d = _card[serial];
        if (pending_) {
            _requireOwned(serial);
            _card[serial] = _freeze(serial, d);
        } else if ((d >> B_CASED) & 1 == 0 && (d >> B_FROZEN) & 1 == 1 && (d >> B_GRADE) & 15 == 0) {
            uint256 age = (d >> B_CLOCK) & M40;
            d &= ~((M40 << B_CLOCK) | (1 << B_FROZEN));
            _card[serial] = d | ((block.timestamp - age) << B_CLOCK);
        }
        gradePending[serial] = pending_;
        emit GradePending(serial, pending_);
    }

    /// @notice Set a card's grade (1-10), once. It is slabbed: its image switches to that grade's slab.
    function setGrade(uint256 serial, uint256 grade) external {
        if (msg.sender != psa) revert NotPsa();
        if (gradePending[serial]) {
            delete gradePending[serial];
            emit GradePending(serial, false);
        }
        if (grade == 0 || grade > 10) revert BadGrade();
        _requireOwned(serial);
        uint256 d = _card[serial];
        if ((d >> B_GRADE) & 15 != 0) revert AlreadyGraded();
        _card[serial] = _freeze(serial, d) | (grade << B_GRADE);
        emit MetadataUpdate(serial);
    }

    function _freeze(uint256 serial, uint256 d) private returns (uint256) {
        if ((d >> B_FROZEN) & 1 == 1) return d;
        uint256 clock = (d >> B_CLOCK) & M40;
        // the first freeze keeps the deal time (a cancelled grading restarts the clock from where it stopped)
        if (_dealtAt[serial] == 0) _dealtAt[serial] = clock;
        uint256 age = block.timestamp - clock;
        return (d & ~(M40 << B_CLOCK)) | (age << B_CLOCK) | (1 << B_FROZEN);
    }

    /// @notice For FirePsa: whether a card exists, its Series and its grade (0 = ungraded).
    function gradeInfo(uint256 serial) external view returns (bool exists, uint256 fire, uint256 grade) {
        if (_ownerOf(serial) == address(0)) return (false, 0, 0);
        uint256 d = _card[serial];
        return (true, uint64(d), (d >> B_GRADE) & 15);
    }

    /// @notice A card's wear: seconds since it was dealt while uncased (frozen once cased or sent for grading) and
    ///         moves counted (at most MAX_MOVES).
    function wearOf(uint256 serial)
        public
        view
        returns (bool exists, uint256 fire, uint256 grade, bool cased, uint256 age, uint256 moves)
    {
        if (_ownerOf(serial) == address(0)) return (false, 0, 0, false, 0, 0);
        uint256 d = _card[serial];
        uint256 clock = (d >> B_CLOCK) & M40;
        return (
            true, uint64(d), (d >> B_GRADE) & 15, (d >> B_CASED) & 1 == 1,
            (d >> B_FROZEN) & 1 == 1 ? clock : block.timestamp - clock, (d >> B_MOVES) & 15
        );
    }

    // ---------- opening ----------

    /// @notice Open `count` sealed packs from `fire` (burned now; cards are dealt once the randomness arrives).
    function open(uint256 fire, uint256 count) external nonReentrant returns (uint256 index) {
        if (count == 0 || count > type(uint64).max) revert BadCount();
        if (!fires[fire].closed) revert FireNotClosed();
        PACKS.burnForOpen(msg.sender, fire, count);
        IRandomnessSource src = randomness;
        uint256 id = src.request();
        if (id > type(uint96).max) revert BadRequest();
        Open[] storage q = _opens[fire];
        index = q.length;
        Open storage o = q.push();
        o.to = msg.sender;
        o.requestedAt = uint64(block.timestamp);
        o.count = uint64(count);
        o.source = address(src);
        o.requestId = uint96(id);
        _openOf[_reqKey(address(src), id)] = (fire << 128) | (index + 1);
        emit PacksOpened(fire, index, msg.sender, count, id);
    }

    /// @dev Randomness callback: only stores the word (cheap, can't fail); dealing happens in process. Only the
    ///      source that took a request can answer it.
    function onRandomness(uint256 requestId, uint256 word) external {
        uint256 rk = requestId > type(uint96).max ? 0 : _reqKey(msg.sender, requestId);
        uint256 key = _openOf[rk];
        if (key == 0) revert NotRandomness(); // not this source's request, or the open was cancelled
        uint256 fire = key >> 128;
        uint256 i = uint128(key) - 1;
        Open storage o = _opens[fire][i];
        delete _openOf[rk];
        o.word = word;
        o.ready = true;
        o.readyAt = uint64(block.timestamp);
        emit OpenReady(fire, i, word);
    }

    /// @notice If an open's randomness has had no answer for CANCEL_AFTER since it was asked for (randomness gone for
    ///         good), anyone can cancel it: its packs go back to the holder, sealed. After FORCE_CANCEL_AFTER it can be
    ///         cancelled even if its source says it answered (a word that never arrives).
    function cancelOpen(uint256 fire, uint256 index) external nonReentrant {
        Open storage o = _opens[fire][index];
        if (o.ready || block.timestamp < o.requestedAt + CANCEL_AFTER) revert NotStuck();
        if (block.timestamp < o.requestedAt + FORCE_CANCEL_AFTER && _answered(o.source, o.requestId)) revert NotStuck();
        delete _openOf[_reqKey(o.source, o.requestId)];
        uint256 count = o.count;
        o.count = 0; // dealt as nothing when the queue reaches it
        o.ready = true;
        PACKS.returnPacks(o.to, fire, count);
        emit OpenCancelled(fire, index, o.to, count);
    }

    /// @notice If the open at the head of a Series' queue has been ready for SKIP_AFTER and still isn't dealt (its
    ///         dealer can't deal it), anyone can skip it so the queue moves on: the packs it hadn't started go back to
    ///         the holder, sealed (cards already dealt stay theirs).
    function skipStuck(uint256 fire) external nonReentrant {
        uint256 h = headOf[fire];
        Open storage o = _opens[fire][h];
        if (!o.ready || o.count == 0 || block.timestamp < o.readyAt + SKIP_AFTER) revert NotStuck();
        uint256 back = o.count - o.packsDone - (o.cardInPack != 0 ? 1 : 0);
        if (o.cardInPack != 0) {
            // the part-dealt pack is dropped (its other cards never exist): count it as dealt, so `dealt` still
            // reaches the Series' pack count
            fires[fire].dealt++;
        }
        o.count = 0;
        headOf[fire] = h + 1;
        if (back > 0) PACKS.returnPacks(o.to, fire, back);
        emit OpenSkipped(fire, h, o.to, back);
    }

    /// @notice Deal a Series' ready opens, oldest first, until one isn't ready or `maxCards` cards are dealt. Anyone
    ///         may call. A pack can be split across calls. Returns the cards dealt.
    function process(uint256 fire, uint256 maxCards) external nonReentrant returns (uint256 dealt) {
        Open[] storage q = _opens[fire];
        uint256 h = headOf[fire];
        while (dealt < maxCards && h < q.length) {
            Open storage o = q[h];
            if (!o.ready) break;
            uint256 count = o.count;
            uint256 j = o.packsDone;
            uint256 k = o.cardInPack;
            uint256 base = k == 0 ? 0 : o.packBase;
            if (j < count) {
                FireInfo storage f = fires[fire];
                Chunk memory c = Chunk(h, o.to, fire, 0, base, _perPack(fire, f));
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
                        f.dealt++;
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
        headOf[fire] = h;
    }

    /// @notice A Series' queue: opens waiting, and how many at the head are ready to deal.
    function pending(uint256 fire) external view returns (uint256 queued, uint256 readyAtHead) {
        Open[] storage q = _opens[fire];
        queued = q.length - headOf[fire];
        for (uint256 h = headOf[fire]; h < q.length && q[h].ready; h++) readyAtHead++;
    }

    function openOf(uint256 fire, uint256 index) external view returns (Open memory) {
        return _opens[fire][index];
    }

    function openCount(uint256 fire) external view returns (uint256) {
        return _opens[fire].length;
    }

    function _reqKey(address source, uint256 id) private pure returns (uint256) {
        return (uint256(uint160(source)) << 96) | id;
    }

    /// @dev Whether `source` holds an answer for `id`; a source that can't say counts as no answer.
    function _answered(address source, uint256 id) private view returns (bool) {
        (bool ok, bytes memory ret) = source.staticcall(abi.encodeCall(IRandomnessSource.answered, (id)));
        return ok && ret.length >= 32 && abi.decode(ret, (bool));
    }

    function _perPack(uint256 fire, FireInfo storage f) private returns (uint256 per) {
        per = f.cardsPerPack;
        if (per == 0) {
            per = f.dealer.cardsPerPack(fire);
            if (per == 0 || per > MAX_CARDS_PER_PACK) revert BadDeal();
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
        uint256 key = _r(c.seed, SHUFFLE_TAG);
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
        uint256 holo = (a >> 64) & 3; // bit 0 frame, bit 1 picture
        uint64 print = ++_prints[keccak256(abi.encode(c.fire, character, t, holo))];
        if (print > M40) revert BadDeal();
        _card[serial] = c.fire | (t << B_TYPE) | (character << B_CHAR) | (uint256(print) << B_PRINT)
            | (block.timestamp << B_CLOCK) | (holo << B_HOLO_FRAME) | (uint256(uint32(a >> 96)) << B_EXTRA);
        _mint(c.to, serial); // no receiver callback: nobody can stall the queue
        emit CardDealt(c.fire, serial, c.openIndex, t, (a >> 64) & 1 == 1, (a >> 65) & 1 == 1, character);
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

    /// @notice A Series is set up enough to sell: a dealer that has it ready (with a pack size it can deal), an image
    ///         folder, and it isn't closed.
    function ready(uint256 fire) external view returns (bool) {
        return !fires[fire].closed && _lockable(fire);
    }

    /// @dev A dealer that has the Series ready, an image folder, and 1..MAX_CARDS_PER_PACK cards per pack. setDealer
    ///      checks these, but the dealer's settings (recipe, characters, character weights) may change after it, so
    ///      every lock checks again: a locked Series can always be dealt.
    function _lockable(uint256 fire) private view returns (bool) {
        IDealer d = fires[fire].dealer;
        if (address(d) == address(0) || bytes(imagesBase[fire]).length == 0) return false;
        uint256 per = d.cardsPerPack(fire);
        return per != 0 && per <= MAX_CARDS_PER_PACK && d.ready(fire);
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
        uint256 printNumber; // #k of this exact card (Series, character, type, holo look), in the order dealt
        uint256 grade; // 0 = ungraded
        bool cased;
        uint256 age; // seconds uncased since dealt (frozen once cased or sent for grading)
        uint256 moves;
        uint256 dealtAt; // when it was dealt (unix seconds)
        uint256 extra; // dealer-defined
    }

    function cardOf(uint256 serial) public view returns (Card memory c) {
        _requireOwned(serial);
        uint256 d = _card[serial];
        c.fire = uint64(d);
        c.cardType = uint32(d >> B_TYPE);
        c.character = uint32(d >> B_CHAR);
        c.printNumber = (d >> B_PRINT) & M40;
        c.holoFrame = (d >> B_HOLO_FRAME) & 1 == 1;
        c.holoPicture = (d >> B_HOLO_PICTURE) & 1 == 1;
        c.extra = uint32(d >> B_EXTRA);
        (,, c.grade, c.cased, c.age, c.moves) = wearOf(serial);
        uint256 at = _dealtAt[serial];
        c.dealtAt = at != 0 ? at : (d >> B_CLOCK) & M40;
    }

    function dealerOf(uint256 fire) external view returns (IDealer) {
        return fires[fire].dealer;
    }

    function tokenURI(uint256 serial) public view override returns (string memory) {
        _requireOwned(serial);
        return renderer.tokenURI(serial);
    }

    /// @dev A card being graded can be burned but not transferred. Every wallet-to-wallet move of an uncased,
    ///      ungraded card counts toward its wear (up to MAX_MOVES; the sender pays the few thousand gas).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            if (gradePending[tokenId]) revert GradingInProgress();
            uint256 d = _card[tokenId];
            uint256 moves = (d >> B_MOVES) & 15;
            // sending a card to its own wallet isn't a move
            if (from != to && (d >> B_FROZEN) & 1 == 0 && moves < MAX_MOVES) {
                _card[tokenId] = d + (1 << B_MOVES);
                emit Moved(tokenId, moves + 1);
                emit MetadataUpdate(tokenId); // its Moves trait changed
            }
        }
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return id == bytes4(0x49064906) || super.supportsInterface(id);
    }
}
