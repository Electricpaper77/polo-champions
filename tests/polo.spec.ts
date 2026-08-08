import { expect, test } from "@playwright/test";
import { BRAKE_SPEED, GALLOP_SPEED, getTargetSpeed, NORMAL_RIDE_SPEED } from "../src/game/HorseControls";
import { getBallResetState, getShotImpulse, INITIAL_GOAL_STATE, transitionGoal } from "../src/game/PoloMechanics";
import { attackingGoal, choosePossession, getAiState, getRoleTarget, isRightOfWay, nextPlayer, ROSTER } from "../src/game/TeamPolo";

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
