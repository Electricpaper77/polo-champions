export const BALL_START = { x: 0, y: 0.65, z: 0 };

export type ShotInput = {
  aimX: number;
  yaw: number;
  backhand: boolean;
  charge: number;
  speed: number;
  kind?: StrikeKind;
};

export type StrikeKind = "tap" | "normal" | "full";
export type BallVelocity = { x: number; y: number; z: number };
export const BALL_MAX_HORIZONTAL_SPEED = 34;
export const BALL_MAX_VERTICAL_SPEED = 8;
export const BALL_GROUND_ROLL_DAMPING = 0.72;

export function getStrikeBasePower(kind: StrikeKind) {
  return kind === "tap" ? 9 : kind === "full" ? 24 : 15;
}
export function getStrikeKind(charge: number): StrikeKind {
  return Math.max(0, Math.min(1, Number.isFinite(charge) ? charge : 0)) >= 0.75 ? "full" : "normal";
}
export function getStrikePower(kind: StrikeKind, charge: number, speed: number) {
  const safeCharge = Math.max(0, Math.min(1, Number.isFinite(charge) ? charge : 0));
  const chargeMultiplier = kind === "tap" ? 1 : 0.82 + safeCharge * 0.18;
  const momentum = Math.min(24, Math.max(0, Math.abs(Number.isFinite(speed) ? speed : 0))) * 0.28;
  return getStrikeBasePower(kind) * chargeMultiplier + momentum;
}
export function clampBallVelocity({ x, y, z }: BallVelocity): BallVelocity {
  const safeX = Number.isFinite(x) ? x : 0, safeY = Number.isFinite(y) ? y : 0, safeZ = Number.isFinite(z) ? z : 0;
  const horizontal = Math.hypot(safeX, safeZ);
  const horizontalScale = horizontal > BALL_MAX_HORIZONTAL_SPEED ? BALL_MAX_HORIZONTAL_SPEED / horizontal : 1;
  return { x: safeX * horizontalScale, y: Math.max(-BALL_MAX_VERTICAL_SPEED, Math.min(BALL_MAX_VERTICAL_SPEED, safeY)), z: safeZ * horizontalScale };
}
export function dampGroundRollSpeed(speed: number, dt: number) {
  return Math.max(0, Number.isFinite(speed) ? speed : 0) * Math.exp(-BALL_GROUND_ROLL_DAMPING * Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.05));
}

export function getTapImpulse(direction: { x: number; y: number; z: number }, speed: number) {
  const power = getStrikePower("tap", 0, speed);
  return { x: direction.x * power, y: Math.max(0.2, direction.y * power + 0.3), z: direction.z * power, power };
}

export function getShotImpulse(input: ShotInput) {
  const { aimX, yaw, backhand, charge, speed } = input;
  const localX = aimX * 0.7;
  const magnitude = Math.hypot(localX, 1);
  const direction = {
    x: (localX * Math.cos(yaw) + Math.sin(yaw)) / magnitude,
    z: (-localX * Math.sin(yaw) + Math.cos(yaw)) / magnitude,
  };
  if (backhand) {
    direction.x *= -1;
    direction.z *= -1;
  }
  const safeCharge = Math.max(0, Math.min(1, Number.isFinite(charge) ? charge : 0));
  const kind = input.kind ?? getStrikeKind(safeCharge);
  const power = getStrikePower(kind, safeCharge, speed) * (backhand ? 0.88 : 1);
  return { x: direction.x * power, y: 0.8 + safeCharge * 1.6, z: direction.z * power, power };
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
