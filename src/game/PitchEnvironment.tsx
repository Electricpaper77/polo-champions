import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

function turfTextures() {
  const size = 512, colorCanvas = document.createElement("canvas"), normalCanvas = document.createElement("canvas"), heightCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = normalCanvas.width = normalCanvas.height = heightCanvas.width = heightCanvas.height = size;
  const color = colorCanvas.getContext("2d")!, normal = normalCanvas.getContext("2d")!, height = heightCanvas.getContext("2d")!;
  for (let x = 0; x < size; x += 32) { color.fillStyle = x % 64 === 0 ? "#266e3b" : "#2f7c43"; color.fillRect(x, 0, 32, size); }
  for (let y = 0; y < size; y += 4) { normal.fillStyle = y % 8 === 0 ? "rgb(124,136,255)" : "rgb(132,120,255)"; normal.fillRect(0, y, size, 4); height.fillStyle = y % 8 === 0 ? "#a5a5a5" : "#858585"; height.fillRect(0, y, size, 4); }
  const map = new THREE.CanvasTexture(colorCanvas), normalMap = new THREE.CanvasTexture(normalCanvas), displacementMap = new THREE.CanvasTexture(heightCanvas);
  [map, normalMap, displacementMap].forEach(texture => { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(14, 22); texture.anisotropy = 8; });
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap, displacementMap };
}

export function PitchEnvironment({ width = 52, length = 82 }: { width?: number; length?: number }) {
  const { gl } = useThree(), textures = useMemo(turfTextures, []), grass = useRef<THREE.InstancedMesh>(null), shader = useRef<THREE.WebGLProgramParametersWithUniforms | null>(null);
  const material = useMemo(() => {
    const value = new THREE.MeshStandardMaterial({ color: "#3c8b4a", roughness: 0.82, side: THREE.DoubleSide });
    value.onBeforeCompile = program => {
      program.uniforms.uTime = { value: 0 };
      program.vertexShader = program.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.x += sin(uTime * 1.6 + instanceMatrix[3].x * .31 + instanceMatrix[3].z * .19) * transformed.y * .12;");
      shader.current = program;
    };
    value.customProgramCacheKey = () => "polo-volumetric-grass-v1";
    return value;
  }, []);
  useEffect(() => { gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap; }, [gl]);
  useEffect(() => () => { textures.map.dispose(); textures.normalMap.dispose(); textures.displacementMap.dispose(); material.dispose(); }, [textures, material]);
  useLayoutEffect(() => {
    if (!grass.current) return;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let i = 0; i < grass.current.count; i++) {
      const u = ((i * 16807) % 2147483647) / 2147483647, v = ((i * 48271 + 17) % 2147483647) / 2147483647;
      position.set((u - 0.5) * width, 0.09, (v - 0.5) * length); rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), u * Math.PI); scale.setScalar(0.62 + v * 0.7);
      matrix.compose(position, rotation, scale); grass.current.setMatrixAt(i, matrix);
    }
    grass.current.instanceMatrix.needsUpdate = true;
  }, [width, length]);
  useFrame(state => { if (shader.current) shader.current.uniforms.uTime.value = state.clock.elapsedTime; });
  const stripeLines = Array.from({ length: 5 }, (_, i) => -40 + i * 20);
  return <group name="pbr-pitch-environment">
    <ambientLight intensity={0.85} />
    <directionalLight position={[24, 34, 16]} intensity={2.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={55} shadow-camera-bottom={-55} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[width, length, 128, 192]} /><meshStandardMaterial map={textures.map} normalMap={textures.normalMap} normalScale={new THREE.Vector2(0.45, 0.45)} displacementMap={textures.displacementMap} displacementScale={0.035} roughness={0.92} /></mesh>
    <instancedMesh ref={grass} args={[undefined, undefined, 3200]} castShadow receiveShadow frustumCulled={false}><planeGeometry args={[0.08, 0.34, 1, 2]} /><primitive object={material} attach="material" /></instancedMesh>
    {stripeLines.map(z => <mesh key={z} position={[0, 0.025, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[width, 0.32]} /><meshBasicMaterial color="#f7f2df" /></mesh>)}
    <mesh position={[0, 0.027, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[7.8, 8.1, 64]} /><meshBasicMaterial color="#f7f2df" /></mesh>
    {[-1, 1].map(side => <group key={side} position={[0, 0, side * length / 2]}>{[-5, 5].map(x => <mesh key={x} position={[x, 2, 0]} castShadow><cylinderGeometry args={[0.14, 0.18, 4, 12]} /><meshStandardMaterial color="#f7f2df" roughness={0.62} /></mesh>)}</group>)}
  </group>;
}

