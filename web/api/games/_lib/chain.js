// The chain, through viem: FireGames' switches, the run approval (EIP-712, signed with GAME_SIGNER_KEY) and RunPaid.
// Must match contracts/src/cards/FireGames.sol exactly: domain ("FireGames", "1", chainId, FireGames' address) and
// Run(uint256 gameId,bytes32 runId,address player,uint256 series,uint256 deadline).
import { createPublicClient, defineChain, getAddress, http, parseAbi, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const FIRE_GAMES_ABI = parseAbi([
  'function paused() view returns (bool)',
  'function series() view returns (uint256)',
  'function signer() view returns (address)',
  'function gameOpen(uint256 gameId) view returns (bool)',
  'function entryOf(uint256 gameId) view returns (uint256)',
  'function priceOf(uint256 gameId) view returns (uint256)',
  'function payRun(uint256 gameId, bytes32 runId, uint256 forSeries, uint256 deadline, uint256 maxPaper, bytes sig)',
  'function runDigest(uint256 gameId, bytes32 runId, address player, uint256 forSeries, uint256 deadline) view returns (bytes32)',
  'event RunPaid(uint256 indexed gameId, bytes32 indexed runId, address indexed player, uint256 series, uint256 paper)',
]);
export const RUN_TYPES = {
  Run: [
    { name: 'gameId', type: 'uint256' },
    { name: 'runId', type: 'bytes32' },
    { name: 'player', type: 'address' },
    { name: 'series', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
export const runDomain = (chainId, verifyingContract) => ({ name: 'FireGames', version: '1', chainId, verifyingContract: getAddress(verifyingContract) });

const RPC = { 4663: 'https://rpc.mainnet.chain.robinhood.com', 46630: 'https://rpc.testnet.chain.robinhood.com/rpc' };

/** The approval signer alone (no RPC needed): { address, signRun({ gameId, runId, player, series, deadline }) } */
export function runSigner({ signerKey, chainId, gamesAddress }) {
  const account = privateKeyToAccount(signerKey);
  return {
    address: account.address,
    signRun: (m) => account.signTypedData({ domain: runDomain(chainId, gamesAddress), types: RUN_TYPES, primaryType: 'Run', message: { gameId: BigInt(m.gameId), runId: m.runId, player: getAddress(m.player), series: BigInt(m.series), deadline: BigInt(m.deadline) } }),
  };
}

/** The live chain: { signerAddress, state(gameId), signRun(m), runPaid(txHash) } */
export function viemChain({ rpcUrl, chainId, gamesAddress, signerKey }) {
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl || RPC[chainId]] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl || RPC[chainId]) });
  const address = getAddress(gamesAddress), signer = runSigner({ signerKey, chainId, gamesAddress });
  const read = (functionName, args = []) => client.readContract({ address, abi: FIRE_GAMES_ABI, functionName, args });
  return {
    signerAddress: signer.address,
    signRun: signer.signRun,
    /** FireGames' switches for a game: { paused, open, series, signer } */
    async state(gameId) {
      const [paused, open, series, signerOnChain] = await Promise.all([read('paused'), read('gameOpen', [BigInt(gameId)]), read('series'), read('signer')]);
      return { paused, open, series: Number(series), signer: signerOnChain };
    },
    /** the RunPaid events in a successful transaction from FireGames: [{ gameId, runId, player, series }] */
    async runPaid(txHash) {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') return [];
      return parseEventLogs({ abi: FIRE_GAMES_ABI, eventName: 'RunPaid', logs: receipt.logs })
        .filter((l) => l.address.toLowerCase() === address.toLowerCase())
        .map((l) => ({ gameId: Number(l.args.gameId), runId: l.args.runId, player: l.args.player, series: Number(l.args.series) }));
    },
  };
}
