// Alerts and the heartbeat.
//
// ALERT_WEBHOOK_URL: a Discord webhook, a Slack incoming webhook, or a Telegram bot URL
//   (https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>). The body carries the message as both `content`
//   (Discord) and `text` (Slack, Telegram), so one URL of any of them works.
// HEARTBEAT_URL: optional dead-man's switch (e.g. a healthchecks.io check). Pinged after every healthy pass, and
//   <url>/fail with the reasons otherwise; if the keeper dies, the service notices the silence and alerts.
//
// Long-running keeper: an alert is posted when it first appears, repeated every ALERT_REPEAT_MIN while it lasts, and
// a "resolved" line when it clears; a heartbeat message every HEARTBEAT_HOURS. One-pass runs (the GitHub Actions
// backup) have no memory, so they post only in the first INTERVAL of each ALERT_REPEAT_MIN period (about once an hour).

export function createNotifier({ cfg, log, fetchFn = globalThis.fetch, clock = Date.now }) {
  const open = new Map(); // key -> { text, first, lastSent }
  let lastHeartbeat = 0;
  const label = `[${cfg.label}${cfg.chainId === 4663 ? "" : ` chain ${cfg.chainId}`}]`;

  async function post(text) {
    if (!cfg.webhookUrl) return false;
    try {
      const r = await fetchFn(cfg.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 1900), text: text.slice(0, 3900) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) log(`alert webhook answered ${r.status}`);
      return r.ok;
    } catch (e) {
      log(`alert webhook failed: ${e?.name ?? "error"}`); // never the URL: it carries a token
      return false;
    }
  }

  async function ping(fail, body) {
    if (!cfg.heartbeatUrl) return;
    const url = cfg.heartbeatUrl.replace(/\/$/, "");
    try {
      await fetchFn(fail ? `${url}/fail` : url, { method: "POST", body: body.slice(0, 2000), signal: AbortSignal.timeout(10_000) });
    } catch { /* the service will notice the silence */ }
  }

  /** Called once per pass with this pass's alerts ({ key, text, quiet? }). */
  async function report(alerts, status) {
    const now = clock();
    const loud = alerts.filter((a) => !a.quiet);
    for (const a of alerts) log(`${a.quiet ? "note" : "ALERT"} ${a.text}`);
    const lines = [];
    if (cfg.once) {
      const periodMs = cfg.alertRepeatMin * 60_000;
      const windowMs = Math.max(cfg.intervalSec * 1000, 5 * 60_000);
      if (loud.length && now % periodMs < windowMs) lines.push(...loud.map((a) => `- ${a.text}`));
      // the backup stepping in is always worth a message
      const acted = loud.find((a) => a.key === "backup-acted");
      if (acted && !lines.length) lines.push(`- ${acted.text}`);
    } else {
      const seen = new Set();
      for (const a of loud) {
        seen.add(a.key);
        const o = open.get(a.key);
        if (!o) {
          open.set(a.key, { text: a.text, first: now, lastSent: now });
          lines.push(`- ${a.text}`);
        } else if (now - o.lastSent >= cfg.alertRepeatMin * 60_000) {
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
    }
    if (lines.length) await post(`${label} ${loud.length ? `${loud.length} problem(s)` : "all clear"}\n${lines.join("\n")}`);
    if (!cfg.once && now - lastHeartbeat >= cfg.heartbeatHours * 3_600_000) {
      lastHeartbeat = now;
      const s = status ?? {};
      await post(`${label} heartbeat: running; ${loud.length ? `${loud.length} open problem(s)` : "no problems"}; keeper ${s.address} has ${s.balance !== undefined ? (Number(s.balance) / 1e18).toFixed(5) : "?"} ETH; Series watched: ${(s.series ?? []).join(", ") || "none yet"}`);
    }
    await ping(loud.length > 0, loud.map((a) => a.text).join("; ") || "ok");
  }

  return { report, post, open };
}
