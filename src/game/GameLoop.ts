export type SimulationStep = (fixedDelta: number, tick: number) => void;
export type NetworkStep = (tick: number) => void;

export class FixedTimestepLoop {
  readonly fixedDelta: number;
  readonly networkIntervalTicks: number;
  private accumulator = 0;
  private tick = 0;

  constructor(simulationHz = 60, networkHz = 20) {
    if (simulationHz <= 0 || networkHz <= 0 || simulationHz % networkHz !== 0) throw new Error("Simulation Hz must be a positive multiple of network Hz");
    this.fixedDelta = 1 / simulationHz;
    this.networkIntervalTicks = simulationHz / networkHz;
  }

  advance(frameDelta: number, simulate: SimulationStep, broadcast?: NetworkStep): number {
    this.accumulator += Math.min(Math.max(frameDelta, 0), 0.25);
    while (this.accumulator >= this.fixedDelta) {
      this.tick += 1;
      simulate(this.fixedDelta, this.tick);
      if (broadcast && this.tick % this.networkIntervalTicks === 0) broadcast(this.tick);
      this.accumulator -= this.fixedDelta;
    }
    return this.accumulator / this.fixedDelta;
  }

  reset(): void { this.accumulator = 0; this.tick = 0; }
  currentTick(): number { return this.tick; }
}
