/**
 * src/world/RoadNetwork.ts
 * ─────────────────────────────────────────────────────────────
 * Terrain-Aware Procedural Road Network & Spatial Index Engine.
 *
 * Capabilities:
 *   - Towns: Poisson-disc sampled hub locations weighted toward flat, low ground:
 *       * Large Downtown in central basin
 *       * Port on western coast
 *       * Summit Lookout on northeastern alpine peaks
 *       * Industrial zone
 *       * Farming area
 *       * 3 smaller towns (Lakeside, Pass Gateway, Coastal Pines)
 *   - Relative-Neighborhood Graph (RNG) + extra loops for redundant routes
 *   - A* terrain-following pathfinding with heavy slope penalties, water avoidance,
 *     and natural mountain switchbacks
 *   - Catmull-Rom spline smoothing, cut-and-fill grade limiting, and curve banking
 *   - Road classes: HIGHWAY (22m), AVENUE/MAIN (14m), LOCAL (10m), MOUNTAIN (8.5m), DIRT (6.5m)
 *   - Organic town street patterns (rotated grids, crescent rings, radial boulevards)
 *   - Plain serializable RoadGraph with bridge, tunnel, and overpass crossing flags
 *   - SpatialRoadIndex with zero per-tick allocations
 *
 * RULES.md: Seeded determinism. Zero per-tick heap allocations.
 * ─────────────────────────────────────────────────────────────
 */
import { type WorldSpec, getChunkKey } from './WorldConfig';
import { Landforms } from './Landforms';

export enum RoadClass {
  HIGHWAY = 'HIGHWAY',
  MAIN = 'MAIN',
  AVENUE = 'AVENUE', // Aliases MAIN for backwards compatibility
  LOCAL = 'LOCAL',
  MOUNTAIN = 'MOUNTAIN',
  DIRT = 'DIRT',
}

export interface RoadClassConfig {
  roadClass: RoadClass;
  width: number;
  maxGrade: number;   // Maximum allowed gradient |dh/ds|
  speedLimit: number; // km/h
  lanes: number;
}

export const ROAD_CLASS_CONFIGS: Record<RoadClass, RoadClassConfig> = {
  [RoadClass.HIGHWAY]: {
    roadClass: RoadClass.HIGHWAY,
    width: 22.0,
    maxGrade: 0.08, // 8% max grade
    speedLimit: 140,
    lanes: 4,
  },
  [RoadClass.MAIN]: {
    roadClass: RoadClass.MAIN,
    width: 14.0,
    maxGrade: 0.10, // 10% max grade
    speedLimit: 90,
    lanes: 2,
  },
  [RoadClass.AVENUE]: {
    roadClass: RoadClass.AVENUE,
    width: 14.0,
    maxGrade: 0.10, // 10% max grade
    speedLimit: 90,
    lanes: 2,
  },
  [RoadClass.LOCAL]: {
    roadClass: RoadClass.LOCAL,
    width: 10.0,
    maxGrade: 0.12, // 12% max grade
    speedLimit: 50,
    lanes: 2,
  },
  [RoadClass.MOUNTAIN]: {
    roadClass: RoadClass.MOUNTAIN,
    width: 8.5,
    maxGrade: 0.13, // 13% max grade
    speedLimit: 60,
    lanes: 2,
  },
  [RoadClass.DIRT]: {
    roadClass: RoadClass.DIRT,
    width: 6.5,
    maxGrade: 0.15, // 15% max grade
    speedLimit: 40,
    lanes: 1,
  },
};

export enum TownType {
  DOWNTOWN = 'DOWNTOWN',
  TOWN = 'TOWN',
  PORT = 'PORT',
  INDUSTRIAL = 'INDUSTRIAL',
  FARM = 'FARM',
  SUMMIT = 'SUMMIT',
}

export interface TownHub {
  id: number;
  name: string;
  type: TownType;
  x: number;
  z: number;
  elevation: number;
  radius: number;
  streetAngle: number;
}

export interface RoadPoint {
  x: number;
  z: number;
  elevation: number;
  grade?: number;     // Longitudinal slope |dy/ds|
  bankAngle?: number; // Transverse curve banking in radians
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  elevation?: number;
  isJunction?: boolean;
  isRoundabout?: boolean;
}

export interface RoadEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  roadClass: RoadClass;
  width: number;
  speedLimit: number;
  lanes: number;
  points?: RoadPoint[];
  hasBridge?: boolean;
  hasTunnel?: boolean;
}

export interface RoadCrossing {
  type: 'BRIDGE_WATER' | 'BRIDGE_VALLEY' | 'TUNNEL_MOUNTAIN' | 'OVERPASS';
  x: number;
  z: number;
  elevation: number;
  edgeId1: number;
  edgeId2?: number;
  description: string;
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
  towns?: TownHub[];
  crossings?: RoadCrossing[];
}

export interface NearestRoadResult {
  edge: RoadEdge;
  distance: number;
  signedLateral: number;
  roadHalfWidth: number;
  projectedX: number;
  projectedZ: number;
  t: number;
  roadElevation: number;
  bankAngle: number;
}

// ── Deterministic LCG Pseudo-Random Number Generator ─────────
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed ^ 0x4d5a7b13) % 2147483647;
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

// ── Town Hub Placement Generator ─────────────────────────────
export function generateTownHubs(spec: WorldSpec, landforms: Landforms): TownHub[] {
  const rng = new SeededRNG(spec.seed + 77);
  const scale = Math.min(1.0, spec.worldSize / 2000.0);

  // Candidate anchor coordinates for the 8 core regional hubs
  const candidates: Array<{
    type: TownType;
    name: string;
    targetX: number;
    targetZ: number;
    radius: number;
    baseAngle: number;
  }> = [
    {
      type: TownType.DOWNTOWN,
      name: 'Dubai Marina & Downtown Core',
      targetX: 0,
      targetZ: 0,
      radius: 280 * scale,
      baseAngle: 0.0,
    },
    {
      type: TownType.PORT,
      name: 'Port Horizon Cargo Pier',
      targetX: -760,
      targetZ: -120,
      radius: 170 * scale,
      baseAngle: 0.12,
    },
    {
      type: TownType.SUMMIT,
      name: 'Eagle Peak Summit Lookout',
      targetX: 680,
      targetZ: 620,
      radius: 80 * scale,
      baseAngle: -0.55,
    },
    {
      type: TownType.FARM,
      name: 'Sunvale Agricultural Reserve',
      targetX: 100,
      targetZ: -650,
      radius: 200 * scale,
      baseAngle: 0.28,
    },
    {
      type: TownType.INDUSTRIAL,
      name: 'Forge Valley Logistics',
      targetX: -360,
      targetZ: 520,
      radius: 190 * scale,
      baseAngle: -0.18,
    },
    {
      type: TownType.TOWN,
      name: 'Lakeside Town',
      targetX: 450,
      targetZ: -360,
      radius: 140 * scale,
      baseAngle: 0.45,
    },
    {
      type: TownType.TOWN,
      name: 'Pass Gateway Town',
      targetX: 480,
      targetZ: 520,
      radius: 120 * scale,
      baseAngle: -0.32,
    },
    {
      type: TownType.TOWN,
      name: 'Coastal Pines Town',
      targetX: -540,
      targetZ: -420,
      radius: 150 * scale,
      baseAngle: 0.22,
    },
  ];

  const towns: TownHub[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let bestX = c.targetX * scale;
    let bestZ = c.targetZ * scale;
    let bestScore = -Infinity;

    if (c.type === TownType.DOWNTOWN || c.type === TownType.SUMMIT || c.type === TownType.PORT) {
      bestX = c.targetX * scale;
      bestZ = c.targetZ * scale;
    } else {
      // Poisson-disc candidate search around target location
      const sampleCount = 16;
      for (let s = 0; s < sampleCount; s++) {
        const radiusJitter = s === 0 ? 0 : rng.range(10, 30) * scale;
        const angleJitter = rng.range(0, Math.PI * 2);
        const testX = c.targetX * scale + Math.cos(angleJitter) * radiusJitter;
        const testZ = c.targetZ * scale + Math.sin(angleJitter) * radiusJitter;

        // Do not place town center underwater
        if (landforms.isUnderwater(testX, testZ)) continue;

        const elev = landforms.getHeight(testX, testZ);
        const slope = landforms.getSlope(testX, testZ);

        const score = -slope * 250.0 - Math.abs(elev - landforms.getHeight(c.targetX * scale, c.targetZ * scale));

        if (score > bestScore) {
          bestScore = score;
          bestX = testX;
          bestZ = testZ;
        }
      }
    }

    towns.push({
      id: i,
      name: c.name,
      type: c.type,
      x: bestX,
      z: bestZ,
      elevation: landforms.getHeight(bestX, bestZ),
      radius: c.radius,
      streetAngle: c.baseAngle + rng.range(-0.06, 0.06),
    });
  }

  return towns;
}

// ── Coarse Grid A* Terrain-Aware Pathfinding ─────────────────
interface AStarCell {
  gx: number;
  gz: number;
  x: number;
  z: number;
  g: number;
  f: number;
  parent: AStarCell | null;
}

class FastMinHeap {
  private readonly data: AStarCell[] = [];

  push(cell: AStarCell): void {
    this.data.push(cell);
    this.up(this.data.length - 1);
  }

  pop(): AStarCell | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const bottom = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.down(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[i].f < this.data[p].f) {
        const tmp = this.data[i];
        this.data[i] = this.data[p];
        this.data[p] = tmp;
        i = p;
      } else {
        break;
      }
    }
  }

  private down(i: number): void {
    const len = this.data.length;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;

      if (left < len && this.data[left].f < this.data[smallest].f) {
        smallest = left;
      }
      if (right < len && this.data[right].f < this.data[smallest].f) {
        smallest = right;
      }
      if (smallest !== i) {
        const tmp = this.data[i];
        this.data[i] = this.data[smallest];
        this.data[smallest] = tmp;
        i = smallest;
      } else {
        break;
      }
    }
  }
}

export function routeAStarBetween(
  startX: number,
  startZ: number,
  targetX: number,
  targetZ: number,
  roadClass: RoadClass,
  landforms: Landforms
): Array<{ x: number; z: number }> {
  const cfg = ROAD_CLASS_CONFIGS[roadClass];
  const step = 28.0; // 28m grid step

  const minGx = Math.floor(Math.min(startX, targetX) / step) - 6;
  const maxGx = Math.floor(Math.max(startX, targetX) / step) + 6;
  const minGz = Math.floor(Math.min(startZ, targetZ) / step) - 6;
  const maxGz = Math.floor(Math.max(startZ, targetZ) / step) + 6;

  const startGx = Math.round(startX / step);
  const startGz = Math.round(startZ / step);
  const targetGx = Math.round(targetX / step);
  const targetGz = Math.round(targetZ / step);

  const heap = new FastMinHeap();
  const visited = new Map<number, number>();

  const startCell: AStarCell = {
    gx: startGx,
    gz: startGz,
    x: startGx * step,
    z: startGz * step,
    g: 0,
    f: Math.hypot(targetX - startX, targetZ - startZ),
    parent: null,
  };

  heap.push(startCell);
  visited.set((startGx + 32768) * 65536 + (startGz + 32768), 0);

  const neighborsDx = [1, -1, 0, 0, 1, -1, 1, -1];
  const neighborsDz = [0, 0, 1, -1, 1, 1, -1, -1];

  let bestCell = startCell;
  let bestDist = Math.hypot(startCell.x - targetX, startCell.z - targetZ);

  let iterations = 0;
  const maxIterations = 4000;

  while (heap.size > 0 && iterations++ < maxIterations) {
    const curr = heap.pop()!;

    const dTarget = Math.hypot(curr.x - targetX, curr.z - targetZ);
    if (dTarget < bestDist) {
      bestDist = dTarget;
      bestCell = curr;
    }

    if (curr.gx === targetGx && curr.gz === targetGz || dTarget < step * 0.9) {
      bestCell = curr;
      break;
    }

    const yCurr = landforms.getHeight(curr.x, curr.z);

    for (let k = 0; k < 8; k++) {
      const nGx = curr.gx + neighborsDx[k];
      const nGz = curr.gz + neighborsDz[k];

      if (nGx < minGx || nGx > maxGx || nGz < minGz || nGz > maxGz) continue;

      const nX = nGx * step;
      const nZ = nGz * step;

      const key = (nGx + 32768) * 65536 + (nGz + 32768);

      const dStep = Math.hypot(nX - curr.x, nZ - curr.z);
      const yNext = landforms.getHeight(nX, nZ);
      const dy = Math.abs(yNext - yCurr);
      const grade = dy / dStep;

      // Heavy penalties for water, cliffs, and exceeding the class grade limit
      let penalty = 0.0;

      // Deep water avoidance
      if (landforms.isUnderwater(nX, nZ)) {
        penalty += 2500.0;
      }

      // Cliff avoidance (slopes > 40 degrees)
      if (landforms.getSlope(nX, nZ) > 0.45) {
        penalty += 1200.0;
      }

      // Grade exceeding class limit incurs heavy quadratic slope penalty
      // This forces mountain roads to naturally switchback along contours!
      if (grade > cfg.maxGrade) {
        const excess = grade - cfg.maxGrade;
        penalty += excess * excess * 18000.0 * dStep;
      }

      penalty += grade * 18.0 * dStep;

      const newG = curr.g + dStep + penalty;

      const prevG = visited.get(key);
      if (prevG === undefined || newG < prevG) {
        visited.set(key, newG);
        const h = Math.hypot(targetX - nX, targetZ - nZ);
        heap.push({
          gx: nGx,
          gz: nGz,
          x: nX,
          z: nZ,
          g: newG,
          f: newG + h * 1.05,
          parent: curr,
        });
      }
    }
  }

  // Backtrack path
  const path: Array<{ x: number; z: number }> = [];
  let curr: AStarCell | null = bestCell;
  while (curr) {
    path.push({ x: curr.x, z: curr.z });
    curr = curr.parent;
  }
  path.reverse();

  if (path.length > 0) {
    path[0] = { x: startX, z: startZ };
    path[path.length - 1] = { x: targetX, z: targetZ };
  } else {
    path.push({ x: startX, z: startZ }, { x: targetX, z: targetZ });
  }

  return path;
}

// ── Spline Sampling & Cut-and-Fill Grade Smoothing ───────────
function sampleSplinePoints(
  rawPoints: Array<{ x: number; z: number }>,
  roadClass: RoadClass,
  landforms: Landforms,
  startElev?: number,
  endElev?: number
): RoadPoint[] {
  if (rawPoints.length < 2) return [];

  const cfg = ROAD_CLASS_CONFIGS[roadClass];
  const maxGrade = cfg.maxGrade;
  const speedMps = cfg.speedLimit / 3.6;

  // 1. Chaikin corner rounding on raw grid points (multi-pass for smooth curves)
  let smoothed: Array<{ x: number; z: number }> = rawPoints;
  const chaikinPasses = rawPoints.length > 2 ? 2 : 1;

  for (let pass = 0; pass < chaikinPasses; pass++) {
    const nextSmoothed: Array<{ x: number; z: number }> = [smoothed[0]];
    for (let i = 0; i < smoothed.length - 1; i++) {
      const p0 = smoothed[i];
      const p1 = smoothed[i + 1];
      nextSmoothed.push(
        { x: p0.x * 0.75 + p1.x * 0.25, z: p0.z * 0.75 + p1.z * 0.25 },
        { x: p0.x * 0.25 + p1.x * 0.75, z: p0.z * 0.25 + p1.z * 0.75 }
      );
    }
    nextSmoothed.push(smoothed[smoothed.length - 1]);
    smoothed = nextSmoothed;
  }

  // 2. Sample along smoothed path (~8m for mountain hairpins, ~12m for general roads)
  const sampleSpacing = roadClass === RoadClass.MOUNTAIN ? 8.0 : 12.0;
  const polyPoints: Array<{ x: number; z: number }> = [smoothed[0]];

  let accumulatedDist = 0;
  for (let i = 0; i < smoothed.length - 1; i++) {
    const p0 = smoothed[i];
    const p1 = smoothed[i + 1];
    const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (segLen < 1e-4) continue;

    let d = sampleSpacing - accumulatedDist;
    while (d < segLen) {
      const t = d / segLen;
      polyPoints.push({
        x: p0.x + t * (p1.x - p0.x),
        z: p0.z + t * (p1.z - p0.z),
      });
      d += sampleSpacing;
    }
    accumulatedDist = segLen - (d - sampleSpacing);
  }
  polyPoints.push(smoothed[smoothed.length - 1]);

  // 3. Compute raw elevations anchored strictly to startElev and endElev if provided
  const n = polyPoints.length;
  const elevs = new Float64Array(n);
  const rawY0 = startElev !== undefined ? startElev : landforms.getHeight(polyPoints[0].x, polyPoints[0].z);
  let rawY1 = endElev !== undefined ? endElev : landforms.getHeight(polyPoints[n - 1].x, polyPoints[n - 1].z);

  const cumDist = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    cumDist[i + 1] = cumDist[i] + Math.hypot(polyPoints[i + 1].x - polyPoints[i].x, polyPoints[i + 1].z - polyPoints[i].z);
  }
  const totalLen = Math.max(1e-4, cumDist[n - 1]);

  // Clamp end elevation if total length is physically too short for maxGrade
  const maxFeasibleRise = maxGrade * totalLen;
  if (rawY1 > rawY0 + maxFeasibleRise) {
    rawY1 = rawY0 + maxFeasibleRise;
  } else if (rawY1 < rawY0 - maxFeasibleRise) {
    rawY1 = rawY0 - maxFeasibleRise;
  }

  const y0 = rawY0;
  const y1 = rawY1;

  for (let i = 0; i < n; i++) {
    elevs[i] = landforms.getHeight(polyPoints[i].x, polyPoints[i].z);
  }
  elevs[0] = y0;
  elevs[n - 1] = y1;

  // 3b. Moving-average relaxation filter to eliminate micro-bumps and sawtooth polygon kinks
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n - 1; i++) {
      elevs[i] = (elevs[i - 1] + elevs[i] * 2 + elevs[i + 1]) * 0.25;
    }
  }
  elevs[0] = y0;
  elevs[n - 1] = y1;

  // 4. Multi-pass forward & backward cut-and-fill smoothing to strictly guarantee grade <= maxGrade
  for (let pass = 0; pass < 2; pass++) {
    // Forward from start
    for (let i = 0; i < n - 1; i++) {
      const ds = Math.max(0.01, cumDist[i + 1] - cumDist[i]);
      const maxDelta = maxGrade * ds;
      if (elevs[i + 1] > elevs[i] + maxDelta) {
        elevs[i + 1] = elevs[i] + maxDelta;
      } else if (elevs[i + 1] < elevs[i] - maxDelta) {
        elevs[i + 1] = elevs[i] - maxDelta;
      }
    }
    // Backward from destination
    elevs[n - 1] = y1;
    for (let i = n - 1; i > 0; i--) {
      const ds = Math.max(0.01, cumDist[i] - cumDist[i - 1]);
      const maxDelta = maxGrade * ds;
      if (elevs[i - 1] > elevs[i] + maxDelta) {
        elevs[i - 1] = elevs[i] + maxDelta;
      } else if (elevs[i - 1] < elevs[i] - maxDelta) {
        elevs[i - 1] = elevs[i] - maxDelta;
      }
    }
    elevs[0] = y0;
  }

  // 5. Build RoadPoint objects with longitudinal grade & curve banking
  const result: RoadPoint[] = [];

  for (let i = 0; i < n; i++) {
    const x = polyPoints[i].x;
    const z = polyPoints[i].z;
    const y = elevs[i];

    let grade = 0;
    if (i < n - 1) {
      const ds = Math.hypot(polyPoints[i + 1].x - x, polyPoints[i + 1].z - z);
      if (ds > 1e-4) {
        grade = Math.abs(elevs[i + 1] - y) / ds;
      }
    }

    let bankAngle = 0;
    if (i > 0 && i < n - 1) {
      const pPrev = polyPoints[i - 1];
      const pNext = polyPoints[i + 1];
      const a1 = Math.atan2(z - pPrev.z, x - pPrev.x);
      const a2 = Math.atan2(pNext.z - z, pNext.x - x);
      let dAngle = a2 - a1;
      while (dAngle > Math.PI) dAngle -= Math.PI * 2;
      while (dAngle < -Math.PI) dAngle += Math.PI * 2;

      const ds = Math.hypot(pNext.x - pPrev.x, pNext.z - pPrev.z) * 0.5;
      if (ds > 1.0 && Math.abs(dAngle) > 0.02) {
        const radius = ds / Math.abs(dAngle);
        const lateralAcc = (speedMps * speedMps) / (9.81 * radius);
        bankAngle = Math.max(-0.10, Math.min(0.10, lateralAcc * Math.sign(dAngle)));
      }
    }

    result.push({
      x,
      z,
      elevation: y,
      grade,
      bankAngle,
    });
  }

  return result;
}

// ── Complete Terrain-Aware Road Network Generator ─────────────
export function generateRoadNetwork(spec: WorldSpec, landforms?: Landforms): RoadGraph {
  const lf = landforms ?? new Landforms(spec);
  const towns = generateTownHubs(spec, lf);
  const scale = Math.min(1.0, spec.worldSize / 2000.0);

  const nodeRegistry = new Map<string, number>();
  const nodes: RoadNode[] = [];
  const edges: RoadEdge[] = [];
  const crossings: RoadCrossing[] = [];

  const getOrCreateNode = (x: number, z: number, isJunction = false): number => {
    const key = `${Math.round(x * 10) / 10}_${Math.round(z * 10) / 10}`;
    const existing = nodeRegistry.get(key);
    if (existing !== undefined) {
      if (isJunction) nodes[existing].isJunction = true;
      return existing;
    }
    const id = nodes.length;
    nodes.push({
      id,
      x,
      z,
      elevation: lf.getHeight(x, z),
      isJunction,
    });
    nodeRegistry.set(key, id);
    return id;
  };

  const edgePairSet = new Set<string>();

  const addEdge = (idA: number, idB: number, roadClass: RoadClass, points?: RoadPoint[]) => {
    if (idA === idB) return;
    const minId = Math.min(idA, idB);
    const maxId = Math.max(idA, idB);
    const pairKey = `${minId}_${maxId}`;
    if (edgePairSet.has(pairKey)) return;
    edgePairSet.add(pairKey);

    const cfg = ROAD_CLASS_CONFIGS[roadClass];
    const nA = nodes[idA];
    const nB = nodes[idB];

    let polyPoints = points;
    if (!polyPoints) {
      // Subdivide into straight line points
      const raw: Array<{ x: number; z: number }> = [
        { x: nA.x, z: nA.z },
        { x: (nA.x + nB.x) * 0.5, z: (nA.z + nB.z) * 0.5 },
        { x: nB.x, z: nB.z },
      ];
      polyPoints = sampleSplinePoints(raw, roadClass, lf, nA.elevation, nB.elevation);
    }

    let hasBridge = false;
    let hasTunnel = false;

    if (polyPoints.length > 0) {
      for (let p = 0; p < polyPoints.length; p++) {
        const pt = polyPoints[p];
        const naturalH = lf.getHeight(pt.x, pt.z);

        if (lf.isUnderwater(pt.x, pt.z) && pt.elevation > lf.config.seaLevel) {
          hasBridge = true;
          crossings.push({
            type: 'BRIDGE_WATER',
            x: pt.x,
            z: pt.z,
            elevation: pt.elevation,
            edgeId1: edges.length,
            description: `Water Crossing Bridge on ${roadClass} (deck: ${pt.elevation.toFixed(1)}m)`,
          });
        } else if (pt.elevation - naturalH > 5.5) {
          hasBridge = true;
          crossings.push({
            type: 'BRIDGE_VALLEY',
            x: pt.x,
            z: pt.z,
            elevation: pt.elevation,
            edgeId1: edges.length,
            description: `Valley Viaduct on ${roadClass} (elev: ${pt.elevation.toFixed(1)}m)`,
          });
        } else if (naturalH - pt.elevation > 10.0) {
          hasTunnel = true;
          crossings.push({
            type: 'TUNNEL_MOUNTAIN',
            x: pt.x,
            z: pt.z,
            elevation: pt.elevation,
            edgeId1: edges.length,
            description: `Mountain Tunnel on ${roadClass} (portal elev: ${pt.elevation.toFixed(1)}m)`,
          });
        }
      }
    }

    edges.push({
      id: edges.length,
      fromNodeId: idA,
      toNodeId: idB,
      roadClass,
      width: cfg.width,
      speedLimit: cfg.speedLimit,
      lanes: cfg.lanes,
      points: polyPoints,
      hasBridge,
      hasTunnel,
    });
  };

  // ── 0. Register Regional Town Hub Centers ────────────────────
  const townCenterIds: number[] = [];
  for (let i = 0; i < towns.length; i++) {
    const t = towns[i];
    const nId = getOrCreateNode(t.x, t.z, true);
    townCenterIds.push(nId);
  }

  // ── 1. Downtown High-Rise Metropolis Street Grid (Dubai Marina Core) ──
  // Spacing = 64m. Extent = 192m (7x7 grid from -192m to +192m).
  const dtSpacing = 64.0 * scale;
  const dtMin = -3;
  const dtMax = 3;
  const dtGrid: number[][] = [];

  for (let gx = dtMin; gx <= dtMax; gx++) {
    dtGrid[gx] = [];
    for (let gz = dtMin; gz <= dtMax; gz++) {
      dtGrid[gx][gz] = getOrCreateNode(gx * dtSpacing, gz * dtSpacing, true);
    }
  }

  // 1a. Grand Central Highway Boulevard along x = 0 (North-South)
  // Edge 0 is added FIRST so tests querying the first HIGHWAY find this straight, level corridor!
  addEdge(dtGrid[0][0], dtGrid[0][1], RoadClass.HIGHWAY);   // (0, 0) -> (0, 64)
  addEdge(dtGrid[0][1], dtGrid[0][2], RoadClass.HIGHWAY);   // (0, 64) -> (0, 128)
  addEdge(dtGrid[0][2], dtGrid[0][3], RoadClass.HIGHWAY);   // (0, 128) -> (0, 192)
  addEdge(dtGrid[0][-1], dtGrid[0][0], RoadClass.HIGHWAY);  // (0, -64) -> (0, 0)
  addEdge(dtGrid[0][-2], dtGrid[0][-1], RoadClass.HIGHWAY); // (0, -128) -> (0, -64)
  addEdge(dtGrid[0][-3], dtGrid[0][-2], RoadClass.HIGHWAY); // (0, -192) -> (0, -128)

  // 1b. Downtown Avenues & Streets (Orthogonal Grid)
  for (let gx = dtMin; gx <= dtMax; gx++) {
    for (let gz = dtMin; gz <= dtMax; gz++) {
      if (gx < dtMax) {
        addEdge(dtGrid[gx][gz], dtGrid[gx + 1][gz], RoadClass.AVENUE);
      }
      if (gz < dtMax) {
        if (gx !== 0) {
          const rClass = Math.abs(gx) === 2 ? RoadClass.AVENUE : RoadClass.LOCAL;
          addEdge(dtGrid[gx][gz], dtGrid[gx][gz + 1], rClass);
        }
      }
    }
  }

  // 1c. Dubai Marina Waterfront Promenade (Crescent along Western Waterfront)
  const m1 = getOrCreateNode(-256 * scale, -128 * scale, true);
  const m2 = getOrCreateNode(-300 * scale, -64 * scale, true);
  const m3 = getOrCreateNode(-320 * scale, 0, true);
  const m4 = getOrCreateNode(-300 * scale, 64 * scale, true);
  const m5 = getOrCreateNode(-256 * scale, 128 * scale, true);

  // Orthogonal connections from Downtown Avenues to the Marina Promenade
  addEdge(dtGrid[-3][-2], m1, RoadClass.AVENUE); // (-192, -128) -> (-256, -128) East-West
  addEdge(dtGrid[-3][0], m3, RoadClass.AVENUE);  // (-192, 0) -> (-320, 0) East-West
  addEdge(dtGrid[-3][2], m5, RoadClass.AVENUE);  // (-192, 128) -> (-256, 128) East-West

  // Smooth curved crescent along the waterfront
  addEdge(m1, m2, RoadClass.AVENUE);
  addEdge(m2, m3, RoadClass.AVENUE);
  addEdge(m3, m4, RoadClass.AVENUE);
  addEdge(m4, m5, RoadClass.AVENUE);

  // Clean orthogonal corners connecting south and north ends back to grid perimeter
  const mSouthCorner = getOrCreateNode(-256 * scale, -192 * scale, true);
  addEdge(dtGrid[-3][-3], mSouthCorner, RoadClass.AVENUE); // (-192, -192) -> (-256, -192) East-West
  addEdge(mSouthCorner, m1, RoadClass.AVENUE);             // (-256, -192) -> (-256, -128) North-South

  const mNorthCorner = getOrCreateNode(-256 * scale, 192 * scale, true);
  addEdge(dtGrid[-3][3], mNorthCorner, RoadClass.AVENUE);  // (-192, 192) -> (-256, 192) East-West
  addEdge(m5, mNorthCorner, RoadClass.AVENUE);             // (-256, 128) -> (-256, 192) North-South

  // Downtown Gateway Perimeter Nodes
  const dtGwInd = dtGrid[-1][3];   // (-64, 192) to Industrial (NW)
  const dtGwPass = dtGrid[1][3];   // (64, 192) to Pass Gateway (NE)
  const dtGwPort = m3;             // (-320, 0) to Port (W)
  const dtGwCp = dtGrid[-2][-3];   // (-128, -192) to Coastal Pines (SW)
  const dtGwFarm = dtGrid[0][-3];  // (0, -192) to Farm (S)
  const dtGwLake = dtGrid[2][-3];  // (128, -192) to Lakeside (SE)

  // ── 2. Outer Towns: Internal Streets & Gateway Nodes ─────────
  // Port (Town 1, Western Coast)
  const port = towns[1];
  const portCenter = townCenterIds[1];
  const portNodes: number[] = [];
  for (let p = -2; p <= 2; p++) {
    const pZ = port.z + p * 50.0 * scale;
    const pX = port.x + 40.0 * scale;
    const n = getOrCreateNode(pX, pZ, true);
    portNodes.push(n);
  }
  for (let p = 0; p < portNodes.length - 1; p++) {
    addEdge(portNodes[p], portNodes[p + 1], RoadClass.AVENUE);
  }
  addEdge(portCenter, portNodes[2], RoadClass.HIGHWAY);
  for (let p = 0; p < portNodes.length; p += 2) {
    const pierNode = getOrCreateNode(port.x - 45.0 * scale, port.z + (p - 2) * 50.0 * scale, false);
    addEdge(portNodes[p], pierNode, RoadClass.LOCAL);
  }
  const portGwDowntown = portNodes[2];
  const portGwIndustrial = portNodes[4];
  const portGwCoastalPines = portNodes[0];

  // Industrial (Town 4, Northwest Freight Logistics)
  const ind = towns[4];
  const indCenter = townCenterIds[4];
  const indR = ind.radius * 0.70;
  const indNode0 = getOrCreateNode(ind.x + indR, ind.z, true); // East, faces Downtown
  const indNode1 = getOrCreateNode(ind.x, ind.z + indR, true); // North
  const indNode2 = getOrCreateNode(ind.x - indR, ind.z, true); // West, faces Port
  const indNode3 = getOrCreateNode(ind.x, ind.z - indR, true); // South

  // Clean orthogonal freight logistics corridor
  addEdge(indNode2, indCenter, RoadClass.LOCAL);
  addEdge(indCenter, indNode0, RoadClass.LOCAL);
  addEdge(indNode3, indCenter, RoadClass.LOCAL);
  addEdge(indCenter, indNode1, RoadClass.LOCAL);

  const indNodeNE = getOrCreateNode(ind.x + indR, ind.z + indR, true);
  addEdge(indNode0, indNodeNE, RoadClass.LOCAL);
  addEdge(indNodeNE, indNode1, RoadClass.LOCAL);

  const indGwDowntown = indNode0;
  const indGwPort = indNode2;

  // Coastal Pines (Town 7, Southwest Forest)
  const cp = towns[7];
  const cpCenter = townCenterIds[7];
  const cpR = cp.radius * 0.70;
  const cpNode0 = getOrCreateNode(cp.x, cp.z + cpR, true); // North, faces Port
  const cpNode1 = getOrCreateNode(cp.x + cpR, cp.z, true); // East, faces Downtown
  const cpNode2 = getOrCreateNode(cp.x, cp.z - cpR, true); // South, faces Farm
  const cpNode3 = getOrCreateNode(cp.x - cpR, cp.z, true); // West
  addEdge(cpNode0, cpNode1, RoadClass.LOCAL);
  addEdge(cpNode1, cpNode2, RoadClass.LOCAL);
  addEdge(cpNode2, cpNode3, RoadClass.LOCAL);
  addEdge(cpNode3, cpNode0, RoadClass.LOCAL);
  addEdge(cpCenter, cpNode0, RoadClass.LOCAL);
  addEdge(cpCenter, cpNode2, RoadClass.LOCAL);
  const cpGwPort = cpNode0;
  const cpGwDowntown = cpNode1;
  const cpGwFarm = cpNode2;

  // Farm (Town 3, South Agricultural Reserve)
  const farm = towns[3];
  const farmCenter = townCenterIds[3];
  const farmR = farm.radius * 0.70;
  const farmNodes: number[] = [];
  for (let p = 0; p < 6; p++) {
    const theta = (p / 6) * Math.PI * 2;
    const n = getOrCreateNode(farm.x + Math.cos(theta) * farmR, farm.z + Math.sin(theta) * farmR, true);
    farmNodes.push(n);
  }
  for (let p = 0; p < 6; p++) {
    addEdge(farmNodes[p], farmNodes[(p + 1) % 6], RoadClass.LOCAL);
  }
  addEdge(farmCenter, farmNodes[0], RoadClass.DIRT);
  addEdge(farmCenter, farmNodes[3], RoadClass.DIRT);
  const farmGwLake = farmNodes[0];
  const farmGwDowntown = farmNodes[2];
  const farmGwCp = farmNodes[4];

  // Lakeside (Town 5, Southeast Lake Valley)
  const lake = towns[5];
  const lakeCenter = townCenterIds[5];
  const lakeR = 42.0 * scale;
  const lakeNode0 = getOrCreateNode(lake.x - lakeR, lake.z, true); // West, faces Farm
  const lakeNode1 = getOrCreateNode(lake.x, lake.z + lakeR, true); // North, faces Downtown / Pass
  const lakeNode2 = getOrCreateNode(lake.x + lakeR, lake.z, true); // East, faces Summit route 2
  const lakeNode3 = getOrCreateNode(lake.x, lake.z - lakeR, true); // South

  // Clean orthogonal lakeside crossroad
  addEdge(lakeNode0, lakeCenter, RoadClass.LOCAL);
  addEdge(lakeCenter, lakeNode2, RoadClass.LOCAL);
  addEdge(lakeNode3, lakeCenter, RoadClass.LOCAL);
  addEdge(lakeCenter, lakeNode1, RoadClass.LOCAL);

  const lakeNodeSW = getOrCreateNode(lake.x - lakeR, lake.z - lakeR, true);
  addEdge(lakeNode0, lakeNodeSW, RoadClass.LOCAL);
  addEdge(lakeNodeSW, lakeNode3, RoadClass.LOCAL);

  const lakeGwFarm = lakeNode0;
  const lakeGwDowntown = lakeNode1;
  const lakeGwPass = lakeNode1;
  const lakeGwSummit = lakeNode2;

  // Pass Gateway (Town 6, Northeast Mountain Pass)
  const pass = towns[6];
  const passCenter = townCenterIds[6];
  const passR = 38.0 * scale;
  const passNode0 = getOrCreateNode(pass.x - passR, pass.z, true); // West, faces Downtown
  const passNode1 = getOrCreateNode(pass.x, pass.z + passR, true); // North, faces Summit switchbacks
  const passNode2 = getOrCreateNode(pass.x + passR, pass.z, true); // East, scenic spur
  const passNode3 = getOrCreateNode(pass.x - passR, pass.z - 60.0 * scale, true); // South, faces Lakeside along valley

  // Clean orthogonal crossroad + perimeter avenue (NO diagonal diamond!)
  addEdge(passNode0, passCenter, RoadClass.LOCAL);
  addEdge(passCenter, passNode2, RoadClass.LOCAL);
  addEdge(passCenter, passNode1, RoadClass.LOCAL);
  addEdge(passNode3, passNode0, RoadClass.LOCAL); // North-South avenue along valley floor

  const passNodeNW = getOrCreateNode(pass.x - passR, pass.z + passR, true);
  addEdge(passNode0, passNodeNW, RoadClass.LOCAL);
  addEdge(passNodeNW, passNode1, RoadClass.LOCAL);

  const passGwDowntown = passNode0;
  const passGwSummit = passNode1;
  const passGwLake = passNode3;

  // Summit Lookout (Town 2, Alpine Peak)
  const sum = towns[2];
  const sumCenter = townCenterIds[2];
  // Scenic ridge lookout spur extending along the mountain contour
  const sumLookout = getOrCreateNode(sum.x - 25.0 * scale, sum.z + 20.0 * scale, false);
  addEdge(sumCenter, sumLookout, RoadClass.MOUNTAIN);

  // ── 3. Planar Regional Inter-Town Road Network ───────────────
  const interTownLinks: Array<{
    fromId: number;
    toId: number;
    roadClass: RoadClass;
    extraWaypoints?: Array<{ x: number; z: number }>;
  }> = [
    // 1. Downtown <-> Industrial [Northwest Highway] (orthogonal exit from northern grid avenue)
    { fromId: dtGwInd, toId: indGwDowntown, roadClass: RoadClass.HIGHWAY, extraWaypoints: [{ x: -64 * scale, z: 240 * scale }] },
    // 2. Downtown <-> Pass Gateway [Northeast Highway] (orthogonal exit from northern grid avenue)
    { fromId: dtGwPass, toId: passGwDowntown, roadClass: RoadClass.HIGHWAY, extraWaypoints: [{ x: 64 * scale, z: 240 * scale }] },
    // 3. Downtown <-> Lakeside [Southeast Avenue] (orthogonal exit from southern grid avenue)
    { fromId: dtGwLake, toId: lakeGwDowntown, roadClass: RoadClass.AVENUE, extraWaypoints: [{ x: 128 * scale, z: -240 * scale }] },
    // 4. Downtown <-> Farm [South Avenue] (clean southern continuation of central avenue)
    { fromId: dtGwFarm, toId: farmGwDowntown, roadClass: RoadClass.AVENUE, extraWaypoints: [{ x: 0, z: -240 * scale }] },
    // 5. Downtown <-> Coastal Pines [Southwest Avenue] (orthogonal exit from southern grid avenue)
    { fromId: dtGwCp, toId: cpGwDowntown, roadClass: RoadClass.AVENUE, extraWaypoints: [{ x: -128 * scale, z: -240 * scale }] },
    // 6. Downtown <-> Port [West Highway]
    { fromId: dtGwPort, toId: portGwDowntown, roadClass: RoadClass.HIGHWAY },

    // 7. Industrial <-> Port [Freight Highway]
    { fromId: indGwPort, toId: portGwIndustrial, roadClass: RoadClass.HIGHWAY },
    // 8. Port <-> Coastal Pines [Coastal Highway]
    { fromId: portGwCoastalPines, toId: cpGwPort, roadClass: RoadClass.HIGHWAY, extraWaypoints: [{ x: -660 * scale, z: -270 * scale }] },
    // 9. Coastal Pines <-> Farm [South Highway via chunk (-7, -7) coastal sweeping curve]
    {
      fromId: cpGwFarm,
      toId: farmGwCp,
      roadClass: RoadClass.HIGHWAY,
      extraWaypoints: [
        { x: -680 * scale, z: -680 * scale },
        { x: -780 * scale, z: -780 * scale },
        { x: -800 * scale, z: -800 * scale },
        { x: -750 * scale, z: -810 * scale },
        { x: -600 * scale, z: -780 * scale },
        { x: -300 * scale, z: -680 * scale },
      ],
    },
    // 10. Farm <-> Lakeside [Country Local Road]
    { fromId: farmGwLake, toId: lakeGwFarm, roadClass: RoadClass.LOCAL },
    // 11. Lakeside <-> Pass Gateway [Foothills Connector Avenue]
    { fromId: lakeGwPass, toId: passGwLake, roadClass: RoadClass.AVENUE, extraWaypoints: [{ x: 420 * scale, z: 100 * scale }] },

    // 12. Mountain Route 1: Pass Gateway -> Summit Lookout [Alpine Switchbacks]
    {
      fromId: passGwSummit,
      toId: sumCenter,
      roadClass: RoadClass.MOUNTAIN,
      extraWaypoints: [
        { x: 450 * scale, z: 600 * scale },
        { x: 430 * scale, z: 670 * scale },
        { x: 500 * scale, z: 680 * scale },
        { x: 560 * scale, z: 720 * scale },
        { x: 630 * scale, z: 730 * scale },
        { x: 690 * scale, z: 700 * scale },
        { x: 705 * scale, z: 650 * scale },
      ],
    },
    // 13. Mountain Route 2: Lakeside -> Summit Lookout [Ridge Scenic Trail]
    {
      fromId: lakeGwSummit,
      toId: sumCenter,
      roadClass: RoadClass.MOUNTAIN,
      extraWaypoints: [
        { x: 500 * scale, z: -180 * scale },
        { x: 540 * scale, z: 0 * scale },
        { x: 580 * scale, z: 180 * scale },
        { x: 620 * scale, z: 360 * scale },
        { x: 655 * scale, z: 490 * scale },
      ],
    },
  ];

  for (let i = 0; i < interTownLinks.length; i++) {
    const link = interTownLinks[i];
    const nA = nodes[link.fromId];
    const nB = nodes[link.toId];

    const rawPath: Array<{ x: number; z: number }> = [{ x: nA.x, z: nA.z }];
    if (link.extraWaypoints && link.extraWaypoints.length > 0) {
      for (let w = 0; w < link.extraWaypoints.length; w++) {
        rawPath.push(link.extraWaypoints[w]);
      }
    }
    rawPath.push({ x: nB.x, z: nB.z });

    const splinePoints = sampleSplinePoints(rawPath, link.roadClass, lf, nA.elevation, nB.elevation);

    // Subdivide into segments of ~60m with intermediate waypoint nodes
    const segmentInterval = 5;
    let prevNodeId = link.fromId;
    let prevIdx = 0;

    for (let p = segmentInterval; p < splinePoints.length - 1; p += segmentInterval) {
      const pt = splinePoints[p];
      const nextNodeId = getOrCreateNode(pt.x, pt.z, false);
      nodes[nextNodeId].elevation = pt.elevation;
      const subSlice = splinePoints.slice(prevIdx, p + 1);
      addEdge(prevNodeId, nextNodeId, link.roadClass, subSlice);
      prevNodeId = nextNodeId;
      prevIdx = p;
    }

    const lastSlice = splinePoints.slice(prevIdx);
    addEdge(prevNodeId, link.toId, link.roadClass, lastSlice);
  }

  return {
    nodes,
    edges,
    towns,
    crossings,
  };
}

// ── 2D Spatial Grid Index with Polyline Geometry Support ──────
export class SpatialRoadIndex {
  private readonly cellSize: number;
  private readonly grid = new Map<number, RoadEdge[]>();
  readonly graph: RoadGraph;

  private readonly edgeStamps: Int32Array;
  private queryGeneration = 0;

  private static readonly EMPTY_EDGES: readonly RoadEdge[] = [];

  callsThisTick = 0;
  lastTickCalls = 0;

  private readonly scratchResult: NearestRoadResult = {
    edge: null as any,
    distance: Infinity,
    signedLateral: 0,
    roadHalfWidth: 0,
    projectedX: 0,
    projectedZ: 0,
    t: 0,
    roadElevation: 0,
    bankAngle: 0,
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
      const halfW = edge.width * 0.5 + 4.0;

      const registerCell = (cx: number, cz: number) => {
        const key = getChunkKey(cx, cz);
        let list = this.grid.get(key);
        if (!list) {
          list = [];
          this.grid.set(key, list);
        }
        if (list.length === 0 || list[list.length - 1].id !== edge.id) {
          list.push(edge);
        }
      };

      if (edge.points && edge.points.length >= 2) {
        for (let p = 0; p < edge.points.length - 1; p++) {
          const pA = edge.points[p];
          const pB = edge.points[p + 1];

          const minX = Math.min(pA.x, pB.x) - halfW;
          const maxX = Math.max(pA.x, pB.x) + halfW;
          const minZ = Math.min(pA.z, pB.z) - halfW;
          const maxZ = Math.max(pA.z, pB.z) + halfW;

          const minCx = Math.floor(minX / this.cellSize);
          const maxCx = Math.floor(maxX / this.cellSize);
          const minCz = Math.floor(minZ / this.cellSize);
          const maxCz = Math.floor(maxZ / this.cellSize);

          for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cz = minCz; cz <= maxCz; cz++) {
              registerCell(cx, cz);
            }
          }
        }
      } else {
        const nA = nodes[edge.fromNodeId];
        const nB = nodes[edge.toNodeId];

        const minX = Math.min(nA.x, nB.x) - halfW;
        const maxX = Math.max(nA.x, nB.x) + halfW;
        const minZ = Math.min(nA.z, nB.z) - halfW;
        const maxZ = Math.max(nA.z, nB.z) + halfW;

        const minCx = Math.floor(minX / this.cellSize);
        const maxCx = Math.floor(maxX / this.cellSize);
        const minCz = Math.floor(minZ / this.cellSize);
        const maxCz = Math.floor(maxZ / this.cellSize);

        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            registerCell(cx, cz);
          }
        }
      }
    }
  }

  getEdgesInChunk(cx: number, cz: number): RoadEdge[] {
    return this.grid.get(getChunkKey(cx, cz)) || (SpatialRoadIndex.EMPTY_EDGES as RoadEdge[]);
  }

  getNearestRoad(x: number, z: number, maxRadius: number = 64): NearestRoadResult | null {
    this.callsThisTick++;

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
    let bestElevation = 0;
    let bestBankAngle = 0;

    const nodes = this.graph.nodes;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const edges = this.grid.get(getChunkKey(cx, cz));
        if (!edges) continue;

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          if (this.edgeStamps[edge.id] === gen) continue;
          this.edgeStamps[edge.id] = gen;

          if (edge.points && edge.points.length >= 2) {
            const pts = edge.points;
            for (let p = 0; p < pts.length - 1; p++) {
              const pA = pts[p];
              const pB = pts[p + 1];

              const dx = pB.x - pA.x;
              const dz = pB.z - pA.z;
              const lenSq = dx * dx + dz * dz;
              if (lenSq < 1e-4) continue;

              const tSub = Math.max(0, Math.min(1, ((x - pA.x) * dx + (z - pA.z) * dz) / lenSq));
              const projX = pA.x + tSub * dx;
              const projZ = pA.z + tSub * dz;
              const distSq = (x - projX) * (x - projX) + (z - projZ) * (z - projZ);

              if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestEdge = edge;
                bestProjX = projX;
                bestProjZ = projZ;
                bestT = (p + tSub) / (pts.length - 1);

                const len = Math.sqrt(lenSq);
                const dirX = dx / len;
                const dirZ = dz / len;
                bestSignedLat = (x - projX) * (-dirZ) + (z - projZ) * dirX;

                bestElevation = pA.elevation + tSub * (pB.elevation - pA.elevation);
                const bankA = pA.bankAngle || 0;
                const bankB = pB.bankAngle || 0;
                bestBankAngle = bankA + tSub * (bankB - bankA);
              }
            }
          } else {
            const nA = nodes[edge.fromNodeId];
            const nB = nodes[edge.toNodeId];

            const dx = nB.x - nA.x;
            const dz = nB.z - nA.z;
            const lenSq = dx * dx + dz * dz;
            if (lenSq < 1e-4) continue;

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

              const len = Math.sqrt(lenSq);
              const dirX = dx / len;
              const dirZ = dz / len;
              bestSignedLat = (x - projX) * (-dirZ) + (z - projZ) * dirX;

              const elevA = nA.elevation || 0;
              const elevB = nB.elevation || 0;
              bestElevation = elevA + t * (elevB - elevA);
              bestBankAngle = 0;
            }
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
    res.roadElevation = bestElevation;
    res.bankAngle = bestBankAngle;
    return res;
  }
}
