// X posts via TwitterAPI.io (unofficial; ~$0.15 per 1,000 posts). No key: mock posts, clearly marked.
//   GET https://api.twitterapi.io/twitter/user/last_tweets?userName=<handle>      header X-API-Key
//   GET https://api.twitterapi.io/twitter/tweet/advanced_search?query=<q>&queryType=Latest
import { fetchJson } from "./util.mjs";

const BASE = "https://api.twitterapi.io/twitter";
export const COST_PER_1K = 0.15;

const slim = (t, handle) => ({
  id: String(t.id ?? ""),
  handle: t.author?.userName ?? handle ?? "",
  name: t.author?.name ?? "",
  text: String(t.text ?? "").slice(0, 600),
  at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
  likes: t.likeCount ?? 0,
  reposts: t.retweetCount ?? 0,
  replies: t.replyCount ?? 0,
  views: t.viewCount ?? 0,
  url: t.url ?? (t.id ? `https://x.com/${handle ?? "i"}/status/${t.id}` : ""),
  quoted: t.quoted_tweet?.text ? String(t.quoted_tweet.text).slice(0, 280) : undefined,
});

const tweetsOf = (j) => j?.tweets ?? j?.data?.tweets ?? [];

export async function userPosts(key, handle, { limit = 20, sinceMs = 30 * 3_600_000 } = {}) {
  const j = await fetchJson(`${BASE}/user/last_tweets?userName=${encodeURIComponent(handle)}`, { headers: { "X-API-Key": key } });
  const cutoff = Date.now() - sinceMs;
  const all = tweetsOf(j).map((t) => slim(t, handle));
  return { posts: all.filter((p) => !p.at || Date.parse(p.at) >= cutoff).slice(0, limit), billed: all.length };
}

export async function search(key, query, { limit = 20 } = {}) {
  const j = await fetchJson(`${BASE}/tweet/advanced_search?query=${encodeURIComponent(query)}&queryType=Latest`, { headers: { "X-API-Key": key } });
  const all = tweetsOf(j).map((t) => slim(t));
  return { posts: all.slice(0, limit), billed: all.length };
}

/** Everything from the source list, best first. Returns { mock, posts, searches, billed, estCostUsd }. */
export async function gatherX(cfg, key, notes) {
  if (!key) return mockX(cfg);
  let billed = 0;
  const posts = [];
  for (const a of cfg.accounts) {
    try {
      const r = await userPosts(key, a.handle, { limit: cfg.perAccount });
      billed += r.billed;
      posts.push(...r.posts.map((p) => ({ ...p, note: a.note })));
    } catch (e) {
      notes.push(`x @${a.handle}: ${e.message}`);
    }
  }
  const searches = {};
  for (const q of cfg.searches ?? []) {
    try {
      const r = await search(key, q, { limit: cfg.perSearch });
      billed += r.billed;
      searches[q] = r.posts;
    } catch (e) {
      notes.push(`x search "${q}": ${e.message}`);
    }
  }
  posts.sort((a, b) => b.likes + 3 * b.reposts + b.replies - (a.likes + 3 * a.reposts + a.replies));
  return { mock: false, posts, searches, billed, estCostUsd: +(billed * COST_PER_1K / 1000).toFixed(4) };
}

/** Plausible stand-ins built from the account notes, so the writers can rehearse. Every post says mock. */
export function mockX(cfg) {
  const lines = {
    OrangeGooey: ["Spaces at 9pm ET. PLANK roadmap, vibes, and whoever keeps unmuting with a leaf blower running.", "We didn't launch PLANK to get rich. We launched it to get rich together. Slight difference."],
    Degen_Waffle: ["New song about the PLANK chart. It's in a minor key. Can't imagine why.", "Guitar is tuned, wallet is not."],
    toospooky: ["The Paper Press tech is fine. The humans are the bug.", "I was early to Tang Gang and late to PLANK. Balance."],
    Bullish0xCrypto: ["Retirement update: still retired, still shipping.", "Fixed the bug at 3am from the boat. You're welcome."],
    bflo14: ["[image] meme: two buttons, 'sell PLANK' and 'tell everyone you're holding PLANK'", "Ratio'd my own dad today. Content is content."],
    ThiccLiquidity: ["Cards are in the oven. Don't open the oven.", "Burn number go up. That's the tweet."],
  };
  const now = Date.now();
  const posts = cfg.accounts.flatMap((a, i) =>
    (lines[a.handle] ?? [`gm. ${a.handle} has thoughts about PLANK and will share them in Spaces.`]).map((text, k) => ({
      id: `mock-${a.handle}-${k}`,
      handle: a.handle,
      name: a.handle,
      text,
      at: new Date(now - (i * 47 + k * 13) * 60_000).toISOString(),
      likes: 40 - i * 2 + k,
      reposts: 6 - (i % 4),
      replies: 9 + k,
      views: 1200 + i * 31,
      url: "",
      note: a.note,
      mock: true,
    })),
  );
  return { mock: true, posts, searches: {}, billed: 0, estCostUsd: 0 };
}
