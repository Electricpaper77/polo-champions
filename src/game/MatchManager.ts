import type { PoloRiderEntity } from "./GameState";
import { buildBotBackfill, type BackfillSlot } from "./Matchmaker";
import type { MatchRewards } from "../services/PlayerProfile";

export type MatchType = "1v1" | "2v2" | "3v3" | "4v4";
export const MATCH_CAPACITY: Record<MatchType, number> = { "1v1": 2, "2v2": 4, "3v3": 6, "4v4": 8 };
export type CommentaryAnnouncement = "GREAT SAVE!" | "GOAL!" | "TURNOVER";
export function getCommentaryAnnouncement(event: "goal" | "save" | "turnover"): CommentaryAnnouncement { return event === "goal" ? "GOAL!" : event === "save" ? "GREAT SAVE!" : "TURNOVER"; }
export function crowdPressureForBallZ(z: number) { return Math.max(0, Math.min(1, (Math.abs(z) - 27) / 15)); }
export function calculateMatchRewards(won: boolean, goals: number): MatchRewards { const goalCoins=Math.max(0,goals)*10; return { won, goalCoins, coins:(won?50:10)+goalCoins, xp:(won?100:25)+Math.max(0,goals)*20 }; }

/** Returns a fixed-size roster whose unclaimed seats are deterministic tactical bots. */
export function backfillMatchRoster(matchType: MatchType, humanIds: ReadonlySet<PoloRiderEntity["id"]>): BackfillSlot[] {
  return buildBotBackfill(humanIds).slice(0, MATCH_CAPACITY[matchType]);
}
