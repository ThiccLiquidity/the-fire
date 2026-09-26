import { useEffect, useRef, useState } from "react";

/**
 * The fire. Size is a 0–2 ratio of today's tickets vs the forecast midpoint.
 * Every buy throws a scrap of paper (or a log) into the flames.
 */
export function Fire({ size, lastBuyId, lastBuyWasLog, dead }: { size: number; lastBuyId: number; lastBuyWasLog: boolean; dead: boolean }) {
  const [scraps, setScraps] = useState<{ id: number; x: number; log: boolean }[]>([]);
  const seen = useRef(0);
  useEffect(() => {
    if (lastBuyId && lastBuyId !== seen.current) {
      seen.current = lastBuyId;
      const x = 20 + Math.random() * 60;
      setScraps((s) => [...s.slice(-8), { id: lastBuyId, x, log: lastBuyWasLog }]);
      const t = setTimeout(() => setScraps((s) => s.filter((k) => k.id !== lastBuyId)), 1400);
      return () => clearTimeout(t);
    }
  }, [lastBuyId, lastBuyWasLog]);

  const h = dead ? 0.15 : Math.max(0.35, Math.min(2.2, size));
  const flameH = 120 * h;
  const glow = dead ? 0 : Math.min(1, h / 1.6);

  return (
    <div className="fire" style={{ ["--glow" as string]: glow, ["--flame" as string]: h }}>
      {scraps.map((s) => (
        <span key={s.id} className={"scrap" + (s.log ? " log" : "")} style={{ left: `${s.x}%` }} aria-hidden />
      ))}
      <svg viewBox="0 0 300 260" className="fire-svg" aria-label={dead ? "The fire is out" : "The fire"}>
        <defs>
          <radialGradient id="glow" cx="50%" cy="80%" r="60%">
            <stop offset="0" stopColor="#ffb347" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="flameA" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff5a1f" />
            <stop offset="0.55" stopColor="#ff9a1f" />
            <stop offset="1" stopColor="#ffe08a" />
          </linearGradient>
          <linearGradient id="flameB" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff7a2a" />
            <stop offset="1" stopColor="#fff2b8" />
          </linearGradient>
        </defs>
        <ellipse cx="150" cy="215" rx={150} ry={70} fill="url(#glow)" style={{ opacity: glow }} />
        {/* flames */}
        {!dead && (
          <g className="flames" style={{ transformOrigin: "150px 215px", transform: `scaleY(${flameH / 120}) scaleX(${0.75 + h * 0.2})` }}>
            <path className="flame f1" fill="url(#flameA)" d="M150 95 C120 130 95 160 105 195 C112 220 135 228 150 226 C165 228 188 220 195 195 C205 160 180 130 150 95Z" />
            <path className="flame f2" fill="url(#flameB)" d="M150 130 C135 150 122 170 128 195 C132 212 143 220 150 219 C157 220 168 212 172 195 C178 170 165 150 150 130Z" />
            <path className="flame f3" fill="#fff6c8" d="M150 165 C143 176 137 186 140 200 C142 210 147 215 150 214 C153 215 158 210 160 200 C163 186 157 176 150 165Z" />
          </g>
        )}
        {dead && <g className="smoke"><path d="M150 210 C140 190 160 175 150 150 C143 135 160 120 150 100" stroke="#8c8f96" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.6" /></g>}
        {/* logs (PLANK) */}
        <g className="logs">
          <rect x="70" y="212" width="160" height="16" rx="8" fill="#8b5a2b" />
          <rect x="95" y="200" width="110" height="16" rx="8" fill="#a06a35" transform="rotate(-6 150 208)" />
          <rect x="95" y="200" width="110" height="16" rx="8" fill="#6f4520" transform="rotate(7 150 208)" />
          <rect x="120" y="222" width="60" height="14" rx="7" fill="#c98c4d" opacity={0.9} />
        </g>
        {/* ash line */}
        <ellipse cx="150" cy="236" rx="120" ry="8" fill="#2b2f36" />
      </svg>
    </div>
  );
}
