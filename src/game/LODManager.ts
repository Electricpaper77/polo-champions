import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

export const LOD_DISTANCE = 40;
export function isLowTierDevice(){return typeof navigator!=="undefined"&&(navigator.hardwareConcurrency!==undefined&&navigator.hardwareConcurrency<=4||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));}
/** Uses THREE.LOD as the authoritative distance threshold while React swaps render detail. */
export function useAvatarLod(root:React.RefObject<THREE.Group|null>){const {camera}=useThree(),lod=useMemo(()=>{const value=new THREE.LOD();value.addLevel(new THREE.Group(),0);value.addLevel(new THREE.Group(),LOD_DISTANCE);return value},[]),[low,setLow]=useState(false);useFrame(()=>{lod.position.copy(root.current?.position??new THREE.Vector3());lod.update(camera);const next=camera.position.distanceTo(lod.position)>LOD_DISTANCE;if(next!==low)setLow(next)});return low;}
/** Demand mode render driver used only on lower-capability devices. */
export function RenderThrottle({enabled}:{enabled:boolean}){const {invalidate}=useThree();useEffect(()=>{if(!enabled)return;const timer=window.setInterval(invalidate,1000/30);return()=>window.clearInterval(timer)},[enabled,invalidate]);return null;}
