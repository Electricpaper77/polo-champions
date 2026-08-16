import * as THREE from "three";

export type LocomotionState = "IDLE" | "TROT" | "GALLOP";
export type EntityActionState = "NONE" | "WIND_UP" | "STRIKE" | "RIDE_OFF_BRACE";

export function selectLocomotionState(speed: number): LocomotionState {
  if (speed <= 0.05) return "IDLE";
  if (speed <= 15) return "TROT";
  return "GALLOP";
}

function findClip(clips: THREE.AnimationClip[], names: string[]): THREE.AnimationClip | undefined {
  return clips.find(clip => names.some(name => clip.name.toLowerCase().includes(name)));
}

export class AnimationController {
  private readonly mixer: THREE.AnimationMixer;
  private readonly locomotion = new Map<LocomotionState, THREE.AnimationAction>();
  private readonly actions = new Map<Exclude<EntityActionState, "NONE">, THREE.AnimationAction>();
  private activeLocomotion: THREE.AnimationAction | null = null;
  private activeAction: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const idle = findClip(clips, ["idle", "stand"]);
    const trot = findClip(clips, ["trot", "walk", "canter"]);
    const gallop = findClip(clips, ["gallop", "run"]);
    const fallback = clips[0];
    if (idle ?? fallback) this.locomotion.set("IDLE", this.mixer.clipAction(idle ?? fallback));
    if (trot ?? fallback) this.locomotion.set("TROT", this.mixer.clipAction(trot ?? fallback));
    if (gallop ?? trot ?? fallback) this.locomotion.set("GALLOP", this.mixer.clipAction(gallop ?? trot ?? fallback));

    const actionClips: Array<[Exclude<EntityActionState, "NONE">, string[]]> = [
      ["WIND_UP", ["wind", "charge", "working"]],
      ["STRIKE", ["strike", "attack", "swing", "punch"]],
      ["RIDE_OFF_BRACE", ["brace", "push", "block"]],
    ];
    actionClips.forEach(([state, names]) => {
      const clip = findClip(clips, names);
      if (!clip) return;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      this.actions.set(state, action);
    });
  }

  update(velocity: { x: number; z: number }, delta: number, actionState: EntityActionState = "NONE"): LocomotionState {
    const speed = Math.hypot(velocity.x, velocity.z);
    const state = selectLocomotionState(speed);
    const next = this.locomotion.get(state) ?? null;
    if (next && next !== this.activeLocomotion) {
      next.reset().fadeIn(0.22).play();
      this.activeLocomotion?.fadeOut(0.22);
      this.activeLocomotion = next;
    }
    if (this.activeLocomotion) {
      this.activeLocomotion.timeScale = state === "GALLOP" ? THREE.MathUtils.clamp(speed / 18, 0.85, 1.65) : THREE.MathUtils.clamp(speed / 8, 0.65, 1.35);
    }
    const overlay = actionState === "NONE" ? null : this.actions.get(actionState) ?? null;
    if (overlay && overlay !== this.activeAction) {
      this.activeAction?.fadeOut(0.1);
      overlay.reset().fadeIn(0.08).play();
      this.activeAction = overlay;
    } else if (actionState === "NONE" && this.activeAction) {
      this.activeAction.fadeOut(0.12);
      this.activeAction = null;
    }
    this.mixer.update(delta);
    return state;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
