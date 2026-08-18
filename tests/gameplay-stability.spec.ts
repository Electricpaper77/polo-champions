import { expect, test } from "@playwright/test";
import { initializeMatchEntities, useMatch, type PoloRiderEntity } from "../src/game/GameState";
import { integrateHorseMotion } from "../src/game/HorseControls";
import { advanceBotRider, assignAITacticalRoles, calculateFormationMetrics, detectGoalCrossing, getBotMotionInput, getBotShotImpulse, getBotTacticalTarget, isBallInPlay, MIN_RIDER_SEPARATION, resolveRideOffCollision, resolveRiderSeparation, scoringTeam, selectBallChasers } from "../src/game/MatchRules";

const IDS:PoloRiderEntity["id"][]=["player","blue_2","blue_3","blue_4","blue_5","blue_6","red_1","red_2","red_3","red_4","red_5","red_6"];

function simulate(seconds:number,ball={x:0,z:-8}){
  let entities=initializeMatchEntities();
  const dt=1/60;
  for(let tick=0;tick<seconds/dt;tick+=1){
    const next=Object.fromEntries(Object.entries(entities).map(([id,entity])=>[id,{...entity,homePosition:{...entity.homePosition},position:{...entity.position},velocity:{...entity.velocity}}])) as typeof entities;
    const bots=IDS.filter(id=>id!=="player").map(id=>next[id]);
    const chasers=selectBallChasers(bots,ball);
    const roles=assignAITacticalRoles(bots,ball);
    for(const rider of bots){
      const chaser=chasers[rider.team]===rider.id;
      const role=roles[rider.id]!;
      next[rider.id]=advanceBotRider(rider,getBotTacticalTarget(rider,ball,chasers,true,role),chaser,dt,role);
    }
    for(let first=0;first<IDS.length;first+=1)for(let second=first+1;second<IDS.length;second+=1){
      const a=next[IDS[first]],b=next[IDS[second]],separation=resolveRiderSeparation(a,b);
      if(separation.corrected){a.position={x:separation.a.x,y:separation.a.z};b.position={x:separation.b.x,y:separation.b.z};}
    }
    entities=next;
  }
  return entities;
}

test("kickoff formation is measured, symmetric, and collision-safe",()=>{
  const metrics=calculateFormationMetrics(Object.values(initializeMatchEntities()));
  expect(metrics.riderCount).toBe(12);
  expect(metrics.pairChecks).toBe(66);
  expect(metrics.minimumSeparation).toBeGreaterThan(12);
  expect(metrics.blueCentroidZ).toBeCloseTo(-metrics.redCentroidZ,8);
});

test("stationary kickoff holds formation instead of sending every bot to center",()=>{
  const entities=initializeMatchEntities(),ball={x:0,z:0},velocity={x:0,z:0};
  expect(isBallInPlay(ball,velocity)).toBe(false);
  const chasers=selectBallChasers(Object.values(entities).filter(entity=>entity.id!=="player"),ball);
  for(const entity of Object.values(entities).filter(entity=>entity.id!=="player")){
    const target=getBotTacticalTarget(entity,ball,chasers,false);
    const advanced=advanceBotRider(entity,target,false,10);
    expect(advanced.position).toEqual(entity.homePosition);
    expect(advanced.velocity).toEqual({x:0,y:0});
  }
});

test("active 6v6 simulation keeps lanes and prevents the center pileup",()=>{
  const ball={x:0,z:-8},entities=simulate(15,ball),riders=Object.values(entities),metrics=calculateFormationMetrics(riders);
  const nearBall=riders.filter(rider=>Math.hypot(rider.position.x-ball.x,rider.position.y-ball.z)<5);
  expect(metrics.minimumSeparation).toBeGreaterThanOrEqual(MIN_RIDER_SEPARATION-.001);
  expect(nearBall.length).toBeLessThanOrEqual(2);
  expect(riders.filter(rider=>Math.hypot(rider.position.x-ball.x,rider.position.y-ball.z)>8).length).toBeGreaterThanOrEqual(8);
});

test("mass-weighted overlap correction separates exact overlaps without clipping",()=>{
  const entities=initializeMatchEntities(),light={...entities.blue_2,position:{x:0,y:0}},heavy={...entities.blue_4,position:{x:0,y:0}};
  const result=resolveRiderSeparation(light,heavy),distance=Math.hypot(result.a.x-result.b.x,result.a.z-result.b.z);
  expect(result.corrected).toBe(true);
  expect(distance).toBeCloseTo(MIN_RIDER_SEPARATION,8);
  expect(Math.abs(result.a.x)).toBeGreaterThan(Math.abs(result.b.x));
});

test("ride-off collision gives the momentum winner leverage and RMB increases the impulse",()=>{
  const entities=initializeMatchEntities();
  const light={...entities.blue_2,position:{x:0,y:0},velocity:{x:0,y:5}};
  const heavy={...entities.red_4,position:{x:1.5,y:0},velocity:{x:0,y:8}};
  const passive=resolveRideOffCollision(light,heavy);
  expect(passive.corrected).toBe(true);
  expect(passive.winnerId).toBe(heavy.id);
  expect(Math.abs(passive.a.velocity.x-light.velocity.x)).toBeGreaterThan(Math.abs(passive.b.velocity.x-heavy.velocity.x));
  expect(Math.hypot(passive.a.position.x-passive.b.position.x,passive.a.position.z-passive.b.position.z)).toBeGreaterThanOrEqual(MIN_RIDER_SEPARATION);

  const matchedA={...entities.blue_3,position:{x:0,y:0},velocity:{x:0,y:7}};
  const matchedB={...entities.red_3,position:{x:1.5,y:0},velocity:{x:0,y:7}};
  const normal=resolveRideOffCollision(matchedA,matchedB);
  const active=resolveRideOffCollision(matchedA,matchedB,{aRideOff:true});
  expect(active.winnerId).toBe(matchedA.id);
  expect(active.impulse).toBeGreaterThan(normal.impulse);
});

test("AI roles are deterministic and bot motion uses the canonical horse integrator",()=>{
  const entities=initializeMatchEntities(),ball={x:2,z:-7};
  const bots=Object.values(entities).filter(entity=>entity.id!=="player");
  const roles=assignAITacticalRoles(bots,ball);
  expect(Object.values(roles).filter(role=>role==="BALL_ATTACKER")).toHaveLength(2);
  expect(Object.values(roles)).toContain("OFFENSE_SUPPORT");
  expect(Object.values(roles)).toContain("DEFENDER");

  const rider=entities.blue_2,role=roles[rider.id]!,chasers=selectBallChasers(bots,ball);
  const target=getBotTacticalTarget(rider,ball,chasers,true,role);
  const input=getBotMotionInput(rider,target,role);
  const expected=integrateHorseMotion({position:{x:rider.position.x,z:rider.position.y},velocity:{x:rider.velocity.x,z:rider.velocity.y},heading:rider.heading},input,1/60,rider.archetype);
  const actual=advanceBotRider(rider,target,true,1/60,role);
  expect(actual.position.x).toBeCloseTo(expected.position.x,10);
  expect(actual.position.y).toBeCloseTo(expected.position.z,10);
  expect(actual.velocity.x).toBeCloseTo(expected.velocity.x,10);
  expect(actual.velocity.y).toBeCloseTo(expected.velocity.z,10);
  expect(actual.heading).toBeCloseTo(expected.heading,10);
});

test("bot clearances and goals use the actual team direction",()=>{
  const entities=initializeMatchEntities(),ball={x:0,z:0};
  expect(getBotShotImpulse(entities.blue_2,ball).z).toBeLessThan(0);
  expect(getBotShotImpulse(entities.red_1,ball).z).toBeGreaterThan(0);
  expect(scoringTeam({x:0,z:-43})).toBe("blue");
  expect(scoringTeam({x:0,z:43})).toBe("red");
  expect(scoringTeam({x:6,z:43})).toBeNull();
  expect(detectGoalCrossing({x:0,z:41},{x:0,z:43})).toBe("red");
  expect(detectGoalCrossing({x:0,z:-41},{x:0,z:-43})).toBe("blue");
  expect(detectGoalCrossing({x:6,z:41},{x:6,z:43})).toBeNull();
  expect(detectGoalCrossing({x:0,z:43},{x:0,z:44})).toBeNull();
});

test("goal state pauses for celebration, resets kickoff, and restart clears canonical match data",()=>{
  useMatch.getState().restart();
  const resetKey=useMatch.getState().resetKey;
  useMatch.getState().scoreGoal("red");
  expect(useMatch.getState().score).toEqual({blue:0,red:1});
  expect(useMatch.getState().started).toBe(false);
  expect(useMatch.getState().celebratingGoal).toBe("red");
  useMatch.getState().completeGoalCelebration();
  expect(useMatch.getState().celebratingGoal).toBeNull();
  expect(useMatch.getState().resetKey).toBe(resetKey+1);
  expect(useMatch.getState().entities.player.position).toEqual(useMatch.getState().entities.player.homePosition);
  expect(useMatch.getState().score).toEqual({blue:0,red:1});
  useMatch.getState().restart();
  expect(useMatch.getState().score).toEqual({blue:0,red:0});
  expect(useMatch.getState().seconds).toBe(420);
});

test("live kickoff clock waits for intent and radar contains canonical riders",async({page})=>{
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button",{name:"ENTER KING'S CUP"}).click();
  await expect(page.getByText("SEARCHING FOR MATCH")).toBeVisible();
  await expect(page.getByText("AWAITING KICK OFF")).toBeVisible({timeout:30_000});
  await page.waitForTimeout(1_200);
  await expect(page.getByText("07:00",{exact:true})).toBeVisible();
  const radar=page.getByLabel("Field radar");
  await expect(radar.locator(".rider")).toHaveCount(12);
  await expect(radar.locator(".ball")).toHaveCount(1);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1_200);
  await page.keyboard.up("KeyW");
  await expect(page.getByText("LIVE",{exact:true})).toBeVisible();
  await expect(page.getByText("06:59",{exact:true})).toBeVisible();
});
