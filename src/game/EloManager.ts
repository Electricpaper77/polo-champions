import { PlayerProfileStore } from "../services/PlayerProfile";
export const INITIAL_ELO=1200, ELO_K=32;
export function calculateElo(current:number,opponentAverage:number,outcome:"WIN"|"LOSS"|"DRAW"){const expected=1/(1+10**((opponentAverage-current)/400)),actual=outcome==="WIN"?1:outcome==="DRAW"?.5:0;return Math.round(current+ELO_K*(actual-expected));}
export function recordEloResult(outcome:"WIN"|"LOSS"|"DRAW",opponentAverage=INITIAL_ELO){const profile=PlayerProfileStore.get(),elo=calculateElo(profile.eloRating,opponentAverage,outcome);return PlayerProfileStore.setElo(elo);}
