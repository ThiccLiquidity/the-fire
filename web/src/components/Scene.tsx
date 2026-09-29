import { useEffect, useRef } from "react";
import { createScene, type Kind, type SceneInput, type SceneView } from "./scene";

/** demo hook: summon a visitor */
export const sceneRef: { visitor?: (k: Kind) => void } = {};

/** The scene canvas. onView reports where the fire sits on screen, so the page can float the pot right above it. */
export function Scene({ onView, ...props }: SceneInput & { onView?: (v: SceneView) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReturnType<typeof createScene> | null>(null);
  const view = useRef(onView);
  useEffect(() => { view.current = onView; });
  useEffect(() => {
    if (!ref.current) return;
    scene.current = createScene(ref.current, (v) => view.current?.(v));
    sceneRef.visitor = (k) => scene.current?.visitor(k);
    return () => scene.current?.destroy();
  }, []);
  useEffect(() => { scene.current?.update(props); });
  return <div className="scene"><canvas ref={ref} aria-label="The campfire: Plank in his chair by the fire, the Plank & Paper press on the stream" /></div>;
}
