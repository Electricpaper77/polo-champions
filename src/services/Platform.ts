export type PlatformUser = { id: string; displayName: string; level: number; xp: number; xpNext: number; gold: number; tokens: number };
export type PlatformFriend = { id: string; displayName: string; status: "online" | "in_match" };

export class PlatformManager {
  private static instance: PlatformManager;
  static getInstance() { return this.instance ??= new PlatformManager(); }
  async initializePlatform() { await delay(80); return { steamworks: "mock", eos: "mock" } as const; }
  async authenticateUser(): Promise<PlatformUser> { await delay(80); return { id: "local-polo-1", displayName: "POLOPLAYER1", level: 12, xp: 670, xpNext: 1000, gold: 1240, tokens: 8650 }; }
  async fetchUserFriends(): Promise<PlatformFriend[]> { await delay(50); return [{ id: "friend-1", displayName: "StableMaster", status: "online" }, { id: "friend-2", displayName: "BlueNo2", status: "in_match" }]; }
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
export const platform = PlatformManager.getInstance();
