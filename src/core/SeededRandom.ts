/**
 * src/core/SeededRandom.ts
 * ─────────────────────────────────────────────────────────────
 * Deterministic PRNG using Mulberry32 algorithm.
 * Guarantees identical procedural city generation for the same seed.
 * Supports daily seeds and dynamic city remixes.
 * ─────────────────────────────────────────────────────────────
 */

export class SeededRandom {
  private s: number;

  constructor(seed: number = 1337) {
    this.s = seed >>> 0;
  }

  /**
   * Set new seed.
   */
  setSeed(seed: number): void {
    this.s = seed >>> 0;
  }

  /**
   * Generates pseudo-random float in [0, 1).
   */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Float in range [min, max).
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Integer in range [min, max] inclusive.
   */
  rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Random item from array.
   */
  choice<T>(array: readonly T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Generates a deterministic daily integer seed based on local YYYYMMDD.
   */
  static getDailySeed(): number {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    return y * 10000 + m * 100 + d;
  }
}
