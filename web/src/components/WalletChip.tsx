// Header wallet chip: who you are, or a Connect button. Click for switch / disconnect.
import { useEffect, useRef, useState } from "react";
import type { Profile } from "../data/types";
import { short } from "../data/types";
import { Avatar } from "./Avatar";

export function WalletChip({ address, profile, onConnect, onSwitch, onDisconnect, demo }: {
  address?: string; profile?: Profile; onConnect?: () => Promise<void>; onSwitch?: () => Promise<void>; onDisconnect?: () => void; demo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const run = async (f?: () => Promise<void> | void) => { if (!f) return; setBusy(true); setErr(""); try { await f(); setOpen(false); } catch (e) { setErr((e as Error).message.split("\n")[0].slice(0, 80)); } finally { setBusy(false); } };

  if (!address) return (
    <div className="wchip-wrap">
      <button className="wchip connect" disabled={busy || !onConnect} onClick={() => run(onConnect)}>{busy ? "Connecting…" : <span>Connect<span className="wchip-long">{demo ? " demo wallet" : " wallet"}</span></span>}</button>
      {err && <span className="wchip-err">{err}</span>}
    </div>
  );
  return (
    <div className="wchip-wrap" ref={ref}>
      <button className="wchip" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={address}>
        <Avatar addr={address} profile={profile} size={22} />
        <span>{profile?.name || short(address)}</span>
        <small>▾</small>
      </button>
      {open && (
        <div className="wchip-menu" role="menu">
          <div className="wchip-addr">{demo ? "Demo wallet (play money) · " : ""}{address}</div>
          <button role="menuitem" disabled={busy || !onSwitch} onClick={() => run(onSwitch)}>{demo ? "Switch to the other demo wallet" : "Switch wallet"}</button>
          <button role="menuitem" disabled={busy || !onDisconnect} onClick={() => run(onDisconnect)}>Disconnect</button>
          {err && <span className="wchip-err">{err}</span>}
        </div>
      )}
    </div>
  );
}
