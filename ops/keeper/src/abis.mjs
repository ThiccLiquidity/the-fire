// The slices of the contracts' ABIs the keeper uses (full ABIs: web/src/lib/abi, contracts/out).
import { parseAbi, parseAbiItem } from "viem";

export const twapAbi = parseAbi([
  "function due() view returns (bool)",
  "function checkpoint()",
  "function last() view returns (uint256 cum, uint32 ts)",
  "function prev() view returns (uint256 cum, uint32 ts)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function MIN_WINDOW() view returns (uint256)",
]);

export const paperTwapAbi = parseAbi([
  "function pair() view returns (address)",
  "function candidate() view returns (address)",
  "function candidateSince() view returns (uint32)",
]);

/** FireSale: a drop's state (status: what can still sell, when it can be ended), close for a Series nothing can still
 *  sell in (anyone; normally the last purchase does it, but not when a group's time runs out or an unlimited group
 *  idles out), endDrop for a drop that didn't sell out (the owner at status.endableAt; anyone END_GRACE later), and
 *  the PacksBought event (which group). FireGroups.groupsOf: each group's state, for when the last one ended. */
export const saleAbi = parseAbi([
  "struct Status { bool configured; bool live; bool closed; bool paused; bool plankPriceOk; bool regularWalletsOnly; uint256 left; uint256 endableAt; uint256 creditPacksLeft; }",
  "function status(uint256 fire) view returns (Status)",
  "function close(uint256 fire)",
  "function endDrop(uint256 fire)",
  "function END_GRACE() view returns (uint256)",
  "function GROUPS() view returns (address)",
  "event PacksBought(uint256 indexed fire, uint256 indexed group, address indexed buyer, uint256 count, uint8 pay, uint256 paid, uint256 toLiquidity)",
]);

export const groupsAbi = parseAbi([
  "struct Group { uint64 packs; uint8 gate; uint8 coins; uint8 afterGroup; uint8 rollTo; uint32 startDelay; uint32 duration; uint32 perWallet; uint32 limitFor; uint32 perNft; uint16 taxBps; uint16 plankBurnBps; uint16 paperBurnBps; uint128 priceUsd; uint128 paper; address nft; uint32 idle; uint32 perTx; bool unlimited; bytes32 root; }",
  "struct GroupView { Group config; uint8 state; uint256 capacity; uint256 sold; uint256 left; uint256 opensAt; uint256 endsAt; uint256 limitUntil; }",
  "function groupsOf(uint256 fire) view returns (GroupView[])",
]);

/** FireSale's owner settings: the wallets (revenue, LiquidityBurner) and the price feeds and router. */
export const saleSettingsEvents = parseAbi([
  "event WalletsSet(address revenue, address liquidity)",
  "event FeedsSet(address ethUsd, address plankUsd, address paperUsd, address router)",
]);

export const pausableAbi = parseAbi(["function paused() view returns (bool)"]);

export const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);

export const cardsAbi = parseAbi([
  "function fires(uint256) view returns (address dealer, bool closed, bool locked, uint32 cardsPerPack, uint64 packs, uint64 dealt)",
  "function headOf(uint256) view returns (uint256)",
  "function openCount(uint256) view returns (uint256)",
  "function pending(uint256) view returns (uint256 queued, uint256 readyAtHead)",
  "struct Open { address to; uint64 requestedAt; uint64 readyAt; bool ready; uint64 count; uint64 packsDone; uint32 cardInPack; address source; uint96 requestId; uint64 packBase; uint256 word; }",
  "function openOf(uint256 fire, uint256 index) view returns (Open)",
  "function process(uint256 fire, uint256 maxCards) returns (uint256)",
  "function randomness() view returns (address)",
  "function pendingRandomness() view returns (address)",
  "function pendingRandomnessAt() view returns (uint64)",
  "function applyRandomness()",
]);

export const psaAbi = parseAbi([
  "struct Grading { address by; uint64 requestedAt; bool ready; bool done; address source; uint96 requestId; uint256 word; bytes32 idsHash; }",
  "function gradingOf(uint256) view returns (Grading)",
  "function gradingCount() view returns (uint256)",
  "function finish(uint256 index, uint256[] ids)",
  "function randomness() view returns (address)",
  "function pendingRandomness() view returns (address)",
  "function pendingRandomnessAt() view returns (uint64)",
  "function applyRandomness()",
]);

export const protectedEvent = parseAbiItem(
  "event Protected(address indexed by, uint256[] cased, uint256[] graded, uint8 pay, uint256 paid, uint256 gradingIndex)",
);

export const adapterAbi = parseAbi([
  "function answered(uint256) view returns (bool)",
  "function settle(uint256)",
  "function ROUTER() view returns (address)",
]);

export const routerAbi = parseAbi([
  "function requests(uint256) view returns (address consumer, uint64 round, uint32 callbackGasLimit, bool fulfilled, bool delivered, uint256 randomWord, uint256 fee)",
  "function fulfill(uint256 id, bytes signature)",
  "function fulfillMany(uint256[] ids, bytes[] signatures)",
  "function roundRandomness(uint64) view returns (bytes32)",
  "function GENESIS() view returns (uint256)",
  "function PERIOD() view returns (uint256)",
]);

/** LiquidityBurner: run() spends, evens out, pairs and burns (keepers only; true if anything it held changed, so a
 *  simulation says whether a run is worth sending); held() is what waits, in dollars
 *  (18 decimals): the PAPER side, the PLANK side, ETH + USDG still to spend. */
export const liquidityAbi = parseAbi([
  "function run() returns (bool)",
  "function keeper(address) view returns (bool)",
  "function held() view returns (uint256 paperSide, uint256 plankSide, uint256 toSpend)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);
