import { useEffect, useRef } from "react";
import { DEFAULT_CAMERA_DISTANCE, applyCameraWheel } from "./Camera";

export const PRIMARY_MOUSE_BUTTON = 0;
export const MIDDLE_MOUSE_BUTTON = 1;
export const SECONDARY_MOUSE_BUTTON = 2;

export type AimDirection = { x:number; y:number };
export type TacticalKeyState = { one:boolean; two:boolean; three:boolean; four:boolean };
export type TacticalSlot = 1 | 2 | 3 | 4 | null;

export type Input = {
  throttle:number;
  steer:number;
  aimX:number;
  aimY:number;
  aimDirection:AimDirection;
  strike:boolean;
  rideOff:boolean;
  focus:boolean;
  power:boolean;
  powerModifier:boolean;
  defensiveMark:boolean;
  backhand:boolean;
  gallop:boolean;
  brake:boolean;
  collectHorse:boolean;
  lookBack:boolean;
  callPass:boolean;
  quickPass:boolean;
  hookMallet:boolean;
  tactics:TacticalKeyState;
  activeTactic:TacticalSlot;
  cameraZoom:number;
  cameraRecenter:boolean;
};

const gameplayCodes = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  "Space", "KeyV", "KeyQ", "KeyE", "KeyR", "KeyF", "KeyX", "Digit1", "Digit2", "Digit3", "Digit4", "Tab",
]);

const clamp = (value:number, minimum:number, maximum:number) => Math.max(minimum, Math.min(maximum, value));

export function calculateAimDirection(pointerX:number, pointerY:number, viewportWidth:number, viewportHeight:number):AimDirection {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  // The chase camera keeps the player near this lower-center screen anchor.
  const x = clamp((pointerX - width * .5) / (width * .38), -1, 1);
  const y = clamp((height * .58 - pointerY) / (height * .38), -1, 1);
  const magnitude = Math.hypot(x, y);
  return magnitude > 1 ? { x:x / magnitude, y:y / magnitude } : { x, y };
}

export function getTacticalState(keys:ReadonlySet<string>):TacticalKeyState {
  return { one:keys.has("Digit1"), two:keys.has("Digit2"), three:keys.has("Digit3"), four:keys.has("Digit4") };
}

export function getActiveTactic(tactics:TacticalKeyState):TacticalSlot {
  return tactics.one ? 1 : tactics.two ? 2 : tactics.three ? 3 : tactics.four ? 4 : null;
}

export function createInputSnapshot(
  keys:ReadonlySet<string>,
  mouseButtons:ReadonlySet<number>,
  aimDirection:AimDirection = { x:0, y:0 },
  cameraZoom = DEFAULT_CAMERA_DISTANCE,
):Input {
  const strike = mouseButtons.has(PRIMARY_MOUSE_BUTTON);
  const rideOff = mouseButtons.has(SECONDARY_MOUSE_BUTTON);
  const powerModifier = keys.has("KeyR");
  const defensiveMark = keys.has("KeyF");
  const collectHorse = keys.has("ControlLeft") || keys.has("ControlRight");
  const tactics = getTacticalState(keys);
  return {
    throttle:(keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    steer:(keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    aimX:aimDirection.x,
    aimY:aimDirection.y,
    aimDirection:{ ...aimDirection },
    strike,
    rideOff,
    focus:keys.has("Space"),
    power:powerModifier && strike,
    powerModifier,
    defensiveMark,
    backhand:false,
    gallop:keys.has("ShiftLeft") || keys.has("ShiftRight"),
    brake:collectHorse,
    collectHorse,
    lookBack:keys.has("KeyV"),
    callPass:keys.has("KeyQ"),
    quickPass:keys.has("KeyE"),
    hookMallet:keys.has("KeyX"),
    tactics,
    activeTactic:getActiveTactic(tactics),
    cameraZoom,
    cameraRecenter:mouseButtons.has(MIDDLE_MOUSE_BUTTON),
  };
}

function isInteractiveTarget(target:EventTarget|null) {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a,[role='dialog']"));
}

function publishInputState(input:Input) {
  const root = document.documentElement.dataset;
  root.poloStrike = input.strike ? "active" : "idle";
  root.poloRideOff = input.rideOff ? "active" : "idle";
  root.poloAimX = input.aimX.toFixed(3);
  root.poloAimY = input.aimY.toFixed(3);
  root.poloCameraDistance = input.cameraZoom.toFixed(2);
  root.poloCombo = input.power ? "power-strike"
    : input.defensiveMark && input.rideOff ? "defensive-mark"
      : input.gallop && input.focus ? "sprint-focus" : "none";
}

function getPublishedInputSignature(input:Input) {
  return [input.strike,input.rideOff,input.aimX.toFixed(3),input.aimY.toFixed(3),input.cameraZoom.toFixed(2),input.power,input.defensiveMark && input.rideOff,input.gallop && input.focus].join("|");
}

export function useInput(disabled = false) {
  const input = useRef<Input>(createInputSnapshot(new Set(), new Set()));
  const keys = useRef(new Set<string>());
  const mouseButtons = useRef(new Set<number>());
  const aim = useRef<AimDirection>({ x:0, y:0 });
  const cameraZoom = useRef(DEFAULT_CAMERA_DISTANCE);
  const publishedState = useRef("");

  useEffect(() => {
    if (!disabled) return;
    keys.current.clear();
    mouseButtons.current.clear();
    input.current = createInputSnapshot(keys.current, mouseButtons.current, aim.current, cameraZoom.current);
  }, [disabled]);

  useEffect(() => {
    document.documentElement.dataset.poloInputReady = "true";
    const setKey = (event:KeyboardEvent, on:boolean) => {
      if (event.code === "Escape") {
        if (on && !event.repeat) window.dispatchEvent(new Event("polo-pause"));
        event.preventDefault();
        return;
      }
      if (disabled || isInteractiveTarget(event.target)) return;
      if (gameplayCodes.has(event.code)) event.preventDefault();
      if (on) keys.current.add(event.code); else keys.current.delete(event.code);
    };
    const keyDown = (event:KeyboardEvent) => setKey(event, true);
    const keyUp = (event:KeyboardEvent) => setKey(event, false);
    const mouseDown = (event:MouseEvent) => {
      if (disabled || isInteractiveTarget(event.target)) return;
      if ([PRIMARY_MOUSE_BUTTON, MIDDLE_MOUSE_BUTTON, SECONDARY_MOUSE_BUTTON].includes(event.button)) event.preventDefault();
      mouseButtons.current.add(event.button);
      if (event.button === MIDDLE_MOUSE_BUTTON) cameraZoom.current = DEFAULT_CAMERA_DISTANCE;
    };
    const mouseUp = (event:MouseEvent) => mouseButtons.current.delete(event.button);
    const mouseMove = (event:MouseEvent) => {
      if (disabled || isInteractiveTarget(event.target)) return;
      aim.current = calculateAimDirection(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
    };
    const wheel = (event:WheelEvent) => {
      if (disabled || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      cameraZoom.current = applyCameraWheel(cameraZoom.current, event.deltaY);
    };
    const contextMenu = (event:MouseEvent) => {
      if (!disabled && !isInteractiveTarget(event.target)) event.preventDefault();
    };
    const clear = () => { keys.current.clear(); mouseButtons.current.clear(); };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("mousedown", mouseDown);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("wheel", wheel, { passive:false });
    window.addEventListener("contextmenu", contextMenu);
    window.addEventListener("blur", clear);
    return () => {
      delete document.documentElement.dataset.poloInputReady;
      for (const key of ["poloStrike","poloRideOff","poloAimX","poloAimY","poloCameraDistance","poloCombo"]) delete document.documentElement.dataset[key];
      publishedState.current = "";
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("blur", clear);
    };
  }, [disabled]);

  useEffect(() => {
    let frame = 0;
    const poll = () => {
      const next = createInputSnapshot(keys.current, mouseButtons.current, aim.current, cameraZoom.current);
      const gamepad = navigator.getGamepads?.()[0];
      if (gamepad && !disabled) {
        if (Math.abs(gamepad.axes[0] || 0) > .12) next.steer = gamepad.axes[0];
        next.throttle = Math.max(next.throttle, gamepad.buttons[7]?.value || 0);
        next.brake = next.brake || (gamepad.buttons[6]?.value || 0) > .2;
        if (Math.abs(gamepad.axes[2] || 0) > .12) next.aimX = gamepad.axes[2];
        if (Math.abs(gamepad.axes[3] || 0) > .12) next.aimY = -gamepad.axes[3];
        next.aimDirection = { x:next.aimX, y:next.aimY };
        next.strike = next.strike || Boolean(gamepad.buttons[0]?.pressed);
        next.backhand = Boolean(gamepad.buttons[1]?.pressed);
      }
      input.current = disabled ? createInputSnapshot(new Set(), new Set(), aim.current, cameraZoom.current) : next;
      const signature = getPublishedInputSignature(input.current);
      if (signature !== publishedState.current) { publishInputState(input.current); publishedState.current = signature; }
      frame = requestAnimationFrame(poll);
    };
    poll();
    return () => cancelAnimationFrame(frame);
  }, [disabled]);

  return input;
}
