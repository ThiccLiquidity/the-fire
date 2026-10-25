// The keeper unpacks replies from RPC and drand servers, and Node decompresses Brotli replies for it: Node builds
// before the HTTP2Shell fix (CVE-2026-111497, a Brotli decoder out-of-bounds write) could be attacked by a bad or
// hijacked server. Fixed in 22.23.4, 24.22.1 and 26.12.1; the release lines in between never got the fix.
const FIXED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };

/** Whether this Node has the Brotli fix (version "22.23.4", without the v). */
export function nodePatched(version = process.versions.node) {
  const v = version.split(".").map(Number), f = FIXED[v[0]];
  if (!f) return v[0] > 26;
  for (let i = 0; i < 3; i++) if (v[i] !== f[i]) return v[i] > f[i];
  return true;
}
export const NODE_FIX = "22.23.4, 24.22.1 or 26.12.1";
