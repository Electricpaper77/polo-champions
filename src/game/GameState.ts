import { create } from "zustand";
import { getHorseArchetype, type Gait, type HorseArchetype } from "./HorseControls";
import type { StrikePhase } from "./PoloMechanics";
import { EconomyManager, kitColors, type HorseCoat } from "../services/Economy";

export type MatchPosition = { x: number; y: number };
export type MatchTeam = "blue" | "red";
export type MatchScore = Record<MatchTeam, number>;
export const GOAL_CELEBRATION_MS = 1800;
export interface PoloRiderEntity { id: "player" | "blue_2" | "blue_3" | "blue_4" | "blue_5" | "blue_6" | "red_1" | "red_2" | "red_3" | "red_4" | "red_5" | "red_6"; team: MatchTeam; role: "striker" | "defender"; archetype: HorseArchetype; homePosition: MatchPosition; position: MatchPosition; velocity: MatchPosition; heading: number; stamina: number; mass: number; coat:HorseCoat;kitColor:string;mallet:string; }
export type ActiveFoul = { type: "LOB_CROSSING" | null; timestamp: number } | null;
export type Telemetry = { speed: number; stamina: number; gait: Gait; charge: number; strikePhase: StrikePhase; player: {x:number;z:number}; ball: {x:number;z:number} };
export function initializeMatchEntities(): Record<PoloRiderEntity["id"], PoloRiderEntity> {
  const loadout=EconomyManager.get().loadout,rider = (id:PoloRiderEntity["id"],team:PoloRiderEntity["team"],role:PoloRiderEntity["role"],archetype:HorseArchetype,position:MatchPosition,heading:number):PoloRiderEntity => ({ id,team,role,archetype,homePosition:{...position},position:{...position},velocity:{x:0,y:0},heading,stamina:1,mass:getHorseArchetype(archetype).mass,coat:team==="blue"?"Bay":"Chestnut",kitColor:team==="blue"?kitColors["Royal Navy"]:kitColors.Oxblood,mallet:"Standard Club Mallet" });
  return { player:{...rider("player","blue","striker","ALL_ROUNDER",{x:0,y:28},Math.PI),coat:loadout.coat,kitColor:kitColors[loadout.kit],mallet:loadout.mallet}, blue_2:rider("blue_2","blue","striker","SPRINTER",{x:-13,y:22},Math.PI), blue_3:rider("blue_3","blue","striker","ALL_ROUNDER",{x:13,y:22},Math.PI), blue_4:rider("blue_4","blue","defender","POWER",{x:0,y:15},Math.PI), blue_5:rider("blue_5","blue","striker","SPRINTER",{x:-14,y:10},Math.PI), blue_6:rider("blue_6","blue","defender","POWER",{x:14,y:10},Math.PI), red_1:rider("red_1","red","striker","SPRINTER",{x:0,y:-28},0), red_2:rider("red_2","red","striker","ALL_ROUNDER",{x:13,y:-22},0), red_3:rider("red_3","red","striker","SPRINTER",{x:-13,y:-22},0), red_4:rider("red_4","red","defender","POWER",{x:0,y:-15},0), red_5:rider("red_5","red","striker","ALL_ROUNDER",{x:14,y:-10},0), red_6:rider("red_6","red","defender","POWER",{x:-14,y:-10},0) };
}
export type MatchState = { score:MatchScore; seconds:number; started:boolean; paused:boolean; message:string; celebratingGoal:MatchTeam|null; activeFoul:ActiveFoul; resetKey:number; entities:Record<PoloRiderEntity["id"],PoloRiderEntity>; telemetry:Telemetry; scoreGoal:(team:MatchTeam,authoritativeScore?:MatchScore)=>void; completeGoalCelebration:()=>void; resetBall:()=>void; togglePause:()=>void; restart:()=>void; setStarted:(started:boolean)=>void; setSeconds:(n:number)=>void; setMessage:(s:string)=>void; setActiveFoul:(foul:ActiveFoul)=>void; setEntities:(entities:Record<PoloRiderEntity["id"],PoloRiderEntity>)=>void; setTelemetry:(telemetry:Telemetry)=>void };
const telemetry:Telemetry={speed:0,stamina:1,gait:"IDLE",charge:0,strikePhase:"READY",player:{x:0,z:28},ball:{x:0,z:0}};
export const useMatch = create<MatchState>((set) => ({
  score:{blue:0,red:0}, seconds:420, started:false, paused:false, message:"KICK OFF · MOVE TO START", celebratingGoal:null, activeFoul:null, resetKey:0, entities:initializeMatchEntities(), telemetry,
  scoreGoal:(team,authoritativeScore)=>set(s=>({score:authoritativeScore??{...s.score,[team]:s.score[team]+1},started:false,celebratingGoal:team,message:`${team.toUpperCase()} GOAL!`,activeFoul:null})),
  completeGoalCelebration:()=>set(s=>s.celebratingGoal?({celebratingGoal:null,started:false,message:"KICK OFF · MOVE TO START",entities:initializeMatchEntities(),telemetry,resetKey:s.resetKey+1}):s),
  resetBall:()=>set(s=>({started:false,celebratingGoal:null,resetKey:s.resetKey+1,message:"BALL RESET · MOVE TO START",activeFoul:null,entities:initializeMatchEntities(),telemetry})),
  togglePause:()=>set(s=>({paused:!s.paused,message:!s.paused?"PAUSED":s.started?"PLAY":"KICK OFF · MOVE TO START"})),
  restart:()=>set(s=>({score:{blue:0,red:0},seconds:420,started:false,paused:false,message:"KICK OFF · MOVE TO START",celebratingGoal:null,activeFoul:null,entities:initializeMatchEntities(),telemetry,resetKey:s.resetKey+1})),
  setStarted:(started)=>set({started}), setSeconds:(seconds)=>set({seconds}),setMessage:(message)=>set({message}),setActiveFoul:(activeFoul)=>set({activeFoul}),setEntities:(entities)=>set({entities}),setTelemetry:(telemetry)=>set({telemetry})
}));
