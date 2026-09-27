// Name + picture for your wallet. Pick a photo from your phone or computer; it's shrunk to 128px in the
// browser and written on-chain with the name (Profiles.sol) — one transaction, only you can change it.
import { useState } from "react";
import type { Profile } from "../data/types";
import { Avatar } from "./Avatar";

const SIZE = 128, MAX_BYTES = 12_000;

/** Downscale to SIZE×SIZE, center-cropped, and encode as small as reasonable. Returns bytes + a preview URL. */
async function shrink(file: File): Promise<{ bytes: Uint8Array; url: string }> {
  const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Couldn't read that image.")); i.src = URL.createObjectURL(file); });
  const c = document.createElement("canvas"); c.width = SIZE; c.height = SIZE;
  const x = c.getContext("2d")!; x.imageSmoothingQuality = "high";
  const s = Math.min(img.width, img.height); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
  for (const [type, q] of [["image/webp", 0.82], ["image/webp", 0.6], ["image/jpeg", 0.7], ["image/jpeg", 0.5]] as [string, number][]) {
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));
    if (blob && blob.type === type && blob.size <= MAX_BYTES) return { bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
  }
  throw new Error("That picture won't compress small enough. Try a simpler one.");
}

export function ProfileEditor({ addr, profile, onSave }: { addr?: string; profile?: Profile; onSave: (name: string, image: Uint8Array | null) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile?.name ?? "");
  const [pic, setPic] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const who = addr ?? "0x0000000000000000000000000000000000000000";
  const preview: Profile = { name, pfp: pic?.url ?? profile?.pfp ?? "" };

  async function pick(f?: File) {
    if (!f) return; setMsg("");
    try { setPic(await shrink(f)); } catch (e) { setMsg((e as Error).message); }
  }
  async function save() {
    setBusy(true); setMsg("");
    try { await onSave(name.trim(), pic ? pic.bytes : null); setOpen(false); setPic(null); }
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
          <div className="profile-row">
            <label className="pick">
              <Avatar addr={who} profile={preview} size={72} />
              <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
              <span>{pic ? "Change" : "Choose photo"}</span>
            </label>
            <input className="profile-name" maxLength={24} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value.replace(/[^\x20-\x7e]/g, ""))} />
          </div>
          <p className="fine muted">Shrunk to 128px and written on-chain with your name — one transaction, about a cent, only you can change it. Names aren't unique; your address is what wins, and shows on hover.</p>
          <button className="cta ghost" disabled={busy || (!name.trim() && !pic)} onClick={save}>{busy ? "Saving…" : "Save profile"}</button>
          {msg && <p className="fine">{msg}</p>}
        </div>
      )}
    </div>
  );
}
