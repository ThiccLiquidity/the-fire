// Alerts and the heartbeat.
//
// ALERT_WEBHOOK_URL: a Discord webhook, a Slack incoming webhook, or a Telegram bot URL
//   (https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>). The body carries the message as both `content`
//   (Discord) and `text` (Slack, Telegram), so one URL of any of them works.
// HEARTBEAT_URL: a dead-man's switch (e.g. a healthchecks.io check; required in production). Pinged after every
//   healthy pass, and <url>/fail with the reasons otherwise; if the keeper dies, the service notices the silence and
//   alerts. Each keeper service (main, backup) has its own check.
//
// An alert ({ key, text }) is posted when it first appears, repeated every ALERT_REPEAT_MIN while it lasts (unless
// `repeat: false`, e.g. a pause the owner chose), and a "resolved" line when it clears. `quiet` ones are only logged.
// An event ({ key, text }) is something that happened (a randomness switch, the backup stepping in): posted at once,
// at most once per ALERT_REPEAT_MIN for the same key. A heartbeat message every HEARTBEAT_HOURS.
//
// One-pass runs (ONCE=1, the optional GitHub Actions extra) keep that memory in STATE_FILE when it's set (the workflow
// caches it between runs). Without it they post only in the first ONCE_ALERT_WINDOW_MIN (15) of each ALERT_REPEAT_MIN
// period, which a scheduled run hits at least about once an hour even when GitHub delays it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Posts `text` to a Discord / Slack / Telegram webhook. Never logs the URL (it carries a token). */
export async function postWebhook(url, text, { fetchFn = globalThis.fetch, log = console.log } = {}) {
  if (!url) return false;
  try {
    const r = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900), text: text.slice(0, 3900) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) log(`alert webhook answered ${r.status}`);
    return r.ok;
  } catch (e) {
    log(`alert webhook failed: ${e?.name ?? "error"}`);
    return false;
  }
}

/** Pings the dead-man's switch: <url> when healthy, <url>/fail with the reasons otherwise. */
export async function pingHeartbeat(url, fail, body, { fetchFn = globalThis.fetch } = {}) {
  if (!url) return;
  const u = url.replace(/\/$/, "");
  try {
    await fetchFn(fail ? `${u}/fail` : u, { method: "POST", body: String(body).slice(0, 2000), signal: AbortSignal.timeout(10_000) });
  } catch { /* the service will notice the silence */ }
}

/** "[keeper]" on mainnet, "[backup chain 46630]" elsewhere. */
export const labelOf = (cfg) => `[${cfg.label}${cfg.chainId === 4663 ? "" : ` chain ${cfg.chainId}`}]`;

export function createNotifier({ cfg, log, fetchFn = globalThis.fetch, clock = Date.now }) {
  const open = new Map(); // key -> { text, first, lastSent }
  const eventSent = new Map(); // key -> last posted (ms)
  let lastHeartbeat = 0;
  const label = labelOf(cfg);
  const stateful = !cfg.once || !!cfg.stateFile;

  if (cfg.once && cfg.stateFile && existsSync(cfg.stateFile)) {
    try {
      const j = JSON.parse(readFileSync(cfg.stateFile, "utf8"));
      for (const [k, v] of Object.entries(j.open ?? {})) open.set(k, v);
      for (const [k, v] of Object.entries(j.events ?? {})) eventSent.set(k, v);
      lastHeartbeat = j.lastHeartbeat ?? 0;
    } catch { log("STATE_FILE unreadable: starting with no alert memory"); }
  }
  function save() {
    if (!cfg.once || !cfg.stateFile) return;
    try {
      writeFileSync(cfg.stateFile, JSON.stringify({ open: Object.fromEntries(open), events: Object.fromEntries(eventSent), lastHeartbeat }));
    } catch (e) { log(`STATE_FILE not written: ${e?.code ?? e}`); }
  }

  const post = (text) => (cfg.webhookUrl ? postWebhook(cfg.webhookUrl, text, { fetchFn, log }) : Promise.resolve(false));

  /** Called once per pass with this pass's alerts ({ key, text, quiet?, repeat? }) and events ({ key, text }). */
  async function report(alerts, status, events = []) {
    const now = clock();
    const repeatMs = cfg.alertRepeatMin * 60_000;
    const loud = alerts.filter((a) => !a.quiet);
    for (const a of alerts) log(`${a.quiet ? "note" : "ALERT"} ${a.text}`);
    for (const ev of events) log(`EVENT ${ev.text}`);
    const lines = [];
    for (const ev of events) {
      const last = eventSent.get(ev.key);
      if (stateful && last !== undefined && now - last < repeatMs) continue;
      eventSent.set(ev.key, now);
      lines.push(`- ${ev.text}`);
    }
    if (stateful) {
      const seen = new Set();
      for (const a of loud) {
        seen.add(a.key);
        const o = open.get(a.key);
        if (!o) {
          open.set(a.key, { text: a.text, first: now, lastSent: now });
          lines.push(`- ${a.text}`);
        } else if (a.repeat !== false && now - o.lastSent >= repeatMs) {
          o.lastSent = now;
          lines.push(`- still: ${a.text} (since ${Math.round((now - o.first) / 60_000)} min)`);
        }
      }
      for (const [k, o] of open) {
        if (!seen.has(k)) {
          open.delete(k);
          lines.push(`- resolved: ${o.text}`);
        }
      }
    } else {
      const windowMs = Math.max(2 * cfg.intervalSec * 1000, (cfg.onceAlertWindowMin ?? 15) * 60_000);
      if (loud.length && now % repeatMs < windowMs) lines.push(...loud.map((a) => `- ${a.text}`));
    }
    if (lines.length) await post(`${label} ${loud.length ? `${loud.length} problem(s)` : "all clear"}\n${lines.join("\n")}`);
    if (stateful && now - lastHeartbeat >= cfg.heartbeatHours * 3_600_000) {
      lastHeartbeat = now;
      const s = status ?? {};
      await post(`${label} heartbeat: running (${cfg.role ?? "main"}); ${loud.length ? `${loud.length} open problem(s)` : "no problems"}; keeper ${s.address} has ${s.balance !== undefined ? (Number(s.balance) / 1e18).toFixed(5) : "?"} ETH; Series watched: ${(s.series ?? []).join(", ") || "none yet"}`);
    }
    save();
    // the dead-man's switch fails on problems, not on notices the owner chose (a pause)
    const failing = loud.filter((a) => a.repeat !== false);
    await pingHeartbeat(cfg.heartbeatUrl, failing.length > 0, failing.map((a) => a.text).join("; ") || "ok", { fetchFn });
  }

  return { report, post, open };
}
