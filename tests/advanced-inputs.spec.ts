import { expect,test } from "@playwright/test";
import { DEFAULT_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE, applyCameraWheel, getAdvancedCameraOffset, smoothCameraDistance } from "../src/game/Camera";
import { MIDDLE_MOUSE_BUTTON, PRIMARY_MOUSE_BUTTON, SECONDARY_MOUSE_BUTTON, calculateAimDirection, createInputSnapshot } from "../src/game/InputManager";
import { getEffectiveSwingCharge, getPlayerCombos } from "../src/game/PlayerState";
import { getShotImpulse } from "../src/game/PoloMechanics";

test("complete advanced keyboard and mouse matrix is registered",()=>{
  const keys=new Set(["KeyW","KeyD","ControlLeft","KeyV","KeyQ","KeyE","KeyR","KeyF","KeyX","Digit3","ShiftLeft","Space"]);
  const input=createInputSnapshot(keys,new Set([PRIMARY_MOUSE_BUTTON,SECONDARY_MOUSE_BUTTON]),{x:-.6,y:.25},14);
  expect(input).toMatchObject({throttle:1,steer:1,brake:true,collectHorse:true,lookBack:true,callPass:true,quickPass:true,powerModifier:true,defensiveMark:true,hookMallet:true,gallop:true,focus:true,strike:true,rideOff:true,power:true,activeTactic:3,cameraZoom:14});
  expect(input.tactics).toEqual({one:false,two:false,three:true,four:false});
});

test("mouse swing aim is normalized and independent from WASD steering",()=>{
  const aim=calculateAimDirection(80,120,1280,720);
  const input=createInputSnapshot(new Set(["KeyD"]),new Set(),aim);
  expect(input.steer).toBe(1);
  expect(input.aimX).toBeLessThan(0);
  expect(Math.hypot(input.aimX,input.aimY)).toBeLessThanOrEqual(1);
  const left=getShotImpulse({aimX:input.aimX,aimY:input.aimY,yaw:0,backhand:false,charge:.5,speed:12});
  const right=getShotImpulse({aimX:-input.aimX,aimY:-input.aimY,yaw:0,backhand:false,charge:.5,speed:12});
  expect(left.x).toBeLessThan(right.x);
  expect(left.y).toBeGreaterThan(right.y);
});

test("chorded combos require concurrent inputs and power strike scales charge by 1.5",()=>{
  const chorded=createInputSnapshot(new Set(["ShiftLeft","Space","KeyR","KeyF"]),new Set([PRIMARY_MOUSE_BUTTON,SECONDARY_MOUSE_BUTTON]));
  expect(getPlayerCombos(chorded)).toEqual({sprintFocus:true,powerStrike:true,defensiveMark:true});
  expect(getEffectiveSwingCharge(.6,true)).toBeCloseTo(.9);
  expect(getEffectiveSwingCharge(1,true)).toBe(1.5);
  const modifiersOnly=createInputSnapshot(new Set(["KeyR","KeyF"]),new Set());
  expect(getPlayerCombos(modifiersOnly)).toEqual({sprintFocus:false,powerStrike:false,defensiveMark:false});
  expect(modifiersOnly.strike).toBe(false);
});

test("wheel zoom clamps to 5-20m and middle-button recenter converges smoothly",()=>{
  expect(applyCameraWheel(MIN_CAMERA_DISTANCE,-100)).toBe(MIN_CAMERA_DISTANCE);
  expect(applyCameraWheel(MAX_CAMERA_DISTANCE,100)).toBe(MAX_CAMERA_DISTANCE);
  const zoomed=applyCameraWheel(DEFAULT_CAMERA_DISTANCE,100);
  expect(zoomed).toBeGreaterThan(DEFAULT_CAMERA_DISTANCE);
  const recentered=smoothCameraDistance(zoomed,DEFAULT_CAMERA_DISTANCE,.1);
  expect(recentered).toBeLessThan(zoomed);
  expect(recentered).toBeGreaterThan(DEFAULT_CAMERA_DISTANCE);
  const rear=getAdvancedCameraOffset(0,12,0,DEFAULT_CAMERA_DISTANCE,false);
  const lookBack=getAdvancedCameraOffset(0,12,0,DEFAULT_CAMERA_DISTANCE,true);
  expect(Math.sign(rear.z)).toBe(-Math.sign(lookBack.z));
});

test("live mouse strike, defensive mark, controls legend, and paused UI remain interactive",async({page})=>{
  // The live Three.js/GLB scene is intentionally heavyweight under headless GPU emulation.
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button",{name:"ENTER KING'S CUP"}).click();
  await expect(page.locator("canvas")).toBeVisible({timeout:8_000});
  await expect(page.locator("html")).toHaveAttribute("data-polo-input-ready","true");
  const controls=page.getByLabel("PC controls");
  for(const binding of ["LMB","RMB","CTRL","Q/E","R+LMB","F+RMB","V","MMB/WHEEL"])await expect(controls.getByText(binding,{exact:true})).toBeVisible();
  const canvasElement=page.locator("canvas");
  const canvas=await canvasElement.boundingBox();
  if(!canvas)throw new Error("WebGL canvas has no bounds");
  await canvasElement.dispatchEvent("mousemove",{clientX:canvas.x+canvas.width*.25,clientY:canvas.y+canvas.height*.3});
  await expect.poll(async()=>Number(await page.locator("html").getAttribute("data-polo-aim-x"))).toBeLessThan(0);
  await page.keyboard.down("KeyR");
  await canvasElement.dispatchEvent("mousedown",{button:PRIMARY_MOUSE_BUTTON});
  await expect(page.locator("html")).toHaveAttribute("data-polo-strike","active");
  await expect(page.locator("html")).toHaveAttribute("data-polo-combo","power-strike");
  await canvasElement.dispatchEvent("mouseup",{button:PRIMARY_MOUSE_BUTTON});
  await page.keyboard.up("KeyR");
  await page.keyboard.down("KeyF");
  await canvasElement.dispatchEvent("mousedown",{button:SECONDARY_MOUSE_BUTTON});
  await expect(page.locator("html")).toHaveAttribute("data-polo-ride-off","active");
  await expect(page.locator("html")).toHaveAttribute("data-polo-combo","defensive-mark");
  await canvasElement.dispatchEvent("mouseup",{button:SECONDARY_MOUSE_BUTTON});
  await page.keyboard.up("KeyF");
  await canvasElement.dispatchEvent("wheel",{deltaY:200});
  await expect.poll(async()=>Number(await page.locator("html").getAttribute("data-polo-camera-distance"))).toBeGreaterThan(DEFAULT_CAMERA_DISTANCE);
  await canvasElement.dispatchEvent("mousedown",{button:MIDDLE_MOUSE_BUTTON});
  await canvasElement.dispatchEvent("mouseup",{button:MIDDLE_MOUSE_BUTTON});
  await expect(page.locator("html")).toHaveAttribute("data-polo-camera-distance",DEFAULT_CAMERA_DISTANCE.toFixed(2));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog",{name:"Pause menu"})).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-polo-strike","idle");
  await canvasElement.dispatchEvent("mousemove",{clientX:canvas.x+20,clientY:canvas.y+20});
  await page.getByRole("button",{name:"RESUME"}).click();
  await expect(page.getByRole("dialog",{name:"Pause menu"})).toHaveCount(0);
});
