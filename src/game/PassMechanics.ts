export const PASS_RADIUS = 5;
export const PASS_POWER = 9;
export type LivePassRider = { id: "blue1" | "blue2" | "red1" | "red2"; x: number; y: number; z: number };
export function getPassTarget(active: "blue1" | "blue2", riders: LivePassRider[]) { const targetId = active === "blue1" ? "blue2" : "blue1"; return riders.find(rider => rider.id === targetId); }
export function canPass(rider: { x:number; z:number }, ball: { x:number; z:number }) { return Math.hypot(rider.x-ball.x, rider.z-ball.z) <= PASS_RADIUS; }
export function getPassDirection(ball: { x:number; y:number; z:number }, target: { x:number; y:number; z:number }) { const x=target.x-ball.x,y=target.y-ball.y,z=target.z-ball.z,length=Math.hypot(x,y,z); return length>0&&Number.isFinite(length)?{x:x/length,y:y/length,z:z/length}:{x:0,y:0,z:0}; }
