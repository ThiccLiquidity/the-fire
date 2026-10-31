// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IMarketCards {
    function ownerOf(uint256 id) external view returns (address);
    function getApproved(uint256 id) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 id) external;
    function royaltyInfo(uint256 id, uint256 price) external view returns (address, uint256);
    function cardOf(uint256 serial) external view returns (MarketCardView memory);
}

/// @dev FireCards.Card, as cardOf returns it.
struct MarketCardView {
    uint256 fire;
    uint256 cardType;
    bool holoFrame;
    bool holoPicture;
    uint256 character;
    uint256 printNumber;
    uint256 grade;
    bool cased;
    uint256 age;
    uint256 moves;
    uint256 dealtAt;
    uint256 extra;
}

interface IMarketWeth {
    function withdraw(uint256 amount) external;
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IMarketPacks {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function royaltyInfo(uint256 id, uint256 price) external view returns (address, uint256);
}

/**
 * @title FireMarket
 * @notice Omni Cardworks' own market: cards (FireCards) and sealed packs (FirePacks) for sale at a fixed price in ETH.
 *         No owner, no fees, no admin, no pause, no upgrade. It never holds a card or a pack: a listing is a price, and
 *         the card stays in the seller's wallet until someone buys it (the seller approves this contract to move it,
 *         once). A buy moves the card and pays out in the same transaction: the collection's royalty (ERC-2981, at most
 *         10% here) to its receiver, the rest to the seller. A payout a wallet refuses waits in `owed` for `withdraw`.
 *
 *         Cards: one listing per card (listing again changes the price). A buy checks the seller still holds the card
 *         and the price is the one the buyer saw. A card being graded can't move (FireCards), so its buy fails until the
 *         grading ends. A sale counts as a move toward an uncased card's wear, like any transfer.
 *         Packs: a listing is a number of one Series' packs at a price each; buy any number of them. A buy checks the
 *         seller still holds them.
 *
 *         Stale listings (the card sold or moved elsewhere, the packs gone, the approval taken back, or ended by the
 *         seller's `cancelAll`) can't be bought; anyone may clear them. A card that comes back to its seller brings its
 *         old listing back to life: the site shows it on the card, and `cancelCard` / `cancelAll` end it.
 *
 *         Offers: a buyer offers a price (in WETH) for one card, for any card that matches (Series, card type,
 *         character, holo, lowest grade), or for some of a Series' packs. The WETH stays in the buyer's wallet (the buyer
 *         approves this contract for it) until a holder accepts: then, in one transaction, the WETH comes in, is turned
 *         into ETH, the card or packs move to the buyer and the ETH is paid out like a sale (royalty, then the seller).
 *         An offer ends at its expiry (at most 180 days), when it is filled, cancelled, or by the buyer's `cancelAll`;
 *         one the buyer can no longer pay for (WETH spent or approval taken back) can't be accepted, and anyone may
 *         clear an offer that can't be accepted.
 */
contract FireMarket is ReentrancyGuard {
    IMarketCards public immutable CARDS;
    IMarketPacks public immutable PACKS;
    /// @notice The most royalty paid out of a sale (a collection can't set more than 10% anyway).
    uint256 public constant MAX_ROYALTY_BPS = 1000;

    struct CardListing {
        address seller;
        uint96 price; // wei
        uint64 round; // the seller's round when listed (cancelAll ends a round)
    }
    struct PackListing {
        address seller;
        uint32 series;
        uint32 amount; // packs left in it
        uint96 pricePer; // wei a pack
        uint64 round;
    }

    mapping(uint256 => CardListing) public cardListing;
    mapping(uint256 => PackListing) public packListing;
    uint256 public nextPackListing = 1;
    /// @notice ETH a wallet refused when it was paid (a contract that can't take ETH), to `withdraw`.
    mapping(address => uint256) public owed;
    /// @notice A seller's listing round: `cancelAll` moves it on, and every listing from an older round is dead.
    mapping(address => uint64) public round;

    IMarketWeth public immutable WETH;
    uint256 public constant MAX_OFFER_DAYS = 180;
    uint8 public constant OFFER_CARD = 0; // target: the card's serial
    uint8 public constant OFFER_MATCH = 1; // target: packed criteria (matchKey)
    uint8 public constant OFFER_PACKS = 2; // target: the Series

    struct Offer {
        address buyer;
        uint96 price; // wei (WETH) a card or a pack
        uint8 kind;
        uint32 qty; // cards or packs still wanted
        uint40 expiry; // unix seconds
        uint64 round; // the buyer's round when made (cancelAll ends it)
        uint256 target;
    }

    mapping(uint256 => Offer) public offers;
    uint256 public nextOffer = 1;

    event CardListed(uint256 indexed serial, address indexed seller, uint256 price);
    event CardUnlisted(uint256 indexed serial, address indexed seller);
    event CardSold(uint256 indexed serial, address indexed seller, address indexed buyer, uint256 price, uint256 royalty);
    event PacksListed(uint256 indexed id, address indexed seller, uint256 indexed series, uint256 amount, uint256 pricePer);
    event PacksUnlisted(uint256 indexed id, address indexed seller);
    event PacksSold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 series, uint256 amount, uint256 pricePer, uint256 royalty);
    event Owed(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AllCancelled(address indexed seller, uint64 round);
    event OfferMade(uint256 indexed id, address indexed buyer, uint8 kind, uint256 indexed target, uint256 price, uint256 qty, uint256 expiry);
    event OfferCancelled(uint256 indexed id, address indexed buyer);
    event OfferAccepted(uint256 indexed id, address indexed seller, address indexed buyer, uint256 item, uint256 amount, uint256 price, uint256 royalty);

    error ZeroAddress();
    error NotYours();
    error NotApproved();
    error BadPrice();
    error BadAmount();
    error NotListed();
    error PriceChanged();
    error WrongPayment();
    error Stale();
    error OwnListing();
    error NotStale();
    error NothingOwed();
    error WithdrawFailed();
    error BadOffer();
    error BadExpiry();
    error OfferGone();
    error NoMatch();
    error NotFunded();
    error NotWeth();

    constructor(address cards, address packs, address weth) {
        if (cards == address(0) || packs == address(0) || weth == address(0)) revert ZeroAddress();
        CARDS = IMarketCards(cards);
        PACKS = IMarketPacks(packs);
        WETH = IMarketWeth(weth);
    }

    /// @dev Only WETH sends ETH here (an accepted offer's WETH, turned into ETH and paid straight out).
    receive() external payable {
        if (msg.sender != address(WETH)) revert NotWeth();
    }

    // ---------- cards

    /// @notice List (or re-price) a card you hold. Approve this contract on FireCards first.
    function listCard(uint256 serial, uint256 price) external {
        if (price == 0 || price > type(uint96).max) revert BadPrice();
        if (CARDS.ownerOf(serial) != msg.sender) revert NotYours();
        if (!_cardApproved(msg.sender, serial)) revert NotApproved();
        // forge-lint: disable-next-line(unsafe-typecast)
        cardListing[serial] = CardListing({seller: msg.sender, price: uint96(price), round: round[msg.sender]}); // checked above
        emit CardListed(serial, msg.sender, price);
    }

    /// @notice Take a card off sale: its seller, or anyone once the listing is stale (the seller no longer holds it or
    ///         took the approval back).
    function cancelCard(uint256 serial) external {
        CardListing memory l = cardListing[serial];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender && _cardLive(l, serial)) revert NotStale();
        delete cardListing[serial];
        emit CardUnlisted(serial, l.seller);
    }

    /// @notice Buy a listed card. `price` is the price you saw; send exactly that.
    function buyCard(uint256 serial, uint256 price) external payable nonReentrant {
        CardListing memory l = cardListing[serial];
        if (l.seller == address(0)) revert NotListed();
        if (l.price != price) revert PriceChanged();
        if (msg.value != price) revert WrongPayment();
        if (l.seller == msg.sender) revert OwnListing();
        if (!_cardLive(l, serial)) revert Stale();
        delete cardListing[serial];
        CARDS.safeTransferFrom(l.seller, msg.sender, serial);
        (address receiver, uint256 r) = CARDS.royaltyInfo(serial, price);
        uint256 royalty = _payOut(receiver, r, l.seller, price);
        emit CardSold(serial, l.seller, msg.sender, price, royalty);
    }

    /// @notice A card's listing and whether it can be bought now (the seller holds it and the approval stands).
    function cardOffer(uint256 serial) external view returns (address seller, uint256 price, bool live) {
        CardListing memory l = cardListing[serial];
        return (l.seller, l.price, l.seller != address(0) && _cardLive(l, serial));
    }

    // ---------- packs

    /// @notice List `amount` of your Series `series` packs at `pricePer` each. Approve this contract on FirePacks first.
    function listPacks(uint256 series, uint256 amount, uint256 pricePer) external returns (uint256 id) {
        if (pricePer == 0 || pricePer > type(uint96).max) revert BadPrice();
        if (amount == 0 || amount > type(uint32).max || series > type(uint32).max) revert BadAmount();
        if (PACKS.balanceOf(msg.sender, series) < amount) revert NotYours();
        if (!PACKS.isApprovedForAll(msg.sender, address(this))) revert NotApproved();
        id = nextPackListing++;
        // forge-lint: disable-next-line(unsafe-typecast)
        packListing[id] = PackListing({seller: msg.sender, series: uint32(series), amount: uint32(amount), pricePer: uint96(pricePer), round: round[msg.sender]}); // checked above
        emit PacksListed(id, msg.sender, series, amount, pricePer);
    }

    /// @notice Take packs off sale: their seller, or anyone once the listing is stale (no packs left to sell or the
    ///         approval taken back).
    function cancelPacks(uint256 id) external {
        PackListing memory l = packListing[id];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender && _packsLive(l) > 0) revert NotStale();
        delete packListing[id];
        emit PacksUnlisted(id, l.seller);
    }

    /// @notice Buy `amount` packs from listing `id` at `pricePer` each (the price you saw); send amount x pricePer.
    function buyPacks(uint256 id, uint256 amount, uint256 pricePer) external payable nonReentrant {
        PackListing memory l = packListing[id];
        if (l.seller == address(0)) revert NotListed();
        if (l.pricePer != pricePer) revert PriceChanged();
        if (amount == 0 || amount > l.amount) revert BadAmount();
        uint256 total = amount * pricePer;
        if (msg.value != total) revert WrongPayment();
        if (l.seller == msg.sender) revert OwnListing();
        if (_packsLive(l) < amount) revert Stale();
        if (amount == l.amount) delete packListing[id];
        // forge-lint: disable-next-line(unsafe-typecast)
        else packListing[id].amount = l.amount - uint32(amount); // amount < l.amount
        PACKS.safeTransferFrom(l.seller, msg.sender, l.series, amount, "");
        (address receiver, uint256 r) = PACKS.royaltyInfo(l.series, total);
        uint256 royalty = _payOut(receiver, r, l.seller, total);
        emit PacksSold(id, l.seller, msg.sender, l.series, amount, pricePer, royalty);
    }

    /// @notice A pack listing and how many of its packs can be bought now.
    function packOffer(uint256 id) external view returns (PackListing memory listing, uint256 live) {
        listing = packListing[id];
        live = listing.seller == address(0) ? 0 : _packsLive(listing);
    }

    // ---------- offers

    /// @notice Criteria for an "any matching card" offer, packed into its target. 0 = any, for each:
    ///         fire: the Series; cardType: the Series' type index + 1; character: its index + 1;
    ///         holo: 1 none, 2 frame only, 3 picture only, 4 full, 5 any holo; minGrade: graded at least this (1-10).
    function matchKey(uint256 fire, uint256 cardTypePlus1, uint256 characterPlus1, uint256 holo, uint256 minGrade)
        public
        pure
        returns (uint256)
    {
        if (fire > type(uint32).max || cardTypePlus1 > type(uint16).max || characterPlus1 > type(uint32).max || holo > 5 || minGrade > 10) {
            revert BadOffer();
        }
        return fire | cardTypePlus1 << 32 | characterPlus1 << 48 | holo << 80 | minGrade << 88;
    }

    /// @notice Does card `serial` meet a match offer's criteria?
    function matches(uint256 key, uint256 serial) public view returns (bool) {
        MarketCardView memory c = CARDS.cardOf(serial);
        uint256 fire = uint32(key);
        uint256 t = uint16(key >> 32);
        uint256 ch = uint32(key >> 48);
        uint256 holo = uint8(key >> 80);
        uint256 g = uint8(key >> 88);
        if (fire != 0 && c.fire != fire) return false;
        if (t != 0 && c.cardType + 1 != t) return false;
        if (ch != 0 && c.character + 1 != ch) return false;
        if (holo == 1 && (c.holoFrame || c.holoPicture)) return false;
        if (holo == 2 && !(c.holoFrame && !c.holoPicture)) return false;
        if (holo == 3 && !(c.holoPicture && !c.holoFrame)) return false;
        if (holo == 4 && !(c.holoFrame && c.holoPicture)) return false;
        if (holo == 5 && !(c.holoFrame || c.holoPicture)) return false;
        if (g != 0 && c.grade < g) return false;
        return true;
    }

    /// @notice Offer `price` (wei of WETH) each for `qty` of: one card (OFFER_CARD, target = serial, qty 1), any card
    ///         matching (OFFER_MATCH, target = matchKey), or a Series' packs (OFFER_PACKS, target = the Series), until
    ///         `expiry`. Approve this contract for the WETH (price x qty) and hold it; nothing moves until accepted.
    function makeOffer(uint8 kind, uint256 target, uint256 price, uint256 qty, uint256 expiry) external returns (uint256 id) {
        if (price == 0 || price > type(uint96).max) revert BadPrice();
        if (kind > OFFER_PACKS || qty == 0 || qty > type(uint32).max || (kind == OFFER_CARD && qty != 1)) revert BadOffer();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_OFFER_DAYS * 1 days) revert BadExpiry();
        if (kind == OFFER_CARD && CARDS.ownerOf(target) == msg.sender) revert OwnListing();
        if (kind == OFFER_PACKS && (target == 0 || target > type(uint32).max)) revert BadOffer();
        id = nextOffer++;
        // forge-lint: disable-next-line(unsafe-typecast)
        offers[id] = Offer({buyer: msg.sender, price: uint96(price), kind: kind, qty: uint32(qty), expiry: uint40(expiry), round: round[msg.sender], target: target}); // checked above
        emit OfferMade(id, msg.sender, kind, target, price, qty, expiry);
    }

    /// @notice Take an offer down: its buyer, or anyone once it can't be accepted (expired, ended by cancelAll, or the
    ///         buyer can't pay one).
    function cancelOffer(uint256 id) external {
        Offer memory o = offers[id];
        if (o.buyer == address(0)) revert OfferGone();
        if (o.buyer != msg.sender && _offerLive(o)) revert NotStale();
        delete offers[id];
        emit OfferCancelled(id, o.buyer);
    }

    /// @notice Accept offer `id` at `price` each (the price you saw): sell it card `serial` (a card or match offer; for
    ///         a card offer, its own card) or `amount` packs (a pack offer). You get the ETH, less the royalty.
    function acceptOffer(uint256 id, uint256 serial, uint256 amount, uint256 price) external nonReentrant {
        Offer memory o = offers[id];
        if (o.buyer == address(0)) revert OfferGone();
        if (o.price != price) revert PriceChanged();
        if (!_offerLive(o)) revert Stale();
        if (o.buyer == msg.sender) revert OwnListing();
        uint256 item;
        if (o.kind == OFFER_PACKS) {
            if (amount == 0 || amount > o.qty) revert BadAmount();
            if (!PACKS.isApprovedForAll(msg.sender, address(this))) revert NotApproved();
            item = o.target;
        } else {
            amount = 1;
            if (o.kind == OFFER_CARD ? serial != o.target : !matches(o.target, serial)) revert NoMatch();
            if (CARDS.ownerOf(serial) != msg.sender) revert NotYours();
            if (!_cardApproved(msg.sender, serial)) revert NotApproved();
            item = serial;
        }
        if (amount == o.qty) delete offers[id];
        // forge-lint: disable-next-line(unsafe-typecast)
        else offers[id].qty = o.qty - uint32(amount); // amount < o.qty
        uint256 total = amount * price;
        if (!WETH.transferFrom(o.buyer, address(this), total)) revert NotFunded();
        WETH.withdraw(total);
        address receiver;
        uint256 r;
        if (o.kind == OFFER_PACKS) {
            PACKS.safeTransferFrom(msg.sender, o.buyer, item, amount, "");
            (receiver, r) = PACKS.royaltyInfo(item, total);
        } else {
            CARDS.safeTransferFrom(msg.sender, o.buyer, item);
            (receiver, r) = CARDS.royaltyInfo(item, total);
        }
        uint256 royalty = _payOut(receiver, r, msg.sender, total);
        emit OfferAccepted(id, msg.sender, o.buyer, item, amount, price, royalty);
    }

    /// @notice An offer and whether it can be accepted now (not expired or ended, and the buyer can pay for one).
    function offerOf(uint256 id) external view returns (Offer memory offer, bool live) {
        offer = offers[id];
        live = offer.buyer != address(0) && _offerLive(offer);
    }

    /// @notice End every listing and offer you have, cards and packs, in one go (the old ones can't be bought or
    ///         accepted; anyone may clear them). New ones after this work as usual.
    function cancelAll() external {
        uint64 r = ++round[msg.sender];
        emit AllCancelled(msg.sender, r);
    }

    // ---------- payouts

    /// @notice Collect ETH that couldn't be sent to you when you sold.
    function withdraw() external nonReentrant {
        uint256 a = owed[msg.sender];
        if (a == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: a}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(msg.sender, a);
    }

    // ---------- internals

    function _cardApproved(address seller, uint256 serial) internal view returns (bool) {
        return CARDS.isApprovedForAll(seller, address(this)) || CARDS.getApproved(serial) == address(this);
    }

    function _cardLive(CardListing memory l, uint256 serial) internal view returns (bool) {
        if (l.round != round[l.seller]) return false;
        try CARDS.ownerOf(serial) returns (address o) {
            return o == l.seller && _cardApproved(l.seller, serial);
        } catch {
            return false; // burned
        }
    }

    /// @dev An offer can be accepted: not expired, not ended by cancelAll, and the buyer holds and approved the WETH for
    ///      at least one.
    function _offerLive(Offer memory o) internal view returns (bool) {
        if (o.expiry <= block.timestamp || o.round != round[o.buyer]) return false;
        return WETH.balanceOf(o.buyer) >= o.price && WETH.allowance(o.buyer, address(this)) >= o.price;
    }

    /// @dev How many of a listing's packs can be bought now: what's listed, up to what the seller holds, if approved.
    function _packsLive(PackListing memory l) internal view returns (uint256) {
        if (l.round != round[l.seller] || !PACKS.isApprovedForAll(l.seller, address(this))) return 0;
        uint256 bal = PACKS.balanceOf(l.seller, l.series);
        return bal < l.amount ? bal : l.amount;
    }

    /// @dev Pays the royalty (capped at MAX_ROYALTY_BPS) and the seller; returns the royalty paid.
    function _payOut(address receiver, uint256 royalty, address seller, uint256 total) internal returns (uint256) {
        uint256 cap = total * MAX_ROYALTY_BPS / 10_000;
        if (receiver == address(0)) royalty = 0;
        else if (royalty > cap) royalty = cap;
        if (royalty > 0) _send(receiver, royalty);
        _send(seller, total - royalty);
        return royalty;
    }

    /// @dev A refused payment doesn't block the sale: it waits in `owed`.
    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            owed[to] += amount;
            emit Owed(to, amount);
        }
    }
}
