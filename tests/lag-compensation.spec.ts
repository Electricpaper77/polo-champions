import { expect, test } from "@playwright/test";
import {
  HistoricalStateBuffer,
  RECONNECT_WINDOW_MS,
  evaluateRewoundRideOff,
  evaluateRewoundStrike,
  expireReconnectSlots,
  lagCompensatedTimestamp,
  markPlayerDisconnected,
  reclaimPlayerSlot,
  shouldRetireRoom,
} from "../server/MatchManager.mjs";
import { createInitialNetworkSnapshot, reconcileLocalEntity } from "../src/game/NetworkSync";
import { TelemetryService, type MatchTelemetryBatch } from "../src/services/Telemetry";
import { playerControlNotice } from "../src/game/Game";

function historicalState(serverTime: number, playerX: number, opponentX: number, ballX: number, opponentHeading = 0) {
  return {
    serverTime,
    entities: [
      { id: "player", position: { x: playerX, z: 0 }, velocity: { x: 0, z: 0 }, heading: 0 },
      { id: "red_1", position: { x: opponentX, z: 0 }, velocity: { x: 0, z: 0 }, heading: opponentHeading },
    ],
    ball: { position: { x: ballX, z: 0 }, velocity: { x: 0, z: 0 }, y: .65 },
  };
}

test("500ms historical rewind validates the strike at compensated input time", () => {
  const history = new HistoricalStateBuffer();
  history.record(historicalState(1_000, 0, 1, 2), 1_000);
  history.record(historicalState(1_500, 12, 20, 2), 1_500);

  expect(lagCompensatedTimestamp(1_500, 1_000)).toBe(1_000);
  expect(evaluateRewoundStrike(history, "player", 1_500, 0).valid).toBe(false);
  const rewound = evaluateRewoundStrike(history, "player", 1_500, 1_000);
  expect(rewound.valid).toBe(true);
  expect(rewound.distance).toBe(2);
});

test("ride-off rewind uses historical proximity and legal entry angle", () => {
  const history = new HistoricalStateBuffer();
  history.record(historicalState(2_000, 0, 1, 20), 2_000);
  history.record(historicalState(2_500, 0, 10, 20, Math.PI), 2_500);

  expect(evaluateRewoundRideOff(history, "player", "red_1", 2_500, 0).valid).toBe(false);
  const rewound = evaluateRewoundRideOff(history, "player", "red_1", 2_500, 1_000);
  expect(rewound.valid).toBe(true);
  expect(rewound.distance).toBe(1);
  expect(rewound.entryAngle).toBe(0);
});

test("disconnect preserves the entity, activates AI, and permits token reclaim for 60 seconds", () => {
  const firstSocket = {}, replacementSocket = {};
  const room = {
    clients: new Map([[firstSocket, "player"]]),
    inputs: new Map([["player", { sequence: 3 }]]),
    slots: new Map([["player", { entityId: "player", playerName: "ScarletBack", reconnectToken: "token-1", control: "HUMAN", socket: firstSocket, disconnectedAt: null, reconnectDeadline: null }]]),
    state: { entities: [{ id: "player" }] },
    emptySince: null,
  };

  const event = markPlayerDisconnected(room, firstSocket, 10_000);
  expect(event).toEqual({ entityId: "player", playerName: "ScarletBack", state: "AI_BACKFILL", reconnectDeadline: 10_000 + RECONNECT_WINDOW_MS });
  expect(room.state.entities).toHaveLength(1);
  expect(room.inputs.has("player")).toBe(false);
  expect(room.slots.get("player")?.control).toBe("AI");
  expect(playerControlNotice(event!)).toBe("Player 'ScarletBack' disconnected. AI taking over.");

  expect(reclaimPlayerSlot(room, replacementSocket, "wrong-token", 20_000)).toBeNull();
  const reclaimed = reclaimPlayerSlot(room, replacementSocket, "token-1", 69_999);
  expect(reclaimed).toMatchObject({ entityId: "player", playerName: "ScarletBack", state: "RECONNECTED" });
  expect(room.clients.get(replacementSocket)).toBe("player");
  expect(room.slots.get("player")?.control).toBe("HUMAN");
});

test("expired reconnect reservations fail closed and allow empty rooms to retire", () => {
  const socket = {};
  const room = {
    clients: new Map([[socket, "player"]]),
    inputs: new Map(),
    slots: new Map([["player", { entityId: "player", playerName: "BlueThree", reconnectToken: "token-2", control: "HUMAN", socket, disconnectedAt: null, reconnectDeadline: null }]]),
    emptySince: null,
  };
  markPlayerDisconnected(room, socket, 1_000);
  expireReconnectSlots(room, 1_000 + RECONNECT_WINDOW_MS + 1);
  expect(room.slots.get("player")?.reconnectToken).toBeNull();
  expect(reclaimPlayerSlot(room, {}, "token-2", 1_000 + RECONNECT_WINDOW_MS + 1)).toBeNull();
  expect(shouldRetireRoom(room, 1_000 + RECONNECT_WINDOW_MS + 1)).toBe(true);
});

test("large reconciliation errors rubber-band by a bounded step instead of teleporting", () => {
  const predicted = createInitialNetworkSnapshot(1_000).entities[0];
  const authoritative = { ...predicted, position: { x: predicted.position.x + 20, z: predicted.position.z } };
  const corrected = reconcileLocalEntity(predicted, authoritative);
  const correction = corrected.position.x - predicted.position.x;
  expect(correction).toBeGreaterThan(0);
  expect(correction).toBeLessThanOrEqual(.75);
  expect(corrected.position).not.toEqual(authoritative.position);
});

test("telemetry is batched silently until match completion", () => {
  const sent: MatchTelemetryBatch[] = [];
  const telemetry = new TelemetryService(batch => sent.push(batch));
  telemetry.startMatch("match-21");
  telemetry.recordPing(40);
  telemetry.recordPing(60);
  telemetry.recordAIBackfill();
  telemetry.recordAIBackfill();
  expect(sent).toEqual([]);

  expect(telemetry.completeMatch(9_000)).toEqual({ matchId: "match-21", matchCompletions: 1, averageClientPingMs: 50, aiBackfillTriggers: 2, completedAt: 9_000 });
  expect(sent).toHaveLength(1);
  expect(telemetry.completeMatch(10_000)).toBeNull();
  expect(sent).toHaveLength(1);
});
