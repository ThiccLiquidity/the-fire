// Signed tokens and per-run secrets, all derived from GAME_SEED_SECRET (one key, separate purposes).
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const key = (secret, purpose) => createHmac('sha256', secret).update(`omni-games:${purpose}`).digest();
const mac = (secret, purpose, data) => createHmac('sha256', key(secret, purpose)).update(data).digest();

/** a signed, tamper-proof token for a payload (not secret: it's readable) */
export function signToken(secret, payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(secret, 'token', body))}`;
}
export function verifyToken(secret, token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(secret, 'token', body), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
/** the run's capability: only the browser that created the run knows it (run ids are public on chain) */
export const capFor = (secret, runId) => mac(secret, 'cap', runId).toString('hex').slice(0, 40);
export function capOk(secret, runId, cap) {
  if (typeof cap !== 'string') return false;
  const want = Buffer.from(capFor(secret, runId)), got = Buffer.from(cap);
  return got.length === want.length && timingSafeEqual(got, want);
}
/** the salt in the seed's commitment (128 bits): a 31-bit seed alone could be found from its hash by trying them all */
export const saltFor = (secret, gameId, runId) => mac(secret, 'salt', `${gameId}:${runId}`).toString('hex').slice(0, 32);
/** the run's shot seed (31 bits), from which every shot's conditions follow; revealed when the run ends */
export const seedFor = (secret, gameId, runId) => mac(secret, 'seed', `${gameId}:${runId}`).readUInt32BE(0) & 0x7fffffff;
