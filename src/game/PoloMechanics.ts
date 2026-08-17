import { getHorseArchetype, type HorseArchetype } from "./HorseControls";
export const BALL_START = { x: 0, y: 0.65, z: 0 };
export type StrikePhase = "WIND_UP" | "CONTACT" | "FOLLOW_THROUGH" | "RECOVERY" | "READY";
export const STRIKE_CONTACT_START = .10;
export const STRIKE_CONTACT_END = .17;
export const STRIKE_RECOVERY_END = .48;

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
  archetype?: HorseArchetype;
};

export function getShotImpulse({ aimX, aimY = 0, yaw, backhand, charge, speed, archetype = "ALL_ROUNDER" }: ShotInput) {
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
  const momentum = Math.min(Math.abs(speed) * .75 * getHorseArchetype(archetype).mass, 18);
  const power = 7 + charge * 17 + momentum;
  const loft = Math.max(.5, 2 + charge * 3 + aimY * 1.25);
  return { x: direction.x * power, y: loft, z: direction.z * power, power };
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
