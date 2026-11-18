/**
 * src/world/Landforms.ts
 * ─────────────────────────────────────────────────────────────
 * Pure Procedural Macro Landform & Biome Engine.
 *
 * Capabilities:
 *   - Completely independent from roads (zero road dependencies)
 *   - Config-driven macro landform shape (WorldConfig):
 *       * West coastline with sea level at y = 0
 *       * Broad flat city basin near the center (y ~ 20m)
 *       * Rolling hills (15-40m)
 *       * Scenic lake valley and river
 *       * Northeast mountain ridge with alpine peaks near 180m and a drivable pass (y ~ 48m)
 *   - Multi-octave continuous seeded gradient noise: unique terrain everywhere
 *   - Biomes: BEACH, MEADOW, FOREST, ROCK, URBAN
 *   - Analytic slope and unit normal calculations
 *
 * RULES.md: Seeded determinism. Zero per-tick heap allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import {
  type WorldSpec,
  type MacroLandformConfig,
  DEFAULT_WORLD_SPEC,
  DEFAULT_MACRO_LANDFORMS,
  BiomeType,
} from './WorldConfig';

// ── Deterministic 2D Gradient Noise Generator ────────────────
class SeededGradientNoise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Fisher-Yates shuffle with seeded 31-bit LCG
    let state = (seed ^ 0x6c62272e) % 2147483647;
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class Landforms {
  readonly spec: WorldSpec;
  readonly config: MacroLandformConfig;
  private readonly noise: SeededGradientNoise2D;
  private readonly moistureNoise: SeededGradientNoise2D;
  private readonly ridgeNoise: SeededGradientNoise2D;

  constructor(spec: WorldSpec = DEFAULT_WORLD_SPEC) {
    this.spec = spec;
    this.config = spec.macroLandforms ?? DEFAULT_MACRO_LANDFORMS;
    this.noise = new SeededGradientNoise2D(spec.seed);
    this.moistureNoise = new SeededGradientNoise2D(spec.seed + 1013);
    this.ridgeNoise = new SeededGradientNoise2D(spec.seed + 2027);
  }

  /**
   * Evaluates pure landform elevation at world coordinate (x, z).
   * Completely independent from road network. Microsecond evaluation.
   */
  getHeight(x: number, z: number): number {
    const cfg = this.config;

    // ── 1. Coastline along West Edge ─────────────────────────
    const coastX = cfg.coastStartX + 120 * Math.sin(z * 0.0022 + 0.4) + 65 * Math.cos(z * 0.0051);

    // Seaward (West of coast) -> drops below sea level (y = 0)
    if (x < coastX) {
      const dSea = coastX - x;
      // Gentle beach shoals right at waterline
      if (dSea < 35.0) {
        return -dSea * 0.035;
      }
      // Continental drop to ocean floor (~ -18m)
      const t = Math.min(1.0, (dSea - 35.0) / 450.0);
      return -1.2 + t * t * (3 - 2 * t) * (cfg.oceanFloorDepth + 1.2);
    }

    // Inland distance from coast
    const dInland = x - coastX;

    // ── 2. Multi-Octave Layered Rolling Hills Noise ───────────
    const n1 = this.noise.sample(x / 550, z / 550) * 0.58;
    const n2 = this.noise.sample(x / 220 + 31.4, z / 220 + 17.8) * 0.26;
    const n3 = this.noise.sample(x / 85 + 71.2, z / 85 + 53.1) * 0.12;
    const n4 = this.noise.sample(x / 28 + 11.7, z / 28 + 93.4) * 0.04;
    const hillsNoise = (n1 + n2 + n3 + n4); // roughly [-0.7, 0.7]

    // Base rolling hills elevation (15-40m amplitude)
    let h = 26.0 + hillsNoise * 22.0;

    // ── 3. Coastal Beach & Meadow Ramp ───────────────────────
    // Smooth transition from sea level beach (0m) to coastal meadows (4-15m)
    if (dInland < 240.0) {
      const coastT = smoothstep(0.0, 240.0, dInland);
      // Coastal beach starts at 0.4m, ramps up to meet rolling hills
      const beachH = 0.4 + (dInland / 240.0) * 8.0;
      h = (1 - coastT) * beachH + coastT * h;
    }

    // ── 4. Broad City Basin near the Center ───────────────────
    const distCenter = Math.hypot(x, z);
    const basinRadius = cfg.cityBasinRadius;
    if (distCenter < basinRadius + 220.0) {
      const basinWeight = 1.0 - smoothstep(basinRadius - 160.0, basinRadius + 220.0, distCenter);
      // Flat basin elevation ~20m with subtle local relief (±1.5m)
      const basinElevation = cfg.cityBasinElevation + (n3 + n4) * 2.5;
      h = (1 - basinWeight) * h + basinWeight * basinElevation;
    }

    // ── 5. Lake & River Valley ───────────────────────────────
    const lakeDx = x - cfg.lakeCenter.x;
    const lakeDz = z - cfg.lakeCenter.z;
    const distLake = Math.hypot(lakeDx, lakeDz);
    const lakeRad = cfg.lakeRadius;

    if (distLake < lakeRad + 180.0) {
      const lakeWeight = 1.0 - smoothstep(lakeRad - 40.0, lakeRad + 180.0, distLake);
      // Lake depression dipping down to lake bed
      const innerT = Math.min(1.0, distLake / lakeRad);
      const lakeProfile = cfg.lakeBedElevation + innerT * (cfg.lakeSurfaceElevation - cfg.lakeBedElevation);
      h = (1 - lakeWeight) * h + lakeWeight * lakeProfile;
    }

    // ── 6. Mountain Ridge with Peaks (~180m) & Mountain Pass (~48m) ─
    // Ridge axis running from (450, 1350) to (1650, 450)
    const ax = 450, az = 1350;
    const bx = 1650, bz = 450;
    const abx = bx - ax;
    const abz = bz - az;
    const abLenSq = abx * abx + abz * abz;

    const tRidge = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / abLenSq));
    const projX = ax + tRidge * abx;
    const projZ = az + tRidge * abz;
    const distRidge = Math.hypot(x - projX, z - projZ);

    const ridgeWidth = 420.0;
    if (distRidge < ridgeWidth) {
      const ridgeWeight = 1.0 - smoothstep(0.0, ridgeWidth, distRidge);

      // Sharp alpine ridge profile using ridge turbulence
      const rNoise = 1.0 - Math.abs(this.ridgeNoise.sample(x / 110, z / 110));
      const peakAmp = cfg.mountainPeakElevation - 28.0;
      let mountainH = 35.0 + ridgeWeight * (peakAmp + rNoise * 26.0);

      // Mountain Pass near the center of the ridge: (1050, 900)
      const passX = 1050, passZ = 900;
      const distPass = Math.hypot(x - passX, z - passZ);
      const passRadius = 240.0;
      if (distPass < passRadius) {
        const passWeight = 1.0 - smoothstep(40.0, passRadius, distPass);
        // Saddle elevation (~48m) with gentle drivable slopes
        const passH = cfg.mountainPassElevation + (n3 + n4) * 3.0;
        mountainH = (1 - passWeight) * mountainH + passWeight * passH;
      }

      h = (1 - ridgeWeight) * h + ridgeWeight * mountainH;
    }

    return h;
  }

  /**
   * Slope magnitude $|\nabla h| = \tan(\theta)$ at (x, z).
   * E.g. slope of 35 degrees has value ~0.70; 40 degrees has value ~0.84.
   */
  getSlope(x: number, z: number): number {
    const eps = 0.12;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    const dhdx = (hR - hL) / (2 * eps);
    const dhdz = (hU - hD) / (2 * eps);

    return Math.hypot(dhdx, dhdz);
  }

  /**
   * Normal vector of pure landforms at (x, z). Guaranteed unit length.
   */
  getNormal(x: number, z: number, outNormal: THREE.Vector3): void {
    const eps = 0.12;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    const dhdx = (hR - hL) / (2 * eps);
    const dhdz = (hU - hD) / (2 * eps);

    outNormal.set(-dhdx, 1, -dhdz).normalize();
  }

  /**
   * Deterministic moisture value in [0, 1] at (x, z).
   */
  getMoisture(x: number, z: number): number {
    const raw = this.moistureNoise.sample(x / 850 + 13.7, z / 850 + 41.2);
    return Math.max(0, Math.min(1, 0.5 + raw * 0.65));
  }

  /**
   * Determines the biome type based on elevation, slope, and moisture.
   */
  getBiome(x: number, z: number): BiomeType {
    const y = this.getHeight(x, z);
    const slope = this.getSlope(x, z);
    const moisture = this.getMoisture(x, z);
    const cfg = this.config;

    // 1. Urban-capable flat city basin
    const distCenter = Math.hypot(x, z);
    if (distCenter < cfg.cityBasinRadius - 30.0 && y >= 6.0 && y <= 35.0 && slope < 0.16) {
      return BiomeType.URBAN;
    }

    // 2. Beach: near ocean waterline or lake shoreline
    const distLake = Math.hypot(x - cfg.lakeCenter.x, z - cfg.lakeCenter.z);
    const isLakeShore = distLake < cfg.lakeRadius + 60.0 && Math.abs(y - cfg.lakeSurfaceElevation) < 2.0;
    const isSeaBeach = y >= -1.2 && y <= 3.6 && slope < 0.28;

    if ((isSeaBeach || isLakeShore) && slope < 0.30) {
      return BiomeType.BEACH;
    }

    // 3. Rock: high mountain elevation (> 85m) or very steep rocky crags (slope > 0.45)
    if (y > 85.0 || slope > 0.44) {
      return BiomeType.ROCK;
    }

    // 4. Forest: moderate elevations with high moisture
    if (y >= 10.0 && y <= 85.0 && moisture > 0.44 && slope < 0.44) {
      return BiomeType.FOREST;
    }

    // 5. Meadow: gentle, lush open grasslands
    return BiomeType.MEADOW;
  }

  /**
   * Dynamic x-coordinate of the sea coastline at a given z.
   */
  getCoastlineX(z: number): number {
    return this.config.coastStartX + 120 * Math.sin(z * 0.0022 + 0.4) + 65 * Math.cos(z * 0.0051);
  }

  /**
   * Returns water surface elevation at (x, z) or null if dry land.
   */
  getWaterSurfaceY(x: number, z: number): number | null {
    const coastX = this.getCoastlineX(z);
    if (x < coastX) {
      return this.config.seaLevel;
    }
    const distLake = Math.hypot(x - this.config.lakeCenter.x, z - this.config.lakeCenter.z);
    if (distLake <= this.config.lakeRadius) {
      return this.config.lakeSurfaceElevation;
    }
    return null;
  }

  isUnderwater(x: number, z: number): boolean {
    const waterY = this.getWaterSurfaceY(x, z);
    if (waterY === null) return false;
    return this.getHeight(x, z) < waterY;
  }
}

// ── Pure Functional Helpers ──────────────────────────────────
let _defaultLandforms: Landforms | null = null;
function getDefaultLandforms(): Landforms {
  if (!_defaultLandforms) {
    _defaultLandforms = new Landforms(DEFAULT_WORLD_SPEC);
  }
  return _defaultLandforms;
}

export function landformHeight(x: number, z: number, spec?: WorldSpec): number {
  if (spec && spec !== DEFAULT_WORLD_SPEC) {
    return new Landforms(spec).getHeight(x, z);
  }
  return getDefaultLandforms().getHeight(x, z);
}

export function slopeAt(x: number, z: number, spec?: WorldSpec): number {
  if (spec && spec !== DEFAULT_WORLD_SPEC) {
    return new Landforms(spec).getSlope(x, z);
  }
  return getDefaultLandforms().getSlope(x, z);
}

export function biomeAt(x: number, z: number, spec?: WorldSpec): BiomeType {
  if (spec && spec !== DEFAULT_WORLD_SPEC) {
    return new Landforms(spec).getBiome(x, z);
  }
  return getDefaultLandforms().getBiome(x, z);
}
