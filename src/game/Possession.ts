export type RiderId="blue1"|"blue2"|"red1"|"red2";
export type Possession={kind:"loose"}|{kind:"blue";riderId:"blue1"|"blue2"}|{kind:"red";riderId:"red1"|"red2"};
export type TacticalState="ATTACK"|"SUPPORT"|"DEFEND"|"RECOVER"|"LOOSE_BALL";
export const POSSESSION_RADIUS=3.5;
export const POSSESSION_RELEASE_RADIUS=5.5;
export function loosePossession():Possession{return {kind:"loose"}}
export function possessionForRider(id:RiderId):Possession{return id.startsWith("blue")?{kind:"blue",riderId:id as "blue1"|"blue2"}:{kind:"red",riderId:id as "red1"|"red2"}}
export function deriveTeamModes(possession:Possession){return possession.kind==="loose"?{blue:"loose",red:"loose"}:{blue:possession.kind==="blue"?"attack":"defend",red:possession.kind==="red"?"attack":"defend"}}
export function deriveTacticalStates(possession:Possession):Record<RiderId,TacticalState>{const ids:[RiderId,RiderId,RiderId,RiderId]=["blue1","blue2","red1","red2"];return Object.fromEntries(ids.map(id=>{if(possession.kind==="loose")return[id,"LOOSE_BALL"];const own=id.startsWith(possession.kind),carrier=possession.riderId===id;return[id,own?(carrier?"ATTACK":"SUPPORT"):(id.endsWith("1")?"DEFEND":"RECOVER")] })) as Record<RiderId,TacticalState>}
export function acquirePossession(riders:Array<{id:RiderId;x:number;z:number}>,ball:{x:number;z:number}):Possession{const nearest=riders.map(r=>({r,d:Math.hypot(r.x-ball.x,r.z-ball.z)})).sort((a,b)=>a.d-b.d)[0];return nearest&&nearest.d<=POSSESSION_RADIUS?possessionForRider(nearest.r.id):loosePossession()}
export function updatePossession(current:Possession,riders:Array<{id:RiderId;x:number;z:number}>,ball:{x:number;z:number}):Possession{const next=acquirePossession(riders,ball);if(next.kind!=="loose"&&next.kind!==current.kind)return next;if(current.kind==="loose")return next;const holder=riders.find(r=>r.id===current.riderId);return holder&&Math.hypot(holder.x-ball.x,holder.z-ball.z)<=POSSESSION_RELEASE_RADIUS?current:next}
