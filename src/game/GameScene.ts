import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export function GameSceneLighting() {
  const scene = useThree(state => state.scene);
  useEffect(() => {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(20, 50, 20); sun.target.position.set(0, 0, 0); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    scene.add(ambient, sun, sun.target);
    return () => { scene.remove(ambient, sun, sun.target); sun.dispose(); };
  }, [scene]);
  return null;
}
