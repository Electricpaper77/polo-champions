const ADVERTISERS = ["POLO CHAMPIONS", "KING'S CUP", "ROYAL STABLES", "BRITISH POLO"];

export const crowdPositions = Array.from({ length: 120 }, (_, index) => {
  const row = Math.floor(index / 30), seat = index % 30;
  return { id: index, row, x: 46 + row * .8, y: row * .55 + .60, z: -27 + seat * 1.86 + (row % 2) * .5 };
});

function Crowd() {
  return <>{crowdPositions.map(spectator => <group key={spectator.id} position={[spectator.x, spectator.y, spectator.z]}>
    <mesh castShadow><cylinderGeometry args={[.13,.16,.52,8]} /><meshStandardMaterial color={spectator.id % 3 === 0 ? "#d8cab0" : "#4c657d"} roughness={.78} /></mesh>
    <mesh position={[0,.39,0]} castShadow><sphereGeometry args={[.12,8,6]} /><meshStandardMaterial color="#c8906e" roughness={.86} /></mesh>
  </group>)}</>;
}

/** Lightweight stadium dressing, kept separate from pitch physics and match logic. */
export function StadiumEnvironment() {
  return <group name="stadium-environment">
    <mesh name="stadium-turf" rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[72, 120]} /><meshBasicMaterial color="#3fa45a" /></mesh>
    {[-40, -20, 0, 20, 40].map(z => <mesh key={z} position={[0, .012, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[72, .16]} /><meshBasicMaterial color="#f3f0df" /></mesh>)}
    {[-24, -12, 0, 12, 24].map(x => <mesh key={`x-${x}`} position={[x, .014, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.14, 120]} /><meshBasicMaterial color={x === 0 ? "#f8f1d7" : "#b9ddad"} transparent opacity={x === 0 ? .82 : .55} /></mesh>)}
    {[-34, 34].map(x => <group key={x} position={[x, .68, 0]}>
      <mesh castShadow><boxGeometry args={[.16, 1.1, 116]} /><meshStandardMaterial color="#f4eedb" roughness={.55} /></mesh>
      {Array.from({ length: 14 }, (_, index) => <group key={index} position={[x > 0 ? -.18 : .18, .02, -52 + index * 8]} rotation={[0, x > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
        <mesh position={[0, .18, 0]} rotation={[0, 0, -.36]}><boxGeometry args={[1.75, .85, .08]} /><meshStandardMaterial color={index % 2 ? "#102a52" : "#8d2428"} /></mesh>
        <mesh position={[-.68, -.18, 0]} rotation={[0, 0, -.62]}><boxGeometry args={[.06, .72, .06]} /><meshStandardMaterial color="#563b24" /></mesh>
        <mesh position={[.68, -.18, 0]} rotation={[0, 0, .62]}><boxGeometry args={[.06, .72, .06]} /><meshStandardMaterial color="#563b24" /></mesh>
      </group>)}
    </group>)}
    {[-56,56].map(z => <group key={`goal-${z}`} position={[0,0,z]}><mesh position={[-6,2,0]} castShadow><cylinderGeometry args={[.14,.16,4,12]}/><meshStandardMaterial color="#fff7df"/></mesh><mesh position={[6,2,0]} castShadow><cylinderGeometry args={[.14,.16,4,12]}/><meshStandardMaterial color="#fff7df"/></mesh><mesh position={[0,4,0]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.12,.12,12,12]}/><meshStandardMaterial color="#fff7df"/></mesh></group>)}
    <group name="east-grandstand">
      {[0, 1, 2, 3].map(row => <mesh key={row} position={[46 + row * .8, row * .55 + .275, 0]} castShadow><boxGeometry args={[.8, .55, 55]} /><meshStandardMaterial color="#344658" roughness={.72} /></mesh>)}
      <mesh position={[47.45, 3.95, 0]} rotation={[0, 0, -.12]} castShadow><boxGeometry args={[.22, .16, 59]} /><meshStandardMaterial color="#13202c" roughness={.5} /></mesh>
      <mesh position={[48.1, 3.52, 0]} rotation={[0, 0, -.12]} castShadow><boxGeometry args={[2.1, .12, 59]} /><meshStandardMaterial color="#182c3d" roughness={.46} /></mesh>
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
