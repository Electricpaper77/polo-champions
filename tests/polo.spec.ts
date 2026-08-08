import { expect, test } from "@playwright/test";
import { BRAKE_SPEED, GALLOP_SPEED, getTargetSpeed, NORMAL_RIDE_SPEED } from "../src/game/HorseControls";
import { getBallResetState, getShotImpulse, INITIAL_GOAL_STATE, transitionGoal } from "../src/game/PoloMechanics";
import { attackingGoal, choosePossession, getAiState, getRoleTarget, isRightOfWay, nextPlayer, ROSTER } from "../src/game/TeamPolo";
import { RIDER_FIELD_BOUNDS, RIDER_SPAWNS, spawnToVector3 } from "../src/game/Game";
import { isSwitchEdge } from "../src/game/InputManager";
import { PASS_POWER, canPass, getPassDirection, getPassTarget } from "../src/game/PassMechanics";
import { acquirePossession, deriveTacticalStates, deriveTeamModes, loosePossession, possessionForRider, updatePossession } from "../src/game/Possession";
import { getMatchResult, useMatch } from "../src/game/GameState";

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

test("B5 scores each attacking direction once, reaches full time, and restarts",()=>{
  const match=useMatch.getState();match.restart();match.scoreGoal("blue");expect(useMatch.getState().scores).toEqual({blue:1,red:0});match.scoreGoal("red");expect(useMatch.getState().scores).toEqual({blue:1,red:1});match.setSeconds(0);expect(useMatch.getState().matchPhase).toBe("FULL_TIME");expect(getMatchResult({blue:2,red:1})).toBe("BLUE WINS");expect(getMatchResult({blue:1,red:2})).toBe("RED WINS");expect(getMatchResult({blue:1,red:1})).toBe("DRAW");match.restart();expect(useMatch.getState().scores).toEqual({blue:0,red:0});expect(useMatch.getState().matchPhase).toBe("PLAYING");expect(useMatch.getState().activeHumanRiderId).toBe("blue1");
});

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
  await event("polo-e2e-seconds",1);await expect.poll(async()=> (await read())?.matchState).toBe("FULL_TIME");d=(await read())!;expect(d.score).toEqual({blue:1,red:1});expect(d.timeRemaining).toBe(0);expect(d.timeRemaining).toBeGreaterThanOrEqual(0);
  await page.getByRole("button",{name:"RESTART"}).click();await expect.poll(async()=> (await read())?.matchState).toBe("PLAYING");d=(await read())!;expect(d.score).toEqual({blue:0,red:0});expect(d.possession.kind).toBe("loose");expect(d.timeRemaining).toBeGreaterThan(100);expect(Object.values(d.riders).filter(r=>r.human)).toHaveLength(1);expect(d.riders.red1.tacticalState).toBeTruthy();expect(Math.hypot(d.ball!.x,d.ball!.z)).toBeLessThan(1);expect(errors).toEqual([]);
});
