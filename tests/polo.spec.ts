import { expect, test } from "@playwright/test";
import { advanceHorseSpeed, advanceStamina, BRAKE_SPEED, GALLOP_SPEED, getArchetypeCoat, getBodyLean, getCameraOffset, getGait, getHorseArchetype, getRiderPose, getSteeringRate, getTargetSpeed, HORSE_COATS, NORMAL_RIDE_SPEED } from "../src/game/HorseControls";
import { canApplyStrike, getBallResetState, getMalletAngle, getShotImpulse, getStrikePhase, INITIAL_GOAL_STATE, isStrikeContact, transitionGoal } from "../src/game/PoloMechanics";
import { applyRideOffDisplacement, create2v2, decideBot, goalResult, isLineOfBallFoul, legalRideOff, rideOffImpulse } from "../src/game/MatchRules";
import { FoulToast } from "../src/game/Game";
import { initializeMatchEntities } from "../src/game/GameState";
async function enterMatch(page: import("@playwright/test").Page) { await page.getByRole("button", { name: "ENTER KING'S CUP" }).click(); await expect(page.getByText("SEARCHING FOR MATCH")).toBeVisible(); await expect(page.locator("canvas")).toBeVisible({ timeout: 8_000 }); }

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

test("riding response accelerates, coasts, brakes, and retains speed-sensitive control", () => {
  const normalStep = advanceHorseSpeed(0, { throttle: 1, gallop: false, brake: false }, 0.1);
  const gallopStep = advanceHorseSpeed(0, { throttle: 1, gallop: true, brake: false }, 0.1);
  const coastStep = advanceHorseSpeed(12, { throttle: 0, gallop: false, brake: false }, 0.1);
  const brakeStep = advanceHorseSpeed(12, { throttle: 0, gallop: false, brake: true }, 0.1);

  expect(gallopStep).toBeGreaterThan(normalStep);
  expect(coastStep).toBeGreaterThan(0);
  expect(brakeStep).toBeLessThan(coastStep);
  expect(getSteeringRate(GALLOP_SPEED)).toBeLessThan(getSteeringRate(0));
  expect(getBodyLean(1, GALLOP_SPEED)).toBeLessThan(0);
});

test("camera anticipates turns and the mallet winds up before impact", () => {
  const straight = getCameraOffset(0, 0, 0);
  const gallopingTurn = getCameraOffset(0, GALLOP_SPEED, 1);
  const windup = getMalletAngle(0, true, false, 0.1);
  const impact = getMalletAngle(windup, false, true, 0.016);

  expect(gallopingTurn.y).toBeGreaterThan(straight.y);
  expect(gallopingTurn.x).toBeGreaterThan(straight.x);
  expect(gallopingTurn.lookAhead).toBeGreaterThan(straight.lookAhead);
  expect(windup).toBeLessThan(0);
  expect(impact).toBeGreaterThan(0);
});

test("five gait thresholds, stamina, and rider pose are deterministic", () => {
  expect([0, 3, 8, 14, 22].map(getGait)).toEqual(["IDLE", "WALK", "TROT", "CANTER", "GALLOP"]);
  expect(advanceStamina(1, true, 1)).toBeLessThan(1);
  expect(advanceStamina(.5, false, 1)).toBeGreaterThan(.5);
  expect(getRiderPose("GALLOP", 0, false).torsoPitch).toBeLessThan(getRiderPose("WALK", 0, false).torsoPitch);
  expect(getRiderPose("CANTER", 1, false).torsoPitch).toBeGreaterThan(getRiderPose("CANTER", -1, false).torsoPitch);
  expect(getRiderPose("TROT", 0, true).torsoPitch).toBeGreaterThan(getRiderPose("TROT", 0, false).torsoPitch);
});

test("only the contact phase can authorize a strike", () => {
  expect(getStrikePhase(-1, false)).toBe("READY");
  expect(getStrikePhase(0, false)).toBe("WIND_UP");
  expect(getStrikePhase(.12, false)).toBe("CONTACT");
  expect(getStrikePhase(.2, false)).toBe("FOLLOW_THROUGH");
  expect(getStrikePhase(.4, false)).toBe("RECOVERY");
  expect(isStrikeContact(getStrikePhase(.12, false))).toBe(true);
  expect(isStrikeContact(getStrikePhase(.2, false))).toBe(false);
  expect(canApplyStrike("CONTACT", false)).toBe(true);
  expect(canApplyStrike("CONTACT", true)).toBe(false);
  expect(canApplyStrike("FOLLOW_THROUGH", false)).toBe(false);
});

test("horse archetypes scale handling without changing the baseline default", () => {
  expect(getHorseArchetype().topSpeed).toBe(1);
  expect(getTargetSpeed({ throttle: 1, gallop: true, brake: false }, "SPRINTER")).toBeGreaterThan(getTargetSpeed({ throttle: 1, gallop: true, brake: false }, "POWER"));
  expect(getSteeringRate(12, "SPRINTER")).toBeGreaterThan(getSteeringRate(12, "POWER"));
  expect(advanceHorseSpeed(0, { throttle: 1, gallop: false, brake: false }, .1, "SPRINTER")).toBeGreaterThan(advanceHorseSpeed(0, { throttle: 1, gallop: false, brake: false }, .1, "POWER"));
  expect(advanceStamina(1, true, 1, "SPRINTER")).toBeLessThan(advanceStamina(1, true, 1, "POWER"));
  expect(getBodyLean(1, GALLOP_SPEED, "POWER")).toBeGreaterThan(getBodyLean(1, GALLOP_SPEED, "SPRINTER"));
});

test("archetype coats remain presentation-only readable variants", () => {
  expect(getArchetypeCoat("SPRINTER")).toBe("CHESTNUT");
  expect(getArchetypeCoat("ALL_ROUNDER")).toBe("BAY");
  expect(getArchetypeCoat("POWER")).toBe("DARK_BAY");
  expect(Object.keys(HORSE_COATS)).toEqual(["BAY", "DARK_BAY", "CHESTNUT", "LIGHT_GRAY"]);
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

test("loads the playable polo slice without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await enterMatch(page);
  await expect(page.getByText("POLO CHAMPIONS")).toBeVisible();
  await expect(page.getByText("ROYAL GUARD", { exact: true })).toBeVisible();
  await page.keyboard.press("KeyW");
  await page.keyboard.press("Space");
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("broadcast HUD renders teams, telemetry, and field radar", async ({ page }) => {
  await page.goto("/");
  await enterMatch(page);
  await expect(page.getByText("BLUE", { exact: true })).toBeVisible();
  await expect(page.getByText("RED", { exact: true })).toBeVisible();
  await expect(page.getByText("CHUKKER 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Field radar")).toBeVisible();
  await expect(page.getByLabel("Speed and stamina")).toBeVisible();
});

test("AI role assignment and pursuit choose tactical states", () => { const bots=create2v2(); expect(bots).toHaveLength(4); expect(bots.filter(b=>b.role==="ATTACKER")).toHaveLength(2); expect(decideBot(bots[0],{x:0,z:0})).toBe("APPROACH_BALL"); expect(decideBot({...bots[0],position:{x:0,z:1},facing:{x:0,z:-1}},{x:0,z:0})).toBe("CHARGE_SWING"); });
test("ride-off collision respects parallel angle and archetype mass", () => { const [sprinter,power]=[create2v2()[0],create2v2()[1]]; expect(legalRideOff(sprinter,power)).toBe(true); expect(rideOffImpulse(power,sprinter)).toBeGreaterThan(rideOffImpulse(sprinter,power)); expect(rideOffImpulse(sprinter,{...power,facing:{x:1,z:0}})).toBe(0); });
test("goal and line-of-ball rules resolve deterministically", () => { expect(goalResult({x:0,z:43})).toEqual({scored:true,reset:{x:0,z:0}}); expect(isLineOfBallFoul({x:0,z:0},{x:0,z:1},{x:0,z:5},"BLUE","RED")).toBe(true); });
test("unified player and bot ride-off applies a mass-weighted displacement", () => { const entities=initializeMatchEntities(); expect(Object.keys(entities)).toEqual(["player","blue_2","blue_3","blue_4","blue_5","blue_6","red_1","red_2","red_3","red_4","red_5","red_6"]); const player={id:"player",team:"BLUE" as const,role:"ATTACKER" as const,archetype:entities.player.archetype,position:{x:0,z:0},facing:{x:0,z:1}},power={id:"blue_2",team:"BLUE" as const,role:"PIVOT" as const,archetype:"POWER" as const,position:{x:1,z:0},facing:{x:0,z:1}},result=applyRideOffDisplacement(player,power); expect(result.a.x).toBeLessThan(player.position.x); expect(result.b.x).toBe(power.position.x); });
test("LOB foul banner renders only while an active foul exists", () => { const visible=FoulToast({active:true}); expect(visible?.props.children).toBe("FOUL: LINE OF BALL CROSSING"); expect(visible?.props.className).toBe("foul-toast"); expect(FoulToast({active:false})).toBeNull(); });
