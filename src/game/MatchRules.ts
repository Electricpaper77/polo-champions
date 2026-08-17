import { getHorseArchetype, type HorseArchetype } from "./HorseControls";
import type { MatchTeam, PoloRiderEntity } from "./GameState";

export type Team = "BLUE" | "RED";
export type Role = "ATTACKER" | "PIVOT";
export type Vec = { x: number; z: number };
export type Bot = { id:string; team:Team; role:Role; archetype:HorseArchetype; position:Vec; facing:Vec };
export type BotState = "APPROACH_BALL" | "CHARGE_SWING" | "RIDE_OFF_INTERCEPT" | "ZONE_DEFEND";

export const MIN_RIDER_SEPARATION = 2.6;
export const BOT_MAX_SPEED = 7;
export const BOT_SUPPORT_SPEED = 4.2;
export const BOT_ACCELERATION = 8;
export const BOT_TURN_RATE = 1.55;
export const BALL_IN_PLAY_SPEED = 0.45;
export const BALL_IN_PLAY_DISTANCE = 1.2;

const dot = (a:Vec,b:Vec) => a.x*b.x+a.z*b.z;
const sub = (a:Vec,b:Vec) => ({x:a.x-b.x,z:a.z-b.z});
const length = (a:Vec) => Math.hypot(a.x,a.z);
const norm = (a:Vec) => { const magnitude=length(a)||1; return{x:a.x/magnitude,z:a.z/magnitude}; };
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(max,value));
const wrapAngle = (angle:number) => Math.atan2(Math.sin(angle),Math.cos(angle));

export function create2v2():Bot[]{return[{id:"blue-1",team:"BLUE",role:"ATTACKER",archetype:"SPRINTER",position:{x:-4,z:12},facing:{x:0,z:-1}},{id:"blue-2",team:"BLUE",role:"PIVOT",archetype:"POWER",position:{x:4,z:16},facing:{x:0,z:-1}},{id:"red-1",team:"RED",role:"ATTACKER",archetype:"SPRINTER",position:{x:4,z:-12},facing:{x:0,z:1}},{id:"red-2",team:"RED",role:"PIVOT",archetype:"POWER",position:{x:-4,z:-16},facing:{x:0,z:1}}]}
export function decideBot(bot:Bot,ball:Vec,opponent?:Bot):BotState{const toBall=sub(ball,bot.position);if(opponent&&length(sub(opponent.position,bot.position))<3&&Math.abs(dot(norm(toBall),norm(sub(opponent.position,bot.position))))>.7)return"RIDE_OFF_INTERCEPT";if(bot.role==="PIVOT"&&Math.abs(bot.position.z)>18)return"ZONE_DEFEND";return length(toBall)<4&&dot(norm(toBall),bot.facing)>.65?"CHARGE_SWING":"APPROACH_BALL"}
export function legalRideOff(a:Bot,b:Bot){return Math.acos(clamp(dot(norm(a.facing),norm(b.facing)),-1,1))<=Math.PI/4}
export function rideOffImpulse(a:Bot,b:Bot){return legalRideOff(a,b)?Math.max(0,getHorseArchetype(a.archetype).mass-getHorseArchetype(b.archetype).mass+.25):0}
export function applyRideOffDisplacement(a:Bot,b:Bot,dt=1){const dx=a.position.x-b.position.x,dz=a.position.z-b.position.z,distance=Math.hypot(dx,dz)||1,normal={x:dx/distance,z:dz/distance},aPush=rideOffImpulse(a,b),bPush=rideOffImpulse(b,a);return {a:{x:a.position.x+normal.x*bPush*dt,z:a.position.z+normal.z*bPush*dt},b:{x:b.position.x-normal.x*aPush*dt,z:b.position.z-normal.z*aPush*dt}}}
export function isLineOfBallFoul(ball:Vec,line:Vec,rider:Vec,pursuer:Team,riderTeam:Team){return riderTeam!==pursuer&&dot(sub(rider,ball),norm(line))>0&&Math.abs(line.x*(rider.z-ball.z)-line.z*(rider.x-ball.x))<2}
export function goalResult(position:Vec){return Math.abs(position.z)>42&&Math.abs(position.x)<5?{scored:true,reset:{x:0,z:0}}:{scored:false,reset:null}}

export function isBallInPlay(ball:Vec, velocity:Vec): boolean {
  return length(ball) >= BALL_IN_PLAY_DISTANCE || length(velocity) >= BALL_IN_PLAY_SPEED;
}

export function selectBallChasers(riders:PoloRiderEntity[], ball:Vec): Partial<Record<MatchTeam,PoloRiderEntity["id"]>> {
  const select = (team:MatchTeam) => riders
    .filter(rider => rider.team === team && rider.role === "striker" && rider.id !== "player")
    .sort((a,b) => length(sub({x:a.position.x,z:a.position.y},ball))-length(sub({x:b.position.x,z:b.position.y},ball)) || a.id.localeCompare(b.id))[0]?.id;
  return { blue:select("blue"), red:select("red") };
}

export function getBotTacticalTarget(rider:PoloRiderEntity, ball:Vec, chasers:Partial<Record<MatchTeam,PoloRiderEntity["id"]>>, ballInPlay:boolean):Vec {
  if (!ballInPlay) return {x:rider.homePosition.x,z:rider.homePosition.y};
  if (chasers[rider.team] === rider.id) return ball;
  const shiftScale = rider.role === "defender" ? .16 : .24;
  return {
    x: rider.homePosition.x + clamp(ball.x*shiftScale,-4,4),
    z: rider.homePosition.y + clamp(ball.z*shiftScale,-5,5),
  };
}

export function advanceBotRider(rider:PoloRiderEntity, target:Vec, chaser:boolean, dt:number):PoloRiderEntity {
  const dx=target.x-rider.position.x,dz=target.z-rider.position.y,distance=Math.hypot(dx,dz);
  const desiredHeading=distance>.01?Math.atan2(dx,dz):rider.heading;
  const headingDelta=clamp(wrapAngle(desiredHeading-rider.heading),-BOT_TURN_RATE*dt,BOT_TURN_RATE*dt);
  const heading=wrapAngle(rider.heading+headingDelta);
  const currentSpeed=Math.hypot(rider.velocity.x,rider.velocity.y);
  const maximum=(chaser?BOT_MAX_SPEED:BOT_SUPPORT_SPEED)*getHorseArchetype(rider.archetype).topSpeed;
  const desiredSpeed=distance<.35?0:Math.min(maximum,distance*1.25);
  const speed=currentSpeed+clamp(desiredSpeed-currentSpeed,-BOT_ACCELERATION*dt,BOT_ACCELERATION*dt);
  const velocity=Math.abs(speed)<.0001?{x:0,y:0}:{x:Math.sin(heading)*speed,y:Math.cos(heading)*speed};
  return {...rider,heading,velocity,position:{x:rider.position.x+velocity.x*dt,y:rider.position.y+velocity.y*dt}};
}

export function resolveRiderSeparation(a:PoloRiderEntity,b:PoloRiderEntity,minimum=MIN_RIDER_SEPARATION):{a:Vec;b:Vec;corrected:boolean} {
  const dx=a.position.x-b.position.x,dz=a.position.y-b.position.y,distance=Math.hypot(dx,dz);
  if (distance>=minimum) return {a:{x:a.position.x,z:a.position.y},b:{x:b.position.x,z:b.position.y},corrected:false};
  const normal=distance>.0001?{x:dx/distance,z:dz/distance}:{x:a.id.localeCompare(b.id)<=0?-1:1,z:0};
  const overlap=minimum-distance,totalMass=Math.max(.01,a.mass+b.mass);
  const aShare=b.mass/totalMass,bShare=a.mass/totalMass;
  return {
    a:{x:a.position.x+normal.x*overlap*aShare,z:a.position.y+normal.z*overlap*aShare},
    b:{x:b.position.x-normal.x*overlap*bShare,z:b.position.y-normal.z*overlap*bShare},
    corrected:true,
  };
}

export function getBotShotImpulse(rider:PoloRiderEntity, ball:Vec):{x:number;y:number;z:number} {
  const target={x:0,z:rider.team==="blue"?-43:43},direction=norm(sub(target,ball));
  const momentum=Math.min(Math.hypot(rider.velocity.x,rider.velocity.y)*.45,4);
  const power=11+momentum;
  return {x:direction.x*power,y:1.4,z:direction.z*power};
}

export function calculateFormationMetrics(riders:PoloRiderEntity[]) {
  let minimumSeparation=Number.POSITIVE_INFINITY;
  for(let first=0;first<riders.length;first+=1) for(let second=first+1;second<riders.length;second+=1) {
    minimumSeparation=Math.min(minimumSeparation,Math.hypot(riders[first].position.x-riders[second].position.x,riders[first].position.y-riders[second].position.y));
  }
  const centroid=(team:MatchTeam)=>{const members=riders.filter(rider=>rider.team===team);return members.reduce((sum,rider)=>sum+rider.position.y,0)/members.length;};
  return {riderCount:riders.length,pairChecks:riders.length*(riders.length-1)/2,minimumSeparation,blueCentroidZ:centroid("blue"),redCentroidZ:centroid("red")};
}

export function scoringTeam(position:Vec):MatchTeam|null {
  if (!goalResult(position).scored) return null;
  return position.z<0?"blue":"red";
}
