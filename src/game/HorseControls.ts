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
