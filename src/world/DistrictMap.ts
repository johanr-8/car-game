/**
 * src/world/DistrictMap.ts
 * ─────────────────────────────────────────────────────────────
 * Seeded Procedural Urban District Classification Engine.
 *
 * Districts:
 *   - DOWNTOWN: High-rise skyscrapers (glass, concrete, steel) at city center
 *   - MIDRISE: Commercial offices, stores, plazas (concrete, brick, glass)
 *   - SUBURBAN: Low-rise residential houses with front lawns & driveways
 *   - INDUSTRIAL: Warehouses, distribution centers, logistics bays
 *   - PARK: Urban green spaces with walking paths and dense tree canopies
 *   - OPEN_GREEN: Expansive contiguous nature reserve with rolling hills
 *
 * RULES.md: Seeded determinism. Zero per-frame allocations.
 * ─────────────────────────────────────────────────────────────
 */
import type { WorldSpec } from './WorldConfig';

export enum DistrictType {
  DOWNTOWN = 'DOWNTOWN',
  MIDRISE = 'MIDRISE',
  SUBURBAN = 'SUBURBAN',
  INDUSTRIAL = 'INDUSTRIAL',
  PARK = 'PARK',
  OPEN_GREEN = 'OPEN_GREEN',
}

export enum BuildingStyle {
  GLASS = 'GLASS',
  CONCRETE = 'CONCRETE',
  BRICK = 'BRICK',
  STEEL = 'STEEL',
  WAREHOUSE = 'WAREHOUSE',
  HOUSE = 'HOUSE',
}

export interface DistrictConfig {
  type: DistrictType;
  label: string;
  minHeight: number;
  maxHeight: number;
  minLotSize: number;
  maxLotSize: number;
  setback: number;
  styles: BuildingStyle[];
  hasBuildings: boolean;
  treeDensity: number; // 0..1
  lampSpacing: number; // meters along road
}

export const DISTRICT_CONFIGS: Record<DistrictType, DistrictConfig> = {
  [DistrictType.DOWNTOWN]: {
    type: DistrictType.DOWNTOWN,
    label: 'Downtown Metropolis',
    minHeight: 65,
    maxHeight: 145,
    minLotSize: 26,
    maxLotSize: 36,
    setback: 4,
    styles: [BuildingStyle.GLASS, BuildingStyle.STEEL, BuildingStyle.CONCRETE],
    hasBuildings: true,
    treeDensity: 0.15,
    lampSpacing: 32,
  },
  [DistrictType.MIDRISE]: {
    type: DistrictType.MIDRISE,
    label: 'Midrise Commercial',
    minHeight: 22,
    maxHeight: 52,
    minLotSize: 20,
    maxLotSize: 28,
    setback: 4,
    styles: [BuildingStyle.CONCRETE, BuildingStyle.BRICK, BuildingStyle.GLASS],
    hasBuildings: true,
    treeDensity: 0.25,
    lampSpacing: 36,
  },
  [DistrictType.SUBURBAN]: {
    type: DistrictType.SUBURBAN,
    label: 'Suburban Residential',
    minHeight: 6,
    maxHeight: 11,
    minLotSize: 14,
    maxLotSize: 18,
    setback: 6,
    styles: [BuildingStyle.HOUSE, BuildingStyle.BRICK],
    hasBuildings: true,
    treeDensity: 0.65,
    lampSpacing: 48,
  },
  [DistrictType.INDUSTRIAL]: {
    type: DistrictType.INDUSTRIAL,
    label: 'Industrial & Freight',
    minHeight: 10,
    maxHeight: 18,
    minLotSize: 32,
    maxLotSize: 46,
    setback: 8,
    styles: [BuildingStyle.WAREHOUSE, BuildingStyle.CONCRETE],
    hasBuildings: true,
    treeDensity: 0.10,
    lampSpacing: 52,
  },
  [DistrictType.PARK]: {
    type: DistrictType.PARK,
    label: 'Urban Central Park',
    minHeight: 0,
    maxHeight: 0,
    minLotSize: 0,
    maxLotSize: 0,
    setback: 0,
    styles: [],
    hasBuildings: false,
    treeDensity: 0.85,
    lampSpacing: 36,
  },
  [DistrictType.OPEN_GREEN]: {
    type: DistrictType.OPEN_GREEN,
    label: 'Open Green Nature Reserve',
    minHeight: 0,
    maxHeight: 0,
    minLotSize: 0,
    maxLotSize: 0,
    setback: 0,
    styles: [],
    hasBuildings: false,
    treeDensity: 0.40,
    lampSpacing: 64,
  },
};

// ── Low-Frequency Deterministic Permutation Noise ────────────
class DistrictNoise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    let state = (seed ^ 0x9e3779b9) % 2147483647;
    if (state <= 0) state += 2147483646;

    for (let i = 255; i > 0; i--) {
      state = (state * 16807) % 2147483647;
      const j = Math.floor(((state - 1) / 2147483646) * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }

    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, z: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : z;
    const v = h < 4 ? z : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  sample(x: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Z = Math.floor(z) & 255;

    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);

    const u = this.fade(xf);
    const v = this.fade(zf);

    const aa = this.perm[this.perm[X] + Z];
    const ab = this.perm[this.perm[X] + Z + 1];
    const ba = this.perm[this.perm[X + 1] + Z];
    const bb = this.perm[this.perm[X + 1] + Z + 1];

    const x1 = this.lerp(this.grad(aa, xf, zf), this.grad(ba, xf - 1, zf), u);
    const x2 = this.lerp(this.grad(ab, xf, zf - 1), this.grad(bb, xf - 1, zf - 1), u);

    return this.lerp(x1, x2, v);
  }
}

export class DistrictMap {
  readonly spec: WorldSpec;
  private readonly noise: DistrictNoise2D;

  constructor(spec: WorldSpec) {
    this.spec = spec;
    this.noise = new DistrictNoise2D(spec.seed + 101);
  }

  /**
   * Returns the district classification at world coordinates (x, z).
   */
  getDistrictAt(x: number, z: number): DistrictType {
    const distSq = x * x + z * z;
    const r = Math.sqrt(distSq);

    // 1. Downtown High-Rises: Centered on map with slight organic boundary noise
    const downtownBoundary = 400 + this.noise.sample(x * 0.003, z * 0.003) * 80;
    if (r < downtownBoundary) {
      return DistrictType.DOWNTOWN;
    }

    // 2. Open Green Area: One vast continuous nature reserve in the Northwest sector
    // Bound to northwest region (x < -320 and z < -320) beyond inner city
    if (x < -350 && z < -350 && r > 550) {
      return DistrictType.OPEN_GREEN;
    }

    // 3. Multi-regional low-frequency district assignment
    const n = this.noise.sample(x * 0.0012 + 150, z * 0.0012 + 250);

    // Transitional inner ring (400m - 750m)
    if (r < 750) {
      if (n > 0.35) return DistrictType.PARK;
      if (n > -0.20) return DistrictType.MIDRISE;
      return DistrictType.SUBURBAN;
    }

    // Outer sectors (750m+)
    if (n > 0.45) return DistrictType.PARK;
    if (n > 0.10) return DistrictType.INDUSTRIAL;
    if (n > -0.35) return DistrictType.SUBURBAN;
    return DistrictType.MIDRISE;
  }

  /**
   * Returns the complete district configuration for (x, z).
   */
  getConfigAt(x: number, z: number): DistrictConfig {
    return DISTRICT_CONFIGS[this.getDistrictAt(x, z)];
  }
}
