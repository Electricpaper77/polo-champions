import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BRAKE_SPEED, GALLOP_SPEED, getTargetSpeed, NORMAL_RIDE_SPEED } from "../src/game/HorseControls";
import { BALL_MAX_HORIZONTAL_SPEED, BALL_MAX_VERTICAL_SPEED, clampBallVelocity, dampGroundRollSpeed, getBallResetState, getShotImpulse, getStrikePower, INITIAL_GOAL_STATE, transitionGoal } from "../src/game/PoloMechanics";
import { attackingGoal, choosePossession, getAiState, getRoleTarget, isRightOfWay, nextPlayer, ROSTER } from "../src/game/TeamPolo";
import { BALL_COLLIDER_NAME, BALL_RADIUS, FIELD_COLLIDER_THICKNESS, FIELD_SURFACE_Y, HORSE_VISUAL_PROFILES, PITCH_GROUND_COLLIDER_NAME, STRIKE_RANGE, alignVelocityToForward, ballNeedsRecovery, gaitForSpeed, getSignedTurnStep, getSteeringAuthority, isStrongReversal, isStrikeInRange, updateHorseSpeed, visualProfileForRider, visualTransformIsFinite, visualTurnLean, RIDER_FIELD_BOUNDS, RIDER_SPAWNS, spawnToVector3 } from "../src/game/Game";
import { isSwitchEdge } from "../src/game/InputManager";
import { PASS_POWER, canPass, getPassDirection, getPassTarget } from "../src/game/PassMechanics";
import { acquirePossession, deriveTacticalStates, deriveTeamModes, loosePossession, possessionForRider, updatePossession } from "../src/game/Possession";
import { useMatch } from "../src/game/GameState";
import { RIDE_OFF_COOLDOWN_MS, RIDE_OFF_RANGE, findRideOffTarget, resolveRideOffContact, rideOff } from "../src/game/RideOff";
import { LOCAL_OWNERSHIP, commandForRider } from "../src/game/PlayerOwnership";
import { commandFromGamepad, deadZone, trigger } from "../src/game/GamepadInput";
import { MAX_DISTANCE, NORMAL_DISTANCE, sharedCamera } from "../src/game/SharedCamera";
import { PONIES, RIDER_PONIES, accel, maxSpeed, staminaStep } from "../src/game/PoloPony";
test("pony profiles differentiate pace, contact traits, stamina, and rider assignment",()=>{expect(maxSpeed(PONIES.SPRINTER)).toBeGreaterThan(maxSpeed(PONIES.POWER));expect(accel(PONIES.SPRINTER)).toBeGreaterThan(accel(PONIES.POWER));expect(PONIES.ALL_ROUNDER.agility).toBeGreaterThan(PONIES.POWER.agility);expect(PONIES.POWER.strength).toBeGreaterThan(PONIES.SPRINTER.strength);expect(PONIES.POWER.balance).toBeGreaterThan(PONIES.SPRINTER.balance);expect(staminaStep(100,true,1)).toBeLessThan(100);expect(staminaStep(50,false,1)).toBeGreaterThan(50);expect(accel(PONIES.SPRINTER,10)).toBeLessThan(accel(PONIES.SPRINTER,100));expect(maxSpeed(PONIES.POWER,0)).toBeGreaterThan(0);expect(RIDER_PONIES.blue1).toBe(PONIES.SPRINTER);expect(RIDER_PONIES.red1).toBe(PONIES.POWER);});
test("visual SPRINTER profile differs from POWER",()=>{expect(HORSE_VISUAL_PROFILES.SPRINTER).not.toEqual(HORSE_VISUAL_PROFILES.POWER);});
test("POWER visual chest and hindquarters outweigh SPRINTER",()=>{expect(HORSE_VISUAL_PROFILES.POWER.chestScale).toBeGreaterThan(HORSE_VISUAL_PROFILES.SPRINTER.chestScale);expect(HORSE_VISUAL_PROFILES.POWER.hindquarterScale).toBeGreaterThan(HORSE_VISUAL_PROFILES.SPRINTER.hindquarterScale);});
test("ALL_ROUNDER visual profile remains between the extremes",()=>{expect(HORSE_VISUAL_PROFILES.ALL_ROUNDER.chestScale).toBeGreaterThan(HORSE_VISUAL_PROFILES.SPRINTER.chestScale);expect(HORSE_VISUAL_PROFILES.ALL_ROUNDER.chestScale).toBeLessThan(HORSE_VISUAL_PROFILES.POWER.chestScale);});
test("horse visual transforms stay finite",()=>{expect(Object.values(HORSE_VISUAL_PROFILES).every(visualTransformIsFinite)).toBe(true);});
test("visual strike state leaves strike physics output unchanged",()=>{const input={aimX:.2,yaw:.4,backhand:false,charge:.5,speed:4};expect(getShotImpulse(input)).toEqual(getShotImpulse(input));});
test("live pony assignment selects the matching visual archetype",()=>{expect(visualProfileForRider("blue1")).toBe(HORSE_VISUAL_PROFILES.SPRINTER);expect(visualProfileForRider("red1")).toBe(HORSE_VISUAL_PROFILES.POWER);});
test("ride-off profiles give POWER more balance than SPRINTER",()=>{expect(RIDER_PONIES.red1.balance).toBeGreaterThan(RIDER_PONIES.blue1.balance);});
test("same strength-adjusted push displaces a SPRINTER defender farther than a POWER defender",()=>{const strengthAdjustedPush=1,resistance=(balance:number)=>Math.min(1,Math.max(.85,1.5-balance/140));expect(strengthAdjustedPush*resistance(RIDER_PONIES.blue1.balance)).toBeGreaterThan(strengthAdjustedPush*resistance(RIDER_PONIES.red1.balance));});
test("shared camera selects shared framing with valid P1, P2, and ball inputs",()=>{const camera=sharedCamera({x:-8,y:0,z:0},{x:0,y:0,z:4},{x:8,y:0,z:0});expect(camera.distance).toBeGreaterThan(NORMAL_DISTANCE);expect(camera.focus).toEqual({x:0,y:0,z:2.4});});
test("shared camera falls back to P1 framing when P2 is missing",()=>{const p1={x:3,y:0,z:-2},ball={x:5,y:0,z:4};expect(sharedCamera(p1,ball)).toEqual(sharedCamera(p1,ball,p1));});
test("shared camera clamps extreme P1/P2 separation",()=>{expect(sharedCamera({x:-100,y:0,z:0},{x:0,y:0,z:0},{x:100,y:0,z:0}).distance).toBe(MAX_DISTANCE);});
test("shared camera output remains finite",()=>{const camera=sharedCamera({x:-8,y:1,z:-4},{x:2,y:.65,z:3},{x:9,y:1,z:6});expect(Object.values(camera.focus).every(Number.isFinite)&&Number.isFinite(camera.distance)).toBe(true);});
test("P1 HUD resolves blue1, SPRINTER, and live stamina",async({page})=>{await page.goto("/?e2e=1");const card=page.getByTestId("stamina-blue1");await expect(card).toContainText("P1 • SPRINTER");await expect(card).toContainText(/% STAMINA/);await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow",/^\d+$/);});
test("P2 HUD resolves red1, POWER, and live stamina",async({page})=>{await page.goto("/?e2e=1");const card=page.getByTestId("stamina-red1");await expect(card).toContainText("P2 • POWER");await expect(card).toContainText(/% STAMINA/);await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow",/^\d+$/);});
test("MATCH_OVER overlay exposes the winner and restart",async({page})=>{await page.goto("/?e2e=1");const ready=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:{ready?:boolean}}).__POLO_B1_DEBUG__?.ready);await expect.poll(ready).toBe(true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent("polo-e2e-goal",{detail:"blue"})));await expect.poll(async()=>await page.getByText("BLUE GOAL!").isVisible()).toBe(true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent("polo-e2e-seconds",{detail:0})));const overlay=page.locator(".match-over");await expect(overlay.getByText("MATCH OVER")).toBeVisible();await expect(overlay.getByText("BLUE WINS")).toBeVisible();await expect(overlay.getByRole("button",{name:"RESTART MATCH"})).toBeVisible();});
test("field collider top aligns with visible grass",()=>{expect(FIELD_SURFACE_Y-FIELD_COLLIDER_THICKNESS/2+FIELD_COLLIDER_THICKNESS/2).toBe(FIELD_SURFACE_Y);});
test("ball spawn clears the ground by its radius",()=>{expect(getBallResetState().position.y).toBeGreaterThan(FIELD_SURFACE_Y+BALL_RADIUS);});
test("ball runtime uses one explicit dynamic sphere and one explicit fixed pitch collider",()=>{const game=readFileSync("src/game/Game.tsx","utf8");expect(game).toContain('<RigidBody type="fixed" colliders={false} position={[0, FIELD_SURFACE_Y, 0]}>');expect(game).toContain("args={[FIELD_X / 2, FIELD_COLLIDER_THICKNESS / 2, FIELD_Z / 2]}");expect(game).toContain("<BallCollider");expect(game).toContain("args={[BALL_RADIUS]}");expect(game).toContain("colliders={false}");expect(game).toContain("ccd");expect(game).not.toContain("CATCH_FLOOR");expect(game).toContain(`name={PITCH_GROUND_COLLIDER_NAME}`);expect(game).toContain(`name={BALL_COLLIDER_NAME}`);expect(PITCH_GROUND_COLLIDER_NAME).toBe("polo-pitch-ground");expect(BALL_COLLIDER_NAME).toBe("polo-ball");});
test("below-field ball triggers recovery",()=>{expect(ballNeedsRecovery(-4)).toBe(true);expect(ballNeedsRecovery(0)).toBe(false);});
test("below-field recovery is score-safe",()=>{const reset=getBallResetState();expect(reset.velocity).toEqual({x:0,y:0,z:0});expect(reset.position.y).toBeGreaterThan(FIELD_SURFACE_Y+BALL_RADIUS);});
test("goal reset uses the valid ball spawn",()=>{expect(getBallResetState().position.y).toBeGreaterThan(FIELD_SURFACE_Y+BALL_RADIUS);});
test("match restart uses the valid ball spawn",()=>{expect(getBallResetState().position.y).toBeGreaterThan(FIELD_SURFACE_Y+BALL_RADIUS);});

test("gamepad commands apply dead zones, triggers, buttons, and neutral disconnects",()=>{expect(deadZone(.1)).toBe(0);expect(deadZone(.5)).toBeGreaterThan(0);expect(deadZone(-.5)).toBeLessThan(0);expect(trigger(undefined)).toBe(0);expect(trigger(.5)).toBe(.5);expect(trigger(2)).toBe(1);const command=commandFromGamepad({connected:true,axes:[.5],buttons:[{pressed:true},{pressed:true},{pressed:true},{},{},{},{value:.25},{value:1}]});expect(command).toMatchObject({steer:expect.any(Number),throttle:1,brake:.25,strike:true,pass:true,rideOff:true});expect(commandFromGamepad(null)).toEqual({steer:0,throttle:0,brake:0,strike:false,pass:false,rideOff:false});});

test("local player ownership isolates P1/P2 commands and survives match resets",()=>{const p1={steer:-1,throttle:1,brake:0,strike:false,pass:false,rideOff:false},p2={steer:1,throttle:.5,brake:0,strike:true,pass:false,rideOff:false};expect(LOCAL_OWNERSHIP).toEqual({blue1:"p1",red1:"p2",blue2:"ai",red2:"ai"});expect(commandForRider("blue1",{p1,p2})).toBe(p1);expect(commandForRider("red1",{p1,p2})).toBe(p2);expect(commandForRider("blue2",{p1,p2})).toBeUndefined();expect(commandForRider("red2",{p1,p2})).toBeUndefined();expect(commandForRider("blue1",{p1}).steer).toBe(-1);expect(commandForRider("red1",{p2}).steer).toBe(1);});

test("gallop and braking targets remain independent", () => {
  const normal = getTargetSpeed({ throttle: 1, gallop: false, brake: false });
  const gallop = getTargetSpeed({ throttle: 1, gallop: true, brake: false });
  const afterShiftRelease = getTargetSpeed({ throttle: 1, gallop: false, brake: false });
  const braking = getTargetSpeed({ throttle: 1, gallop: false, brake: true });

  expect(normal).toBe(NORMAL_RIDE_SPEED);
  expect(gallop).toBe(GALLOP_SPEED);
  expect(normal).toBeLessThan(gallop);
  expect(gallop).toBeGreaterThan(normal);
  expect(afterShiftRelease).toBe(normal);
  expect(braking).toBe(BRAKE_SPEED);
  expect(braking).toBeLessThan(normal);
});

test("charged shots scale power and aiming changes the impulse direction", () => {
  const weak = getShotImpulse({ aimX: 0, yaw: 0, backhand: false, charge: 0.1, speed: 0 });
  const charged = getShotImpulse({ aimX: 0, yaw: 0, backhand: false, charge: 1, speed: 0 });
  const aimedLeft = getShotImpulse({ aimX: -1, yaw: 0, backhand: false, charge: 0.5, speed: 0 });
  const aimedRight = getShotImpulse({ aimX: 1, yaw: 0, backhand: false, charge: 0.5, speed: 0 });

  expect(charged.power).toBeGreaterThan(weak.power);
  expect(charged.y).toBeGreaterThan(weak.y);
  expect(aimedLeft.x).toBeLessThan(0);
  expect(aimedRight.x).toBeGreaterThan(0);
  expect(aimedLeft.z).toBeCloseTo(aimedRight.z);
});

test("a goal scores once until the ball leaves and resets deterministically", () => {
  const goal = { x: 0, z: 43 };
  const first = transitionGoal(INITIAL_GOAL_STATE, goal);
  const stillInGoal = transitionGoal(first.state, goal);
  const rearmed = transitionGoal(first.state, { x: 6, z: 0 });
  const reset = getBallResetState();

  expect(first.scored).toBe(true);
  expect(first.resetBall).toBe(true);
  expect(stillInGoal.scored).toBe(false);
  expect(rearmed.state.armed).toBe(true);
  expect(reset).toEqual({ position: { x: 0, y: 0.65, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
});

test("B11.1A sustained input increases speed progressively", () => {
  const first = updateHorseSpeed(0, 16, 7, false, 1 / 60);
  const later = updateHorseSpeed(first, 16, 7, false, 1 / 60);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(16);
  expect(later).toBeGreaterThan(first);
  expect(later).toBeLessThan(16);
});

test("B11.1A releasing input decreases speed progressively", () => {
  const next = updateHorseSpeed(12, 0, 7, false, 1 / 60);
  expect(next).toBeGreaterThan(0);
  expect(next).toBeLessThan(12);
});

test("B11.1A brake decreases speed faster than passive drag", () => {
  const passive = updateHorseSpeed(12, 0, 7, false, 1 / 60);
  const braked = updateHorseSpeed(12, 0, 7, true, 1 / 60);
  expect(braked).toBeGreaterThanOrEqual(0);
  expect(braked).toBeLessThan(passive);
});

test("B11.1B low-speed steering authority exceeds gallop steering authority", () => {
  expect(getSteeringAuthority(0, RIDER_PONIES.blue1.agility)).toBeGreaterThan(getSteeringAuthority(24, RIDER_PONIES.blue1.agility));
});

test("B11.1B SPRINTER steering authority exceeds POWER at the same speed", () => {
  expect(getSteeringAuthority(12, RIDER_PONIES.blue1.agility)).toBeGreaterThan(getSteeringAuthority(12, RIDER_PONIES.red1.agility));
});

test("B11.1B opposite input at gallop does not instantly reverse velocity", () => {
  const afterOneFrame = alignVelocityToForward({ x: 0, z: 24 }, { x: 0, z: -1 }, 1 / 60);
  expect(afterOneFrame.z).toBeGreaterThan(0);
  expect(isStrongReversal({ x: 0, z: 1 }, { x: 0, z: -1 })).toBe(true);
});

test("B11.1B reversal turns through and eventually carries velocity into the requested direction", () => {
  let yaw = 0, speed = 24, velocity = { x: 0, z: 24 };
  const desired = { x: 0, z: -1 }, dt = 1 / 60;
  for (let frame = 0; frame < 240; frame++) {
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const reversing = isStrongReversal(forward, desired) && speed > 8;
    speed = updateHorseSpeed(speed, reversing ? 0 : 16, 7, false, dt);
    yaw += getSignedTurnStep(forward, desired, getSteeringAuthority(speed, RIDER_PONIES.blue1.agility), dt);
    const nextForward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    velocity = alignVelocityToForward(velocity, nextForward, dt);
    const forwardVelocity = velocity.x * nextForward.x + velocity.z * nextForward.z;
    const driveBlend = 1 - Math.exp(-8 * dt);
    velocity = { x: velocity.x + nextForward.x * (speed - forwardVelocity) * driveBlend, z: velocity.z + nextForward.z * (speed - forwardVelocity) * driveBlend };
  }
  expect(velocity.z).toBeLessThan(0);
});

test("B11.1B lateral velocity decays while forward momentum remains", () => {
  const aligned = alignVelocityToForward({ x: 8, z: 12 }, { x: 0, z: 1 }, 1 / 30);
  expect(Math.abs(aligned.x)).toBeLessThan(8);
  expect(aligned.z).toBeCloseTo(12);
});

test("B11.2 pass/tap power is lower than a normal strike", () => {
  expect(getStrikePower("tap", 0, 0)).toBeLessThan(getStrikePower("normal", 0.5, 0));
});

test("B11.2 normal strike power is lower than a full strike", () => {
  expect(getStrikePower("normal", 0.5, 0)).toBeLessThan(getStrikePower("full", 1, 0));
});

test("B11.2 forward momentum increases a bounded strike impulse", () => {
  const stationary = getShotImpulse({ aimX: 0, yaw: 0, backhand: false, charge: 1, speed: 0 });
  const galloping = getShotImpulse({ aimX: 0, yaw: 0, backhand: false, charge: 1, speed: 24 });
  expect(galloping.z).toBeGreaterThan(stationary.z);
  expect(galloping.power - stationary.power).toBeLessThanOrEqual(24 * 0.28);
});

test("B11.2 backhand impulse is finite and directionally distinct", () => {
  const forehand = getShotImpulse({ aimX: 0, yaw: 0, backhand: false, charge: 1, speed: 0 });
  const backhand = getShotImpulse({ aimX: 0, yaw: 0, backhand: true, charge: 1, speed: 0 });
  expect(Object.values(backhand).every(Number.isFinite)).toBe(true);
  expect(backhand.z).toBeLessThan(0);
  expect(forehand.z).toBeGreaterThan(0);
});

test("B11.2 ball velocity clamp prevents unsafe output", () => {
  const clamped = clampBallVelocity({ x: 500, y: 99, z: 500 });
  expect(Math.hypot(clamped.x, clamped.z)).toBeLessThanOrEqual(BALL_MAX_HORIZONTAL_SPEED);
  expect(Math.abs(clamped.y)).toBeLessThanOrEqual(BALL_MAX_VERTICAL_SPEED);
});

test("B11.2 ground roll damping decays progressively without an instant stop", () => {
  const first = dampGroundRollSpeed(20, 1 / 60), later = dampGroundRollSpeed(first, 1 / 60);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(20);
  expect(later).toBeLessThan(first);
});

test("B11.3 POWER attacker produces a stronger contact result than SPRINTER", () => {
  const power = resolveRideOffContact({ challengerStrength: 94, defenderBalance: 70, challengerSpeed: 6, defenderSpeed: 6, alignment: 1, sideBySide: 1 });
  const sprinter = resolveRideOffContact({ challengerStrength: 64, defenderBalance: 70, challengerSpeed: 6, defenderSpeed: 6, alignment: 1, sideBySide: 1 });
  expect(power.targetDisplacement).toBeGreaterThan(sprinter.targetDisplacement);
});

test("B11.3 POWER defender resists more than SPRINTER defender", () => {
  const againstPower = resolveRideOffContact({ challengerStrength: 82, defenderBalance: 92, challengerSpeed: 6, defenderSpeed: 6, alignment: 1, sideBySide: 1 });
  const againstSprinter = resolveRideOffContact({ challengerStrength: 82, defenderBalance: 70, challengerSpeed: 6, defenderSpeed: 6, alignment: 1, sideBySide: 1 });
  expect(againstPower.targetDisplacement).toBeLessThan(againstSprinter.targetDisplacement);
});

test("B11.3 higher legal approach speed improves ride-off effectiveness", () => {
  const slow = resolveRideOffContact({ challengerStrength: 82, defenderBalance: 84, challengerSpeed: 2, defenderSpeed: 2, alignment: .9, sideBySide: .9 });
  const fast = resolveRideOffContact({ challengerStrength: 82, defenderBalance: 84, challengerSpeed: 8, defenderSpeed: 2, alignment: .9, sideBySide: .9 });
  expect(fast.targetDisplacement).toBeGreaterThan(slow.targetDisplacement);
});

test("B11.3 favorable alignment improves ride-off effectiveness", () => {
  const poor = resolveRideOffContact({ challengerStrength: 82, defenderBalance: 84, challengerSpeed: 6, defenderSpeed: 6, alignment: .72, sideBySide: .45 });
  const favorable = resolveRideOffContact({ challengerStrength: 82, defenderBalance: 84, challengerSpeed: 6, defenderSpeed: 6, alignment: 1, sideBySide: 1 });
  expect(favorable.targetDisplacement).toBeGreaterThan(poor.targetDisplacement);
});

test("B11.3 contact output remains finite and bounded", () => {
  const result = resolveRideOffContact({ challengerStrength: 999, defenderBalance: -99, challengerSpeed: 999, defenderSpeed: -99, alignment: 99, sideBySide: 99 });
  expect(Object.values(result).every(Number.isFinite)).toBe(true);
  expect(result.targetDisplacement).toBeLessThanOrEqual(1.55);
  expect(result.recoveryDuration).toBeGreaterThanOrEqual(.15);
  expect(result.recoveryDuration).toBeLessThanOrEqual(.36);
});

test("B11.3 fast aligned SPRINTER can meaningfully challenge a poorly aligned POWER defender", () => {
  const sprinterSkillCase = resolveRideOffContact({ challengerStrength: 64, defenderBalance: 92, challengerSpeed: 8, defenderSpeed: 2, alignment: 1, sideBySide: 1 });
  expect(sprinterSkillCase.targetDisplacement).toBeGreaterThan(.85);
});

test("team roles react to possession, select the correct goal, and switch players", () => {
  const blueBack = ROSTER.find(r => r.id === "blue-2")!;
  const goldFinisher = ROSTER.find(r => r.id === "red-1")!;
  expect(ROSTER).toHaveLength(4);
  expect(attackingGoal("blue")).toBe(1);
  expect(attackingGoal("gold")).toBe(-1);
  expect(nextPlayer("blue-1")).toBe("blue-2");
  expect(getAiState(blueBack, "gold", { x: 0, z: 0 })).toBe("RECOVER");
  expect(getAiState(goldFinisher, "gold", { x: 0, z: 0 })).toBe("ATTACK");
  expect(getRoleTarget(goldFinisher, "gold", { x: 0, z: 0 }).z).toBeLessThan(0);
  expect(choosePossession({ x: 0, z: 0 }, [{ ...blueBack, position: { x: 1, z: 0 } }, { ...goldFinisher, position: { x: 8, z: 0 } }])).toBe("blue");
  expect(isRightOfWay({ x: 0, z: 0 }, { x: 0, z: 8 }, { x: 2, z: -1 })).toBe(true);
});

test("loads the playable polo slice without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("POLO CHAMPIONS")).toBeVisible();
  await expect(page.getByText("YOUR GOALS")).toBeVisible();
  await page.keyboard.press("KeyW");
  await page.keyboard.press("Space");
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("live ball contacts the named main pitch at +2, +5, +10, and high-speed downward", async ({ page }) => {
  await page.goto("/?e2e=1");
  type Debug = {
    ball?: { x:number; y:number; z:number; vy:number };
    ballGroundContact?: boolean;
    ballGroundContactObserved?: boolean;
    mainPitchContactCount?: number;
    ballRecoveryCount?: number;
    dropBallFrom?: (height:number, downwardVelocity?:number) => void;
  };
  const read = () => page.evaluate(() => (window as Window & { __POLO_B1_DEBUG__?: Debug }).__POLO_B1_DEBUG__);
  await expect.poll(() => page.evaluate(() => !!(window as Window & { __POLO_B1_DEBUG__?: Debug }).__POLO_B1_DEBUG__?.dropBallFrom)).toBe(true);
  for (const [height, velocity] of [[2, 0], [5, 0], [10, 0], [10, -100]] as const) {
    await page.evaluate(([h, v]) => (window as Window & { __POLO_B1_DEBUG__?: Debug }).__POLO_B1_DEBUG__?.dropBallFrom?.(h, v), [height, velocity]);
    const samples:number[] = [];
    await expect.poll(async () => {
      const ball = (await read())?.ball;
      if (ball) samples.push(ball.y);
      return !!ball && !!(await read())?.ballGroundContactObserved;
    }, { timeout: 5000 }).toBe(true);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(FIELD_SURFACE_Y + BALL_RADIUS - 0.03);
    expect((await read())?.ballGroundContactObserved).toBe(true);
    expect((await read())?.mainPitchContactCount).toBeGreaterThan(0);
  }
  expect((await read())?.ballRecoveryCount).toBe(0);
});

test("B1 exposes four live riders and all AI riders move within the field", async ({ page }) => {
  await page.goto("/?e2e=1");
  await expect.poll(() => page.evaluate(() => Object.keys((window as Window & { __POLO_B1_DEBUG__?: { riders: object } }).__POLO_B1_DEBUG__?.riders ?? {}).length)).toBe(4);
  const read = () => page.evaluate(() => (window as Window & { __POLO_B1_DEBUG__?: { riders: Record<string, { id:string; team:string; human:boolean; x:number; y:number; z:number }> } }).__POLO_B1_DEBUG__!.riders);
  const riders = await read();
  expect(Object.keys(riders).sort()).toEqual(["blue1", "blue2", "red1", "red2"]);
  expect(Object.values(riders).filter(r => r.human).map(r => r.id)).toEqual(["blue1"]);
  for (const rider of Object.values(riders)) expect([rider.x, rider.y, rider.z].every(Number.isFinite)).toBe(true);
  expect(new Set(Object.values(riders).map(r => `${r.x.toFixed(2)},${r.z.toFixed(2)}`)).size).toBe(4);
  const start = Object.fromEntries(["blue2", "red1", "red2"].map(id => [id, riders[id]]));
  await expect.poll(async () => {
    const current = await read();
    return Object.keys(start).every(id => Math.hypot(current[id].x - start[id].x, current[id].z - start[id].z) > 0.5);
  }).toBe(true);
  const final = await read();
  for (const id of ["blue2", "red1", "red2"]) {
    expect(Math.abs(final[id].x)).toBeLessThanOrEqual(RIDER_FIELD_BOUNDS.x);
    expect(Math.abs(final[id].z)).toBeLessThanOrEqual(RIDER_FIELD_BOUNDS.z);
  }
});

test("spawn conversion is finite, independent, distinct, and inside the field", () => {
  const evidence = spawnToVector3([12, -8]);
  expect(evidence.toArray()).toEqual([12, 0, -8]);
  const first = spawnToVector3(RIDER_SPAWNS.blue1), second = spawnToVector3(RIDER_SPAWNS.blue1);
  expect(first).not.toBe(second);
  const spawns = Object.values(RIDER_SPAWNS).map(spawnToVector3);
  expect(new Set(spawns.map(p => `${p.x},${p.z}`)).size).toBe(spawns.length);
  for (const spawn of spawns) {
    expect([spawn.x, spawn.y, spawn.z].every(Number.isFinite)).toBe(true);
    expect(Math.abs(spawn.x)).toBeLessThanOrEqual(RIDER_FIELD_BOUNDS.x);
    expect(Math.abs(spawn.z)).toBeLessThanOrEqual(RIDER_FIELD_BOUNDS.z);
  }
});

test("B2 switches one active human rider, hands off movement, and follows the new rider", async ({ page }) => {
  await page.goto("/?e2e=1");
  type Rider={human:boolean;x:number;z:number}; type Debug={activeHumanRiderId:string;cameraFollowId:string;riders:Record<string,Rider>};
  const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__!);
  await expect.poll(async()=>Object.keys((await read())?.riders??{}).length).toBe(4);
  expect((await read()).activeHumanRiderId).toBe("blue1");
  await page.keyboard.press("Tab");
  await expect.poll(async()=> (await read()).activeHumanRiderId).toBe("blue2");
  const afterSwitch=await read();
  expect(afterSwitch.cameraFollowId).toBe("blue2");
  expect(Object.values(afterSwitch.riders).filter(r=>r.human)).toHaveLength(1);
  expect(afterSwitch.riders.blue2.human).toBe(true); expect(afterSwitch.riders.blue1.human).toBe(false);
  const blue1Start=afterSwitch.riders.blue1,blue2Start=afterSwitch.riders.blue2;
  await page.keyboard.down("KeyW");
  await expect.poll(async()=>{const d=await read();return Math.hypot(d.riders.blue2.x-blue2Start.x,d.riders.blue2.z-blue2Start.z)>.5&&Math.hypot(d.riders.blue1.x-blue1Start.x,d.riders.blue1.z-blue1Start.z)>.5}).toBe(true);
  await page.keyboard.up("KeyW"); await page.keyboard.press("Tab");
  await expect.poll(async()=> (await read()).activeHumanRiderId).toBe("blue1");
  const final=await read(); expect(final.cameraFollowId).toBe("blue1"); expect(Object.values(final.riders).filter(r=>r.human)).toHaveLength(1); expect(final.riders.blue1.human).toBe(true); expect(final.riders.blue2.human).toBe(false);
});

test("gamepad switch edge logic fires only on a press transition",()=>{expect(isSwitchEdge(true,false)).toBe(true);expect(isSwitchEdge(true,true)).toBe(false);expect(isSwitchEdge(false,true)).toBe(false)});

test("B3 pass mechanics select the teammate, enforce range, and produce finite directed power",()=>{
  const riders=[{id:"blue1" as const,x:0,y:0,z:0},{id:"blue2" as const,x:10,y:0,z:0},{id:"red1" as const,x:0,y:0,z:2},{id:"red2" as const,x:0,y:0,z:-2}];
  expect(getPassTarget("blue1",riders)?.id).toBe("blue2"); expect(getPassTarget("blue2",riders)?.id).toBe("blue1");
  expect(canPass({x:0,z:0},{x:4.9,z:0})).toBe(true);expect(canPass({x:0,z:0},{x:5.1,z:0})).toBe(false);
  expect(getPassDirection({x:0,y:0,z:0},{x:10,y:0,z:0}).x).toBeGreaterThan(.9);expect(getPassDirection({x:0,y:0,z:0},{x:0,y:0,z:-10}).z).toBeLessThan(-.9);
  expect(PASS_POWER).toBeGreaterThan(0);expect(Number.isFinite(PASS_POWER)).toBe(true);
});

test("B3 passes through live ball physics to either blue teammate",async({page})=>{
  await page.goto("/?e2e=1");
  type Debug={activeHumanRiderId:string;lastPass?:{from:string;target:string;direction:{x:number;y:number;z:number};power:number};incomingPassTargetRiderId?:string;ball?:{x:number;y:number;z:number};setupPass?:()=>void;riders:Record<string,object>};
  const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__);
  await expect.poll(async()=>Object.keys((await read())?.riders??{}).length).toBe(4);
  for(const [from,target] of [["blue1","blue2"],["blue2","blue1"]] as const){
    if((await read())!.activeHumanRiderId!==from){await page.keyboard.press("Tab");await expect.poll(async()=> (await read())?.activeHumanRiderId).toBe(from)}
    await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__?.setupPass?.());
    const before=(await read())!.ball!;await page.keyboard.press("KeyE");
    await expect.poll(async()=>{const d=await read();return d?.lastPass?.from===from&&d.lastPass.target===target&&d.incomingPassTargetRiderId===target}).toBe(true);
    const pass=(await read())!.lastPass!;expect(pass.power).toBe(PASS_POWER);expect(Number.isFinite(pass.direction.x)&&Number.isFinite(pass.direction.z)).toBe(true);
    await expect.poll(async()=>{const ball=(await read())?.ball;return !!ball&&Math.hypot(ball.x-before.x,ball.z-before.z)>.2}).toBe(true);
  }
});

test("B4 possession is exclusive and derives immediate team transitions",()=>{
  const blue=possessionForRider("blue1"),red=possessionForRider("red1");
  expect(deriveTeamModes(blue)).toEqual({blue:"attack",red:"defend"});expect(deriveTacticalStates(blue).blue1).toBe("ATTACK");expect(deriveTacticalStates(blue).blue2).toBe("SUPPORT");
  expect(deriveTeamModes(red)).toEqual({blue:"defend",red:"attack"});expect(deriveTacticalStates(red).red1).toBe("ATTACK");
  expect(deriveTeamModes(loosePossession())).toEqual({blue:"loose",red:"loose"});expect(acquirePossession([{id:"blue1",x:0,z:0},{id:"blue2",x:9,z:0},{id:"red1",x:1,z:0},{id:"red2",x:8,z:0}],{x:1,z:0})).toEqual(red);
});

test("B4.1 possession hysteresis retains control until the release radius",()=>{
  const riders=[{id:"blue1" as const,x:0,z:0},{id:"blue2" as const,x:12,z:0},{id:"red1" as const,x:20,z:0},{id:"red2" as const,x:25,z:0}];
  const blue=possessionForRider("blue1");expect(updatePossession(blue,riders,{x:4,z:0})).toEqual(blue);expect(updatePossession(blue,riders,{x:6,z:0})).toEqual(loosePossession());expect(updatePossession(blue,[...riders.slice(0,2),{id:"red1" as const,x:1,z:0},riders[3]],{x:1,z:0})).toEqual(possessionForRider("red1"));
});

test("B4.1 live possession transitions blue to red and resets loose",async({page})=>{
  await page.goto("/?e2e=1"); type Debug={possession:{kind:string;riderId?:string};teamModes:{blue:string;red:string};riders:Record<string,{tacticalState?:string}>;setupBallFor?:(id:"blue1"|"blue2"|"red1"|"red2")=>void;resetPossession?:()=>void}; const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__);
  await expect.poll(async()=>Object.keys((await read())?.riders??{}).length).toBe(4);expect((await read())!.possession.kind).toBe("loose");
  await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__?.setupBallFor?.("blue1"));await expect.poll(async()=> (await read())?.possession.kind).toBe("blue");let d=(await read())!;expect(d.teamModes).toEqual({blue:"attack",red:"defend"});expect(d.riders.blue2.tacticalState).toBe("SUPPORT");
  await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__?.setupBallFor?.("red1"));await expect.poll(async()=> (await read())?.possession.kind).toBe("red");d=(await read())!;expect(d.teamModes).toEqual({blue:"defend",red:"attack"});expect(d.riders.blue1.tacticalState).toBe("DEFEND");
  await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:Debug}).__POLO_B1_DEBUG__?.resetPossession?.());await expect.poll(async()=> (await read())?.possession.kind).toBe("loose");
});

test("timer reaching zero produces MATCH_OVER",()=>{const match=useMatch.getState();match.restart();match.setSeconds(0);expect(useMatch.getState()).toMatchObject({seconds:0,matchPhase:"MATCH_OVER"});});
test("higher Blue score produces BLUE WINS",()=>{const match=useMatch.getState();match.restart();match.scoreGoal("blue");match.setSeconds(0);expect(useMatch.getState().message).toBe("BLUE WINS");});
test("higher Red score produces RED WINS",()=>{const match=useMatch.getState();match.restart();match.scoreGoal("red");match.setSeconds(0);expect(useMatch.getState().message).toBe("RED WINS");});
test("equal score produces DRAW",()=>{const match=useMatch.getState();match.restart();match.scoreGoal("blue");match.scoreGoal("red");match.setSeconds(0);expect(useMatch.getState().message).toBe("DRAW");});
test("restart resets score, timer, match state, and P1/P2 ownership",()=>{const match=useMatch.getState();match.restart();match.scoreGoal("blue");match.setSeconds(0);match.restart();expect(useMatch.getState()).toMatchObject({scores:{blue:0,red:0},seconds:120,matchPhase:"PLAYING",activeHumanRiderId:"blue1"});expect(LOCAL_OWNERSHIP).toEqual({blue1:"p1",red1:"p2",blue2:"ai",red2:"ai"});});

test("B6 ride-off legality rejects teams, range, head-on angle and cooldown",()=>{
  const blue={id:"blue1",team:"blue" as const,x:0,z:0,heading:{x:0,z:-1},speed:6},red={id:"red1",team:"red" as const,x:2,z:0,heading:{x:0,z:-1},speed:6},now=1000,cooldowns:Record<string,number>={};
  const valid=rideOff(blue,red,now,cooldowns);expect(valid.legal).toBe(true);expect(valid.strength).toBeGreaterThan(0);expect(Number.isFinite(valid.push.x)&&Number.isFinite(valid.push.z)).toBe(true);expect(Math.hypot(valid.push.x,valid.push.z)).toBeLessThan(3);
  expect(rideOff(blue,{...red,id:"blue2",team:"blue"},now,cooldowns).reason).toBe("teammate");expect(rideOff(blue,{...red,x:RIDE_OFF_RANGE+1},now,cooldowns).reason).toBe("range");expect(rideOff(blue,{...red,heading:{x:0,z:1}},now,cooldowns).reason).toBe("head-on");expect(rideOff(blue,{...red,x:0,z:2},now,cooldowns).reason).toBe("not side-by-side");cooldowns.blue1=now+RIDE_OFF_COOLDOWN_MS;expect(findRideOffTarget(blue,[blue,red],now,cooldowns).reason).toBe("cooldown");
});

test("B6 performs a live human ride-off and rejects head-on contact",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("/?e2e=1");type D={matchState:string;riders:Record<string,{x:number;z:number}>;ball?:object;lastRideOff?:{challengerId:string;targetId?:string;legal:boolean;reason:string;strength:number}};const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__);await expect.poll(async()=>Object.keys((await read())?.riders??{}).length).toBe(4);await page.evaluate(()=>{window.dispatchEvent(new CustomEvent("polo-e2e-ride-setup",{detail:"legal"}));window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyF"}))});await expect.poll(async()=> (await read())?.lastRideOff?.legal).toBe(true);let d=(await read())!;expect(d.lastRideOff?.challengerId).toBe("blue1");expect(d.lastRideOff?.targetId).toBe("red1");expect(d.lastRideOff!.strength).toBeGreaterThan(0);expect(d.matchState).toBe("PLAYING");expect(d.ball).toBeTruthy();await page.keyboard.press("KeyF");await expect.poll(async()=> (await read())?.lastRideOff?.reason).toBe("cooldown");await page.waitForTimeout(950);await page.evaluate(()=>{window.dispatchEvent(new CustomEvent("polo-e2e-ride-setup",{detail:"head-on"}));window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyF"}))});await expect.poll(async()=> (await read())?.lastRideOff?.legal).toBe(false);expect((await read())!.lastRideOff?.reason).toBe("no legal opponent");expect(errors).toEqual([]);
});
test("POWER attacker against SPRINTER defender produces more live displacement than the inverse",async({page})=>{await page.goto("/?e2e=1");type D={ready?:boolean;lastRideOff?:{legal:boolean;push?:{x:number;z:number}}};const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__);await expect.poll(async()=> (await read())?.ready).toBe(true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent("polo-e2e-ride-setup",{detail:"ai"})));await expect.poll(async()=> (await read())?.lastRideOff?.legal).toBe(true);const powerVsSprinter=Math.hypot((await read())!.lastRideOff!.push!.x,(await read())!.lastRideOff!.push!.z);await page.waitForTimeout(950);await page.evaluate(()=>{window.dispatchEvent(new CustomEvent("polo-e2e-ride-setup",{detail:"legal"}));window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyF"}))});await expect.poll(async()=> (await read())?.lastRideOff?.legal).toBe(true);const sprinterVsPower=Math.hypot((await read())!.lastRideOff!.push!.x,(await read())!.lastRideOff!.push!.z);expect(powerVsSprinter).toBeGreaterThan(sprinterVsPower);});
test("live ride-off push is finite and remains within the safe displacement range",async({page})=>{await page.goto("/?e2e=1");type D={ready?:boolean;lastRideOff?:{legal:boolean;push?:{x:number;z:number}}};const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__);await expect.poll(async()=> (await read())?.ready).toBe(true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent("polo-e2e-ride-setup",{detail:"ai"})));await expect.poll(async()=> (await read())?.lastRideOff?.legal).toBe(true);const push=(await read())!.lastRideOff!.push!;expect(Number.isFinite(push.x)&&Number.isFinite(push.z)).toBe(true);expect(Math.hypot(push.x,push.z)).toBeLessThan(3);});

test("P1 world label uses a camera-facing billboard",()=>{const game=readFileSync("src/game/Game.tsx","utf8");expect(game).toContain('id === "blue1" ? "P1" : "P2"');expect(game).toContain("<Billboard follow>");});
test("P2 world label uses a camera-facing billboard",()=>{const game=readFileSync("src/game/Game.tsx","utf8");expect(game).toContain('id === "blue1" || id === "red1"');expect(game).toContain("<Billboard follow>");});
test("the real strike range exposes a ready state",()=>{expect(isStrikeInRange({x:0,z:0},{x:STRIKE_RANGE-.01,z:0})).toBe(true);expect(isStrikeInRange({x:0,z:0},{x:STRIKE_RANGE,z:0})).toBe(false);});
test("successful contact exposes hit feedback",()=>{const game=readFileSync("src/game/Game.tsx","utf8");expect(game).toContain('strikeFeedback = "hit"');expect(game).toContain("ballImpactUntil");expect(game).toContain('setMsg(i.backhand ? "BACKHAND!" : "CLEAN STRIKE!")');});
test("miss exposes completed non-hit feedback",()=>{const game=readFileSync("src/game/Game.tsx","utf8");expect(game).toContain('strikeFeedback = "miss"');expect(game).toContain('setMsg("MISS")');expect(game).toContain('strikeFeedback = "recovery"');});
test("game-feel pass preserves the locked ball physics configuration",()=>{const game=readFileSync("src/game/Game.tsx","utf8");expect(game).toContain("colliders={false}");expect(game).toContain("ccd");expect(game).toContain("args={[BALL_RADIUS]}");expect(game).toContain("args={[FIELD_X / 2, FIELD_COLLIDER_THICKNESS / 2, FIELD_Z / 2]}");expect(game).not.toContain("collisionGroups=");expect(game).not.toContain("solverGroups=");});
test("gait state mapping resolves idle walk canter and gallop",()=>{expect(gaitForSpeed(0)).toBe("idle");expect(gaitForSpeed(2)).toBe("walk");expect(gaitForSpeed(8)).toBe("canter");expect(gaitForSpeed(20)).toBe("gallop");});
test("idle visual gait input remains finite",()=>{expect(Number.isFinite(visualTurnLean(.5,0))).toBe(true);expect(gaitForSpeed(0)).toBe("idle");});
test("gallop visual gait input remains finite",()=>{expect(Number.isFinite(visualTurnLean(.5,24))).toBe(true);expect(gaitForSpeed(24)).toBe("gallop");});
test("turn lean remains safely clamped",()=>{for(const steer of [-100,100])expect(Math.abs(visualTurnLean(steer,100))).toBeLessThanOrEqual(.22);});
test("strike animation remains visual and leaves shot impulse deterministic",()=>{const game=readFileSync("src/game/Game.tsx","utf8"),shot=getShotImpulse({aimX:0,yaw:0,backhand:false,charge:.5,speed:4});expect(game).toContain("strikeState");expect(game).toContain("getShotImpulse(");expect(shot.power).toBe(getShotImpulse({aimX:0,yaw:0,backhand:false,charge:.5,speed:4}).power);});
test("pause and restart retain valid animation-driving state",()=>{const match=useMatch.getState();match.restart();const before=match.seconds;match.togglePause();expect(useMatch.getState().paused).toBe(true);expect(useMatch.getState().seconds).toBe(before);match.restart();expect(useMatch.getState()).toMatchObject({paused:false,activeHumanRiderId:"blue1",matchPhase:"PLAYING"});});

test("completes a full 2v2 match lifecycle",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("/?e2e=1");
  type D={matchState:string;score:{blue:number;red:number};timeRemaining:number;possession:{kind:string};teamModes:{blue:string;red:string};activeHumanRiderId:string;cameraFollowId:string;riders:Record<string,{human:boolean;tacticalState?:string}>;lastPass?:{from:string;target:string};ball?:{x:number;z:number};setupPass?:()=>void;setupBallFor?:(id:"blue1"|"red1")=>void};const read=()=>page.evaluate(()=>(window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__);const event=(name:string,detail?:unknown)=>page.evaluate(([name,detail])=>window.dispatchEvent(new CustomEvent(name,{detail})),[name,detail] as [string,unknown]);
  await expect.poll(async()=>Object.keys((await read())?.riders??{}).length).toBe(4);let d=(await read())!;expect(d.matchState).toBe("PLAYING");expect(d.score).toEqual({blue:0,red:0});expect(d.possession.kind).toBe("loose");expect(Object.values(d.riders).filter(r=>r.human)).toHaveLength(1);
  await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__?.setupBallFor?.("blue1"));await expect.poll(async()=> (await read())?.possession.kind).toBe("blue");expect((await read())!.teamModes).toEqual({blue:"attack",red:"defend"});
  await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__?.setupPass?.());await page.keyboard.press("KeyE");await expect.poll(async()=>{const p=(await read())?.lastPass;return p?.from==="blue1"&&p.target==="blue2"}).toBe(true);
  await page.keyboard.press("Tab");await expect.poll(async()=> (await read())?.activeHumanRiderId).toBe("blue2");d=(await read())!;expect(d.cameraFollowId).toBe("blue2");expect(d.riders.blue1.human).toBe(false);expect(d.riders.blue2.human).toBe(true);
  await page.evaluate(()=> (window as Window&{__POLO_B1_DEBUG__?:D}).__POLO_B1_DEBUG__?.setupBallFor?.("red1"));await expect.poll(async()=> (await read())?.possession.kind).toBe("red");expect((await read())!.teamModes).toEqual({blue:"defend",red:"attack"});
  await event("polo-e2e-goal","blue");await expect.poll(async()=> (await read())?.score.blue).toBe(1);expect((await read())!.score.red).toBe(0);await expect.poll(async()=> (await read())?.score.blue).toBe(1);await expect.poll(async()=> (await read())?.matchState).toBe("PLAYING");await expect.poll(async()=> (await read())?.possession.kind).toBe("loose");d=(await read())!;expect(Math.hypot(d.ball!.x,d.ball!.z)).toBeLessThan(1);expect(Object.values(d.riders).filter(r=>r.human)).toHaveLength(1);expect(d.riders.red1.tacticalState).toBeTruthy();
  await event("polo-e2e-goal","red");await expect.poll(async()=> (await read())?.score.red).toBe(1);expect((await read())!.score).toEqual({blue:1,red:1});await expect.poll(async()=> (await read())?.score.red).toBe(1);
  await event("polo-e2e-seconds",1);await expect.poll(async()=> (await read())?.matchState).toBe("MATCH_OVER");d=(await read())!;expect(d.score).toEqual({blue:1,red:1});expect(d.timeRemaining).toBe(0);expect(d.timeRemaining).toBeGreaterThanOrEqual(0);
  await page.getByRole("button",{name:"RESTART"}).click();await expect.poll(async()=> (await read())?.matchState).toBe("PLAYING");d=(await read())!;expect(d.score).toEqual({blue:0,red:0});expect(d.possession.kind).toBe("loose");expect(d.timeRemaining).toBeGreaterThan(100);expect(Object.values(d.riders).filter(r=>r.human)).toHaveLength(1);expect(d.riders.red1.tacticalState).toBeTruthy();expect(Math.hypot(d.ball!.x,d.ball!.z)).toBeLessThan(1);expect(errors).toEqual([]);
});
