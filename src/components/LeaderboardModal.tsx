import { useEffect, useState } from "react";
import { networkManager } from "../services/NetworkManager";
import { PlayerProfileStore } from "../services/PlayerProfile";
export function LeaderboardModal(){const [rows,setRows]=useState<Array<{username:string;elo:number}>>([]),profile=PlayerProfileStore.get();useEffect(()=>networkManager.on("leaderboard",setRows),[]);const visible=rows.length?rows:[{username:"POLOPLAYER1",elo:profile.eloRating}];return <section className="customization leaderboard"><small>GLOBAL RANKINGS</small><h1>TOP 50 · ELO</h1><div>{visible.map((row,index)=><p key={`${row.username}-${index}`} className={row.elo===profile.eloRating?"equipped":""}><b>#{index+1}</b> {row.username}<span>{row.elo}</span></p>)}</div></section>}
