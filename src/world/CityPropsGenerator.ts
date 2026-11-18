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
import { BiomeType } from './WorldConfig';
import type { SpatialRoadIndex } from './RoadNetwork';
import { RoadClass } from './RoadNetwork';
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
  billboardMatrices: { poolIndex: number; matrix: THREE.Matrix4 }[];
  gantryMatrices: THREE.Matrix4[];
  bollardMatrices: THREE.Matrix4[];
  antennaMatrices: THREE.Matrix4[];
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
    const billboardMatrices: { poolIndex: number; matrix: THREE.Matrix4 }[] = [];
    const gantryMatrices: THREE.Matrix4[] = [];
    const bollardMatrices: THREE.Matrix4[] = [];
    const antennaMatrices: THREE.Matrix4[] = [];
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
      this.generateLots(cx, cz, district, rng, buildings, solidBoxes, billboardMatrices, antennaMatrices, landmark);
    }

    // ── 3. Trees Generation ───────────────────────────────────
    this.generateTrees(cx, cz, district, rng, buildings, treeMatrices, landmark);

    // ── 4. Street Lamps Generation ────────────────────────────
    this.generateStreetLamps(cx, cz, district, lampMatrices);

    // ── 5. Cyberpunk Highway Gantries Generation ──────────────
    this.generateHighwayGantries(cx, cz, gantryMatrices);

    // ── 6. Cyberpunk Street Bollards Generation ───────────────
    this.generateStreetBollards(cx, cz, district, bollardMatrices);

    return {
      buildings,
      treeMatrices,
      lampMatrices,
      billboardMatrices,
      gantryMatrices,
      bollardMatrices,
      antennaMatrices,
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
    outBillboards: { poolIndex: number; matrix: THREE.Matrix4 }[],
    outAntennas: THREE.Matrix4[],
    landmark?: LandmarkDef
  ): void {
    const chunkSize = this.spec.chunkSize;
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;

    // For Downtown, candidate lot centers correspond to the 64m block interiors
    // In each 128m chunk, blocks are centered at origin + 32m and origin + 96m
    const isDowntown = district.type === DistrictType.DOWNTOWN;
    const xCandidates: number[] = [];
    const zCandidates: number[] = [];

    if (isDowntown) {
      xCandidates.push(originX + 32, originX + 96);
      zCandidates.push(originZ + 32, originZ + 96);
    } else {
      const step = district.type === DistrictType.SUBURBAN ? 22 : district.type === DistrictType.INDUSTRIAL ? 40 : 28;
      const margin = 14;
      for (let x = originX + margin; x <= originX + chunkSize - margin; x += step) {
        xCandidates.push(x);
      }
      for (let z = originZ + margin; z <= originZ + chunkSize - margin; z += step) {
        zCandidates.push(z);
      }
    }

    for (let xi = 0; xi < xCandidates.length; xi++) {
      for (let zi = 0; zi < zCandidates.length; zi++) {
        const x = xCandidates[xi];
        const z = zCandidates[zi];
        const lotX = isDowntown ? x : (x + rng.range(-2.5, 2.5));
        const lotZ = isDowntown ? z : (z + rng.range(-2.5, 2.5));

        // Never place buildings underwater or in the ocean/lake
        if (this.terrainHeight.landforms && this.terrainHeight.landforms.isUnderwater(lotX, lotZ)) {
          continue;
        }

        // Mountain, slope & biome checks: NO houses or lots on mountains, rocky crags, or steep terrain!
        if (this.terrainHeight.landforms) {
          const lf = this.terrainHeight.landforms;
          const slope = lf.getSlope(lotX, lotZ);
          if (slope > 0.16) {
            continue; // Too steep for buildings/houses!
          }
          if (lf.getBiome(lotX, lotZ) === BiomeType.ROCK) {
            continue; // Rock biome: no buildings!
          }
          const groundElev = this.terrainHeight.groundHeightAt(lotX, lotZ);
          if (district.type === DistrictType.SUBURBAN && groundElev > 50.0) {
            continue; // No suburban houses on mountain elevations!
          }
        }

        // Keep 30m safe clearance around vehicle spawn point
        if (Math.hypot(lotX, lotZ - 32) < 30) {
          continue;
        }

        // Clearance from landmarks
        if (landmark) {
          const distToLandmark = Math.hypot(lotX - landmark.x, lotZ - landmark.z);
          if (distToLandmark < 55) continue;
        }

        // Query nearest road
        const nearest = this.roadIndex.getNearestRoad(lotX, lotZ, 64);
        if (!nearest) continue;

        // Size & Footprint
        let lotSize = Math.round(rng.range(district.minLotSize, district.maxLotSize));
        let width = lotSize;
        let depth = lotSize;
        let lotRadius = Math.hypot(width * 0.5, depth * 0.5);

        // Check if lot fits with setback; if slightly too large, scale down to fit
        const maxAvailableRadius = nearest.distance - nearest.roadHalfWidth - district.setback;
        if (maxAvailableRadius < 5.0) continue;
        if (lotRadius > maxAvailableRadius) {
          const maxW = Math.floor(maxAvailableRadius / 0.7071);
          if (maxW < 8) continue;
          width = Math.min(width, maxW);
          depth = width;
          lotRadius = Math.hypot(width * 0.5, depth * 0.5);
        }

        // Strict road clearance check:
        // Distance to road centerline MUST exceed roadHalfWidth + lotRadius
        if (nearest.distance < nearest.roadHalfWidth + lotRadius) {
          continue; // REJECT: Overlaps road or road buffer
        }

        // Building Height & Style
        const height = Math.round(rng.range(district.minHeight, district.maxHeight));
        const style = rng.choice(district.styles);

        // Ground elevation
        const groundY = this.terrainHeight.groundHeightAt(lotX, lotZ);
        if (groundY <= 1.0) continue; // Never place at or below sea level
        const centerY = groundY + height * 0.5;

        // Building orientation: snap to nearest cardinal street axis
        const dx = nearest.projectedX - lotX;
        const dz = nearest.projectedZ - lotZ;
        const rotY = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : (dz > 0 ? 0 : Math.PI);

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

        // Cyberpunk Rooftop Neon Billboards (Commercial & Downtown high-rises)
        if (height >= 30 && rng.next() > 0.35) {
          const bbY = groundY + height;
          const bbMat = new THREE.Matrix4();
          const bbPos = new THREE.Vector3(lotX, bbY, lotZ);
          const bbQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
          bbMat.compose(bbPos, bbQuat, new THREE.Vector3(1, 1, 1));
          outBillboards.push({ poolIndex: Math.floor(rng.range(0, 2)), matrix: bbMat });
        }

        // Cyberpunk Rooftop Communication Spire / Antennas with glowing red beacons
        if ((height >= 36 || district.type === DistrictType.INDUSTRIAL) && rng.next() > 0.40) {
          const antY = groundY + height;
          const antMat = new THREE.Matrix4();
          const antPos = new THREE.Vector3(lotX + rng.range(-2, 2), antY, lotZ + rng.range(-2, 2));
          antMat.compose(antPos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
          outAntennas.push(antMat);
        }
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

      // Never place trees underwater
      if (this.terrainHeight.landforms && this.terrainHeight.landforms.isUnderwater(tx, tz)) continue;

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

        // Never place street lamps underwater
        if (this.terrainHeight.landforms && this.terrainHeight.landforms.isUnderwater(lampX, lampZ)) {
          continue;
        }

        const lampY = this.terrainHeight.groundHeightAt(lampX, lampZ);
        if (lampY <= 0.8) continue;

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

  private generateHighwayGantries(
    cx: number,
    cz: number,
    outGantryMatrices: THREE.Matrix4[]
  ): void {
    const edges = this.roadIndex.getEdgesInChunk(cx, cz);
    if (edges.length === 0) return;

    const chunkSize = this.spec.chunkSize;
    const minChunkX = cx * chunkSize;
    const maxChunkX = (cx + 1) * chunkSize;
    const minChunkZ = cz * chunkSize;
    const maxChunkZ = (cz + 1) * chunkSize;
    const nodes = this.roadIndex.graph.nodes;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (edge.roadClass !== RoadClass.HIGHWAY && edge.roadClass !== RoadClass.AVENUE) continue;

      const nA = nodes[edge.fromNodeId];
      const nB = nodes[edge.toNodeId];
      const dx = nB.x - nA.x;
      const dz = nB.z - nA.z;
      const len = Math.hypot(dx, dz);
      if (len < 100) continue;

      // Place in the middle of long segments
      const t = 0.5;
      const gX = nA.x + t * dx;
      const gZ = nA.z + t * dz;

      if (gX < minChunkX || gX >= maxChunkX || gZ < minChunkZ || gZ >= maxChunkZ) continue;

      const gY = this.terrainHeight.groundHeightAt(gX, gZ);
      const rotY = Math.atan2(dx, dz); // Aligned across roadway

      const mat = new THREE.Matrix4();
      const pos = new THREE.Vector3(gX, gY, gZ);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      mat.compose(pos, quat, new THREE.Vector3(1, 1, 1));
      outGantryMatrices.push(mat);
    }
  }

  private generateStreetBollards(
    cx: number,
    cz: number,
    district: DistrictConfig,
    outBollardMatrices: THREE.Matrix4[]
  ): void {
    if (district.type !== DistrictType.DOWNTOWN && district.type !== DistrictType.MIDRISE) return;
    const edges = this.roadIndex.getEdgesInChunk(cx, cz);
    if (edges.length === 0) return;

    const chunkSize = this.spec.chunkSize;
    const minChunkX = cx * chunkSize;
    const maxChunkX = (cx + 1) * chunkSize;
    const minChunkZ = cz * chunkSize;
    const maxChunkZ = (cz + 1) * chunkSize;
    const nodes = this.roadIndex.graph.nodes;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const nA = nodes[edge.fromNodeId];
      const nB = nodes[edge.toNodeId];
      const dx = nB.x - nA.x;
      const dz = nB.z - nA.z;
      const len = Math.hypot(dx, dz);
      if (len < 60) continue;

      const dirX = dx / len;
      const dirZ = dz / len;
      const perpX = -dirZ;
      const perpZ = dirX;

      const bollardDist = edge.width * 0.5 + 1.2;

      // Place bollards near start and end of block on both sides
      const ts = [24 / len, 1 - 24 / len];
      for (const t of ts) {
        if (t <= 0 || t >= 1) continue;
        for (const side of [-1, 1]) {
          const bX = nA.x + t * dx + perpX * bollardDist * side;
          const bZ = nA.z + t * dz + perpZ * bollardDist * side;

          if (bX < minChunkX || bX >= maxChunkX || bZ < minChunkZ || bZ >= maxChunkZ) continue;

          const bY = this.terrainHeight.groundHeightAt(bX, bZ);
          const mat = new THREE.Matrix4();
          mat.compose(new THREE.Vector3(bX, bY, bZ), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
          outBollardMatrices.push(mat);
        }
      }
    }
  }
}
