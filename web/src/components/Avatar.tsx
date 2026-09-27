// A wallet's picture: their PFP URL, their mill's image ("mill:<id>"), or a generated mark from the address.
import { useEffect, useState } from "react";
import type { Profile } from "../data/types";
import { millImage } from "../data/chain";

const LIVE = !!import.meta.env.VITE_FIRE_ADDRESS;

export function Avatar({ addr, profile, size = 28 }: { addr: string; profile?: Profile; size?: number }) {
  const [src, setSrc] = useState<string>("");
  const pfp = profile?.pfp ?? "";
  useEffect(() => {
    let dead = false;
    setSrc("");
    if (!pfp) return;
    if (pfp.startsWith("mill:")) { if (LIVE) millImage(pfp.slice(5)).then((u) => { if (!dead) setSrc(u); }); }
    else if (/^https?:\/\//.test(pfp) || pfp.startsWith("ipfs://")) setSrc(pfp.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + pfp.slice(7) : pfp);
    return () => { dead = true; };
  }, [pfp]);

  const h = hash(addr.toLowerCase());
  const hue = h % 360, hue2 = (hue + 40 + (h >> 8) % 80) % 360;
  const isMill = pfp.startsWith("mill:");
  const style = { width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${hue2} 80% 30%))` };
  return (
    <span className="avatar" style={style} title={addr}>
      {src ? <img src={src} alt="" onError={() => setSrc("")} /> : isMill ? <span className="av-mill">🏭</span> : <span className="av-mark">{addr.slice(2, 4).toUpperCase()}</span>}
    </span>
  );
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
