import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { Suspense, useEffect, useRef } from "react";
import { useInput } from "./InputManager";
import { initializeMatchEntities, useMatch } from "./GameState";
import { advanceHorseSpeed, advanceStamina, getBodyLean, getCameraOffset, getGait, getSteeringRate, type HorseArchetype } from "./HorseControls";
import { canApplyStrike, getBallResetState, getMalletAngle, getShotImpulse, getStrikePhase, INITIAL_GOAL_STATE, transitionGoal } from "./PoloMechanics";
import { decideBot, isLineOfBallFoul, rideOffImpulse, type Bot } from "./MatchRules";
import { CareerStatsManager } from "../services/CareerStats";
import { PoloEntity } from "./PoloEntity";
import { PitchEnvironment } from "./PitchEnvironment";
import { FixedTimestepLoop } from "./GameLoop";
import { SnapshotBuffer, reconcileLocalEntity, type InputCommand, type NetworkEntityState } from "./NetworkSync";
import { networkManager } from "../services/NetworkManager";
import type { PoloRiderEntity } from "./GameState";

const FIELD_X=52, FIELD_Z=82;
const ACTIVE_ARCHETYPE: HorseArchetype = "ALL_ROUNDER";
export function FoulToast({ active }: { active: boolean }) { return active ? <div className="foul-toast" role="alert">FOUL: LINE OF BALL CROSSING</div> : null; }
function AllRiderRadar(){const riders=useMatch(s=>s.entities);return <div className="all-rider-radar" aria-label="All rider radar">{Object.values(riders).map(rider=><i key={rider.id} className={rider.team} style={{left:`${50+rider.position.x/FIELD_X*90}%`,top:`${50-rider.position.y/FIELD_Z*90}%`}}/>)}</div>}
function CareerMatchEnd(){const seconds=useMatch(s=>s.seconds),score=useMatch(s=>s.score),recorded=useRef(false);useEffect(()=>{if(seconds===0&&!recorded.current){recorded.current=true;CareerStatsManager.recordMatch({won:score>0,goals:score,rideOffs:0})}},[seconds,score]);return null}
function Ball({api}:{api:React.MutableRefObject<RapierRigidBody|null>}){const key=useMatch(s=>s.resetKey);useEffect(()=>{const reset=getBallResetState();api.current?.setTranslation(reset.position,true);api.current?.setLinvel(reset.velocity,true)},[key,api]);return <RigidBody ref={api} colliders="ball" restitution={.72} friction={.55} position={[0,.65,0]}><mesh castShadow><sphereGeometry args={[.42,20,16]}/><meshStandardMaterial color="#f8f4e8" roughness={.45}/></mesh></RigidBody>}

const NETWORK_ENTITY_IDS: PoloRiderEntity["id"][] = ["player", "blue_2", "blue_3", "blue_4", "blue_5", "blue_6", "red_1", "red_2", "red_3", "red_4", "red_5", "red_6"];

function cloneEntities(entities: ReturnType<typeof initializeMatchEntities>) {
  return Object.fromEntries(Object.entries(entities).map(([id, entity]) => [id, { ...entity, position: { ...entity.position }, velocity: { ...entity.velocity } }])) as ReturnType<typeof initializeMatchEntities>;
}

function RealtimeHorse({ ball }: { ball: React.RefObject<RapierRigidBody | null> }) {
  const assignedId = networkManager.getActiveMatch()?.assignedEntityId ?? "player";
  const cosmetics = useMatch(state => state.entities[assignedId]);
  const actionPhase = useMatch(state => state.telemetry.strikePhase);
  const start = useMatch.getState().entities[assignedId];
  const group = useRef<THREE.Group>(null);
  const motion = useRef({ turn: 0, braking: false });
  const position = useRef(new THREE.Vector3(start.position.x, 0, start.position.y));
  const yaw = useRef(start.heading);
  const speed = useRef(0);
  const stamina = useRef(1);
  const charge = useRef(0);
  const cooldown = useRef(0);
  const swing = useRef(0);
  const strikeClock = useRef(-1);
  const contactFired = useRef(false);
  const wasHolding = useRef(false);
  const telemetryClock = useRef(0);
  const sequence = useRef(0);
  const latestCommand = useRef<InputCommand | null>(null);
  const loop = useRef(new FixedTimestepLoop(60, 20));
  const input = useInput();
  const paused = useMatch(state => state.paused);
  const setMessage = useMatch(state => state.setMessage);
  const setTelemetry = useMatch(state => state.setTelemetry);

  useEffect(() => networkManager.on("snapshot", snapshot => {
    const authoritative = snapshot.entities.find(entity => entity.id === assignedId);
    if (!authoritative) return;
    const predicted: NetworkEntityState = {
      id: assignedId,
      position: { x: position.current.x, z: position.current.z },
      velocity: { x: Math.sin(yaw.current) * speed.current, z: Math.cos(yaw.current) * speed.current },
      heading: yaw.current,
      gait: getGait(Math.abs(speed.current)),
    };
    const corrected = reconcileLocalEntity(predicted, authoritative);
    position.current.set(corrected.position.x, 0, corrected.position.z);
    yaw.current = corrected.heading;
    speed.current = Math.hypot(corrected.velocity.x, corrected.velocity.z);
  }), [assignedId]);

  useFrame((state, frameDelta) => {
    if (!group.current || paused) return;
    loop.current.advance(frameDelta, delta => {
      const currentInput = input.current;
      motion.current = { turn: currentInput.steer, braking: currentInput.brake };
      const canGallop = currentInput.gallop && stamina.current > 0;
      speed.current = advanceHorseSpeed(speed.current, { ...currentInput, gallop: canGallop }, delta, ACTIVE_ARCHETYPE);
      const gait = getGait(speed.current);
      stamina.current = advanceStamina(stamina.current, gait === "GALLOP" && canGallop, delta, ACTIVE_ARCHETYPE);
      yaw.current += currentInput.steer * getSteeringRate(speed.current, ACTIVE_ARCHETYPE) * delta * (speed.current >= 0 ? 1 : -1);
      const forward = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
      position.current.addScaledVector(forward, speed.current * delta);
      position.current.x = THREE.MathUtils.clamp(position.current.x, -24, 24);
      position.current.z = THREE.MathUtils.clamp(position.current.z, -39, 39);

      const store = useMatch.getState();
      const local = store.entities[assignedId];
      store.setEntities({ ...store.entities, [assignedId]: { ...local, position: { x: position.current.x, y: position.current.z }, velocity: { x: forward.x * speed.current, y: forward.z * speed.current }, heading: yaw.current, stamina: stamina.current } });
      group.current?.position.copy(position.current);
      if (group.current) {
        group.current.rotation.y = yaw.current;
        group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, getBodyLean(currentInput.steer, speed.current, ACTIVE_ARCHETYPE), 9, delta);
      }

      const holding = currentInput.strike || currentInput.power || currentInput.backhand;
      const released = !holding && wasHolding.current;
      swing.current = getMalletAngle(swing.current, holding, released, delta);
      if (released) {
        strikeClock.current = 0;
        contactFired.current = false;
      } else if (strikeClock.current >= 0) strikeClock.current += delta;
      const phase = getStrikePhase(strikeClock.current, holding);
      if (holding) charge.current = Math.min(1, charge.current + delta);
      cooldown.current -= delta;
      if (canApplyStrike(phase, contactFired.current) && charge.current > .1 && cooldown.current <= 0 && ball.current) {
        contactFired.current = true;
        const ballPosition = ball.current.translation();
        const distance = new THREE.Vector3(ballPosition.x, 0, ballPosition.z).sub(position.current);
        if (distance.length() < 5) {
          ball.current.applyImpulse(getShotImpulse({ aimX: currentInput.aimX, yaw: yaw.current, backhand: currentInput.backhand, charge: charge.current, speed: speed.current, archetype: ACTIVE_ARCHETYPE }), true);
          cooldown.current = .38;
          setMessage(currentInput.backhand ? "BACKHAND!" : "CLEAN STRIKE!");
        }
      }
      if (!holding && phase === "READY") charge.current = 0;
      wasHolding.current = holding;

      const offset = getCameraOffset(yaw.current, speed.current, currentInput.steer);
      const desired = position.current.clone().add(new THREE.Vector3(offset.x, offset.y, offset.z));
      const look = position.current.clone().addScaledVector(forward, offset.lookAhead);
      state.camera.position.lerp(desired, 1 - Math.exp(-delta * (5 + Math.min(Math.abs(speed.current) / 24, 1) * 2)));
      state.camera.lookAt(look.x, look.y + 1, look.z);

      latestCommand.current = { sequence: ++sequence.current, clientTime: Date.now(), input: { throttle: currentInput.throttle, steer: currentInput.steer, gallop: canGallop, brake: currentInput.brake, strike: currentInput.strike, power: currentInput.power, backhand: currentInput.backhand, aimX: currentInput.aimX } };
      telemetryClock.current += delta;
      if (telemetryClock.current > .08) {
        telemetryClock.current = 0;
        const ballPosition = ball.current?.translation() ?? { x: 0, z: 0 };
        setTelemetry({ speed: Math.abs(speed.current), stamina: stamina.current, gait, charge: charge.current, strikePhase: phase, player: { x: position.current.x, z: position.current.z }, ball: { x: ballPosition.x, z: ballPosition.z } });
      }
    }, () => {
      if (latestCommand.current) networkManager.sendInput(latestCommand.current);
    });
  });

  return <group ref={group}><PoloEntity entity={cosmetics} motion={motion} action={actionPhase === "WIND_UP" ? "WIND_UP" : actionPhase === "CONTACT" || actionPhase === "FOLLOW_THROUGH" ? "STRIKE" : "NONE"} /></group>;
}

function RealtimeBots({ ball }: { ball: React.RefObject<RapierRigidBody | null> }) {
  const assignedId = networkManager.getActiveMatch()?.assignedEntityId ?? "player";
  const remoteIds = NETWORK_ENTITY_IDS.filter(id => id !== assignedId);
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const buffer = useRef(new SnapshotBuffer());
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
    const next = cloneEntities(store.entities);
    const toBot = (entity: PoloRiderEntity): Bot => ({ id: entity.id, team: entity.team.toUpperCase() as "BLUE" | "RED", role: entity.role === "striker" ? "ATTACKER" : "PIVOT", archetype: entity.archetype, position: { x: entity.position.x, z: entity.position.y }, facing: { x: Math.sin(entity.heading), z: Math.cos(entity.heading) } });
    for (const id of remoteIds) {
      const entity = next[id];
      const decision = decideBot(toBot(entity), { x: ballPosition.x, z: ballPosition.z }, toBot(next[assignedId]));
      const dx = ballPosition.x - entity.position.x;
      const dz = ballPosition.z - entity.position.y;
      const length = Math.hypot(dx, dz) || 1;
      const rate = decision === "ZONE_DEFEND" ? 2.2 : 4;
      entity.velocity = { x: dx / length * rate, y: dz / length * rate };
      entity.position.x += entity.velocity.x * delta;
      entity.position.y += entity.velocity.y * delta;
      entity.heading = Math.atan2(dx, dz);
    }
    for (let first = 0; first < NETWORK_ENTITY_IDS.length; first += 1) for (let second = first + 1; second < NETWORK_ENTITY_IDS.length; second += 1) {
      const a = next[NETWORK_ENTITY_IDS[first]], b = next[NETWORK_ENTITY_IDS[second]];
      const dx = a.position.x - b.position.x, dz = a.position.y - b.position.y, length = Math.hypot(dx, dz);
      if (length <= 0 || length >= 1.5) continue;
      const normal = { x: dx / length, z: dz / length };
      const pushA = rideOffImpulse(toBot(a), toBot(b)), pushB = rideOffImpulse(toBot(b), toBot(a));
      a.position.x += normal.x * pushB * delta; a.position.y += normal.z * pushB * delta;
      b.position.x -= normal.x * pushA * delta; b.position.y -= normal.z * pushA * delta;
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

  return <>{remoteIds.map(id => <group key={id} ref={element => { groups.current[id] = element; }} position={[entities[id].position.x, 0, entities[id].position.y]}><PoloEntity entity={entities[id]} /></group>)}</>;
}
function Scene(){const ball=useRef<RapierRigidBody>(null);const score=useMatch(s=>s.scoreGoal),paused=useMatch(s=>s.paused),goalState=useRef(INITIAL_GOAL_STATE);useFrame(()=>{const p=ball.current?.translation();if(!paused&&p){const result=transitionGoal(goalState.current,p);goalState.current=result.state;if(result.scored)score()}});return <Suspense fallback={null}><color attach="background" args={["#b9d5dd"]}/><fog attach="fog" args={["#b9d5dd",45,125]}/><PitchEnvironment width={FIELD_X} length={FIELD_Z}/><Physics gravity={[0,-9.81,0]} timeStep={1/60} updateLoop="independent" interpolate><RigidBody type="fixed" colliders="cuboid" position={[0,-.25,0]}><mesh visible={false}><boxGeometry args={[FIELD_X, .5, FIELD_Z]}/></mesh></RigidBody><Ball api={ball}/></Physics><RealtimeHorse ball={ball}/><RealtimeBots ball={ball}/><Environment preset="park" /></Suspense>}
function Hud(){const s=useMatch(),t=s.telemetry;const mm=`${String(Math.floor(s.seconds/60)).padStart(2,"0")}:${String(s.seconds%60).padStart(2,"0")}`,radar=(v:{x:number;z:number})=>({left:`${50+v.x/FIELD_X*90}%`,top:`${50-v.z/FIELD_Z*90}%`});return <div className="hud"><header className="broadcast"><div className="team blue"><b>BLUE</b><small>YOUR GOALS</small><strong>{s.score}</strong></div><div className="match"><small>CHUKKER 1</small><strong>{mm}</strong><em>POLO CHAMPIONS</em></div><div className="team red"><strong>0</strong><b>RED</b></div><button onClick={s.restart}>RESTART</button></header><div className="archetype">{ACTIVE_ARCHETYPE.replace("_"," ")} · {t.gait}</div><div className="notice">{s.message}</div>{s.activeFoul&&<div className="foul-toast" role="alert">FOUL: LINE OF BALL CROSSING</div>}<section className="radar" aria-label="Field radar"><b>FIELD RADAR</b><i className="pip player" style={radar(t.player)}/><i className="pip ball" style={radar(t.ball)}/><i className="pip opponent" style={radar({x:9,z:-12})}/></section><section className="telemetry" aria-label="Speed and stamina"><div className="speed"><strong>{Math.round(t.speed*3.6)}</strong><small>KM/H</small></div><b>{t.gait}</b><label>STAMINA <span><i style={{width:`${t.stamina*100}%`}}/></span></label></section>{t.strikePhase==="WIND_UP"&&<section className="swing" aria-label="Swing charge">SWING POWER <span><i style={{width:`${t.charge*100}%`}}/></span></section>}<footer><b>WASD</b> Ride <b>SHIFT</b> Gallop <b>X</b> Brake <b>SPACE</b> Strike <b>Q</b> Backhand <b>R</b> Reset ball <b>ESC</b> Pause</footer>{s.paused&&<div className="pause">PAUSED<br/><button onClick={s.togglePause}>RESUME</button></div>}</div>}
export function Game(){const setSec=useMatch(s=>s.setSeconds),paused=useMatch(s=>s.paused),toggle=useMatch(s=>s.togglePause),reset=useMatch(s=>s.resetBall);useEffect(()=>{const entities=initializeMatchEntities(),match=networkManager.getActiveMatch();if(match)for(const remote of match.initialState.entities){const current=entities[remote.id];entities[remote.id]={...current,position:{x:remote.position.x,y:remote.position.z},velocity:{x:remote.velocity.x,y:remote.velocity.z},heading:remote.heading};}useMatch.getState().setEntities(entities)},[]);useEffect(()=>{const t=setInterval(()=>{if(!paused)setSec(Math.max(0,useMatch.getState().seconds-1))},1000);const p=()=>toggle(),r=()=>reset();window.addEventListener("polo-pause",p);window.addEventListener("polo-reset",r);return()=>{clearInterval(t);window.removeEventListener("polo-pause",p);window.removeEventListener("polo-reset",r)}},[paused,setSec,toggle,reset]);return <main><Canvas shadows camera={{fov:54,position:[0,8,25]}}><Scene/></Canvas><Hud/><AllRiderRadar/><CareerMatchEnd/></main>}
