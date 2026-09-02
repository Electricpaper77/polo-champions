import { useEffect, useState } from "react";
import { CareerStatsManager, careerMetrics } from "../services/CareerStats";
import { CustomizationTabs } from "./CustomizationTabs";
import { ShopTab } from "./ShopTab";
import "./dashboard.css";
const tabs=["PLAY","HORSES","PLAYERS","CLUB","SHOP","CAREER","SETTINGS"],blue=["POLOPLAYER1 · No. 3","BlueNo2 · No. 1","StableMaster · No. 2","RoyalBack · No. 4"],red=["WolfOne · No. 1","WolfTwo · No. 2","WolfThree · No. 3","ScarletBack · No. 4"];
export function LobbyDashboard({ onPlay, onParty }: { onPlay?: () => void; onParty?: () => void } = {}) {const [tab,setTab]=useState("PLAY"),[seconds,setSeconds]=useState(45),[stats,setStats]=useState(CareerStatsManager.get());useEffect(()=>{const timer=window.setInterval(()=>setSeconds(value=>Math.max(0,value-1)),1000);return()=>window.clearInterval(timer)},[]);const metrics=careerMetrics(stats);return <main className="dashboard"><header className="top-nav"><b>♛ POLO CHAMPIONS</b>{tabs.map(item=><button key={item} className={tab===item?"active":""} onClick={()=>{setTab(item);setStats(CareerStatsManager.get())}}>{item}</button>)}</header><section className="cup-hero"><small>KING'S CUP ARENA · EUROPE</small><h1>ROYAL GUARD <em>VS</em> SCARLET WOLVES</h1><p>8 RIDERS · 4V4 TEAM MATCH · MATCH STARTS IN <b>00:{String(seconds).padStart(2,"0")}</b></p><button onClick={onPlay}>ENTER KING'S CUP</button><button onClick={onParty}>CUSTOM LOBBY</button></section><section className="rosters"><Roster title="ROYAL GUARD" players={blue} blue/><Roster title="SCARLET WOLVES" players={red}/><aside className="challenges"><small>DAILY CHALLENGES · 12:45:30 REMAINING</small><p>Win one King's Cup match <b>0 / 1</b></p><p>Complete ride-offs <b>5 / 12</b></p><p>Score King's Cup goals <b>3 / 6</b></p></aside><aside className="career"><small>LIVE PLAYER STATS</small><strong>LEVEL {stats.level} · {stats.xp}/8500 XP</strong><p>MATCHES {stats.matchesPlayed} · WINS {stats.totalWins}</p><p>GOALS {stats.goalsScored} · RIDE-OFFS {stats.rideOffs}</p><p>WIN RATE {metrics.winRate}% · GPM {metrics.gpm} · TACKLE {metrics.tackleRatio}</p></aside>
<aside className="challenges" style={{ borderColor: "#d4af37" }}>
  <small style={{ color: "#d4af37" }}>?? SEASON 1 PASS ACTIVE</small>
  <p>Current Tier: <b>1 / 100</b></p>
  <div style={{ width: "100%", background: "#111", height: "8px", borderRadius: "4px", marginTop: "8px" }}>
    <div style={{ width: "5%", background: "#d4af37", height: "100%", borderRadius: "4px" }}></div>
  </div>
</aside>
<aside className="career">
  <small>MILESTONES UNLOCKED</small>
  <strong>0 / 1000 PTS</strong>
  <p>Win 1 Match: <b>Locked</b></p>
  <p>Score 10 Goals: <b>Locked</b></p>
</aside>
</section>{tab!=="PLAY"&&<section className="tab-stage">{tab==="HORSES"?<CustomizationTabs mode="HORSES"/>:tab==="PLAYERS"?<CustomizationTabs mode="PLAYERS"/>:tab==="SHOP"?<ShopTab/>:<div className="customization"><small>{tab}</small><h1>{tab} COMING ONLINE</h1><p>This club service is connected to the main navigation hub.</p></div>}</section>}</main>}
function Roster({title,players,blue=false}:{title:string;players:string[];blue?:boolean}){return <section className={`roster ${blue?"blue":"red"}`}><h2>{title} <small>4/4 READY</small></h2>{players.map((player,index)=><p key={player}><b>{index===0?"♛ ":""}{player}</b><span>LVL {12+index} · READY</span></p>)}</section>}


