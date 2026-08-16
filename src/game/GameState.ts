import { create } from "zustand";
import { getHorseArchetype, type Gait, type HorseArchetype } from "./HorseControls";
import type { StrikePhase } from "./PoloMechanics";

type MatchPosition = { x: number; y: number };
export interface PoloRiderEntity { id: "player" | "blue_2" | "red_1" | "red_2"; team: "blue" | "red"; role: "striker" | "defender"; archetype: HorseArchetype; position: MatchPosition; velocity: MatchPosition; heading: number; stamina: number; mass: number; }
export type ActiveFoul = { type: "LOB_CROSSING" | null; timestamp: number } | null;
export type Telemetry = { speed: number; stamina: number; gait: Gait; charge: number; strikePhase: StrikePhase; player: {x:number;z:number}; ball: {x:number;z:number} };
export function initializeMatchEntities(): Record<PoloRiderEntity["id"], PoloRiderEntity> {
  const rider = (id:PoloRiderEntity["id"],team:PoloRiderEntity["team"],role:PoloRiderEntity["role"],archetype:HorseArchetype,position:MatchPosition,heading:number):PoloRiderEntity => ({ id,team,role,archetype,position,velocity:{x:0,y:0},heading,stamina:1,mass:getHorseArchetype(archetype).mass });
  return { player:rider("player","blue","striker","ALL_ROUNDER",{x:0,y:18},Math.PI), blue_2:rider("blue_2","blue","defender","POWER",{x:-8,y:12},Math.PI), red_1:rider("red_1","red","striker","SPRINTER",{x:0,y:-18},0), red_2:rider("red_2","red","defender","ALL_ROUNDER",{x:8,y:-12},0) };
}
export type MatchState = { score:number; seconds:number; paused:boolean; message:string; activeFoul:ActiveFoul; resetKey:number; entities:Record<PoloRiderEntity["id"],PoloRiderEntity>; telemetry:Telemetry; scoreGoal:()=>void; resetBall:()=>void; togglePause:()=>void; restart:()=>void; setSeconds:(n:number)=>void; setMessage:(s:string)=>void; setActiveFoul:(foul:ActiveFoul)=>void; setEntities:(entities:Record<PoloRiderEntity["id"],PoloRiderEntity>)=>void; setTelemetry:(telemetry:Telemetry)=>void };
const telemetry:Telemetry={speed:0,stamina:1,gait:"IDLE",charge:0,strikePhase:"READY",player:{x:0,z:18},ball:{x:0,z:0}};
export const useMatch = create<MatchState>((set) => ({ score:0, seconds:420, paused:false, message:"KICK OFF", activeFoul:null, resetKey:0, entities:initializeMatchEntities(), telemetry, scoreGoal:()=>set(s=>({score:s.score+1,message:"GOAL!",activeFoul:null,resetKey:s.resetKey+1})), resetBall:()=>set(s=>({resetKey:s.resetKey+1,message:"BALL RESET",activeFoul:null})), togglePause:()=>set(s=>({paused:!s.paused,message:!s.paused?"PAUSED":"PLAY"})), restart:()=>set(s=>({score:0,seconds:420,paused:false,message:"KICK OFF",activeFoul:null,entities:initializeMatchEntities(),resetKey:s.resetKey+1})), setSeconds:(seconds)=>set({seconds}),setMessage:(message)=>set({message}),setActiveFoul:(activeFoul)=>set({activeFoul}),setEntities:(entities)=>set({entities}),setTelemetry:(telemetry)=>set({telemetry}) }));
