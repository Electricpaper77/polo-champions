import type { MatchTeam, PoloRiderEntity } from "./GameState";

export type TacticalRole = "ATTACKER" | "MIDFIELDER" | "DEFENDER" | "SWEEPER";
export type TacticalAssignments = Partial<Record<PoloRiderEntity["id"], TacticalRole>>;

const distance = (rider: PoloRiderEntity, ball: { x: number; z: number }) => Math.hypot(rider.position.x - ball.x, rider.position.y - ball.z);

/** Assigns one ball hunter, then support, marking, and goal-zone responsibilities per side. */
export function assignTacticalRoles(riders: PoloRiderEntity[], ball: { x: number; z: number }): TacticalAssignments {
  const assignments: TacticalAssignments = {};
  for (const team of ["blue", "red"] as MatchTeam[]) {
    const ordered = riders.filter(rider => rider.team === team && rider.id !== "player").sort((a, b) => distance(a, ball) - distance(b, ball) || a.id.localeCompare(b.id));
    const roles: TacticalRole[] = ["ATTACKER", "MIDFIELDER", "DEFENDER", "SWEEPER"];
    ordered.forEach((rider, index) => { assignments[rider.id] = roles[index] ?? "SWEEPER"; });
  }
  return assignments;
}

export function tacticalTarget(role: TacticalRole, rider: PoloRiderEntity, ball: { x: number; z: number }) {
  const homeGoal = rider.team === "blue" ? 70 : -70, attackSign = rider.team === "blue" ? -1 : 1;
  if (role === "ATTACKER") return ball;
  if (role === "MIDFIELDER") return { x: Math.max(-18, Math.min(18, ball.x + (rider.homePosition.x < 0 ? -5 : 5))), z: ball.z - attackSign * 7 };
  if (role === "DEFENDER") return { x: ball.x * .35, z: homeGoal + (ball.z - homeGoal) * .28 };
  return { x: rider.homePosition.x, z: homeGoal };
}
