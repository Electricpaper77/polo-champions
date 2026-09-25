import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { coatColors, SHOP_ITEMS } from "../services/Economy";
import type { PoloRiderEntity } from "./GameState";
import { AnimationController, type EntityActionState } from "./AnimationController";
import { useHorseModel, useRiderModel } from "./AssetManager";
import { getGait, getRiderPose, TEAM_PRESENTATION } from "./HorseControls";
import { getPlayerAvatarCosmetics } from "./PlayerAvatar";
import { useAvatarLod } from "./LODManager";

function configurePbr(root: THREE.Object3D, tint: string, glossy = false): void {
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    // Authored GLTF base-color maps are near-black in the deployed asset set.
    // Use a deterministic field-ready material for readable horses and riders.
    child.material = new THREE.MeshLambertMaterial({ color: tint, emissive: glossy ? new THREE.Color(tint).multiplyScalar(.06) : new THREE.Color(tint).multiplyScalar(.025) });
  });
}

export function PoloEntity({ entity, action = "NONE", motion }: { entity: PoloRiderEntity; action?: EntityActionState; motion?: React.RefObject<{ turn: number; braking: boolean }> }) {
  const horseAsset = useHorseModel(), riderAsset = useRiderModel();
  const horse = useMemo(() => clone(horseAsset.scene), [horseAsset.scene]);
  const rider = useMemo(() => clone(riderAsset.scene), [riderAsset.scene]);
  const root = useRef<THREE.Group>(null), riderPivot = useRef<THREE.Group>(null), mallet = useRef<THREE.Group>(null);
  const useLowLod = useAvatarLod(root);
  const controller = useRef<AnimationController | null>(null);
  const clips = useMemo(() => [...horseAsset.animations, ...riderAsset.animations], [horseAsset.animations, riderAsset.animations]);
  const avatar = entity.id === "player" ? getPlayerAvatarCosmetics() : null;
  const malletColor = avatar?.mallet ?? SHOP_ITEMS.find(item => item.name === entity.mallet)?.color ?? "#d5b66c";

  useEffect(() => {
    configurePbr(horse, avatar?.coat ?? coatColors[entity.coat]);
    configurePbr(rider, "#f4f1e7", true);
  }, [horse, rider, entity.coat, entity.kitColor, avatar?.coat]);
  useEffect(() => {
    if (!root.current) return;
    controller.current = new AnimationController(root.current, clips);
    return () => controller.current?.dispose();
  }, [clips]);
  useFrame((_, delta) => {
    controller.current?.update({ x: entity.velocity.x, z: entity.velocity.y }, delta, action);
    const speed = Math.hypot(entity.velocity.x, entity.velocity.y);
    const pose = getRiderPose(getGait(speed), motion?.current.turn ?? 0, motion?.current.braking ?? false);
    const actionPitch = action === "WIND_UP" ? -0.24 : action === "STRIKE" ? 0.3 : action === "RIDE_OFF_BRACE" ? -0.08 : 0;
    if (riderPivot.current) {
      riderPivot.current.rotation.x = THREE.MathUtils.damp(riderPivot.current.rotation.x, pose.torsoPitch + actionPitch, 9, delta);
      riderPivot.current.rotation.z = THREE.MathUtils.damp(riderPivot.current.rotation.z, action === "RIDE_OFF_BRACE" ? 0.18 : -(motion?.current.turn ?? 0) * Math.min(speed / 90, 0.16), 9, delta);
    }
    if (mallet.current) mallet.current.rotation.z = THREE.MathUtils.damp(mallet.current.rotation.z, action === "WIND_UP" ? -0.9 : action === "STRIKE" ? 1.05 : 0.25, 14, delta);
  });

  const presentation = TEAM_PRESENTATION[entity.team];
  if (useLowLod) return <group ref={root} name={`polo-entity-${entity.id}-lod`}><mesh position={[0,1,0]} castShadow><capsuleGeometry args={[.5,1.7,4,8]}/><meshStandardMaterial color={avatar?.coat ?? coatColors[entity.coat]}/></mesh><mesh position={[0,2.15,-.1]}><sphereGeometry args={[.27,10,8]}/><meshStandardMaterial color={presentation.helmet}/></mesh><mesh position={[.45,.75,.2]} rotation={[0,0,.25]}><cylinderGeometry args={[.025,.025,1.8,6]}/><meshStandardMaterial color={malletColor}/></mesh></group>;
  return <group ref={root} name={`polo-entity-${entity.id}`}>
    <group name="horse-torso">
      <primitive object={horse} scale={0.18} position={[0, 0, 0]} />
      <mesh position={[0, 1.42, -0.08]} castShadow><boxGeometry args={[0.84, 0.1, 1.1]} /><meshStandardMaterial color="#3D2314" roughness={0.76} /></mesh>
      <mesh position={[0, 1.39, -0.08]} castShadow><boxGeometry args={[0.98, 0.035, 1.28]} /><meshStandardMaterial color={presentation.saddlePad} roughness={0.72} /></mesh>
      {[-.38,.38].map(x=><group key={`stirrup-${x}`}><mesh position={[x,.725,0]} castShadow><cylinderGeometry args={[.018,.018,.45,6]} /><meshStandardMaterial color="#32d5df" metalness={.32} roughness={.34} /></mesh><mesh position={[x < 0 ? -.40 : .40,.50,0]} castShadow><torusGeometry args={[.12,.025,6,10]} /><meshStandardMaterial color="#32d5df" metalness={.32} roughness={.34} /></mesh></group>)}
      {[-.37,.37].flatMap(x=>[-.56,.56].map(z=><mesh key={`${x}-${z}`} position={[x,.36,z]}><cylinderGeometry args={[.095,.095,.26,8]} /><meshStandardMaterial color={presentation.poloWrap} roughness={.66}/></mesh>))}
    </group>
    <group ref={riderPivot} position={[0, 1.15, -0.1]}>
      <primitive object={rider} scale={0.16} position={[0, 0, 0]} />
      <mesh position={[0, 1.36, 0]} castShadow><sphereGeometry args={[0.26, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshPhysicalMaterial color="#faf8f0" roughness={0.18} clearcoat={0.75} /></mesh>
      <Text position={[0, 0.7, -0.32]} rotation={[0, Math.PI, 0]} fontSize={0.28} color="#f8f2e3">{entity.id === "player" ? "3" : entity.id.split("_")[1]}</Text>
      <group ref={mallet} position={[0.48, 0.78, 0.64]} rotation={[0, 0, 0.25]}>
        <mesh position={[0, -0.72, 0]}><cylinderGeometry args={[0.025, 0.025, 2.25, 8]} /><meshStandardMaterial color={malletColor} roughness={0.5} /></mesh>
        <mesh position={[0, -1.82, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.09, 0.09, 0.48, 10]} /><meshStandardMaterial color="#6a3e20" roughness={0.72} /></mesh>
      </group>
    </group>
  </group>;
}
