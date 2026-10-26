// In-memory storage (tests and local runs). Same interface as store-neon.js:
//   createRun(run) · getRun(runId) · updateRun(runId, patch, expect?) → bool
//   issueShot({ runId, n, t0, nonce, shot, level, practice }) · getShot(runId, n) · pingShot(runId, n, nonce, at) → bool
//   recordKick(kick) → bool (false: that shot was already judged) · getKicks(runId) · logReject(r)
//   bumpBoard({ series, gameId, wallet, streak, reachedAt, runId }) · board({ series, gameId, limit })
//   rateHit(key, windowMs, max, now) → bool (allowed) · getFlag(name) · setFlag(name, value, at)
const clone = (v) => (v == null ? v : structuredClone(v));

export function memoryStore() {
  const runs = new Map(), shots = new Map(), kicks = new Map(), board = new Map(), rate = new Map(), flags = new Map(), rejects = [];
  const sk = (runId, n) => `${runId}#${n}`;
  return {
    kind: 'memory',
    rejects,
    async createRun(run) { if (runs.has(run.runId)) throw new Error('run exists'); runs.set(run.runId, clone(run)); },
    async getRun(runId) { return clone(runs.get(runId)) || null; },
    async findRunByTx(txHash) { for (const r of runs.values()) if (r.txHash === txHash) return clone(r); return null; },
    async updateRun(runId, patch, expect = {}) {
      const r = runs.get(runId); if (!r) return false;
      for (const [k, v] of Object.entries(expect)) if (r[k] !== v) return false;
      Object.assign(r, clone(patch)); return true;
    },
    async issueShot(s) { const old = shots.get(sk(s.runId, s.n)); shots.set(sk(s.runId, s.n), { ...clone(s), pingAt: null, issued: (old?.issued || 0) + 1 }); },
    async getShot(runId, n) { return clone(shots.get(sk(runId, n))) || null; },
    async pingShot(runId, n, nonce, at) { const s = shots.get(sk(runId, n)); if (!s || s.nonce !== nonce || s.pingAt != null) return false; s.pingAt = at; return true; },
    async recordKick(k) { const key = sk(k.runId, k.n); if (kicks.has(key)) return false; kicks.set(key, clone(k)); return true; },
    async getKicks(runId) { return [...kicks.values()].filter((k) => k.runId === runId).sort((a, b) => a.at - b.at).map(clone); },
    async logReject(r) { rejects.push(clone(r)); },
    async bumpBoard(b) {
      const key = `${b.series}#${b.gameId}#${b.wallet}`, cur = board.get(key);
      if (cur && cur.streak >= b.streak) return false;
      board.set(key, clone(b)); return true;
    },
    async board({ series, gameId, limit = 100 }) {
      return [...board.values()].filter((b) => b.series === series && b.gameId === gameId)
        .sort((a, b) => b.streak - a.streak || a.reachedAt - b.reachedAt).slice(0, limit)
        .map(({ wallet, streak, reachedAt }) => ({ wallet, streak, reachedAt }));
    },
    async rateHit(key, windowMs, max, now) {
      const r = rate.get(key);
      if (!r || r.start <= now - windowMs) { rate.set(key, { start: now, count: 1 }); return max >= 1; }
      r.count++; return r.count <= max;
    },
    async getFlag(name) { return flags.get(name) ?? null; },
    async setFlag(name, value) { flags.set(name, value); },
  };
}
