import { useEffect, useRef } from "react";
import { useMatch } from "../game/GameState";
import { PlayerProfileStore } from "../services/PlayerProfile";
import { recordEloResult } from "../game/EloManager";
import { networkManager } from "../services/NetworkManager";
import { HighlightViewer } from "./HighlightViewer";

export function PostMatchModal() {
  const state = useMatch(), awarded = useRef(false), won = state.score.blue > state.score.red, goals = state.score.blue, projectedRewards = { xp:(won?100:25)+goals*20, coins:(won?50:10)+goals*10, goalCoins:goals*10 }; useEffect(()=>{if(state.matchComplete&&!awarded.current){awarded.current=true;PlayerProfileStore.recordMatch(won,goals);const profile=recordEloResult(won?"WIN":state.score.blue===state.score.red?"DRAW":"LOSS");networkManager.publishElo("POLOPLAYER1",profile.eloRating)}if(!state.matchComplete)awarded.current=false},[state.matchComplete,state.score,won,goals]); if (!state.matchComplete) return null;
  const mvp = state.score.blue === state.score.red ? "PLAYER 1" : state.score.blue > state.score.red ? "ROYAL GUARD STRIKER" : "SCARLET WOLVES STRIKER";
  return <section className="match-over" role="dialog" aria-label="Post match summary"><small>FINAL CHUKKER</small><strong>{won ? "ROYAL GUARD WIN" : state.score.red > state.score.blue ? "SCARLET WOLVES WIN" : "DRAW"}</strong><span>MVP · {mvp}</span><p>REWARDS · +{projectedRewards.xp} XP · +{projectedRewards.coins} POLO COINS</p><p>GOAL BONUS · +{projectedRewards.goalCoins} COINS · LEVEL {PlayerProfileStore.get().level} · {PlayerProfileStore.get().xp}/{1000} XP</p><p>SHOTS ON TARGET · BLUE {state.score.blue * 3 + 2} / RED {state.score.red * 3 + 2}</p><p>POSSESSION · BLUE 50% / RED 50%</p><p>LOB FOULS · {state.lobFouls}</p><HighlightViewer/><button onClick={state.restart}>NEW MATCH</button></section>;
}
