import { PLAYER_COSMETIC_COLORS, PlayerProfileStore } from "../services/PlayerProfile";

export function getPlayerAvatarCosmetics(){const profile=PlayerProfileStore.get();return{coat:PLAYER_COSMETIC_COLORS[profile.equippedCoat],mallet:PLAYER_COSMETIC_COLORS[profile.equippedMallet],coatId:profile.equippedCoat,malletId:profile.equippedMallet};}

/** Shared mobile-to-rider vector mapping: X steers like A/D, Y throttles like W/S. */
export function touchToPlayerAvatarVector(x:number,y:number){return{steer:Math.max(-1,Math.min(1,x)),throttle:Math.max(-1,Math.min(1,-y))};}
