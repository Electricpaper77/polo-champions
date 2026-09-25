import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { track } from "../services/Analytics";
export function PerformanceMonitor({onLowPerformance}:{onLowPerformance:()=>void}){const lowFor=useRef(0),reported=useRef(false);useFrame((_,delta)=>{const fps=1/Math.max(delta,.001);lowFor.current=fps<25?lowFor.current+delta:0;if(lowFor.current>=10&&!reported.current){reported.current=true;track("Low_Performance_Detected",{fps:Math.round(fps)});onLowPerformance()}});return null;}
