import { useEffect, useState } from "react";
import { useMatch, type PoloRiderEntity } from "../game/GameState";

const toRadar = (x:number, z:number) => ({ x:Math.max(4, Math.min(196, 100 + x / 52 * 92)), y:Math.max(4, Math.min(116, 60 - z / 82 * 52)) });

/** 30 fps tactical readout, decoupled from render frame rate. */
export function Radar() {
  const [frame, setFrame] = useState(() => useMatch.getState());
  useEffect(() => { const timer = window.setInterval(() => setFrame(useMatch.getState()), 1000 / 30); return () => window.clearInterval(timer); }, []);
  const ball = toRadar(frame.telemetry.ball.x, frame.telemetry.ball.z);
  return <section className="radar" aria-label="Tactical minimap"><b>TACTICAL RADAR</b><svg viewBox="0 0 200 120" role="img" aria-label="Top-down field positions"><rect x="2" y="2" width="196" height="116" rx="4" fill="rgba(5,30,24,.8)" stroke="#d7b95a"/><path d="M100 2v116M2 60h196" stroke="rgba(255,255,255,.35)"/>{Object.values(frame.entities).map((rider:PoloRiderEntity) => { const point = toRadar(rider.position.x, rider.position.y); return <circle key={rider.id} cx={point.x} cy={point.y} r={rider.id === "player" ? 5 : 4} fill={rider.team === "blue" ? "#2f71d5" : "#d74343"} stroke={rider.id === "player" ? "#fff" : "none"}/>; })}<circle cx={ball.x} cy={ball.y} r="3" fill="#fff"/></svg></section>;
}
