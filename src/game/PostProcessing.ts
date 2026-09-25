import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SAOPass } from "three/examples/jsm/postprocessing/SAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import * as THREE from "three";
import { useMatch } from "./GameState";

const speedLineShader = {
  uniforms: { tDiffuse:{ value:null }, intensity:{ value:0 }, resolution:{ value:new THREE.Vector2(1, 1) } },
  vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
  fragmentShader:"uniform sampler2D tDiffuse; uniform float intensity; varying vec2 vUv; void main(){ vec2 d=(vUv-0.5)*intensity*.018; vec3 c=texture2D(tDiffuse,vUv).rgb*.55+texture2D(tDiffuse,vUv+d).rgb*.3+texture2D(tDiffuse,vUv+d*2.0).rgb*.15; gl_FragColor=vec4(c,1.0); }",
};

/** Subtle bloom/AO plus speed-only screen streaking; no new package required. */
export function PostProcessing() {
  const { gl, scene, camera, size } = useThree();
  const speed = useMatch(state => state.telemetry.speed);
  const { composer, speedPass } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new SAOPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), .18, .3, .82));
    const speedPass = new ShaderPass(speedLineShader);
    composer.addPass(speedPass);
    return { composer, speedPass };
  }, [gl, scene, camera]);
  useEffect(() => { composer.setSize(size.width, size.height); }, [composer, size]);
  useFrame((_, delta) => { speedPass.uniforms.intensity.value = Math.max(0, Math.min(1, (speed - 12) / 20)); composer.render(delta); }, 1);
  useEffect(() => () => composer.dispose(), [composer]);
  return null;
}
