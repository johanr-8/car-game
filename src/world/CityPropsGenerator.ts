/**
 * src/world/CityPropsGenerator.ts
 * ─────────────────────────────────────────────────────────────
 * Seeded Deterministic City Props & Lots Generator.
 *
 * Capabilities:
 *   - Generates building lots along blocks derived from RoadGraph
 *   - Strict distance check ensures building lots NEVER overlap roads
 *   - Building heights, footprints, and styles conditioned on district
 *   - Places trees and street lamps with road/building clearance
 *   - Mounts deterministic landmarks in designated chunks
 *
 * RULES.md: Seeded determinism. Zero per-tick heap allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { WorldSpec } from './WorldConfig';
import type { SpatialRoadIndex } from './RoadNetwork';
import type { TerrainHeight } from './TerrainHeight';
import type { DistrictMap, DistrictConfig } from './DistrictMap';
import { BuildingStyle, DistrictType } from './DistrictMap';
import type { SolidBox } from './ChunkCollider';
import type { LandmarkDef } from './Landmarks';

export interface GeneratedBuilding {
  style: BuildingStyle;
  matrix: THREE.Matrix4;
  box: SolidBox;
}

export interface GeneratedProps {
  buildings: GeneratedBuilding[];
  treeMatrices: THREE.Matrix4[];
  lampMatrices: THREE.Matrix4[];
  solidBoxes: SolidBox[];
  landmarkGroup?: THREE.Group;
}

// ── Simple LCG Pseudo-Random Number Generator ────────────────
class ChunkRNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed ^ 0x5bf03635) % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  choice<T>(items: T[]): T {
    const idx = Math.floor(this.next() * items.length);
    return items[Math.min(idx, items.length - 1)];
  }
}

export class CityPropsGenerator {
  readonly spec: WorldSpec;
  readonly roadIndex: SpatialRoadIndex;
  readonly terrainHeight: TerrainHeight;
  readonly districtMap: DistrictMap;
  readonly landmarks: LandmarkDef[];

  constructor(
    spec: WorldSpec,
    roadIndex: SpatialRoadIndex,
    terrainHeight: TerrainHeight,
    districtMap: DistrictMap,
    landmarks: LandmarkDef[]
  ) {
    this.spec = spec;
    this.roadIndex = roadIndex;
    this.terrainHeight = terrainHeight;
    this.districtMap = districtMap;
    this.landmarks = landmarks;
  }

  /**
   * Generates all building lots, trees, street lamps, and collision boxes for chunk (cx, cz).
   */
  generateChunkProps(cx: number, cz: number): GeneratedProps {
    const chunkSize = this.spec.chunkSize;
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const centerX = originX + chunkSize * 0.5;
    const centerZ = originZ + chunkSize * 0.5;

    // Seed combining world seed and chunk coordinates
    const chunkSeed = (this.spec.seed + (cx * 73856093) ^ (cz * 19349663)) & 0x7fffffff;
    const rng = new ChunkRNG(chunkSeed);

    const district = this.districtMap.getConfigAt(centerX, centerZ);

    const buildings: GeneratedBuilding[] = [];
    const treeMatrices: THREE.Matrix4[] = [];
    const lampMatrices: THREE.Matrix4[] = [];
    const solidBoxes: SolidBox[] = [];

    // ── 1. Check for Landmark in this Chunk ────────────────────
    let landmarkGroup: THREE.Group | undefined;
    const landmark = this.landmarks.find(l => l.chunkX === cx && l.chunkZ === cz);
    if (landmark) {
      landmarkGroup = landmark.createMesh(this.terrainHeight);
      const lmBoxes = landmark.getSolidBoxes(this.terrainHeight);
      for (let i = 0; i < lmBoxes.length; i++) {
        solidBoxes.push(lmBoxes[i]);
      }
    }

    // ── 2. Building Lots Generation ───────────────────────────
    if (district.hasBuildings && district.styles.length > 0) {
      this.generateLots(cx, cz, district, rng, buildings, solidBoxes, landmark);
    }

    // ── 3. Trees Generation ───────────────────────────────────
    this.generateTrees(cx, cz, district, rng, buildings, treeMatrices, landmark);

    // ── 4. Street Lamps Generation ────────────────────────────
    this.generateStreetLamps(cx, cz, district, lampMatrices);

    return {
      buildings,
      treeMatrices,
      lampMatrices,
      solidBoxes,
      landmarkGroup,
    };
  }

  private generateLots(
    cx: number,
    cz: number,
    district: DistrictConfig,
    rng: ChunkRNG,
    outBuildings: GeneratedBuilding[],
    outSolidBoxes: SolidBox[],
    landmark?: LandmarkDef
  ): void {
    const chunkSize = this.spec.chunkSize;
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;

    // Grid spacing based on district footprint
    const step = district.type === DistrictType.SUBURBAN ? 24 : district.type === DistrictType.INDUSTRIAL ? 48 : 36;
    const margin = 16;

    for (let x = originX + margin; x <= originX + chunkSize - margin; x += step) {
      for (let z = originZ + margin; z <= originZ + chunkSize - margin; z += step) {
        // Small organic jitter within lot cell
        const lotX = x + rng.range(-3, 3);
        const lotZ = z + rng.range(-3, 3);

        // Clearance from landmarks
        if (landmark) {
          const distToLandmark = Math.hypot(lotX - landmark.x, lotZ - landmark.z);
          if (distToLandmark < 55) continue;
        }

        // Query nearest road
        const nearest = this.roadIndex.getNearestRoad(lotX, lotZ, 64);
        if (!nearest) continue;

        // Size & Footprint
        const width = Math.round(rng.range(district.minLotSize, district.maxLotSize));
        const depth = Math.round(rng.range(district.minLotSize, district.maxLotSize));
        const lotRadius = Math.hypot(width * 0.5, depth * 0.5);

        // Strict road clearance check:
        // Distance to road centerline MUST exceed roadHalfWidth + lotRadius + setback
        const requiredClearance = nearest.roadHalfWidth + lotRadius + district.setback;
        if (nearest.distance < requiredClearance) {
          continue; // REJECT: Overlaps road or road buffer
        }

        // Building Height & Style
        const height = Math.round(rng.range(district.minHeight, district.maxHeight));
        const style = rng.choice(district.styles);

        // Ground elevation
        const groundY = this.terrainHeight.groundHeightAt(lotX, lotZ);
        const centerY = groundY + height * 0.5;

        // Building orientation: face towards nearest road
        const dx = nearest.projectedX - lotX;
        const dz = nearest.projectedZ - lotZ;
        const rotY = Math.atan2(dx, dz);

        // Transformation matrix
        const mat = new THREE.Matrix4();
        const pos = new THREE.Vector3(lotX, centerY, lotZ);
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        const scale = new THREE.Vector3(width, height, depth);
        mat.compose(pos, quat, scale);

        const box: SolidBox = {
          x: lotX,
          y: centerY,
          z: lotZ,
          width,
          height,
          depth,
          rotationY: rotY,
        };

        outBuildings.push({ style, matrix: mat, box });
        outSolidBoxes.push(box);
      }
    }
  }

  private generateTrees(
    cx: number,
    cz: number,
    district: DistrictConfig,
    rng: ChunkRNG,
    buildings: GeneratedBuilding[],
    outTreeMatrices: THREE.Matrix4[],
    landmark?: LandmarkDef
  ): void {
    const chunkSize = this.spec.chunkSize;
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;

    // Tree count based on district density
    const treeCount = Math.floor(district.treeDensity * (district.type === DistrictType.PARK ? 24 : 14));

    for (let i = 0; i < treeCount; i++) {
      const tx = originX + rng.range(8, chunkSize - 8);
      const tz = originZ + rng.range(8, chunkSize - 8);

      if (landmark && Math.hypot(tx - landmark.x, tz - landmark.z) < 40) continue;

      // Keep clearance from roads
      const nearest = this.roadIndex.getNearestRoad(tx, tz, 32);
      if (nearest && nearest.distance < nearest.roadHalfWidth + 3.0) {
        continue;
      }

      // Keep clearance from buildings
      let overlapsBuilding = false;
      for (let b = 0; b < buildings.length; b++) {
        const box = buildings[b].box;
        if (Math.hypot(tx - box.x, tz - box.z) < Math.max(box.width, box.depth) * 0.5 + 2.5) {
          overlapsBuilding = true;
          break;
        }
      }
      if (overlapsBuilding) continue;

      const ty = this.terrainHeight.groundHeightAt(tx, tz);
      const treeScale = rng.range(0.85, 1.35);

      const mat = new THREE.Matrix4();
      const pos = new THREE.Vector3(tx, ty, tz);
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rng.range(0, Math.PI * 2)
      );
      const scale = new THREE.Vector3(treeScale, treeScale, treeScale);
      mat.compose(pos, quat, scale);

      outTreeMatrices.push(mat);
    }
  }

  private generateStreetLamps(
    cx: number,
    cz: number,
    district: DistrictConfig,
    outLampMatrices: THREE.Matrix4[]
  ): void {
    const edges = this.roadIndex.getEdgesInChunk(cx, cz);
    if (edges.length === 0) return;

    const chunkSize = this.spec.chunkSize;
    const minChunkX = cx * chunkSize;
    const maxChunkX = (cx + 1) * chunkSize;
    const minChunkZ = cz * chunkSize;
    const maxChunkZ = (cz + 1) * chunkSize;

    const nodes = this.roadIndex.graph.nodes;
    const spacing = district.lampSpacing;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const nA = nodes[edge.fromNodeId];
      const nB = nodes[edge.toNodeId];

      const dx = nB.x - nA.x;
      const dz = nB.z - nA.z;
      const len = Math.hypot(dx, dz);
      if (len < spacing) continue;

      const dirX = dx / len;
      const dirZ = dz / len;
      const perpX = -dirZ;
      const perpZ = dirX;

      const lampDist = edge.width * 0.5 + 2.2; // Sidewalk / verge clearance
      const steps = Math.floor(len / spacing);

      for (let s = 1; s <= steps; s++) {
        const t = (s * spacing) / len;
        const distFromA = t * len;
        const distFromB = len - distFromA;

        // Skip positions near intersection junctions (prevent spawning inside crossing roadways)
        if (distFromA < 18 || distFromB < 18) {
          continue;
        }

        const cxPoint = nA.x + t * dx;
        const czPoint = nA.z + t * dz;

        // Strictly inside this chunk
        if (cxPoint < minChunkX || cxPoint >= maxChunkX || czPoint < minChunkZ || czPoint >= maxChunkZ) {
          continue;
        }

        // Place lamp on right-hand side of roadway
        const lampX = cxPoint + perpX * lampDist;
        const lampZ = czPoint + perpZ * lampDist;

        // Strict clearance check: ensure lamp is never inside any road or crossing intersection
        const nearest = this.roadIndex.getNearestRoad(lampX, lampZ, 48);
        if (nearest && nearest.distance < nearest.roadHalfWidth + 1.8) {
          continue; // REJECT: inside or too close to asphalt
        }

        const lampY = this.terrainHeight.groundHeightAt(lampX, lampZ);

        // Rotate so lamp arm (+X in local geometry) points inward towards roadway center (-perpX, -perpZ)
        const rotY = Math.atan2(perpZ, -perpX);

        const mat = new THREE.Matrix4();
        const pos = new THREE.Vector3(lampX, lampY, lampZ);
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        mat.compose(pos, quat, new THREE.Vector3(1, 1, 1));

        outLampMatrices.push(mat);
      }
    }
  }
}
