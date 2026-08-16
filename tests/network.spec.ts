import { expect, test } from "@playwright/test";
import { FixedTimestepLoop } from "../src/game/GameLoop";
import { PredictionController, SnapshotBuffer, compressSnapshot, createInitialNetworkSnapshot, decompressSnapshot, type InputCommand, type NetworkSnapshot } from "../src/game/NetworkSync";
import { NetworkManager, reconnectDelay, resolveWebSocketUrl, type WebSocketTransport } from "../src/services/NetworkManager";

class MockSocket implements WebSocketTransport {
  readyState = 0;
  sent: string[] = [];
  onopen = (_event: unknown) => undefined;
  onmessage = (_event: { data: unknown }) => undefined;
  onerror = (_event: unknown) => undefined;
  onclose = (_event: unknown) => undefined;
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose({}); }
  drop() { this.readyState = 3; this.onclose({}); }
  open() { this.readyState = 1; this.onopen({}); }
  serverSend(value: unknown) { this.onmessage({ data: JSON.stringify(value) }); }
}

const command = (sequence: number, throttle = 1): InputCommand => ({ sequence, clientTime: 1_000 + sequence, input: { throttle, steer: .25, gallop: true, brake: false, strike: false, power: false, backhand: false, aimX: 0 } });

test("mock websocket room broadcasts canonical 12-entity state and accepts assigned input", async () => {
  let socket!: MockSocket;
  const manager = new NetworkManager("ws://mock", () => (socket = new MockSocket()));
  const connected = manager.connect();
  socket.open();
  await connected;

  expect(manager.requestRoom("POLOPLAYER1")).toBe(true);
  expect(manager.requestRoom("POLOPLAYER1")).toBe(false);
  expect(socket.sent.map(value => JSON.parse(value).type)).toEqual(["JOIN_QUEUE"]);

  const initial = createInitialNetworkSnapshot(10_000);
  let started = false;
  manager.on("match", match => {
    started = true;
    expect(match.assignedEntityId).toBe("player");
    expect(match.initialState.entities).toHaveLength(12);
  });
  socket.serverSend({ type: "MATCH_START", payload: { matchId: "room-1", assignedEntityId: "player", initialState: compressSnapshot(initial), mode: "WEBSOCKET" } });
  expect(started).toBe(true);
  expect(manager.sendInput(command(1))).toBe(true);
  const inputMessage = JSON.parse(socket.sent.at(-1)!);
  expect(inputMessage).toMatchObject({ type: "INPUT", payload: { matchId: "room-1", entityId: "player", command: { sequence: 1 } } });
  manager.disconnect();
});

test("websocket environment routing falls back locally and honors production configuration", () => {
  expect(resolveWebSocketUrl()).toBe("ws://localhost:8080");
  expect(resolveWebSocketUrl("  wss://polo-realtime.example.com/socket  ")).toBe("wss://polo-realtime.example.com/socket");
  expect(reconnectDelay(1, 100, 1_000)).toBe(100);
  expect(reconnectDelay(2, 100, 1_000)).toBe(200);
  expect(reconnectDelay(8, 100, 1_000)).toBe(1_000);
});

test("unexpected disconnect reconnects with backoff and restores the queued player", async () => {
  const sockets: MockSocket[] = [];
  const states: string[] = [];
  const manager = new NetworkManager("ws://mock", () => {
    const socket = new MockSocket();
    sockets.push(socket);
    return socket;
  }, { baseDelayMs: 5, maxDelayMs: 20 });
  manager.on("status", status => states.push(status.state));

  const connected = manager.connect();
  sockets[0].open();
  await connected;
  expect(manager.requestRoom("POLOPLAYER1")).toBe(true);
  sockets[0].drop();

  await expect.poll(() => sockets.length).toBe(2);
  sockets[1].open();
  await expect.poll(() => sockets[1].sent.length).toBe(1);
  expect(JSON.parse(sockets[1].sent[0])).toEqual({ type: "JOIN_QUEUE", payload: { playerName: "POLOPLAYER1", mode: "6V6" } });
  expect(states).toEqual(expect.arrayContaining(["DISCONNECTED", "CONNECTING", "CONNECTED"]));
  manager.disconnect();
});

test("synchronous socket construction failure does not pin a rejected connection", async () => {
  let attempts = 0;
  const sockets: MockSocket[] = [];
  const manager = new NetworkManager("ws://mock", () => {
    attempts += 1;
    if (attempts === 1) throw new Error("socket constructor failed");
    const socket = new MockSocket();
    sockets.push(socket);
    return socket;
  }, { baseDelayMs: 5, maxDelayMs: 20 });

  await expect(manager.connect()).rejects.toThrow("socket constructor failed");
  await expect.poll(() => sockets.length).toBe(1);
  sockets[0].open();
  await expect.poll(() => attempts).toBe(2);
  manager.disconnect();
});

test("fixed simulation runs at 60Hz and emits exactly 20 network ticks", () => {
  const loop = new FixedTimestepLoop(60, 20);
  let simulations = 0, broadcasts = 0;
  for (let frame = 0; frame < 60; frame += 1) loop.advance(1 / 60, () => simulations += 1, () => broadcasts += 1);
  expect(simulations).toBe(60);
  expect(broadcasts).toBe(20);
  expect(loop.currentTick()).toBe(60);
});

test("snapshot compression is lossless and interpolation buffers opponents and ball", () => {
  const before = createInitialNetworkSnapshot(1_000);
  before.entities[1].position = { x: 0, z: 0 };
  const after: NetworkSnapshot = JSON.parse(JSON.stringify(before));
  after.tick = 2;
  after.serverTime = 1_100;
  after.entities[1].position = { x: 10, z: 20 };
  after.entities[1].velocity = { x: 4, z: 8 };
  after.ball.position = { x: 20, z: 10 };
  expect(decompressSnapshot(compressSnapshot(after))).toEqual(after);

  const buffer = new SnapshotBuffer();
  buffer.push(before);
  buffer.push(after);
  const sampled = buffer.sample(1_050)!;
  expect(sampled.entities[1].position).toEqual({ x: 5, z: 10 });
  expect(sampled.entities[1].velocity).toEqual({ x: 2, z: 4 });
  expect(sampled.ball.position).toEqual({ x: 10, z: 5 });
});

test("client prediction applies input immediately and reconciliation consumes acknowledgements", () => {
  const initial = createInitialNetworkSnapshot(1_000).entities[0];
  const prediction = new PredictionController(initial);
  const predicted = prediction.apply(command(1), 1 / 60);
  expect(predicted.position).not.toEqual(initial.position);
  expect(prediction.pendingCount()).toBe(1);

  const authoritative = { ...predicted, position: { x: predicted.position.x + .3, z: predicted.position.z + .2 } };
  const beforeError = Math.hypot(predicted.position.x - authoritative.position.x, predicted.position.z - authoritative.position.z);
  const reconciled = prediction.reconcile(authoritative, 1, 1 / 60);
  const afterError = Math.hypot(reconciled.position.x - authoritative.position.x, reconciled.position.z - authoritative.position.z);
  expect(afterError).toBeLessThan(beforeError);
  expect(prediction.pendingCount()).toBe(0);
});

test("live realtime server assigns a canonical room and broadcasts advancing snapshots", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => new Promise<{ entities: number; firstTick: number; secondTick: number; assigned: string }>((resolve, reject) => {
    const socket = new WebSocket("ws://127.0.0.1:8080");
    let entities = 0, assigned = "", firstTick = -1;
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Realtime room timed out")); }, 7_000);
    socket.onopen = () => socket.send(JSON.stringify({ type: "JOIN_QUEUE", payload: { playerName: "NETWORK_TEST", mode: "6V6" } }));
    socket.onerror = () => { window.clearTimeout(timeout); reject(new Error("Realtime socket failed")); };
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "MATCH_START") {
        entities = message.payload.initialState[2].length;
        assigned = message.payload.assignedEntityId;
        socket.send(JSON.stringify({ type: "INPUT", payload: { matchId: message.payload.matchId, entityId: assigned, command: { sequence: 1, clientTime: Date.now(), input: { throttle: 1, steer: 0, gallop: true, brake: false, strike: false, backhand: false, aimX: 0 } } } }));
      }
      if (message.type === "STATE_SNAPSHOT") {
        const tick = message.payload[0];
        if (firstTick < 0) firstTick = tick;
        else if (tick > firstTick) {
          window.clearTimeout(timeout);
          socket.close();
          resolve({ entities, firstTick, secondTick: tick, assigned });
        }
      }
    };
  }));
  expect(result.entities).toBe(12);
  expect(result.assigned).toBeTruthy();
  expect(result.secondTick).toBeGreaterThan(result.firstTick);
});
