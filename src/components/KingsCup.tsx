import { useEffect, useRef } from "react";

type KingsCupProps = { seconds: number; initializeMatch: () => void; onParty?: () => void };

export function KingsCup({ seconds, initializeMatch, onParty }: KingsCupProps) {
  const started = useRef(false);
  const start = () => { if (!started.current) { started.current = true; initializeMatch(); } };
  useEffect(() => { if (seconds <= 0) start(); }, [seconds]);
  return <section className="cup-hero"><small>KING'S CUP ARENA · EUROPE</small><h1>ROYAL GUARD <em>VS</em> SCARLET WOLVES</h1><p>8 RIDERS · 4V4 TEAM MATCH · MATCH STARTS IN <b>00:{String(seconds).padStart(2, "0")}</b></p><button onClick={start}>ENTER KING'S CUP</button><button onClick={onParty}>CUSTOM LOBBY</button></section>;
}
