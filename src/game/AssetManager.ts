import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export const GAME_MODEL_URLS = {
  horse: "/models/horse.glb",
  rider: "/models/rider.glb",
} as const;

export type GameModelKey = keyof typeof GAME_MODEL_URLS;
export type AssetLoader = (url: string) => Promise<unknown>;

const assetPromises = new Map<string, Promise<void>>();
const resolvedAssets = new Set<string>();
const gltfLoader = new GLTFLoader();
THREE.Cache.enabled = true;

async function loadAsset(url: string): Promise<void> {
  await gltfLoader.loadAsync(url);
}

export function preloadAsset(url: string, loader: AssetLoader = loadAsset): Promise<void> {
  const cached = assetPromises.get(url);
  if (cached) return cached;
  const promise = loader(url).then(() => { resolvedAssets.add(url); }).catch(error => {
    assetPromises.delete(url);
    resolvedAssets.delete(url);
    throw error;
  });
  assetPromises.set(url, promise);
  return promise;
}

export function preloadGameAssets(loader: AssetLoader = loadAsset): Promise<void> {
  return Promise.all(Object.values(GAME_MODEL_URLS).map(url => preloadAsset(url, loader))).then(() => {
    if (loader === loadAsset && typeof window !== "undefined") {
      Object.values(GAME_MODEL_URLS).forEach(url => useGLTF.preload(url));
    }
  });
}

export function isGameAssetReady(key: GameModelKey): boolean {
  return resolvedAssets.has(GAME_MODEL_URLS[key]);
}

export function clearAssetCacheForTests(): void {
  assetPromises.clear();
  resolvedAssets.clear();
}

export function useHorseModel(): GLTF {
  return useGLTF(GAME_MODEL_URLS.horse) as unknown as GLTF;
}

export function useRiderModel(): GLTF {
  return useGLTF(GAME_MODEL_URLS.rider) as unknown as GLTF;
}
