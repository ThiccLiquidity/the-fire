import { useEffect, useRef } from "react";
import { createScene, type SceneInput } from "./scene";

export function Scene(props: SceneInput) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReturnType<typeof createScene> | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    scene.current = createScene(ref.current);
    return () => scene.current?.destroy();
  }, []);
  useEffect(() => { scene.current?.update(props); }, [props]);
  return <div className="scene"><canvas ref={ref} aria-label="The fire" /></div>;
}
