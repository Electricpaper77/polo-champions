import { expect, test } from "@playwright/test";
import { initializeMatchEntities } from "../src/game/GameState";
import { CareerStatsManager, careerMetrics } from "../src/services/CareerStats";

test("King's Cup initializes twelve concurrent riders", () => { const entities=initializeMatchEntities(); expect(Object.keys(entities)).toHaveLength(12); expect(Object.values(entities).filter(entity=>entity.team==="blue")).toHaveLength(6); expect(Object.values(entities).filter(entity=>entity.team==="red")).toHaveLength(6); });
test("career stats persist match completion and derive performance metrics", () => { CareerStatsManager.reset(); const after=CareerStatsManager.recordMatch({won:true,goals:3,rideOffs:4}); expect(CareerStatsManager.get()).toEqual(after); expect(after.matchesPlayed).toBe(1); expect(after.totalWins).toBe(1); expect(careerMetrics(after)).toMatchObject({winRate:100,gpm:3,tackleRatio:4}); CareerStatsManager.reset(); });
