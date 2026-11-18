/**
 * src/world/TerrainHeight.ts
 * ─────────────────────────────────────────────────────────────
 * Deterministic Terrain Elevation & Surface Analysis Engine.
 *
 * Capabilities:
 *   - Low-frequency seeded multi-octave 2D gradient noise (hills up to ~10m)
 *   - Perfectly flattened and C1-smoothstep blended under all roads
 *   - O(1) groundHeightAt(x, z) query
 *   - Analytic ground normal computation with zero mesh raycasting
 *   - Surface type classification (ASPHALT, DIRT, GRASS)
 *
 * RULES.md: Zero per-tick heap allocations. Pure determinism.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { WorldSpec } from './WorldConfig';
import { SurfaceType } from './WorldConfig';
import { SpatialRoadIndex, type RoadGraph } from './RoadNetwork';

// ── Deterministic 2D Gradient Noise Generator ────────────────
class PerlinNoise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Fisher-Yates shuffle with seeded LCG
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

export class TerrainHeight {
  readonly spec: WorldSpec;
  readonly roadIndex: SpatialRoadIndex;
  readonly graph: RoadGraph;
  private readonly noise: PerlinNoise2D;

  private readonly blendMargin = 16.0; // 16m embankment blend width

  constructor(spec: WorldSpec, roadIndex: SpatialRoadIndex) {
    this.spec = spec;
    this.roadIndex = roadIndex;
    this.graph = roadIndex.graph;
    this.noise = new PerlinNoise2D(spec.seed);

    // Compute smooth road node elevations
    this.computeNodeElevations();
  }

  private computeNodeElevations(): void {
    const nodes = this.graph.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      node.elevation = this.rawTerrainHeight(node.x, node.z);
    }
  }

  /**
   * Natural multi-octave rolling hills noise (amplitude up to ~10m).
   */
  rawTerrainHeight(x: number, z: number): number {
    const maxElev = this.spec.maxElevation;

    // Octave 1: Grand rolling hills (wavelength ~550m)
    const n1 = this.noise.sample(x / 550, z / 550) * 0.60;
    // Octave 2: Medium knolls (wavelength ~220m)
    const n2 = this.noise.sample(x / 220 + 31.4, z / 220 + 17.8) * 0.28;
    // Octave 3: Gentle surface variation (wavelength ~85m)
    const n3 = this.noise.sample(x / 85 + 71.2, z / 85 + 53.1) * 0.12;

    const normalized = (n1 + n2 + n3); // roughly [-0.7, 0.7]
    // Base elevation at 2.5m, oscillating between ~0.5m and ~9.5m
    return Math.max(0.5, 2.5 + normalized * (maxElev * 0.65));
  }

  /**
   * Evaluates terrain elevation at (x, z) with road flattening and embankment blending.
   * Zero heap allocations. Microsecond execution.
   */
  groundHeightAt(x: number, z: number): number {
    const rawH = this.rawTerrainHeight(x, z);

    // Query nearest road within road width + blend margin
    const nearest = this.roadIndex.getNearestRoad(x, z, 40.0);
    if (!nearest) return rawH;

    const d = nearest.distance;
    const w = nearest.roadHalfWidth;

    // Centerline road elevation following smooth terrain profile
    const roadH = this.rawTerrainHeight(nearest.projectedX, nearest.projectedZ);

    // 1. Directly on road deck: +0.08m asphalt pavement thickness
    if (d <= w) {
      return roadH + 0.08;
    }

    // 2. Flat road shoulder / curb step (within 4m beyond asphalt edge)
    const shoulderMargin = 4.0;
    if (d <= w + shoulderMargin) {
      // Smooth curb drop from asphalt surface down to grass/dirt shoulder
      const curbT = Math.min(1.0, (d - w) / 0.8);
      return roadH + 0.08 * (1 - curbT);
    }

    // 3. Embankment transition into natural rolling hills
    if (d < w + shoulderMargin + this.blendMargin) {
      const u = (d - (w + shoulderMargin)) / this.blendMargin;
      const k = u * u * (3 - 2 * u); // Cubic smoothstep
      return (1 - k) * roadH + k * rawH;
    }

    // 4. Natural undulating hills
    return rawH;
  }

  /**
   * Analytic surface normal computation at (x, z) via central differences.
   * Zero heap allocations: populates outNormal in-place.
   */
  groundNormalAt(x: number, z: number, outNormal: THREE.Vector3): void {
    const eps = 0.08;
    const hL = this.groundHeightAt(x - eps, z);
    const hR = this.groundHeightAt(x + eps, z);
    const hD = this.groundHeightAt(x, z - eps);
    const hU = this.groundHeightAt(x, z + eps);

    const dhdx = (hR - hL) / (2 * eps);
    const dhdz = (hU - hD) / (2 * eps);

    outNormal.set(-dhdx, 1, -dhdz).normalize();
  }

  /**
   * Classifies surface type based on proximity to road centerline.
   */
  getSurfaceTypeAt(x: number, z: number): SurfaceType {
    const nearest = this.roadIndex.getNearestRoad(x, z, 28.0);
    if (!nearest) return SurfaceType.GRASS;

    if (nearest.distance <= nearest.roadHalfWidth) {
      return SurfaceType.ASPHALT;
    }

    // 3m gravel / dirt road shoulder
    if (nearest.distance <= nearest.roadHalfWidth + 3.0) {
      return SurfaceType.DIRT;
    }

    return SurfaceType.GRASS;
  }
}
