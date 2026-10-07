// Plain-English reasons for every custom error the card contracts can raise. The list of errors is generated from
// the ABIs (scripts/gen-abi-errors.mjs -> abiErrors.generated.ts); this table must have a message for each one, so
// after `npm run gen:errors` the type check names any error that still needs words. Errors only the owner or another
// contract can hit get a short message too, so nothing ever shows a raw name.

import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { ERRORS_ABI, type AbiErrorName } from "./abiErrors.generated";
import { friendly } from "./wallet";

type Msg = string | ((args: readonly unknown[]) => string);

const OWNER = "Only the owner can do that.";
const INTERNAL = "That call is only for the Forge's own contracts.";
const SETUP = "This Series isn't set up right. Nothing was charged.";

export const MESSAGES: { readonly [K in AbiErrorName]: Msg } = {
  // buying and claiming (FireSale)
  AlreadyClaimed: "You've already claimed this one.",
  AnotherDropActive: "Another Series is still on sale.",
  BadAmount: "That amount isn't allowed. Check how many and try again.",
  BadConfig: SETUP,
  CreditCapReached: "Free packs for this Series are all used up. Yours wait for the next one.",
  CreditWalletLimit: "That's the most free packs one wallet can use this Series. The rest wait for the next one.",
  DropStarted: "This Series has already started, so that can't change.",
  DropsActive: "Not while a Series is on sale.",
  FeedUnavailable: "Prices can't be read right now. Nothing was charged. Try again in a minute.",
  HoldersOnly: "The first 24 hours are for Paper Press and PLANK holders.",
  NoContracts: "For the first 48 hours, only regular wallets (like MetaMask or Rabby) can buy.",
  NoCredits: "You don't have enough free packs.",
  NotLive: "This Series isn't on sale.",
  NotPressOwner: "That Paper Press isn't in your wallet.",
  NotSoldOut: "Packs open once the Series sells out.",
  NotThisRound: "That suggestion isn't from this round.",
  PlankOnly: "The first packs of a Series are PLANK only. Pay with PLANK.",
  PressUsed: "That Paper Press has already claimed its pack this Series.",
  PriceMoved: "The price just moved. Check the new price and try again.",
  SoldOut: "Sold out. There aren't enough packs left.",
  StarterWindowClosed: "Press packs could only be claimed in the first 24 hours.",
  TooEarly: "It's too early to end this Series.",
  TransferFailed: "A payment didn't go through. Nothing was charged.",
  WalletLimit: "That's the most packs one wallet can buy for now. The limit lifts after 48 hours.",

  // packs, cards, opening (FirePacks, FireCards, RecipeDealer)
  AlreadyCased: "That card is already cased.",
  AlreadyGraded: "That card is already graded. Grades are final.",
  BadCount: "That number of packs isn't allowed.",
  BadDeal: "The cards couldn't be dealt. Nothing was lost; try again later.",
  BadFiller: SETUP,
  BadGrade: "That grade isn't valid.",
  BadLength: "The lists in that request don't match.",
  BadSlot: (a) => `Pack slot ${String(a[0])} isn't set up right: ${String(a[1])}.`,
  BadText: "That text has characters that aren't allowed.",
  BadType: (a) => `Card type ${String(a[0])} isn't set up right: ${String(a[1])}.`,
  FireIsClosed: "This Series is closed.",
  FireIsLocked: "This Series is locked, so that can't change.",
  FireNotClosed: "Packs open once the Series sells out or ends.",
  GradingInProgress: "That card is at the grader. Wait for its grade first.",
  Infeasible: SETUP,
  NeverHolo: (a) => `Pack slot ${String(a[0])} needs a holo, but card type ${String(a[1])} is never holo.`,
  NotClosed: "This Series isn't closed yet.",
  NotConfigured: "This Series isn't set up yet.",
  NotHolder: "That card isn't in your wallet.",
  NotNested: (a) => `Pack slots ${String(a[0])} and ${String(a[1])} overlap in a way that isn't allowed.`,
  NothingLeft: "There are no cards of that kind left in this Series.",
  NotStuck: "It isn't stuck. Give the randomness a little longer.",
  RoyaltyTooHigh: "The royalty can be at most 10%.",
  TooMany: "Too many packs for this Series.",
  TypeNeverDealt: (a) => `Card type ${String(a[0])} would never be dealt.`,

  // cases and grading (FirePsa, PaperBurner)
  BadRoute: "The PAPER burn route isn't valid.",
  FeedsAlreadySet: "The price feeds are already set.",
  NotReady: "The randomness for that isn't ready yet. Try again in a minute.",
  Pending: "That card is already at the grader.",

  // only the owner or the Forge's own contracts
  AlreadySet: "That's already set.",
  NotCards: INTERNAL,
  NotPsa: INTERNAL,
  NotRandomness: INTERNAL,
  NotSeller: INTERNAL,
  OwnableInvalidOwner: "That owner address isn't valid.",
  OwnableUnauthorizedAccount: OWNER,
  ReentrancyGuardReentrantCall: "That call isn't allowed from inside another call.",
  SafeERC20FailedOperation: "A token transfer failed. Check your balance and approval, then try again.",
  ZeroAddress: "An address is missing.",
  // added with the strategic review contracts
  BadIds: "Those aren't the cards in that grading. Refresh and try again.",
  BadPay: "That way to pay isn't supported here.",
  BadRequest: "That request doesn't match. Refresh and try again.",
  IsPaused: "Paused for a moment. Nothing was charged. Try again soon.",
  NotCredits: INTERNAL,
  RenounceDisabled: OWNER,

  // standard token errors (OpenZeppelin)
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

/** The custom error inside a failed call, if there is one: decoded by viem, or from raw revert data. */
export function revertOf(e: unknown): { name: string; args: readonly unknown[] } | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (rev?.data?.errorName) return { name: rev.data.errorName, args: rev.data.args ?? [] };
  // a revert from a call made without the ABI: decode the selector against every card contract error
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
