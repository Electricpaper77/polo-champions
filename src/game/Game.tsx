import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { GameSceneLighting } from "./GameScene";
import * as THREE from "three";
import { Suspense, useEffect, useRef, useState } from "react";
import { useInput, type Input } from "./InputManager";
import { GOAL_CELEBRATION_MS, initializeMatchEntities, useMatch } from "./GameState";
import { advanceStamina, getDynamicBank, getGait, integrateHorseMotion, MAX_GALLOP_SPEED, type HorseArchetype } from "./HorseControls";
import { BALL_BOUNCE_ELASTICITY, BALL_FIELD_DRAG, BALL_MIN_Y, BALL_SURFACE_FRICTION, canApplyStrike, getBallResetState, getMalletAngle, getMalletSweepContact, getShotImpulse, getStrikePhase } from "./PoloMechanics";
import { advanceBotRider, assignAITacticalRoles, detectGoalCrossing, getBotShotImpulse, getBotTacticalTarget, isBallInPlay, isLineOfBallFoul, resolveRideOffCollision, selectBallChasers } from "./MatchRules";
import { CareerStatsManager } from "../services/CareerStats";
import { PoloEntity } from "./PoloEntity";
import { StadiumEnvironment } from "../services/StadiumEnvironment";
import { FixedTimestepLoop } from "./GameLoop";
import { NETWORK_JITTER_BUFFER_MS, SnapshotBuffer, reconcileLocalEntity, type InputCommand, type NetworkEntityState } from "./NetworkSync";
import { networkManager, type PlayerControlChange } from "../services/NetworkManager";
import { matchTelemetry } from "../services/Telemetry";
import type { PoloRiderEntity } from "./GameState";
import { DEFAULT_CAMERA_DISTANCE, getAdvancedCameraOffset, nextCameraMode, smoothCameraDistance, type CameraMode } from "./Camera";
import { getTrackingFov, trackingLerpAlpha } from "./GameCamera";
import { getEffectiveSwingCharge, getPlayerCombos } from "./PlayerState";
import { AudioEngine } from "../services/AudioEngine";
import { AudioManager } from "./AudioManager";
import { MatchParticles } from "./Particles";
import { PostMatchModal } from "../components/PostMatchModal";
import { DynamicResolution } from "./Performance";
import { DeveloperTimeSkip } from "../components/UI";
import { PostProcessing } from "./PostProcessing";
import { Radar } from "../components/Radar";
import { ChatBox } from "../components/ChatBox";
import { NameTag, NameTagRenderer } from "./NameTags";
import { buildBotBackfill } from "./Matchmaker";
import { TouchControls } from "../components/TouchControls";
import { TouchActionButtons } from "../components/TouchActionButtons";
import { isLowTierDevice, RenderThrottle } from "./LODManager";
import { replaySystem } from "./ReplaySystem";
import { SpectatorCamera } from "./SpectatorCamera";

const FIELD_X=72, FIELD_Z=120;
const ACTIVE_ARCHETYPE: HorseArchetype = "ALL_ROUNDER";
export function FoulToast({ active }: { active: boolean }) { return active ? <div className="foul-toast" role="alert">FOUL: LINE OF BALL CROSSING</div> : null; }
export function playerControlNotice(change: PlayerControlChange) { return change.state === "AI_BACKFILL" ? `Player '${change.playerName}' disconnected. AI taking over.` : `Player '${change.playerName}' reconnected.`; }
function NetworkNotice(){const [message,setMessage]=useState("");const timer=useRef<ReturnType<typeof setTimeout>|null>(null);useEffect(()=>{const show=(value:string)=>{setMessage(value);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setMessage(""),4_000)};const offControl=networkManager.on("playerControl",change=>show(playerControlNotice(change)));const offStatus=networkManager.on("status",status=>{if(status.state==="DISCONNECTED")show("Connection lost. AI is protecting your rider while reconnecting.")});return()=>{offControl();offStatus();if(timer.current)clearTimeout(timer.current)}},[]);return message?<div className="network-toast" role="alert">{message}</div>:null}
function CareerMatchEnd(){const seconds=useMatch(s=>s.seconds),score=useMatch(s=>s.score),recorded=useRef(false);useEffect(()=>{if(seconds===0&&!recorded.current){recorded.current=true;CareerStatsManager.recordMatch({won:score.blue>score.red,goals:score.blue,rideOffs:0});matchTelemetry.completeMatch()}},[seconds,score]);return null}
function Ball({api}:{api:React.MutableRefObject<RapierRigidBody|null>}){const key=useMatch(s=>s.resetKey);useEffect(()=>{const reset=getBallResetState();api.current?.setTranslation(reset.position,true);api.current?.setLinvel(reset.velocity,true);api.current?.setAngvel({x:0,y:0,z:0},true)},[key,api]);useFrame(()=>{const body=api.current,position=body?.translation();if(!body||!position)return;AudioManager.setEmitterPosition("ball",position);if(position.y<BALL_MIN_Y){body.setTranslation({x:position.x,y:BALL_MIN_Y,z:position.z},true);const velocity=body.linvel();body.setLinvel({x:velocity.x,y:Math.max(0,velocity.y),z:velocity.z},true)}});return <RigidBody ref={api} colliders="ball" ccd linearDamping={BALL_FIELD_DRAG} angularDamping={.82} restitution={BALL_BOUNCE_ELASTICITY} friction={BALL_SURFACE_FRICTION} position={[0,.15,0]}><mesh castShadow><sphereGeometry args={[.42,20,16]}/><meshPhysicalMaterial color="#ffffff" roughness={.24} metalness={.03} clearcoat={.5}/></mesh><mesh position={[0,-.414,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.34,18]}/><meshBasicMaterial color="#172014" transparent opacity={.28} depthWrite={false}/></mesh></RigidBody>}

const NETWORK_ENTITY_IDS: PoloRiderEntity["id"][] = ["player", "blue_2", "blue_3", "blue_4", "red_1", "red_2", "red_3", "red_4"];

function cloneEntities(entities: ReturnType<typeof initializeMatchEntities>) {
  return Object.fromEntries(Object.entries(entities).map(([id, entity]) => [id, { ...entity, position: { ...entity.position }, velocity: { ...entity.velocity } }])) as ReturnType<typeof initializeMatchEntities>;
}

function RealtimeHorse({ ball, input, cameraMode }: { ball: React.RefObject<RapierRigidBody | null>; input:React.RefObject<Input>; cameraMode: CameraMode }) {
  const assignedId = networkManager.getActiveMatch()?.assignedEntityId ?? "player";
  const cosmetics = useMatch(state => state.entities[assignedId]);
  const actionPhase = useMatch(state => state.telemetry.strikePhase);
  const start = useMatch.getState().entities[assignedId];
  const group = useRef<THREE.Group>(null);
  const motion = useRef({ turn: 0, braking: false });
  const position = useRef(new THREE.Vector3(start.position.x, 0, start.position.y));
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const yaw = useRef(start.heading);
  const speed = useRef(0);
  const stamina = useRef(1);
  const charge = useRef(0);
  const cooldown = useRef(0);
  const swing = useRef(0);
  const strikeClock = useRef(-1);
  const contactFired = useRef(false);
  const wasHolding = useRef(false);
  const releasedAim = useRef({ x:0, y:0 });
  const releasedCharge = useRef(0);
  const releasedBackhand = useRef(false);
  const powerStrikeArmed = useRef(false);
  const cameraDistance = useRef(DEFAULT_CAMERA_DISTANCE);
  const freeFlyPosition = useRef<THREE.Vector3 | null>(null);
  const lastUtilityAction = useRef("");
  const telemetryClock = useRef(0);
  const sequence = useRef(0);
  const latestCommand = useRef<InputCommand | null>(null);
  const loop = useRef(new FixedTimestepLoop(60, 20));
  const paused = useMatch(state => state.paused);
  const resetKey = useMatch(state => state.resetKey);
  const setMessage = useMatch(state => state.setMessage);
  const setTelemetry = useMatch(state => state.setTelemetry);

  useEffect(() => {
    const reset = initializeMatchEntities()[assignedId];
    position.current.set(reset.position.x,0,reset.position.y);
    velocity.current.set(0,0,0);
    yaw.current=reset.heading;
    speed.current=0;
    stamina.current=1;
    charge.current=0;
    strikeClock.current=-1;
    latestCommand.current=null;
    loop.current.reset();
    group.current?.position.copy(position.current);
    if(group.current)group.current.rotation.y=yaw.current;
  },[assignedId,resetKey]);

  useEffect(() => networkManager.on("snapshot", snapshot => {
    const authoritative = snapshot.entities.find(entity => entity.id === assignedId);
    if (!authoritative) return;
    const predicted: NetworkEntityState = {
      id: assignedId,
      position: { x: position.current.x, z: position.current.z },
      velocity: { x: velocity.current.x, z: velocity.current.z },
      heading: yaw.current,
      gait: getGait(Math.abs(speed.current)),
    };
    const corrected = reconcileLocalEntity(predicted, authoritative);
    position.current.set(corrected.position.x, 0, corrected.position.z);
    velocity.current.set(corrected.velocity.x, 0, corrected.velocity.z);
    yaw.current = corrected.heading;
    speed.current = Math.hypot(corrected.velocity.x, corrected.velocity.z);
  }), [assignedId]);

  useFrame((state, frameDelta) => {
    if (!group.current || paused) return;
    loop.current.advance(frameDelta, delta => {
      const currentInput = input.current;
      const currentStore = useMatch.getState();
      const external = currentStore.entities[assignedId];
      if (Math.hypot(external.position.x-position.current.x,external.position.y-position.current.z)>.01) position.current.set(external.position.x,0,external.position.y);
      if (Math.hypot(external.velocity.x-velocity.current.x,external.velocity.y-velocity.current.z)>.01) {
        velocity.current.set(external.velocity.x,0,external.velocity.y);
        speed.current=velocity.current.length();
      }
      const hasPlayerIntent = cameraMode !== "FREE_FLY" && (Math.abs(currentInput.throttle)>.01 || Math.abs(currentInput.steer)>.01 || currentInput.strike || currentInput.backhand || currentInput.rideOff);
      const frozenForGoal=currentStore.celebratingGoal!==null;
      const frozenAtKickoff = frozenForGoal||(!currentStore.started && !hasPlayerIntent);
      if (!currentStore.started && hasPlayerIntent&&!frozenForGoal) { currentStore.setStarted(true); setMessage("PLAY"); }
      const combos = getPlayerCombos(currentInput);
      if (combos.powerStrike) powerStrikeArmed.current = true;
      const utilityAction = combos.defensiveMark ? "DEFENSIVE MARK LOCKED"
        : combos.sprintFocus ? "SPRINT & FOCUS"
          : currentInput.callPass ? "CALL FOR PASS"
            : currentInput.quickPass ? "QUICK PASS"
              : currentInput.hookMallet ? "HOOK MALLET"
                : currentInput.activeTactic ? `TACTIC ${currentInput.activeTactic}` : "";
      if (utilityAction && utilityAction !== lastUtilityAction.current) setMessage(utilityAction);
      lastUtilityAction.current = utilityAction;
      motion.current = { turn: currentInput.steer, braking: currentInput.brake };
      const canGallop = currentInput.gallop && stamina.current > 0;
      const activeArchetype = cosmetics.archetype ?? ACTIVE_ARCHETYPE;
      if (frozenAtKickoff || cameraMode === "FREE_FLY") {
        velocity.current.set(0,0,0);
        speed.current=0;
        latestCommand.current=null;
      } else {
        const next = integrateHorseMotion({
          position:{x:position.current.x,z:position.current.z},
          velocity:{x:velocity.current.x,z:velocity.current.z},
          heading:yaw.current,
        }, {...currentInput,gallop:canGallop}, delta, activeArchetype);
        position.current.set(next.position.x,0,next.position.z);
        velocity.current.set(next.velocity.x,0,next.velocity.z);
        yaw.current=next.heading;
        speed.current=velocity.current.length();
      }
      const gait = getGait(speed.current);
      AudioEngine.syncGallop(speed.current);
      AudioManager.setEmitterPosition(`horse-${assignedId}`, position.current);
      AudioManager.syncGallop(`horse-${assignedId}`, speed.current);
      stamina.current = advanceStamina(stamina.current, gait === "GALLOP" && canGallop, delta, activeArchetype);
      const forward = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
      if (currentInput.focus && ball.current) {
        ball.current.setTranslation({ x: position.current.x + 1.5, y: .15, z: position.current.z }, true);
        ball.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      position.current.x = THREE.MathUtils.clamp(position.current.x, -32, 32);
      position.current.z = THREE.MathUtils.clamp(position.current.z, -54, 54);

      const store = useMatch.getState();
      const local = store.entities[assignedId];
      store.setEntities({ ...store.entities, [assignedId]: { ...local, position: { x: position.current.x, y: position.current.z }, velocity: { x: velocity.current.x, y: velocity.current.z }, heading: yaw.current, stamina: stamina.current } });
      group.current?.position.copy(position.current);
      if (group.current) {
        group.current.rotation.y = yaw.current;
        group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, getDynamicBank(speed.current, currentInput.steer * 1.5), 9, delta);
      }

      const holding = currentInput.strike || currentInput.backhand;
      if (holding && !wasHolding.current) AudioManager.play("mallet_swing", `horse-${assignedId}`);
      if (holding && currentInput.backhand) releasedBackhand.current = true;
      const released = !holding && wasHolding.current;
      swing.current = getMalletAngle(swing.current, holding, released, delta);
      const previousStrikeElapsed = strikeClock.current;
      if (released) {
        releasedAim.current = { ...currentInput.aimDirection };
        releasedCharge.current = getEffectiveSwingCharge(charge.current, powerStrikeArmed.current);
        strikeClock.current = 0;
        contactFired.current = false;
      } else if (strikeClock.current >= 0) strikeClock.current += delta;
      const phase = getStrikePhase(strikeClock.current, holding);
      if (holding) charge.current = Math.min(1, charge.current + delta);
      cooldown.current -= delta;
      if (canApplyStrike(phase, contactFired.current) && cooldown.current <= 0 && ball.current) {
        const ballPosition = ball.current.translation();
        const contact = getMalletSweepContact({
          riderPosition: { x: position.current.x, z: position.current.z },
          ballPosition: { x: ballPosition.x, z: ballPosition.z },
          yaw: yaw.current,
          aimX: releasedAim.current.x,
          backhand: releasedBackhand.current,
          previousElapsed: previousStrikeElapsed,
          currentElapsed: strikeClock.current,
        });
        if (contact.hit) {
          contactFired.current = true;
          const releaseVelocity = getShotImpulse({
            aimX: releasedAim.current.x,
            aimY: releasedAim.current.y,
            yaw: yaw.current,
            backhand: releasedBackhand.current,
            charge: releasedCharge.current,
            speed: speed.current,
            horseVelocity: { x: velocity.current.x, y: velocity.current.y, z: velocity.current.z },
            swingTangent: contact.tangent,
          });
          ball.current.setLinvel(releaseVelocity, true);
          networkManager.sendShotAttempt();
          AudioEngine.playMalletStrike(speed.current);
          AudioManager.play("wood_hit", "ball", 1 + Math.min(speed.current, 30) / 60);
          cooldown.current = .38;
          setMessage(powerStrikeArmed.current ? "POWER STRIKE!" : releasedBackhand.current ? "BACKHAND!" : "CLEAN STRIKE!");
        }
      }
      if (!holding && phase === "READY") { charge.current = 0; powerStrikeArmed.current = false; releasedBackhand.current = false; }
      wasHolding.current = holding;

      const cameraTarget = currentInput.cameraRecenter ? DEFAULT_CAMERA_DISTANCE : currentInput.cameraZoom;
      cameraDistance.current = smoothCameraDistance(cameraDistance.current, cameraTarget, delta);
      const offset = getAdvancedCameraOffset(yaw.current, speed.current, currentInput.steer, cameraDistance.current, currentInput.lookBack);
      const ballFocus = ball.current?.translation();
      const followDesired = position.current.clone().add(new THREE.Vector3(offset.x, offset.y, offset.z));
      const followLook = position.current.clone().addScaledVector(forward, offset.lookAhead);
      const sidelineLook = new THREE.Vector3(ballFocus?.x ?? position.current.x, 1.3, ballFocus?.z ?? position.current.z);
      const goalSide = (ballFocus?.z ?? position.current.z) >= 0 ? 1 : -1;
      const goalLook = new THREE.Vector3(ballFocus?.x ?? 0, 0, ballFocus?.z ?? 0);
      if (cameraMode === "FREE_FLY") {
        const freeFly = freeFlyPosition.current ?? state.camera.position.clone();
        freeFlyPosition.current = freeFly;
        freeFly.add(new THREE.Vector3(currentInput.steer, currentInput.quickPass ? 1 : currentInput.callPass ? -1 : 0, -currentInput.throttle).multiplyScalar(18 * delta));
      state.camera.position.copy(freeFly);
        state.camera.lookAt(freeFly.x + Math.sin(yaw.current) * 8, freeFly.y, freeFly.z + Math.cos(yaw.current) * 8);
      } else {
        freeFlyPosition.current = null;
        const desired = cameraMode === "BROADCAST" ? new THREE.Vector3(23, 4.4, sidelineLook.z + 7) : cameraMode === "GOAL_CAM" ? new THREE.Vector3(0, 16, goalSide * 38) : followDesired;
        const look = cameraMode === "BROADCAST" ? sidelineLook : cameraMode === "GOAL_CAM" ? goalLook : followLook;
        state.camera.position.lerp(desired, trackingLerpAlpha(delta, speed.current));
        state.camera.lookAt(look.x, look.y + 1, look.z);
      }
      AudioManager.setListenerPosition(state.camera.position);
      AudioManager.attachThreeListener(state.camera);
      const trackingFov=getTrackingFov(state.size.width/state.size.height, speed.current), perspectiveCamera=state.camera as THREE.PerspectiveCamera;
      if (Math.abs(perspectiveCamera.fov - trackingFov) > .01) { perspectiveCamera.fov=THREE.MathUtils.damp(perspectiveCamera.fov, trackingFov, 8, delta); perspectiveCamera.updateProjectionMatrix(); }

      if (!frozenAtKickoff) latestCommand.current = { sequence: ++sequence.current, clientTime: Date.now(), input: { throttle: currentInput.throttle, steer: currentInput.steer, gallop: canGallop, brake: currentInput.brake, strike: currentInput.strike, power: combos.powerStrike, backhand: currentInput.backhand, aimX: currentInput.aimX, aimY: currentInput.aimY, rideOff:currentInput.rideOff } };
      telemetryClock.current += delta;
      if (telemetryClock.current > .08) {
        telemetryClock.current = 0;
        const ballPosition = ball.current?.translation() ?? { x: 0, z: 0 };
        const measuredSpeed = velocity.current.length();
        setTelemetry({ speed: measuredSpeed, stamina: stamina.current, gait: getGait(measuredSpeed), charge: charge.current, strikePhase: phase, player: { x: position.current.x, z: position.current.z }, ball: { x: ballPosition.x, z: ballPosition.z } });
      }
    }, () => {
      if (latestCommand.current) networkManager.sendInput(latestCommand.current);
    });
  });

  return <group ref={group}><Suspense fallback={null}><PoloEntity entity={cosmetics} motion={motion} action={actionPhase === "WIND_UP" ? "WIND_UP" : actionPhase === "CONTACT" || actionPhase === "FOLLOW_THROUGH" ? "STRIKE" : input.current.rideOff ? "RIDE_OFF_BRACE" : "NONE"} /></Suspense></group>;
}

function RealtimeBots({ ball, input }: { ball: React.RefObject<RapierRigidBody | null>; input:React.RefObject<Input> }) {
  const assignedId = networkManager.getActiveMatch()?.assignedEntityId ?? "player";
  const remoteIds = NETWORK_ENTITY_IDS.filter(id => id !== assignedId);
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const buffer = useRef(new SnapshotBuffer());
  const strikeCooldowns = useRef<Record<string,number>>({});
  const entities = useMatch(state => state.entities);
  const [tutorialMode, setTutorialMode] = useState(() => window.POLO_TUTORIAL_ACTIVE === true);

  useEffect(() => { const update = () => setTutorialMode(window.POLO_TUTORIAL_ACTIVE === true); window.addEventListener("polo-tutorial-mode", update); return () => window.removeEventListener("polo-tutorial-mode", update); }, []);

  useEffect(() => {
    const initial = networkManager.getActiveMatch()?.initialState;
    if (initial) buffer.current.push(initial);
    return networkManager.on("snapshot", snapshot => buffer.current.push(snapshot));
  }, []);

  useFrame((state, delta) => {
    if (window.POLO_TUTORIAL_ACTIVE) return;
    const store = useMatch.getState();
    const online = networkManager.getActiveMatch()?.mode === "WEBSOCKET";
    if (online) {
      const snapshot = buffer.current.sample(Date.now() - NETWORK_JITTER_BUFFER_MS);
      if (!snapshot) return;
      const next = cloneEntities(store.entities);
      const networkCosmetics = networkManager.getActiveMatch()?.playerCosmetics;
      for (const remote of snapshot.entities) {
        if (remote.id === assignedId) continue;
        const entity = next[remote.id];
        const cosmetics=networkCosmetics?.[remote.id];
        const coat=cosmetics?.coat === "DAPPLE_GREY" ? "Gray" : cosmetics?.coat === "BLACK" ? "Black" : cosmetics?.coat === "CHESTNUT" ? "Chestnut" : entity.coat;
        next[remote.id] = { ...entity, coat, mallet:cosmetics?.mallet ?? entity.mallet, position: { x: remote.position.x, y: remote.position.z }, velocity: { x: remote.velocity.x, y: remote.velocity.z }, heading: remote.heading };
      }
      const ballBody = ball.current;
      if (ballBody) {
        ballBody.setTranslation({ x: snapshot.ball.position.x, y: snapshot.ball.y, z: snapshot.ball.position.z }, true);
        ballBody.setLinvel({ x: snapshot.ball.velocity.x, y: 0, z: snapshot.ball.velocity.z }, true);
      }
      store.setEntities(next);
      for (const id of remoteIds) {
        const group = groups.current[id];
        const entity = next[id];
        if (!group) continue;
        group.position.x = THREE.MathUtils.damp(group.position.x, entity.position.x, 18, delta);
        group.position.z = THREE.MathUtils.damp(group.position.z, entity.position.y, 18, delta);
        group.rotation.y = THREE.MathUtils.damp(group.rotation.y, entity.heading, 18, delta);
      }
      return;
    }

    const ballPosition = ball.current?.translation() ?? { x: 0, z: 0 };
    const ballVelocity = ball.current?.linvel() ?? { x: 0, z: 0 };
    const next = cloneEntities(store.entities);
    const tacticalRiders=remoteIds.map(id=>next[id]);
    const ballVector={x:ballPosition.x,z:ballPosition.z};
    const activePlay=store.started&&isBallInPlay(ballVector,{x:ballVelocity.x,z:ballVelocity.z});
    const chasers=selectBallChasers(tacticalRiders,ballVector);
    const aiRoles=assignAITacticalRoles(tacticalRiders,ballVector);
    for (const id of remoteIds) {
      const entity=next[id],chaser=activePlay&&chasers[entity.team]===id;
      const target=getBotTacticalTarget(entity,ballVector,chasers,activePlay,aiRoles[id]);
      next[id]=advanceBotRider(entity,target,chaser,delta,aiRoles[id]);
      next[id].position.x=THREE.MathUtils.clamp(next[id].position.x,-32,32);
      next[id].position.y=THREE.MathUtils.clamp(next[id].position.y,-54,54);
      strikeCooldowns.current[id]=Math.max(0,(strikeCooldowns.current[id]??0)-delta);
      const toBall={x:ballPosition.x-next[id].position.x,z:ballPosition.z-next[id].position.y};
      const facing={x:Math.sin(next[id].heading),z:Math.cos(next[id].heading)};
      const facingBall=(toBall.x*facing.x+toBall.z*facing.z)/(Math.hypot(toBall.x,toBall.z)||1);
      if(chaser&&Math.hypot(toBall.x,toBall.z)<3.4&&facingBall>.72&&strikeCooldowns.current[id]<=0&&ball.current){
        ball.current.setLinvel(getBotShotImpulse(next[id],ballVector),true);
        strikeCooldowns.current[id]=1.25;
        store.setMessage(`${next[id].team.toUpperCase()} CLEARANCE`);
      }
    }
    for (let first = 0; first < NETWORK_ENTITY_IDS.length; first += 1) for (let second = first + 1; second < NETWORK_ENTITY_IDS.length; second += 1) {
      const a = next[NETWORK_ENTITY_IDS[first]], b = next[NETWORK_ENTITY_IDS[second]];
      const collision=resolveRideOffCollision(a,b,{dt:delta,aRideOff:a.id===assignedId&&input.current.rideOff,bRideOff:b.id===assignedId&&input.current.rideOff});
      if(!collision.corrected)continue;
      a.position={x:collision.a.position.x,y:collision.a.position.z};
      b.position={x:collision.b.position.x,y:collision.b.position.z};
      a.velocity={x:collision.a.velocity.x,y:collision.a.velocity.z};
      b.velocity={x:collision.b.velocity.x,y:collision.b.velocity.z};
    }
    const velocity = ball.current?.linvel();
    if (velocity && Math.hypot(velocity.x, velocity.z) > .5) for (const id of remoteIds) {
      const rider = next[id];
      if (isLineOfBallFoul({ x: ballPosition.x, z: ballPosition.z }, { x: velocity.x, z: velocity.z }, { x: rider.position.x, z: rider.position.y }, "BLUE", rider.team.toUpperCase() as "BLUE" | "RED")) {
        store.setActiveFoul({ type: "LOB_CROSSING", timestamp: state.clock.elapsedTime * 1000 });
        break;
      }
    }
    if (store.activeFoul && state.clock.elapsedTime * 1000 - store.activeFoul.timestamp > 2500) store.setActiveFoul(null);
    store.setEntities(next);
    for (const id of remoteIds) {
      const group = groups.current[id], entity = next[id];
      if (group) { group.position.set(entity.position.x, 0, entity.position.y); group.rotation.y = entity.heading; }
    }
  });

  const names = networkManager.getActiveMatch()?.playerNames;
  const backfill = buildBotBackfill(new Set(Object.keys(names ?? {}) as PoloRiderEntity["id"][]));
  return tutorialMode ? null : <>{remoteIds.map(id => <group key={id} ref={element => { groups.current[id] = element; }} position={[entities[id].position.x, 0, entities[id].position.y]}><Suspense fallback={null}><PoloEntity entity={entities[id]} /></Suspense><NameTag name={names?.[id] ?? backfill.find(slot => slot.id === id)?.name ?? `[BOT] ${id}`}/></group>)}</>;
}
function Scene({input,cameraMode,lowTier,replay}:{input:React.RefObject<Input>;cameraMode:CameraMode;lowTier:boolean;replay:{active:boolean;playing:boolean;speed:number}}){const ball=useRef<RapierRigidBody>(null),previousBall=useRef({x:0,z:0}),replayTime=useRef(0);const score=useMatch(s=>s.scoreGoal),paused=useMatch(s=>s.paused),started=useMatch(s=>s.started),resetKey=useMatch(s=>s.resetKey);useEffect(()=>{replaySystem.start();previousBall.current={x:0,z:0}},[resetKey]);useFrame((_,delta)=>{const p=ball.current?.translation();if(!p)return;if(replay.active){if(replay.playing)replayTime.current+=delta*replay.speed;const frame=replaySystem.sample(replayTime.current);if(frame){ball.current?.setTranslation(frame.ball,true);const entities=useMatch.getState().entities,next={...entities};for(const [id,value] of Object.entries(frame.players)){const entity=next[id as PoloRiderEntity["id"]];if(entity)next[id as PoloRiderEntity["id"]]={...entity,position:{x:value.x,y:value.z},heading:value.heading}}useMatch.getState().setEntities(next)}return;}replaySystem.capture(delta,useMatch.getState().entities,p);const current={x:p.x,z:p.z};if(!paused&&started){const team=detectGoalCrossing(previousBall.current,current);if(team){AudioEngine.playGoalHorn();AudioManager.play("referee_whistle");AudioManager.play("crowd_cheer");score(team)}}previousBall.current=current});return <><RenderThrottle enabled={lowTier}/><DynamicResolution/><color attach="background" args={["#b9d5dd"]}/><fog attach="fog" args={["#b9d5dd",45,125]}/><StadiumEnvironment/><Physics gravity={[0,-9.81,0]} timeStep={1/60} updateLoop="independent" interpolate><RigidBody type="fixed" colliders="cuboid" position={[0,-.25,0]}><mesh visible={false}><boxGeometry args={[FIELD_X, .5, FIELD_Z]}/></mesh></RigidBody><Ball api={ball}/></Physics><MatchParticles/><RealtimeHorse ball={ball} input={input} cameraMode={cameraMode}/><RealtimeBots ball={ball} input={input}/>{replay.active&&<SpectatorCamera input={input}/>}<Suspense fallback={null}><Environment preset="park" /></Suspense><PostProcessing enabled={!lowTier}/><NameTagRenderer/></>}
function FieldRadar(){const entities=useMatch(s=>s.entities),ball=useMatch(s=>s.telemetry.ball),radar=(v:{x:number;z:number})=>({left:`${50+v.x/FIELD_X*90}%`,top:`${50-v.z/FIELD_Z*90}%`});return <section className="radar" aria-label="Field radar"><b>FIELD RADAR · 8 RIDERS</b>{Object.values(entities).map(rider=><i key={rider.id} title={rider.id} className={`pip rider ${rider.team} ${rider.id==="player"?"player":""}`} style={radar({x:rider.position.x,z:rider.position.y})}/>)}<i className="pip ball" title="ball" style={radar(ball)}/></section>}
function restartMatch(){networkManager.requestMatchReset();useMatch.getState().restart()}
function Hud({cameraMode,onToggleAudio}:{cameraMode:CameraMode;onToggleAudio:()=>void}){const s=useMatch(),t=s.telemetry;const mm=`${String(Math.floor(s.seconds/60)).padStart(2,"0")}:${String(s.seconds%60).padStart(2,"0")}`,speedKmh=t.speed*3.6;return <div className="hud"><header className="broadcast"><div className="team blue"><b>BLUE</b><small>ROYAL GUARD</small><strong>{s.score.blue}</strong></div><div className="match"><small>CHUKKER 1 | MATCH LIVE</small><strong>{mm}</strong><em>POLO CHAMPIONS</em><small>{s.started?"LIVE":"AWAITING KICK OFF"}</small></div><div className="team red"><strong>{s.score.red}</strong><small>SCARLET WOLVES</small><b>RED</b></div><button onClick={onToggleAudio} aria-label="Toggle master volume">{AudioEngine.isMuted?"SOUND OFF":"SOUND ON"}</button><button onClick={restartMatch}>RESTART</button></header><div className="archetype">{ACTIVE_ARCHETYPE.replace("_"," ")} · {t.gait} · {cameraMode}</div>{!s.started&&<div className="notice">{s.message}</div>}{s.celebratingGoal&&<div className={`goal-celebration ${s.celebratingGoal}`} role="status">{s.celebratingGoal.toUpperCase()} GOAL!</div>}{s.activeFoul&&<div className="foul-toast" role="alert">FOUL: LINE OF BALL CROSSING</div>}<Radar/><ChatBox/><TouchControls/><TouchActionButtons/><section className="telemetry" aria-label="Speed and stamina" data-speed-kmh={speedKmh.toFixed(1)} data-stamina={t.stamina.toFixed(3)} data-gait={t.gait}><div className="speed"><strong>{Math.round(speedKmh)}</strong><small>KM/H</small></div><b>{t.gait}</b><label>STAMINA <span><i style={{width:`${t.stamina*100}%`}}/></span></label></section>{t.strikePhase==="WIND_UP"&&<section className="swing" aria-label="Swing charge">SWING POWER <span><i style={{width:`${t.charge*100}%`}}/></span></section>}<footer aria-label="PC controls"><b>WASD</b> Ride <b>LMB</b> Swing <b>RMB</b> Ride-off <b>SHIFT</b> Sprint <b>C</b> Camera <b>ESC</b> Pause</footer>{s.paused&&<div className="pause" role="dialog" aria-label="Pause menu">PAUSED<br/><button onClick={s.togglePause}>RESUME</button></div>}</div>}
export function Game() {
  const setSec = useMatch(s => s.setSeconds), paused = useMatch(s => s.paused), started = useMatch(s => s.started), celebratingGoal = useMatch(s => s.celebratingGoal), completeGoalCelebration = useMatch(s => s.completeGoalCelebration), chukkerTransition = useMatch(s => s.chukkerTransition), advanceChukker = useMatch(s => s.advanceChukker), matchComplete = useMatch(s => s.matchComplete), toggle = useMatch(s => s.togglePause), reset = useMatch(s => s.resetBall), input = useInput(paused || celebratingGoal !== null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("FOLLOW"), [muted, setMuted] = useState(AudioEngine.isMuted);
  const lowTier = isLowTierDevice();
  const [replay,setReplay]=useState({active:false,playing:false,speed:1});
  useEffect(()=>{const update=(event:Event)=>setReplay(current=>({...current,...(event as CustomEvent<Partial<typeof current>>).detail}));window.addEventListener("polo-replay",update);return()=>window.removeEventListener("polo-replay",update)},[]);
  useEffect(() => { const unlock = () => { void AudioEngine.resume(); AudioEngine.startAmbientCrowd(); }; window.addEventListener("pointerdown", unlock, { once:true }); window.addEventListener("keydown", unlock, { once:true }); return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); }; }, []);
  useEffect(() => { AudioEngine.setPresentationLowPass(paused || matchComplete); }, [paused, matchComplete]);
  useEffect(() => { const isProductionBuild = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true; const camera = (event:KeyboardEvent) => { if (event.repeat) return; if (!isProductionBuild && event.code === "F10") setCameraMode(mode => mode === "FREE_FLY" ? "FOLLOW" : "FREE_FLY"); else if (event.code === "KeyC") setCameraMode(mode => nextCameraMode(mode)); }; window.addEventListener("keydown", camera); return () => window.removeEventListener("keydown", camera); }, []);
  useEffect(() => { const entities = initializeMatchEntities(), match = networkManager.getActiveMatch(); if (match) for (const remote of match.initialState.entities) { const current = entities[remote.id]; entities[remote.id] = { ...current, position:{ x:remote.position.x, y:remote.position.z }, velocity:{ x:remote.velocity.x, y:remote.velocity.z }, heading:remote.heading }; } useMatch.getState().setEntities(entities); }, []);
  useEffect(() => networkManager.on("goal", goal => { AudioEngine.playGoalHorn(); AudioManager.play("referee_whistle"); AudioManager.play("crowd_cheer"); useMatch.getState().scoreGoal(goal.team, goal.score); }), []);
  useEffect(() => { if (!celebratingGoal) return; const timer = setTimeout(() => completeGoalCelebration(), GOAL_CELEBRATION_MS); return () => clearTimeout(timer); }, [celebratingGoal, completeGoalCelebration]);
  useEffect(() => { if (!chukkerTransition) return; AudioEngine.playWhistle(); AudioManager.play("referee_whistle"); const timer = setTimeout(advanceChukker, 2500); return () => clearTimeout(timer); }, [chukkerTransition, advanceChukker]);
  useEffect(() => { const timer = setInterval(() => { if (!paused && started) setSec(Math.max(0, useMatch.getState().seconds - 1)); }, 1000); const pause = () => toggle(), restart = () => { networkManager.requestMatchReset(); reset(); }; window.addEventListener("polo-pause", pause); window.addEventListener("polo-reset", restart); return () => { clearInterval(timer); window.removeEventListener("polo-pause", pause); window.removeEventListener("polo-reset", restart); }; }, [paused, started, setSec, toggle, reset]);
  return <main><Canvas shadows frameloop={lowTier?"demand":"always"} dpr={lowTier?[.65,.8]:[.75,1]} camera={{fov:54,position:[0,8,25]}}><GameSceneLighting/><Scene input={input} cameraMode={cameraMode} lowTier={lowTier} replay={replay}/></Canvas><Hud cameraMode={cameraMode} onToggleAudio={() => setMuted(AudioEngine.toggleMuted())}/>{chukkerTransition && <div className="pause">END OF CHUKKER<br/><small>PONY CHANGE</small></div>}<DeveloperTimeSkip/><PostMatchModal/><NetworkNotice/><CareerMatchEnd/></main>;
}











