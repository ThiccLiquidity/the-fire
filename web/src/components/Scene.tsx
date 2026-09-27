import { useEffect, useRef } from "react";
import { createScene, type SceneInput } from "./scene";
import type { Kind } from "./wildlife";

/** demo hook: App can summon a visitor through this */
export const sceneRef: { visitor?: (k: Kind) => void } = {};

export function Scene(props: SceneInput) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReturnType<typeof createScene> | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    scene.current = createScene(ref.current);
    sceneRef.visitor = (k) => scene.current?.visitor(k);
    return () => scene.current?.destroy();
  }, []);
  useEffect(() => { scene.current?.update(props); }, [props]);
  return <div className="scene"><canvas ref={ref} aria-label="The fire" /></div>;
}
