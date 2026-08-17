import type { Input } from "./InputManager";

export type PlayerCombos = {
  sprintFocus:boolean;
  powerStrike:boolean;
  defensiveMark:boolean;
};

export function getPlayerCombos(input:Pick<Input,"gallop"|"focus"|"powerModifier"|"strike"|"defensiveMark"|"rideOff">):PlayerCombos {
  return {
    sprintFocus:input.gallop && input.focus,
    powerStrike:input.powerModifier && input.strike,
    defensiveMark:input.defensiveMark && input.rideOff,
  };
}

export function getEffectiveSwingCharge(charge:number, powerStrike:boolean) {
  const base = Math.max(0, Math.min(1, charge));
  return powerStrike ? Math.min(1.5, base * 1.5) : base;
}
