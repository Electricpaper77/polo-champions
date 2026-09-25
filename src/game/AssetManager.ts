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
  const model = await gltfLoader.loadAsync(url);
  preparePbrModel(model);
}

/** Replaces reflection-prone authored PBR surfaces with brightly lit Lambert materials. */
export function preparePbrModel(model: GLTF): GLTF {
  model.scene.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (child.userData.lambertPrepared) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const lambert = materials.map(material => {
      const source = material as THREE.MeshStandardMaterial;
      return new THREE.MeshLambertMaterial({ color: source.color ?? 0x5c4033, map: source.map ?? null });
    });
    child.material = Array.isArray(child.material) ? lambert : lambert[0];
    child.userData.lambertPrepared = true;
  });
  return model;
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
  return preparePbrModel(useGLTF(GAME_MODEL_URLS.horse) as unknown as GLTF);
}

export function useRiderModel(): GLTF {
  return preparePbrModel(useGLTF(GAME_MODEL_URLS.rider) as unknown as GLTF);
}
