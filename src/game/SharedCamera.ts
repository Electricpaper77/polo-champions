export type CameraPoint={x:number;y:number;z:number}; export const MIN_DISTANCE=12,NORMAL_DISTANCE=16,MAX_DISTANCE=28,SEPARATION_FACTOR=.42;
const valid=(p?:CameraPoint)=>!!p&&[p.x,p.y,p.z].every(Number.isFinite);
export function sharedCamera(p1:CameraPoint,ball:CameraPoint,p2?:CameraPoint){const second:CameraPoint=valid(p2)?p2!:p1;const mid={x:(p1.x+second.x)/2,y:(p1.y+second.y)/2,z:(p1.z+second.z)/2};const separation=Math.hypot(p1.x-second.x,p1.z-second.z);return {focus:{x:mid.x*.4+ball.x*.6,y:mid.y*.4+ball.y*.6,z:mid.z*.4+ball.z*.6},distance:Math.max(MIN_DISTANCE,Math.min(MAX_DISTANCE,NORMAL_DISTANCE+separation*SEPARATION_FACTOR))};}
export const damp=(current:number,target:number,rate:number,dt:number)=>current+(target-current)*(1-Math.exp(-rate*dt));
