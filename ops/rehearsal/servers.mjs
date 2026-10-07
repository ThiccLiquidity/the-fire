// Local stand-ins for the outside services the rehearsal can't reach from a closed network: a drand relay, IPFS
// gateways and the alert webhook. Each is a tiny HTTP server on 127.0.0.1 with a random port.
import { createServer } from "node:http";
import { keccak256, toHex } from "viem";
import { DRAND_CHAIN, roundAt, roundTime } from "../keeper/src/drand.mjs";

/** A real drand evmnet signature (round 1000), the one contracts/test/RealRouter.t.sol proves on-chain. */
export const ROUND_1000 = { round: 1000n, signature: "06fd5996329504d3a56b482d9222bf7205857d0a9559ddd216ca31a286f6a8cc0a120f021aac2f13553fb164f62bc3a5ca32c76dea88a777b39bcf3cac5fdbd6" };

function listen(handler) {
  return new Promise((res) => {
    const srv = createServer(handler);
    srv.listen(0, "127.0.0.1", () => res({ srv, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }));
  });
}

/**
 * A drand relay. Round 1000 answers with its real signature; any other round already "published" by the chain's
 * clock (`now()`, unix seconds) answers with a made-up 64-byte signature (only DevDrandRouter accepts those: the real
 * router verifies BLS). `latest` follows `now()`. With `real: true` it serves round 1000 only.
 */
export async function drandServer(now, { real = false } = {}) {
  const served = [];
  const h = await listen((req, res) => {
    const m = new RegExp(`^/${DRAND_CHAIN}/public/(latest|\\d+)$`).exec(req.url ?? "");
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!m) return send(404, { error: "not found" });
    const latest = roundAt(now());
    if (m[1] === "latest") return send(200, { round: Number(latest) });
    const round = BigInt(m[1]);
    if (round === ROUND_1000.round) { served.push(round); return send(200, { round: 1000, signature: ROUND_1000.signature }); }
    if (real || roundTime(round) > now()) return send(404, { error: "round not yet published" });
    const sig = keccak256(toHex(`round ${round} a`)).slice(2) + keccak256(toHex(`round ${round} b`)).slice(2);
    served.push(round);
    return send(200, { round: Number(round), signature: sig });
  });
  return { ...h, served };
}

/** An IPFS gateway that has `has(name)` of every folder; HEAD and GET both work; manifest.json from `manifest()`. */
export async function gatewayServer({ has = () => true, manifest } = {}) {
  const hits = { count: 0 };
  const h = await listen((req, res) => {
    const m = /^\/ipfs\/([^/]+)\/(.+)$/.exec(req.url ?? "");
    hits.count++;
    if (!m) { res.writeHead(404); return res.end(); }
    const name = decodeURIComponent(m[2]);
    if (name === "manifest.json" && manifest) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(req.method === "HEAD" ? undefined : JSON.stringify(manifest()));
    }
    if (!has(name)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "image/webp", "content-length": "4" });
    res.end(req.method === "HEAD" ? undefined : "RIFF");
  });
  return { ...h, url: `${h.url}/ipfs/`, hits };
}

/** Catches what the keeper posts to ALERT_WEBHOOK_URL. */
export async function webhookServer() {
  const posts = [];
  const h = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { posts.push(JSON.parse(body).content); } catch { posts.push(body); }
      res.writeHead(204);
      res.end();
    });
  });
  return { ...h, posts };
}
