export const HISTORY_WINDOW_MS = 500;
export const RECONNECT_WINDOW_MS = 60_000;
export const MAX_REPORTED_PING_MS = 1_000;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function copyState(state, timestamp) {
  return {
    timestamp,
    entities: state.entities.map(entity => ({
      id: entity.id,
      position: { ...entity.position },
      velocity: { ...entity.velocity },
      heading: entity.heading,
    })),
    ball: {
      position: { ...state.ball.position },
      velocity: { ...state.ball.velocity },
      y: state.ball.y,
    },
  };
}

function interpolateAngle(from, to, amount) {
  return from + angleDelta(from, to) * amount;
}

export class HistoricalStateBuffer {
  constructor(windowMs = HISTORY_WINDOW_MS) {
    this.windowMs = windowMs;
    this.snapshots = [];
  }

  record(state, timestamp = state.serverTime) {
    if (!Number.isFinite(timestamp)) throw new Error("Historical snapshots require a finite timestamp");
    const snapshot = copyState(state, timestamp);
    const existing = this.snapshots.findIndex(value => value.timestamp === timestamp);
    if (existing >= 0) this.snapshots[existing] = snapshot;
    else this.snapshots.push(snapshot);
    this.snapshots.sort((a, b) => a.timestamp - b.timestamp);
    const cutoff = timestamp - this.windowMs;
    while (this.snapshots.length > 1 && this.snapshots[1].timestamp < cutoff) this.snapshots.shift();
  }

  sample(timestamp) {
    if (!this.snapshots.length) return null;
    if (timestamp <= this.snapshots[0].timestamp) return copyState(this.snapshots[0], this.snapshots[0].timestamp);
    const last = this.snapshots[this.snapshots.length - 1];
    if (timestamp >= last.timestamp) return copyState(last, last.timestamp);
    const afterIndex = this.snapshots.findIndex(value => value.timestamp >= timestamp);
    const before = this.snapshots[afterIndex - 1];
    const after = this.snapshots[afterIndex];
    const amount = clamp((timestamp - before.timestamp) / Math.max(1, after.timestamp - before.timestamp), 0, 1);
    const beforeById = new Map(before.entities.map(entity => [entity.id, entity]));
    return {
      timestamp,
      entities: after.entities.map(entity => {
        const start = beforeById.get(entity.id) ?? entity;
        return {
          ...entity,
          position: {
            x: start.position.x + (entity.position.x - start.position.x) * amount,
            z: start.position.z + (entity.position.z - start.position.z) * amount,
          },
          velocity: {
            x: start.velocity.x + (entity.velocity.x - start.velocity.x) * amount,
            z: start.velocity.z + (entity.velocity.z - start.velocity.z) * amount,
          },
          heading: interpolateAngle(start.heading, entity.heading, amount),
        };
      }),
      ball: {
        position: {
          x: before.ball.position.x + (after.ball.position.x - before.ball.position.x) * amount,
          z: before.ball.position.z + (after.ball.position.z - before.ball.position.z) * amount,
        },
        velocity: {
          x: before.ball.velocity.x + (after.ball.velocity.x - before.ball.velocity.x) * amount,
          z: before.ball.velocity.z + (after.ball.velocity.z - before.ball.velocity.z) * amount,
        },
        y: before.ball.y + (after.ball.y - before.ball.y) * amount,
      },
    };
  }

  size() {
    return this.snapshots.length;
  }
}

export function lagCompensatedTimestamp(receivedAt, reportedPingMs) {
  const ping = clamp(Number(reportedPingMs) || 0, 0, MAX_REPORTED_PING_MS);
  return receivedAt - ping / 2;
}

export function evaluateRewoundStrike(history, entityId, receivedAt, reportedPingMs, range = 5) {
  const snapshot = history.sample(lagCompensatedTimestamp(receivedAt, reportedPingMs));
  const entity = snapshot?.entities.find(value => value.id === entityId);
  if (!snapshot || !entity) return { valid: false, snapshot: null };
  const distance = Math.hypot(
    entity.position.x - snapshot.ball.position.x,
    entity.position.z - snapshot.ball.position.z,
  );
  return { valid: distance < range, snapshot, distance };
}

export function evaluateRewoundRideOff(history, firstId, secondId, receivedAt, reportedPingMs, radius = 1.5) {
  const snapshot = history.sample(lagCompensatedTimestamp(receivedAt, reportedPingMs));
  const first = snapshot?.entities.find(value => value.id === firstId);
  const second = snapshot?.entities.find(value => value.id === secondId);
  if (!snapshot || !first || !second) return { valid: false, snapshot: null };
  const distance = Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z);
  const entryAngle = Math.abs(angleDelta(first.heading, second.heading));
  return { valid: distance > 0 && distance < radius && entryAngle <= Math.PI / 4, snapshot, first, second, distance, entryAngle };
}

export function markPlayerDisconnected(room, socket, now = Date.now()) {
  const entityId = room.clients.get(socket);
  if (!entityId) return null;
  room.clients.delete(socket);
  room.inputs.delete(entityId);
  const slot = room.slots.get(entityId);
  if (!slot) return null;
  Object.assign(slot, {
    control: "AI",
    socket: null,
    disconnectedAt: now,
    reconnectDeadline: now + RECONNECT_WINDOW_MS,
  });
  if (!room.clients.size) room.emptySince = now;
  return {
    entityId,
    playerName: slot.playerName,
    state: "AI_BACKFILL",
    reconnectDeadline: slot.reconnectDeadline,
  };
}

export function reclaimPlayerSlot(room, socket, reconnectToken, now = Date.now()) {
  const slot = [...room.slots.values()].find(value => value.reconnectToken === reconnectToken);
  if (!slot || slot.control !== "AI" || !slot.reconnectDeadline || now > slot.reconnectDeadline) return null;
  Object.assign(slot, { control: "HUMAN", socket, disconnectedAt: null, reconnectDeadline: null });
  room.clients.set(socket, slot.entityId);
  room.emptySince = null;
  return {
    entityId: slot.entityId,
    playerName: slot.playerName,
    reconnectToken: slot.reconnectToken,
    state: "RECONNECTED",
  };
}

export function expireReconnectSlots(room, now = Date.now()) {
  for (const slot of room.slots.values()) {
    if (slot.control === "AI" && slot.reconnectDeadline && now > slot.reconnectDeadline) {
      slot.reconnectToken = null;
      slot.reconnectDeadline = null;
    }
  }
}

export function shouldRetireRoom(room, now = Date.now()) {
  return room.clients.size === 0 && room.emptySince !== null && now - room.emptySince > RECONNECT_WINDOW_MS;
}
