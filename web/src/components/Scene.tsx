import { useEffect, useMemo, useRef, useState } from "react";
import type { Buy, Storm } from "../data/types";

/**
 * The scene: sky (day/night by Phoenix clock), treeline, ground, the fire, and storms.
 * `size` is today's tickets relative to a rough expectation (0..2+). `threat` (0..1) darkens the sky
 * toward the roll. A `storm` prop plays the roll: lightning + thunder scaled to intensity, then rain
 * (fire out) or clouds passing (survived).
 */
export function Scene({
  size, hour, threat, storm, recent, dead,
}: { size: number; hour: number; threat: number; storm?: Storm; recent: Buy[]; dead: boolean }) {
  const active = storm && Date.now() - storm.at < 12_000 ? storm : undefined;
  const [flash, setFlash] = useState(0);
  const [phase, setPhase] = useState<"none" | "storm" | "rain" | "pass">("none");
  const seen = useRef<number>(0);

  // Play the storm once per storm event
  useEffect(() => {
    if (!active || seen.current === active.at) return;
    seen.current = active.at;
    setPhase("storm");
    const bolts = Math.round(2 + active.intensity * 6);
    const timers: number[] = [];
    for (let i = 0; i < bolts; i++) {
      const t = 300 + i * (900 - active.intensity * 500) + Math.random() * 400;
      timers.push(window.setTimeout(() => {
        setFlash(0.5 + active.intensity * 0.5);
        thunder(active.intensity, i === 0 ? 0 : Math.random() * 0.6);
        window.setTimeout(() => setFlash(0), 120 + Math.random() * 120);
      }, t));
    }
    timers.push(window.setTimeout(() => setPhase(active.survived ? "pass" : "rain"), 500 + bolts * 700));
    timers.push(window.setTimeout(() => setPhase("none"), 11_000));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  const sky = useMemo(() => skyFor(hour, threat, phase), [hour, threat, phase]);
  const h = dead ? 0 : Math.max(0.3, Math.min(2.4, size));
  const scraps = recent.slice(0, 6);

  return (
    <div className={`scene phase-${phase}`} style={{ background: sky.bg }}>
      <div className="flash" style={{ opacity: flash }} />
      <svg viewBox="0 0 1200 700" className="scene-svg" preserveAspectRatio="xMidYMax slice" aria-label={dead ? "The fire is out" : "The fire"}>
        <defs>
          <radialGradient id="fireglow" cx="50%" cy="70%" r="50%">
            <stop offset="0" stopColor="#ffb347" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fA" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff4d12" /><stop offset="0.5" stopColor="#ff9a1f" /><stop offset="1" stopColor="#ffe08a" /></linearGradient>
          <linearGradient id="fB" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff7a2a" /><stop offset="1" stopColor="#fff2b8" /></linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky.ground1} /><stop offset="1" stopColor={sky.ground2} /></linearGradient>
        </defs>

        {/* sun / moon */}
        {sky.sun && <circle cx={sky.sun.x} cy={sky.sun.y} r="38" fill="#ffd66b" opacity={0.9} />}
        {sky.moon && <circle cx={sky.moon.x} cy={sky.moon.y} r="26" fill="#e9eef7" opacity={0.85} />}
        {sky.stars > 0 && STARS.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={p[2]} fill="#fff" opacity={sky.stars * p[3]} />)}

        {/* clouds */}
        <g className="clouds" opacity={0.35 + threat * 0.55} fill={sky.cloud}>
          <Cloud x={120} y={110} s={1.2} />
          <Cloud x={560} y={70} s={1.6} />
          <Cloud x={900} y={140} s={1.0} />
        </g>
        {phase === "storm" && <g className="clouds storm-clouds" fill="#2a2f3d"><Cloud x={200} y={60} s={2} /><Cloud x={700} y={30} s={2.4} /></g>}

        {/* far treeline */}
        <path d={FAR_TREES} fill={sky.treeFar} />
        {/* ground */}
        <path d="M0 520 C 200 500 400 540 600 520 C 800 500 1000 540 1200 520 L1200 700 L0 700 Z" fill="url(#ground)" />
        {/* near trees */}
        <g fill={sky.treeNear}>
          <Pine x={90} y={520} s={1.4} /><Pine x={190} y={540} s={1.0} /><Pine x={1040} y={530} s={1.3} /><Pine x={1140} y={545} s={0.9} />
        </g>

        {/* fire glow on ground */}
        <ellipse cx="600" cy="560" rx={260 * Math.max(0.4, h)} ry={90} fill="url(#fireglow)" style={{ opacity: dead ? 0 : 0.9 }} />
        {/* stones */}
        <g fill="#4a4e58">
          {STONES.map((p, i) => <ellipse key={i} cx={p[0]} cy={p[1]} rx={p[2]} ry={p[3]} />)}
        </g>
        {/* logs */}
        <g>
          <rect x="500" y="548" width="200" height="22" rx="11" fill="#6f4520" />
          <rect x="520" y="536" width="160" height="22" rx="11" fill="#8b5a2b" transform="rotate(-8 600 547)" />
          <rect x="520" y="536" width="160" height="22" rx="11" fill="#5b3a1c" transform="rotate(9 600 547)" />
        </g>
        {/* flames */}
        {!dead && (
          <g className="flames" style={{ transformOrigin: "600px 552px", transform: `scale(${0.7 + h * 0.45}, ${0.6 + h * 0.75})` }}>
            <path className="flame f1" fill="url(#fA)" d="M600 380 C560 430 520 470 532 520 C540 548 575 560 600 558 C625 560 660 548 668 520 C680 470 640 430 600 380Z" />
            <path className="flame f2" fill="url(#fB)" d="M600 430 C580 458 562 482 570 515 C575 535 590 546 600 545 C610 546 625 535 630 515 C638 482 620 458 600 430Z" />
            <path className="flame f3" fill="#fff6c8" d="M600 478 C591 492 583 505 586 522 C588 534 595 541 600 540 C605 541 612 534 614 522 C617 505 609 492 600 478Z" />
            {[0, 1, 2, 3, 4].map((i) => <circle key={i} className={`spark s${i}`} cx={585 + i * 8} cy="470" r="2.5" fill="#ffd27a" />)}
          </g>
        )}
        {dead && <path className="smoke" d="M600 545 C585 515 618 495 600 460 C588 440 615 420 600 390" stroke="#9aa0ac" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.6" />}

        {/* thrown paper / logs */}
        {scraps.map((b, i) => (
          <g key={b.id} className="scrap" style={{ animationDelay: `${i * 0.05}s` }}>
            {b.stoke || b.tickets >= 100
              ? <rect x="-20" y="-6" width="40" height="12" rx="6" fill="#a06a35" />
              : <rect x="-8" y="-10" width="16" height="20" rx="2" fill="#f3e9d2" />}
          </g>
        ))}
      </svg>

      {/* burn notes drifting over the fire */}
      <div className="notes" aria-hidden>
        {recent.filter((b) => b.note).slice(0, 5).map((b, i) => (
          <span key={b.id} className="drift" style={{ left: `${30 + (i * 13) % 40}%`, animationDelay: `${i * 0.4}s` }}>{b.note}</span>
        ))}
      </div>

      {phase === "rain" && <div className="rain">{Array.from({ length: 80 }).map((_, i) => <i key={i} style={{ left: `${(i * 1.27) % 100}%`, animationDelay: `${(i % 14) * 0.07}s` }} />)}</div>}
    </div>
  );
}

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="0" rx="70" ry="22" /><circle cx="-25" cy="-14" r="26" /><circle cx="15" cy="-20" r="32" /><circle cx="45" cy="-8" r="22" />
    </g>
  );
}
function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 -150 L-42 -60 L-22 -60 L-58 10 L-12 10 L-12 40 L12 40 L12 10 L58 10 L22 -60 L42 -60 Z" />
    </g>
  );
}

const FAR_TREES = (() => {
  let d = "M0 540 ";
  for (let x = 0; x <= 1200; x += 40) d += `L${x} ${470 + ((x * 7919) % 50)} L${x + 20} ${430 + ((x * 104729) % 40)} `;
  return d + "L1200 540 L1200 700 L0 700 Z";
})();
const STARS = Array.from({ length: 70 }, (_, i) => [((i * 7919) % 1200), ((i * 104729) % 360), 0.8 + ((i * 31) % 3) * 0.5, 0.4 + ((i * 17) % 6) * 0.1] as const);
const STONES = [[470, 575, 26, 10], [520, 585, 22, 9], [600, 592, 30, 10], [680, 585, 22, 9], [730, 575, 26, 10], [740, 560, 18, 8], [460, 560, 18, 8]] as const;

/** Sky colours by Phoenix hour, threat, and storm phase. */
function skyFor(hour: number, threat: number, phase: string) {
  // key times: 5.5 dawn, 7 morning, 12 noon, 17.5 evening, 19 dusk, 20.5 night
  const stops: [number, string, string, string, string, string][] = [
    //  hr   top        bottom     cloud      treeFar    treeNear
    [0,   "#070b1a", "#17213f", "#2e3550", "#0e1526", "#0a1020"],
    [5.5, "#1a2140", "#5a4a6a", "#5d5470", "#20263d", "#141a2c"],
    [7,   "#7aa7e0", "#f2c9a0", "#ffffff", "#3b5a5e", "#25403f"],
    [12,  "#6fb0ff", "#c9e6ff", "#ffffff", "#3f6a52", "#2c4d3a"],
    [17.5,"#7f9fe0", "#ffb27a", "#ffe6d0", "#3d4f60", "#28363f"],
    [19,  "#2c2f5e", "#e0644a", "#7c5a70", "#1c2035", "#12162a"],
    [20.5,"#0b1230", "#243257", "#3a4260", "#0f1730", "#0b1124"],
    [24,  "#070b1a", "#17213f", "#2e3550", "#0e1526", "#0a1020"],
  ];
  let i = 0;
  while (i < stops.length - 2 && hour >= stops[i + 1][0]) i++;
  const a = stops[i], b = stops[i + 1];
  const t = (hour - a[0]) / (b[0] - a[0]);
  const mix = (x: string, y: string) => lerpColor(x, y, t);
  let top = mix(a[1], b[1]), bot = mix(a[2], b[2]);
  const cloud = mix(a[3], b[3]);
  // threat darkens toward the roll
  top = lerpColor(top, "#1a1f2e", threat * 0.5);
  bot = lerpColor(bot, "#2a3040", threat * 0.4);
  if (phase === "storm" || phase === "rain") { top = "#0f121c"; bot = "#262c3b"; }
  const night = hour < 6 || hour > 19.5 ? 1 : hour < 7 ? (7 - hour) : hour > 18.5 ? (hour - 18.5) : 0;
  const sun = hour > 6 && hour < 19 ? { x: 100 + ((hour - 6) / 13) * 1000, y: 380 - Math.sin(((hour - 6) / 13) * Math.PI) * 300 } : null;
  const moon = hour < 5 || hour > 20 ? { x: 950, y: 120 } : null;
  return {
    bg: `linear-gradient(180deg, ${top} 0%, ${bot} 75%)`,
    cloud, sun, moon, stars: phase === "none" ? Math.min(1, night) * (1 - threat * 0.5) : 0,
    treeFar: mix(a[4], b[4]), treeNear: mix(a[5], b[5]),
    ground1: lerpColor("#3b4a2e", "#141a14", Math.min(1, night)), ground2: lerpColor("#2b3622", "#0b0f0c", Math.min(1, night)),
  };
}
function lerpColor(a: string, b: string, t: number) {
  const pa = hex(a), pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function hex(c: string): number[] {
  if (c.startsWith("rgb")) return c.match(/\d+/g)!.map(Number);
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---- thunder (Web Audio, no assets) ---------------------------------------------------------
let ctx: AudioContext | null = null;
function thunder(intensity: number, delay: number) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const dur = 1.2 + intensity * 2.5;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * (0.6 + 0.4 * Math.sin(t * 40));
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 120 + intensity * 260;
    const g = ctx.createGain(); g.gain.value = 0.15 + intensity * 0.5;
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(ctx.currentTime + delay);
  } catch { /* no audio */ }
}
