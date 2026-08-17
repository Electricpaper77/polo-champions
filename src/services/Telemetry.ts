export type MatchTelemetryBatch = {
  matchId: string;
  matchCompletions: 1;
  averageClientPingMs: number | null;
  aiBackfillTriggers: number;
  completedAt: number;
};

export type TelemetrySink = (batch: MatchTelemetryBatch) => void;

export class TelemetryService {
  private matchId: string | null = null;
  private pings: number[] = [];
  private aiBackfillTriggers = 0;
  private completed = false;

  constructor(private readonly sink: TelemetrySink = batch => console.info("[PoloTelemetry]", JSON.stringify(batch))) {}

  startMatch(matchId: string) {
    if (this.matchId === matchId && !this.completed) return;
    this.matchId = matchId;
    this.pings = [];
    this.aiBackfillTriggers = 0;
    this.completed = false;
  }

  recordPing(pingMs: number) {
    if (!this.matchId || this.completed || !Number.isFinite(pingMs)) return;
    this.pings.push(Math.max(0, pingMs));
  }

  recordAIBackfill() {
    if (!this.matchId || this.completed) return;
    this.aiBackfillTriggers += 1;
  }

  completeMatch(completedAt = Date.now()): MatchTelemetryBatch | null {
    if (!this.matchId || this.completed) return null;
    const averageClientPingMs = this.pings.length
      ? Math.round(this.pings.reduce((total, ping) => total + ping, 0) / this.pings.length)
      : null;
    const batch: MatchTelemetryBatch = {
      matchId: this.matchId,
      matchCompletions: 1,
      averageClientPingMs,
      aiBackfillTriggers: this.aiBackfillTriggers,
      completedAt,
    };
    this.completed = true;
    this.sink(batch);
    return batch;
  }

  resetForTests() {
    this.matchId = null;
    this.pings = [];
    this.aiBackfillTriggers = 0;
    this.completed = false;
  }
}

export const matchTelemetry = new TelemetryService();
