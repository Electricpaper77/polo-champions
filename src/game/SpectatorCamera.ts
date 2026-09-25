import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Input } from "./InputManager";
export function SpectatorCamera({input}:{input:React.RefObject<Input>}){useFrame((state,delta)=>{const value=input.current,speed=18*delta;state.camera.position.add(new THREE.Vector3(value.steer*speed,value.quickPass?speed:value.callPass?-speed:0,-value.throttle*speed));state.camera.rotation.y-=value.aimX*delta*.9;state.camera.rotation.x=THREE.MathUtils.clamp(state.camera.rotation.x-value.aimY*delta*.7,-1.3,1.3)});return null;}
