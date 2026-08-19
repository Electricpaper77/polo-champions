export const BALL_START = { x: 0, y: 0.65, z: 0 };
export type StrikePhase = "WIND_UP" | "CONTACT" | "FOLLOW_THROUGH" | "RECOVERY" | "READY";
export const STRIKE_CONTACT_START = .10;
export const STRIKE_CONTACT_END = .17;
export const STRIKE_RECOVERY_END = .48;
export const BASE_BALL_IMPULSE = 14;
export const MIN_SWING_POWER = .5;
export const MAX_SWING_POWER = 2;
export const BALL_FIELD_DRAG = 0.35;
export const BALL_SURFACE_FRICTION = 0.15;
export const BALL_STOP_SPEED = .08;
export const MALLET_CONTACT_RADIUS = 1.05;

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
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export function getSwingPowerMultiplier(charge: number) {
  return lerp(MIN_SWING_POWER, MAX_SWING_POWER, clamp(charge, 0, 1));
}

export function getShotImpulse({ aimX, aimY = 0, yaw, backhand, charge, speed, horseVelocity }: ShotInput) {
  const localX = clamp(aimX, -1, 1) * .7;
  const magnitude = Math.hypot(localX, 1);
  const direction = {
    x: (localX * Math.cos(yaw) + Math.sin(yaw)) / magnitude,
    z: (-localX * Math.sin(yaw) + Math.cos(yaw)) / magnitude,
  };
  if (backhand) {
    direction.x *= -1;
    direction.z *= -1;
  }
  const forwardVelocity = horseVelocity ?? { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed };
  const normalizedCharge = clamp(charge, 0, 1);
  const powerMultiplier = getSwingPowerMultiplier(normalizedCharge);
  const power = BASE_BALL_IMPULSE * powerMultiplier;
  const loft = Math.max(.5, .65 + normalizedCharge * 4.35 + clamp(aimY, -1, 1));
  return {
    x: forwardVelocity.x + direction.x * power,
    y: (forwardVelocity.y ?? 0) + loft,
    z: forwardVelocity.z + direction.z * power,
    power,
    powerMultiplier,
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

function pointSegmentDistance(point: { x: number; z: number }, start: { x: number; z: number }, end: { x: number; z: number }) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared > 0 ? clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount));
}

export function isBallInMalletSweep(input: MalletSweepInput) {
  if (input.currentElapsed < STRIKE_CONTACT_START || input.previousElapsed > STRIKE_CONTACT_END) return false;
  const from = getStrikeContactProgress(input.previousElapsed);
  const to = getStrikeContactProgress(input.currentElapsed);
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) * 8));
  let previous = getMalletHeadPosition({ ...input, contactProgress: from });
  for (let step = 1; step <= steps; step += 1) {
    const current = getMalletHeadPosition({ ...input, contactProgress: lerp(from, to, step / steps) });
    if (pointSegmentDistance(input.ballPosition, previous, current) <= MALLET_CONTACT_RADIUS) return true;
    previous = current;
  }
  return pointSegmentDistance(input.ballPosition, previous, previous) <= MALLET_CONTACT_RADIUS;
}

export function applyBallFieldDrag(velocity: { x: number; z: number }, dt: number) {
  const attenuation = Math.exp(-BALL_FIELD_DRAG * Math.max(0, dt));
  const next = { x: velocity.x * attenuation, z: velocity.z * attenuation };
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






























































































































































































