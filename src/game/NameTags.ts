import { useFrame, useThree } from "@react-three/fiber";
import { createElement, useEffect, useMemo } from "react";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export function NameTag({ name }: { name: string }) {
  const object = useMemo(() => { const element = document.createElement("div"); element.className = "player-name-tag"; element.textContent = name; const tag = new CSS2DObject(element); tag.position.set(0, 2.9, 0); return tag; }, [name]);
  return createElement("primitive", { object });
}

/** DOM labels render above the WebGL canvas without taking part in post-processing. */
export function NameTagRenderer() {
  const { gl, scene, camera, size } = useThree();
  const renderer = useMemo(() => new CSS2DRenderer(), []);
  useEffect(() => { renderer.setSize(size.width, size.height); }, [renderer, size]);
  useEffect(() => { const parent = gl.domElement.parentElement; renderer.domElement.style.position = "absolute"; renderer.domElement.style.inset = "0"; renderer.domElement.style.pointerEvents = "none"; parent?.appendChild(renderer.domElement); return () => renderer.domElement.remove(); }, [renderer, gl]);
  useFrame(() => renderer.render(scene, camera), 2);
  return null;
}
