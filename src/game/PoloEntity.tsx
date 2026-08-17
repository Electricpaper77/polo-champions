import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { coatColors, SHOP_ITEMS } from "../services/Economy";
import type { PoloRiderEntity } from "./GameState";
import { AnimationController, type EntityActionState } from "./AnimationController";
import { useHorseModel, useRiderModel } from "./AssetManager";

function configurePbr(root: THREE.Object3D, tint: string, glossy = false): void {
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const source = Array.isArray(child.material) ? child.material[0] : child.material;
    if (!(source instanceof THREE.MeshStandardMaterial)) return;
    const material = source.clone();
    material.color.lerp(new THREE.Color(tint), glossy ? 0.58 : 0.34);
    material.roughness = glossy ? 0.22 : 0.68;
    material.metalness = glossy ? 0.2 : 0.03;
    if (material.normalMap) material.normalScale.set(glossy ? 0.22 : 0.62, glossy ? 0.22 : 0.62);
    child.material = material;
  });
}

export function PoloEntity({ entity, action = "NONE", motion }: { entity: PoloRiderEntity; action?: EntityActionState; motion?: React.RefObject<{ turn: number; braking: boolean }> }) {
  const horseAsset = useHorseModel(), riderAsset = useRiderModel();
  const horse = useMemo(() => clone(horseAsset.scene), [horseAsset.scene]);
  const rider = useMemo(() => clone(riderAsset.scene), [riderAsset.scene]);
  const root = useRef<THREE.Group>(null), riderPivot = useRef<THREE.Group>(null), mallet = useRef<THREE.Group>(null);
  const controller = useRef<AnimationController | null>(null);
  const clips = useMemo(() => [...horseAsset.animations, ...riderAsset.animations], [horseAsset.animations, riderAsset.animations]);
  const malletColor = SHOP_ITEMS.find(item => item.name === entity.mallet)?.color ?? "#d5b66c";

  useEffect(() => {
    configurePbr(horse, coatColors[entity.coat]);
    configurePbr(rider, entity.kitColor, true);
  }, [horse, rider, entity.coat, entity.kitColor]);
  useEffect(() => {
    if (!root.current) return;
    controller.current = new AnimationController(root.current, clips);
    return () => controller.current?.dispose();
  }, [clips]);
  useFrame((_, delta) => {
    controller.current?.update({ x: entity.velocity.x, z: entity.velocity.y }, delta, action);
    const speed = Math.hypot(entity.velocity.x, entity.velocity.y);
    const actionPitch = action === "WIND_UP" ? -0.24 : action === "STRIKE" ? 0.3 : action === "RIDE_OFF_BRACE" ? -0.08 : 0;
    if (riderPivot.current) {
      riderPivot.current.rotation.x = THREE.MathUtils.damp(riderPivot.current.rotation.x, -Math.min(speed / 80, 0.25) + actionPitch + (motion?.current.braking ? 0.24 : 0), 9, delta);
      riderPivot.current.rotation.z = THREE.MathUtils.damp(riderPivot.current.rotation.z, action === "RIDE_OFF_BRACE" ? 0.18 : -(motion?.current.turn ?? 0) * Math.min(speed / 90, 0.16), 9, delta);
    }
    if (mallet.current) mallet.current.rotation.z = THREE.MathUtils.damp(mallet.current.rotation.z, action === "WIND_UP" ? -0.9 : action === "STRIKE" ? 1.05 : 0.25, 14, delta);
  });

  return <group ref={root} name={`polo-entity-${entity.id}`}>
    <primitive object={horse} scale={0.86} position={[0, 0, 0]} />
    <mesh position={[0, 1.42, -0.08]} castShadow><boxGeometry args={[0.84, 0.1, 1.1]} /><meshStandardMaterial color="#3D2314" roughness={0.76} /></mesh>
    <group ref={riderPivot} position={[0, 1.44, -0.04]}>
      <primitive object={rider} scale={0.72} position={[0, 0, 0]} />
      <mesh position={[0, 1.36, 0]} castShadow><sphereGeometry args={[0.26, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshPhysicalMaterial color={entity.team === "blue" ? "#f7f5ef" : "#8B1E1E"} roughness={0.18} clearcoat={0.75} /></mesh>
      <Text position={[0, 0.7, -0.32]} rotation={[0, Math.PI, 0]} fontSize={0.28} color="#f8f2e3">{entity.id === "player" ? "3" : entity.id.split("_")[1]}</Text>
      <group ref={mallet} position={[0.48, 0.78, 0.64]} rotation={[0, 0, 0.25]}>
        <mesh position={[0, -0.72, 0]}><cylinderGeometry args={[0.025, 0.025, 2.25, 8]} /><meshStandardMaterial color={malletColor} roughness={0.5} /></mesh>
        <mesh position={[0, -1.82, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.09, 0.09, 0.48, 10]} /><meshStandardMaterial color="#6a3e20" roughness={0.72} /></mesh>
      </group>
    </group>
  </group>;
}
