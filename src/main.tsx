import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Game } from "./game/Game";
import { MainMenu } from "./ui/MainMenu";
import { MatchmakingBar } from "./ui/MatchmakingBar";
import { platform, type PlatformUser } from "./services/Platform";

function App() { const [user,setUser]=useState<PlatformUser|null>(null),[queueing,setQueueing]=useState(false),[activeMatch,setActiveMatch]=useState(false); useEffect(()=>{void platform.initializePlatform().then(()=>platform.authenticateUser()).then(setUser);void platform.fetchUserFriends()},[]); if(activeMatch)return <Game/>; return <><MainMenu user={user} onQuickMatch={()=>setQueueing(true)}/>{queueing&&<MatchmakingBar onFound={()=>setActiveMatch(true)}/>}</>; }
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
