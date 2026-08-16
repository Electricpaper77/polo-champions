import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearAssetCacheForTests, GAME_MODEL_URLS, isGameAssetReady, preloadGameAssets } from "../src/game/AssetManager";
import { selectLocomotionState } from "../src/game/AnimationController";

test("asset manager resolves and caches every GLB before match initialization", async () => {
  clearAssetCacheForTests();
  const calls: string[] = [];
  const loader = async (url: string) => { calls.push(url); await Promise.resolve(); };
  await Promise.all([preloadGameAssets(loader), preloadGameAssets(loader)]);
  expect(calls.sort()).toEqual(Object.values(GAME_MODEL_URLS).sort());
  expect(isGameAssetReady("horse")).toBe(true);
  expect(isGameAssetReady("rider")).toBe(true);
});

test("bundled model files are binary GLB assets", async () => {
  for (const url of Object.values(GAME_MODEL_URLS)) {
    const data = await readFile(resolve(process.cwd(), "public", url.replace("/models/", "models/")));
    expect(data.subarray(0, 4).toString("utf8")).toBe("glTF");
    expect(data.byteLength).toBeGreaterThan(100_000);
  }
});

test("skeletal locomotion thresholds are deterministic", () => {
  expect(selectLocomotionState(0)).toBe("IDLE");
  expect(selectLocomotionState(0.05)).toBe("IDLE");
  expect(selectLocomotionState(0.051)).toBe("TROT");
  expect(selectLocomotionState(15)).toBe("TROT");
  expect(selectLocomotionState(15.01)).toBe("GALLOP");
});
