import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export function GameSceneLighting() {
  const scene = useThree(state => state.scene);
  useEffect(() => {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(18, 28, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    scene.add(ambient, sun);
    return () => { scene.remove(ambient, sun); ambient.dispose(); sun.dispose(); };
  }, [scene]);
  return null;
}
