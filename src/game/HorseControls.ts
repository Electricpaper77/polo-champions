export const NORMAL_RIDE_SPEED = 16;
export const GALLOP_SPEED = 24;
export const BRAKE_SPEED = 0;
export const RIDE_ACCELERATION = 21;
export const GALLOP_ACCELERATION = 27;
export const COAST_DECELERATION = 11;
export const BRAKE_DECELERATION = 42;
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

export function getTargetSpeed({ throttle, gallop, brake }: HorseMotionInput, archetype: HorseArchetype = "ALL_ROUNDER") {
  const config = getHorseArchetype(archetype);
  if (brake) return BRAKE_SPEED;
  if (throttle > 0) return (gallop ? GALLOP_SPEED : NORMAL_RIDE_SPEED) * config.topSpeed;
  return throttle * NORMAL_RIDE_SPEED * config.topSpeed;
}

export function getGait(speed: number): Gait {
  const magnitude = Math.abs(speed);
  if (magnitude < .2) return "IDLE";
  if (magnitude < 5) return "WALK";
  if (magnitude < 11) return "TROT";
  if (magnitude < 18) return "CANTER";
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
  const rate = input.brake
    ? BRAKE_DECELERATION
    : Math.abs(target) > Math.abs(speed)
      ? (input.gallop ? GALLOP_ACCELERATION : RIDE_ACCELERATION) * config.acceleration
      : COAST_DECELERATION;
  const difference = target - speed;
  const step = Math.sign(difference) * Math.min(Math.abs(difference), rate * dt);
  return speed + step;
}

export function getSteeringRate(speed: number, archetype: HorseArchetype = "ALL_ROUNDER") {
  const config = getHorseArchetype(archetype);
  const speedRatio = Math.min(Math.abs(speed) / (GALLOP_SPEED * config.topSpeed), 1);
  return (1.45 - speedRatio * 0.65) * config.agility;
}

export function getBodyLean(steer: number, speed: number, archetype: HorseArchetype = "ALL_ROUNDER") {
  const config = getHorseArchetype(archetype);
  return -steer * Math.min(Math.abs(speed) / (GALLOP_SPEED * config.topSpeed), 1) * .28 / config.mass;
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
