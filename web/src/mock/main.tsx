// Scene mock: the real site scene with the press, stream and visitors switched on, plus controls.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Scene, sceneRef } from "../components/Scene";
import { phoenixHour, type Storm } from "../data/types";
import "../index.css";

const KINDS = ["deer", "rabbit", "squirrel", "skunk", "birds", "heron", "frog", "bear"] as const;

function Mock() {
  const [hour, setHour] = useState<number | null>(null);
  const [size, setSize] = useState(0.5);
  const [storm, setStorm] = useState<Storm | undefined>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const h = hour ?? phoenixHour(now);
  const fmt = (v: number) => { const hh = Math.floor(v), mm = Math.round((v - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`; };
  return (
    <div className="page">
      <Scene size={size} hour={h} threat={0.3} storm={storm} lastBuyAt={0} lastBuyBig={false} wild />
      <header className="top"><div className="brand">The Fire<span className="demo-tag">scene mock</span></div></header>
      <div className="pot"><span className="pot-usd">$2,904</span><span className="pot-sub">2.75T PLANK · Fire #14 · 6 nights survived</span></div>
      <footer className="foot" style={{ position: "relative", zIndex: 2 }}>
        <div className="demo-row">
          <label className="demo">Visitor {KINDS.map((k) => <button key={k} onClick={() => sceneRef.visitor?.(k)}>{k}</button>)}</label>
          <label className="demo">Time {fmt(h)} <input type="range" min={0} max={24} step={0.25} value={h} onChange={(e) => setHour(Number(e.target.value))} />{hour !== null && <button onClick={() => setHour(null)}>real</button>}</label>
          <label className="demo">Fire size <input type="range" min={0} max={1} step={0.05} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
          <button className="demo" onClick={() => setStorm({ at: Date.now(), fireId: 14, night: 7, strength: 300, size: 1150, survived: true, intensity: 0.7, sizeAfter: 0.3 })}>Storm (survives)</button>
        </div>
        <p>On the live site a visitor shows up every 10–30 minutes, bears only after dark. Buttons here summon one now.</p>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><Mock /></StrictMode>);
