import { create } from "zustand";
import type { Gait } from "./HorseControls";
import type { StrikePhase } from "./PoloMechanics";
export type Telemetry = { speed: number; stamina: number; gait: Gait; charge: number; strikePhase: StrikePhase; player: {x:number;z:number}; ball: {x:number;z:number} };
export type MatchState = { score: number; seconds: number; paused: boolean; message: string; resetKey: number; telemetry: Telemetry; scoreGoal: () => void; resetBall: () => void; togglePause: () => void; restart: () => void; setSeconds: (n:number) => void; setMessage: (s:string) => void; setTelemetry: (telemetry:Telemetry) => void };
const telemetry:Telemetry={speed:0,stamina:1,gait:"IDLE",charge:0,strikePhase:"READY",player:{x:0,z:18},ball:{x:0,z:0}};
export const useMatch = create<MatchState>((set) => ({ score: 0, seconds: 420, paused: false, message: "KICK OFF", resetKey: 0, telemetry, scoreGoal: () => set((s) => ({score:s.score+1, message:"GOAL!", resetKey:s.resetKey+1})), resetBall:()=>set(s=>({resetKey:s.resetKey+1,message:"BALL RESET"})), togglePause:()=>set(s=>({paused:!s.paused,message:!s.paused?"PAUSED":"PLAY"})), restart:()=>set(s=>({score:0,seconds:420,paused:false,message:"KICK OFF",resetKey:s.resetKey+1})), setSeconds:(seconds)=>set({seconds}), setMessage:(message)=>set({message}), setTelemetry:(telemetry)=>set({telemetry}) }));
