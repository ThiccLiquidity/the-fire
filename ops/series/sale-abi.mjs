// The slices of FireSale's and FireGroups' ABIs the launcher, VerifySeries and the tests use (drop groups,
// docs/drop-groups.md). Written out here so ops doesn't depend on web/src/lib/abi being regenerated; sale-abi.test.mjs
// checks every item against the compiled contracts (contracts/out) when they're built.
import { parseAbi } from "viem";

const GROUP = "struct Group { uint64 packs; uint8 gate; uint8 coins; uint8 afterGroup; uint8 rollTo; uint32 startDelay; uint32 duration; uint32 perWallet; uint32 limitFor; uint32 perNft; uint16 taxBps; uint16 plankBurnBps; uint16 paperBurnBps; uint128 priceUsd; uint128 paper; address nft; uint32 idle; uint32 perTx; bool unlimited; bytes32 root; }";
const ACCESS = "struct Access { uint256[] nftIds; uint256 allowance; bytes32[] proof; }";

export const saleAbi = parseAbi([
  GROUP,
  ACCESS,
  "struct Drop { uint64 start; uint64 packs; uint64 sold; uint64 creditPacks; uint32 maxPerTx; uint32 regularWalletsFor; uint16 creditsPerPick; uint8 creditGroup; bool closed; uint64 creditPacksMax; uint64 creditPacksPerWallet; uint128 paperCapUsd; }",
  "struct Status { bool configured; bool live; bool closed; bool paused; bool plankPriceOk; bool regularWalletsOnly; uint256 left; uint256 endableAt; uint256 creditPacksLeft; }",
  "struct DropConfig { uint64 start; uint64 packs; uint128 paperCapUsd; uint32 maxPerTx; uint32 regularWalletsFor; uint16 creditsPerPick; uint64 creditPacksMax; uint64 creditPacksPerWallet; uint8 creditGroup; Group[] groups; }",
  "function dropOf(uint256 fire) view returns (Drop)",
  "function status(uint256 fire) view returns (Status)",
  "function activeDrops() view returns (uint256)",
  "function GROUPS() view returns (address)",
  "function revenueWallet() view returns (address)",
  "function liquidity() view returns (address)",
  "function quote(uint256 fire, uint256 group, uint256 n, uint8 pay) view returns (uint256 cost, uint256 paper)",
  "function paperFor(uint256 fire, uint256 group, uint256 n) view returns (uint256)",
  "function buy(uint256 fire, uint256 group, uint256 n, uint8 pay, uint256 maxCost, uint256 maxPaper, Access access) payable",
  "function buyWithEthAll(uint256 fire, uint256 group, uint256 n, Access access) payable",
  "function close(uint256 fire)",
  "function endDrop(uint256 fire)",
  "function configureDrop(uint256 fire, DropConfig c)",
  "event DropConfigured(uint256 indexed fire, DropConfig config)",
  "event PacksBought(uint256 indexed fire, uint256 indexed group, address indexed buyer, uint256 count, uint8 pay, uint256 paid, uint256 toLiquidity)",
  "event DropClosed(uint256 indexed fire, uint256 packs)",
]);

export const groupsAbi = parseAbi([
  GROUP,
  "struct GroupView { Group config; uint8 state; uint256 capacity; uint256 sold; uint256 left; uint256 opensAt; uint256 endsAt; uint256 limitUntil; }",
  "function groupsOf(uint256 fire) view returns (GroupView[])",
  "function groupCount(uint256 fire) view returns (uint256)",
  "function sale() view returns (address)",
  "function boughtBy(uint256 fire, address wallet) view returns (uint256[])",
]);

/** FireGroups.Gate, FireGroups.State and FireSale.Pay. */
export const GATES = ["open", "nft", "snapshot"];
export const STATES = ["upcoming", "open", "ended"];
export const PAY = { PLANK: 0, ETH: 1, USDG: 2 };
export const NONE = 255;
export const UNLIMITED = 2n ** 256n - 1n;
