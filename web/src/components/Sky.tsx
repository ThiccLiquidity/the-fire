import { useEffect, useState } from "react";

/** The sky: clouds gather through the day; at the roll, either clouds pass or it rains. */
export function Sky({ msToRoll, storm }: { msToRoll: number; storm?: { at: number; survived: boolean } }) {
  const hoursLeft = msToRoll / 3_600_000;
  const cloudiness = Math.max(0.15, Math.min(1, 1 - hoursLeft / 12)); // thickens over the last 12h
  const [phase, setPhase] = useState<"clear" | "rain" | "pass">("clear");
  useEffect(() => {
    if (!storm) return;
    if (Date.now() - storm.at > 20_000) return;
    setPhase(storm.survived ? "pass" : "rain");
    const t = setTimeout(() => setPhase("clear"), 9_000);
    return () => clearTimeout(t);
  }, [storm]);

  return (
    <div className={`sky sky-${phase}`} style={{ ["--cloud" as string]: cloudiness }} aria-hidden>
      <div className="stars" />
      <div className="cloud c1" />
      <div className="cloud c2" />
      <div className="cloud c3" />
      <div className="cloud c4" />
      {phase === "rain" && (
        <div className="rain">
          {Array.from({ length: 60 }).map((_, i) => (
            <i key={i} style={{ left: `${(i * 1.7) % 100}%`, animationDelay: `${(i % 12) * 0.08}s` }} />
          ))}
        </div>
      )}
    </div>
  );
}
