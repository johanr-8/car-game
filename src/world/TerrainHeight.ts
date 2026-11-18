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
import { SpatialRoadIndex, RoadClass, type RoadGraph } from './RoadNetwork';
import { Landforms } from './Landforms';

export class TerrainHeight {
  readonly spec: WorldSpec;
  readonly landforms: Landforms;
  roadIndex: SpatialRoadIndex | null = null;
  graph: RoadGraph | null = null;

  private readonly blendMargin = 16.0; // 16m embankment blend width

  // ── Tiny Per-Tick Query Cache (Zero Heap Allocations) ──────
  private static readonly CACHE_SIZE = 16;
  private readonly cacheX = new Float64Array(TerrainHeight.CACHE_SIZE);
  private readonly cacheZ = new Float64Array(TerrainHeight.CACHE_SIZE);
  private readonly cacheH = new Float64Array(TerrainHeight.CACHE_SIZE);
  private readonly cacheValid = new Uint8Array(TerrainHeight.CACHE_SIZE);
  private cacheHead = 0;

  constructor(
    spec: WorldSpec,
    roadIndex?: SpatialRoadIndex | null,
    landforms?: Landforms
  ) {
    this.spec = spec;
    this.landforms = landforms ?? new Landforms(spec);

    if (roadIndex) {
      this.setRoadIndex(roadIndex);
    }
  }

  /**
   * Injects or updates the spatial road index after roads have been routed over Landforms.
   */
  setRoadIndex(roadIndex: SpatialRoadIndex): void {
    this.roadIndex = roadIndex;
    this.graph = roadIndex.graph;
    this.computeNodeElevations();
  }

  /**
   * Clears the per-tick query cache. Called at the start of each physics tick.
   */
  resetTickCache(): void {
    this.cacheValid.fill(0);
    this.cacheHead = 0;
  }

  private computeNodeElevations(): void {
    if (!this.graph) return;
    const nodes = this.graph.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.elevation === undefined || isNaN(node.elevation)) {
        node.elevation = this.landforms.getHeight(node.x, node.z);
      }
    }
  }

  /**
   * Pure landform height at (x, z) before road corridor blending.
   * Preserved for backwards compatibility with existing test suites.
   */
  rawTerrainHeight(x: number, z: number): number {
    return this.landforms.getHeight(x, z);
  }

  /**
   * Evaluates terrain elevation at (x, z) with road flattening and embankment blending.
   * Zero heap allocations. Microsecond execution. Reuses per-tick cached result for nearby queries.
   */
  groundHeightAt(x: number, z: number): number {
    // 0. Check per-tick cache: reuse if query is within ~5mm (0.005m)
    for (let i = 0; i < TerrainHeight.CACHE_SIZE; i++) {
      if (this.cacheValid[i] === 1) {
        const dx = this.cacheX[i] - x;
        const dz = this.cacheZ[i] - z;
        if (dx * dx + dz * dz < 0.000025) {
          return this.cacheH[i];
        }
      }
    }

    const rawH = this.landforms.getHeight(x, z);

    let h = rawH;
    // Query nearest road within road width + blend margin if roadIndex is available
    if (this.roadIndex) {
      const nearest = this.roadIndex.getNearestRoad(x, z, 40.0);
      if (nearest) {
        const d = nearest.distance;
        const w = nearest.roadHalfWidth;

        // Engineered road deck elevation with curve banking
        let roadH = nearest.roadElevation;
        if (nearest.bankAngle !== 0) {
          roadH += nearest.signedLateral * Math.tan(nearest.bankAngle);
        }

        // 1. Directly on road deck: +0.08m asphalt pavement thickness
        if (d <= w) {
          h = roadH + 0.08;
        } else {
          // 2. Flat road shoulder / curb step (within 4m beyond asphalt edge)
          const shoulderMargin = 4.0;
          if (d <= w + shoulderMargin) {
            // Smooth curb drop from asphalt surface down to grass/dirt shoulder
            const curbT = Math.min(1.0, (d - w) / 0.8);
            h = roadH + 0.08 * (1 - curbT);
          } else if (d < w + shoulderMargin + this.blendMargin) {
            // 3. Embankment cut-and-fill transition into natural landforms
            const u = (d - (w + shoulderMargin)) / this.blendMargin;
            const k = u * u * (3 - 2 * u); // Cubic smoothstep
            h = (1 - k) * roadH + k * rawH;
          }
        }
      }
    }

    // Record into per-tick circular cache
    const head = this.cacheHead;
    this.cacheX[head] = x;
    this.cacheZ[head] = z;
    this.cacheH[head] = h;
    this.cacheValid[head] = 1;
    this.cacheHead = (head + 1) & 15;

    return h;
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
    if (!this.roadIndex) return SurfaceType.GRASS;

    const nearest = this.roadIndex.getNearestRoad(x, z, 28.0);
    if (!nearest) return SurfaceType.GRASS;

    if (nearest.distance <= nearest.roadHalfWidth) {
      if (nearest.edge.roadClass === RoadClass.DIRT) {
        return SurfaceType.DIRT;
      }
      return SurfaceType.ASPHALT;
    }

    // 3m gravel / dirt road shoulder
    if (nearest.distance <= nearest.roadHalfWidth + 3.0) {
      return SurfaceType.DIRT;
    }

    return SurfaceType.GRASS;
  }
}
