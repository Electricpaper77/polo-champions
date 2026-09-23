import { create } from "zustand";
export type ActiveHumanRiderId = "blue1" | "blue2";
export type MatchPhase = "PLAYING" | "GOAL_PAUSE" | "MATCH_OVER";
export function getMatchResult(scores: { blue: number; red: number }) {
  return scores.blue === scores.red
    ? "DRAW"
    : scores.blue > scores.red
      ? "BLUE WINS"
      : "RED WINS";
}
export type MatchState = {
  score: number;
  scores: { blue: number; red: number };
  seconds: number;
  matchPhase: MatchPhase;
  paused: boolean;
  message: string;
  resetKey: number;
  restartVersion: number;
  activeHumanRiderId: ActiveHumanRiderId;
  scoreGoal: (team?: "blue" | "red") => void;
  resetBall: () => void;
  togglePause: () => void;
  restart: () => void;
  setSeconds: (n: number) => void;
  setMessage: (s: string) => void;
  switchPlayer: () => void;
};
export const useMatch = create<MatchState>((set) => ({
  score: 0,
  scores: { blue: 0, red: 0 },
  seconds: 120,
  matchPhase: "PLAYING",
  paused: false,
  message: "KICK OFF",
  resetKey: 0,
  restartVersion: 0,
  activeHumanRiderId: "blue1",
  scoreGoal: (team = "blue") =>
    set((s) =>
      s.matchPhase === "MATCH_OVER"
        ? s
        : {
            score: s.score + 1,
            scores: { ...s.scores, [team]: s.scores[team] + 1 },
            matchPhase: "GOAL_PAUSE",
            message: `${team.toUpperCase()} GOAL!`,
            resetKey: s.resetKey + 1,
          },
    ),
  resetBall: () =>
    set((s) => ({ resetKey: s.resetKey + 1, message: "BALL RESET" })),
  togglePause: () =>
    set((s) => ({ paused: !s.paused, message: !s.paused ? "PAUSED" : "PLAY" })),
  restart: () =>
    set((s) => ({
      score: 0,
      scores: { blue: 0, red: 0 },
      seconds: 120,
      matchPhase: "PLAYING",
      paused: false,
      message: "KICK OFF",
      resetKey: s.resetKey + 1,
      restartVersion: s.restartVersion + 1,
      activeHumanRiderId: "blue1",
    })),
  setSeconds: (seconds) =>
    set((s) =>
      s.matchPhase === "MATCH_OVER"
        ? s
        : seconds <= 0
        ? {
            seconds: 0,
            matchPhase: "MATCH_OVER",
            message: getMatchResult(s.scores),
          }
        : {
            seconds,
            matchPhase:
              s.matchPhase === "GOAL_PAUSE" ? "PLAYING" : s.matchPhase,
          },
    ),
  setMessage: (message) => set({ message }),
  switchPlayer: () =>
    set((s) => {
      if (s.matchPhase === "MATCH_OVER") return s;
      const activeHumanRiderId =
        s.activeHumanRiderId === "blue1" ? "blue2" : "blue1";
      return {
        activeHumanRiderId,
        message: `CONTROL ${activeHumanRiderId.toUpperCase()}`,
      };
    }),
}));
