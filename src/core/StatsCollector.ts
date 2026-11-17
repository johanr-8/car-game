/**
 * src/core/StatsCollector.ts
 * Collects FPS, frame time, physics tick count per frame.
 * Keeps a rolling window for smoothing — no per-frame allocs.
 */
export class StatsCollector {
  private readonly WINDOW = 60;
  private frameTimes: Float32Array;
  private head = 0;
  private filled = 0;

  /** Physics ticks executed in the most recently rendered frame. */
  ticksThisFrame = 0;

  /** Gravity direction as a formatted string — set externally. */
  gravityLabel = '(0, -1, 0)';

  constructor() {
    this.frameTimes = new Float32Array(this.WINDOW);
  }

  record(dtMs: number): void {
    this.frameTimes[this.head] = dtMs;
    this.head = (this.head + 1) % this.WINDOW;
    if (this.filled < this.WINDOW) this.filled++;
  }

  get avgFrameMs(): number {
    if (this.filled === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.frameTimes[i];
    return sum / this.filled;
  }

  get fps(): number {
    const ms = this.avgFrameMs;
    return ms > 0 ? 1000 / ms : 0;
  }
}
