import { useEffect, useState } from "react";
import { networkManager } from "../services/NetworkManager";

type Team = "ROYAL GUARD" | "SCARLET WOLVES";
const slots = Array.from({ length:8 }, (_, index) => `PLAYER ${index + 1}`);

export function LobbyModal({ onClose, onLaunch }: { onClose: () => void; onLaunch: () => void }) {
  const [team, setTeam] = useState<Team>("ROYAL GUARD"), [ready, setReady] = useState(false), [players, setPlayers] = useState(1), [ping, setPing] = useState(0), [connection, setConnection] = useState("CONNECTING");
  useEffect(() => { const status = networkManager.on("status", value => setConnection(value.state)), queue = networkManager.on("queue", value => setPlayers(value.players)), latency = networkManager.on("latency", value => setPing(value.pingMs)); void networkManager.connect().catch(() => undefined); return () => { status(); queue(); latency(); }; }, []);
  const launch = () => { if (!ready) return; networkManager.requestRoom(`POLO_${team === "ROYAL GUARD" ? "BLUE" : "RED"}`); onLaunch(); };
  return <section className="match-over lobby-modal" role="dialog" aria-label="Match room lobby"><small>PRIVATE ROOM · {connection} · {ping || "--"} MS</small><strong>4V4 MATCH LOBBY</strong><p>Select a side, confirm ready, then create or join a room.</p><div className="lobby-teams"><button className={team === "ROYAL GUARD" ? "equipped" : ""} onClick={() => setTeam("ROYAL GUARD")}>ROYAL GUARD</button><button className={team === "SCARLET WOLVES" ? "equipped" : ""} onClick={() => setTeam("SCARLET WOLVES")}>SCARLET WOLVES</button></div><div className="lobby-slots">{slots.map((slot, index) => <span key={slot} className={index < players ? "connected" : ""}>{slot} · {index < players ? index === 0 ? team : "CONNECTED" : "OPEN"}</span>)}</div><button onClick={() => setReady(value => !value)}>{ready ? "READY ✓" : "MARK READY"}</button><button disabled={!ready} onClick={launch}>CREATE / JOIN ROOM</button><button onClick={onClose}>CANCEL</button></section>;
}
