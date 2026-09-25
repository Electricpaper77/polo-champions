import { useEffect, useRef } from "react";
import { useMatch } from "../game/GameState";
import { PlayerProfileStore } from "../services/PlayerProfile";

export function PostMatchModal() {
  const state = useMatch(), awarded = useRef(false); useEffect(()=>{if(state.matchComplete&&!awarded.current){awarded.current=true;PlayerProfileStore.recordMatch(state.score.blue>state.score.red,state.score.blue)}if(!state.matchComplete)awarded.current=false},[state.matchComplete,state.score]); if (!state.matchComplete) return null;
  const mvp = state.score.blue === state.score.red ? "PLAYER 1" : state.score.blue > state.score.red ? "ROYAL GUARD STRIKER" : "SCARLET WOLVES STRIKER";
  return <section className="match-over" role="dialog" aria-label="Post match summary"><small>FINAL CHUKKER</small><strong>{state.score.blue > state.score.red ? "ROYAL GUARD WIN" : state.score.red > state.score.blue ? "SCARLET WOLVES WIN" : "DRAW"}</strong><span>MVP · {mvp}</span><p>REWARDS · {state.score.blue > state.score.red ? 50 : 0} COINS + {state.score.blue * 10} GOAL COINS</p><p>SHOTS ON TARGET · BLUE {state.score.blue * 3 + 2} / RED {state.score.red * 3 + 2}</p><p>POSSESSION · BLUE 50% / RED 50%</p><p>LOB FOULS · {state.lobFouls}</p><button onClick={state.restart}>NEW MATCH</button></section>;
}
