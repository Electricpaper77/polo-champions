export const NORMAL_RIDE_SPEED = 16;
export const GALLOP_SPEED = 24;
export const BRAKE_SPEED = 0;

export type HorseMotionInput = {
  throttle: number;
  gallop: boolean;
  brake: boolean;
};

export function getTargetSpeed({ throttle, gallop, brake }: HorseMotionInput) {
  if (brake) return BRAKE_SPEED;
  if (throttle > 0) return gallop ? GALLOP_SPEED : NORMAL_RIDE_SPEED;
  return throttle * NORMAL_RIDE_SPEED;
}
export function advanceHorseSpeed(current:number,input:HorseMotionInput,dt:number,responsiveness=1){const target=getTargetSpeed(input),accelerating=Math.abs(target)>Math.abs(current),rate=(accelerating?2.8:4.6)*responsiveness;return current+(target-current)*(1-Math.exp(-rate*Math.min(dt,.05)));}
export function steeringForSpeed(speed:number){return Math.max(.28,1-Math.abs(speed)/34);}
