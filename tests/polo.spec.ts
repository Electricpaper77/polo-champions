import { expect, test } from "@playwright/test";
import { advanceHorseSpeed, advanceStamina, BRAKE_SPEED, GALLOP_SPEED, getBodyLean, getCameraOffset, getGait, getHorseArchetype, getRiderPose, getSteeringRate, getTargetSpeed, NORMAL_RIDE_SPEED } from "../src/game/HorseControls";
import { canApplyStrike, getBallResetState, getMalletAngle, getShotImpulse, getStrikePhase, INITIAL_GOAL_STATE, isStrikeContact, transitionGoal } from "../src/game/PoloMechanics";

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
  await expect(page.getByText("POLO CHAMPIONS")).toBeVisible();
  await expect(page.getByText("YOUR GOALS")).toBeVisible();
  await page.keyboard.press("KeyW");
  await page.keyboard.press("Space");
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});
