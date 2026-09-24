import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";

const ADVERTISERS = ["POLO CHAMPIONS", "KING'S CUP", "ROYAL STABLES", "BRITISH POLO"];

function Crowd({ count = 180 }: { count?: number }) {
  const spectators = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!spectators.current) return;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const row = Math.floor(index / 30), seat = index % 30;
      position.set(17.5 + row * .52, 1.1 + row * .46, -30 + seat * 2.05 + (row % 2) * .5);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
      scale.set(.55 + (index % 3) * .08, .9 + (index % 4) * .06, .55);
      matrix.compose(position, rotation, scale);
      spectators.current.setMatrixAt(index, matrix);
    }
    spectators.current.instanceMatrix.needsUpdate = true;
  }, [count]);
  return <instancedMesh ref={spectators} args={[undefined, undefined, count]} castShadow>
    <capsuleGeometry args={[.2, .56, 4, 6]} />
    <meshStandardMaterial color="#d4c6aa" roughness={.75} />
  </instancedMesh>;
}

/** Lightweight stadium dressing, kept separate from pitch physics and match logic. */
export function StadiumEnvironment() {
  return <group name="stadium-environment">
    <mesh name="stadium-turf" rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[52, 82]} /><meshStandardMaterial color="#347b43" roughness={.9} /></mesh>
    {[-20, 0, 20].map(z => <mesh key={z} position={[0, .012, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[52, .16]} /><meshBasicMaterial color="#f3f0df" /></mesh>)}
    {[-12.2, 12.2].map(x => <group key={x} position={[x, .68, 0]}>
      <mesh castShadow><boxGeometry args={[.16, 1.1, 80]} /><meshStandardMaterial color="#f4eedb" roughness={.55} /></mesh>
      {Array.from({ length: 10 }, (_, index) => <group key={index} position={[x > 0 ? -.18 : .18, .02, -36 + index * 8]} rotation={[0, x > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
        <mesh position={[0, .18, 0]} rotation={[0, 0, -.36]}><boxGeometry args={[1.75, .85, .08]} /><meshStandardMaterial color={index % 2 ? "#102a52" : "#8d2428"} /></mesh>
        <mesh position={[-.68, -.18, 0]} rotation={[0, 0, -.62]}><boxGeometry args={[.06, .72, .06]} /><meshStandardMaterial color="#563b24" /></mesh>
        <mesh position={[.68, -.18, 0]} rotation={[0, 0, .62]}><boxGeometry args={[.06, .72, .06]} /><meshStandardMaterial color="#563b24" /></mesh>
      </group>)}
    </group>)}
    <group name="east-grandstand" position={[18, 0, 0]}>
      {[0, 1, 2, 3].map(row => <mesh key={row} position={[row * .66, .35 + row * .48, 0]} castShadow><boxGeometry args={[1.15, .22, 64]} /><meshStandardMaterial color="#344658" roughness={.72} /></mesh>)}
      <mesh position={[1.35, 4.15, 0]} rotation={[0, 0, -.12]} castShadow><boxGeometry args={[.22, .16, 68]} /><meshStandardMaterial color="#13202c" roughness={.5} /></mesh>
      <mesh position={[2.05, 3.7, 0]} rotation={[0, 0, -.12]} castShadow><boxGeometry args={[2.1, .12, 68]} /><meshStandardMaterial color="#182c3d" roughness={.46} /></mesh>
      <Crowd />
    </group>
    <group name="stadium-led-scoreboard" position={[14, 0, -15]} rotation={[0, -.42, 0]}>
      {[-1.5, 1.5].map(x => <mesh key={x} position={[x, 2.1, 0]} castShadow><cylinderGeometry args={[.12, .16, 4.2, 10]} /><meshStandardMaterial color="#26313a" roughness={.5} /></mesh>)}
      <mesh position={[0, 4.1, 0]} castShadow><boxGeometry args={[4.4, 2.35, .24]} /><meshStandardMaterial color="#0b1218" metalness={.3} roughness={.28} /></mesh>
      <mesh position={[0, 4.1, -.14]}><boxGeometry args={[3.92, 1.85, .03]} /><meshBasicMaterial color="#183c67" /></mesh>
    </group>
  </group>;
}

export default StadiumEnvironment;
