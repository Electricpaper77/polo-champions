import { getHorseArchetype, integrateHorseMotion, type HorseArchetype } from "./HorseControls";
import type { MatchTeam, PoloRiderEntity } from "./GameState";
import { getShotImpulse } from "./PoloMechanics";

export type Team = "BLUE" | "RED";
export type Role = "ATTACKER" | "PIVOT";
export type Vec = { x: number; z: number };
export type Bot = { id:string; team:Team; role:Role; archetype:HorseArchetype; position:Vec; facing:Vec };
export type BotState = "APPROACH_BALL" | "CHARGE_SWING" | "RIDE_OFF_INTERCEPT" | "ZONE_DEFEND";
export type AITacticalRole = "BALL_ATTACKER" | "OFFENSE_SUPPORT" | "DEFENDER";
export type AIRoleAssignments = Partial<Record<PoloRiderEntity["id"], AITacticalRole>>;

export const MIN_RIDER_SEPARATION = 2.6;
export const BOT_MAX_SPEED = 7;
export const BOT_SUPPORT_SPEED = 4.2;
export const BOT_ACCELERATION = 8;
export const BOT_TURN_RATE = 1.55;
export const BALL_IN_PLAY_SPEED = 0.45;
export const BALL_IN_PLAY_DISTANCE = 1.2;
export const GOAL_LINE_Z = 42;
export const GOAL_HALF_WIDTH = 5;
export const RIDE_OFF_ACTIVE_MULTIPLIER = 1.45;
export const MAX_RIDE_OFF_DEFLECTION = 5;

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
export function goalResult(position:Vec){return Math.abs(position.z)>GOAL_LINE_Z&&Math.abs(position.x)<GOAL_HALF_WIDTH?{scored:true,reset:{x:0,z:0}}:{scored:false,reset:null}}

export function detectGoalCrossing(previous:Vec, current:Vec):MatchTeam|null {
  const dz=current.z-previous.z;
  if(Math.abs(dz)<Number.EPSILON)return null;
  const crossing=(line:number)=>{
    const amount=(line-previous.z)/dz;
    if(amount<0||amount>1)return null;
    return previous.x+(current.x-previous.x)*amount;
  };
  if(previous.z>=-GOAL_LINE_Z&&current.z<-GOAL_LINE_Z){const x=crossing(-GOAL_LINE_Z);if(x!==null&&Math.abs(x)<GOAL_HALF_WIDTH)return"blue";}
  if(previous.z<=GOAL_LINE_Z&&current.z>GOAL_LINE_Z){const x=crossing(GOAL_LINE_Z);if(x!==null&&Math.abs(x)<GOAL_HALF_WIDTH)return"red";}
  return null;
}

export function isBallInPlay(ball:Vec, velocity:Vec): boolean {
  return length(ball) >= BALL_IN_PLAY_DISTANCE || length(velocity) >= BALL_IN_PLAY_SPEED;
}

export function selectBallChasers(riders:PoloRiderEntity[], ball:Vec): Partial<Record<MatchTeam,PoloRiderEntity["id"]>> {
  const roles=assignAITacticalRoles(riders,ball);
  const select=(team:MatchTeam)=>riders.find(rider=>rider.team===team&&roles[rider.id]==="BALL_ATTACKER")?.id;
  return {blue:select("blue"),red:select("red")};
}

export function assignAITacticalRoles(riders:PoloRiderEntity[], ball:Vec):AIRoleAssignments {
  const assignments:AIRoleAssignments={};
  for(const team of ["blue","red"] as const){
    const teamRiders=riders.filter(rider=>rider.team===team&&rider.id!=="player");
    const attackers=teamRiders.filter(rider=>rider.role==="striker").sort((a,b)=>length(sub({x:a.position.x,z:a.position.y},ball))-length(sub({x:b.position.x,z:b.position.y},ball))||a.id.localeCompare(b.id));
    if(attackers[0])assignments[attackers[0].id]="BALL_ATTACKER";
    for(const rider of teamRiders){
      if(assignments[rider.id])continue;
      assignments[rider.id]=rider.role==="defender"?"DEFENDER":"OFFENSE_SUPPORT";
    }
  }
  return assignments;
}

export function getBotTacticalTarget(rider:PoloRiderEntity, ball:Vec, chasers:Partial<Record<MatchTeam,PoloRiderEntity["id"]>>, ballInPlay:boolean, assignedRole?:AITacticalRole):Vec {
  if (!ballInPlay) return {x:rider.homePosition.x,z:rider.homePosition.y};
  const role=assignedRole??(chasers[rider.team]===rider.id?"BALL_ATTACKER":rider.role==="defender"?"DEFENDER":"OFFENSE_SUPPORT");
  if(role==="BALL_ATTACKER")return ball;
  if(role==="OFFENSE_SUPPORT"){
    const attackDirection=rider.team==="blue"?-1:1;
    const lane=rider.homePosition.x<0?-5:5;
    return{x:clamp(ball.x+lane,-20,20),z:clamp(ball.z-attackDirection*7,-35,35)};
  }
  const ownGoalZ=rider.team==="blue"?38:-38;
  return{x:clamp(rider.homePosition.x*.65+ball.x*.35,-20,20),z:clamp(ownGoalZ+(ball.z-ownGoalZ)*.28,-37,37)};
}

export function getBotMotionInput(rider:PoloRiderEntity,target:Vec,assignedRole:AITacticalRole){
  const dx=target.x-rider.position.x,dz=target.z-rider.position.y,distance=Math.hypot(dx,dz);
  const desiredHeading=distance>.01?Math.atan2(dx,dz):rider.heading;
  const throttle=distance<.35?0:assignedRole==="BALL_ATTACKER" ? .78 : assignedRole==="OFFENSE_SUPPORT" ? .4 : .34;
  return{throttle,steer:clamp(wrapAngle(desiredHeading-rider.heading)/.65,-1,1),gallop:assignedRole==="BALL_ATTACKER"&&distance>5,brake:distance<.65};
}

export function advanceBotRider(rider:PoloRiderEntity, target:Vec, chaser:boolean, dt:number, assignedRole?:AITacticalRole):PoloRiderEntity {
  const role=assignedRole??(chaser?"BALL_ATTACKER":rider.role==="defender"?"DEFENDER":"OFFENSE_SUPPORT");
  const motion=integrateHorseMotion(
    {position:{x:rider.position.x,z:rider.position.y},velocity:{x:rider.velocity.x,z:rider.velocity.y},heading:rider.heading},
    getBotMotionInput(rider,target,role),
    dt,
    rider.archetype,
  );
  return {...rider,heading:motion.heading,velocity:{x:motion.velocity.x,y:motion.velocity.z},position:{x:motion.position.x,y:motion.position.z}};
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

export type RideOffCollisionOptions={dt?:number;aRideOff?:boolean;bRideOff?:boolean;minimum?:number};
export type RideOffCollisionResult={a:{position:Vec;velocity:Vec};b:{position:Vec;velocity:Vec};corrected:boolean;impulse:number;winnerId:PoloRiderEntity["id"]|null};

export function resolveRideOffCollision(a:PoloRiderEntity,b:PoloRiderEntity,options:RideOffCollisionOptions={}):RideOffCollisionResult {
  const minimum=options.minimum??MIN_RIDER_SEPARATION,dt=Math.max(0,options.dt??1/60);
  const dx=a.position.x-b.position.x,dz=a.position.y-b.position.y,distance=Math.hypot(dx,dz);
  const unchanged={
    a:{position:{x:a.position.x,z:a.position.y},velocity:{x:a.velocity.x,z:a.velocity.y}},
    b:{position:{x:b.position.x,z:b.position.y},velocity:{x:b.velocity.x,z:b.velocity.y}},
    corrected:false,impulse:0,winnerId:null,
  } satisfies RideOffCollisionResult;
  if(distance>=minimum)return unchanged;
  const normal=distance>.0001?{x:dx/distance,z:dz/distance}:{x:a.id.localeCompare(b.id)<=0?-1:1,z:0};
  const separation=resolveRiderSeparation(a,b,minimum),totalMass=Math.max(.01,a.mass+b.mass);
  const aSpeed=length({x:a.velocity.x,z:a.velocity.y}),bSpeed=length({x:b.velocity.x,z:b.velocity.y});
  const aMomentum=a.mass*aSpeed*(options.aRideOff?RIDE_OFF_ACTIVE_MULTIPLIER:1);
  const bMomentum=b.mass*bSpeed*(options.bRideOff?RIDE_OFF_ACTIVE_MULTIPLIER:1);
  const relativeVelocity={x:a.velocity.x-b.velocity.x,z:a.velocity.y-b.velocity.y};
  const closingSpeed=Math.max(0,-dot(relativeVelocity,normal));
  const advantage=aMomentum-bMomentum;
  const impulse=clamp(Math.abs(advantage)/totalMass*.42+closingSpeed*.5,0,MAX_RIDE_OFF_DEFLECTION);
  if(impulse<.0001)return{...unchanged,a:{...unchanged.a,position:separation.a},b:{...unchanged.b,position:separation.b},corrected:true};
  const aWins=advantage>0||(Math.abs(advantage)<.0001&&a.id.localeCompare(b.id)<0);
  const aShare=b.mass/totalMass,bShare=a.mass/totalMass;
  const aDeflection=impulse*(aWins ? .22 : 1)*aShare,bDeflection=impulse*(aWins ? 1 : .22)*bShare;
  const aVelocity={x:a.velocity.x+normal.x*aDeflection,z:a.velocity.y+normal.z*aDeflection};
  const bVelocity={x:b.velocity.x-normal.x*bDeflection,z:b.velocity.y-normal.z*bDeflection};
  return{
    a:{position:{x:separation.a.x+normal.x*aDeflection*dt,z:separation.a.z+normal.z*aDeflection*dt},velocity:aVelocity},
    b:{position:{x:separation.b.x-normal.x*bDeflection*dt,z:separation.b.z-normal.z*bDeflection*dt},velocity:bVelocity},
    corrected:true,impulse,winnerId:aWins?a.id:b.id,
  };
}

export function getBotShotImpulse(rider:PoloRiderEntity, ball:Vec):{x:number;y:number;z:number} {
  const target={x:0,z:rider.team==="blue"?-43:43},direction=norm(sub(target,ball));
  const speed=Math.hypot(rider.velocity.x,rider.velocity.y),yaw=Math.atan2(direction.x,direction.z);
  return getShotImpulse({aimX:0,aimY:-.25,yaw,backhand:false,charge:.55,speed,horseVelocity:{x:rider.velocity.x,y:0,z:rider.velocity.y}});
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
