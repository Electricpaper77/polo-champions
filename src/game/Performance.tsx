import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";

/**
 * Keeps the render budget predictable when particle bursts occur. Gameplay keeps
 * its fixed 60 Hz timestep; only pixel density is adapted to frame pressure.
 */
export function DynamicResolution() {
  const { gl } = useThree();
  const ratio = useRef(1);

  useFrame((_, delta) => {
    const next = delta > 1 / 54 ? 0.75 : delta < 1 / 68 ? 1 : ratio.current;
    if (next === ratio.current) return;
    ratio.current = next;
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, next));
  });

  return null;
}
