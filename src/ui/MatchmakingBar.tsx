import { useEffect, useState } from "react";
import { networkManager, type MatchStartPayload } from "../services/NetworkManager";

export function MatchmakingBar({ onFound }: { onFound: (match: MatchStartPayload) => void }) {
  const [seconds,setSeconds]=useState(0),[players,setPlayers]=useState(1),[connection,setConnection]=useState("CONNECTING");
  useEffect(()=>{
    let finished=false,cancelled=false;
    const timer=window.setInterval(()=>setSeconds(value=>value+1),1000);
    const offStatus=networkManager.on("status",status=>setConnection(status.state==="CONNECTED"?"REALTIME SERVER":status.state==="OFFLINE"?"BOT BACKFILL":status.state));
    const offQueue=networkManager.on("queue",status=>setPlayers(status.players));
    const offMatch=networkManager.on("match",match=>{if(finished)return;finished=true;window.clearTimeout(fallback);onFound(match)});
    const fallback=window.setTimeout(()=>{if(!finished)networkManager.startBotBackfilledMatch()},3500);
    void networkManager.connect().then(()=>{if(!cancelled)networkManager.requestRoom("POLOPLAYER1")}).catch(()=>undefined);
    return()=>{cancelled=true;finished=true;window.clearInterval(timer);window.clearTimeout(fallback);offStatus();offQueue();offMatch()};
  },[onFound]);
  const clock=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  return <aside className="matchmaking" role="status"><b>SEARCHING FOR MATCH… {clock}</b><span>6V6 · {players}/12 READY · {connection}</span></aside>;
}
