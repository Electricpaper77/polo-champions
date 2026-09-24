import React from 'react';

export const PitchEnvironment: React.FC = () => {
  return (
    <group name="pbr-pitch-environment">
      {/* 3D Touchline Scoreboard - Angled in upper right view */}
      <group name="pbr-touchline-scoreboard" position={[7.5, 0, -12]} rotation={[0, -0.4, 0]}>
        <mesh position={[-1.2, 1.2, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 2.4, 12]} />
          <meshStandardMaterial color="#3d2314" roughness={0.8} />
        </mesh>
        <mesh position={[1.2, 1.2, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 2.4, 12]} />
          <meshStandardMaterial color="#3d2314" roughness={0.8} />
        </mesh>
        <mesh position={[0, 2.0, 0]} castShadow>
          <boxGeometry args={[2.8, 1.2, 0.1]} />
          <meshStandardMaterial color="#1f2421" roughness={0.5} />
        </mesh>
        <mesh position={[0, 2.0, -0.01]}>
          <boxGeometry args={[2.9, 1.3, 0.06]} />
          <meshStandardMaterial color="#2c1a0e" roughness={0.7} />
        </mesh>
        <mesh position={[-0.7, 2.0, 0.06]}>
          <planeGeometry args={[0.7, 0.7]} />
          <meshBasicMaterial color="#1e3a8a" />
        </mesh>
        <mesh position={[0.7, 2.0, 0.06]}>
          <planeGeometry args={[0.7, 0.7]} />
          <meshBasicMaterial color="#991b1b" />
        </mesh>
      </group>

      {/* Perimeter Sideboards - Visible along field edges */}
      <mesh position={[-8.2, 0.1, 0]} castShadow>
        <boxGeometry args={[0.2, 0.25, 60]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[8.2, 0.1, 0]} castShadow>
        <boxGeometry args={[0.2, 0.25, 60]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
    </group>
  );
};

export default PitchEnvironment;