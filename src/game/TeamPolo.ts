export type Team = "blue" | "gold";
export type Role = "finisher" | "support" | "playmaker" | "back";
export type AiState = "ATTACK" | "DEFEND" | "LOOSE_BALL" | "RECOVER" | "SUPPORT";
export type Point = { x: number; z: number };
export type Rider = { id: string; team: Team; role: Role; human?: boolean };

export const ROSTER: Rider[] = [
  { id: "blue-1", team: "blue", role: "finisher", human: true }, { id: "blue-2", team: "blue", role: "support" },
  { id: "red-1", team: "gold", role: "finisher" }, { id: "red-2", team: "gold", role: "back" },
];

export function attackingGoal(team: Team) { return team === "blue" ? 1 : -1; }
export function nextPlayer(currentId: string) { const team = ROSTER.find(r => r.id === currentId)?.team ?? "blue"; const players = ROSTER.filter(r => r.team === team); return players[(players.findIndex(r => r.id === currentId) + 1) % players.length].id; }
export function isRightOfWay(rider: Point, ball: Point, opponent: Point) { const lineX = ball.x - rider.x, lineZ = ball.z - rider.z; return lineX * (opponent.x - rider.x) + lineZ * (opponent.z - rider.z) < 0; }
export function getAiState(rider: Rider, possession: Team | null, ball: Point): AiState {
  if (!possession) return "LOOSE_BALL";
  if (possession === rider.team) return rider.role === "finisher" || rider.role === "playmaker" ? "ATTACK" : "SUPPORT";
  return rider.role === "back" ? "DEFEND" : "RECOVER";
}
export function getRoleTarget(rider: Rider, possession: Team | null, ball: Point): Point {
  const direction = attackingGoal(rider.team), state = getAiState(rider, possession, ball);
  if (state === "LOOSE_BALL") return ball;
  const depth = rider.role === "finisher" ? 12 : rider.role === "support" ? 5 : rider.role === "playmaker" ? -2 : -14;
  if (state === "DEFEND" || state === "RECOVER") return { x: ball.x * .55, z: ball.z * .55 - direction * (rider.role === "back" ? 10 : 4) };
  return { x: ball.x * .45 + (rider.role === "support" ? 8 : rider.role === "playmaker" ? -7 : 0), z: ball.z * .45 + direction * depth };
}
export function choosePossession(ball: Point, riders: Array<Rider & { position: Point }>, radius = 3.5): Team | null {
  const nearest = riders.map(r => ({ r, d: Math.hypot(r.position.x - ball.x, r.position.z - ball.z) })).sort((a,b) => a.d-b.d)[0];
  return nearest && nearest.d <= radius ? nearest.r.team : null;
}
