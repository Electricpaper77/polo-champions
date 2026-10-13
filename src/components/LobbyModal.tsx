import { useEffect, useMemo, useState } from "react";
import { networkManager, type RoomState } from "../services/NetworkManager";

type Team = "ROYAL GUARD" | "SCARLET WOLVES";

const emptyRoom: RoomState = { code:"", capacity:2, status:"WAITING", players:[] };

export function LobbyModal({ onClose, onLaunch }: { onClose: () => void; onLaunch: () => void }) {
  const [team, setTeam] = useState<Team>("ROYAL GUARD");
  const [ready, setReady] = useState(false);
  const [room, setRoom] = useState<RoomState>(emptyRoom);
  const [roomCode, setRoomCode] = useState("");
  const [ping, setPing] = useState(0);
  const [connection, setConnection] = useState("CONNECTING");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const playerName = useMemo(() => `POLO_${team === "ROYAL GUARD" ? "BLUE" : "RED"}`, [team]);

  useEffect(() => {
    const status = networkManager.on("status", value => setConnection(value.state));
    const lobby = networkManager.on("room", value => {
      setRoom(value);
      setRoomCode(value.code);
      setError("");
    });
    const latency = networkManager.on("latency", value => setPing(value.pingMs));
    const errors = networkManager.on("error", value => setError(value.message));
    const match = networkManager.on("match", () => onLaunch());
    void networkManager.connect().catch(() => setError("Realtime server unavailable"));
    return () => { status(); lobby(); latency(); errors(); match(); };
  }, [onLaunch]);

  const createRoom = () => {
    setError("");
    setReady(false);
    if (!networkManager.createRoom(playerName)) setError("Realtime server is not connected yet");
  };
  const joinRoom = () => {
    setError("");
    setReady(false);
    const code = roomCode.trim().toUpperCase();
    if (!code) return setError("Enter a room code");
    if (!networkManager.joinRoom(code, playerName)) setError("Realtime server is not connected yet");
  };
  const toggleReady = () => {
    if (!room.code) return setError("Create or join a room first");
    const next = !ready;
    setReady(next);
    if (!networkManager.setRoomReady(room.code, next)) setError("Realtime server is not connected yet");
  };
  const copyRoomCode = async () => {
    if (!room.code) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopyStatus("ROOM CODE COPIED");
    } catch {
      setCopyStatus("COPY UNAVAILABLE");
    }
    window.setTimeout(() => setCopyStatus(""), 2_000);
  };

  return <section className="match-over lobby-modal" role="dialog" aria-label="Match room lobby">
    <small>PRIVATE ROOM · {connection} · {ping || "--"} MS</small>
    <strong>{room.code ? `ROOM ${room.code}` : "CREATE OR JOIN ROOM"}</strong>
    <p>Use an exact room code. The server confirms room creation, joins, readiness, and match start.</p>
    <div className="lobby-teams">
      <button className={team === "ROYAL GUARD" ? "equipped" : ""} onClick={() => setTeam("ROYAL GUARD")}>ROYAL GUARD</button>
      <button className={team === "SCARLET WOLVES" ? "equipped" : ""} onClick={() => setTeam("SCARLET WOLVES")}>SCARLET WOLVES</button>
    </div>
    <label className="room-code-entry">
      <span>ROOM CODE</span>
      <input value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase())} maxLength={8} placeholder="ABC123" />
    </label>
    <div className="lobby-teams">
      <button onClick={createRoom}>CREATE ROOM</button>
      <button onClick={joinRoom}>JOIN ROOM</button>
      <button disabled={!room.code} onClick={copyRoomCode}>COPY CODE</button>
    </div>
    {copyStatus && <em className="lobby-starting" role="status">{copyStatus}</em>}
    <div className="lobby-slots">
      {Array.from({ length: room.capacity }, (_, index) => {
        const player = room.players[index];
        return <span key={player?.id ?? index} className={player?.connected ? "connected" : ""}>
          {player ? `${player.name}${player.host ? " · HOST" : ""} · ${player.connected ? "CONNECTED" : "DISCONNECTED"} · ${player.ready ? "READY" : "NOT READY"}` : `PLAYER ${index + 1} · OPEN`}
        </span>;
      })}
    </div>
    {error && <em className="lobby-error" role="alert">{error}</em>}
    {room.status === "STARTING" && <em className="lobby-starting">STARTING MATCH...</em>}
    <button disabled={!room.code} onClick={toggleReady}>{ready ? "READY ✓" : "MARK READY"}</button>
    <button onClick={onClose}>CANCEL</button>
  </section>;
}
