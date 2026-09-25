import { PLAYER_COSMETIC_COLORS, PlayerProfileStore } from "../services/PlayerProfile";

export function getPlayerAvatarCosmetics(){const profile=PlayerProfileStore.get();return{coat:PLAYER_COSMETIC_COLORS[profile.equippedCoat],mallet:PLAYER_COSMETIC_COLORS[profile.equippedMallet],coatId:profile.equippedCoat,malletId:profile.equippedMallet};}
