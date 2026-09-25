import type { PoloRiderEntity } from "./GameState";
import type { TacticalRole } from "./AILogic";

export type BackfillSlot = { id:PoloRiderEntity["id"]; name:string; role:TacticalRole; isBot:boolean };
const roleByIndex: TacticalRole[] = ["ATTACKER", "MIDFIELDER", "DEFENDER", "SWEEPER"];

/** Guarantees that unoccupied 4v4 roster positions have deterministic tactical bots. */
export function buildBotBackfill(humanIds: ReadonlySet<PoloRiderEntity["id"]>): BackfillSlot[] {
  return (["player", "blue_2", "blue_3", "blue_4", "red_1", "red_2", "red_3", "red_4"] as PoloRiderEntity["id"][]).map((id, index) => ({ id, isBot:!humanIds.has(id), role:roleByIndex[index % 4], name:humanIds.has(id) ? id.toUpperCase() : `[BOT] ${roleByIndex[index % 4]}` }));
}
