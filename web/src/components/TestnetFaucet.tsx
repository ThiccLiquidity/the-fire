// Testnet rehearsal only: free play PAPER, PLANK and USDG from the play tokens' faucets. Never shown on mainnet.
import { useState } from "react";
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { robinhood, connectWallet, waitOk, friendly } from "../data/wallet";
import type { FireState } from "../data/types";

const faucetAbi = parseAbi(["function faucet()"]);

export function TestnetFaucet({ s }: { s: FireState }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function get() {
    if (!s.tokens) return;
    setBusy(true); setMsg("");
    try {
      const { wc, account } = await connectWallet();
      const pub = createPublicClient({ chain: robinhood, transport: http() }) as PublicClient;
      for (const [sym, a] of [["PLANK", s.tokens.plank], ["PAPER", s.tokens.paper], ["USDG", s.tokens.usdg]] as const) {
        if (!a) continue;
        setMsg(`Getting play ${sym}…`);
        const h = await wc.writeContract({ address: a as Address, abi: faucetAbi, functionName: "faucet", account, chain: robinhood });
        await waitOk(pub, h, `the ${sym} faucet`);
      }
      setMsg("Done: play PLANK, PAPER and USDG are in your wallet.");
    } catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }
  return (
    <div className="demo-banner" role="note">
      <b>Testnet rehearsal</b> — play tokens on Robinhood Chain testnet, no real money.{" "}
      <button className="linkish" disabled={busy || !s.tokens} onClick={get}>{busy ? "Working…" : "Get play tokens"}</button>
      {msg && <> {msg}</>}
      <> Need test ETH for gas? <a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">Robinhood testnet faucet</a>.</>
    </div>
  );
}
