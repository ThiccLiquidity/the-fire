// Name + picture for your wallet. Stored on-chain in Profiles.sol; one tx, set only by you.
import { useState } from "react";
import type { Profile } from "../data/types";
import { Avatar } from "./Avatar";

export function ProfileEditor({ addr, profile, onSave }: { addr?: string; profile?: Profile; onSave: (name: string, pfp: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile?.name ?? "");
  const [mode, setMode] = useState<"url" | "mill">(profile?.pfp.startsWith("mill:") ? "mill" : "url");
  const [url, setUrl] = useState(profile?.pfp && !profile.pfp.startsWith("mill:") ? profile.pfp : "");
  const [mill, setMill] = useState(profile?.pfp.startsWith("mill:") ? profile.pfp.slice(5) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const who = addr ?? "0x0000000000000000000000000000000000000000";
  const pfp = mode === "mill" ? (mill ? `mill:${mill.trim()}` : "") : url.trim();
  const preview: Profile = { name, pfp };

  async function save() {
    setBusy(true); setMsg("");
    try { await onSave(name.trim(), pfp); setOpen(false); }
    catch (e) { setMsg((e as Error).message.split("\n")[0].slice(0, 140)); }
    finally { setBusy(false); }
  }

  return (
    <div className="profile">
      <button className="profile-btn" onClick={() => setOpen(!open)} title={addr}>
        <Avatar addr={who} profile={profile} size={30} />
        <span>{profile?.name || "Set your name & picture"}</span>
        <small>{open ? "close" : "edit"}</small>
      </button>
      {open && (
        <div className="profile-body">
          <div className="profile-preview"><Avatar addr={who} profile={preview} size={56} /><b>{name || "anon"}</b></div>
          <input maxLength={24} placeholder="Name (24 characters, shown instead of your address)" value={name} onChange={(e) => setName(e.target.value.replace(/[^\x20-\x7e]/g, ""))} />
          <div className="profile-mode">
            <button className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}>Image link</button>
            <button className={mode === "mill" ? "on" : ""} onClick={() => setMode("mill")}>My mill</button>
          </div>
          {mode === "url"
            ? <input maxLength={256} placeholder="https://… or ipfs://… image" value={url} onChange={(e) => setUrl(e.target.value)} />
            : <input type="number" min={1} placeholder="Mill # you hold" value={mill} onChange={(e) => setMill(e.target.value)} />}
          <p className="fine muted">Saved on-chain, one transaction, only you can change it. Names aren't unique — your address is what wins, and shows on hover.{mode === "mill" ? " The fire checks you hold the mill when you save." : ""}</p>
          <button className="cta ghost" disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Save profile"}</button>
          {msg && <p className="fine">{msg}</p>}
        </div>
      )}
    </div>
  );
}
