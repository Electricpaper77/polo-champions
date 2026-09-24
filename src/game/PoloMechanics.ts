export const BALL_START = { x: 0, y: 0.15, z: 0 };
export const BALL_MIN_Y = .06;
export type StrikePhase = "WIND_UP" | "CONTACT" | "FOLLOW_THROUGH" | "RECOVERY" | "READY";
export const STRIKE_CONTACT_START = .10;
export const STRIKE_CONTACT_END = .17;
export const STRIKE_RECOVERY_END = .48;
export const BASE_BALL_IMPULSE = 14;
export const MIN_SWING_POWER = .5;
export const MAX_SWING_POWER = 2;
/** Turf damping is intentionally strong enough to settle a loose ball without killing a strike. */
export const BALL_FIELD_DRAG = 0.85;
export const BALL_SURFACE_FRICTION = 0.15;
export const BALL_BOUNCE_ELASTICITY = 0.42;
export const BALL_STOP_SPEED = .08;
export const BALL_ROLLING_RESISTANCE = 3.2;
export const BALL_AIR_DRAG = .015;
export const MALLET_HEAD_RADIUS = .09;
export const BALL_RADIUS = .42;
export const MALLET_CONTACT_RADIUS = MALLET_HEAD_RADIUS + BALL_RADIUS;

export function getStrikePhase(elapsed: number, charging: boolean): StrikePhase {
  if (charging) return "WIND_UP";
  if (elapsed < 0) return "READY";
  if (elapsed < STRIKE_CONTACT_START) return "WIND_UP";
  if (elapsed < STRIKE_CONTACT_END) return "CONTACT";
  if (elapsed < .32) return "FOLLOW_THROUGH";
  if (elapsed < STRIKE_RECOVERY_END) return "RECOVERY";
  return "READY";
}

export function isStrikeContact(phase: StrikePhase) { return phase === "CONTACT"; }
export function canApplyStrike(phase: StrikePhase, alreadyApplied: boolean) {
  return isStrikeContact(phase) && !alreadyApplied;
}

export type ShotInput = {
  aimX: number;
  aimY?: number;
  yaw: number;
  backhand: boolean;
  charge: number;
  speed: number;
  horseVelocity?: { x: number; y?: number; z: number };
  swingTangent?: { x: number; z: number };
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export function getSwingPowerMultiplier(charge: number) {
  return lerp(MIN_SWING_POWER, MAX_SWING_POWER, clamp(charge, 0, 1));
}

export function getShotImpulse({ aimX, aimY = 0, yaw, backhand, charge, speed, horseVelocity, swingTangent }: ShotInput) {
  const localX = clamp(aimX, -1, 1) * .7;
  const magnitude = Math.hypot(localX, 1);
  let direction = {
    x: (localX * Math.cos(yaw) + Math.sin(yaw)) / magnitude,
    z: (-localX * Math.sin(yaw) + Math.cos(yaw)) / magnitude,
  };
  if (backhand) {
    direction.x *= -1;
    direction.z *= -1;
  }
  if (swingTangent && Math.hypot(swingTangent.x, swingTangent.z) > .0001) {
    const length = Math.hypot(swingTangent.x, swingTangent.z);
    direction = { x: swingTangent.x / length, z: swingTangent.z / length };
  }
  const forwardVelocity = horseVelocity ?? { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed };
  const normalizedCharge = clamp(charge, 0, 1);
  const powerMultiplier = getSwingPowerMultiplier(normalizedCharge);
  const horseSpeedBonus = clamp(Math.abs(speed), 0, 18) * .22;
  const power = BASE_BALL_IMPULSE * powerMultiplier + horseSpeedBonus;
  const loft = Math.max(.5, .65 + normalizedCharge * 4.35 + clamp(aimY, -1, 1));
  return {
    x: forwardVelocity.x + direction.x * power,
    y: (forwardVelocity.y ?? 0) + loft,
    z: forwardVelocity.z + direction.z * power,
    power,
    powerMultiplier,
    horseSpeedBonus,
  };
}

export type MalletSweepInput = {
  riderPosition: { x: number; z: number };
  ballPosition: { x: number; z: number };
  yaw: number;
  aimX: number;
  backhand: boolean;
  previousElapsed: number;
  currentElapsed: number;
};

export function getStrikeContactProgress(elapsed: number) {
  return clamp((elapsed - STRIKE_CONTACT_START) / (STRIKE_CONTACT_END - STRIKE_CONTACT_START), 0, 1);
}

export function getMalletHeadPosition({ riderPosition, yaw, aimX, backhand, contactProgress }: Omit<MalletSweepInput, "ballPosition" | "previousElapsed" | "currentElapsed"> & { contactProgress: number }) {
  const progress = clamp(contactProgress, 0, 1);
  const aimedYaw = yaw + clamp(aimX, -1, 1) * .38;
  const forward = { x: Math.sin(aimedYaw), z: Math.cos(aimedYaw) };
  const right = { x: Math.cos(aimedYaw), z: -Math.sin(aimedYaw) };
  const side = backhand ? -1 : 1;
  const localForward = lerp(-.4, 3.7, progress);
  const localSide = side * (2.05 - Math.sin(Math.PI * progress) * 1.15);
  return {
    x: riderPosition.x + forward.x * localForward + right.x * localSide,
    z: riderPosition.z + forward.z * localForward + right.z * localSide,
  };
}

export function pointSegmentDistance(point: { x: number; z: number }, start: { x: number; z: number }, end: { x: number; z: number }) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared > 0 ? clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount));
}

export function getMalletSweepContact(input: MalletSweepInput): { hit: boolean; tangent: { x: number; z: number } } {
  if (input.currentElapsed < STRIKE_CONTACT_START || input.previousElapsed > STRIKE_CONTACT_END) return { hit: false, tangent: { x: 0, z: 0 } };
  const previous = getMalletHeadPosition({ ...input, contactProgress: getStrikeContactProgress(input.previousElapsed) });
  const current = getMalletHeadPosition({ ...input, contactProgress: getStrikeContactProgress(input.currentElapsed) });
  const tangent = { x: current.x - previous.x, z: current.z - previous.z };
  return { hit: pointSegmentDistance(input.ballPosition, previous, current) <= MALLET_CONTACT_RADIUS, tangent };
}

export function isBallInMalletSweep(input: MalletSweepInput) {
  return getMalletSweepContact(input).hit;
}

export function applyBallFieldDrag(velocity: { x: number; z: number }, dt: number) {
  const safeDt = Math.max(0, dt), speed = Math.hypot(velocity.x, velocity.z);
  if (speed === 0) return { x: 0, z: 0 };
  const deceleration = BALL_ROLLING_RESISTANCE + BALL_AIR_DRAG * speed * speed;
  const nextSpeed = Math.max(0, speed - deceleration * safeDt) * Math.exp(-BALL_FIELD_DRAG * safeDt);
  const next = { x: velocity.x / speed * nextSpeed, z: velocity.z / speed * nextSpeed };
  return Math.hypot(next.x, next.z) < BALL_STOP_SPEED ? { x: 0, z: 0 } : next;
}

export function getMalletAngle(angle: number, holding: boolean, released: boolean, dt: number) {
  if (released) return 0.9;
  const target = holding ? -0.72 : 0;
  const step = Math.min(1, dt * (holding ? 9 : 12));
  return angle + (target - angle) * step;
}

export type GoalState = { armed: boolean };
export const INITIAL_GOAL_STATE: GoalState = { armed: true };

export function isGoalPosition({ x, z }: { x: number; z: number }) {
  return Math.abs(z) > 42 && Math.abs(x) < 5;
}

export function transitionGoal(state: GoalState, position: { x: number; z: number }) {
  if (!isGoalPosition(position)) return { state: INITIAL_GOAL_STATE, scored: false, resetBall: false };
  if (!state.armed) return { state, scored: false, resetBall: false };
  return { state: { armed: false }, scored: true, resetBall: true };
}

export function getBallResetState() {
  return { position: { ...BALL_START }, velocity: { x: 0, y: 0, z: 0 } };
}
































































































































































































































































