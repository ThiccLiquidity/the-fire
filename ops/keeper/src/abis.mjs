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
]);

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
]);

export const psaAbi = parseAbi([
  "struct Grading { address by; uint64 requestedAt; bool ready; bool done; address source; uint96 requestId; uint256 word; bytes32 idsHash; }",
  "function gradingOf(uint256) view returns (Grading)",
  "function gradingCount() view returns (uint256)",
  "function finish(uint256 index, uint256[] ids)",
  "function randomness() view returns (address)",
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

/** PaperBurner and PlankBurner: flush(pay) returns what it burned (0 = nothing moved; a Waiting event says why). */
export const burnerAbi = parseAbi([
  "function flush(uint8 pay) returns (uint256)",
  "function PLANK() view returns (address)",
  "function USDG() view returns (address)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
