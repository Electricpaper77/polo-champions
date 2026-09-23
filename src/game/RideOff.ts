export type RideOffRider={id:string;team:"blue"|"red";x:number;z:number;heading:{x:number;z:number};speed:number};
export type RideOffResult={challengerId:string;targetId?:string;legal:boolean;reason:string;strength:number;push:{x:number;z:number}};
export const RIDE_OFF_RANGE=3.2;
export const RIDE_OFF_ALIGNMENT_THRESHOLD=.72;
export const RIDE_OFF_MAX_RELATIVE_SPEED=9;
export const RIDE_OFF_COOLDOWN_MS=900;
export const RIDE_OFF_BASE_STRENGTH=1.15;
export const RIDE_OFF_SPEED_STRENGTH=.06;
export type RideOffContactInput={challengerStrength:number;defenderBalance:number;challengerSpeed:number;defenderSpeed:number;alignment:number;sideBySide:number};
export type RideOffContactResult={contactScore:number;targetDisplacement:number;attackerResponse:number;defenderResponse:number;recoveryDuration:number};
export function resolveRideOffContact(input:RideOffContactInput):RideOffContactResult{
  const strength=.65+Math.max(0,Math.min(100,Number.isFinite(input.challengerStrength)?input.challengerStrength:0))/100;
  const resistance=.7+Math.max(0,Math.min(100,Number.isFinite(input.defenderBalance)?input.defenderBalance:0))/160;
  const speed=.75+Math.max(0,Math.min(8,Number.isFinite(input.challengerSpeed)?input.challengerSpeed:0))/32;
  const alignment=.75+Math.max(0,Math.min(1,(input.alignment-RIDE_OFF_ALIGNMENT_THRESHOLD)/(1-RIDE_OFF_ALIGNMENT_THRESHOLD)))*.25;
  const sideBySide=.72+Math.max(0,Math.min(1,Number.isFinite(input.sideBySide)?input.sideBySide:0))*.28;
  const defenderSpeed=Math.max(0,Math.min(8,Number.isFinite(input.defenderSpeed)?input.defenderSpeed:0));
  const contactScore=Math.max(.55,Math.min(1.65,strength*speed*alignment*sideBySide/resistance*(1-Math.min(.1,defenderSpeed*.012))));
  const targetDisplacement=Math.max(.45,Math.min(1.55,.3+contactScore*.62));
  return {contactScore,targetDisplacement,attackerResponse:Math.min(.34,targetDisplacement*.2),defenderResponse:Math.min(.28,targetDisplacement*.16),recoveryDuration:Math.max(.15,Math.min(.36,.14+contactScore*.12))};
}
const dot=(a:{x:number;z:number},b:{x:number;z:number})=>a.x*b.x+a.z*b.z;
const normalize=(v:{x:number;z:number})=>{const n=Math.hypot(v.x,v.z);return n?{x:v.x/n,z:v.z/n}:{x:0,z:0}};
export function findRideOffTarget(challenger:RideOffRider,riders:RideOffRider[],now:number,cooldowns:Record<string,number>){
  if((cooldowns[challenger.id]??0)>now)return {legal:false,reason:"cooldown"} as const;
  const candidates=riders.filter(r=>r.team!==challenger.team).map(target=>({target,...rideOff(challenger,target,now,cooldowns)})).filter(r=>r.legal).sort((a,b)=>Math.hypot(a.target.x-challenger.x,a.target.z-challenger.z)-Math.hypot(b.target.x-challenger.x,b.target.z-challenger.z));
  return candidates[0]??{legal:false,reason:"no legal opponent"} as const;
}
export function rideOff(challenger:RideOffRider,target:RideOffRider,now:number,cooldowns:Record<string,number>):Omit<RideOffResult,"challengerId"|"targetId">{
  if(challenger.team===target.team)return {legal:false,reason:"teammate",strength:0,push:{x:0,z:0}};
  if((cooldowns[challenger.id]??0)>now||(cooldowns[target.id]??0)>now)return {legal:false,reason:"cooldown",strength:0,push:{x:0,z:0}};
  const delta={x:target.x-challenger.x,z:target.z-challenger.z},distance=Math.hypot(delta.x,delta.z);if(distance>RIDE_OFF_RANGE)return {legal:false,reason:"range",strength:0,push:{x:0,z:0}};
  const a=normalize(challenger.heading),b=normalize(target.heading);if(dot(a,b)<RIDE_OFF_ALIGNMENT_THRESHOLD)return {legal:false,reason:"head-on",strength:0,push:{x:0,z:0}};
  if(Math.abs(dot(normalize(delta),a))>.55)return {legal:false,reason:"not side-by-side",strength:0,push:{x:0,z:0}};
  if(Math.abs(challenger.speed-target.speed)>RIDE_OFF_MAX_RELATIVE_SPEED)return {legal:false,reason:"relative speed",strength:0,push:{x:0,z:0}};
  const side=normalize({x:-a.z,z:a.x}),sign=dot(delta,side)>=0?1:-1,strength=RIDE_OFF_BASE_STRENGTH+Math.min(8,Math.max(0,challenger.speed))*RIDE_OFF_SPEED_STRENGTH;
  return {legal:true,reason:"legal",strength,push:{x:side.x*sign*strength,z:side.z*sign*strength}};
}
