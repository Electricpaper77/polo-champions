import type { Input } from "./InputManager";
import { getGait, type Gait } from "./HorseControls";
import { initializeMatchEntities, type PoloRiderEntity } from "./GameState";

export type NetworkVector = { x: number; z: number };
export type NetworkEntityState = { id: PoloRiderEntity["id"]; position: NetworkVector; velocity: NetworkVector; heading: number; gait: Gait };
export type NetworkBallState = { position: NetworkVector; velocity: NetworkVector; y: number };
export type NetworkSnapshot = { tick: number; serverTime: number; ackSequence: number; entities: NetworkEntityState[]; ball: NetworkBallState };
export type InputCommand = { sequence: number; clientTime: number; input: Pick<Input,"throttle"|"steer"|"gallop"|"brake"|"strike"|"power"|"backhand"|"aimX"> };

export type CompressedSnapshot = [number, number, Array<[PoloRiderEntity["id"],number,number,number,number,number,Gait]>, [number,number,number,number,number], number];

export function createInitialNetworkSnapshot(serverTime = 0): NetworkSnapshot {
  const entities = Object.values(initializeMatchEntities()).map(entity => ({ id:entity.id, position:{x:entity.position.x,z:entity.position.y}, velocity:{x:entity.velocity.x,z:entity.velocity.y}, heading:entity.heading, gait:"IDLE" as Gait }));
  return { tick:0, serverTime, ackSequence:0, entities, ball:{position:{x:0,z:0},velocity:{x:0,z:0},y:.65} };
}

export function compressSnapshot(snapshot: NetworkSnapshot): CompressedSnapshot {
  return [snapshot.tick,snapshot.serverTime,snapshot.entities.map(entity=>[entity.id,entity.position.x,entity.position.z,entity.velocity.x,entity.velocity.z,entity.heading,entity.gait]),[snapshot.ball.position.x,snapshot.ball.position.z,snapshot.ball.velocity.x,snapshot.ball.velocity.z,snapshot.ball.y],snapshot.ackSequence];
}

export function decompressSnapshot(value: CompressedSnapshot): NetworkSnapshot {
  const [tick,serverTime,entities,ball,ackSequence]=value;
  return {tick,serverTime,ackSequence,entities:entities.map(([id,x,z,vx,vz,heading,gait])=>({id,position:{x,z},velocity:{x:vx,z:vz},heading,gait})),ball:{position:{x:ball[0],z:ball[1]},velocity:{x:ball[2],z:ball[3]},y:ball[4]}};
}

export function predictLocalEntity(entity: NetworkEntityState, command: InputCommand, delta = 1/60): NetworkEntityState {
  const turnRate = 1.8 * (1-Math.min(Math.hypot(entity.velocity.x,entity.velocity.z)/32,.58));
  const heading = entity.heading + command.input.steer*turnRate*delta;
  const currentSpeed=Math.hypot(entity.velocity.x,entity.velocity.z),target=command.input.brake?0:command.input.throttle*(command.input.gallop?30:18),maxChange=(target>currentSpeed?15:22)*delta,speed=currentSpeed+Math.max(-maxChange,Math.min(maxChange,target-currentSpeed));
  const velocity={x:Math.sin(heading)*speed,z:Math.cos(heading)*speed};
  return {...entity,heading,velocity,position:{x:entity.position.x+velocity.x*delta,z:entity.position.z+velocity.z*delta},gait:getGait(Math.abs(speed))};
}

function lerpAngle(a:number,b:number,t:number){const delta=Math.atan2(Math.sin(b-a),Math.cos(b-a));return a+delta*t}
function interpolateEntity(a:NetworkEntityState,b:NetworkEntityState,t:number):NetworkEntityState{return {...b,position:{x:a.position.x+(b.position.x-a.position.x)*t,z:a.position.z+(b.position.z-a.position.z)*t},velocity:{x:a.velocity.x+(b.velocity.x-a.velocity.x)*t,z:a.velocity.z+(b.velocity.z-a.velocity.z)*t},heading:lerpAngle(a.heading,b.heading,t)}}

export class SnapshotBuffer {
  private snapshots:NetworkSnapshot[]=[];
  constructor(private readonly maxSnapshots=32){}
  push(snapshot:NetworkSnapshot){if(this.snapshots.some(value=>value.tick===snapshot.tick))return;this.snapshots.push(snapshot);this.snapshots.sort((a,b)=>a.serverTime-b.serverTime);if(this.snapshots.length>this.maxSnapshots)this.snapshots.splice(0,this.snapshots.length-this.maxSnapshots)}
  sample(renderTime:number):NetworkSnapshot|null{
    if(!this.snapshots.length)return null;
    const afterIndex=this.snapshots.findIndex(snapshot=>snapshot.serverTime>=renderTime);
    if(afterIndex<=0)return this.snapshots[afterIndex===-1?this.snapshots.length-1:0];
    const before=this.snapshots[afterIndex-1],after=this.snapshots[afterIndex],span=Math.max(1,after.serverTime-before.serverTime),t=Math.max(0,Math.min(1,(renderTime-before.serverTime)/span)),beforeById=new Map(before.entities.map(entity=>[entity.id,entity]));
    return {...after,serverTime:renderTime,entities:after.entities.map(entity=>{const start=beforeById.get(entity.id);return start?interpolateEntity(start,entity,t):entity}),ball:{position:{x:before.ball.position.x+(after.ball.position.x-before.ball.position.x)*t,z:before.ball.position.z+(after.ball.position.z-before.ball.position.z)*t},velocity:{x:before.ball.velocity.x+(after.ball.velocity.x-before.ball.velocity.x)*t,z:before.ball.velocity.z+(after.ball.velocity.z-before.ball.velocity.z)*t},y:before.ball.y+(after.ball.y-before.ball.y)*t}};
  }
  clear(){this.snapshots=[]}
}

export function reconcileLocalEntity(predicted:NetworkEntityState,authoritative:NetworkEntityState,delta=1/60):NetworkEntityState{
  const distance=Math.hypot(predicted.position.x-authoritative.position.x,predicted.position.z-authoritative.position.z);
  if(distance<.02)return predicted;
  const correction=distance>5?1:1-Math.exp(-9*delta);
  return interpolateEntity(predicted,authoritative,correction);
}

export class PredictionController{
  private pending:InputCommand[]=[];
  constructor(private state:NetworkEntityState){}
  apply(command:InputCommand,delta=1/60){this.pending.push(command);this.state=predictLocalEntity(this.state,command,delta);return this.state}
  reconcile(authoritative:NetworkEntityState,ackSequence:number,delta=1/60){this.pending=this.pending.filter(command=>command.sequence>ackSequence);this.state=reconcileLocalEntity(this.state,authoritative,delta);for(const command of this.pending)this.state=predictLocalEntity(this.state,command,delta);return this.state}
  current(){return this.state}
  pendingCount(){return this.pending.length}
}
