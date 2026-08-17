import { expect, test } from "@playwright/test";
import { initializeMatchEntities, useMatch, type PoloRiderEntity } from "../src/game/GameState";
import { advanceBotRider, calculateFormationMetrics, getBotShotImpulse, getBotTacticalTarget, isBallInPlay, MIN_RIDER_SEPARATION, resolveRiderSeparation, scoringTeam, selectBallChasers } from "../src/game/MatchRules";

const IDS:PoloRiderEntity["id"][]=["player","blue_2","blue_3","blue_4","blue_5","blue_6","red_1","red_2","red_3","red_4","red_5","red_6"];

function simulate(seconds:number,ball={x:0,z:-8}){
  let entities=initializeMatchEntities();
  const dt=1/60;
  for(let tick=0;tick<seconds/dt;tick+=1){
    const next=Object.fromEntries(Object.entries(entities).map(([id,entity])=>[id,{...entity,homePosition:{...entity.homePosition},position:{...entity.position},velocity:{...entity.velocity}}])) as typeof entities;
    const bots=IDS.filter(id=>id!=="player").map(id=>next[id]);
    const chasers=selectBallChasers(bots,ball);
    for(const rider of bots){
      const chaser=chasers[rider.team]===rider.id;
      next[rider.id]=advanceBotRider(rider,getBotTacticalTarget(rider,ball,chasers,true),chaser,dt);
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

test("bot clearances and goals use the actual team direction",()=>{
  const entities=initializeMatchEntities(),ball={x:0,z:0};
  expect(getBotShotImpulse(entities.blue_2,ball).z).toBeLessThan(0);
  expect(getBotShotImpulse(entities.red_1,ball).z).toBeGreaterThan(0);
  expect(scoringTeam({x:0,z:-43})).toBe("blue");
  expect(scoringTeam({x:0,z:43})).toBe("red");
  expect(scoringTeam({x:6,z:43})).toBeNull();
});

test("score state records both teams and restart clears canonical match data",()=>{
  useMatch.getState().restart();
  useMatch.getState().scoreGoal("red");
  expect(useMatch.getState().score).toEqual({blue:0,red:1});
  expect(useMatch.getState().started).toBe(false);
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
