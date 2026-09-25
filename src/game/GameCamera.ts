import { GALLOP_SPEED } from "./HorseControls";
import { getDynamicCameraFov } from "./Camera";

export function trackingLerpAlpha(delta: number, speed: number) {
  return 1 - Math.exp(-Math.max(0, delta) * (7.5 + Math.min(Math.abs(speed) / GALLOP_SPEED, 1) * 3));
}

export function getTrackingFov(aspect: number, speed: number) {
  return getDynamicCameraFov(aspect, speed);
}
