// Plain-English reasons for every custom error the site can meet: the card contracts, the randomness router and
// adapter, and the standard ERC-20 errors. The list of errors is generated from the ABIs and extraErrors.json
// (scripts/gen-abi-errors.mjs -> abiErrors.generated.ts); this table must have a message for each one, so
// after `npm run gen:errors` the type check names any error that still needs words. Errors only the owner or another
// contract can hit get a short message too, so nothing ever shows a raw name. No fixed times or numbers here: windows
// and limits are set per Series, so the page shows the live ones.

import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { ERRORS_ABI, type AbiErrorName } from "./abiErrors.generated";
import { friendly } from "./wallet";

type Msg = string | ((args: readonly unknown[]) => string);

const OWNER = "Only the owner can do that.";
const INTERNAL = "That isn't allowed.";
const SETUP = "This Series isn't set up right. Nothing was charged.";

export const MESSAGES: { readonly [K in AbiErrorName]: Msg } = {
  // buying and claiming (FireSale)
  AlreadyClaimed: "You've already claimed this one.",
  AnotherDropActive: "Another Series is still on sale.",
  BadAmount: "Can't buy that many. Try fewer.",
  BadConfig: SETUP,
  CreditCapReached: "This Series' free packs are gone. Yours carry over.",
  CreditWalletLimit: "Free-pack limit reached. The rest carry over.",
  DropStarted: "This Series has already started, so that can't change.",
  DropsActive: "Not while a Series is on sale.",
  FeedUnavailable: "Price unavailable. Nothing charged. Try another coin.",
  NoContracts: "Regular wallets only for now.",
  NoCredits: "You don't have enough free packs.",
  NotLive: "This Series isn't on sale.",
  NotSoldOut: "Packs open when sales end.",
  NotThisRound: "That idea isn't from this round.",
  PriceMoved: "Price changed. Check it and try again.",
  SoldOut: "Not enough packs left.",
  TooEarly: "Too early. Try again later.",
  TransferFailed: "A payment didn't go through. Nothing was charged.",
  WalletLimit: "Wallet limit reached for this group.",

  // the drop's groups (FireGroups): who can buy, how many, when
  BadGroup: (a) => `Group ${Number(a[0]) + 1} of this Series isn't set up right.`,
  CoinNotAccepted: "This group doesn't take that coin. Pick another one.",
  GroupNotOpen: "This group isn't open right now. Nothing was charged.",
  NftUsed: "That NFT already got its packs.",
  NotAllowed: "This wallet can't buy in this group.",
  NotSale: INTERNAL,
  PerTxLimit: "Too many for one buy. Try fewer.",
  PriceTooHigh: "Extra packs hit their price cap. Sales end soon.",

  // packs, cards, opening (FirePacks, FireCards, RecipeDealer)
  AlreadyCased: "That card is already cased.",
  AlreadyGraded: "That card is already graded. Grades are final.",
  BadCount: "That number of packs isn't allowed.",
  BadDeal: "The cards couldn't be dealt. Nothing was lost. Try again later.",
  BadGrade: "That grade isn't valid.",
  BadLength: "The lists in that request don't match.",
  BadRecipe: (a) => `The recipe isn't set up right: ${String(a[0])}.`,
  BadText: "That text has characters that aren't allowed.",
  BadType: (a) => `Card type ${String(a[0])} isn't set up right: ${String(a[1])}.`,
  BadSlot: (a) => `Pack slot ${String(a[0])} isn't set up right: ${String(a[1])}.`,
  FireIsClosed: "This Series is closed.",
  FireIsLocked: "This Series is locked, so that can't change.",
  FireNotClosed: "Packs open when sales end.",
  GradingInProgress: "That card is being graded.",
  NotConfigured: "This Series isn't set up yet.",
  NotHolder: "That card isn't in your wallet.",
  NotStuck: "Can't cancel: the draw came in, or 24 hours haven't passed.",
  RoyaltyTooHigh: "The royalty can be at most 10%.",
  TooMany: "Too many packs for this Series.",
  BadWeights: "Character odds need one weight per character, each at least 1.",

  // cases and grading (FirePsa, LiquidityBurner)
  BadPair: INTERNAL,
  NotKeeper: "That isn't allowed.",
  NotIssuer: INTERNAL,
  NoPrice: "No PAPER price yet. Try again soon.",
  BadRoute: "That isn't set up right.",
  FeedsAlreadySet: "The price feeds are already set.",
  NotReady: "Not ready yet. Try again soon.",
  Pending: "That card is being graded.",

  // the Morning Wood (MorningWood)
  AlreadyOpen: "This issue is already on sale, so that can't change.",
  BadIssue: "That issue doesn't exist.",
  BadLetter: "That letter is empty or too long. Try a shorter one.",
  BadQty: "Can't buy that many. Try fewer.",
  BadTime: "That sale time isn't allowed.",
  NotEditor: INTERNAL,
  NotOnSale: "This issue isn't on sale right now.",
  OutOfBounds: "That setting is out of range.",
  TooLate: "This issue opens within the hour, so only the owner can change it now.",

  // profiles (FireProfiles)
  BadName: "Names are 1-20 letters, numbers or symbols, with single spaces between words.",
  NameTaken: "That name is taken.",
  NotYourCard: "That card isn't in your wallet.",

  // the market (FireMarket)
  BadPrice: "Enter a price above 0.",
  NotApproved: "Let the market sell your cards first, then list again.",
  NotListed: "That listing is gone. Someone may have bought it.",
  NotStale: "Only the seller can take that off sale.",
  NotYours: "That isn't in your wallet any more.",
  NothingOwed: "Nothing to collect.",
  OwnListing: "That's your own listing.",
  PriceChanged: "The price just changed. Check the new price and try again. Nothing was charged.",
  Stale: "That's no longer for sale (the seller moved it). Nothing was charged.",
  WithdrawFailed: "Your wallet refused the ETH. Try from another wallet.",
  WrongPayment: "The amount sent didn't match the price. Nothing was charged.",
  BadOffer: "That offer isn't valid. Check what it's for and how many.",
  BadExpiry: "Pick when the offer ends: up to 180 days from now.",
  OfferGone: "That offer is gone. Someone may have filled it.",
  NoMatch: "That card doesn't match the offer.",
  NotFunded: "The buyer no longer has the WETH for that offer. Nothing was sent.",
  NotWeth: INTERNAL,

  // the game room (FireGames) and its prizes (FireCredits)
  AlreadyAdded: "That game is already added.",
  AlreadyPaid: "This run is already paid. Start a new one.",
  BadSignature: "This run's ticket doesn't match. Start a new run. Nothing was charged.",
  Expired: "This run's ticket expired. Start a new run. Nothing was charged.",
  NoGame: "That game isn't here.",
  NotOpen: "Paid play is closed right now. Nothing was charged.",
  NotAwarder: OWNER,
  NotPrizeGame: "That game doesn't give prizes.",
  InvalidShortString: INTERNAL,
  StringTooLong: INTERNAL,

  // only the owner or Cardworks' own contracts
  AlreadySet: "That's already set.",
  NotCards: INTERNAL,
  NotPsa: INTERNAL,
  NotRandomness: INTERNAL,
  NotSeller: INTERNAL,
  OwnableInvalidOwner: "That owner address isn't valid.",
  OwnableUnauthorizedAccount: OWNER,
  ReentrancyGuardReentrantCall: "That isn't allowed.",
  SafeERC20FailedOperation: "Payment failed. Check your balance and try again.",
  ZeroAddress: "An address is missing.",
  // added with the strategic review contracts
  BadIds: "Cards changed. Refresh and try again.",
  BadRequest: "That request doesn't match. Refresh and try again.",
  IsPaused: "Paused for a moment. Nothing was charged. Try again soon.",
  NotCredits: INTERNAL,
  RenounceDisabled: OWNER,

  // randomness (OpenDrandRouter, OpenVRFAdapter): mostly for whoever delivers it, never a player's payment
  AlreadyFulfilled: "Already drawn.",
  FeeUnpaid: "Draw fee missing. Nothing charged.",
  IncorrectFee: "Wrong draw fee. Nothing charged.",
  InsufficientGas: "Network fee too low. Try again.",
  InvalidCallback: "That draw can't be retried.",
  InvalidRequest: "That draw isn't valid.",
  NotFulfilled: "The draw hasn't arrived yet.",
  OnlyFire: INTERNAL,
  OnlyRouter: INTERNAL,
  ReentrantDelivery: "That isn't allowed.",

  // standard token errors (OpenZeppelin)
  ERC20InsufficientAllowance: "Approval too low. Approve again.",
  ERC20InsufficientBalance: "Not enough of that coin.",
  ERC20InvalidApprover: "That approval isn't valid.",
  ERC20InvalidReceiver: "That address can't receive coins.",
  ERC20InvalidSender: "Coins can't be sent from that address.",
  ERC20InvalidSpender: "That address can't be approved.",
  ERC1155InsufficientBalance: "You don't have enough of those packs.",
  ERC1155InvalidApprover: "That approval isn't valid.",
  ERC1155InvalidArrayLength: "The lists in that request don't match.",
  ERC1155InvalidOperator: "That address can't be approved.",
  ERC1155InvalidReceiver: "That address can't receive packs.",
  ERC1155InvalidSender: "Those packs can't be sent from that address.",
  ERC1155MissingApprovalForAll: "That address isn't allowed to move your packs.",
  ERC2981InvalidDefaultRoyalty: "The royalty can be at most 10%.",
  ERC2981InvalidDefaultRoyaltyReceiver: "The royalty needs a wallet to go to.",
  ERC2981InvalidTokenRoyalty: "The royalty can be at most 10%.",
  ERC2981InvalidTokenRoyaltyReceiver: "The royalty needs a wallet to go to.",
  ERC721IncorrectOwner: "That card isn't owned by that wallet.",
  ERC721InsufficientApproval: "That address isn't allowed to move this card.",
  ERC721InvalidApprover: "That approval isn't valid.",
  ERC721InvalidOperator: "That address can't be approved.",
  ERC721InvalidOwner: "That owner address isn't valid.",
  ERC721InvalidReceiver: "That address can't receive cards.",
  ERC721InvalidSender: "That card can't be sent from that address.",
  ERC721NonexistentToken: "That card doesn't exist.",
};

/** "NotSoldOut" -> "Not sold out" (for an error added to the contracts before its message was written). */
const words = (name: string) => {
  const s = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return s[0].toUpperCase() + s.slice(1) + ".";
};

/** The message for a contract error by name, with its decoded arguments. */
export function errorMessage(name: string, args: readonly unknown[] = []): string {
  const m = (MESSAGES as Record<string, Msg | undefined>)[name];
  return m === undefined ? words(name) : typeof m === "function" ? m(args) : m;
}

/** The custom error inside a failed call, if there is one: decoded by viem, or from raw revert data (matched against
 *  every error in ERRORS_ABI: the card contracts, the randomness contracts and ERC-20). */
export function revertOf(e: unknown): { name: string; args: readonly unknown[] } | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (rev?.data?.errorName) return { name: rev.data.errorName, args: rev.data.args ?? [] };
  // a revert from a call made without the ABI (or from a contract it called): decode the selector against every error we know
  const raw = (rev?.raw ?? (e.walk((x) => typeof (x as { data?: unknown })?.data === "string") as { data?: Hex } | null)?.data) as Hex | undefined;
  if (raw && /^0x[0-9a-f]{8}/i.test(raw)) {
    try { const d = decodeErrorResult({ abi: ERRORS_ABI, data: raw }); return { name: d.errorName, args: d.args ?? [] }; } catch { /* not one of ours */ }
  }
  return undefined;
}

/** A short, plain reason for any failed action: a contract error in plain English, else the wallet's reason. */
export function explain(e: unknown): string {
  const r = revertOf(e);
  return r ? errorMessage(r.name, r.args) : friendly(e);
}
