import { expect, test } from "@playwright/test";
import { BRAKE_SPEED, GALLOP_SPEED, getTargetSpeed, NORMAL_RIDE_SPEED } from "../src/game/HorseControls";
import { getBallResetState, getShotImpulse, INITIAL_GOAL_STATE, transitionGoal } from "../src/game/PoloMechanics";
import { attackingGoal, choosePossession, getAiState, getRoleTarget, isRightOfWay, nextPlayer, ROSTER } from "../src/game/TeamPolo";
import { RIDER_FIELD_BOUNDS, RIDER_SPAWNS, spawnToVector3 } from "../src/game/Game";
import { isSwitchEdge } from "../src/game/InputManager";

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
