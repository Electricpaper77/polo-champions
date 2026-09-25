export type CoreSound = "gallop_dirt" | "mallet_swing" | "wood_hit" | "referee_whistle" | "crowd_cheer";

const SOUND_FILES: Record<CoreSound, string> = {
  gallop_dirt: "/audio/gallop_dirt.mp3",
  mallet_swing: "/audio/mallet_swing.mp3",
  wood_hit: "/audio/wood_hit.mp3",
  referee_whistle: "/audio/referee_whistle.mp3",
  crowd_cheer: "/audio/crowd_cheer.mp3",
};

type Point = { x: number; y: number; z: number };

/** Asset-ready stadium audio mixer. It never affects gameplay or match timing. */
class SpatialAudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<CoreSound, AudioBuffer>();
  private emitters = new Map<string, PannerNode>();
  private gallopClock = new Map<string, number>();
  private ambient: AudioBufferSourceNode | null = null;
  private threeListener: THREE.AudioListener | null = null;
  private muted = false;

  attachThreeListener(camera: THREE.Camera) { if (!this.threeListener) { this.threeListener = new THREE.AudioListener(); camera.add(this.threeListener); this.threeListener.setMasterVolume(.45); } }
  setMasterVolume(value:number) { const volume=Math.max(0,Math.min(1,value)); this.master?.gain.setTargetAtTime(this.muted?0:volume,this.context?.currentTime??0,.03); this.threeListener?.setMasterVolume(this.muted?0:volume); }
  toggleMute(){this.muted=!this.muted;this.setMasterVolume(.45);return this.muted}
  isMuted(){return this.muted}
  playUi(sound:"click"|"start"|"goal"){this.play(sound==="click"?"mallet_swing":sound==="start"?"referee_whistle":"crowd_cheer");}

  async unlock() {
    const context = this.ensure();
    if (!context) return;
    if (context.state === "suspended") await context.resume();
    void this.preload();
    this.startAmbient();
  }

  async preload() {
    const context = this.ensure();
    if (!context) return;
    await Promise.all((Object.keys(SOUND_FILES) as CoreSound[]).map(async sound => {
      if (this.buffers.has(sound)) return;
      try {
        const response = await fetch(SOUND_FILES[sound]);
        if (!response.ok) return;
        this.buffers.set(sound, await context.decodeAudioData(await response.arrayBuffer()));
      } catch { /* Audio files are optional during procedural-development builds. */ }
    }));
  }

  setListenerPosition(position: Point) {
    const listener = this.context?.listener;
    if (!listener || !this.context) return;
    listener.positionX.setValueAtTime(position.x, this.context.currentTime);
    listener.positionY.setValueAtTime(position.y, this.context.currentTime);
    listener.positionZ.setValueAtTime(position.z, this.context.currentTime);
  }

  setEmitterPosition(id: string, position: Point) {
    const panner = this.context ? this.emitter(id) : null;
    if (!panner || !this.context) return;
    panner.positionX.setValueAtTime(position.x, this.context.currentTime);
    panner.positionY.setValueAtTime(position.y, this.context.currentTime);
    panner.positionZ.setValueAtTime(position.z, this.context.currentTime);
  }

  play(sound: CoreSound, emitterId?: string, playbackRate = 1) {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const buffer = this.buffers.get(sound), destination = emitterId ? this.emitter(emitterId) : this.master;
    if (buffer && destination) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      source.connect(destination);
      source.start();
      return;
    }
    this.fallback(sound, destination ?? this.master, playbackRate);
  }

  syncGallop(emitterId: string, speed: number) {
    if (!this.context || this.context.state !== "running" || speed < .5) return;
    const now = performance.now(), interval = Math.max(95, 360 - Math.min(speed, 45) * 5);
    if ((this.gallopClock.get(emitterId) ?? 0) > now - interval) return;
    this.gallopClock.set(emitterId, now);
    this.play("gallop_dirt", emitterId, .75 + Math.min(speed, 45) / 28);
  }

  private ensure() {
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = .45;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private emitter(id: string) {
    const context = this.ensure();
    if (!context || !this.master) return null;
    let panner = this.emitters.get(id);
    if (!panner) {
      panner = context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2;
      panner.maxDistance = 90;
      panner.rolloffFactor = 1.1;
      panner.connect(this.master);
      this.emitters.set(id, panner);
    }
    return panner;
  }

  private startAmbient() {
    if (this.ambient || !this.context || !this.master) return;
    const context = this.context, buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * .05;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = buffer; source.loop = true; filter.type = "bandpass"; filter.frequency.value = 620; gain.gain.value = .09;
    source.connect(filter).connect(gain).connect(this.master); source.start(); this.ambient = source;
  }

  private fallback(sound: CoreSound, destination: AudioNode | null, rate: number) {
    if (!this.context || !destination) return;
    const tone: Record<CoreSound, number> = { gallop_dirt: 72, mallet_swing: 250, wood_hit: 138, referee_whistle: 1760, crowd_cheer: 330 };
    const oscillator = this.context.createOscillator(), gain = this.context.createGain(), start = this.context.currentTime;
    oscillator.type = sound === "wood_hit" ? "square" : sound === "crowd_cheer" ? "sawtooth" : "triangle";
    oscillator.frequency.value = tone[sound] * rate; gain.gain.setValueAtTime(sound === "crowd_cheer" ? .025 : .12, start); gain.gain.exponentialRampToValueAtTime(.001, start + .12);
    oscillator.connect(gain).connect(destination); oscillator.start(start); oscillator.stop(start + .14);
  }
}

export const AudioManager = new SpatialAudioManager();
import * as THREE from "three";
