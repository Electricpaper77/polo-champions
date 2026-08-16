import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8081);
const SIMULATION_HZ = 60;
const NETWORK_HZ = 20;
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

function queueStatus() {
  queue.forEach(client => send(client.socket, { type: "QUEUE_STATUS", payload: { players: queue.length, capacity: CAPACITY, roomId: "kings-cup-queue" } }));
}

function startRoom() {
  if (!queue.length) return;
  const humans = queue.splice(0, CAPACITY);
  const id = `kings-cup-${Date.now()}`;
  const state = initialState();
  const room = { id, state, clients: new Map(), inputs: new Map(), acks: new Map(), processed: new Map(), strikes: new Map() };
  humans.forEach((client, index) => {
    const assignedEntityId = ENTITY_IDS[index];
    room.clients.set(client.socket, assignedEntityId);
    send(client.socket, { type: "MATCH_START", payload: { matchId: id, assignedEntityId, initialState: compress(state), mode: "WEBSOCKET" } });
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
      const distance = Math.hypot(entity.position.x - room.state.ball.position.x, entity.position.z - room.state.ball.position.z);
      if (distance < 5) {
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

function applyRideOffs(entities, delta) {
  for (let first = 0; first < entities.length; first += 1) for (let second = first + 1; second < entities.length; second += 1) {
    const a = entities[first], b = entities[second];
    const dx = a.position.x - b.position.x, dz = a.position.z - b.position.z, distance = Math.hypot(dx, dz);
    if (distance <= 0 || distance >= 1.5 || Math.abs(angleDelta(a.heading, b.heading)) > Math.PI / 4) continue;
    const nx = dx / distance, nz = dz / distance, total = mass(a.id) + mass(b.id);
    const penetration = (1.5 - distance) * 12 * delta;
    a.position.x += nx * penetration * mass(b.id) / total;
    a.position.z += nz * penetration * mass(b.id) / total;
    b.position.x -= nx * penetration * mass(a.id) / total;
    b.position.z -= nz * penetration * mass(a.id) / total;
  }
}

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", socket => {
  socket.on("message", data => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return send(socket, { type: "ERROR", payload: { message: "Malformed message" } }); }
    if (message.type === "JOIN_QUEUE") {
      if (!queue.some(item => item.socket === socket)) queue.push({ socket, name: String(message.payload?.playerName ?? "PLAYER") });
      queueStatus();
      if (queue.length >= CAPACITY) startRoom();
      else setTimeout(() => { if (queue.some(item => item.socket === socket)) startRoom(); }, 3000);
    } else if (message.type === "INPUT") {
      const room = rooms.get(message.payload?.matchId), entityId = room?.clients.get(socket);
      if (room && entityId === message.payload.entityId && Number.isSafeInteger(message.payload.command?.sequence)) room.inputs.set(entityId, message.payload.command);
    }
  });
  socket.on("close", () => {
    queue = queue.filter(item => item.socket !== socket);
    for (const [roomId, room] of rooms) {
      room.clients.delete(socket);
      if (!room.clients.size) rooms.delete(roomId);
    }
    queueStatus();
  });
});

setInterval(() => {
  const delta = 1 / SIMULATION_HZ;
  for (const room of rooms.values()) {
    room.state.tick += 1;
    room.state.serverTime = Date.now();
    for (const entity of room.state.entities) {
      const command = room.inputs.get(entity.id);
      if (command) updateHuman(room, entity, command, delta); else updateBot(entity, room.state.ball, delta);
      entity.position.x = Math.max(-24, Math.min(24, entity.position.x + entity.velocity.x * delta));
      entity.position.z = Math.max(-39, Math.min(39, entity.position.z + entity.velocity.z * delta));
    }
    applyRideOffs(room.state.entities, delta);
    room.state.ball.position.x += room.state.ball.velocity.x * delta;
    room.state.ball.position.z += room.state.ball.velocity.z * delta;
    room.state.ball.velocity.x *= .985;
    room.state.ball.velocity.z *= .985;
    if (Math.abs(room.state.ball.position.z) > 42 || Math.abs(room.state.ball.position.x) > 26) room.state.ball = { position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, y: .65 };
    if (room.state.tick % (SIMULATION_HZ / NETWORK_HZ) === 0) for (const [socket, entityId] of room.clients) send(socket, { type: "STATE_SNAPSHOT", payload: compress(room.state, room.acks.get(entityId) ?? 0) });
  }
}, 1000 / SIMULATION_HZ);

console.log(`Polo Champions realtime server listening on ws://127.0.0.1:${PORT}`);
