import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function GameSceneLighting() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 3.0);
    const sun = new THREE.DirectionalLight(0xffffff, 5.0);
    sun.position.set(10, 20, 10); sun.target.position.set(0, 0, 0); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    const previousEnvironment = scene.environment;
    const environment = pmremGenerator.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = environment;
    scene.add(ambient, sun, sun.target);
    return () => { scene.remove(ambient, sun, sun.target); scene.environment = previousEnvironment; environment.dispose(); pmremGenerator.dispose(); sun.dispose(); };
  }, [scene, gl]);
  return null;
}
