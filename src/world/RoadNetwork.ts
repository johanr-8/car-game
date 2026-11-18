/**
 * src/world/RoadNetwork.ts
 * ─────────────────────────────────────────────────────────────
 * Seeded, Deterministic Road Network Generator.
 *
 * Produces a planar, connected road network graph:
 *   - Ring highway (width ~22m, speed limit 140 km/h)
 *   - Two diagonal highways intersecting at center (width ~22m)
 *   - Grid of main avenues roughly every 320m (width ~14m)
 *   - Local streets inside blocks (width ~10m)
 *
 * Guarantees:
 *   - Planar: No overlapping roads, intersections split at shared nodes
 *   - Fully connected: 100% reachable from any node
 *   - Plain serializable data: ideal for minimap, traffic, and waypoints
 *
 * RULES.md: Seeded determinism. Zero per-frame allocations.
 * ─────────────────────────────────────────────────────────────
 */
import { type WorldSpec, getChunkKey } from './WorldConfig';

export enum RoadClass {
  HIGHWAY = 'HIGHWAY',
  AVENUE = 'AVENUE',
  LOCAL = 'LOCAL',
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  elevation?: number;
}

export interface RoadEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  roadClass: RoadClass;
  width: number;
  speedLimit: number;
  lanes: number;
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface NearestRoadResult {
  edge: RoadEdge;
  distance: number;
  signedLateral: number;
  roadHalfWidth: number;
  projectedX: number;
  projectedZ: number;
  t: number;
}

interface RawSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  roadClass: RoadClass;
  width: number;
  speedLimit: number;
  lanes: number;
}

// ── Simple Seeded PRNG for Deterministic Neighborhoods ───────
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/**
 * Generates the complete, planar, connected road network for a WorldSpec.
 */
export function generateRoadNetwork(spec: WorldSpec): RoadGraph {
  const rng = new SeededRNG(spec.seed);
  const rawSegments: RawSegment[] = [];

  const halfSize = spec.worldSize * 0.5;
  const coreExtent = Math.min(1600, halfSize - 200);

  // ── 1. Two Diagonal Highways ───────────────────────────────
  // Diagonal 1: Southwest to Northeast (-coreExtent, -coreExtent) -> (coreExtent, coreExtent)
  rawSegments.push({
    x1: -coreExtent,
    z1: -coreExtent,
    x2: coreExtent,
    z2: coreExtent,
    roadClass: RoadClass.HIGHWAY,
    width: 22,
    speedLimit: 140,
    lanes: 4,
  });

  // Diagonal 2: Northwest to Southeast (-coreExtent, coreExtent) -> (coreExtent, -coreExtent)
  rawSegments.push({
    x1: -coreExtent,
    z1: coreExtent,
    x2: coreExtent,
    z2: -coreExtent,
    roadClass: RoadClass.HIGHWAY,
    width: 22,
    speedLimit: 140,
    lanes: 4,
  });

  // ── 2. Ring Highway ─────────────────────────────────────────
  // Smooth circular ring with 32 segments at radius ~1280m
  const ringRadius = Math.min(1280, halfSize * 0.32);
  const ringSides = 32;
  const ringVertices: { x: number; z: number }[] = [];

  for (let i = 0; i < ringSides; i++) {
    const angle = (i / ringSides) * Math.PI * 2;
    ringVertices.push({
      x: Math.cos(angle) * ringRadius,
      z: Math.sin(angle) * ringRadius,
    });
  }

  for (let i = 0; i < ringSides; i++) {
    const nextIdx = (i + 1) % ringSides;
    rawSegments.push({
      x1: ringVertices[i].x,
      z1: ringVertices[i].z,
      x2: ringVertices[nextIdx].x,
      z2: ringVertices[nextIdx].z,
      roadClass: RoadClass.HIGHWAY,
      width: 22,
      speedLimit: 140,
      lanes: 4,
    });
  }

  // ── 3. Grid of Main Avenues roughly every 320m ─────────────
  const avenueSpacing = 320;
  const maxK = Math.floor(coreExtent / avenueSpacing);

  // North-South Avenues (along Z)
  for (let k = -maxK; k <= maxK; k++) {
    const x = k * avenueSpacing;
    rawSegments.push({
      x1: x,
      z1: -coreExtent,
      x2: x,
      z2: coreExtent,
      roadClass: RoadClass.AVENUE,
      width: 14,
      speedLimit: 80,
      lanes: 2,
    });
  }

  // East-West Avenues (along X)
  for (let k = -maxK; k <= maxK; k++) {
    const z = k * avenueSpacing;
    rawSegments.push({
      x1: -coreExtent,
      z1: z,
      x2: coreExtent,
      z2: z,
      roadClass: RoadClass.AVENUE,
      width: 14,
      speedLimit: 80,
      lanes: 2,
    });
  }

  // ── 4. Local Streets Inside Selected City Blocks ───────────
  // Bisect selected inner blocks with 10m local streets
  for (let k = -maxK; k < maxK; k++) {
    for (let m = -maxK; m < maxK; m++) {
      const midX = (k + 0.5) * avenueSpacing;
      const midZ = (m + 0.5) * avenueSpacing;
      const distFromCenter = Math.hypot(midX, midZ);

      // Focus local streets within 1000m of center
      if (distFromCenter < 1000) {
        // Deterministic block style from seed
        const roll = rng.next();
        if (roll > 0.35) {
          // North-South local cross-street connecting avenues
          rawSegments.push({
            x1: midX,
            z1: m * avenueSpacing,
            x2: midX,
            z2: (m + 1) * avenueSpacing,
            roadClass: RoadClass.LOCAL,
            width: 10,
            speedLimit: 50,
            lanes: 2,
          });
        }
        if (roll < 0.65) {
          // East-West local cross-street connecting avenues
          rawSegments.push({
            x1: k * avenueSpacing,
            z1: midZ,
            x2: (k + 1) * avenueSpacing,
            z2: midZ,
            roadClass: RoadClass.LOCAL,
            width: 10,
            speedLimit: 50,
            lanes: 2,
          });
        }
      }
    }
  }

  // ── 5. Planarization (Intersections & Non-Overlapping Cuts) ──
  return planarizeSegments(rawSegments);
}

/**
 * Converts raw segments into a planar, non-overlapping graph.
 * Every intersection is split into a node.
 */
function planarizeSegments(rawSegments: RawSegment[]): RoadGraph {
  const n = rawSegments.length;
  const cutsPerSegment: number[][] = Array.from({ length: n }, () => [0, 1]);

  // Find all pairwise transverse intersections
  for (let i = 0; i < n; i++) {
    const s1 = rawSegments[i];
    const dx1 = s1.x2 - s1.x1;
    const dz1 = s1.z2 - s1.z1;

    for (let j = i + 1; j < n; j++) {
      const s2 = rawSegments[j];
      const dx2 = s2.x2 - s2.x1;
      const dz2 = s2.z2 - s2.z1;

      const denom = dx1 * dz2 - dz1 * dx2;
      if (Math.abs(denom) > 1e-8) {
        const t = ((s2.x1 - s1.x1) * dz2 - (s2.z1 - s1.z1) * dx2) / denom;
        const u = ((s2.x1 - s1.x1) * dz1 - (s2.z1 - s1.z1) * dx1) / denom;

        const EPS = 1e-6;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
          const clampedT = Math.max(0, Math.min(1, t));
          const clampedU = Math.max(0, Math.min(1, u));
          cutsPerSegment[i].push(clampedT);
          cutsPerSegment[j].push(clampedU);
        }
      }
    }
  }

  // Node deduplication bucket map (0.05m tolerance)
  const nodes: RoadNode[] = [];
  const nodeMap = new Map<string, number>();

  const getNodeKey = (x: number, z: number): string => {
    const qx = Math.round(x * 20) / 20;
    const qz = Math.round(z * 20) / 20;
    return `${qx}_${qz}`;
  };

  const getOrCreateNode = (x: number, z: number): number => {
    const key = getNodeKey(x, z);
    const existing = nodeMap.get(key);
    if (existing !== undefined) return existing;

    const id = nodes.length;
    nodes.push({ id, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
    nodeMap.set(key, id);
    return id;
  };

  // Road priority: HIGHWAY > AVENUE > LOCAL
  const classPriority: Record<RoadClass, number> = {
    [RoadClass.HIGHWAY]: 3,
    [RoadClass.AVENUE]: 2,
    [RoadClass.LOCAL]: 1,
  };

  // Edge deduplication map (pair of nodes -> RoadEdge)
  const edgeMap = new Map<string, RoadEdge>();

  for (let i = 0; i < n; i++) {
    const s = rawSegments[i];
    const cuts = Array.from(new Set(cutsPerSegment[i])).sort((a, b) => a - b);

    for (let k = 0; k < cuts.length - 1; k++) {
      const t1 = cuts[k];
      const t2 = cuts[k + 1];
      if (t2 - t1 < 1e-4) continue; // Skip zero-length slices

      const xA = s.x1 + t1 * (s.x2 - s.x1);
      const zA = s.z1 + t1 * (s.z2 - s.z1);
      const xB = s.x1 + t2 * (s.x2 - s.x1);
      const zB = s.z1 + t2 * (s.z2 - s.z1);

      const idA = getOrCreateNode(xA, zA);
      const idB = getOrCreateNode(xB, zB);

      if (idA === idB) continue;

      const minId = Math.min(idA, idB);
      const maxId = Math.max(idA, idB);
      const edgeKey = `${minId}_${maxId}`;

      const existingEdge = edgeMap.get(edgeKey);
      if (!existingEdge) {
        edgeMap.set(edgeKey, {
          id: edgeMap.size,
          fromNodeId: minId,
          toNodeId: maxId,
          roadClass: s.roadClass,
          width: s.width,
          speedLimit: s.speedLimit,
          lanes: s.lanes,
        });
      } else {
        // Upgrade class if current priority is higher
        if (classPriority[s.roadClass] > classPriority[existingEdge.roadClass]) {
          existingEdge.roadClass = s.roadClass;
          existingEdge.width = Math.max(existingEdge.width, s.width);
          existingEdge.speedLimit = Math.max(existingEdge.speedLimit, s.speedLimit);
          existingEdge.lanes = Math.max(existingEdge.lanes, s.lanes);
        }
      }
    }
  }

  const edges = Array.from(edgeMap.values());
  for (let i = 0; i < edges.length; i++) {
    edges[i].id = i;
  }

  return { nodes, edges };
}

/**
 * 2D Spatial Grid Index for fast O(1) road queries.
 */
export class SpatialRoadIndex {
  private readonly cellSize: number;
  private readonly grid = new Map<number, RoadEdge[]>();
  readonly graph: RoadGraph;

  // Preallocated stamp array indexed by edge id (zero per-tick allocations)
  private readonly edgeStamps: Int32Array;
  private queryGeneration = 0;

  // Preallocated empty edge array to avoid per-call `[]` allocation
  private static readonly EMPTY_EDGES: readonly RoadEdge[] = [];

  // Performance telemetry
  callsThisTick = 0;
  lastTickCalls = 0;

  // Reusable scratch for nearest road query (zero per-tick allocations)
  private readonly scratchResult: NearestRoadResult = {
    edge: null as any,
    distance: Infinity,
    signedLateral: 0,
    roadHalfWidth: 0,
    projectedX: 0,
    projectedZ: 0,
    t: 0,
  };

  constructor(graph: RoadGraph, cellSize: number = 128) {
    this.graph = graph;
    this.cellSize = cellSize;

    const maxEdgeId = this.graph.edges.reduce((max, e) => Math.max(max, e.id), 0);
    this.edgeStamps = new Int32Array(maxEdgeId + 1);

    this.buildIndex();
  }

  resetTickCounters(): void {
    this.lastTickCalls = this.callsThisTick;
    this.callsThisTick = 0;
  }

  private buildIndex(): void {
    const nodes = this.graph.nodes;
    for (let i = 0; i < this.graph.edges.length; i++) {
      const edge = this.graph.edges[i];
      const nA = nodes[edge.fromNodeId];
      const nB = nodes[edge.toNodeId];

      const minX = Math.min(nA.x, nB.x) - edge.width;
      const maxX = Math.max(nA.x, nB.x) + edge.width;
      const minZ = Math.min(nA.z, nB.z) - edge.width;
      const maxZ = Math.max(nA.z, nB.z) + edge.width;

      const minCx = Math.floor(minX / this.cellSize);
      const maxCx = Math.floor(maxX / this.cellSize);
      const minCz = Math.floor(minZ / this.cellSize);
      const maxCz = Math.floor(maxZ / this.cellSize);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = getChunkKey(cx, cz);
          let list = this.grid.get(key);
          if (!list) {
            list = [];
            this.grid.set(key, list);
          }
          list.push(edge);
        }
      }
    }
  }

  /**
   * Returns all road edges overlapping a specific chunk coordinate.
   */
  getEdgesInChunk(cx: number, cz: number): RoadEdge[] {
    return this.grid.get(getChunkKey(cx, cz)) || (SpatialRoadIndex.EMPTY_EDGES as RoadEdge[]);
  }

  /**
   * Queries the nearest road edge to (x, z) within maxRadius.
   * Zero heap allocations: uses numeric cell keys, preallocated edgeStamps with generation counter,
   * and populates/returns pre-allocated scratch result.
   */
  getNearestRoad(x: number, z: number, maxRadius: number = 64): NearestRoadResult | null {
    this.callsThisTick++;

    // Increment query generation stamp (wrap safely at 31-bit max signed int)
    this.queryGeneration++;
    if (this.queryGeneration >= 0x7fffffff) {
      this.queryGeneration = 1;
      this.edgeStamps.fill(0);
    }
    const gen = this.queryGeneration;

    const minCx = Math.floor((x - maxRadius) / this.cellSize);
    const maxCx = Math.floor((x + maxRadius) / this.cellSize);
    const minCz = Math.floor((z - maxRadius) / this.cellSize);
    const maxCz = Math.floor((z + maxRadius) / this.cellSize);

    let bestDistSq = maxRadius * maxRadius;
    let bestEdge: RoadEdge | null = null;
    let bestProjX = 0;
    let bestProjZ = 0;
    let bestT = 0;
    let bestSignedLat = 0;

    const nodes = this.graph.nodes;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const edges = this.grid.get(getChunkKey(cx, cz));
        if (!edges) continue;

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          if (this.edgeStamps[edge.id] === gen) continue;
          this.edgeStamps[edge.id] = gen;

          const nA = nodes[edge.fromNodeId];
          const nB = nodes[edge.toNodeId];

          const dx = nB.x - nA.x;
          const dz = nB.z - nA.z;
          const lenSq = dx * dx + dz * dz;

          if (lenSq < 1e-4) continue;

          // Projection parameter t
          const t = Math.max(0, Math.min(1, ((x - nA.x) * dx + (z - nA.z) * dz) / lenSq));
          const projX = nA.x + t * dx;
          const projZ = nA.z + t * dz;

          const distSq = (x - projX) * (x - projX) + (z - projZ) * (z - projZ);

          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestEdge = edge;
            bestProjX = projX;
            bestProjZ = projZ;
            bestT = t;

            // Compute signed lateral offset (cross product)
            const len = Math.sqrt(lenSq);
            const dirX = dx / len;
            const dirZ = dz / len;
            bestSignedLat = (x - projX) * (-dirZ) + (z - projZ) * dirX;
          }
        }
      }
    }

    if (!bestEdge) return null;

    const res = this.scratchResult;
    res.edge = bestEdge;
    res.distance = Math.sqrt(bestDistSq);
    res.signedLateral = bestSignedLat;
    res.roadHalfWidth = bestEdge.width * 0.5;
    res.projectedX = bestProjX;
    res.projectedZ = bestProjZ;
    res.t = bestT;
    return res;
  }
}
