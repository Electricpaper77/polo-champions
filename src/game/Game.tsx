import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { Suspense, useEffect, useRef, useState } from "react";
import { useInput, type Input } from "./InputManager";
import { GOAL_CELEBRATION_MS, initializeMatchEntities, useMatch } from "./GameState";
import { advanceStamina, getBodyLean, getGait, integrateHorseMotion, MAX_GALLOP_SPEED, type HorseArchetype } from "./HorseControls";
import { BALL_FIELD_DRAG, BALL_SURFACE_FRICTION, canApplyStrike, getBallResetState, getMalletAngle, getShotImpulse, getStrikePhase, isBallInMalletSweep } from "./PoloMechanics";
import { advanceBotRider, assignAITacticalRoles, detectGoalCrossing, getBotShotImpulse, getBotTacticalTarget, isBallInPlay, isLineOfBallFoul, resolveRideOffCollision, selectBallChasers } from "./MatchRules";
import { CareerStatsManager } from "../services/CareerStats";
import { PoloEntity } from "./PoloEntity";
import { PitchEnvironment } from "./PitchEnvironment";
import { FixedTimestepLoop } from "./GameLoop";
import { SnapshotBuffer, reconcileLocalEntity, type InputCommand, type NetworkEntityState } from "./NetworkSync";
import { networkManager, type PlayerControlChange } from "../services/NetworkManager";
import { matchTelemetry } from "../services/Telemetry";
import type { PoloRiderEntity } from "./GameState";
import { DEFAULT_CAMERA_DISTANCE, getAdvancedCameraOffset, smoothCameraDistance } from "./Camera";
import { getEffectiveSwingCharge, getPlayerCombos } from "./PlayerState";

const FIELD_X=52, FIELD_Z=82;
const ACTIVE_ARCHETYPE: HorseArchetype = "ALL_ROUNDER";
export function FoulToast({ active }: { active: boolean }) { return active ? <div className="foul-toast" role="alert">FOUL: LINE OF BALL CROSSING</div> : null; }
export function playerControlNotice(change: PlayerControlChange) { return change.state === "AI_BACKFILL" ? `Player '${change.playerName}' disconnected. AI taking over.` : `Player '${change.playerName}' reconnected.`; }
function NetworkNotice(){const [message,setMessage]=useState("");const timer=useRef<ReturnType<typeof setTimeout>|null>(null);useEffect(()=>{const show=(value:string)=>{setMessage(value);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setMessage(""),4_000)};const offControl=networkManager.on("playerControl",change=>show(playerControlNotice(change)));const offStatus=networkManager.on("status",status=>{if(status.state==="DISCONNECTED")show("Connection lost. AI is protecting your rider while reconnecting.")});return()=>{offControl();offStatus();if(timer.current)clearTimeout(timer.current)}},[]);return message?<div className="network-toast" role="alert">{message}</div>:null}
function CareerMatchEnd(){const seconds=useMatch(s=>s.seconds),score=useMatch(s=>s.score),recorded=useRef(false);useEffect(()=>{if(seconds===0&&!recorded.current){recorded.current=true;CareerStatsManager.recordMatch({won:score.blue>score.red,goals:score.blue,rideOffs:0});matchTelemetry.completeMatch()}},[seconds,score]);return null}
function Ball({api}:{api:React.MutableRefObject<RapierRigidBody|null>}){const key=useMatch(s=>s.resetKey);useEffect(()=>{const reset=getBallResetState();api.current?.setTranslation(reset.position,true);api.current?.setLinvel(reset.velocity,true);api.current?.setAngvel({x:0,y:0,z:0},true)},[key,api]);return <RigidBody ref={api} colliders="ball" ccd linearDamping={BALL_FIELD_DRAG} angularDamping={.82} restitution={.38} friction={BALL_SURFACE_FRICTION} position={[0,.65,0]}><mesh castShadow><sphereGeometry args={[.42,20,16]}/><meshStandardMaterial color="#f8f4e8" roughness={.45}/></mesh></RigidBody>}

const NETWORK_ENTITY_IDS: PoloRiderEntity["id"][] = ["player", "blue_2", "blue_3", "blue_4", "blue_5", "blue_6", "red_1", "red_2", "red_3", "red_4", "red_5", "red_6"];

function cloneEntities(entities: ReturnType<typeof initializeMatchEntities>) {
  return Object.fromEntries(Object.entries(entities).map(([id, entity]) => [id, { ...entity, position: { ...entity.position }, velocity: { ...entity.velocity } }])) as ReturnType<typeof initializeMatchEntities>;
}

function RealtimeHorse({ ball, input }: { ball: React.RefObject<RapierRigidBody | null>; input:React.RefObject<Input> }) {
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
      const hasPlayerIntent = Math.abs(currentInput.throttle)>.01 || Math.abs(currentInput.steer)>.01 || currentInput.strike || currentInput.backhand || currentInput.rideOff;
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
      if (frozenAtKickoff) {
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
      stamina.current = advanceStamina(stamina.current, gait === "GALLOP" && canGallop, delta, activeArchetype);
      const forward = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
      position.current.x = THREE.MathUtils.clamp(position.current.x, -24, 24);
      position.current.z = THREE.MathUtils.clamp(position.current.z, -39, 39);

      const store = useMatch.getState();
      const local = store.entities[assignedId];
      store.setEntities({ ...store.entities, [assignedId]: { ...local, position: { x: position.current.x, y: position.current.z }, velocity: { x: velocity.current.x, y: velocity.current.z }, heading: yaw.current, stamina: stamina.current } });
      group.current?.position.copy(position.current);
      if (group.current) {
        group.current.rotation.y = yaw.current;
        group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, getBodyLean(currentInput.steer, speed.current, activeArchetype), 9, delta);
      }

      const holding = currentInput.strike || currentInput.backhand;
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
        const hit = isBallInMalletSweep({
          riderPosition: { x: position.current.x, z: position.current.z },
          ballPosition: { x: ballPosition.x, z: ballPosition.z },
          yaw: yaw.current,
          aimX: releasedAim.current.x,
          backhand: releasedBackhand.current,
          previousElapsed: previousStrikeElapsed,
          currentElapsed: strikeClock.current,
        });
        if (hit) {
          contactFired.current = true;
          const releaseVelocity = getShotImpulse({
            aimX: releasedAim.current.x,
            aimY: releasedAim.current.y,
            yaw: yaw.current,
            backhand: releasedBackhand.current,
            charge: releasedCharge.current,
            speed: speed.current,
            horseVelocity: { x: velocity.current.x, y: velocity.current.y, z: velocity.current.z },
          });
          ball.current.setLinvel(releaseVelocity, true);
          cooldown.current = .38;
          setMessage(powerStrikeArmed.current ? "POWER STRIKE!" : releasedBackhand.current ? "BACKHAND!" : "CLEAN STRIKE!");
        }
      }
      if (!holding && phase === "READY") { charge.current = 0; powerStrikeArmed.current = false; releasedBackhand.current = false; }
      wasHolding.current = holding;

      const cameraTarget = currentInput.cameraRecenter ? DEFAULT_CAMERA_DISTANCE : currentInput.cameraZoom;
      cameraDistance.current = smoothCameraDistance(cameraDistance.current, cameraTarget, delta);
      const offset = getAdvancedCameraOffset(yaw.current, speed.current, currentInput.steer, cameraDistance.current, currentInput.lookBack);
      const desired = position.current.clone().add(new THREE.Vector3(offset.x, offset.y, offset.z));
      const look = position.current.clone().addScaledVector(forward, offset.lookAhead);
      state.camera.position.lerp(desired, 1 - Math.exp(-delta * (5 + Math.min(Math.abs(speed.current) / MAX_GALLOP_SPEED, 1) * 2)));
      state.camera.lookAt(look.x, look.y + 1, look.z);

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

  useEffect(() => {
    const initial = networkManager.getActiveMatch()?.initialState;
    if (initial) buffer.current.push(initial);
    return networkManager.on("snapshot", snapshot => buffer.current.push(snapshot));
  }, []);

  useFrame((state, delta) => {
    const store = useMatch.getState();
    const online = networkManager.getActiveMatch()?.mode === "WEBSOCKET";
    if (online) {
      const snapshot = buffer.current.sample(Date.now() - 100);
      if (!snapshot) return;
      const next = cloneEntities(store.entities);
      for (const remote of snapshot.entities) {
        if (remote.id === assignedId) continue;
        const entity = next[remote.id];
        next[remote.id] = { ...entity, position: { x: remote.position.x, y: remote.position.z }, velocity: { x: remote.velocity.x, y: remote.velocity.z }, heading: remote.heading };
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
      next[id].position.x=THREE.MathUtils.clamp(next[id].position.x,-24,24);
      next[id].position.y=THREE.MathUtils.clamp(next[id].position.y,-39,39);
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

  return <>{remoteIds.map(id => <group key={id} ref={element => { groups.current[id] = element; }} position={[entities[id].position.x, 0, entities[id].position.y]}><Suspense fallback={null}><PoloEntity entity={entities[id]} /></Suspense></group>)}</>;
}
function Scene({input}:{input:React.RefObject<Input>}){const ball=useRef<RapierRigidBody>(null),previousBall=useRef({x:0,z:0});const score=useMatch(s=>s.scoreGoal),paused=useMatch(s=>s.paused),started=useMatch(s=>s.started),resetKey=useMatch(s=>s.resetKey);useEffect(()=>{previousBall.current={x:0,z:0}},[resetKey]);useFrame(()=>{const p=ball.current?.translation();if(!p)return;const current={x:p.x,z:p.z};if(!paused&&started){const team=detectGoalCrossing(previousBall.current,current);if(team)score(team)}previousBall.current=current});return <><color attach="background" args={["#b9d5dd"]}/><fog attach="fog" args={["#b9d5dd",45,125]}/><PitchEnvironment width={FIELD_X} length={FIELD_Z}/><Physics gravity={[0,-9.81,0]} timeStep={1/60} updateLoop="independent" interpolate><RigidBody type="fixed" colliders="cuboid" position={[0,-.25,0]}><mesh visible={false}><boxGeometry args={[FIELD_X, .5, FIELD_Z]}/></mesh></RigidBody><Ball api={ball}/></Physics><RealtimeHorse ball={ball} input={input}/><RealtimeBots ball={ball} input={input}/><Suspense fallback={null}><Environment preset="park" /></Suspense></>}
function FieldRadar(){const entities=useMatch(s=>s.entities),ball=useMatch(s=>s.telemetry.ball),radar=(v:{x:number;z:number})=>({left:`${50+v.x/FIELD_X*90}%`,top:`${50-v.z/FIELD_Z*90}%`});return <section className="radar" aria-label="Field radar"><b>FIELD RADAR · 8 RIDERS</b>{Object.values(entities).map(rider=><i key={rider.id} title={rider.id} className={`pip rider ${rider.team} ${rider.id==="player"?"player":""}`} style={radar({x:rider.position.x,z:rider.position.y})}/>)}<i className="pip ball" title="ball" style={radar(ball)}/></section>}
function restartMatch(){networkManager.requestMatchReset();useMatch.getState().restart()}
function Hud(){const s=useMatch(),t=s.telemetry;const mm=`${String(Math.floor(s.seconds/60)).padStart(2,"0")}:${String(s.seconds%60).padStart(2,"0")}`,speedKmh=t.speed*3.6;return <div className="hud"><header className="broadcast"><div className="team blue"><b>BLUE</b><small>ROYAL GUARD</small><strong>{s.score.blue}</strong></div><div className="match"><small>CHUKKER 1</small><strong>{mm}</strong><em>POLO CHAMPIONS</em><small>{s.started?"LIVE":"AWAITING KICK OFF"}</small></div><div className="team red"><strong>{s.score.red}</strong><small>SCARLET WOLVES</small><b>RED</b></div><button onClick={restartMatch}>RESTART</button></header><div className="archetype">{ACTIVE_ARCHETYPE.replace("_"," ")} · {t.gait}</div><div className="notice">{s.message}</div>{s.celebratingGoal&&<div className={`goal-celebration ${s.celebratingGoal}`} role="status">{s.celebratingGoal.toUpperCase()} GOAL!</div>}{s.activeFoul&&<div className="foul-toast" role="alert">FOUL: LINE OF BALL CROSSING</div>}<FieldRadar/><section className="telemetry" aria-label="Speed and stamina" data-speed-kmh={speedKmh.toFixed(1)} data-stamina={t.stamina.toFixed(3)} data-gait={t.gait}><div className="speed"><strong>{Math.round(speedKmh)}</strong><small>KM/H</small></div><b>{t.gait}</b><label>STAMINA <span><i style={{width:`${t.stamina*100}%`}}/></span></label></section>{t.strikePhase==="WIND_UP"&&<section className="swing" aria-label="Swing charge">SWING POWER <span><i style={{width:`${t.charge*100}%`}}/></span></section>}<footer aria-label="PC controls"><b>WASD</b> Ride <b>LMB</b> Swing <b>RMB</b> Ride-off <b>SHIFT</b> Sprint <b>CTRL</b> Collect <b>SPACE</b> Focus <b>Q/E</b> Pass <b>R+LMB</b> Power <b>F+RMB</b> Mark <b>V</b> Look back <b>MMB/WHEEL</b> Camera <b>ESC</b> Pause</footer>{s.paused&&<div className="pause" role="dialog" aria-label="Pause menu">PAUSED<br/><button onClick={s.togglePause}>RESUME</button></div>}</div>}
export function Game(){const setSec=useMatch(s=>s.setSeconds),paused=useMatch(s=>s.paused),started=useMatch(s=>s.started),celebratingGoal=useMatch(s=>s.celebratingGoal),completeGoalCelebration=useMatch(s=>s.completeGoalCelebration),toggle=useMatch(s=>s.togglePause),reset=useMatch(s=>s.resetBall),input=useInput(paused||celebratingGoal!==null);useEffect(()=>{const entities=initializeMatchEntities(),match=networkManager.getActiveMatch();if(match)for(const remote of match.initialState.entities){const current=entities[remote.id];entities[remote.id]={...current,position:{x:remote.position.x,y:remote.position.z},velocity:{x:remote.velocity.x,y:remote.velocity.z},heading:remote.heading};}useMatch.getState().setEntities(entities)},[]);useEffect(()=>networkManager.on("goal",goal=>useMatch.getState().scoreGoal(goal.team,goal.score)),[]);useEffect(()=>{if(!celebratingGoal)return;const timer=setTimeout(()=>completeGoalCelebration(),GOAL_CELEBRATION_MS);return()=>clearTimeout(timer)},[celebratingGoal,completeGoalCelebration]);useEffect(()=>{const t=setInterval(()=>{if(!paused&&started)setSec(Math.max(0,useMatch.getState().seconds-1))},1000);const p=()=>toggle(),r=()=>{networkManager.requestMatchReset();reset()};window.addEventListener("polo-pause",p);window.addEventListener("polo-reset",r);return()=>{clearInterval(t);window.removeEventListener("polo-pause",p);window.removeEventListener("polo-reset",r)}},[paused,started,setSec,toggle,reset]);return <main><Canvas shadows camera={{fov:54,position:[0,8,25]}}><Scene input={input}/></Canvas><Hud/><NetworkNotice/><CareerMatchEnd/></main>}



