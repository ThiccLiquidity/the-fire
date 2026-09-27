// A wallet's picture: their on-chain PFP, or a generated mark from the address.
import { useState } from "react";
import type { Profile } from "../data/types";

export function Avatar({ addr, profile, size = 28 }: { addr: string; profile?: Profile; size?: number }) {
  const [broken, setBroken] = useState("");
  const src = profile?.pfp && profile.pfp !== broken ? profile.pfp : "";
  const h = hash(addr.toLowerCase());
  const hue = h % 360, hue2 = (hue + 40 + (h >> 8) % 80) % 360;
  const style = { width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${hue2} 80% 30%))` };
  return (
    <span className="avatar" style={style} title={addr}>
      {src ? <img src={src} alt="" onError={() => setBroken(src)} /> : <span className="av-mark">{addr.slice(2, 4).toUpperCase()}</span>}
    </span>
  );
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
