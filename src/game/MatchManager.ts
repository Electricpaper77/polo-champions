import type { PoloRiderEntity } from "./GameState";
import { buildBotBackfill, type BackfillSlot } from "./Matchmaker";

export type MatchType = "1v1" | "2v2" | "3v3" | "4v4";
export const MATCH_CAPACITY: Record<MatchType, number> = { "1v1": 2, "2v2": 4, "3v3": 6, "4v4": 8 };

/** Returns a fixed-size roster whose unclaimed seats are deterministic tactical bots. */
export function backfillMatchRoster(matchType: MatchType, humanIds: ReadonlySet<PoloRiderEntity["id"]>): BackfillSlot[] {
  return buildBotBackfill(humanIds).slice(0, MATCH_CAPACITY[matchType]);
}
