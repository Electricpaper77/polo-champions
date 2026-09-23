import { emptyCommand, type PlayerCommand } from "./PlayerOwnership";
export const GAMEPAD_DEAD_ZONE = .15;
export const deadZone = (value:number) => Math.abs(value) < GAMEPAD_DEAD_ZONE ? 0 : Math.sign(value) * ((Math.abs(value)-GAMEPAD_DEAD_ZONE)/(1-GAMEPAD_DEAD_ZONE));
export const trigger = (value:number|undefined) => Math.max(0,Math.min(1,Number.isFinite(value) ? value! : 0));
export type GamepadLike={connected?:boolean;axes?:number[];buttons?:Array<{pressed?:boolean;value?:number}>};
export function commandFromGamepad(gamepad?:GamepadLike|null):PlayerCommand { if(!gamepad?.connected)return emptyCommand(); const b=(n:number)=>gamepad.buttons?.[n]; return {steer:deadZone(gamepad.axes?.[0]??0),throttle:trigger(b(7)?.value),brake:trigger(b(6)?.value),strike:!!b(0)?.pressed,pass:!!b(2)?.pressed,rideOff:!!b(1)?.pressed}; }
