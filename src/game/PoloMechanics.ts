export const BALL_START = { x: 0, y: 0.65, z: 0 };

export type ShotInput = {
  aimX: number;
  yaw: number;
  backhand: boolean;
  charge: number;
  speed: number;
};

export function getShotImpulse({ aimX, yaw, backhand, charge, speed }: ShotInput) {
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
  const power = 7 + charge * 17 + Math.abs(speed) * 0.75;
  return { x: direction.x * power, y: 2 + charge * 3, z: direction.z * power, power };
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
