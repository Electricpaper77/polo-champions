export type PlayerId = "p1" | "p2";
export type RiderId = "blue1" | "blue2" | "red1" | "red2";
export type PlayerCommand = { steer:number; throttle:number; brake:number; strike:boolean; pass:boolean; rideOff:boolean };
export const LOCAL_OWNERSHIP: Record<RiderId, PlayerId | "ai"> = { blue1:"p1", red1:"p2", blue2:"ai", red2:"ai" };
export const emptyCommand = (): PlayerCommand => ({ steer:0, throttle:0, brake:0, strike:false, pass:false, rideOff:false });
export function commandForRider(rider: RiderId, commands: Partial<Record<PlayerId, PlayerCommand>>) { const owner=LOCAL_OWNERSHIP[rider]; return owner === "ai" ? undefined : commands[owner] ?? emptyCommand(); }
