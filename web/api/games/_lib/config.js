// The game server's settings: everything secret or switchable comes from the environment (the Vercel dashboard), never
// from the code. docs/game-server.md lists them.

/** US states where paid play isn't offered (games of skill for prizes; plan §12). GAMES_BLOCKED_REGIONS overrides. */
export const BLOCKED_US_STATES = ['AZ', 'AR', 'CT', 'DE', 'LA', 'MT', 'SC', 'SD', 'TN', 'IN', 'ME'];

export const LIMITS = Object.freeze({
  payWindowS: 600,          // an approval's deadline: payRun must land within 10 minutes
  claimMs: 24 * 3600e3,     // a paid run must be confirmed within 24 h
  shotClockMs: 15000,       // the shot clock shown to the player
  graceMs: 3000,            // plus grace, then it's DELAY OF GAME
  practice: 3,              // practice kicks, before the first scored kick only
  releaseTolMs: 150,        // the claimed release must be within this of the server's estimate (moving posts)
  arrivalSlackMs: 250,      // and the kick must arrive within RTT + this after the claimed release
  displayLatencyMs: 50,     // a screen's typical delay, taken off the estimate
  defaultRttMs: 250,        // when the client never pinged
  maxRttMs: 1000,
  createPerIp: [20, 600e3], // 20 creates per IP per 10 minutes
  kicksPerRun: [2, 1000],   // 2 kick posts per run per second
  bodyBytes: 32768,
});

const on = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

export function readConfig(env = process.env) {
  return {
    paidOpen: on(env.GAMES_PAID_OPEN),
    judging: on(env.GAMES_JUDGING),
    seedSecret: env.GAME_SEED_SECRET || '',
    signerKey: env.GAME_SIGNER_KEY || '',
    databaseUrl: env.DATABASE_URL || '',
    chainId: Number(env.GAME_CHAIN_ID || 4663),
    rpcUrl: env.GAME_RPC_URL || '',
    gamesAddress: env.FIRE_GAMES_ADDRESS || '',
    blocked: env.GAMES_BLOCKED_REGIONS ? env.GAMES_BLOCKED_REGIONS.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : BLOCKED_US_STATES,
    allowNoGeo: on(env.GAMES_ALLOW_NO_GEO), // local testing only: production always has Vercel's geo headers
  };
}
