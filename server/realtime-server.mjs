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
const NORMAL_RIDE_SPEED = 16;
const MAX_GALLOP_SPEED = 18.05;
const ACCELERATION_TAU = 1.5;
const COAST_TAU = 1.0;
const BRAKE_TAU = 0.45;
const GALLOP_GAIT_THRESHOLD = MAX_GALLOP_SPEED * .75;
const BASE_BALL_IMPULSE = 14;
const MIN_SWING_POWER = .5;
const MAX_SWING_POWER = 2;
const BALL_FIELD_DRAG = .9;
const BALL_STOP_SPEED = .08;
const BALL_FLOOR_Y = .65;
const BALL_GRAVITY = 9.81;
const MALLET_CONTACT_RADIUS = 1.05;
const GOAL_LINE_Z = 42;
const GOAL_HALF_WIDTH = 5;
const GOAL_CELEBRATION_MS = 1800;
const RIDE_OFF_ACTIVE_MULTIPLIER = 1.45;
const MAX_RIDE_OFF_DEFLECTION = 5;
const ENTITY_IDS = ["player", "blue_2", "blue_3", "blue_4", "blue_5", "blue_6", "red_1", "red_2", "red_3", "red_4", "red_5", "red_6"];
const STARTS = [[0, 28, Math.PI], [-13, 22, Math.PI], [13, 22, Math.PI], [0, 15, Math.PI], [-14, 10, Math.PI], [14, 10, Math.PI], [0, -28, 0], [13, -22, 0], [-13, -22, 0], [0, -15, 0], [14, -10, 0], [-14, -10, 0]];
const START_BY_ID = new Map(ENTITY_IDS.map((id, index) => [id, STARTS[index]]));
const POWER_IDS = new Set(["blue_4", "blue_6", "red_4", "red_6"]);
const SPRINTER_IDS = new Set(["blue_2", "blue_5", "red_1", "red_3"]);
const STRIKER_IDS = new Set(["blue_2", "blue_3", "blue_5", "red_1", "red_2", "red_3", "red_5"]);
const MIN_RIDER_SEPARATION = 2.6;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const exponentialAlpha = (dt, tau) => dt <= 0 ? 0 : 1 - Math.exp(-dt / Math.max(tau, Number.EPSILON));
const steeringRate = (speed, agility = 1) => {
  const ratio = clamp(Math.abs(speed) / MAX_GALLOP_SPEED, 0, 1);
  const penalty = ratio * ratio * (3 - 2 * ratio);
  return lerp(1.5, .55, penalty) * agility;
};
const gait = speed => speed < .2 ? "IDLE" : speed < 5 ? "WALK" : speed < 11 ? "TROT" : speed < GALLOP_GAIT_THRESHOLD ? "CANTER" : "GALLOP";
const swingPowerMultiplier = charge => lerp(MIN_SWING_POWER, MAX_SWING_POWER, clamp(charge, 0, 1));
const malletHeadPosition = (position, yaw, aimX, backhand, progress) => {
  const aimedYaw = yaw + clamp(aimX, -1, 1) * .38;
  const forward = { x:Math.sin(aimedYaw), z:Math.cos(aimedYaw) };
  const right = { x:Math.cos(aimedYaw), z:-Math.sin(aimedYaw) };
  const side = backhand ? -1 : 1;
  const localForward = lerp(-.4, 3.7, progress);
  const localSide = side * (2.05 - Math.sin(Math.PI * progress) * 1.15);
  return { x:position.x + forward.x * localForward + right.x * localSide, z:position.z + forward.z * localForward + right.z * localSide };
};
const pointSegmentDistance = (point, start, end) => {
  const dx = end.x - start.x, dz = end.z - start.z, lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared > 0 ? clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount));
};
const malletSweepHits = (entity, ball, aimX, backhand) => {
  let previous = malletHeadPosition(entity.position, entity.heading, aimX, backhand, 0);
  for (let step = 1; step <= 8; step += 1) {
    const current = malletHeadPosition(entity.position, entity.heading, aimX, backhand, step / 8);
    if (pointSegmentDistance(ball, previous, current) <= MALLET_CONTACT_RADIUS) return true;
    previous = current;
  }
  return false;
};
const ballReleaseVelocity = (entity, aimX, aimY, backhand, charge) => {
  const localX = clamp(aimX, -1, 1) * .7, magnitude = Math.hypot(localX, 1);
  const direction = {
    x:(localX * Math.cos(entity.heading) + Math.sin(entity.heading)) / magnitude,
    z:(-localX * Math.sin(entity.heading) + Math.cos(entity.heading)) / magnitude,
  };
  if (backhand) { direction.x *= -1; direction.z *= -1; }
  const normalizedCharge = clamp(charge, 0, 1), power = BASE_BALL_IMPULSE * swingPowerMultiplier(normalizedCharge);
  return {
    x:entity.velocity.x + direction.x * power,
    y:.65 + normalizedCharge * 4.35 + clamp(aimY, -1, 1),
    z:entity.velocity.z + direction.z * power,
  };
};
const applyBallFieldDrag = (velocity, delta) => {
  const attenuation = Math.exp(-BALL_FIELD_DRAG * Math.max(0, delta));
  const next = { x:velocity.x * attenuation, z:velocity.z * attenuation };
  return Math.hypot(next.x, next.z) < BALL_STOP_SPEED ? { x:0, z:0 } : next;
};
const detectGoalCrossing = (previous, current) => {
  const dz = current.z - previous.z;
  if (Math.abs(dz) < Number.EPSILON) return null;
  const crossingX = line => {
    const amount = (line - previous.z) / dz;
    return amount < 0 || amount > 1 ? null : previous.x + (current.x - previous.x) * amount;
  };
  if (previous.z >= -GOAL_LINE_Z && current.z < -GOAL_LINE_Z) {
    const x = crossingX(-GOAL_LINE_Z);
    if (x !== null && Math.abs(x) < GOAL_HALF_WIDTH) return "blue";
  }
  if (previous.z <= GOAL_LINE_Z && current.z > GOAL_LINE_Z) {
    const x = crossingX(GOAL_LINE_Z);
    if (x !== null && Math.abs(x) < GOAL_HALF_WIDTH) return "red";
  }
  return null;
};
const mass = id => POWER_IDS.has(id) ? 1.3 : SPRINTER_IDS.has(id) ? .85 : 1;
const archetypeTuning = id => POWER_IDS.has(id)
  ? { acceleration:.9, topSpeed:.9, agility:.85 }
  : SPRINTER_IDS.has(id)
    ? { acceleration:1.2, topSpeed:1.2, agility:1.15 }
    : { acceleration:1, topSpeed:1, agility:1 };
const targetSpeed = (input, tuning) => {
  if (input.brake) return 0;
  const throttle = Number(input.throttle ?? 0);
  const requested = throttle > 0
    ? throttle * (input.gallop ? MAX_GALLOP_SPEED : NORMAL_RIDE_SPEED) * tuning.topSpeed
    : throttle * NORMAL_RIDE_SPEED * tuning.topSpeed;
  return clamp(requested, -MAX_GALLOP_SPEED, MAX_GALLOP_SPEED);
};
const integrateHorseMotion = (entity, input, delta) => {
  const safeDelta = Math.max(0, delta);
  const tuning = archetypeTuning(entity.id);
  const currentSpeed = Math.hypot(entity.velocity.x, entity.velocity.z);
  const target = targetSpeed(input, tuning);
  const currentForward = { x:Math.sin(entity.heading), z:Math.cos(entity.heading) };
  const signedForwardSpeed = entity.velocity.x * currentForward.x + entity.velocity.z * currentForward.z;
  const direction = Math.abs(signedForwardSpeed) > .05 ? Math.sign(signedForwardSpeed) : target < 0 ? -1 : 1;
  const heading = entity.heading + clamp(Number(input.steer ?? 0), -1, 1) * steeringRate(currentSpeed, tuning.agility) * direction * safeDelta;
  const desiredVelocity = { x:Math.sin(heading) * target, z:Math.cos(heading) * target };
  const tau = input.brake ? BRAKE_TAU : Math.abs(target) > currentSpeed ? ACCELERATION_TAU / tuning.acceleration : COAST_TAU;
  const alpha = exponentialAlpha(safeDelta, tau);
  let velocity = {
    x:lerp(entity.velocity.x, desiredVelocity.x, alpha),
    z:lerp(entity.velocity.z, desiredVelocity.z, alpha),
  };
  const magnitude = Math.hypot(velocity.x, velocity.z);
  if (magnitude > MAX_GALLOP_SPEED) {
    const scale = MAX_GALLOP_SPEED / magnitude;
    velocity = { x:velocity.x * scale, z:velocity.z * scale };
  }
  return {
    heading,
    velocity,
    position:{x:entity.position.x + velocity.x * safeDelta, z:entity.position.z + velocity.z * safeDelta},
  };
};
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const initialState = () => ({ tick: 0, serverTime: Date.now(), ackSequence: 0, started: false, entities: ENTITY_IDS.map((id, index) => ({ id, position: { x: STARTS[index][0], z: STARTS[index][1] }, velocity: { x: 0, z: 0 }, heading: STARTS[index][2], gait: "IDLE" })), ball: { position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, y: BALL_FLOOR_Y, verticalVelocity: 0 } });
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
    botStrikeCooldowns: new Map(),
    score: { blue:0, red:0 },
    goalCelebrationUntil: null,
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
  const hasPlayerIntent = Math.abs(input.throttle ?? 0) > .01 || Math.abs(input.steer ?? 0) > .01 || input.strike || input.backhand || input.rideOff;
  const frozenAtKickoff = !room.state.started && !hasPlayerIntent;
  if (!room.state.started && hasPlayerIntent) room.state.started = true;
  if (frozenAtKickoff) {
    entity.velocity = {x:0,z:0};
    entity.gait = "IDLE";
  } else {
    const motion = integrateHorseMotion(entity, input, delta);
    entity.position = motion.position;
    entity.velocity = motion.velocity;
    entity.heading = motion.heading;
    entity.gait = gait(Math.hypot(motion.velocity.x, motion.velocity.z));
  }
  const next = Math.hypot(entity.velocity.x, entity.velocity.z);
  const lastProcessed = room.processed.get(entity.id) ?? 0;
  if (command.sequence > lastProcessed) {
    room.processed.set(entity.id, command.sequence);
    room.acks.set(entity.id, command.sequence);
    const holding = Boolean(input.strike || input.backhand);
    const strike = room.strikes.get(entity.id) ?? { holding: false, startedAt: command.clientTime, backhand: false, aimX: 0, aimY: 0, power: false };
    if (holding && !strike.holding) room.strikes.set(entity.id, { holding: true, startedAt: command.clientTime, backhand: Boolean(input.backhand), aimX: Number(input.aimX ?? 0), aimY: Number(input.aimY ?? 0), power: Boolean(input.power) });
    else if (holding) room.strikes.set(entity.id, { ...strike, aimX: Number(input.aimX ?? strike.aimX), aimY: Number(input.aimY ?? strike.aimY), power: strike.power || Boolean(input.power) });
    if (!holding && strike.holding) {
      room.strikes.set(entity.id, { holding: false, startedAt: command.clientTime, backhand: false, aimX: 0, aimY: 0, power: false });
      const rewind = evaluateRewoundStrike(room.history, entity.id, command.receivedAt, command.reportedPingMs);
      const rewoundEntity = rewind.snapshot?.entities.find(value => value.id === entity.id);
      const releasedAimX = Number(input.aimX ?? strike.aimX);
      const releasedAimY = Number(input.aimY ?? strike.aimY);
      if (rewind.valid && rewoundEntity && malletSweepHits(rewoundEntity, rewind.snapshot.ball.position, releasedAimX, strike.backhand)) {
        const charge = clamp((command.clientTime - strike.startedAt) / 900, 0, 1) * (strike.power ? 1.5 : 1);
        const release = ballReleaseVelocity(rewoundEntity, releasedAimX, releasedAimY, strike.backhand, charge);
        room.state.ball.velocity = { x:release.x, z:release.z };
        room.state.ball.verticalVelocity = release.y;
      }
    }
  }
  entity.gait = gait(Math.abs(next));
}

const entityTeam = entity => entity.id.startsWith("red_") ? "red" : "blue";
const ballInPlay = ball => Math.hypot(ball.position.x, ball.position.z) >= 1.2 || Math.hypot(ball.velocity.x, ball.velocity.z) >= .45;

function assignBotRoles(room) {
  const roles = new Map();
  for (const team of ["blue", "red"]) {
    const teamBots = room.state.entities.filter(entity => entity.id !== "player" && entityTeam(entity) === team && room.slots.get(entity.id)?.control !== "HUMAN");
    const attackers = teamBots.filter(entity => STRIKER_IDS.has(entity.id)).sort((a, b) => Math.hypot(a.position.x - room.state.ball.position.x, a.position.z - room.state.ball.position.z) - Math.hypot(b.position.x - room.state.ball.position.x, b.position.z - room.state.ball.position.z) || a.id.localeCompare(b.id));
    if (attackers[0]) roles.set(attackers[0].id, "BALL_ATTACKER");
    for (const entity of teamBots) if (!roles.has(entity.id)) roles.set(entity.id, POWER_IDS.has(entity.id) ? "DEFENDER" : "OFFENSE_SUPPORT");
  }
  return roles;
}

function updateBot(room, entity, roles, delta) {
  const team = entityTeam(entity), start = START_BY_ID.get(entity.id), active = room.state.started && ballInPlay(room.state.ball), role = roles.get(entity.id) ?? (POWER_IDS.has(entity.id) ? "DEFENDER" : "OFFENSE_SUPPORT"), chaser = active && role === "BALL_ATTACKER";
  const attackDirection = team === "blue" ? -1 : 1;
  const lane = start[0] < 0 ? -5 : 5;
  const ownGoalZ = team === "blue" ? 38 : -38;
  const target = !active
    ? { x:start[0], z:start[1] }
    : role === "BALL_ATTACKER"
      ? room.state.ball.position
      : role === "OFFENSE_SUPPORT"
        ? { x:clamp(room.state.ball.position.x + lane, -20, 20), z:clamp(room.state.ball.position.z - attackDirection * 7, -35, 35) }
        : { x:clamp(start[0] * .65 + room.state.ball.position.x * .35, -20, 20), z:clamp(ownGoalZ + (room.state.ball.position.z - ownGoalZ) * .28, -37, 37) };
  const dx = target.x - entity.position.x, dz = target.z - entity.position.z, distance = Math.hypot(dx, dz);
  const desired = distance > .01 ? Math.atan2(dx, dz) : entity.heading;
  const throttle = distance < .35 ? 0 : role === "BALL_ATTACKER" ? .78 : role === "OFFENSE_SUPPORT" ? .4 : .34;
  const motion = integrateHorseMotion(entity, { throttle, steer:clamp(angleDelta(entity.heading, desired) / .65, -1, 1), gallop:role === "BALL_ATTACKER" && distance > 5, brake:distance < .65 }, delta);
  entity.position = motion.position;
  entity.velocity = motion.velocity;
  entity.heading = motion.heading;
  const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
  entity.gait = gait(speed);
  const cooldown = Math.max(0, (room.botStrikeCooldowns.get(entity.id) ?? 0) - delta);
  room.botStrikeCooldowns.set(entity.id, cooldown);
  const toBall = { x: room.state.ball.position.x - entity.position.x, z: room.state.ball.position.z - entity.position.z }, distanceToBall = Math.hypot(toBall.x, toBall.z), facingBall = (toBall.x * Math.sin(entity.heading) + toBall.z * Math.cos(entity.heading)) / (distanceToBall || 1);
  if (chaser && distanceToBall < 3.4 && facingBall > .72 && cooldown <= 0) {
    const goalZ = team === "blue" ? -43 : 43, goalDx = -room.state.ball.position.x, goalDz = goalZ - room.state.ball.position.z, shotHeading = Math.atan2(goalDx, goalDz);
    const release = ballReleaseVelocity({ ...entity, heading:shotHeading }, 0, -.25, false, .55);
    room.state.ball.velocity = { x:release.x, z:release.z };
    room.state.ball.verticalVelocity = release.y;
    room.botStrikeCooldowns.set(entity.id, 1.25);
  }
}

function applyRideOffs(room, delta, now) {
  const { entities } = room.state;
  for (let firstIndex = 0; firstIndex < entities.length; firstIndex += 1) for (let secondIndex = firstIndex + 1; secondIndex < entities.length; secondIndex += 1) {
    const first = entities[firstIndex];
    const second = entities[secondIndex];
    const currentDx = first.position.x - second.position.x, currentDz = first.position.z - second.position.z, currentDistance = Math.hypot(currentDx, currentDz);
    if (currentDistance >= MIN_RIDER_SEPARATION) continue;
    const nx = currentDistance > .0001 ? currentDx / currentDistance : first.id.localeCompare(second.id) <= 0 ? -1 : 1;
    const nz = currentDistance > .0001 ? currentDz / currentDistance : 0;
    const firstMass = mass(first.id), secondMass = mass(second.id), total = firstMass + secondMass, overlap = MIN_RIDER_SEPARATION - currentDistance;
    first.position.x += nx * overlap * secondMass / total;
    first.position.z += nz * overlap * secondMass / total;
    second.position.x -= nx * overlap * firstMass / total;
    second.position.z -= nz * overlap * firstMass / total;
    const reportedPing = Math.max(room.pings.get(first.id) ?? 0, room.pings.get(second.id) ?? 0);
    const rewind = evaluateRewoundRideOff(room.history, first.id, second.id, now, reportedPing);
    const firstRideOff = rewind.valid && Boolean(room.inputs.get(first.id)?.input?.rideOff);
    const secondRideOff = rewind.valid && Boolean(room.inputs.get(second.id)?.input?.rideOff);
    const firstSpeed = Math.hypot(first.velocity.x, first.velocity.z), secondSpeed = Math.hypot(second.velocity.x, second.velocity.z);
    const firstMomentum = firstMass * firstSpeed * (firstRideOff ? RIDE_OFF_ACTIVE_MULTIPLIER : 1);
    const secondMomentum = secondMass * secondSpeed * (secondRideOff ? RIDE_OFF_ACTIVE_MULTIPLIER : 1);
    const relativeVelocity = { x:first.velocity.x - second.velocity.x, z:first.velocity.z - second.velocity.z };
    const closingSpeed = Math.max(0, -(relativeVelocity.x * nx + relativeVelocity.z * nz));
    const advantage = firstMomentum - secondMomentum;
    const impulse = clamp(Math.abs(advantage) / total * .42 + closingSpeed * .5, 0, MAX_RIDE_OFF_DEFLECTION);
    if (impulse < .0001) continue;
    const firstWins = advantage > 0 || (Math.abs(advantage) < .0001 && first.id.localeCompare(second.id) < 0);
    const firstDeflection = impulse * (firstWins ? .22 : 1) * secondMass / total;
    const secondDeflection = impulse * (firstWins ? 1 : .22) * firstMass / total;
    first.velocity.x += nx * firstDeflection;
    first.velocity.z += nz * firstDeflection;
    second.velocity.x -= nx * secondDeflection;
    second.velocity.z -= nz * secondDeflection;
    first.position.x += nx * firstDeflection * delta;
    first.position.z += nz * firstDeflection * delta;
    second.position.x -= nx * secondDeflection * delta;
    second.position.z -= nz * secondDeflection * delta;
  }
}

function resetSimulation(room, resetScore = false) {
  room.state.ball = { position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, y: BALL_FLOOR_Y, verticalVelocity: 0 };
  room.state.started = false;
  room.goalCelebrationUntil = null;
  if (resetScore) room.score = { blue:0, red:0 };
  room.state.entities.forEach((entity,index)=>{entity.position={x:STARTS[index][0],z:STARTS[index][1]};entity.velocity={x:0,z:0};entity.heading=STARTS[index][2];entity.gait="IDLE";});
  room.inputs.clear();
  room.strikes.clear();
  room.botStrikeCooldowns.clear();
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
    } else if (message.type === "RESET_MATCH") {
      const room=rooms.get(message.payload?.matchId);
      if(room?.clients.has(socket))resetSimulation(room,true);
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
    if (room.goalCelebrationUntil) {
      if (now >= room.goalCelebrationUntil) resetSimulation(room);
      else {
        room.state.entities.forEach(entity => { entity.velocity = {x:0,z:0}; entity.gait = "IDLE"; });
        room.history.record(room.state, now);
        if (room.state.tick % (SIMULATION_HZ / NETWORK_HZ) === 0) for (const [socket, entityId] of room.clients) send(socket, { type:"STATE_SNAPSHOT", payload:compress(room.state, room.acks.get(entityId) ?? 0) });
        continue;
      }
    }
    const roles = assignBotRoles(room);
    for (const entity of room.state.entities) {
      const slot = room.slots.get(entity.id);
      const command = room.inputs.get(entity.id);
      let positionIntegrated = false;
      if (slot?.control === "HUMAN" && command) {
        updateHuman(room, entity, command, delta);
        positionIntegrated = true;
      }
      else if (slot?.control === "HUMAN") {
        if (!room.state.started) entity.velocity = {x:0,z:0};
        entity.gait = gait(Math.hypot(entity.velocity.x, entity.velocity.z));
      } else {
        updateBot(room, entity, roles, delta);
        positionIntegrated = true;
      }
      if (!positionIntegrated) {
        entity.position.x += entity.velocity.x * delta;
        entity.position.z += entity.velocity.z * delta;
      }
      entity.position.x = Math.max(-24, Math.min(24, entity.position.x));
      entity.position.z = Math.max(-39, Math.min(39, entity.position.z));
    }
    applyRideOffs(room, delta, now);
    const previousBall = { ...room.state.ball.position };
    room.state.ball.position.x += room.state.ball.velocity.x * delta;
    room.state.ball.position.z += room.state.ball.velocity.z * delta;
    room.state.ball.velocity = applyBallFieldDrag(room.state.ball.velocity, delta);
    room.state.ball.y += room.state.ball.verticalVelocity * delta;
    room.state.ball.verticalVelocity -= BALL_GRAVITY * delta;
    if (room.state.ball.y <= BALL_FLOOR_Y) {
      room.state.ball.y = BALL_FLOOR_Y;
      room.state.ball.verticalVelocity = 0;
    }
    const goalTeam = detectGoalCrossing(previousBall, room.state.ball.position);
    if (goalTeam) {
      room.score[goalTeam] += 1;
      room.state.started = false;
      room.state.ball.velocity = {x:0,z:0};
      room.state.ball.verticalVelocity = 0;
      room.goalCelebrationUntil = now + GOAL_CELEBRATION_MS;
      broadcast(room, { type:"GOAL_SCORED", payload:{ team:goalTeam, score:{...room.score}, celebrationMs:GOAL_CELEBRATION_MS } });
    } else if (Math.abs(room.state.ball.position.z) > GOAL_LINE_Z + 2 || Math.abs(room.state.ball.position.x) > 26) {
      resetSimulation(room);
    }
    room.history.record(room.state, now);
    if (room.state.tick % (SIMULATION_HZ / NETWORK_HZ) === 0) for (const [socket, entityId] of room.clients) send(socket, { type: "STATE_SNAPSHOT", payload: compress(room.state, room.acks.get(entityId) ?? 0) });
  }
}, 1000 / SIMULATION_HZ);

console.log(`Polo Champions realtime server listening on ws://0.0.0.0:${PORT}`);
