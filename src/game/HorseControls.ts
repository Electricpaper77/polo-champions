export const NORMAL_RIDE_SPEED = 12;
export const MAX_GALLOP_SPEED = 18;
export const GALLOP_SPEED = MAX_GALLOP_SPEED;
export const BRAKE_SPEED = 0;
export const ACCELERATION_TAU = 1.5;
export const COAST_TAU = 1.0;
export const BRAKE_TAU = 0.45;
export const GALLOP_GAIT_THRESHOLD = MAX_GALLOP_SPEED * .75;
export const GALLOP_STAMINA_DRAIN = 0.24;
export const STAMINA_RECOVERY = 0.12;
export const HORSE_ACCELERATION = 8;
export const TURF_DRAG = 4;
export const TURN_BASE_RATE = Math.PI;
export const DEV_GOD_MAX_SPEED = 45;
export const DEV_GOD_ACCELERATION = 100;
export const DEV_GOD_DRAG = 0;

export type Gait = "IDLE" | "WALK" | "TROT" | "CANTER" | "GALLOP";
export type RiderPose = { torsoPitch: number; hipPitch: number; seatHeight: number; strideCadence: number };
export type HorseArchetype = "SPRINTER" | "ALL_ROUNDER" | "POWER";
/** Shared handling configuration.  Visual coat/kit choices never modify these values. */
export type HorseArchetypeConfig = { acceleration: number; topSpeed: number; agility: number; mass: number; pushResistance: number; staminaDrain: number };
export type HorseCoat = "BAY" | "DARK_BAY" | "CHESTNUT" | "LIGHT_GRAY";
/** Material-ready British polo coat values. Presentation only. */
export const HORSE_COATS: Record<HorseCoat, { body: string; mane: string }> = {
  BAY: { body: "#6c4327", mane: "#21150f" },
  DARK_BAY: { body: "#2d201b", mane: "#100b09" },
  CHESTNUT: { body: "#9a4926", mane: "#4b2113" },
  LIGHT_GRAY: { body: "#b9b5aa", mane: "#4b4944" },
};
export type TeamPresentation = { jersey: string; helmet: string; saddlePad: string; poloWrap: string; crest: string; trousers: string };
export const TEAM_PRESENTATION: Record<"blue" | "red", TeamPresentation> = {
  blue: { jersey: "#0f2d5e", helmet: "#10254a", saddlePad: "#163d7a", poloWrap: "#2c67c9", crest: "#d8aa4a", trousers: "#eee7d5" },
  red: { jersey: "#a92727", helmet: "#7f1c20", saddlePad: "#8f2529", poloWrap: "#bd3c39", crest: "#f5e9cf", trousers: "#eee7d5" },
};
export function getArchetypeCoat(archetype: HorseArchetype): HorseCoat { return archetype === "SPRINTER" ? "CHESTNUT" : archetype === "POWER" ? "DARK_BAY" : "BAY"; }
export const HORSE_ARCHETYPES: Record<HorseArchetype, HorseArchetypeConfig> = {
  SPRINTER: { acceleration: 1.2, topSpeed: 1.2, agility: 1.15, mass: .85, pushResistance: .84, staminaDrain: 1.1 },
  ALL_ROUNDER: { acceleration: 1, topSpeed: 1, agility: 1, mass: 1, pushResistance: 1, staminaDrain: 1 },
  POWER: { acceleration: .9, topSpeed: .9, agility: .85, mass: 1.3, pushResistance: 1.18, staminaDrain: .85 },
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
const godMode = () => typeof window !== "undefined" && window.DEV_GOD_MODE === true;

export function exponentialAlpha(dt: number, tau: number) {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-dt / Math.max(tau, Number.EPSILON));
}

export function steeringRate(speed: number, agility = 1) {
  const speedRatio = clamp(Math.abs(speed) / MAX_GALLOP_SPEED, 0, 1);
  const turnPenalty = clamp(1 - speedRatio * .7, .3, 1);
  return TURN_BASE_RATE * turnPenalty * agility;
}

export function getTargetSpeed({ throttle, gallop, brake }: HorseMotionInput, archetype: HorseArchetype = "ALL_ROUNDER") {
  if (godMode()) return brake ? 0 : throttle * DEV_GOD_MAX_SPEED;
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
  const devGodMode = godMode();
  const maxSpeed = devGodMode ? DEV_GOD_MAX_SPEED : (input.gallop ? MAX_GALLOP_SPEED : NORMAL_RIDE_SPEED) * config.topSpeed;
  let heading = state.heading;
  let forward = { x: Math.sin(heading), z: Math.cos(heading) };
  let velocity = { x: state.velocity.x, z: state.velocity.z };
  const inputMove = input.brake ? 0 : clamp(input.throttle, -1, 1);

  if (inputMove > 0) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const acceleration = (devGodMode ? DEV_GOD_ACCELERATION : HORSE_ACCELERATION * config.acceleration) * (1 - Math.pow(clamp(speed / Math.max(maxSpeed, .01), 0, 1), 1.5));
    velocity.x += forward.x * acceleration * inputMove * safeDelta;
    velocity.z += forward.z * acceleration * inputMove * safeDelta;
  } else if (inputMove < 0) {
    velocity.x += forward.x * (devGodMode ? -DEV_GOD_ACCELERATION : HORSE_ACCELERATION * inputMove * .65) * safeDelta;
    velocity.z += forward.z * (devGodMode ? -DEV_GOD_ACCELERATION : HORSE_ACCELERATION * inputMove * .65) * safeDelta;
  }

  let speed = Math.hypot(velocity.x, velocity.z);
  const speedLimit = inputMove < 0 && !input.brake ? Math.min(4, maxSpeed) : maxSpeed;
  if (speed > speedLimit) {
    const scale = speedLimit / speed;
    velocity = { x: velocity.x * scale, z: velocity.z * scale };
    speed = speedLimit;
  }

  if (speed > 0 && !devGodMode) {
    const activeFriction = inputMove > 0 ? TURF_DRAG * .08 : TURF_DRAG;
    const drop = speed * activeFriction * safeDelta;
    const newSpeed = Math.max(speed - drop, 0);
    velocity = speed > 0 ? { x: velocity.x / speed * newSpeed, z: velocity.z / speed * newSpeed } : { x: 0, z: 0 };
    speed = newSpeed;
  }

  if (Math.abs(input.steer) > 0 && speed > .1) {
    const signedForwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
    const direction = Math.abs(signedForwardSpeed) > .05 ? Math.sign(signedForwardSpeed) : inputMove < 0 ? -1 : 1;
    const turnAngle = clamp(input.steer, -1, 1) * steeringRate(speed, config.agility) * direction * safeDelta;
    heading += turnAngle;
    forward = { x: Math.sin(heading), z: Math.cos(heading) };
    velocity = { x: forward.x * speed * direction, z: forward.z * speed * direction };
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

export function getDynamicBank(speed: number, yawRate: number) { return clamp(-speed * yawRate * .12, -.35, .35); }

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
