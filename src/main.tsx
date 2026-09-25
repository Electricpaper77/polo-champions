import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Game } from "./game/Game";
import { MainMenu } from "./ui/MainMenu";
import { MatchmakingBar } from "./ui/MatchmakingBar";
import { platform, type PlatformUser } from "./services/Platform";
import { PartyLobby } from "./ui/PartyLobby";
import { LoadingScreen } from "./ui/LoadingScreen";
import { LobbyDashboard } from "./ui/LobbyDashboard";
import { AudioManager } from "./game/AudioManager";
import { LobbyModal } from "./components/LobbyModal";

function App() { const [user,setUser]=useState<PlatformUser|null>(null),[screen,setScreen]=useState<"LOBBY"|"PARTY"|"LOADING_MATCH"|"ACTIVE_MATCH">("LOBBY"),[queueing,setQueueing]=useState(false),[roomLobby,setRoomLobby]=useState(false); useEffect(()=>{void platform.initializePlatform().then(()=>platform.authenticateUser()).then(setUser);void platform.fetchUserFriends()},[]); const startMatch=()=>{void AudioManager.unlock().then(()=>AudioManager.playUi("click"));setRoomLobby(true)}; if(screen==="ACTIVE_MATCH")return <Game/>; if(screen==="LOADING_MATCH")return <LoadingScreen onReady={()=>setScreen("ACTIVE_MATCH")}/>; if(screen==="PARTY")return <PartyLobby onStart={()=>{void AudioManager.unlock().then(()=>AudioManager.playUi("start"));setScreen("LOADING_MATCH")}}/>; return <><LobbyDashboard onPlay={startMatch} onParty={()=>setScreen("PARTY")}/>{roomLobby&&<LobbyModal onClose={()=>setRoomLobby(false)} onLaunch={()=>{AudioManager.playUi("start");setRoomLobby(false);setQueueing(true)}}/>}{queueing&&<MatchmakingBar onFound={()=>setScreen("LOADING_MATCH")}/>}</>; }
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
