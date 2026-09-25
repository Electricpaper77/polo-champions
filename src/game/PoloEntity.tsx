import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { coatColors, SHOP_ITEMS } from "../services/Economy";
import type { PoloRiderEntity } from "./GameState";
import type { EntityActionState } from "./AnimationController";
import { getGait, getRiderPose, TEAM_PRESENTATION } from "./HorseControls";
import { getPlayerAvatarCosmetics } from "./PlayerAvatar";
import { useAvatarLod } from "./LODManager";

type PoloEntityProps = {
  entity: PoloRiderEntity;
  action?: EntityActionState;
  motion?: React.RefObject<{ turn: number; braking: boolean }>;
};

function HorseBody({ coat, wrapColor, saddlePad }: { coat: string; wrapColor: string; saddlePad: string }) {
  const legXs = [-0.34, 0.34];
  const legZs = [-0.62, 0.54];

  return (
    <group name="horse-torso">
      <mesh position={[0, 0.96, -0.04]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[0.42, 1.32, 8, 18]} />
        <meshStandardMaterial color={coat} roughness={0.72} metalness={0} />
      </mesh>
      <mesh position={[0, 1.36, 0.66]} rotation={[0.48, 0, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[0.18, 0.48, 6, 12]} />
        <meshStandardMaterial color={coat} roughness={0.74} metalness={0} />
      </mesh>
      <mesh position={[0, 1.48, 0.98]} rotation={[0.18, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.32, 0.46]} />
        <meshStandardMaterial color={coat} roughness={0.76} metalness={0} />
      </mesh>
      <mesh position={[0, 1.66, 0.78]} castShadow>
        <coneGeometry args={[0.18, 0.34, 10]} />
        <meshStandardMaterial color="#15110d" roughness={0.82} metalness={0} />
      </mesh>
      <mesh position={[0, 0.98, -0.9]} rotation={[-0.84, 0, 0]} castShadow>
        <coneGeometry args={[0.08, 0.72, 8]} />
        <meshStandardMaterial color="#17120d" roughness={0.82} metalness={0} />
      </mesh>
      {legXs.flatMap(x =>
        legZs.map(z => (
          <group key={`${x}-${z}`}>
            <mesh position={[x, 0.52, z]} castShadow receiveShadow>
              <capsuleGeometry args={[0.085, 0.58, 5, 8]} />
              <meshStandardMaterial color={coat} roughness={0.74} metalness={0} />
            </mesh>
            <mesh position={[x, 0.27, z]} castShadow receiveShadow>
              <cylinderGeometry args={[0.102, 0.092, 0.3, 8]} />
              <meshStandardMaterial color={wrapColor} roughness={0.62} metalness={0.02} />
            </mesh>
            <mesh position={[x, 0.08, z]} scale={[1.28, 0.42, 1.05]} castShadow receiveShadow>
              <sphereGeometry args={[0.11, 10, 8]} />
              <meshStandardMaterial color="#16110d" roughness={0.68} metalness={0} />
            </mesh>
          </group>
        ))
      )}
      <mesh position={[0, 1.44, -0.08]} castShadow>
        <boxGeometry args={[0.84, 0.1, 1.1]} />
        <meshStandardMaterial color="#3d2314" roughness={0.76} metalness={0} />
      </mesh>
      <mesh position={[0, 1.39, -0.08]} castShadow>
        <boxGeometry args={[0.98, 0.035, 1.28]} />
        <meshStandardMaterial color={saddlePad} roughness={0.72} metalness={0} />
      </mesh>
      {[-0.38, 0.38].map(x => (
        <group key={`stirrup-${x}`}>
          <mesh position={[x, 0.725, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, 0.45, 6]} />
            <meshStandardMaterial color="#32d5df" metalness={0.22} roughness={0.38} />
          </mesh>
          <mesh position={[x < 0 ? -0.4 : 0.4, 0.5, 0]} castShadow>
            <torusGeometry args={[0.12, 0.025, 6, 10]} />
            <meshStandardMaterial color="#32d5df" metalness={0.22} roughness={0.38} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rider({ jersey, helmet, label }: { jersey: string; helmet: string; label: string }) {
  return (
    <>
      <mesh position={[0, 0.44, -0.02]} castShadow receiveShadow>
        <capsuleGeometry args={[0.22, 0.48, 8, 12]} />
        <meshStandardMaterial color={jersey} roughness={0.52} metalness={0} />
      </mesh>
      <mesh position={[0, 0.89, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color="#d9a078" roughness={0.48} metalness={0} />
      </mesh>
      <mesh position={[0, 1.04, 0]} castShadow>
        <sphereGeometry args={[0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
        <meshStandardMaterial color={helmet} roughness={0.18} metalness={0.02} />
      </mesh>
      {[-0.36, 0.36].map(x => (
        <group key={`rider-leg-${x}`}>
          <mesh position={[x, 0.18, 0.02]} rotation={[0.2, 0, x < 0 ? -0.18 : 0.18]} castShadow>
            <capsuleGeometry args={[0.07, 0.5, 5, 8]} />
            <meshStandardMaterial color="#f5f1e6" roughness={0.58} metalness={0} />
          </mesh>
          <mesh position={[x, -0.18, 0.02]} castShadow>
            <capsuleGeometry args={[0.06, 0.34, 5, 8]} />
            <meshStandardMaterial color="#2b1b12" roughness={0.62} metalness={0} />
          </mesh>
        </group>
      ))}
      <mesh position={[-0.26, 0.38, 0.02]} rotation={[0, 0, 0.5]} castShadow>
        <capsuleGeometry args={[0.045, 0.42, 5, 8]} />
        <meshStandardMaterial color="#f5f1e6" roughness={0.58} metalness={0} />
      </mesh>
      <mesh position={[0.34, 0.4, 0.08]} rotation={[0, 0, -0.62]} castShadow>
        <capsuleGeometry args={[0.045, 0.48, 5, 8]} />
        <meshStandardMaterial color="#f5f1e6" roughness={0.58} metalness={0} />
      </mesh>
      <Text position={[0, 0.48, -0.24]} rotation={[0, Math.PI, 0]} fontSize={0.22} color="#f8f2e3">
        {label}
      </Text>
    </>
  );
}

export function PoloEntity({ entity, action = "NONE", motion }: PoloEntityProps) {
  const root = useRef<THREE.Group>(null);
  const riderPivot = useRef<THREE.Group>(null);
  const mallet = useRef<THREE.Group>(null);
  const useLowLod = useAvatarLod(root);
  const avatar = entity.id === "player" ? getPlayerAvatarCosmetics() : null;
  const presentation = TEAM_PRESENTATION[entity.team];
  const coat = avatar?.coat ?? coatColors[entity.coat];
  const malletColor = avatar?.mallet ?? SHOP_ITEMS.find(item => item.name === entity.mallet)?.color ?? "#d5b66c";
  const jerseyNumber = entity.id === "player" ? "3" : entity.id.split("_")[1] ?? "";

  useFrame((_, delta) => {
    const speed = Math.hypot(entity.velocity.x, entity.velocity.y);
    const pose = getRiderPose(getGait(speed), motion?.current.turn ?? 0, motion?.current.braking ?? false);
    const actionPitch = action === "WIND_UP" ? -0.24 : action === "STRIKE" ? 0.3 : action === "RIDE_OFF_BRACE" ? -0.08 : 0;

    if (riderPivot.current) {
      riderPivot.current.rotation.x = THREE.MathUtils.damp(riderPivot.current.rotation.x, pose.torsoPitch + actionPitch, 9, delta);
      riderPivot.current.rotation.z = THREE.MathUtils.damp(
        riderPivot.current.rotation.z,
        action === "RIDE_OFF_BRACE" ? 0.18 : -(motion?.current.turn ?? 0) * Math.min(speed / 90, 0.16),
        9,
        delta,
      );
    }

    if (mallet.current) {
      mallet.current.rotation.z = THREE.MathUtils.damp(
        mallet.current.rotation.z,
        action === "WIND_UP" ? -0.9 : action === "STRIKE" ? 1.05 : 0.25,
        14,
        delta,
      );
    }
  });

  if (useLowLod) {
    return (
      <group ref={root} name={`polo-entity-${entity.id}-lod`}>
        <mesh position={[0, 0.95, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.44, 1.42, 6, 10]} />
          <meshStandardMaterial color={coat} roughness={0.72} metalness={0} />
        </mesh>
        <mesh position={[0, 2.1, -0.08]} castShadow>
          <sphereGeometry args={[0.24, 10, 8]} />
          <meshStandardMaterial color={presentation.helmet} roughness={0.3} metalness={0} />
        </mesh>
        <mesh position={[0.45, 0.76, 0.28]} rotation={[0, 0, 0.25]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 1.8, 6]} />
          <meshStandardMaterial color={malletColor} roughness={0.5} metalness={0} />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={root} name={`polo-entity-${entity.id}`}>
      <HorseBody coat={coat} wrapColor={presentation.poloWrap} saddlePad={presentation.saddlePad} />
      <group ref={riderPivot} position={[0, 1.48, -0.18]}>
        <Rider jersey={entity.kitColor} helmet={presentation.helmet} label={jerseyNumber} />
        <group ref={mallet} position={[0.48, 0.78, 0.64]} rotation={[0, 0, 0.25]}>
          <mesh position={[0, -0.72, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 2.25, 8]} />
            <meshStandardMaterial color={malletColor} roughness={0.5} metalness={0} />
          </mesh>
          <mesh position={[0, -1.82, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 0.48, 10]} />
            <meshStandardMaterial color="#6a3e20" roughness={0.72} metalness={0} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
