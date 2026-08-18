import { createInitialNetworkSnapshot, decompressSnapshot, type CompressedSnapshot, type InputCommand, type NetworkSnapshot } from "../game/NetworkSync";
import type { MatchScore, MatchTeam, PoloRiderEntity } from "../game/GameState";
import { matchTelemetry } from "./Telemetry";

export type MatchStartPayload = { matchId: string; assignedEntityId: PoloRiderEntity["id"]; reconnectToken: string | null; initialState: NetworkSnapshot; mode: "WEBSOCKET" | "BOT_BACKFILL" };
export type PlayerControlChange = { entityId: PoloRiderEntity["id"]; playerName: string; state: "AI_BACKFILL" | "RECONNECTED"; reconnectDeadline?: number };
export type GoalScored = { team: MatchTeam; score: MatchScore; celebrationMs: number };
type QueueStatus = { players: number; capacity: number; roomId: string };
type ServerMessage =
  | { type: "QUEUE_STATUS"; payload: QueueStatus }
  | { type: "MATCH_START"; payload: Omit<MatchStartPayload, "initialState"> & { initialState: CompressedSnapshot } }
  | { type: "STATE_SNAPSHOT"; payload: CompressedSnapshot }
  | { type: "GOAL_SCORED"; payload: GoalScored }
  | { type: "PLAYER_CONTROL_CHANGED"; payload: PlayerControlChange }
  | { type: "PONG"; payload: { clientTime: number; serverTime: number } }
  | { type: "ERROR"; payload: { message: string } };
type ClientMessage =
  | { type: "JOIN_QUEUE"; payload: { playerName: string; mode: "6V6" } }
  | { type: "RECONNECT"; payload: { matchId: string; reconnectToken: string } }
  | { type: "PING"; payload: { clientTime: number } }
  | { type: "RESET_MATCH"; payload: { matchId: string } }
  | { type: "INPUT"; payload: { matchId: string; entityId: PoloRiderEntity["id"]; command: InputCommand } };
type NetworkEvents = {
  status: { state: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "OFFLINE"; detail?: string };
  queue: QueueStatus;
  match: MatchStartPayload;
  snapshot: NetworkSnapshot;
  goal: GoalScored;
  playerControl: PlayerControlChange;
  latency: { pingMs: number; serverTime: number };
  error: { message: string };
};

export interface WebSocketTransport {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (event: unknown) => void;
  onmessage: (event: { data: unknown }) => void;
  onerror: (event: unknown) => void;
  onclose: (event: unknown) => void;
}

export type SocketFactory = (url: string) => WebSocketTransport;
export type ReconnectPolicy = { baseDelayMs?: number; maxDelayMs?: number };

export function resolveWebSocketUrl(configured?: string): string {
  return configured?.trim() || "ws://localhost:8080";
}

export function reconnectDelay(attempt: number, baseDelayMs = 500, maxDelayMs = 10_000): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function defaultUrl(): string {
  const configured = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_WEBSOCKET_URL;
  return resolveWebSocketUrl(configured);
}

function defaultFactory(url: string): WebSocketTransport {
  return new WebSocket(url) as unknown as WebSocketTransport;
}

export class NetworkManager {
  private socket: WebSocketTransport | null = null;
  private connectPromise: Promise<void> | null = null;
  private listeners = new Map<keyof NetworkEvents, Set<(payload: never) => void>>();
  private activeMatch: MatchStartPayload | null = null;
  private resumableMatch: MatchStartPayload | null = null;
  private queued = false;
  private shouldReconnect = false;
  private everConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private latencyTimer: ReturnType<typeof setInterval> | null = null;
  private currentPingMs = 0;
  private lastPlayerName: string | null = null;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(private readonly url = defaultUrl(), private readonly factory: SocketFactory = defaultFactory, policy: ReconnectPolicy = {}) {
    this.baseDelayMs = policy.baseDelayMs ?? 500;
    this.maxDelayMs = policy.maxDelayMs ?? 10_000;
  }

  on<K extends keyof NetworkEvents>(type: K, listener: (payload: NetworkEvents[K]) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (payload: never) => void);
    this.listeners.set(type, set);
    return () => { set.delete(listener as (payload: never) => void); };
  }

  private emit<K extends keyof NetworkEvents>(type: K, payload: NetworkEvents[K]) {
    this.listeners.get(type)?.forEach(listener => listener(payload as never));
  }

  connect(timeoutMs = 2_200): Promise<void> {
    this.shouldReconnect = true;
    if (this.socket?.readyState === 1) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.clearReconnectTimer();
    this.emit("status", { state: "CONNECTING", detail: this.reconnectAttempt ? `Reconnect attempt ${this.reconnectAttempt}` : undefined });
    const connecting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        this.socket?.close(4000, "connection timeout");
        this.emit("status", { state: "OFFLINE", detail: "Realtime server unavailable" });
        reject(new Error("Realtime server connection timed out"));
      }, timeoutMs);
      try {
        const socket = this.factory(this.url);
        this.socket = socket;
        socket.onopen = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const reconnecting = this.everConnected;
          this.everConnected = true;
          this.reconnectAttempt = 0;
          this.connectPromise = null;
          this.startLatencyProbe();
          this.emit("status", { state: "CONNECTED", detail: reconnecting ? "Realtime connection restored" : undefined });
          resolve();
          if (reconnecting && this.resumableMatch?.reconnectToken) {
            this.send({ type: "RECONNECT", payload: { matchId: this.resumableMatch.matchId, reconnectToken: this.resumableMatch.reconnectToken } });
          } else if (reconnecting && this.lastPlayerName && !this.activeMatch) {
            this.queued = false;
            this.requestRoom(this.lastPlayerName);
          }
        };
        socket.onmessage = event => this.receive(event.data);
        socket.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.connectPromise = null;
          this.emit("status", { state: "OFFLINE", detail: "Realtime server unavailable" });
          socket.close(1011, "connection failed");
          reject(new Error("Realtime server connection failed"));
        };
        socket.onclose = () => {
          if (this.socket === socket) this.socket = null;
          this.connectPromise = null;
          this.queued = false;
          this.clearLatencyProbe();
          if (!this.shouldReconnect) return;
          if (this.activeMatch?.mode === "WEBSOCKET") this.resumableMatch = this.activeMatch;
          else this.activeMatch = null;
          this.emit("status", { state: "DISCONNECTED", detail: "Realtime connection lost" });
          this.scheduleReconnect();
        };
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        this.connectPromise = null;
        this.emit("status", { state: "OFFLINE", detail: "Realtime server unavailable" });
        this.scheduleReconnect();
        reject(error);
      }
    });
    this.connectPromise = connecting;
    void connecting.catch(() => {
      if (this.connectPromise === connecting) this.connectPromise = null;
    });
    return connecting;
  }

  requestRoom(playerName: string): boolean {
    this.lastPlayerName = playerName;
    if (this.queued || this.activeMatch) return false;
    const sent = this.send({ type: "JOIN_QUEUE", payload: { playerName, mode: "6V6" } });
    this.queued = sent;
    return sent;
  }

  sendInput(command: InputCommand): boolean {
    if (!this.activeMatch) return false;
    return this.send({ type: "INPUT", payload: { matchId: this.activeMatch.matchId, entityId: this.activeMatch.assignedEntityId, command: { ...command, reportedPingMs: this.currentPingMs } } });
  }

  requestMatchReset(): boolean {
    return this.activeMatch ? this.send({ type: "RESET_MATCH", payload: { matchId: this.activeMatch.matchId } }) : false;
  }

  private send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private receive(raw: unknown) {
    try {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if (message.type === "QUEUE_STATUS") this.emit("queue", message.payload);
      else if (message.type === "MATCH_START") {
        const match = { ...message.payload, initialState: decompressSnapshot(message.payload.initialState) };
        this.queued = false;
        this.activeMatch = match;
        this.resumableMatch = null;
        matchTelemetry.startMatch(match.matchId);
        this.emit("match", match);
      } else if (message.type === "STATE_SNAPSHOT") this.emit("snapshot", decompressSnapshot(message.payload));
      else if (message.type === "GOAL_SCORED") this.emit("goal", message.payload);
      else if (message.type === "PLAYER_CONTROL_CHANGED") {
        if (message.payload.state === "AI_BACKFILL") matchTelemetry.recordAIBackfill();
        this.emit("playerControl", message.payload);
      } else if (message.type === "PONG") {
        const pingMs = Math.max(0, Date.now() - message.payload.clientTime);
        this.currentPingMs = pingMs;
        matchTelemetry.recordPing(pingMs);
        this.emit("latency", { pingMs, serverTime: message.payload.serverTime });
      }
      else if (message.type === "ERROR") this.emit("error", message.payload);
    } catch {
      this.emit("error", { message: "Malformed realtime server message" });
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = reconnectDelay(this.reconnectAttempt, this.baseDelayMs, this.maxDelayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startLatencyProbe() {
    this.clearLatencyProbe();
    const ping = () => this.send({ type: "PING", payload: { clientTime: Date.now() } });
    ping();
    this.latencyTimer = setInterval(ping, 5_000);
  }

  private clearLatencyProbe() {
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    this.latencyTimer = null;
  }

  startBotBackfilledMatch(): MatchStartPayload {
    if (this.activeMatch) return this.activeMatch;
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.socket?.close(1000, "local bot fallback");
    this.socket = null;
    this.connectPromise = null;
    this.queued = false;
    const match: MatchStartPayload = { matchId: `local-${Date.now()}`, assignedEntityId: "player", reconnectToken: null, initialState: createInitialNetworkSnapshot(Date.now()), mode: "BOT_BACKFILL" };
    this.activeMatch = match;
    this.resumableMatch = null;
    matchTelemetry.startMatch(match.matchId);
    this.emit("status", { state: "OFFLINE", detail: "Local authoritative bot session" });
    this.emit("queue", { players: 12, capacity: 12, roomId: match.matchId });
    this.emit("match", match);
    return match;
  }

  getActiveMatch() { return this.activeMatch; }
  getCurrentPing() { return this.currentPingMs; }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearLatencyProbe();
    this.socket?.close(1000, "client disconnect");
    this.socket = null;
    this.connectPromise = null;
    this.queued = false;
  }

  resetForTests() {
    this.disconnect();
    this.activeMatch = null;
    this.listeners.clear();
    this.everConnected = false;
    this.reconnectAttempt = 0;
    this.lastPlayerName = null;
    this.resumableMatch = null;
    this.currentPingMs = 0;
  }
}

export const networkManager = new NetworkManager();
