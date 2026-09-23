import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Environment, Text } from "@react-three/drei";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import { useEffect, useRef, useState } from "react";
import { useInput, type Input } from "./InputManager";
import { getMatchResult, useMatch, type ActiveHumanRiderId } from "./GameState";
import { getTargetSpeed } from "./HorseControls";
import {
  BALL_GROUND_ROLL_DAMPING,
  clampBallVelocity,
  getBallResetState,
  getShotImpulse,
  getTapImpulse,
  INITIAL_GOAL_STATE,
  transitionGoal,
} from "./PoloMechanics";
import {
  canPass,
  getPassDirection,
  getPassTarget,
} from "./PassMechanics";
import {
  updatePossession,
  deriveTacticalStates,
  deriveTeamModes,
  loosePossession,
  type Possession,
  type TacticalState,
} from "./Possession";
import {
  RIDE_OFF_ALIGNMENT_THRESHOLD,
  RIDE_OFF_COOLDOWN_MS,
  findRideOffTarget,
  resolveRideOffContact,
  type RideOffRider,
} from "./RideOff";
import { PONIES, RIDER_PONIES, maxSpeed } from "./PoloPony";
import { sharedCamera } from "./SharedCamera";

const FIELD_X = 52,
  FIELD_Z = 82;
export const FIELD_SURFACE_Y = 0,
  FIELD_COLLIDER_THICKNESS = 0.8,
  BALL_RADIUS = 0.42,
  BALL_SAFE_FALL_Y = -3;
export const PITCH_GROUND_COLLIDER_NAME = "polo-pitch-ground",
  BALL_COLLIDER_NAME = "polo-ball";
export const STRIKE_RANGE = 5;
export type Gait = "idle" | "walk" | "canter" | "gallop";
export const HORSE_VISUAL_TUNING = { bodyScale: [1.32, .8, 1.62] as const, neckLength: .78, legThickness: .115, riderTorsoScale: 1.05, riderSeatHeight: .08, malletLength: 1.55, helmetScale: 1, shadowOpacity: .22, blueTeam: "#2c67c9", redTeam: "#bd3c39" };
export type HorseVisualProfile = { bodyLength: number; bodyHeight: number; chestScale: number; neckLength: number; neckThickness: number; hindquarterScale: number; legLength: number; legThickness: number; headScale: number };
export const HORSE_VISUAL_PROFILES: Record<keyof typeof PONIES, HorseVisualProfile> = {
  SPRINTER: { bodyLength: 1.08, bodyHeight: .92, chestScale: .88, neckLength: 1.08, neckThickness: .84, hindquarterScale: .92, legLength: 1.1, legThickness: .86, headScale: .92 },
  ALL_ROUNDER: { bodyLength: 1, bodyHeight: 1, chestScale: 1, neckLength: 1, neckThickness: 1, hindquarterScale: 1, legLength: 1, legThickness: 1, headScale: 1 },
  POWER: { bodyLength: 1.03, bodyHeight: 1.08, chestScale: 1.2, neckLength: .94, neckThickness: 1.22, hindquarterScale: 1.2, legLength: .94, legThickness: 1.16, headScale: 1.05 },
};
export function visualProfileForRider(id: keyof typeof RIDER_PONIES) { return HORSE_VISUAL_PROFILES[Object.entries(PONIES).find(([, profile]) => profile === RIDER_PONIES[id])![0] as keyof typeof PONIES]; }
export function visualTransformIsFinite(profile: HorseVisualProfile) { return Object.values(profile).every(value => Number.isFinite(value) && value > 0); }
export function gaitForSpeed(speed: number): Gait { const s = Math.abs(speed); return s < .15 ? "idle" : s < 6 ? "walk" : s < 14 ? "canter" : "gallop"; }
export function visualTurnLean(steer: number, speed: number) { return THREE.MathUtils.clamp(-steer * Math.min(Math.abs(speed) / 20, 1) * .22, -.22, .22); }
type PlanarVector = { x: number; z: number };
const STEERING_GALLOP_SPEED = 24;
const REVERSAL_DOT_THRESHOLD = -0.72;
const LATERAL_GRIP_PER_SECOND = 7.5;

function safePlanarDirection(vector: PlanarVector, fallback: PlanarVector = { x: 0, z: 1 }): PlanarVector {
  const length = Math.hypot(vector.x, vector.z);
  return Number.isFinite(length) && length > 0.0001
    ? { x: vector.x / length, z: vector.z / length }
    : fallback;
}
export function getSpeedNormalized(speed: number) {
  return THREE.MathUtils.clamp(Math.abs(Number.isFinite(speed) ? speed : 0) / STEERING_GALLOP_SPEED, 0, 1);
}
export function getSteeringAuthority(speed: number, agility: number) {
  const speedFactor = 1 - getSpeedNormalized(speed) * 0.56;
  const agilityFactor = 0.7 + THREE.MathUtils.clamp(Number.isFinite(agility) ? agility : 0, 0, 100) / 100;
  return 1.8 * speedFactor * agilityFactor;
}
export function getSignedTurnStep(currentForward: PlanarVector, desiredDirection: PlanarVector, turnRate: number, dt: number) {
  const current = safePlanarDirection(currentForward), desired = safePlanarDirection(desiredDirection, current);
  const dot = THREE.MathUtils.clamp(current.x * desired.x + current.z * desired.z, -1, 1);
  const cross = current.z * desired.x - current.x * desired.z;
  const angle = Math.atan2(cross, dot);
  const safeStep = Math.max(0, Number.isFinite(turnRate) && Number.isFinite(dt) ? turnRate * Math.min(Math.max(dt, 0), 0.05) : 0);
  return THREE.MathUtils.clamp(angle, -safeStep, safeStep);
}
export function isStrongReversal(currentForward: PlanarVector, desiredDirection: PlanarVector) {
  const current = safePlanarDirection(currentForward), desired = safePlanarDirection(desiredDirection, current);
  return current.x * desired.x + current.z * desired.z < REVERSAL_DOT_THRESHOLD;
}
export function alignVelocityToForward(velocity: PlanarVector, forward: PlanarVector, dt: number): PlanarVector {
  const safeForward = safePlanarDirection(forward);
  const vx = Number.isFinite(velocity.x) ? velocity.x : 0, vz = Number.isFinite(velocity.z) ? velocity.z : 0;
  const forwardSpeed = vx * safeForward.x + vz * safeForward.z;
  const lateralX = vx - safeForward.x * forwardSpeed, lateralZ = vz - safeForward.z * forwardSpeed;
  const lateralGrip = Math.exp(-LATERAL_GRIP_PER_SECOND * Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.05));
  return { x: safeForward.x * forwardSpeed + lateralX * lateralGrip, z: safeForward.z * forwardSpeed + lateralZ * lateralGrip };
}
export function isStrikeInRange(rider: { x: number; z: number }, ball: { x: number; z: number }) {
  return Math.hypot(ball.x - rider.x, ball.z - rider.z) < STRIKE_RANGE;
}
export function minimapPoint(position: { x: number; z: number }) {
  return { left: `${50 + (position.x / FIELD_X) * 100}%`, top: `${50 + (position.z / FIELD_Z) * 100}%` };
}
export const ballNeedsRecovery = (y: number) => y < BALL_SAFE_FALL_Y;
export const RIDER_FIELD_BOUNDS = { x: 24, z: 39 };
export type SpawnXZ = readonly [number, number];
export const RIDER_SPAWNS = {
  blue1: [0, 18],
  blue2: [7, 12],
  red1: [-7, -12],
  red2: [7, -23],
} satisfies Record<string, SpawnXZ>;
export function spawnToVector3(spawn: SpawnXZ) {
  const [x, z] = spawn;
  return new THREE.Vector3(x, 0, z);
}
type RiderId = keyof typeof RIDER_SPAWNS;
type DebugRider = {
  id: RiderId;
  team: "blue" | "red";
  human: boolean;
  x: number;
  y: number;
  z: number;
  tacticalState?: TacticalState;
};
type PoloDebug = {
  matchState: string;
  score: { blue: number; red: number };
  timeRemaining: number;
  possession: Possession;
  lastTouchRiderId?: RiderId;
  lastTouchTeam?: "blue" | "red";
  teamModes: { blue: string; red: string };
  activeHumanRiderId: ActiveHumanRiderId;
  cameraFollowId: ActiveHumanRiderId;
  camera?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
  riders: Record<RiderId, DebugRider>;
  lastPass?: {
    from: ActiveHumanRiderId;
    target: ActiveHumanRiderId;
    direction: { x: number; y: number; z: number };
    power: number;
  };
  incomingPassTargetRiderId?: ActiveHumanRiderId;
  ball?: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
  };
  setupPass?: () => void;
  setupBallFor?: (id: RiderId) => void;
  setupStrike?: (hit: boolean) => void;
  dropBallForGroundContact?: () => void;
  dropBallFrom?: (height: number, downwardVelocity?: number) => void;
  ballGroundContact?: boolean;
  ballGroundContactObserved?: boolean;
  mainPitchContactCount?: number;
  strikeReady?: boolean;
  strikeFeedback?: "idle" | "windup" | "hit" | "miss" | "recovery";
  ballRecoveryCount?: number;
  setupGoal?: (team: "blue" | "red") => void;
  setMatchSeconds?: (seconds: number) => void;
  restart?: () => void;
  resetPossession?: () => void;
};
type DebugWindow = Window & { __POLO_B1_DEBUG__?: PoloDebug };
let activeDebug: PoloDebug | undefined;
let strikeFeedback: PoloDebug["strikeFeedback"] = "idle",
  ballImpactUntil = 0;
let livePossession: Possession = loosePossession(),
  lastTouch: RiderId | undefined,
  suppressPossessionUntil = 0,
  ballGroundContact = false,
  ballGroundContactObserved = false,
  mainPitchContactCount = 0,
  ballRecoveryCount = 0;
let incomingPass: { target: ActiveHumanRiderId; until: number } | undefined;
const livePositions: Partial<Record<RiderId, THREE.Vector3>> = {},
  liveHeadings: Partial<Record<RiderId, { x: number; z: number }>> = {},
  liveSpeeds: Partial<Record<RiderId, number>> = {},
  liveStamina: Partial<Record<RiderId, number>> = {},
  rideOffPushes: Partial<Record<RiderId, { x: number; z: number }>> = {},
  rideOffPushEnds: Partial<Record<RiderId, number>> = {},
  rideOffRecoveryEnds: Partial<Record<RiderId, number>> = {},
  rideOffCooldowns: Record<string, number> = {};
function makeDebug(): PoloDebug {
  return {
    matchState: "PLAYING",
    score: { blue: 0, red: 0 },
    timeRemaining: 120,
    possession: loosePossession(),
    teamModes: { blue: "loose", red: "loose" },
    activeHumanRiderId: "blue1",
    cameraFollowId: "blue1",
    riders: {
      blue1: { id: "blue1", team: "blue", human: true, x: 0, y: 0, z: 0 },
      blue2: { id: "blue2", team: "blue", human: false, x: 0, y: 0, z: 0 },
      red1: { id: "red1", team: "red", human: false, x: 0, y: 0, z: 0 },
      red2: { id: "red2", team: "red", human: false, x: 0, y: 0, z: 0 },
    },
  };
}
function telemetry(id: RiderId, p: THREE.Vector3, human: boolean) {
  livePositions[id] = p;
  const r = activeDebug?.riders[id] as
    | (DebugRider & {
        heading?: { x: number; z: number };
        speed?: number;
        cooldownReady?: boolean;
      })
    | undefined;
  if (r) {
    r.x = p.x;
    r.y = p.y;
    r.z = p.z;
    r.human = human;
    r.heading = liveHeadings[id] ?? { x: 0, z: -1 };
    r.speed = liveSpeeds[id] ?? 5;
    r.cooldownReady = (rideOffCooldowns[id] ?? 0) <= performance.now();
  }
  const expected = Object.keys(RIDER_SPAWNS) as RiderId[];
  const ready =
    expected.length === 4 &&
    expected.every((riderId) => {
      const position = livePositions[riderId];
      return (
        !!position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        Number.isFinite(position.z)
      );
    });
  if (activeDebug)
    (activeDebug as PoloDebug & { ready?: boolean }).ready = ready;
}
function tryRideOff(challengerId: RiderId) {
  const now = performance.now(),
    challenger = livePositions[challengerId],
    debug = activeDebug as (PoloDebug & { lastRideOff?: unknown }) | undefined;
  if (!challenger) return;
  const riders = (Object.keys(RIDER_SPAWNS) as RiderId[]).flatMap((id) => {
    const p = livePositions[id];
    return p
      ? [
          {
            id,
            team: id.startsWith("blue") ? "blue" : "red",
            x: p.x,
            z: p.z,
            heading: liveHeadings[id] ?? { x: 0, z: -1 },
            speed: liveSpeeds[id] ?? 5,
          } satisfies RideOffRider,
        ]
      : [];
  });
  const selected = findRideOffTarget(
    riders.find((r) => r.id === challengerId)!,
    riders,
    now,
    rideOffCooldowns,
  );
  if (!selected.legal) {
    if (debug)
      debug.lastRideOff = {
        challengerId,
        targetId: undefined,
        legal: false,
        reason: selected.reason,
        strength: 0,
        timestamp: now,
      };
    return;
  }
  const result = selected,
    targetId = result.target.id as RiderId,
    targetProfile = RIDER_PONIES[targetId],
    challengerProfile = RIDER_PONIES[challengerId],
    targetRider = riders.find((r) => r.id === targetId)!,
    challengerRider = riders.find((r) => r.id === challengerId)!,
    delta = { x: targetRider.x - challengerRider.x, z: targetRider.z - challengerRider.z },
    distance = Math.max(.0001, Math.hypot(delta.x, delta.z)),
    forwardOffset = Math.abs((delta.x * challengerRider.heading.x + delta.z * challengerRider.heading.z) / distance),
    alignment = THREE.MathUtils.clamp(challengerRider.heading.x * targetRider.heading.x + challengerRider.heading.z * targetRider.heading.z, RIDE_OFF_ALIGNMENT_THRESHOLD, 1),
    contact = resolveRideOffContact({ challengerStrength: challengerProfile.strength, defenderBalance: targetProfile.balance, challengerSpeed: challengerRider.speed, defenderSpeed: targetRider.speed, alignment, sideBySide: 1 - forwardOffset }),
    pushLength = Math.max(.0001, Math.hypot(result.push.x, result.push.z)),
    effectivePush = { x: result.push.x / pushLength * contact.targetDisplacement, z: result.push.z / pushLength * contact.targetDisplacement },
    durationMs = Math.round(contact.recoveryDuration * 1000);
  rideOffPushes[targetId] = effectivePush;
  rideOffPushes[challengerId] = { x: -effectivePush.x * contact.attackerResponse / contact.targetDisplacement, z: -effectivePush.z * contact.attackerResponse / contact.targetDisplacement };
  rideOffPushEnds[targetId] = now + durationMs;
  rideOffPushEnds[challengerId] = now + durationMs;
  rideOffRecoveryEnds[targetId] = now + durationMs;
  rideOffCooldowns[challengerId] = now + RIDE_OFF_COOLDOWN_MS;
  rideOffCooldowns[targetId] = now + RIDE_OFF_COOLDOWN_MS;
  if (contact.contactScore >= 1) useMatch.getState().setMessage("RIDE-OFF!");
  if (debug)
    debug.lastRideOff = {
      challengerId,
      targetId,
      legal: true,
      reason: "legal",
      strength: result.strength,
      push: effectivePush,
      contactScore: contact.contactScore,
      recoveryDuration: contact.recoveryDuration,
      timestamp: now,
    };
}
function requestRideOff(challengerId: RiderId) {
  if (useMatch.getState().paused || useMatch.getState().matchPhase === "MATCH_OVER") return;
  const now = performance.now();
  if ((rideOffCooldowns[challengerId] ?? 0) > now) {
    const debug = activeDebug as
      (PoloDebug & { lastRideOff?: unknown }) | undefined;
    if (debug)
      debug.lastRideOff = {
        challengerId,
        targetId: undefined,
        legal: false,
        reason: "cooldown",
        strength: 0,
        timestamp: now,
      };
    return;
  }
  tryRideOff(challengerId);
}
if (typeof window !== "undefined")
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyF" && !event.repeat)
      requestRideOff(useMatch.getState().activeHumanRiderId);
  });
if (typeof window !== "undefined") {
  let rideButton = false;
  setInterval(() => {
    const pressed = !!navigator.getGamepads?.()[0]?.buttons[5]?.pressed;
    if (pressed && !rideButton)
      requestRideOff(useMatch.getState().activeHumanRiderId);
    rideButton = pressed;
  }, 16);
}
if (typeof window !== "undefined")
  window.addEventListener("polo-e2e-ride-setup", (event) => {
    const mode = (event as CustomEvent<"legal" | "head-on" | "ai">).detail,
      blue = livePositions.blue1,
      red = livePositions.red1;
    if (!blue || !red) return;
    blue.set(0, 0, 0);
    red.set(2, 0, 0);
    liveHeadings.blue1 = { x: 0, z: -1 };
    liveHeadings.red1 = { x: 0, z: mode === "head-on" ? 1 : -1 };
    liveSpeeds.blue1 = 6;
    liveSpeeds.red1 = 6;
    if (mode === "ai") tryRideOff("red1");
  });
function Field() {
  const line = (
    args: [number, number, number],
    position: [number, number, number],
  ) => (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[args[0], args[2]]} />
      <meshBasicMaterial color="#ecf3d8" />
    </mesh>
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FIELD_X, FIELD_Z]} />
        <meshStandardMaterial color="#2a7642" roughness={0.92} />
      </mesh>
      {[-30, -10, 10, 30].map((z) => (
        <mesh key={z} position={[0, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[FIELD_X, 20]} />
          <meshBasicMaterial color="#1f6237" transparent opacity={0.18} />
        </mesh>
      ))}
      {line([FIELD_X, 0.02, 0.18], [0, 0.02, 0])}
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, (s * FIELD_Z) / 2]}>
          {line([FIELD_X, 0.02, 0.2], [0, 0.02, -s * 0.2])}
          {[-5, 5].map((x) => (
            <mesh key={x} position={[x, 2, 0]} castShadow>
              <cylinderGeometry args={[0.22, 0.22, 4, 10]} />
              <meshStandardMaterial color="#fffdf0" emissive="#403410" emissiveIntensity={0.25} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.15, 1.28, 32]} />
        <meshBasicMaterial color="#eef6d9" />
      </mesh>
      {[-1, 1].flatMap((s) =>
        [-26, 26].map((x, i) => (
          <mesh
            key={`${s}${i}`}
            position={[x, 0.02, s * 20]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[0.12, 42]} />
            <meshBasicMaterial color="#eef6d9" />
          </mesh>
        )),
      )}
      <group position={[0, 0, -52]}>
        {[-22, -14, -6, 6, 14, 22].map((x) => (
          <mesh key={x} position={[x, 4, 0]}>
            <coneGeometry args={[3.4, 8, 7]} />
            <meshStandardMaterial color="#2f5e35" />
          </mesh>
        ))}
        <mesh position={[0, 2, -5]}>
          <boxGeometry args={[15, 4, 3]} />
          <meshStandardMaterial color="#d9c29a" />
        </mesh>
        <mesh position={[0, 4.5, -5]}>
          <coneGeometry args={[10, 3, 4]} />
          <meshStandardMaterial color="#563d2e" />
        </mesh>
      </group>
    </group>
  );
}
function FieldGround({ collider }: { collider: React.RefObject<RapierCollider | null> }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, FIELD_SURFACE_Y, 0]}>
      <CuboidCollider
        args={[FIELD_X / 2, FIELD_COLLIDER_THICKNESS / 2, FIELD_Z / 2]}
        ref={collider}
        position={[0, -FIELD_COLLIDER_THICKNESS / 2, 0]}
        sensor={false}
        name={PITCH_GROUND_COLLIDER_NAME}
      />
      <Field />
    </RigidBody>
  );
}
function HorseVisual({
  blue,
  profile,
  active,
  speed,
  action,
  strikeState,
  steer = 0,
}: {
  blue: boolean;
  profile: HorseVisualProfile;
  active: boolean;
  speed: number;
  action: number;
  strikeState: PoloDebug["strikeFeedback"];
  steer?: number;
}) {
  const gaitName = gaitForSpeed(speed), gait = Math.min(1, Math.abs(speed) / 16),
    tone = blue ? "#7b4e32" : "#5b3829",
    team = blue ? HORSE_VISUAL_TUNING.blueTeam : HORSE_VISUAL_TUNING.redTeam;
  const phase = action * (gaitName === "idle" ? 1.3 : gaitName === "walk" ? 4 : gaitName === "canter" ? 7 : 10),
    malletAngle = strikeState === "windup" ? 0.72 : strikeState === "hit" || strikeState === "miss" ? -1.12 : strikeState === "recovery" ? -0.52 : -0.32,
    leg = (x: number, z: number, n: number) => (
      <mesh
        key={`${x}${z}`}
        position={[x, .43 * profile.legLength, z]}
        rotation={[Math.sin(phase + n) * (.05 + gait * .34), 0, 0]}
        scale={[profile.legThickness, profile.legLength, profile.legThickness]}
      >
        <capsuleGeometry args={[0.115, 0.7, 5, 8]} />
        <meshStandardMaterial color="#2e1a12" />
      </mesh>
    );
  return (
    <group rotation={[0, 0, visualTurnLean(steer, speed)]} position={[0, gaitName === "idle" ? Math.sin(phase) * .015 : Math.sin(phase) * (.025 + gait * .07), 0]}>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.25, .62, 1]}>
        <circleGeometry args={[1, 20]} />
        <meshBasicMaterial color="#102016" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.2 * profile.bodyHeight, -0.04]} scale={[HORSE_VISUAL_TUNING.bodyScale[0] * profile.bodyLength, HORSE_VISUAL_TUNING.bodyScale[1] * profile.bodyHeight, HORSE_VISUAL_TUNING.bodyScale[2]]} castShadow>
        <sphereGeometry args={[0.58, 16, 12]} />
        <meshStandardMaterial color={tone} />
      </mesh>
      <mesh position={[0, 1.34 * profile.bodyHeight, .78]} scale={[profile.chestScale, profile.chestScale * profile.bodyHeight, profile.chestScale]} castShadow>
        <sphereGeometry args={[.5, 14, 10]} />
        <meshStandardMaterial color={tone} />
      </mesh>
      <mesh position={[0, 1.28 * profile.bodyHeight, -1.0]} scale={[profile.hindquarterScale, profile.hindquarterScale * profile.bodyHeight, profile.hindquarterScale]} castShadow>
        <sphereGeometry args={[.52, 14, 10]} />
        <meshStandardMaterial color={tone} />
      </mesh>
      <mesh position={[0, 1.55 * profile.bodyHeight, .86]} rotation={[.52, 0, 0]} scale={[profile.neckThickness, profile.neckLength, profile.neckThickness]} castShadow>
        <capsuleGeometry args={[0.19, .72, 6, 10]} />
        <meshStandardMaterial color={tone} />
      </mesh>
      <mesh position={[0, 2.02 * profile.bodyHeight, 1.34]} rotation={[.08, 0, 0]} scale={[profile.headScale, profile.headScale, profile.headScale]}>
        <sphereGeometry args={[0.24, 12, 10]} />
        <meshStandardMaterial color={tone} />
      </mesh>
      <mesh position={[0, 1.88 * profile.bodyHeight, 1.52]} scale={[profile.headScale, profile.headScale, profile.headScale]}>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color="#342018" />
      </mesh>
      {[-0.13, 0.13].map((x) => (
        <mesh key={x} position={[x * profile.headScale, 2.25 * profile.bodyHeight, 1.13]}>
          <coneGeometry args={[0.07, 0.3, 5]} />
          <meshStandardMaterial color="#2c1b13" />
        </mesh>
      ))}
      {leg(-0.38, -0.65, 0)}
      {leg(0.38, -0.65, Math.PI)}
      {leg(-0.38, 0.65, Math.PI)}
      {leg(0.38, 0.65, 0)}
      {[-.38, .38].flatMap(x => [-.65, .65].map(z => <mesh key={`hoof${x}${z}`} position={[x, .08, z + (z > 0 ? .08 : -.08)]} scale={[profile.legThickness, 1, 1]}><boxGeometry args={[.22, .12, .32]} /><meshStandardMaterial color="#15100d" /></mesh>))}
      <mesh
        position={[0, 1.35, -0.85]}
        rotation={[Math.sin(phase) * 0.18, 0, 0]}
      >
        <coneGeometry args={[0.12, 0.8, 7]} />
        <meshStandardMaterial color="#26170f" />
      </mesh>
      <group position={[0, gait * .08, 0]} rotation={[0, 0, strikeState === "windup" ? -.12 : strikeState === "hit" || strikeState === "miss" ? .14 : 0]}>
      <mesh position={[0, 1.62 * profile.bodyHeight, -.12]} rotation={[-Math.PI / 2, 0, 0]}>
        <boxGeometry args={[1.12, 0.82, 0.09]} />
        <meshStandardMaterial color={team} />
      </mesh>
      <mesh position={[0, 1.78 * profile.bodyHeight, -.03]} rotation={[gaitName === "gallop" ? -.2 : gaitName === "canter" ? -.1 : 0, 0, 0]} scale={[.9, 1.08, .72]}>
        <capsuleGeometry args={[0.24, 0.55, 6, 9]} />
        <meshStandardMaterial color={team} />
      </mesh>
      <mesh position={[0, 2.34 * profile.bodyHeight, -.02]} scale={[.72, .82, .72]}>
        <sphereGeometry args={[.22, 12, 10]} />
        <meshStandardMaterial color="#e6b493" />
      </mesh>
      <mesh position={[0, 2.47 * profile.bodyHeight, -.02]} scale={[.82, .46, .82]}><sphereGeometry args={[.25, 12, 8]} /><meshStandardMaterial color={blue ? "#17243d" : "#5d161b"} /></mesh>
      {[-.3, .3].map(x => <mesh key={`arm${x}`} position={[x, 1.95 * profile.bodyHeight, .13]} rotation={[.65 + gait * .14, 0, x * -.25]}><capsuleGeometry args={[.075, .48, 5, 7]} /><meshStandardMaterial color="#e6b493" /></mesh>)}
      {[-0.32, 0.32].map((x) => (
        <mesh key={x} position={[x, 1.35 * profile.bodyHeight, .12]} rotation={[.7 + gait * .12, 0, 0]}>
          <capsuleGeometry args={[0.11, 0.55, 5, 7]} />
          <meshStandardMaterial color="#38231a" />
        </mesh>
      ))}
      </group>
      <group position={[.34, 2.08 * profile.bodyHeight, .23]} rotation={[0, 0, malletAngle]}>
        <mesh position={[0, -.62, .15]}>
          <cylinderGeometry args={[.032, .04, HORSE_VISUAL_TUNING.malletLength, 6]} />
          <meshStandardMaterial color="#b98b45" />
        </mesh>
        <mesh position={[0, -.05, .15]}><cylinderGeometry args={[.055, .055, .18, 6]} /><meshStandardMaterial color="#1a1714" /></mesh>
        <mesh position={[0, -1.34, .15]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[.07, .07, .52, 6]} />
          <meshStandardMaterial color="#d0a15a" />
        </mesh>
      </group>
      {active && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.2, 1.34, 32]} />
          <meshBasicMaterial color="#f0cc5a" transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  );
}
function aiTarget(id: RiderId, b: { x: number; z: number }) {
  const tactical = deriveTacticalStates(livePossession)[id];
  if (incomingPass?.target === id && performance.now() < incomingPass.until)
    return new THREE.Vector3(b.x, 0, b.z);
  if (tactical === "SUPPORT")
    return new THREE.Vector3(
      b.x + (id.startsWith("blue") ? 7 : -7),
      0,
      b.z + (id.startsWith("blue") ? 8 : -8),
    );
  if (tactical === "DEFEND")
    return new THREE.Vector3(
      b.x * 0.6,
      0,
      b.z + (id.startsWith("blue") ? -8 : 8),
    );
  if (tactical === "RECOVER")
    return new THREE.Vector3(
      b.x * 0.4,
      0,
      b.z + (id.startsWith("blue") ? -16 : 16),
    );
  if (id === "blue1") return new THREE.Vector3(b.x - 6, 0, b.z + 4);
  if (id === "blue2") return new THREE.Vector3(b.x + 6, 0, b.z + 4);
  if (id === "red1") return new THREE.Vector3(b.x, 0, b.z);
  return new THREE.Vector3(b.x * 0.5, 0, Math.min(30, b.z * 0.5 - 10));
}
function PoloRider({
  id,
  ball,
  input,
  cameraTarget,
}: {
  id: RiderId;
  ball: React.RefObject<RapierRigidBody | null>;
  input: React.RefObject<Input>;
  cameraTarget: React.MutableRefObject<{
    position: THREE.Vector3;
    yaw: number;
    focus: THREE.Vector3;
  } | null>;
}) {
  const g = useRef<THREE.Group>(null),
    p = useRef(spawnToVector3(RIDER_SPAWNS[id])),
    yaw = useRef(Math.PI),
    speed = useRef(0),
    velocity = useRef(new THREE.Vector3()),
    reversalDirection = useRef<THREE.Vector3 | null>(null),
    charge = useRef(0),
    wasHolding = useRef(false),
    currentStamina = useRef(100),
    cameraSnapshot = useRef<{ position: THREE.Vector3; focus: THREE.Vector3 } | null>(null),
    wasPaused = useRef(false),
    [strikeState, setStrikeState] = useState<PoloDebug["strikeFeedback"]>("idle");
  const active = useMatch((s) => s.activeHumanRiderId),
    paused = useMatch((s) => s.paused),
    matchPhase = useMatch((s) => s.matchPhase),
    setMsg = useMatch((s) => s.setMessage),
    restartVersion = useMatch((s) => s.restartVersion);
  const blue = id === "blue1" || id === "blue2",
    human = blue && active === id;
  const pony = RIDER_PONIES[id];
  useEffect(() => {
    currentStamina.current = 100;
    liveStamina[id] = currentStamina.current;
    p.current.copy(spawnToVector3(RIDER_SPAWNS[id]));
    speed.current = 0;
    velocity.current.set(0, 0, 0);
    reversalDirection.current = null;
    yaw.current = Math.PI;
  }, [restartVersion]);
  useFrame((state, dt) => {
    if (!g.current || matchPhase === "MATCH_OVER") return;
    if (paused) {
      if (!wasPaused.current) {
        cameraSnapshot.current = {
          position: state.camera.position.clone(),
          focus: cameraTarget.current?.focus.clone() ?? p.current.clone(),
        };
        wasPaused.current = true;
      }
      return;
    }
    const safeDt = wasPaused.current ? 0 : Math.min(dt, 0.05);
    if (wasPaused.current && cameraSnapshot.current) {
      state.camera.position.copy(cameraSnapshot.current.position);
      state.camera.lookAt(cameraSnapshot.current.focus);
    }
    wasPaused.current = false;
    const pushEnd = rideOffPushEnds[id] ?? 0, pendingPush = rideOffPushes[id];
    if (pendingPush && pushEnd > performance.now()) {
      const remaining = Math.max(1, pushEnd - performance.now());
      const fraction = THREE.MathUtils.clamp((safeDt * 1000) / remaining, 0, .35);
      p.current.x += pendingPush.x * fraction;
      p.current.z += pendingPush.z * fraction;
      pendingPush.x *= 1 - fraction;
      pendingPush.z *= 1 - fraction;
    } else if (pendingPush) {
      delete rideOffPushes[id];
      delete rideOffPushEnds[id];
    }
    const isHuman = blue && useMatch.getState().activeHumanRiderId === id;
    let direction: THREE.Vector3 | undefined;
    if (isHuman) {
      const i = input.current;
      const galloping = i.gallop && i.throttle > 0;
      const endurance = pony.stamina / 100;
      currentStamina.current = THREE.MathUtils.clamp(currentStamina.current + (galloping ? -(2.8 - endurance * .8) : 1.5) * safeDt, 0, 100);
      const baseTargetSpeed = getTargetSpeed(i);
      const currentForward = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
      if (i.throttle < -0.1) {
        reversalDirection.current ??= currentForward.clone().multiplyScalar(-1);
      } else {
        reversalDirection.current = null;
      }
      const desiredDirection = (reversalDirection.current ?? currentForward)
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), i.steer * (reversalDirection.current ? 0.8 : 1.05));
      const reversalRequested = isStrongReversal(currentForward, desiredDirection);
      const reversingAtSpeed = reversalRequested && speed.current > 8;
      const requestedSpeed = Math.abs(baseTargetSpeed);
      const targetSpeed = reversingAtSpeed
        ? 0
        : requestedSpeed > 0 ? Math.min(requestedSpeed, maxSpeed(pony, currentStamina.current)) : 0;
      const accelerationRate = (2.5 + pony.acceleration / 20) * (currentStamina.current < 50 ? .78 : .95);
      speed.current = updateHorseSpeed(speed.current, targetSpeed, accelerationRate, i.brake, safeDt);
      const recoverySteering = (rideOffRecoveryEnds[id] ?? 0) > performance.now() ? .84 : 1;
      yaw.current += getSignedTurnStep(currentForward, desiredDirection, getSteeringAuthority(speed.current, pony.agility) * recoverySteering, safeDt);
      direction = new THREE.Vector3(
        Math.sin(yaw.current),
        0,
        Math.cos(yaw.current),
      );
      const grippedVelocity = alignVelocityToForward(velocity.current, direction, safeDt);
      velocity.current.set(grippedVelocity.x, 0, grippedVelocity.z);
      const forwardVelocity = velocity.current.dot(direction);
      const driveBlend = 1 - Math.exp(-8 * safeDt);
      velocity.current.addScaledVector(direction, (speed.current - forwardVelocity) * driveBlend);
      if (!Number.isFinite(velocity.current.x) || !Number.isFinite(velocity.current.z)) velocity.current.set(0, 0, 0);
      p.current.addScaledVector(velocity.current, safeDt);
      const holding = i.strike || i.power || i.backhand;
      const ballPosition = ball.current?.translation();
      const strikeReady = !!ballPosition && isStrikeInRange(p.current, ballPosition);
      if (activeDebug) activeDebug.strikeReady = strikeReady;
      if (holding && !wasHolding.current) {
        strikeFeedback = "windup";
        setStrikeState("windup");
      }
      if (holding) charge.current = Math.min(1, charge.current + safeDt * 0.8);
      if (
        !holding &&
        wasHolding.current &&
        charge.current > 0.1 &&
        ball.current
      ) {
        const bp = ball.current.translation();
        if (isStrikeInRange(p.current, bp)) {
          ball.current.applyImpulse(
            getShotImpulse({
              aimX: i.aimX,
              yaw: yaw.current,
              backhand: i.backhand,
              charge: charge.current,
              speed: speed.current,
            }),
            true,
          );
          ball.current.setLinvel(clampBallVelocity(ball.current.linvel()), true);
          strikeFeedback = "hit";
          ballImpactUntil = performance.now() + 180;
          setStrikeState("hit");
          setMsg(i.backhand ? "BACKHAND!" : "CLEAN STRIKE!");
        } else {
          strikeFeedback = "miss";
          setStrikeState("miss");
          setMsg("MISS");
        }
        window.setTimeout(() => {
          strikeFeedback = "recovery";
          setStrikeState("recovery");
          window.setTimeout(() => { strikeFeedback = "idle"; setStrikeState("idle"); }, 180);
        }, 110);
      }
      if (!holding) charge.current = 0;
      wasHolding.current = holding;
    } else {
      const b = ball.current?.translation();
      if (b) {
        direction = aiTarget(id, b).sub(p.current);
        direction.y = 0;
        if (Number.isFinite(direction.length()) && direction.length() > 0.3) {
          direction.normalize();
          p.current.addScaledVector(direction, safeDt * 5);
          yaw.current = Math.atan2(direction.x, direction.z);
        }
      }
    }
    p.current.x = THREE.MathUtils.clamp(
      p.current.x,
      -RIDER_FIELD_BOUNDS.x,
      RIDER_FIELD_BOUNDS.x,
    );
    p.current.z = THREE.MathUtils.clamp(
      p.current.z,
      -RIDER_FIELD_BOUNDS.z,
      RIDER_FIELD_BOUNDS.z,
    );
    g.current.position.copy(p.current);
    g.current.rotation.y = yaw.current;
    liveStamina[id] = currentStamina.current;
    telemetry(id, g.current.position, isHuman);
    if (isHuman) {
      activeDebug &&
        ((activeDebug.activeHumanRiderId = id as ActiveHumanRiderId),
        (activeDebug.cameraFollowId = id as ActiveHumanRiderId));
      const p1 = livePositions.blue1,
        p2 = livePositions.red1,
        ballPosition = ball.current?.translation();
      if (p1 && p2 && ballPosition) {
        const shared = sharedCamera(p1, ballPosition, p2),
          desired = new THREE.Vector3(
            shared.focus.x - Math.sin(yaw.current) * shared.distance,
            shared.focus.y + 7,
            shared.focus.z - Math.cos(yaw.current) * shared.distance,
          );
        state.camera.position.lerp(desired, 1 - Math.exp(-safeDt * 4));
        state.camera.lookAt(shared.focus.x, shared.focus.y, shared.focus.z);
        cameraTarget.current = { position: p.current, yaw: yaw.current, focus: new THREE.Vector3(shared.focus.x, shared.focus.y, shared.focus.z) };
        activeDebug && (activeDebug.camera = { position: { ...state.camera.position }, target: { ...shared.focus } });
        return;
      }
      const desired = p.current
        .clone()
        .add(
          new THREE.Vector3(
            -Math.sin(yaw.current) * 12,
            7,
            -Math.cos(yaw.current) * 12,
          ),
        );
      state.camera.position.lerp(desired, 1 - Math.exp(-safeDt * 4));
      state.camera.lookAt(p.current.x, p.current.y + 1, p.current.z);
      const focus = new THREE.Vector3(p.current.x, p.current.y + 1, p.current.z);
      cameraTarget.current = { position: p.current, yaw: yaw.current, focus };
      activeDebug && (activeDebug.camera = { position: { ...state.camera.position }, target: { ...focus } });
    }
  });
  return (
    <group ref={g}>
      <HorseVisual
        blue={blue}
        profile={visualProfileForRider(id)}
        active={human}
        speed={speed.current}
        action={performance.now() / 1000}
        strikeState={human ? strikeState : "idle"}
        steer={human ? input.current.steer : 0}
      />
      {(id === "blue1" || id === "red1") && (
        <Billboard follow>
        <Text
          position={[0, 3.5, 0]}
          fontSize={0.42}
          color={id === "blue1" ? "#9fc4ff" : "#ffaaa0"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.025}
          outlineColor="#102016"
        >
          {id === "blue1" ? "P1" : "P2"}
        </Text>
        </Billboard>
      )}
    </group>
  );
}
function BallEffects({ api }: { api: React.MutableRefObject<RapierRigidBody | null> }) {
  const impact = useRef<THREE.Mesh>(null), trail = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const p = api.current?.translation(), v = api.current?.linvel();
    if (!p) return;
    if (impact.current) {
      impact.current.visible = performance.now() < ballImpactUntil;
      impact.current.position.set(0, -BALL_RADIUS + 0.02, 0);
    }
    if (trail.current) {
      trail.current.visible = Math.hypot(v?.x ?? 0, v?.y ?? 0, v?.z ?? 0) > 18;
      trail.current.position.set(-(v?.x ?? 0) * 0.035, -(v?.y ?? 0) * 0.035, -(v?.z ?? 0) * 0.035);
    }
  });
  return <><mesh ref={impact} visible={false} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.3, 0.68, 24]} /><meshBasicMaterial color="#fff0a5" transparent opacity={0.9} /></mesh><mesh ref={trail} visible={false}><sphereGeometry args={[BALL_RADIUS * 0.72, 12, 10]} /><meshBasicMaterial color="#fff6c9" transparent opacity={0.34} /></mesh></>;
}
function Ball({
  api,
  groundCollider,
}: {
  api: React.MutableRefObject<RapierRigidBody | null>;
  groundCollider: React.RefObject<RapierCollider | null>;
}) {
  const key = useMatch((s) => s.resetKey);
  useEffect(() => {
    const reset = getBallResetState();
    api.current?.setTranslation(reset.position, true);
    api.current?.setLinvel(reset.velocity, true);
    livePossession = loosePossession();
    lastTouch = undefined;
    suppressPossessionUntil = performance.now() + 2500;
  }, [key, api]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("e2e") !== "1") return;
    const goal = (event: Event) => {
      const team = (event as CustomEvent<"blue" | "red">).detail;
      if (team === "blue" || team === "red") {
        api.current?.setTranslation(
          { x: 0, y: 0.65, z: team === "blue" ? 42.1 : -42.1 },
          true,
        );
        api.current?.setLinvel(
          { x: 0, y: 0, z: team === "blue" ? 8 : -8 },
          true,
        );
      }
    };
    window.addEventListener("polo-e2e-goal", goal);
    return () => window.removeEventListener("polo-e2e-goal", goal);
  }, [api]);
  return (
    <RigidBody
      ref={api}
      colliders={false}
      ccd
      gravityScale={1}
      restitution={0.38}
      friction={0.72}
      linearDamping={BALL_GROUND_ROLL_DAMPING}
      angularDamping={1.4}
      position={[0, 0.65, 0]}
    >
      <BallCollider
        args={[BALL_RADIUS]}
        sensor={false}
        name={BALL_COLLIDER_NAME}
        onCollisionEnter={({ other }) => {
          if (other.collider.handle !== groundCollider.current?.handle) return;
          ballGroundContact = true;
          ballGroundContactObserved = true;
          mainPitchContactCount += 1;
        }}
        onCollisionExit={({ other }) => {
          if (other.collider.handle !== groundCollider.current?.handle) return;
          ballGroundContact = false;
        }}
      />
      <mesh castShadow>
        <sphereGeometry args={[BALL_RADIUS, 20, 16]} />
        <meshStandardMaterial color="#fffdf2" emissive="#796f45" emissiveIntensity={0.28} roughness={0.45} />
      </mesh>
      <mesh position={[0, -BALL_RADIUS + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[BALL_RADIUS * 0.72, BALL_RADIUS * 0.88, 20]} />
        <meshBasicMaterial color="#fff2a8" transparent opacity={0.65} />
      </mesh>
      <BallEffects api={api} />
    </RigidBody>
  );
}
function Scene() {
  const ball = useRef<RapierRigidBody>(null),
    groundCollider = useRef<RapierCollider>(null),
    input = useInput(),
    cameraTarget = useRef<{ position: THREE.Vector3; yaw: number; focus: THREE.Vector3 } | null>(
      null,
    ),
    goalState = useRef(INITIAL_GOAL_STATE);
  const score = useMatch((s) => s.scoreGoal),
    paused = useMatch((s) => s.paused),
    matchPhase = useMatch((s) => s.matchPhase);
  const pass = () => {
    if (paused || matchPhase === "MATCH_OVER") return;
    const api = ball.current,
      from = useMatch.getState().activeHumanRiderId,
      origin = livePositions[from];
    if (!api || !origin) return;
    const target = getPassTarget(
        from,
        Object.entries(livePositions)
          .filter((entry): entry is [RiderId, THREE.Vector3] => !!entry[1])
          .map(([id, p]) => ({ id, x: p.x, y: p.y, z: p.z })),
      ),
      b = api.translation();
    if (!target || !canPass(origin, b)) return;
    const direction = getPassDirection(b, target);
    if (!direction.x && !direction.y && !direction.z) return;
    const tap = getTapImpulse(direction, liveSpeeds[from] ?? 0);
    api.applyImpulse(tap, true);
    api.setLinvel(clampBallVelocity(api.linvel()), true);
    incomingPass = {
      target: target.id as ActiveHumanRiderId,
      until: performance.now() + 2500,
    };
    if (activeDebug) {
      activeDebug.lastPass = {
        from,
        target: target.id as ActiveHumanRiderId,
        direction,
        power: tap.power,
      };
      livePossession = loosePossession();
      activeDebug.incomingPassTargetRiderId = target.id as ActiveHumanRiderId;
    }
  };
  useEffect(() => {
    window.addEventListener("polo-pass", pass);
    return () => window.removeEventListener("polo-pass", pass);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("e2e") !== "1") return;
    const debug = makeDebug(),
      win = window as DebugWindow;
    debug.setupPass = () => {
      const api = ball.current,
        from = useMatch.getState().activeHumanRiderId,
        p = livePositions[from];
      if (api && p) {
        api.setTranslation({ x: p.x, y: 0.65, z: p.z }, true);
        api.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    };
    debug.setupBallFor = (id) => {
      const api = ball.current,
        p = livePositions[id];
      if (api && p) {
        api.setTranslation({ x: p.x, y: 0.65, z: p.z }, true);
        api.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    };
    debug.setupStrike = (hit) => {
      const api = ball.current, p = livePositions.blue1;
      if (!api || !p) return;
      api.setTranslation({ x: p.x, y: 0.65, z: p.z + (hit ? 2 : 14) }, true);
      api.setLinvel({ x: 0, y: 0, z: 0 }, true);
      suppressPossessionUntil = performance.now() + 1000;
    };
    debug.dropBallFrom = (height, downwardVelocity = 0) => {
      const api = ball.current;
      if (!api) return;
      ballGroundContact = false;
      ballGroundContactObserved = false;
      mainPitchContactCount = 0;
      api.setTranslation({ x: 20, y: FIELD_SURFACE_Y + height, z: 30 }, true);
      api.setLinvel({ x: 0, y: downwardVelocity, z: 0 }, true);
      api.setAngvel({ x: 0, y: 0, z: 0 }, true);
      api.wakeUp();
      livePossession = loosePossession();
      suppressPossessionUntil = performance.now() + 5000;
    };
    debug.dropBallForGroundContact = () => debug.dropBallFrom?.(8);
    debug.resetPossession = () => {
      livePossession = loosePossession();
      lastTouch = undefined;
      suppressPossessionUntil = performance.now() + 1000;
    };
    activeDebug = debug;
    win.__POLO_B1_DEBUG__ = debug;
    return () => {
      if (activeDebug === debug) activeDebug = undefined;
      if (win.__POLO_B1_DEBUG__ === debug) delete win.__POLO_B1_DEBUG__;
    };
  }, []);
  useFrame(() => {
    const p = ball.current?.translation();
    if (p && ballNeedsRecovery(p.y)) {
      ballRecoveryCount += 1;
    }
    if (p) {
      const riders = Object.entries(livePositions)
        .filter((entry): entry is [RiderId, THREE.Vector3] => !!entry[1])
        .map(([id, r]) => ({ id, x: r.x, z: r.z }));
      const next =
        performance.now() < suppressPossessionUntil
          ? loosePossession()
          : updatePossession(livePossession, riders, p);
      if (next.kind !== livePossession.kind || next.kind !== "loose") {
        livePossession = next;
        if (next.kind !== "loose") lastTouch = next.riderId;
      }
    }
    if (activeDebug && p) {
      const match = useMatch.getState();
      activeDebug.matchState = match.matchPhase;
      activeDebug.score = { ...match.scores };
      activeDebug.timeRemaining = match.seconds;
      activeDebug.possession = livePossession;
      activeDebug.teamModes = deriveTeamModes(livePossession);
      activeDebug.lastTouchRiderId = lastTouch;
      activeDebug.lastTouchTeam = lastTouch?.startsWith("blue")
        ? "blue"
        : lastTouch
          ? "red"
          : undefined;
      const states = deriveTacticalStates(livePossession);
      for (const id of Object.keys(activeDebug.riders) as RiderId[])
        activeDebug.riders[id].tacticalState = states[id];
      const v = ball.current?.linvel();
      activeDebug.ball = {
        x: p.x,
        y: p.y,
        z: p.z,
        vx: v?.x ?? 0,
        vy: v?.y ?? 0,
        vz: v?.z ?? 0,
      };
      activeDebug.ballGroundContact = ballGroundContact;
      activeDebug.ballGroundContactObserved = ballGroundContactObserved;
      activeDebug.mainPitchContactCount = mainPitchContactCount;
      activeDebug.strikeFeedback = strikeFeedback;
      activeDebug.ballRecoveryCount = ballRecoveryCount;
      if (incomingPass && performance.now() >= incomingPass.until) {
        incomingPass = undefined;
        activeDebug.incomingPassTargetRiderId = undefined;
      }
    }
    if (!paused && matchPhase !== "MATCH_OVER" && p) {
      const result = transitionGoal(goalState.current, p);
      goalState.current = result.state;
      if (result.scored) {
        livePossession = loosePossession();
        lastTouch = undefined;
        score(p.z > 0 ? "blue" : "red");
      }
    }
  });
  return (
    <>
      <color attach="background" args={["#b9d5dd"]} />
      <fog attach="fog" args={["#b9d5dd", 45, 125]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[20, 28, 12]} intensity={2.2} />
      <Physics
        gravity={[0, -9.81, 0]}
        paused={paused}
        debug={new URLSearchParams(window.location.search).get("rapierDebug") === "1"}
      >
        <FieldGround collider={groundCollider} />
        <Ball api={ball} groundCollider={groundCollider} />
      </Physics>
      {(Object.keys(RIDER_SPAWNS) as RiderId[]).map((id) => (
        <PoloRider
          key={id}
          id={id}
          ball={ball}
          input={input}
          cameraTarget={cameraTarget}
        />
      ))}
      <Environment preset="park" />
    </>
  );
}
function TacticalMinimap() {
  const [snapshot, setSnapshot] = useState({ ball: { x: 0, z: 0 }, riders: {} as Partial<Record<RiderId, { x: number; z: number }>> });
  useEffect(() => {
    const update = () => {
      const ball = activeDebug?.ball ?? { x: 0, z: 0 };
      setSnapshot({ ball, riders: Object.fromEntries(Object.entries(livePositions).filter(([, p]) => !!p).map(([id, p]) => [id, { x: p!.x, z: p!.z }])) as Partial<Record<RiderId, { x: number; z: number }>> });
    };
    update(); const timer = window.setInterval(update, 125); return () => window.clearInterval(timer);
  }, []);
  return <div className="minimap" aria-label="Tactical minimap"><i className="minimap-line" />{Object.entries(snapshot.riders).map(([id, p]) => <i key={id} className={`map-dot ${id.startsWith("blue") ? "blue" : "red"} ${id === useMatch.getState().activeHumanRiderId ? "active" : ""}`} style={minimapPoint(p)} />)}<i className="map-ball" style={minimapPoint(snapshot.ball)} /></div>;
}
function Hud({ onMainMenu }: { onMainMenu: () => void }) {
  const s = useMatch();
  const [stamina, setStamina] = useState({ blue1: 100, red1: 100 });
  useEffect(() => {
    const update = () =>
      setStamina({
        blue1: Math.round(liveStamina.blue1 ?? 100),
        red1: Math.round(liveStamina.red1 ?? 100),
      });
    update();
    const timer = window.setInterval(update, 125);
    return () => window.clearInterval(timer);
  }, []);
  const mm = `${String(Math.floor(s.seconds / 60)).padStart(2, "0")}:${String(s.seconds % 60).padStart(2, "0")}`;
  const playerStamina = (player: "P1" | "P2", rider: "blue1" | "red1") => {
    const value = stamina[rider];
    const state = value < 25 ? "low" : value < 50 ? "caution" : "normal";
    return (
      <div className={`stamina-card ${state}`} data-testid={`stamina-${rider}`}>
        <b>{player} • {rider === "blue1" ? "SPRINTER" : "POWER"}</b>
        <div className="stamina-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${value}%` }} />
        </div>
        <small>{value}% STAMINA</small>
      </div>
    );
  };
  return (
    <div className="hud">
      <header>
        <span>POLO CHAMPIONS</span>
        <b>QUICK MATCH</b>
        <button onClick={s.restart}>RESTART</button>
      </header>
      <div className="score">
        <small>BLUE</small>
        <strong>{s.scores.blue}</strong>
        <em>{mm}</em>
        <strong>{s.scores.red}</strong>
        <small>RED</small>
      </div>
      <TacticalMinimap />
      {!s.paused && <div className="notice">{s.message}</div>}
      <div className="stamina-hud">
        {playerStamina("P1", "blue1")}
        {playerStamina("P2", "red1")}
      </div>
      <footer>
        <b>WASD</b> Ride <b>TAB</b> Switch <b>E</b> Pass <b>SHIFT</b> Gallop{" "}
        <b>X</b> Brake <b>SPACE</b> Strike <b>Q</b> Backhand
      </footer>
      {s.paused && (
        <div className="pause">
          <small>POLO CHAMPIONS</small>
          <strong>PAUSED</strong>
          <button onClick={s.togglePause}>RESUME</button>
          <button onClick={s.restart}>RESTART MATCH</button>
          <button onClick={onMainMenu}>MAIN MENU</button>
        </div>
      )}
      {s.matchPhase === "MATCH_OVER" && (
        <div className="match-over">
          <small>MATCH OVER</small>
          <strong>{getMatchResult(s.scores)}</strong>
          <span>
            BLUE {s.scores.blue} — {s.scores.red} RED
          </span>
          <button onClick={s.restart}>RESTART MATCH</button>
          <button onClick={onMainMenu}>MAIN MENU</button>
        </div>
      )}
    </div>
  );
}
function TitleScreen({ onStart }: { onStart: () => void }) {
  return <main className="title-screen"><div className="title-card"><small>PLAYABLE ALPHA</small><h1>POLO CHAMPIONS</h1><p>British Polo Game</p><button onClick={onStart}>QUICK MATCH</button><span>LOCAL 2 PLAYER + AI</span><em>WASD / GAMEPAD SUPPORTED</em></div></main>;
}
export function Game() {
  const setSec = useMatch((s) => s.setSeconds),
    paused = useMatch((s) => s.paused),
    matchPhase = useMatch((s) => s.matchPhase),
    toggle = useMatch((s) => s.togglePause),
    reset = useMatch((s) => s.resetBall),
    switchPlayer = useMatch((s) => s.switchPlayer),
    [atMenu, setAtMenu] = useState(() => new URLSearchParams(window.location.search).get("e2e") !== "1");
  useEffect(() => {
    const t = setInterval(() => {
      if (!paused && matchPhase !== "MATCH_OVER")
        setSec(Math.max(0, useMatch.getState().seconds - 1));
    }, 1000);
    const p = () => toggle(),
      r = () => { if (!useMatch.getState().paused) reset(); },
      sw = () => { if (!useMatch.getState().paused) switchPlayer(); },
      setE2eSeconds = (event: Event) => {
        if (new URLSearchParams(window.location.search).get("e2e") === "1")
          setSec((event as CustomEvent<number>).detail);
      };
    window.addEventListener("polo-pause", p);
    window.addEventListener("polo-reset", r);
    window.addEventListener("polo-switch", sw);
    window.addEventListener("polo-e2e-seconds", setE2eSeconds);
    return () => {
      clearInterval(t);
      window.removeEventListener("polo-pause", p);
      window.removeEventListener("polo-reset", r);
      window.removeEventListener("polo-switch", sw);
      window.removeEventListener("polo-e2e-seconds", setE2eSeconds);
    };
  }, [paused, matchPhase, setSec, toggle, reset, switchPlayer]);
  if (atMenu) return <TitleScreen onStart={() => { useMatch.getState().restart(); setAtMenu(false); }} />;
  return (
    <main>
      <Canvas shadows camera={{ fov: 54, position: [0, 8, 25] }}>
        <Scene />
      </Canvas>
      <Hud onMainMenu={() => setAtMenu(true)} />
    </main>
  );
}
const PASSIVE_DECELERATION = 5.5;
const BRAKE_DECELERATION = 12;

export function updateHorseSpeed(
  currentSpeed: number,
  desiredSpeed: number,
  acceleration: number,
  braking: boolean,
  dt: number,
) {
  const safeCurrentSpeed = Number.isFinite(currentSpeed) ? Math.max(0, currentSpeed) : 0;
  const safeDesiredSpeed = Number.isFinite(desiredSpeed) ? Math.max(0, desiredSpeed) : 0;
  const safeDt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.05) : 0;
  const maxDelta = (braking
    ? BRAKE_DECELERATION
    : safeDesiredSpeed >= safeCurrentSpeed
      ? Math.max(0, acceleration)
      : PASSIVE_DECELERATION) * safeDt;
  const nextSpeed = THREE.MathUtils.clamp(
    THREE.MathUtils.damp(safeCurrentSpeed, safeDesiredSpeed, maxDelta / Math.max(safeDt, 0.0001), safeDt),
    0,
    safeDesiredSpeed > 0 ? safeDesiredSpeed : safeCurrentSpeed,
  );
  return Number.isFinite(nextSpeed) ? nextSpeed : 0;
}
