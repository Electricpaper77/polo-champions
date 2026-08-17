import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  HistoricalStateBuffer,
  evaluateRewoundRideOff,
  evaluateRewoundStrike,
  expireReconnectSlots,
  markPlayerDisconnected,
  reclaimPlayerSlot,
  shouldRetireRoom,
} from "./MatchManager.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const SIMULATION_HZ = 60;
const NETWORK_HZ = 20;
const HEARTBEAT_INTERVAL_MS = 15_000;
const CAPACITY = 12;
const ENTITY_IDS = ["player", "blue_2", "blue_3", "blue_4", "blue_5", "blue_6", "red_1", "red_2", "red_3", "red_4", "red_5", "red_6"];
const STARTS = [[0, 28, Math.PI], [-13, 22, Math.PI], [13, 22, Math.PI], [0, 15, Math.PI], [-14, 10, Math.PI], [14, 10, Math.PI], [0, -28, 0], [13, -22, 0], [-13, -22, 0], [0, -15, 0], [14, -10, 0], [-14, -10, 0]];
const POWER_IDS = new Set(["blue_4", "blue_6", "red_4", "red_6"]);
const SPRINTER_IDS = new Set(["blue_2", "blue_5", "red_1", "red_3"]);
const gait = speed => speed < .05 ? "IDLE" : speed < 5 ? "WALK" : speed < 11 ? "TROT" : speed < 19 ? "CANTER" : "GALLOP";
const mass = id => POWER_IDS.has(id) ? 1.3 : SPRINTER_IDS.has(id) ? .85 : 1;
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const initialState = () => ({ tick: 0, serverTime: Date.now(), ackSequence: 0, entities: ENTITY_IDS.map((id, index) => ({ id, position: { x: STARTS[index][0], z: STARTS[index][1] }, velocity: { x: 0, z: 0 }, heading: STARTS[index][2], gait: "IDLE" })), ball: { position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, y: .65 } });
const compress = (state, ackSequence = 0) => [state.tick, state.serverTime, state.entities.map(entity => [entity.id, entity.position.x, entity.position.z, entity.velocity.x, entity.velocity.z, entity.heading, entity.gait]), [state.ball.position.x, state.ball.position.z, state.ball.velocity.x, state.ball.velocity.z, state.ball.y], ackSequence];
const rooms = new Map();
let queue = [];

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const socket of room.clients.keys()) send(socket, message);
}

function queueStatus() {
  queue.forEach(client => send(client.socket, { type: "QUEUE_STATUS", payload: { players: queue.length, capacity: CAPACITY, roomId: "kings-cup-queue" } }));
}

function startRoom() {
  if (!queue.length) return;
  const humans = queue.splice(0, CAPACITY);
  const id = `kings-cup-${Date.now()}`;
  const state = initialState();
  const room = {
    id,
    state,
    clients: new Map(),
    slots: new Map(),
    inputs: new Map(),
    acks: new Map(),
    processed: new Map(),
    strikes: new Map(),
    pings: new Map(),
    history: new HistoricalStateBuffer(),
    emptySince: null,
  };
  room.history.record(state, state.serverTime);
  humans.forEach((client, index) => {
    const assignedEntityId = ENTITY_IDS[index];
    const reconnectToken = randomUUID();
    room.clients.set(client.socket, assignedEntityId);
    room.slots.set(assignedEntityId, {
      entityId: assignedEntityId,
      playerName: client.name,
      reconnectToken,
      control: "HUMAN",
      socket: client.socket,
      disconnectedAt: null,
      reconnectDeadline: null,
    });
    send(client.socket, { type: "MATCH_START", payload: { matchId: id, assignedEntityId, reconnectToken, initialState: compress(state), mode: "WEBSOCKET" } });
  });
  rooms.set(id, room);
  queueStatus();
}

function updateHuman(room, entity, command, delta) {
  const input = command.input ?? {};
  const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
  const target = input.brake ? 0 : (input.throttle ?? 0) * (input.gallop ? 30 : 18);
  const next = speed + Math.max(-22 * delta, Math.min(15 * delta, target - speed));
  const turnAuthority = 1.8 * (1 - Math.min(speed / 32, .58));
  entity.heading += (input.steer ?? 0) * turnAuthority * delta;
  entity.velocity = { x: Math.sin(entity.heading) * next, z: Math.cos(entity.heading) * next };
  const lastProcessed = room.processed.get(entity.id) ?? 0;
  if (command.sequence > lastProcessed) {
    room.processed.set(entity.id, command.sequence);
    room.acks.set(entity.id, command.sequence);
    const holding = Boolean(input.strike || input.power || input.backhand);
    const strike = room.strikes.get(entity.id) ?? { holding: false, startedAt: command.clientTime, backhand: false, aimX: 0 };
    if (holding && !strike.holding) room.strikes.set(entity.id, { holding: true, startedAt: command.clientTime, backhand: Boolean(input.backhand), aimX: Number(input.aimX ?? 0) });
    if (!holding && strike.holding) {
      room.strikes.set(entity.id, { holding: false, startedAt: command.clientTime, backhand: false, aimX: 0 });
      const rewind = evaluateRewoundStrike(room.history, entity.id, command.receivedAt, command.reportedPingMs);
      if (rewind.valid) {
        const charge = Math.max(.1, Math.min(1, (command.clientTime - strike.startedAt) / 900));
        const aim = entity.heading + strike.aimX * .38 + (strike.backhand ? Math.PI : 0);
        const impulse = 12 + charge * 16 + Math.abs(next) * .18;
        room.state.ball.velocity = { x: Math.sin(aim) * impulse, z: Math.cos(aim) * impulse };
      }
    }
  }
  entity.gait = gait(Math.abs(next));
}

function updateBot(entity, ball, delta) {
  const dx = ball.position.x - entity.position.x;
  const dz = ball.position.z - entity.position.z;
  const desired = Math.atan2(dx, dz);
  entity.heading += Math.max(-1.3 * delta, Math.min(1.3 * delta, angleDelta(entity.heading, desired)));
  const speed = POWER_IDS.has(entity.id) ? 3.3 : SPRINTER_IDS.has(entity.id) ? 4.8 : 4;
  entity.velocity = { x: Math.sin(entity.heading) * speed, z: Math.cos(entity.heading) * speed };
  entity.gait = gait(speed);
}

function applyRideOffs(room, delta, now) {
  const { entities } = room.state;
  for (let firstIndex = 0; firstIndex < entities.length; firstIndex += 1) for (let secondIndex = firstIndex + 1; secondIndex < entities.length; secondIndex += 1) {
    const first = entities[firstIndex];
    const second = entities[secondIndex];
    const reportedPing = Math.max(room.pings.get(first.id) ?? 0, room.pings.get(second.id) ?? 0);
    const rewind = evaluateRewoundRideOff(room.history, first.id, second.id, now, reportedPing);
    if (!rewind.valid || !rewind.first || !rewind.second) continue;
    const dx = rewind.first.position.x - rewind.second.position.x;
    const dz = rewind.first.position.z - rewind.second.position.z;
    const distance = rewind.distance || 1;
    const nx = dx / distance;
    const nz = dz / distance;
    const total = mass(first.id) + mass(second.id);
    const penetration = (1.5 - distance) * 12 * delta;
    first.position.x += nx * penetration * mass(second.id) / total;
    first.position.z += nz * penetration * mass(second.id) / total;
    second.position.x -= nx * penetration * mass(first.id) / total;
    second.position.z -= nz * penetration * mass(first.id) / total;
  }
}

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", socket => {
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  socket.on("message", data => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return send(socket, { type: "ERROR", payload: { message: "Malformed message" } }); }
    if (message.type === "JOIN_QUEUE") {
      if (!queue.some(item => item.socket === socket)) queue.push({ socket, name: String(message.payload?.playerName ?? "PLAYER") });
      queueStatus();
      if (queue.length >= CAPACITY) startRoom();
      else setTimeout(() => { if (queue.some(item => item.socket === socket)) startRoom(); }, 3000);
    } else if (message.type === "RECONNECT") {
      const room = rooms.get(message.payload?.matchId);
      const reclaimed = room && reclaimPlayerSlot(room, socket, message.payload?.reconnectToken);
      if (!room || !reclaimed) return send(socket, { type: "ERROR", payload: { message: "Reconnect window expired or token invalid" } });
      send(socket, { type: "MATCH_START", payload: { matchId: room.id, assignedEntityId: reclaimed.entityId, reconnectToken: reclaimed.reconnectToken, initialState: compress(room.state, room.acks.get(reclaimed.entityId) ?? 0), mode: "WEBSOCKET" } });
      broadcast(room, { type: "PLAYER_CONTROL_CHANGED", payload: reclaimed });
    } else if (message.type === "INPUT") {
      const room = rooms.get(message.payload?.matchId);
      const entityId = room?.clients.get(socket);
      if (room && entityId === message.payload.entityId && Number.isSafeInteger(message.payload.command?.sequence)) {
        const reportedPingMs = Math.max(0, Math.min(1_000, Number(message.payload.command.reportedPingMs) || 0));
        room.pings.set(entityId, reportedPingMs);
        room.inputs.set(entityId, { ...message.payload.command, reportedPingMs, receivedAt: Date.now() });
      }
    } else if (message.type === "PING") {
      send(socket, { type: "PONG", payload: { clientTime: Number(message.payload?.clientTime), serverTime: Date.now() } });
    }
  });
  socket.on("close", () => {
    queue = queue.filter(item => item.socket !== socket);
    for (const room of rooms.values()) {
      const event = markPlayerDisconnected(room, socket);
      if (event) broadcast(room, { type: "PLAYER_CONTROL_CHANGED", payload: event });
    }
    queueStatus();
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) socket.terminate();
    else {
      socket.isAlive = false;
      socket.ping();
    }
  }
}, HEARTBEAT_INTERVAL_MS);
wss.on("close", () => clearInterval(heartbeat));

setInterval(() => {
  const delta = 1 / SIMULATION_HZ;
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    expireReconnectSlots(room, now);
    if (shouldRetireRoom(room, now)) {
      rooms.delete(roomId);
      continue;
    }
    room.state.tick += 1;
    room.state.serverTime = now;
    for (const entity of room.state.entities) {
      const slot = room.slots.get(entity.id);
      const command = room.inputs.get(entity.id);
      if (slot?.control === "HUMAN" && command) updateHuman(room, entity, command, delta);
      else if (slot?.control === "HUMAN") {
        entity.velocity.x *= .85;
        entity.velocity.z *= .85;
        entity.gait = gait(Math.hypot(entity.velocity.x, entity.velocity.z));
      } else updateBot(entity, room.state.ball, delta);
      entity.position.x = Math.max(-24, Math.min(24, entity.position.x + entity.velocity.x * delta));
      entity.position.z = Math.max(-39, Math.min(39, entity.position.z + entity.velocity.z * delta));
    }
    applyRideOffs(room, delta, now);
    room.state.ball.position.x += room.state.ball.velocity.x * delta;
    room.state.ball.position.z += room.state.ball.velocity.z * delta;
    room.state.ball.velocity.x *= .985;
    room.state.ball.velocity.z *= .985;
    if (Math.abs(room.state.ball.position.z) > 42 || Math.abs(room.state.ball.position.x) > 26) room.state.ball = { position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, y: .65 };
    room.history.record(room.state, now);
    if (room.state.tick % (SIMULATION_HZ / NETWORK_HZ) === 0) for (const [socket, entityId] of room.clients) send(socket, { type: "STATE_SNAPSHOT", payload: compress(room.state, room.acks.get(entityId) ?? 0) });
  }
}, 1000 / SIMULATION_HZ);

console.log(`Polo Champions realtime server listening on ws://0.0.0.0:${PORT}`);
