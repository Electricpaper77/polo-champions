import { GALLOP_SPEED } from "./HorseControls";

export const MIN_CAMERA_DISTANCE = 5;
export const MAX_CAMERA_DISTANCE = 20;
export const DEFAULT_CAMERA_DISTANCE = 11;
export const CAMERA_WHEEL_STEP = 1.25;

const clamp = (value:number, minimum:number, maximum:number) => Math.max(minimum, Math.min(maximum, value));

export function applyCameraWheel(distance:number, deltaY:number) {
  if (deltaY === 0) return clamp(distance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
  return clamp(distance + Math.sign(deltaY) * CAMERA_WHEEL_STEP, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
}

export function smoothCameraDistance(current:number, target:number, delta:number) {
  const blend = 1 - Math.exp(-Math.max(0, delta) * 8);
  return current + (clamp(target, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE) - current) * blend;
}

export function getAdvancedCameraOffset(yaw:number, speed:number, steer:number, distance:number, lookBack = false) {
  const speedRatio = Math.min(Math.abs(speed) / GALLOP_SPEED, 1);
  const cameraYaw = yaw + (lookBack ? Math.PI : 0);
  const side = steer * (0.5 + speedRatio * 1.1);
  return {
    x:-Math.sin(cameraYaw) * distance + Math.cos(cameraYaw) * side,
    y:6.5 + speedRatio * 1.5,
    z:-Math.cos(cameraYaw) * distance - Math.sin(cameraYaw) * side,
    lookAhead:(lookBack ? -1 : 1) * (1.5 + speedRatio * 3.5),
  };
}
