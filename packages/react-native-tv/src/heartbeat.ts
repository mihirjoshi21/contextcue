/**
 * Decides when a session heartbeat should actually go out: at most once per `intervalMs`,
 * but immediately on a play/pause transition so the server sees pauses promptly.
 * Pure (clock passed in).
 */
export class HeartbeatThrottle {
  private lastSentAt: number | null = null;
  private lastPlaying: boolean | null = null;

  constructor(private readonly intervalMs: number) {}

  shouldSend(now: number, playing: boolean): boolean {
    const changed = this.lastPlaying !== null && this.lastPlaying !== playing;
    const elapsed = this.lastSentAt === null || now - this.lastSentAt >= this.intervalMs;
    return changed || elapsed;
  }

  markSent(now: number, playing: boolean): void {
    this.lastSentAt = now;
    this.lastPlaying = playing;
  }

  reset(): void {
    this.lastSentAt = null;
    this.lastPlaying = null;
  }
}
