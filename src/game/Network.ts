import type { NetworkEntityState } from "./NetworkSync";

/** Explicit 30 Hz wire representation for rider transforms. */
export type RiderTransform = { position: [number, number, number]; rotationY: number; velocity: [number, number, number] };

export function serializeRiderTransform(entity: NetworkEntityState): RiderTransform {
  return { position:[entity.position.x, 0, entity.position.z], rotationY:entity.heading, velocity:[entity.velocity.x, 0, entity.velocity.z] };
}

export function lerpRiderTransform(from: RiderTransform, to: RiderTransform, alpha: number): RiderTransform {
  const t = Math.max(0, Math.min(1, alpha));
  return {
    position:from.position.map((value, index) => value + (to.position[index] - value) * t) as RiderTransform["position"],
    rotationY:from.rotationY + Math.atan2(Math.sin(to.rotationY - from.rotationY), Math.cos(to.rotationY - from.rotationY)) * t,
    velocity:from.velocity.map((value, index) => value + (to.velocity[index] - value) * t) as RiderTransform["velocity"],
  };
}
