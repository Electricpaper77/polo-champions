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
import { ErrorBoundary } from "./components/ErrorBoundary";
import { track } from "./services/Analytics";
import { AudioManager } from "./game/AudioManager";
import { LobbyModal } from "./components/LobbyModal";
import { PlayerProfileStore } from "./services/PlayerProfile";
import { TutorialOverlay } from "./game/TutorialManager";

function App() { const [user,setUser]=useState<PlatformUser|null>(null),[screen,setScreen]=useState<"LOBBY"|"PARTY"|"LOADING_MATCH"|"ACTIVE_MATCH">("LOBBY"),[queueing,setQueueing]=useState(false),[roomLobby,setRoomLobby]=useState(false),[training,setTraining]=useState(()=>!PlayerProfileStore.get().hasCompletedTutorial); useEffect(()=>{void platform.initializePlatform().then(()=>platform.authenticateUser()).then(setUser);void platform.fetchUserFriends()},[]); const startMatch=()=>{void AudioManager.unlock().then(()=>AudioManager.playUi("click"));setTraining(false);setQueueing(true)}, openPrivateRoom=()=>{void AudioManager.unlock().then(()=>AudioManager.playUi("click"));setTraining(false);setRoomLobby(true)}, openParty=()=>{setTraining(false);setScreen("PARTY")}, startTraining=()=>{void AudioManager.unlock().then(()=>AudioManager.playUi("start"));setTraining(false);setScreen("LOADING_MATCH")}; if(screen==="ACTIVE_MATCH")return <>{<Game/>}{!PlayerProfileStore.get().hasCompletedTutorial&&<TutorialOverlay onComplete={()=>setScreen("LOBBY")}/>}</>; if(screen==="LOADING_MATCH")return <LoadingScreen onReady={()=>setScreen("ACTIVE_MATCH")}/>; if(screen==="PARTY")return <PartyLobby onStart={()=>{void AudioManager.unlock().then(()=>AudioManager.playUi("start"));setScreen("LOADING_MATCH")}}/>; return <>{training&&<section className="match-over" role="dialog"><small>WELCOME TO POLO CHAMPIONS</small><strong>TRAINING GROUNDS</strong><p>Learn riding, sprinting, swinging, and scoring before entering multiplayer.</p><button onClick={startTraining}>START TRAINING</button></section>}<LobbyDashboard onPlay={startMatch} onParty={openParty}/>{roomLobby&&<LobbyModal onClose={()=>setRoomLobby(false)} onLaunch={()=>{AudioManager.playUi("start");setRoomLobby(false);setQueueing(false);setScreen("LOADING_MATCH")}}/>}{queueing&&<MatchmakingBar onFound={()=>setScreen("LOADING_MATCH")}/>} {!queueing&&!roomLobby&&<button className="private-room-launch" onClick={openPrivateRoom}>PRIVATE ROOM</button>}</>; }
track("Game_Loaded");
createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
