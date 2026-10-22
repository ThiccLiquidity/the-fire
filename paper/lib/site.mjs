// Our own chain news: letters sent in for this issue (MorningWood.Letter), copies sold, packs sold, PAPER burned by
// PaperBurner, with senders' profile names (FireProfiles). Last 24h unless told otherwise.
import { SEL, TOPIC, addrWord, asAddr, blockAt, decodeString, logsChunked, rpc, toNum, u256Word, word } from "./chain.mjs";
import { soft } from "./util.mjs";

async function profileName(r, profiles, who) {
  if (!profiles) return null;
  const h = await r.eth_call(profiles, SEL.profileOf + addrWord(who));
  const name = decodeString(h, Number(word(h, 0)));
  return name || null;
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** `prevIssue`: the issue whose holders write in for this one (yesterday's number). */
export async function gatherSite(dep, { prevIssue }, notes) {
  const C = dep.contracts ?? {};
  const r = rpc();
  const latest = await r.blockNumber();
  const from = await blockAt(r, Math.floor(Date.now() / 1000) - 86_400);
  const range = { fromBlock: from, toBlock: latest };
  const name = async (a) => (await soft("profile", () => profileName(r, C.FireProfiles, a), null, notes)) ?? short(a);

  const letters = [];
  if (C.MorningWood && prevIssue > 0) {
    // letters for the previous issue may be sent any time while held: read from 48h back
    const from48 = await blockAt(r, Math.floor(Date.now() / 1000) - 2 * 86_400);
    const logs = await soft("letters", () => logsChunked(r, { address: C.MorningWood, topics: [TOPIC.Letter, "0x" + u256Word(prevIssue)], fromBlock: from48, toBlock: latest }), [], notes);
    for (const l of logs) {
      const from = asAddr(BigInt(l.topics[2]));
      const text = decodeString(l.data);
      letters.push({ from, name: await name(from), text, kind: /^\s*AD:/i.test(text) ? "classified" : "letter", tx: l.transactionHash });
    }
  }
  const sum = (logs, i, d = 18) => logs.reduce((s, l) => s + toNum(word(l.data, i), d), 0);
  const press = C.MorningWood ? await soft("press sales", () => logsChunked(r, { address: C.MorningWood, topics: [TOPIC.Bought], ...range }), [], notes) : [];
  const packs = C.FireSale ? await soft("pack sales", () => logsChunked(r, { address: C.FireSale, topics: [TOPIC.PacksBought], ...range }), [], notes) : [];
  const burns = C.PaperBurner ? await soft("burns", () => logsChunked(r, { address: C.PaperBurner, topics: [TOPIC.Burned], ...range }), [], notes) : [];
  return {
    letters,
    copiesSold24h: sum(press, 0, 0), // Bought data: qty, pay, cost, paper
    packsSold24h: sum(packs, 0, 0), // PacksBought data: count, pay, paid, burnShare, plankBurned
    paperBurnedByBurner24h: +sum(burns, 1).toFixed(4), // Burned data: spent, paperOut
  };
}

export function mockSite() {
  return {
    letters: [
      { from: "0xmock1", name: "plankmaxi", text: "Dear Editor, I bought the top. Please print my name so my wife knows it was a team effort.", kind: "letter", mock: true },
      { from: "0xmock2", name: "gooeyfan", text: "AD: Selling one (1) bag of PLANK. Emotional damage included at no extra cost.", kind: "classified", mock: true },
    ],
    copiesSold24h: 0,
    packsSold24h: 0,
    paperBurnedByBurner24h: 0,
    mock: true,
  };
}
