import { expect, test } from "@playwright/test";
import { FixedTimestepLoop } from "../src/game/GameLoop";
import { PredictionController, SnapshotBuffer, compressSnapshot, createInitialNetworkSnapshot, decompressSnapshot, predictLocalEntity, type InputCommand, type NetworkSnapshot } from "../src/game/NetworkSync";
import { ACCELERATION_TAU, MAX_GALLOP_SPEED } from "../src/game/HorseControls";
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
  expect(socket.sent.map(value => JSON.parse(value).type)).toEqual(["PING", "JOIN_QUEUE"]);

  const initial = createInitialNetworkSnapshot(10_000);
  let started = false;
  manager.on("match", match => {
    started = true;
    expect(match.assignedEntityId).toBe("player");
    expect(match.initialState.entities).toHaveLength(12);
  });
  socket.serverSend({ type: "MATCH_START", payload: { matchId: "room-1", assignedEntityId: "player", reconnectToken: "resume-1", initialState: compressSnapshot(initial), mode: "WEBSOCKET" } });
  expect(started).toBe(true);
  const rideOffCommand=command(1);
  rideOffCommand.input.rideOff=true;
  expect(manager.sendInput(rideOffCommand)).toBe(true);
  const inputMessage = JSON.parse(socket.sent.at(-1)!);
  expect(inputMessage).toMatchObject({ type: "INPUT", payload: { matchId: "room-1", entityId: "player", command: { sequence: 1, input:{rideOff:true} } } });
  expect(manager.requestMatchReset()).toBe(true);
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({type:"RESET_MATCH",payload:{matchId:"room-1"}});
  manager.disconnect();
});

test("authoritative goal events preserve team, score, and celebration duration", async () => {
  let socket!: MockSocket;
  const manager = new NetworkManager("ws://mock", () => (socket = new MockSocket()));
  const connected = manager.connect();
  socket.open();
  await connected;
  let received:unknown;
  manager.on("goal", goal => received=goal);
  socket.serverSend({type:"GOAL_SCORED",payload:{team:"blue",score:{blue:2,red:1},celebrationMs:1_800}});
  expect(received).toEqual({team:"blue",score:{blue:2,red:1},celebrationMs:1_800});
  manager.disconnect();
});

test("room-code protocol waits for server confirmation and publishes lobby state", async () => {
  let socket!: MockSocket;
  const manager = new NetworkManager("ws://mock", () => (socket = new MockSocket()));
  const connected = manager.connect();
  socket.open();
  await connected;

  const rooms: unknown[] = [];
  const errors: unknown[] = [];
  manager.on("room", room => rooms.push(room));
  manager.on("error", error => errors.push(error));

  expect(manager.createRoom("POLO_BLUE")).toBe(true);
  expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type:"CREATE_ROOM", payload:{ playerName:"POLO_BLUE" } });
  socket.serverSend({ type:"ROOM_CONFIRMED", payload:{ code:"ABCD23", capacity:2, status:"WAITING", players:[{ id:"p1", name:"POLO_BLUE", ready:false, connected:true, host:true }] } });
  expect(rooms.at(-1)).toMatchObject({ code:"ABCD23", players:[{ name:"POLO_BLUE", host:true }] });

  expect(manager.setRoomReady("ABCD23", true)).toBe(true);
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type:"SET_READY", payload:{ roomCode:"ABCD23", ready:true } });
  socket.serverSend({ type:"ERROR", payload:{ message:"Invalid room code" } });
  expect(errors).toEqual([{ message:"Invalid room code" }]);
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
  await expect.poll(() => sockets[1].sent.length).toBe(2);
  expect(JSON.parse(sockets[1].sent[1])).toMatchObject({ type: "JOIN_QUEUE", payload: { playerName: "POLOPLAYER1", matchType: "6v6" } });
  expect(states).toEqual(expect.arrayContaining(["DISCONNECTED", "CONNECTING", "CONNECTED"]));
  manager.disconnect();
});

test("active match reconnect presents the server-issued token and reclaims the same entity", async () => {
  const sockets: MockSocket[] = [];
  const manager = new NetworkManager("ws://mock", () => {
    const socket = new MockSocket();
    sockets.push(socket);
    return socket;
  }, { baseDelayMs: 5, maxDelayMs: 20 });

  const connected = manager.connect();
  sockets[0].open();
  await connected;
  const initial = createInitialNetworkSnapshot(20_000);
  sockets[0].serverSend({ type: "MATCH_START", payload: { matchId: "room-resume", assignedEntityId: "blue_3", reconnectToken: "server-token", initialState: compressSnapshot(initial), mode: "WEBSOCKET" } });
  expect(manager.getActiveMatch()?.assignedEntityId).toBe("blue_3");

  sockets[0].drop();
  expect(manager.getActiveMatch()?.assignedEntityId).toBe("blue_3");
  await expect.poll(() => sockets.length).toBe(2);
  sockets[1].open();
  await expect.poll(() => sockets[1].sent.length).toBe(2);
  expect(JSON.parse(sockets[1].sent[1])).toEqual({ type: "RECONNECT", payload: { matchId: "room-resume", reconnectToken: "server-token" } });

  sockets[1].serverSend({ type: "MATCH_START", payload: { matchId: "room-resume", assignedEntityId: "blue_3", reconnectToken: "server-token", initialState: compressSnapshot(initial), mode: "WEBSOCKET" } });
  expect(manager.getActiveMatch()?.assignedEntityId).toBe("blue_3");
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
  expect(decompressSnapshot(compressSnapshot(after))).toMatchObject({ score:{blue:0,red:0}, seconds:420, started:false, phase:"WAITING" });

  const buffer = new SnapshotBuffer();
  buffer.push(before);
  buffer.push(after);
  const sampled = buffer.sample(1_050)!;
  expect(sampled.entities[1].position).toEqual({ x: 5, z: 10 });
  expect(sampled.entities[1].velocity).toEqual({ x: 2, z: 4 });
  expect(sampled.ball.position).toEqual({ x: 10, z: 5 });
});

test("live private room replicates both player inputs from authoritative snapshots", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => new Promise<{
    hostId:string;
    guestId:string;
    hostSawGuestSpeed:number;
    guestSawHostSpeed:number;
    unauthorizedHostSpeed:number;
    entities:number;
    scoreBlue:number;
    seconds:number;
    snapshotHz:number;
    syncError:number;
  }>((resolve, reject) => {
    const host = new WebSocket("ws://127.0.0.1:8080");
    const guest = new WebSocket("ws://127.0.0.1:8080");
    const snapshots = { host: [] as unknown[][], guest: [] as unknown[][] };
    const starts: Record<string, { id:string; matchId:string }> = {};
    let roomCode = "";
    let guestOpen = false;
    let hostInputSent = false;
    let guestInputSent = false;
    let unauthorizedSent = false;
    let hostInputScheduled = false;
    const timeout = window.setTimeout(() => { host.close(); guest.close(); reject(new Error("Two-client replication timed out")); }, 10_000);
    const send = (socket:WebSocket, message:unknown) => socket.send(JSON.stringify(message));
    const joinGuest = () => { if (roomCode && guestOpen) send(guest, { type:"JOIN_ROOM", payload:{ roomCode, playerName:"GUEST" } }); };
    const rider = (snapshot:unknown[], id:string) => (snapshot[2] as unknown[][]).find(entity => entity[0] === id);
    const speedOf = (snapshot:unknown[], id:string) => {
      const value = rider(snapshot, id);
      return value ? Math.hypot(Number(value[3]), Number(value[4])) : 0;
    };
    const check = () => {
      if (!starts.host || !starts.guest) return;
      if (!unauthorizedSent) {
        unauthorizedSent = true;
        send(guest, { type:"INPUT", payload:{ matchId:starts.guest.matchId, entityId:starts.host.id, command:{ sequence:1, clientTime:Date.now(), input:{ throttle:1, steer:0, gallop:true, brake:false, strike:false, backhand:false, aimX:0 } } } });
      }
      if (!hostInputScheduled && snapshots.guest.length >= 3) {
        hostInputScheduled = true;
        window.setTimeout(() => send(host, { type:"INPUT", payload:{ matchId:starts.host.matchId, entityId:starts.host.id, command:{ sequence:1, clientTime:Date.now(), input:{ throttle:1, steer:0, gallop:true, brake:false, strike:false, backhand:false, aimX:0 } } } }), 250);
      }
      const guestSawHost = snapshots.guest.find(snapshot => speedOf(snapshot, starts.host.id) > 5);
      if (guestSawHost && !hostInputSent) hostInputSent = true;
      if (hostInputSent && !guestInputSent) {
        guestInputSent = true;
        send(guest, { type:"INPUT", payload:{ matchId:starts.guest.matchId, entityId:starts.guest.id, command:{ sequence:2, clientTime:Date.now(), input:{ throttle:1, steer:0, gallop:true, brake:false, strike:false, backhand:false, aimX:0 } } } });
      }
      const hostSawGuest = snapshots.host.find(snapshot => speedOf(snapshot, starts.guest.id) > 5);
      if (!guestSawHost || !hostSawGuest || snapshots.host.length < 8 || snapshots.guest.length < 8) return;
      const hostTicks = snapshots.host.map(snapshot => Number(snapshot[0]));
      const guestTicks = new Set(snapshots.guest.map(snapshot => Number(snapshot[0])));
      const commonTick = hostTicks.findLast(tick => guestTicks.has(tick));
      const hostCommon = snapshots.host.find(snapshot => Number(snapshot[0]) === commonTick);
      const guestCommon = snapshots.guest.find(snapshot => Number(snapshot[0]) === commonTick);
      const hostEntity = hostCommon ? rider(hostCommon, starts.host.id) : null;
      const guestEntity = guestCommon ? rider(guestCommon, starts.host.id) : null;
      if (!hostEntity || !guestEntity) return;
      const intervalMs = (Number(snapshots.host.at(-1)![1]) - Number(snapshots.host[0][1])) / Math.max(1, snapshots.host.length - 1);
      window.clearTimeout(timeout);
      host.close();
      guest.close();
      resolve({
        hostId:starts.host.id,
        guestId:starts.guest.id,
        hostSawGuestSpeed:speedOf(hostSawGuest, starts.guest.id),
        guestSawHostSpeed:speedOf(guestSawHost, starts.host.id),
        unauthorizedHostSpeed:speedOf(snapshots.guest[0], starts.host.id),
        entities:(guestSawHost[2] as unknown[][]).length,
        scoreBlue:Number(guestSawHost[5].blue),
        seconds:Number(guestSawHost[6]),
        snapshotHz:1000 / intervalMs,
        syncError:Math.hypot(Number(hostEntity[1]) - Number(guestEntity[1]), Number(hostEntity[2]) - Number(guestEntity[2])),
      });
    };
    host.onopen = () => send(host, { type:"CREATE_ROOM", payload:{ playerName:"HOST" } });
    guest.onopen = () => { guestOpen = true; joinGuest(); };
    host.onerror = guest.onerror = () => { window.clearTimeout(timeout); reject(new Error("Realtime socket failed")); };
    host.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "ROOM_CONFIRMED") {
        roomCode = message.payload.code;
        joinGuest();
      }
      if (message.type === "ROOM_STATE" && message.payload.players.length === 2) send(host, { type:"SET_READY", payload:{ roomCode, ready:true } });
      if (message.type === "MATCH_START") {
        starts.host = { id:message.payload.assignedEntityId, matchId:message.payload.matchId };
        check();
      }
      if (message.type === "STATE_SNAPSHOT") { snapshots.host.push(message.payload); check(); }
    };
    guest.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "ROOM_CONFIRMED") send(guest, { type:"SET_READY", payload:{ roomCode, ready:true } });
      if (message.type === "MATCH_START") {
        starts.guest = { id:message.payload.assignedEntityId, matchId:message.payload.matchId };
        check();
      }
      if (message.type === "STATE_SNAPSHOT") { snapshots.guest.push(message.payload); check(); }
    };
  }));
  expect(result.entities).toBe(12);
  expect(result.hostId).not.toBe(result.guestId);
  expect(result.unauthorizedHostSpeed).toBeLessThan(.001);
  expect(result.guestSawHostSpeed).toBeGreaterThan(5);
  expect(result.hostSawGuestSpeed).toBeGreaterThan(5);
  expect(result.scoreBlue).toBe(0);
  expect(result.seconds).toBeLessThanOrEqual(420);
  expect(result.snapshotHz).toBeGreaterThan(12);
  expect(result.snapshotHz).toBeLessThan(28);
  expect(result.syncError).toBeLessThan(.001);
});

test("authoritative match lifecycle scores once, rejects spoofing, completes, reconnects, and rematches", async ({ page }) => {
  test.setTimeout(35_000);
  await page.goto("/");
  const result = await page.evaluate(() => new Promise<{
    hostId:string;
    guestId:string;
    forehandBallSpeed:number;
    backhandBallSpeed:number;
    spoofedScore:number;
    scoredBlue:number;
    duplicateBlue:number;
    guestScoreBlue:number;
    completePhase:string;
    guestCompletePhase:string;
    rematchPhase:string;
    rematchSeconds:number;
    reconnectedId:string;
    snapshotHz:number;
    ballDivergence:number;
    goalPropagationMs:number;
    clockSkewSeconds:number;
    reconnectRecoveryMs:number;
  }>((resolve, reject) => {
    const sockets: Record<string, WebSocket | null> = { host:null, guest:null, reconnect:null };
    const snapshots = { host: [] as unknown[][], guest: [] as unknown[][], reconnect: [] as unknown[][] };
    const starts: Record<string, { id:string; matchId:string; token:string }> = {};
    let roomCode = "", guestOpen = false, goalSentAt = 0, disconnectAt = 0, reconnectRecoveryMs = 0;
    let forehandBallSpeed = 0, backhandBallSpeed = 0, spoofedScore = 0, scoredBlue = 0, duplicateBlue = 0, guestScoreBlue = 0, completePhase = "", guestCompletePhase = "", rematchPhase = "", rematchSeconds = 0, reconnectedId = "";
    const timer = window.setTimeout(() => reject(new Error("Lifecycle verification timed out")), 18_000);
    const send = (socket:WebSocket | null, message:unknown) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message));
    const snapSpeed = (snapshot:unknown[]) => Math.hypot(Number((snapshot[3] as unknown[])[2]), Number((snapshot[3] as unknown[])[3]));
    const rider = (snapshot:unknown[], id:string) => (snapshot[2] as unknown[][]).find(entity => entity[0] === id);
    const latest = (key:keyof typeof snapshots) => snapshots[key].at(-1);
    const nextSnapshot = (key:keyof typeof snapshots, predicate:(snapshot:unknown[])=>boolean, timeoutMs=5_000) => new Promise<unknown[]>((resolveNext, rejectNext) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const match = snapshots[key].find(predicate);
        if (match) { window.clearInterval(interval); resolveNext(match); }
        else if (Date.now() - startedAt > timeoutMs) { window.clearInterval(interval); rejectNext(new Error(`Timed out waiting for ${key} snapshot`)); }
      }, 20);
    });
    const joinGuest = () => { if (roomCode && guestOpen) send(sockets.guest, { type:"JOIN_ROOM", payload:{ roomCode, playerName:"GATE4_GUEST" } }); };
    const placeBallForStrike = (backhand=false) => {
      const hostSnap = latest("host")!;
      const entity = rider(hostSnap, starts.host.id)!;
      const x = Number(entity[1]);
      const z = Number(entity[2]);
      const heading = Number(entity[5]);
      const aimX = 0;
      const progress = .55;
      const aimedYaw = heading + aimX * .38;
      const forward = { x:Math.sin(aimedYaw), z:Math.cos(aimedYaw) };
      const right = { x:Math.cos(aimedYaw), z:-Math.sin(aimedYaw) };
      const side = backhand ? -1 : 1;
      const localForward = -.4 + (3.7 + .4) * progress;
      const localSide = side * (2.05 - Math.sin(Math.PI * progress) * 1.15);
      send(sockets.host, { type:"TEST_CONTROL", payload:{ matchId:starts.host.matchId, command:"PLACE_BALL", x:x + forward.x * localForward + right.x * localSide, z:z + forward.z * localForward + right.z * localSide } });
    };
    const strike = async (backhand=false) => {
      const sequenceBase = backhand ? 20 : 10;
      placeBallForStrike(backhand);
      await nextSnapshot("host", snapshot => snapSpeed(snapshot) === 0 && Number(snapshot[0]) > 0);
      send(sockets.host, { type:"INPUT", payload:{ matchId:starts.host.matchId, entityId:starts.host.id, command:{ sequence:sequenceBase, clientTime:Date.now()-260, reportedPingMs:0, input:{ throttle:0, steer:0, gallop:false, brake:false, strike:!backhand, backhand, power:false, aimX:0, aimY:0 } } } });
      await new Promise(done => window.setTimeout(done, 80));
      send(sockets.host, { type:"INPUT", payload:{ matchId:starts.host.matchId, entityId:starts.host.id, command:{ sequence:sequenceBase+1, clientTime:Date.now(), reportedPingMs:0, input:{ throttle:0, steer:0, gallop:false, brake:false, strike:false, backhand:false, power:false, aimX:0, aimY:0 } } } });
      const moved = await nextSnapshot("guest", snapshot => snapSpeed(snapshot) > 2, 6_000);
      return snapSpeed(moved);
    };
    const finish = async () => {
      try {
        await nextSnapshot("host", snapshot => starts.host && starts.guest && Number(snapshot[0]) > 6);
        send(sockets.guest, { type:"GOAL_SCORED", payload:{ team:"blue", score:{blue:99,red:0}, celebrationMs:1 } });
        await new Promise(done => window.setTimeout(done, 150));
        spoofedScore = Number(latest("host")?.[5]?.blue ?? 0);
        forehandBallSpeed = await strike(false);
        backhandBallSpeed = await strike(true);
        send(sockets.host, { type:"TEST_CONTROL", payload:{ matchId:starts.host.matchId, command:"FORCE_GOAL", team:"blue" } });
        goalSentAt = Date.now();
        const scoredHost = await nextSnapshot("host", snapshot => Number(snapshot[5]?.blue) === 1 && snapshot[8] === "GOAL_CELEBRATION");
        const scoredGuest = await nextSnapshot("guest", snapshot => Number(snapshot[5]?.blue) === 1 && snapshot[8] === "GOAL_CELEBRATION");
        scoredBlue = Number(scoredHost[5].blue);
        guestScoreBlue = Number(scoredGuest[5].blue);
        const goalPropagationMs = Date.now() - goalSentAt;
        send(sockets.host, { type:"TEST_CONTROL", payload:{ matchId:starts.host.matchId, command:"FORCE_GOAL", team:"blue" } });
        await new Promise(done => window.setTimeout(done, 150));
        duplicateBlue = Number(latest("host")?.[5]?.blue ?? 0);
        send(sockets.host, { type:"TEST_CONTROL", payload:{ matchId:starts.host.matchId, command:"COMPLETE_MATCH" } });
        const completeHost = await nextSnapshot("host", snapshot => snapshot[8] === "COMPLETE");
        const completeGuest = await nextSnapshot("guest", snapshot => snapshot[8] === "COMPLETE");
        completePhase = String(completeHost[8]);
        guestCompletePhase = String(completeGuest[8]);
        send(sockets.host, { type:"RESET_MATCH", payload:{ matchId:starts.host.matchId } });
        const rematch = await nextSnapshot("guest", snapshot => snapshot[8] === "WAITING" && Number(snapshot[6]) === 420 && Number(snapshot[5]?.blue) === 0);
        rematchPhase = String(rematch[8]);
        rematchSeconds = Number(rematch[6]);
        disconnectAt = Date.now();
        sockets.host?.close();
        sockets.reconnect = new WebSocket("ws://127.0.0.1:8080");
        sockets.reconnect.onopen = () => send(sockets.reconnect, { type:"RECONNECT", payload:{ matchId:starts.host.matchId, reconnectToken:starts.host.token } });
        sockets.reconnect.onmessage = event => {
          const message = JSON.parse(String(event.data));
          if (message.type === "MATCH_START") {
            starts.reconnect = { id:message.payload.assignedEntityId, matchId:message.payload.matchId, token:message.payload.reconnectToken };
            reconnectedId = message.payload.assignedEntityId;
            reconnectRecoveryMs = Date.now() - disconnectAt;
          }
          if (message.type === "STATE_SNAPSHOT") snapshots.reconnect.push(message.payload);
        };
        await new Promise<void>((resolveReconnect, rejectReconnect) => {
          const startedAt = Date.now();
          const interval = window.setInterval(() => {
            if (reconnectedId) { window.clearInterval(interval); resolveReconnect(); }
            else if (Date.now() - startedAt > 5_000) { window.clearInterval(interval); rejectReconnect(new Error("Reconnect timed out")); }
          }, 20);
        });
        const hostTicks = snapshots.guest.map(snapshot => Number(snapshot[0]));
        const reconnectTicks = new Set(snapshots.reconnect.map(snapshot => Number(snapshot[0])));
        const commonTick = hostTicks.findLast(tick => reconnectTicks.has(tick));
        const guestCommon = snapshots.guest.find(snapshot => Number(snapshot[0]) === commonTick);
        const reconnectCommon = snapshots.reconnect.find(snapshot => Number(snapshot[0]) === commonTick);
        const ballDivergence = guestCommon && reconnectCommon ? Math.hypot(Number(guestCommon[3][0]) - Number(reconnectCommon[3][0]), Number(guestCommon[3][1]) - Number(reconnectCommon[3][1])) : 0;
        const intervalMs = (Number(snapshots.guest.at(-1)![1]) - Number(snapshots.guest[0][1])) / Math.max(1, snapshots.guest.length - 1);
        window.clearTimeout(timer);
        sockets.guest?.close();
        sockets.reconnect?.close();
        resolve({ hostId:starts.host.id, guestId:starts.guest.id, forehandBallSpeed, backhandBallSpeed, spoofedScore, scoredBlue, duplicateBlue, guestScoreBlue, completePhase, guestCompletePhase, rematchPhase, rematchSeconds, reconnectedId, snapshotHz:1000/intervalMs, ballDivergence, goalPropagationMs, clockSkewSeconds:Math.abs(Number(completeHost[6])-Number(completeGuest[6])), reconnectRecoveryMs });
      } catch (error) { reject(error); }
    };
    sockets.host = new WebSocket("ws://127.0.0.1:8080");
    sockets.guest = new WebSocket("ws://127.0.0.1:8080");
    sockets.host.onopen = () => send(sockets.host, { type:"CREATE_ROOM", payload:{ playerName:"GATE4_HOST" } });
    sockets.guest.onopen = () => { guestOpen = true; joinGuest(); };
    sockets.host.onerror = sockets.guest.onerror = () => reject(new Error("Realtime socket failed"));
    sockets.host.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "ROOM_CONFIRMED") { roomCode = message.payload.code; joinGuest(); }
      if (message.type === "ROOM_STATE" && message.payload.players.length === 2) send(sockets.host, { type:"SET_READY", payload:{ roomCode, ready:true } });
      if (message.type === "MATCH_START") { starts.host = { id:message.payload.assignedEntityId, matchId:message.payload.matchId, token:message.payload.reconnectToken }; if (starts.guest) void finish(); }
      if (message.type === "STATE_SNAPSHOT") snapshots.host.push(message.payload);
    };
    sockets.guest.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "ROOM_CONFIRMED") send(sockets.guest, { type:"SET_READY", payload:{ roomCode, ready:true } });
      if (message.type === "MATCH_START") { starts.guest = { id:message.payload.assignedEntityId, matchId:message.payload.matchId, token:message.payload.reconnectToken }; if (starts.host) void finish(); }
      if (message.type === "STATE_SNAPSHOT") snapshots.guest.push(message.payload);
    };
  }));
  expect(result.hostId).toBe("player");
  expect(result.guestId).toBe("blue_2");
  expect(result.forehandBallSpeed).toBeGreaterThan(2);
  expect(result.backhandBallSpeed).toBeGreaterThan(2);
  expect(result.spoofedScore).toBe(0);
  expect(result.scoredBlue).toBe(1);
  expect(result.guestScoreBlue).toBe(1);
  expect(result.duplicateBlue).toBe(1);
  expect(result.completePhase).toBe("COMPLETE");
  expect(result.guestCompletePhase).toBe("COMPLETE");
  expect(result.rematchPhase).toBe("WAITING");
  expect(result.rematchSeconds).toBe(420);
  expect(result.reconnectedId).toBe("player");
  expect(result.snapshotHz).toBeGreaterThan(12);
  expect(result.snapshotHz).toBeLessThan(28);
  expect(result.ballDivergence).toBeLessThan(.001);
  expect(result.clockSkewSeconds).toBe(0);
  expect(result.goalPropagationMs).toBeLessThan(1_000);
  expect(result.reconnectRecoveryMs).toBeLessThan(5_000);
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

test("client prediction uses the canonical momentum curve and absolute velocity clamp", () => {
  let entity=createInitialNetworkSnapshot(1_000).entities[0];
  const straightCommand=(sequence:number):InputCommand=>{const value=command(sequence);return {...value,input:{...value.input,steer:0}}};
  for(let tick=0;tick<60;tick+=1)entity=predictLocalEntity(entity,straightCommand(tick+1),1/60);
  expect(Math.hypot(entity.velocity.x,entity.velocity.z)).toBeCloseTo(MAX_GALLOP_SPEED*(1-Math.exp(-1/ACCELERATION_TAU)),8);
  for(let tick=60;tick<660;tick+=1)entity=predictLocalEntity(entity,straightCommand(tick+1),1/60);
  expect(Math.hypot(entity.velocity.x,entity.velocity.z)).toBeLessThanOrEqual(MAX_GALLOP_SPEED);
});

test("live realtime server holds formation until intent and broadcasts advancing snapshots", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => new Promise<{ entities: number; firstTick: number; secondTick: number; assigned: string; idleDrift:number; motionSpeed:number }>((resolve, reject) => {
    const socket = new WebSocket("ws://127.0.0.1:8080");
    let entities = 0, assigned = "", matchId="", firstTick = -1, idleDrift=0, initialPositions:number[][]=[],movementSnapshots=0,motionSpeed=0;
    const timeout = window.setTimeout(() => { socket.close(); reject(new Error("Realtime room timed out")); }, 7_000);
    socket.onopen = () => socket.send(JSON.stringify({ type: "JOIN_QUEUE", payload: { playerName: "NETWORK_TEST", mode: "6V6" } }));
    socket.onerror = () => { window.clearTimeout(timeout); reject(new Error("Realtime socket failed")); };
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "MATCH_START") {
        entities = message.payload.initialState[2].length;
        assigned = message.payload.assignedEntityId;
        matchId=message.payload.matchId;
        initialPositions=message.payload.initialState[2].map((entity:unknown[])=>[Number(entity[1]),Number(entity[2])]);
      }
      if (message.type === "STATE_SNAPSHOT") {
        const tick = message.payload[0];
        if (firstTick < 0) {
          firstTick = tick;
          idleDrift=Math.max(...message.payload[2].map((entity:unknown[],index:number)=>Math.hypot(Number(entity[1])-initialPositions[index][0],Number(entity[2])-initialPositions[index][1])));
          socket.send(JSON.stringify({ type: "INPUT", payload: { matchId, entityId: assigned, command: { sequence: 1, clientTime: Date.now(), input: { throttle: 1, steer: 0, gallop: true, brake: false, strike: false, backhand: false, aimX: 0 } } } }));
        }
        else if (tick > firstTick) {
          movementSnapshots+=1;
          const rider=message.payload[2].find((entity:unknown[])=>entity[0]===assigned);
          motionSpeed=rider?Math.hypot(Number(rider[3]),Number(rider[4])):0;
          if(movementSnapshots>=30){
            window.clearTimeout(timeout);
            socket.close();
            resolve({ entities, firstTick, secondTick: tick, assigned, idleDrift, motionSpeed });
          }
        }
      }
    };
  }));
  expect(result.entities).toBe(12);
  expect(result.assigned).toBeTruthy();
  expect(result.idleDrift).toBeLessThan(.001);
  expect(result.secondTick).toBeGreaterThan(result.firstTick);
  expect(result.motionSpeed).toBeGreaterThan(8);
  expect(result.motionSpeed).toBeLessThan(14.5);
  expect(result.motionSpeed).toBeLessThanOrEqual(MAX_GALLOP_SPEED);
});
