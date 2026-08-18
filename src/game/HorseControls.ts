export const NORMAL_RIDE_SPEED = 16;
export const MAX_GALLOP_SPEED = 18.05;
export const GALLOP_SPEED = MAX_GALLOP_SPEED;
export const BRAKE_SPEED = 0;
export const ACCELERATION_TAU = 1.5;
export const COAST_TAU = 1.0;
export const BRAKE_TAU = 0.45;
export const GALLOP_GAIT_THRESHOLD = MAX_GALLOP_SPEED * .75;
export const GALLOP_STAMINA_DRAIN = 0.24;
export const STAMINA_RECOVERY = 0.12;

export type Gait = "IDLE" | "WALK" | "TROT" | "CANTER" | "GALLOP";
export type RiderPose = { torsoPitch: number; hipPitch: number; seatHeight: number; strideCadence: number };
export type HorseArchetype = "SPRINTER" | "ALL_ROUNDER" | "POWER";
export type HorseArchetypeConfig = { acceleration: number; topSpeed: number; agility: number; mass: number; staminaDrain: number };
export type HorseCoat = "BAY" | "DARK_BAY" | "CHESTNUT" | "LIGHT_GRAY";
export const HORSE_COATS: Record<HorseCoat, string> = { BAY: "#6c4327", DARK_BAY: "#2d201b", CHESTNUT: "#9a4926", LIGHT_GRAY: "#b9b5aa" };
export function getArchetypeCoat(archetype: HorseArchetype): HorseCoat { return archetype === "SPRINTER" ? "CHESTNUT" : archetype === "POWER" ? "DARK_BAY" : "BAY"; }
export const HORSE_ARCHETYPES: Record<HorseArchetype, HorseArchetypeConfig> = {
  SPRINTER: { acceleration: 1.2, topSpeed: 1.2, agility: 1.15, mass: .85, staminaDrain: 1.1 },
  ALL_ROUNDER: { acceleration: 1, topSpeed: 1, agility: 1, mass: 1, staminaDrain: 1 },
  POWER: { acceleration: .9, topSpeed: .9, agility: .85, mass: 1.3, staminaDrain: .85 },
};
export function getHorseArchetype(archetype: HorseArchetype = "ALL_ROUNDER") { return HORSE_ARCHETYPES[archetype]; }

export type HorseMotionInput = {
  throttle: number;
  gallop: boolean;
  brake: boolean;
};

export type HorseMotionVector = { x: number; z: number };
export type HorseMotionState = { position: HorseMotionVector; velocity: HorseMotionVector; heading: number };

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export function exponentialAlpha(dt: number, tau: number) {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / Math.max(tau, Number.EPSILON));
}

export function steeringRate(speed: number, agility = 1) {
  const ratio = clamp(Math.abs(speed) / MAX_GALLOP_SPEED, 0, 1);
  const penalty = ratio * ratio * (3 - 2 * ratio);
  return lerp(1.5, .55, penalty) * agility;
}

export function getTargetSpeed({ throttle, gallop, brake }: HorseMotionInput, archetype: HorseArchetype = "ALL_ROUNDER") {
  const config = getHorseArchetype(archetype);
  if (brake) return BRAKE_SPEED;
  const requested = throttle > 0
    ? throttle * (gallop ? MAX_GALLOP_SPEED : NORMAL_RIDE_SPEED) * config.topSpeed
    : throttle * NORMAL_RIDE_SPEED * config.topSpeed;
  return clamp(requested, -MAX_GALLOP_SPEED, MAX_GALLOP_SPEED);
}

export function getGait(speed: number): Gait {
  const magnitude = Math.abs(speed);
  if (magnitude < .2) return "IDLE";
  if (magnitude < 5) return "WALK";
  if (magnitude < 11) return "TROT";
  if (magnitude < GALLOP_GAIT_THRESHOLD) return "CANTER";
  return "GALLOP";
}

export function advanceStamina(stamina: number, galloping: boolean, dt: number, archetype: HorseArchetype = "ALL_ROUNDER") {
  const rate = galloping ? -GALLOP_STAMINA_DRAIN * getHorseArchetype(archetype).staminaDrain : STAMINA_RECOVERY;
  return Math.max(0, Math.min(1, stamina + rate * dt));
}

export function getRiderPose(gait: Gait, steer: number, braking: boolean): RiderPose {
  const base = gait === "GALLOP" ? -.34 : gait === "CANTER" ? -.2 : gait === "TROT" ? -.08 : 0;
  const rearward = braking ? .2 : 0;
  return {
    torsoPitch: base + rearward + steer * .12,
    hipPitch: base * .55 + rearward * .5 + steer * .08,
    seatHeight: gait === "GALLOP" ? .12 : gait === "CANTER" ? .07 : gait === "TROT" ? .035 : 0,
    strideCadence: gait === "IDLE" ? 0 : gait === "WALK" ? 1.2 : gait === "TROT" ? 2 : gait === "CANTER" ? 2.8 : 3.6,
  };
}

export function advanceHorseSpeed(speed: number, input: HorseMotionInput, dt: number, archetype: HorseArchetype = "ALL_ROUNDER") {
  const target = getTargetSpeed(input, archetype);
  const config = getHorseArchetype(archetype);
  const tau = input.brake
    ? BRAKE_TAU
    : Math.abs(target) > Math.abs(speed)
      ? ACCELERATION_TAU / config.acceleration
      : COAST_TAU;
  return clamp(lerp(speed, target, exponentialAlpha(dt, tau)), -MAX_GALLOP_SPEED, MAX_GALLOP_SPEED);
}

export function getSteeringRate(speed: number, archetype: HorseArchetype = "ALL_ROUNDER") {
  return steeringRate(speed, getHorseArchetype(archetype).agility);
}

export function integrateHorseMotion(state: HorseMotionState, input: HorseMotionInput & { steer: number }, dt: number, archetype: HorseArchetype = "ALL_ROUNDER"): HorseMotionState {
  const safeDelta = Math.max(0, dt);
  const config = getHorseArchetype(archetype);
  const currentSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const targetSpeed = getTargetSpeed(input, archetype);
  const currentForward = { x: Math.sin(state.heading), z: Math.cos(state.heading) };
  const signedForwardSpeed = state.velocity.x * currentForward.x + state.velocity.z * currentForward.z;
  const direction = Math.abs(signedForwardSpeed) > .05 ? Math.sign(signedForwardSpeed) : targetSpeed < 0 ? -1 : 1;
  const heading = state.heading + clamp(input.steer, -1, 1) * steeringRate(currentSpeed, config.agility) * direction * safeDelta;
  const desiredVelocity = { x: Math.sin(heading) * targetSpeed, z: Math.cos(heading) * targetSpeed };
  const tau = input.brake
    ? BRAKE_TAU
    : Math.abs(targetSpeed) > currentSpeed
      ? ACCELERATION_TAU / config.acceleration
      : COAST_TAU;
  const alpha = exponentialAlpha(safeDelta, tau);
  let velocity = {
    x: lerp(state.velocity.x, desiredVelocity.x, alpha),
    z: lerp(state.velocity.z, desiredVelocity.z, alpha),
  };
  const magnitude = Math.hypot(velocity.x, velocity.z);
  if (magnitude > MAX_GALLOP_SPEED) {
    const scale = MAX_GALLOP_SPEED / magnitude;
    velocity = { x: velocity.x * scale, z: velocity.z * scale };
  }
  return {
    heading,
    velocity,
    position: {
      x: state.position.x + velocity.x * safeDelta,
      z: state.position.z + velocity.z * safeDelta,
    },
  };
}

export function getBodyLean(steer: number, speed: number, archetype: HorseArchetype = "ALL_ROUNDER") {
  const config = getHorseArchetype(archetype);
  return -steer * Math.min(Math.abs(speed) / MAX_GALLOP_SPEED, 1) * .28 / config.mass;
}

export function getCameraOffset(yaw: number, speed: number, steer: number) {
  const speedRatio = Math.min(Math.abs(speed) / GALLOP_SPEED, 1);
  const distance = 11 + speedRatio * 3.5;
  const side = steer * (0.5 + speedRatio * 1.1);
  return {
    x: -Math.sin(yaw) * distance + Math.cos(yaw) * side,
    y: 6.5 + speedRatio * 1.5,
    z: -Math.cos(yaw) * distance - Math.sin(yaw) * side,
    lookAhead: 1.5 + speedRatio * 3.5,
  };
}
