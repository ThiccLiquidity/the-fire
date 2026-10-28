// Our own chain news: letters sent in for this issue (MorningWood.Letter), copies sold, packs sold, and the PAPER the
// liquidity contract (LiquidityBurner, which replaced PaperBurner) locked in burned PAPER/PLANK liquidity or burned
// outright over its cap, with senders' profile names (FireProfiles). Last 24h unless told otherwise.
import { SEL, TOPIC, addrWord, asAddr, blockAt, decodeLog, decodeString, logsChunked, rpc, toNum, u256Word, word } from "./chain.mjs";
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
  // each total reads its logs and decodes every one (decodeLog throws on a log that isn't the event it should be);
  // a read or decode failure goes in the notes and the total is null (unknown), never a silent 0
  const total = (label, address, event, field, decimals, topics = []) => (address
    ? soft(label, async () => {
      const logs = await logsChunked(r, { address, topics: [TOPIC[event], ...topics], ...range });
      return logs.reduce((s, l) => s + toNum(decodeLog(event, l)[field], decimals), 0);
    }, null, notes)
    : null);
  const L = C.LiquidityBurner;
  const [copies, packs, paperLiquidity, paperOverCap] = await Promise.all([
    total("press sales", C.MorningWood, "Bought", "qty", 0),
    total("pack sales", C.FireSale, "PacksBought", "count", 0),
    total("liquidity burned", L, "LiquidityBurned", "paper", 18),
    total("PAPER over the cap", L, "OverCap", "amount", 18, ["0x" + u256Word(0)]), // side 0: PAPER
  ]);
  const both = paperLiquidity === null || paperOverCap === null ? null : +(paperLiquidity + paperOverCap).toFixed(4);
  return {
    letters,
    copiesSold24h: copies,
    packsSold24h: packs,
    // PAPER LiquidityBurner took out of circulation: locked in burned liquidity, plus any burned over its $100 cap
    paperBurnedByBurner24h: L ? both : null,
    paperToLiquidity24h: paperLiquidity === null ? null : +paperLiquidity.toFixed(4),
    paperOverCap24h: paperOverCap === null ? null : +paperOverCap.toFixed(4),
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
