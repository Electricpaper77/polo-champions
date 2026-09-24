/** Dependency-free, gesture-safe WebAudio presentation layer. It never drives gameplay. */
class AudioEngineService {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private gallopTimer: number | null = null;
  private ambient: AudioBufferSourceNode | null = null;
  private muted = false;

  get isMuted() { return this.muted; }
  toggleMuted() { this.muted = !this.muted; this.master?.gain.setTargetAtTime(this.muted ? 0 : .55, this.context!.currentTime, .03); return this.muted; }
  resume() { const context = this.ensure(); return context?.resume(); }

  syncGallop(speed: number) {
    const context = this.ensure(); if (!context || this.muted) return;
    const interval = Math.max(115, 390 - Math.min(Math.abs(speed), 18) * 14);
    if (speed < .35) { this.stopGallop(); return; }
    if (this.gallopTimer !== null) return;
    const beat = () => { this.hoofbeat(); this.gallopTimer = window.setTimeout(beat, interval); };
    beat();
  }
  stopGallop() { if (this.gallopTimer !== null) window.clearTimeout(this.gallopTimer); this.gallopTimer = null; }
  playMalletStrike(speed: number) { const context = this.ensure(); if (!context || this.muted) return; const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.type = "square"; oscillator.frequency.setValueAtTime(170 + Math.min(speed, 25) * 19, context.currentTime); gain.gain.setValueAtTime(.16, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .09); oscillator.connect(gain).connect(this.master!); oscillator.start(); oscillator.stop(context.currentTime + .1); }
  playGoalHorn() { this.tone(392, .35, .2, "sawtooth"); this.tone(523, .35, .14, "sawtooth", .12); }
  playWhistle() { this.tone(1760, .16, .09, "sine"); }
  startAmbientCrowd() {
    const context = this.ensure(); if (!context || this.ambient || this.muted) return;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * .12;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain(); source.buffer = buffer; source.loop = true; filter.type = "bandpass"; filter.frequency.value = 520; gain.gain.value = .055; source.connect(filter).connect(gain).connect(this.master!); source.start(); this.ambient = source;
  }
  private ensure() {
    if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
    if (!this.context) { this.context = new AudioContext(); this.master = this.context.createGain(); this.master.gain.value = .55; this.master.connect(this.context.destination); }
    return this.context;
  }
  private hoofbeat() { this.tone(68, .06, .12, "triangle"); }
  private tone(frequency: number, duration: number, volume: number, type: OscillatorType, delay = 0) { const context = this.ensure(); if (!context || this.muted) return; const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + delay; oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start); gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(.001, start + duration); oscillator.connect(gain).connect(this.master!); oscillator.start(start); oscillator.stop(start + duration + .02); }
}

export const AudioEngine = new AudioEngineService();
