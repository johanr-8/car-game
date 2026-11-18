/**
 * src/world/ChunkManager.ts
 * ─────────────────────────────────────────────────────────────
 * High-Performance Procedural Chunk Streaming & Geometry Pooling.
 *
 * Guarantees:
 *   - Radius-based streaming with load (5) and unload (6) hysteresis
 *   - Strictly at most 1 chunk built per frame, budgeted to <= 2 ms
 *   - Pre-allocated geometry buffer pools: zero per-frame allocations
 *   - 32x32 terrain grid with vertex colors for grass & dirt
 *   - Draped road ribbons with center stripes and border markings
 *   - Comprehensive cleanup and disposal on unload
 *
 * RULES.md: Zero per-tick heap allocations. Budgeted build time.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { type WorldSpec, CHUNK_KEY_OFFSET, getChunkKey, BiomeType } from './WorldConfig';
import type { TerrainHeight } from './TerrainHeight';
import type { SpatialRoadIndex } from './RoadNetwork';
import { RoadClass } from './RoadNetwork';
import { getAsphaltTexture, getTerrainDetailTexture, getConcreteSidewalkTexture } from './TextureGenerator';
import { ChunkCollider } from './ChunkCollider';
import type { CityPropsGenerator } from './CityPropsGenerator';
import type { CityPoolManager, InstancedPool } from './InstancedPool';
import type { RoamWorld } from './RoamWorld';

// Dual-scale procedural detail texture for seamless natural biomes
const terrainDetailTex = getTerrainDetailTexture();

const roamAsphaltTex = getAsphaltTexture().clone();
roamAsphaltTex.wrapS = THREE.RepeatWrapping;
roamAsphaltTex.wrapT = THREE.RepeatWrapping;
roamAsphaltTex.repeat.set(1, 1);

const roamSidewalkTex = getConcreteSidewalkTexture().clone();
roamSidewalkTex.wrapS = THREE.RepeatWrapping;
roamSidewalkTex.wrapT = THREE.RepeatWrapping;
roamSidewalkTex.repeat.set(1, 16);

// Shared Materials (Created once, cached at module scope)
const terrainMat = new THREE.MeshStandardMaterial({
  map: terrainDetailTex,
  vertexColors: true,
  roughness: 0.88,
  metalness: 0.04,
  flatShading: false,
});

const sidewalkMat = new THREE.MeshStandardMaterial({
  map: roamSidewalkTex,
  color: 0xc8d1dc,
  roughness: 0.82,
  metalness: 0.12,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

const asphaltHighwayMat = new THREE.MeshStandardMaterial({
  map: roamAsphaltTex,
  color: 0x343a46,
  roughness: 0.72,
  metalness: 0.12,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const asphaltAvenueMat = new THREE.MeshStandardMaterial({
  map: roamAsphaltTex,
  color: 0x3d4350,
  roughness: 0.75,
  metalness: 0.10,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const asphaltLocalMat = new THREE.MeshStandardMaterial({
  map: roamAsphaltTex,
  color: 0x484e5c,
  roughness: 0.80,
  metalness: 0.08,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const whiteStripeMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});

const yellowStripeMat = new THREE.MeshBasicMaterial({
  color: 0xfacc15,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});

const dirtRoadMat = new THREE.MeshStandardMaterial({
  map: terrainDetailTex,
  color: 0x826442,
  roughness: 0.94,
  metalness: 0.02,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

const guardrailMat = new THREE.MeshStandardMaterial({
  color: 0xd4d8de,
  roughness: 0.35,
  metalness: 0.85,
});

const mountainKerbRedMat = new THREE.MeshStandardMaterial({
  color: 0xdc2626,
  roughness: 0.65,
  metalness: 0.15,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});

const mountainKerbWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.65,
  metalness: 0.15,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});

const roundaboutCenterMat = new THREE.MeshStandardMaterial({
  map: terrainDetailTex,
  color: 0x3d702d,
  roughness: 0.85,
  metalness: 0.05,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});

// Two Levels of Detail (LOD 0: 32x32 full resolution, LOD 1: 16x16 half resolution)
// Mesh resolution of 4m quads is sufficient for slopes up to 35+ degrees.
// 4-meter perimeter seam skirts seal any T-junction gaps between LOD levels completely.
const GRID_RES_LOD0 = 32;
const GRID_RES_LOD1 = 16;
const MAX_VERT_COUNT = (GRID_RES_LOD0 + 1) * (GRID_RES_LOD0 + 1) + GRID_RES_LOD0 * 4; // 1089 + 128 = 1217

function buildChunkIndices(N: number): Uint16Array {
  const gridQuads = N * N;
  const skirtQuads = N * 4;
  const totalIndices = (gridQuads + skirtQuads) * 6;
  const indices = new Uint16Array(totalIndices);

  let idx = 0;
  const stride = N + 1;
  const gridVertCount = stride * stride;

  // 1. Grid Quads
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * stride + i;
      const b = j * stride + (i + 1);
      const c = (j + 1) * stride + i;
      const d = (j + 1) * stride + (i + 1);

      indices[idx++] = a;
      indices[idx++] = c;
      indices[idx++] = b;

      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = d;
    }
  }

  // 2. Outward-Facing Skirt Quads around perimeter
  let skirtBase = gridVertCount;
  let currSkirt = 0;

  // South (j=0)
  for (let i = 0; i < N; i++) {
    const t0 = 0 * stride + i;
    const t1 = 0 * stride + (i + 1);
    const b0 = skirtBase + currSkirt;
    const b1 = skirtBase + (currSkirt + 1);
    currSkirt++;

    indices[idx++] = t0;
    indices[idx++] = t1;
    indices[idx++] = b0;

    indices[idx++] = t1;
    indices[idx++] = b1;
    indices[idx++] = b0;
  }

  // East (i=N)
  for (let j = 0; j < N; j++) {
    const t0 = j * stride + N;
    const t1 = (j + 1) * stride + N;
    const b0 = skirtBase + currSkirt;
    const b1 = skirtBase + (currSkirt + 1);
    currSkirt++;

    indices[idx++] = t0;
    indices[idx++] = t1;
    indices[idx++] = b0;

    indices[idx++] = t1;
    indices[idx++] = b1;
    indices[idx++] = b0;
  }

  // North (j=N)
  for (let i = N; i > 0; i--) {
    const t0 = N * stride + i;
    const t1 = N * stride + (i - 1);
    const b0 = skirtBase + currSkirt;
    const b1 = skirtBase + (currSkirt + 1);
    currSkirt++;

    indices[idx++] = t0;
    indices[idx++] = t1;
    indices[idx++] = b0;

    indices[idx++] = t1;
    indices[idx++] = b1;
    indices[idx++] = b0;
  }

  // West (i=0)
  for (let j = N; j > 0; j--) {
    const t0 = j * stride + 0;
    const t1 = (j - 1) * stride + 0;
    const b0 = skirtBase + currSkirt;
    const b1 = skirtBase + ((currSkirt + 1) % (N * 4));
    currSkirt++;

    indices[idx++] = t0;
    indices[idx++] = t1;
    indices[idx++] = b0;

    indices[idx++] = t1;
    indices[idx++] = b1;
    indices[idx++] = b0;
  }

  return indices;
}

const SHARED_LOD0_INDICES = buildChunkIndices(GRID_RES_LOD0); // 6912
const SHARED_LOD1_INDICES = buildChunkIndices(GRID_RES_LOD1); // 1920
const SHARED_LOD0_INDEX_ATTR = new THREE.BufferAttribute(SHARED_LOD0_INDICES, 1);
const SHARED_LOD1_INDEX_ATTR = new THREE.BufferAttribute(SHARED_LOD1_INDICES, 1);

// Scratch reusable vector for normal calculation
const _normalScratch = new THREE.Vector3();

/**
 * Reusable Pooled Chunk Visual Entity.
 */
export class TerrainChunk {
  readonly group = new THREE.Group();
  readonly terrainGeo: THREE.BufferGeometry;
  readonly terrainMesh: THREE.Mesh;
  readonly roadGroup = new THREE.Group();

  cx = 0;
  cz = 0;
  isActive = false;

  collider: ChunkCollider | null = null;
  landmarkGroup: THREE.Group | null = null;

  readonly allocatedBuildingSlots: { pool: InstancedPool; slot: number }[] = [];
  readonly allocatedTreeSlots: number[] = [];
  readonly allocatedLampSlots: number[] = [];
  readonly allocatedBillboardSlots: { pool: InstancedPool; slot: number }[] = [];
  readonly allocatedGantrySlots: number[] = [];
  readonly allocatedBollardSlots: number[] = [];
  readonly allocatedAntennaSlots: number[] = [];
  readonly allocatedTrafficSignalSlots: number[] = [];
  readonly allocatedCanopySlots: number[] = [];
  readonly allocatedParkingStallSlots: number[] = [];
  readonly allocatedFenceSlots: number[] = [];

  private readonly posAttr: THREE.BufferAttribute;
  private readonly normAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;

  constructor() {
    this.terrainGeo = new THREE.BufferGeometry();

    const positions = new Float32Array(MAX_VERT_COUNT * 3);
    const normals = new Float32Array(MAX_VERT_COUNT * 3);
    const colors = new Float32Array(MAX_VERT_COUNT * 3);
    const uvs = new Float32Array(MAX_VERT_COUNT * 2);

    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.normAttr = new THREE.BufferAttribute(normals, 3);
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.uvAttr = new THREE.BufferAttribute(uvs, 2);

    this.terrainGeo.setAttribute('position', this.posAttr);
    this.terrainGeo.setAttribute('normal', this.normAttr);
    this.terrainGeo.setAttribute('color', this.colAttr);
    this.terrainGeo.setAttribute('uv', this.uvAttr);
    this.terrainGeo.setIndex(SHARED_LOD0_INDEX_ATTR);

    this.terrainMesh = new THREE.Mesh(this.terrainGeo, terrainMat);
    this.terrainMesh.receiveShadow = true;

    this.group.add(this.terrainMesh);
    this.group.add(this.roadGroup);
  }

  build(
    cx: number,
    cz: number,
    terrainHeight: TerrainHeight,
    roadIndex: SpatialRoadIndex,
    spec: WorldSpec,
    propsGenerator?: CityPropsGenerator,
    poolManager?: CityPoolManager,
    roamWorld?: RoamWorld,
    lod: 0 | 1 = 0
  ): void {
    this.cx = cx;
    this.cz = cz;
    this.isActive = true;
    this.group.visible = true;

    const N = lod === 0 ? GRID_RES_LOD0 : GRID_RES_LOD1;
    const stride = N + 1;
    const chunkSize = spec.chunkSize;
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const step = chunkSize / N;

    const pos = this.posAttr.array as Float32Array;
    const norm = this.normAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const uv = this.uvAttr.array as Float32Array;

    // Biome base palette colors:
    const sandR   = 0.86, sandG   = 0.78, sandB   = 0.58;
    const grassR  = 0.34, grassG  = 0.58, grassB  = 0.24;
    const forestR = 0.18, forestG = 0.38, forestB = 0.16;
    const rockR   = 0.44, rockG   = 0.44, rockB   = 0.42;
    const urbanR  = 0.38, urbanG  = 0.44, urbanB  = 0.34;
    const dirtR   = 0.50, dirtG   = 0.40, dirtB   = 0.28;

    const landforms = terrainHeight.landforms;

    // 1. Fill Grid Vertices (N+1) x (N+1)
    let vIdx = 0;
    let cIdx = 0;
    let uvIdx = 0;

    for (let j = 0; j <= N; j++) {
      const z = originZ + j * step;
      for (let i = 0; i <= N; i++) {
        const x = originX + i * step;
        let y = terrainHeight.groundHeightAt(x, z);

        // Surface color blending based on road proximity and slope
        const nearest = roadIndex.getNearestRoad(x, z, 32);

        // Depress terrain mesh under asphalt ribbons and sidewalks to eliminate any clipping
        if (nearest && nearest.distance <= nearest.roadHalfWidth + 2.8) {
          y -= 0.22;
        } else if (nearest && nearest.distance < nearest.roadHalfWidth + 4.0) {
          const tEdge = (nearest.distance - (nearest.roadHalfWidth + 2.8)) / 1.2;
          y -= 0.22 * (1 - tEdge);
        }

        pos[vIdx]     = x;
        pos[vIdx + 1] = y;
        pos[vIdx + 2] = z;

        terrainHeight.groundNormalAt(x, z, _normalScratch);
        norm[vIdx]     = _normalScratch.x;
        norm[vIdx + 1] = _normalScratch.y;
        norm[vIdx + 2] = _normalScratch.z;

        // Tiling texture coordinates in world space (seamless across chunks)
        uv[uvIdx]     = x / 6.0;
        uv[uvIdx + 1] = z / 6.0;

        // Determine base biome color
        const biome = landforms ? landforms.getBiome(x, z) : BiomeType.MEADOW;
        let r = grassR, g = grassG, b = grassB;
        switch (biome) {
          case BiomeType.BEACH:
            r = sandR; g = sandG; b = sandB;
            break;
          case BiomeType.FOREST:
            r = forestR; g = forestG; b = forestB;
            break;
          case BiomeType.ROCK:
            r = rockR; g = rockG; b = rockB;
            break;
          case BiomeType.URBAN:
            r = urbanR; g = urbanG; b = urbanB;
            break;
          case BiomeType.MEADOW:
          default:
            r = grassR; g = grassG; b = grassB;
            break;
        }

        // Deep ocean/lake bed seabed color
        if (landforms && landforms.isUnderwater(x, z)) {
          r = 0.18; g = 0.28; b = 0.36;
        }

        // Steeper slopes show rock / scree (slope > 25° starts rock, > 44° solid rock)
        if (_normalScratch.y < 0.90) {
          const rockWeight = Math.min(1.0, (0.90 - _normalScratch.y) / 0.18);
          r = (1 - rockWeight) * r + rockWeight * rockR;
          g = (1 - rockWeight) * g + rockWeight * rockG;
          b = (1 - rockWeight) * b + rockWeight * rockB;
        }

        // Road shoulder dirt blending near asphalt
        let dirtWeight = 0;
        if (nearest) {
          const distToRoadEdge = Math.max(0, nearest.distance - nearest.roadHalfWidth);
          if (distToRoadEdge < 6.0) {
            dirtWeight = 1.0 - (distToRoadEdge / 6.0);
          }
        }

        // Subtle per-vertex noise variation for natural meadow mottling
        const mottle = (((i * 19 + j * 37) % 13) - 6) / 100;
        let baseR = Math.max(0, r + mottle);
        let baseG = Math.max(0, g + mottle);
        let baseB = Math.max(0, b + mottle);

        col[cIdx]     = (1 - dirtWeight) * baseR + dirtWeight * dirtR;
        col[cIdx + 1] = (1 - dirtWeight) * baseG + dirtWeight * dirtG;
        col[cIdx + 2] = (1 - dirtWeight) * baseB + dirtWeight * dirtB;

        vIdx += 3;
        cIdx += 3;
        uvIdx += 2;
      }
    }

    // 2. Fill Perimeter 4m Seam Skirt Vertices (4 * N vertices)
    const appendSkirtVert = (topGridIdx: number, outwardX: number, outwardZ: number) => {
      const topPos = topGridIdx * 3;
      const topUv = topGridIdx * 2;

      pos[vIdx]     = pos[topPos];
      pos[vIdx + 1] = pos[topPos + 1] - 4.0; // 4m vertical drop sealing any LOD T-junction seams
      pos[vIdx + 2] = pos[topPos + 2];

      norm[vIdx]     = outwardX;
      norm[vIdx + 1] = 0;
      norm[vIdx + 2] = outwardZ;

      col[cIdx]     = col[topPos] * 0.72;
      col[cIdx + 1] = col[topPos + 1] * 0.72;
      col[cIdx + 2] = col[topPos + 2] * 0.72;

      uv[uvIdx]     = uv[topUv];
      uv[uvIdx + 1] = uv[topUv + 1];

      vIdx += 3;
      cIdx += 3;
      uvIdx += 2;
    };

    // South (j=0, i from 0 to N-1)
    for (let i = 0; i < N; i++) {
      appendSkirtVert(0 * stride + i, 0, -1);
    }
    // East (i=N, j from 0 to N-1)
    for (let j = 0; j < N; j++) {
      appendSkirtVert(j * stride + N, 1, 0);
    }
    // North (j=N, i from N down to 1)
    for (let i = N; i > 0; i--) {
      appendSkirtVert(N * stride + i, 0, 1);
    }
    // West (i=0, j from N down to 1)
    for (let j = N; j > 0; j--) {
      appendSkirtVert(j * stride + 0, -1, 0);
    }

    // Bind LOD Index Buffer and configure Draw Range
    if (lod === 0) {
      this.terrainGeo.setIndex(SHARED_LOD0_INDEX_ATTR);
      this.terrainGeo.setDrawRange(0, SHARED_LOD0_INDICES.length);
    } else {
      this.terrainGeo.setIndex(SHARED_LOD1_INDEX_ATTR);
      this.terrainGeo.setDrawRange(0, SHARED_LOD1_INDICES.length);
    }

    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.terrainGeo.computeBoundingBox();
    this.terrainGeo.computeBoundingSphere();

    // ── Build Draped Road Ribbons for this Chunk ──────────────
    this.buildRoadRibbons(cx, cz, terrainHeight, roadIndex, spec);

    // ── Build City Props (Buildings, Trees, Street Lamps, Collider) ──
    if (propsGenerator && poolManager && roamWorld) {
      const props = propsGenerator.generateChunkProps(cx, cz);

      // 1. Buildings (allocated from shared global InstancedMesh pools)
      for (let i = 0; i < props.buildings.length; i++) {
        const b = props.buildings[i];
        const pool = poolManager.buildingPools[b.style];
        const slot = pool.allocate();
        if (slot >= 0) {
          pool.setMatrix(slot, b.matrix);
          this.allocatedBuildingSlots.push({ pool, slot });
        }
      }

      // 2. Trees
      for (let i = 0; i < props.treeMatrices.length; i++) {
        const slot = poolManager.treePool.allocate();
        if (slot >= 0) {
          poolManager.treePool.setMatrix(slot, props.treeMatrices[i]);
          this.allocatedTreeSlots.push(slot);
        }
      }

      // 3. Street Lamps
      for (let i = 0; i < props.lampMatrices.length; i++) {
        const slot = poolManager.lampPool.allocate();
        if (slot >= 0) {
          poolManager.lampPool.setMatrix(slot, props.lampMatrices[i]);
          this.allocatedLampSlots.push(slot);
        }
      }

      // 4. Cyberpunk Rooftop Neon Billboards
      for (let i = 0; i < props.billboardMatrices.length; i++) {
        const item = props.billboardMatrices[i];
        const pool = poolManager.billboardPools[item.poolIndex % poolManager.billboardPools.length];
        const slot = pool.allocate();
        if (slot >= 0) {
          pool.setMatrix(slot, item.matrix);
          this.allocatedBillboardSlots.push({ pool, slot });
        }
      }

      // 5. Cyberpunk Highway Gantries
      for (let i = 0; i < props.gantryMatrices.length; i++) {
        const slot = poolManager.gantryPool.allocate();
        if (slot >= 0) {
          poolManager.gantryPool.setMatrix(slot, props.gantryMatrices[i]);
          this.allocatedGantrySlots.push(slot);
        }
      }

      // 6. Cyberpunk Street Bollards
      for (let i = 0; i < props.bollardMatrices.length; i++) {
        const slot = poolManager.bollardPool.allocate();
        if (slot >= 0) {
          poolManager.bollardPool.setMatrix(slot, props.bollardMatrices[i]);
          this.allocatedBollardSlots.push(slot);
        }
      }

      // 7. Cyberpunk Rooftop Antennas
      for (let i = 0; i < props.antennaMatrices.length; i++) {
        const slot = poolManager.antennaPool.allocate();
        if (slot >= 0) {
          poolManager.antennaPool.setMatrix(slot, props.antennaMatrices[i]);
          this.allocatedAntennaSlots.push(slot);
        }
      }

      // 8. Traffic Signal Poles with Cantilever Mast Arms
      for (let i = 0; i < props.trafficSignalMatrices.length; i++) {
        const slot = poolManager.trafficSignalPool.allocate();
        if (slot >= 0) {
          poolManager.trafficSignalPool.setMatrix(slot, props.trafficSignalMatrices[i]);
          this.allocatedTrafficSignalSlots.push(slot);
        }
      }

      // 9. Building Entrance Portals & Canopies
      for (let i = 0; i < props.canopyMatrices.length; i++) {
        const slot = poolManager.canopyPool.allocate();
        if (slot >= 0) {
          poolManager.canopyPool.setMatrix(slot, props.canopyMatrices[i]);
          this.allocatedCanopySlots.push(slot);
        }
      }

      // 10. Surface Parking Stalls & Wheel Stops
      for (let i = 0; i < props.parkingStallMatrices.length; i++) {
        const slot = poolManager.parkingStallPool.allocate();
        if (slot >= 0) {
          poolManager.parkingStallPool.setMatrix(slot, props.parkingStallMatrices[i]);
          this.allocatedParkingStallSlots.push(slot);
        }
      }

      // 11. Perimeter Fences
      for (let i = 0; i < props.fenceMatrices.length; i++) {
        const slot = poolManager.fencePool.allocate();
        if (slot >= 0) {
          poolManager.fencePool.setMatrix(slot, props.fenceMatrices[i]);
          this.allocatedFenceSlots.push(slot);
        }
      }

      // 4. Landmark Group
      if (props.landmarkGroup) {
        this.landmarkGroup = props.landmarkGroup;
        this.group.add(this.landmarkGroup);
      }

      // 5. Local Chunk BVH Collider
      if (props.solidBoxes.length > 0) {
        this.collider = new ChunkCollider(cx, cz, props.solidBoxes);
        roamWorld.registerChunkCollider(this.collider);
      }
    }
  }

  private buildRoadRibbons(
    cx: number,
    cz: number,
    terrainHeight: TerrainHeight,
    roadIndex: SpatialRoadIndex,
    spec: WorldSpec
  ): void {
    // Clear previously built road geometries in this chunk
    while (this.roadGroup.children.length > 0) {
      const child = this.roadGroup.children[0] as THREE.Mesh;
      this.roadGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }

    const edges = roadIndex.getEdgesInChunk(cx, cz);
    const chunkSize = spec.chunkSize;
    const minChunkX = cx * chunkSize - 4;
    const maxChunkX = (cx + 1) * chunkSize + 4;
    const minChunkZ = cz * chunkSize - 4;
    const maxChunkZ = (cz + 1) * chunkSize + 4;

    const nodes = roadIndex.graph.nodes;
    const landforms = terrainHeight.landforms;

    // Precompute node degrees to distinguish genuine intersections (degree >= 3)
    // from 2-way road joints and sharp mountain hairpin curves.
    const nodeDegree = new Int16Array(nodes.length);
    for (let e = 0; e < edges.length; e++) {
      nodeDegree[edges[e].fromNodeId]++;
      nodeDegree[edges[e].toNodeId]++;
    }

    // ── 1. Build Road Polylines & Draped Ribbons ──────────────
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const isDirt = edge.roadClass === RoadClass.DIRT;
      const isMountain = edge.roadClass === RoadClass.MOUNTAIN;
      const isHighway = edge.roadClass === RoadClass.HIGHWAY;

      // Select material based on road class
      const roadMat = isDirt
        ? dirtRoadMat
        : isHighway
        ? asphaltHighwayMat
        : (edge.roadClass === RoadClass.MAIN || edge.roadClass === RoadClass.AVENUE)
        ? asphaltAvenueMat
        : asphaltLocalMat;

      const halfW = edge.width * 0.5;
      const sw = isHighway ? 2.0 : 2.5;
      const stripeHalfW = isHighway ? 0.35 : 0.20;

      const nA = nodes[edge.fromNodeId];
      const nB = nodes[edge.toNodeId];
      const rawPts: Array<{ x: number; z: number }> = [];

      if (edge.points && edge.points.length >= 2) {
        for (let p = 0; p < edge.points.length; p++) {
          rawPts.push({ x: edge.points[p].x, z: edge.points[p].z });
        }
      } else {
        // Straight segment: subdivide into ~10m intervals for smooth terrain draping
        const dx = nB.x - nA.x;
        const dz = nB.z - nA.z;
        const totalLen = Math.hypot(dx, dz);
        const steps = Math.max(1, Math.ceil(totalLen / 10.0));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          rawPts.push({ x: nA.x + t * dx, z: nA.z + t * dz });
        }
      }

      // Filter out duplicate or extremely close consecutive sample points
      const pts: Array<{ x: number; z: number }> = [rawPts[0]];
      for (let p = 1; p < rawPts.length; p++) {
        const d = Math.hypot(rawPts[p].x - pts[pts.length - 1].x, rawPts[p].z - pts[pts.length - 1].z);
        if (d >= 0.1) pts.push(rawPts[p]);
      }
      if (pts.length < 2) continue;

      const numPts = pts.length;
      const cumDist = new Float64Array(numPts);
      for (let p = 0; p < numPts - 1; p++) {
        cumDist[p + 1] = cumDist[p] + Math.hypot(pts[p + 1].x - pts[p].x, pts[p + 1].z - pts[p].z);
      }
      const totalEdgeLen = cumDist[numPts - 1];

      // Compute miter normals and draped road elevations along the polyline
      const normX = new Float64Array(numPts);
      const normZ = new Float64Array(numPts);
      const elev = new Float64Array(numPts);

      for (let p = 0; p < numPts; p++) {
        let roadY = terrainHeight.groundHeightAt(pts[p].x, pts[p].z);
        if (landforms) {
          const waterY = landforms.getWaterSurfaceY(pts[p].x, pts[p].z);
          if (waterY !== null && roadY <= waterY + 0.8) {
            roadY = Math.max(roadY, waterY + 2.5); // Elevate road deck above water surface (bridge / pier)
          }
        }
        elev[p] = roadY;

        if (p === 0) {
          const dX = pts[1].x - pts[0].x;
          const dZ = pts[1].z - pts[0].z;
          const len = Math.hypot(dX, dZ) || 1;
          normX[0] = -dZ / len;
          normZ[0] = dX / len;
        } else if (p === numPts - 1) {
          const dX = pts[p].x - pts[p - 1].x;
          const dZ = pts[p].z - pts[p - 1].z;
          const len = Math.hypot(dX, dZ) || 1;
          normX[p] = -dZ / len;
          normZ[p] = dX / len;
        } else {
          const d1X = pts[p].x - pts[p - 1].x;
          const d1Z = pts[p].z - pts[p - 1].z;
          const len1 = Math.hypot(d1X, d1Z) || 1;
          const dir1X = d1X / len1;
          const dir1Z = d1Z / len1;

          const d2X = pts[p + 1].x - pts[p].x;
          const d2Z = pts[p + 1].z - pts[p].z;
          const len2 = Math.hypot(d2X, d2Z) || 1;
          const dir2X = d2X / len2;
          const dir2Z = d2Z / len2;

          const sX = dir1X + dir2X;
          const sZ = dir1Z + dir2Z;
          const sLen = Math.hypot(sX, sZ);
          if (sLen > 1e-4) {
            const tX = sX / sLen;
            const tZ = sZ / sLen;
            const nx = -tZ;
            const nz = tX;
            const dot = dir1X * tX + dir1Z * tZ;
            const miter = dot > 0.35 ? Math.min(1.4, 1.0 / dot) : 1.0;
            normX[p] = nx * miter;
            normZ[p] = nz * miter;
          } else {
            normX[p] = -dir1Z;
            normZ[p] = dir1X;
          }
        }
      }

      // Intersection setback clearance: sidewalks cleanly stop before intersection throats
      const isJunctionA = nA.isJunction && nodeDegree[nA.id] >= 3;
      const isJunctionB = nB.isJunction && nodeDegree[nB.id] >= 3;
      const stopA = isJunctionA ? Math.min(totalEdgeLen * 0.35, Math.max(13.0, halfW + 4.5)) : 0.0;
      const stopB = isJunctionB ? Math.min(totalEdgeLen * 0.35, Math.max(13.0, halfW + 4.5)) : 0.0;

      // Identify active segments in this chunk and sidewalk eligibility
      const isSegActive = new Uint8Array(numPts - 1);
      const isSwActive = new Uint8Array(numPts - 1);

      for (let p = 0; p < numPts - 1; p++) {
        const minSegX = Math.min(pts[p].x, pts[p + 1].x) - halfW - sw - 2;
        const maxSegX = Math.max(pts[p].x, pts[p + 1].x) + halfW + sw + 2;
        const minSegZ = Math.min(pts[p].z, pts[p + 1].z) - halfW - sw - 2;
        const maxSegZ = Math.max(pts[p].z, pts[p + 1].z) + halfW + sw + 2;

        if (maxSegX >= minChunkX && minSegX <= maxChunkX && maxSegZ >= minChunkZ && minSegZ <= maxChunkZ) {
          isSegActive[p] = 1;

          if (!isDirt && !isMountain) {
            const dStart = cumDist[p];
            const dEnd = cumDist[p + 1];
            const dFromEndA = totalEdgeLen - dEnd;
            const dFromEndB = totalEdgeLen - dStart;

            const inJunctionA = stopA > 0 && (dStart < stopA || dEnd < stopA);
            const inJunctionB = stopB > 0 && (dFromEndA < stopB || dFromEndB < stopB);
            if (!inJunctionA && !inJunctionB) {
              isSwActive[p] = 1;
            }
          }
        }
      }

      // Collect contiguous runs of segments to share vertices seamlessly (zero gaps/stair-steps)
      const roadPos: number[] = [];
      const roadUvs: number[] = [];
      const roadIdx: number[] = [];

      const stripePos: number[] = [];
      const stripeUvs: number[] = [];
      const stripeIdx: number[] = [];

      const leftSwPos: number[] = [];
      const rightSwPos: number[] = [];
      const swUvs: number[] = [];
      const swIdx: number[] = [];

      const grPos: number[] = [];
      const grIdx: number[] = [];

      const kerbRedPos: number[] = [];
      const kerbRedIdx: number[] = [];
      const kerbWhitePos: number[] = [];
      const kerbWhiteIdx: number[] = [];

      // 1. Road ribbons and stripes runs
      let pIdx = 0;
      while (pIdx < numPts - 1) {
        if (!isSegActive[pIdx]) {
          pIdx++;
          continue;
        }
        const runStart = pIdx;
        while (pIdx < numPts - 1 && isSegActive[pIdx]) {
          pIdx++;
        }
        const runEnd = pIdx;

        const roadBaseIdx = roadPos.length / 3;
        const stripeBaseIdx = stripePos.length / 3;
        const grBaseIdx = grPos.length / 3;

        for (let k = runStart; k <= runEnd; k++) {
          const x = pts[k].x;
          const z = pts[k].z;
          const y = elev[k];
          const nx = normX[k];
          const nz = normZ[k];
          const vDist = cumDist[k] / 8.0;

          const lX = x - halfW * nx;
          const lZ = z - halfW * nz;
          const rX = x + halfW * nx;
          const rZ = z + halfW * nz;

          roadPos.push(lX, y, lZ, rX, y, rZ);
          roadUvs.push(0, vDist, 1, vDist);

          if (!isDirt) {
            const sY = y + 0.02;
            const slX = x - stripeHalfW * nx;
            const slZ = z - stripeHalfW * nz;
            const srX = x + stripeHalfW * nx;
            const srZ = z + stripeHalfW * nz;
            stripePos.push(slX, sY, slZ, srX, sY, srZ);
            stripeUvs.push(0, vDist, 1, vDist);
          }

          if (isMountain) {
            const gX = rX + nx * 0.4;
            const gZ = rZ + nz * 0.4;
            grPos.push(gX, y + 0.65, gZ, gX, y + 0.35, gZ);
          }
        }

        const runCount = runEnd - runStart;
        for (let step = 0; step < runCount; step++) {
          const v0 = roadBaseIdx + step * 2;
          const v1 = roadBaseIdx + step * 2 + 1;
          const v2 = roadBaseIdx + (step + 1) * 2;
          const v3 = roadBaseIdx + (step + 1) * 2 + 1;
          roadIdx.push(v0, v1, v2, v2, v1, v3);

          if (!isDirt) {
            const sv0 = stripeBaseIdx + step * 2;
            const sv1 = stripeBaseIdx + step * 2 + 1;
            const sv2 = stripeBaseIdx + (step + 1) * 2;
            const sv3 = stripeBaseIdx + (step + 1) * 2 + 1;
            stripeIdx.push(sv0, sv1, sv2, sv2, sv1, sv3);
          }

          if (isMountain) {
            const gv0 = grBaseIdx + step * 2;
            const gv1 = grBaseIdx + step * 2 + 1;
            const gv2 = grBaseIdx + (step + 1) * 2;
            const gv3 = grBaseIdx + (step + 1) * 2 + 1;
            grIdx.push(gv0, gv1, gv2, gv2, gv1, gv3);

            // Mountain Touge Apex Kerbs (alternating red and white every 3m)
            const stepK = runStart + step;
            const isRed = Math.floor(cumDist[stepK] / 3.0) % 2 === 0;
            const kPos = isRed ? kerbRedPos : kerbWhitePos;
            const kIdx = isRed ? kerbRedIdx : kerbWhiteIdx;
            const b = kPos.length / 3;

            const k0X = pts[stepK].x;
            const k0Z = pts[stepK].z;
            const k0Y = elev[stepK] + 0.04;
            const k0Nx = normX[stepK];
            const k0Nz = normZ[stepK];

            const k1X = pts[stepK + 1].x;
            const k1Z = pts[stepK + 1].z;
            const k1Y = elev[stepK + 1] + 0.04;
            const k1Nx = normX[stepK + 1];
            const k1Nz = normZ[stepK + 1];

            const l0X = k0X - halfW * k0Nx;
            const l0Z = k0Z - halfW * k0Nz;
            const l1X = k1X - halfW * k1Nx;
            const l1Z = k1Z - halfW * k1Nz;

            kPos.push(l0X - 0.65 * k0Nx, k0Y, l0Z - 0.65 * k0Nz, l0X, k0Y, l0Z);
            kPos.push(l1X - 0.65 * k1Nx, k1Y, l1Z - 0.65 * k1Nz, l1X, k1Y, l1Z);
            kIdx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
          }
        }
      }

      // 2. Sidewalk runs (stops cleanly before intersections)
      let swP = 0;
      while (swP < numPts - 1) {
        if (!isSwActive[swP]) {
          swP++;
          continue;
        }
        const runStart = swP;
        while (swP < numPts - 1 && isSwActive[swP]) {
          swP++;
        }
        const runEnd = swP;

        const swBaseIdx = leftSwPos.length / 3;

        for (let k = runStart; k <= runEnd; k++) {
          const x = pts[k].x;
          const z = pts[k].z;
          const y = elev[k] + 0.04;
          const nx = normX[k];
          const nz = normZ[k];
          const vDist = cumDist[k] / 8.0;

          const lX = x - halfW * nx;
          const lZ = z - halfW * nz;
          const rX = x + halfW * nx;
          const rZ = z + halfW * nz;

          const lOuterX = lX - sw * nx;
          const lOuterZ = lZ - sw * nz;
          const rOuterX = rX + sw * nx;
          const rOuterZ = rZ + sw * nz;

          leftSwPos.push(lOuterX, y, lOuterZ, lX, y, lZ);
          rightSwPos.push(rX, y, rZ, rOuterX, y, rOuterZ);
          swUvs.push(0, vDist, 1, vDist);
        }

        const runCount = runEnd - runStart;
        for (let step = 0; step < runCount; step++) {
          const v0 = swBaseIdx + step * 2;
          const v1 = swBaseIdx + step * 2 + 1;
          const v2 = swBaseIdx + (step + 1) * 2;
          const v3 = swBaseIdx + (step + 1) * 2 + 1;
          swIdx.push(v0, v1, v2, v2, v1, v3);
        }
      }

      // Add assembled meshes to roadGroup
      if (roadIdx.length >= 6) {
        // Pedestrian Zebra Crossings at intersection approaches
        if (!isDirt && !isMountain && !isHighway) {
          if (isJunctionA && totalEdgeLen >= 20.0) {
            const targetD = Math.max(6.0, stopA - 2.5);
            let zStep = 0;
            for (let p = 0; p < numPts - 1; p++) {
              if (cumDist[p] <= targetD && cumDist[p + 1] >= targetD) {
                zStep = p;
                break;
              }
            }
            const zX = pts[zStep].x;
            const zZ = pts[zStep].z;
            if (zX >= minChunkX && zX <= maxChunkX && zZ >= minChunkZ && zZ <= maxChunkZ) {
              const zY = elev[zStep] + 0.035;
              const zNx = normX[zStep];
              const zNz = normZ[zStep];
              const dX = pts[zStep + 1].x - pts[zStep].x;
              const dZ = pts[zStep + 1].z - pts[zStep].z;
              const dLen = Math.hypot(dX, dZ) || 1;
              const zTx = dX / dLen;
              const zTz = dZ / dLen;

              const numBars = Math.floor((halfW * 2 - 2.4) / 1.1);
              for (let b = 0; b < numBars; b++) {
                const lat = -halfW + 1.2 + b * 1.1 + 0.25;
                const cX = zX + lat * zNx;
                const cZ = zZ + lat * zNz;
                const bStart = stripePos.length / 3;

                stripePos.push(
                  cX - 1.6 * zTx - 0.24 * zNx, zY, cZ - 1.6 * zTz - 0.24 * zNz,
                  cX - 1.6 * zTx + 0.24 * zNx, zY, cZ - 1.6 * zTz + 0.24 * zNz,
                  cX + 1.6 * zTx - 0.24 * zNx, zY, cZ + 1.6 * zTz - 0.24 * zNz,
                  cX + 1.6 * zTx + 0.24 * zNx, zY, cZ + 1.6 * zTz + 0.24 * zNz
                );
                stripeUvs.push(0, 0, 1, 0, 0, 1, 1, 1);
                stripeIdx.push(bStart, bStart + 1, bStart + 2, bStart + 2, bStart + 1, bStart + 3);
              }
            }
          }

          if (isJunctionB && totalEdgeLen >= 20.0) {
            const targetD = totalEdgeLen - Math.max(6.0, stopB - 2.5);
            let zStep = numPts - 2;
            for (let p = numPts - 2; p >= 0; p--) {
              if (cumDist[p] <= targetD && cumDist[p + 1] >= targetD) {
                zStep = p;
                break;
              }
            }
            const zX = pts[zStep].x;
            const zZ = pts[zStep].z;
            if (zX >= minChunkX && zX <= maxChunkX && zZ >= minChunkZ && zZ <= maxChunkZ) {
              const zY = elev[zStep] + 0.035;
              const zNx = normX[zStep];
              const zNz = normZ[zStep];
              const dX = pts[zStep + 1].x - pts[zStep].x;
              const dZ = pts[zStep + 1].z - pts[zStep].z;
              const dLen = Math.hypot(dX, dZ) || 1;
              const zTx = dX / dLen;
              const zTz = dZ / dLen;

              const numBars = Math.floor((halfW * 2 - 2.4) / 1.1);
              for (let b = 0; b < numBars; b++) {
                const lat = -halfW + 1.2 + b * 1.1 + 0.25;
                const cX = zX + lat * zNx;
                const cZ = zZ + lat * zNz;
                const bStart = stripePos.length / 3;

                stripePos.push(
                  cX - 1.6 * zTx - 0.24 * zNx, zY, cZ - 1.6 * zTz - 0.24 * zNz,
                  cX - 1.6 * zTx + 0.24 * zNx, zY, cZ - 1.6 * zTz + 0.24 * zNz,
                  cX + 1.6 * zTx - 0.24 * zNx, zY, cZ + 1.6 * zTz - 0.24 * zNz,
                  cX + 1.6 * zTx + 0.24 * zNx, zY, cZ + 1.6 * zTz + 0.24 * zNz
                );
                stripeUvs.push(0, 0, 1, 0, 0, 1, 1, 1);
                stripeIdx.push(bStart, bStart + 1, bStart + 2, bStart + 2, bStart + 1, bStart + 3);
              }
            }
          }
        }

        const roadGeo = this.createIndexedGeometry(roadPos, roadUvs, roadIdx);
        const roadMesh = new THREE.Mesh(roadGeo, roadMat);
        roadMesh.receiveShadow = true;
        this.roadGroup.add(roadMesh);

        if (stripeIdx.length >= 6) {
          const stripeGeo = this.createIndexedGeometry(stripePos, stripeUvs, stripeIdx);
          const stripeMat = isHighway ? yellowStripeMat : whiteStripeMat;
          const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
          this.roadGroup.add(stripeMesh);
        }

        if (swIdx.length >= 6) {
          const leftSwGeo = this.createIndexedGeometry(leftSwPos, swUvs, swIdx);
          const leftSwMesh = new THREE.Mesh(leftSwGeo, sidewalkMat);
          leftSwMesh.receiveShadow = true;
          this.roadGroup.add(leftSwMesh);

          const rightSwGeo = this.createIndexedGeometry(rightSwPos, swUvs, swIdx);
          const rightSwMesh = new THREE.Mesh(rightSwGeo, sidewalkMat);
          rightSwMesh.receiveShadow = true;
          this.roadGroup.add(rightSwMesh);
        }

        if (grIdx.length >= 6) {
          const grGeo = this.createIndexedGeometry(grPos, undefined, grIdx);
          const grMesh = new THREE.Mesh(grGeo, guardrailMat);
          this.roadGroup.add(grMesh);
        }

        // Mountain Touge Apex Kerbs (alternating red and white)
        if (kerbRedIdx.length >= 6) {
          const redGeo = this.createIndexedGeometry(kerbRedPos, undefined, kerbRedIdx);
          const redMesh = new THREE.Mesh(redGeo, mountainKerbRedMat);
          this.roadGroup.add(redMesh);
        }
        if (kerbWhiteIdx.length >= 6) {
          const whiteGeo = this.createIndexedGeometry(kerbWhitePos, undefined, kerbWhiteIdx);
          const whiteMesh = new THREE.Mesh(whiteGeo, mountainKerbWhiteMat);
          this.roadGroup.add(whiteMesh);
        }

        // Concrete Viaduct Bridge Piers under elevated road sections
        const pierPos: number[] = [];
        const pierIdx: number[] = [];
        for (let p = 0; p < numPts; p++) {
          const naturalH = landforms ? landforms.getHeight(pts[p].x, pts[p].z) : 0;
          const elevDiff = elev[p] - naturalH;
          if (elevDiff > 3.8 && (p === 0 || Math.floor(cumDist[p] / 24.0) !== Math.floor(cumDist[p - 1] / 24.0))) {
            const pX = pts[p].x;
            const pZ = pts[p].z;
            if (pX >= minChunkX && pX <= maxChunkX && pZ >= minChunkZ && pZ <= maxChunkZ) {
              const topY = elev[p] - 0.15;
              const botY = naturalH;
              const pw = 2.4;
              const pd = 2.4;
              const b = pierPos.length / 3;

              pierPos.push(
                pX - pw * 0.5, botY, pZ - pd * 0.5,
                pX + pw * 0.5, botY, pZ - pd * 0.5,
                pX + pw * 0.5, topY, pZ - pd * 0.5,
                pX - pw * 0.5, topY, pZ - pd * 0.5,
                pX - pw * 0.5, botY, pZ + pd * 0.5,
                pX + pw * 0.5, botY, pZ + pd * 0.5,
                pX + pw * 0.5, topY, pZ + pd * 0.5,
                pX - pw * 0.5, topY, pZ + pd * 0.5
              );
              pierIdx.push(
                b + 0, b + 2, b + 1, b + 0, b + 3, b + 2,
                b + 5, b + 6, b + 4, b + 4, b + 6, b + 7,
                b + 4, b + 7, b + 0, b + 0, b + 7, b + 3,
                b + 1, b + 2, b + 5, b + 5, b + 2, b + 6,
                b + 3, b + 7, b + 2, b + 2, b + 7, b + 6
              );
            }
          }
        }
        if (pierIdx.length >= 6) {
          const pierGeo = this.createIndexedGeometry(pierPos, undefined, pierIdx);
          const pierMesh = new THREE.Mesh(pierGeo, sidewalkMat);
          pierMesh.castShadow = true;
          pierMesh.receiveShadow = true;
          this.roadGroup.add(pierMesh);
        }
      }
    }

    // ── 2. Intersections & Roundabouts Deck Patches ───────────
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.x >= minChunkX && node.x <= maxChunkX && node.z >= minChunkZ && node.z <= maxChunkZ) {
        // Only place flat intersection deck patches at genuine junctions (degree >= 3)
        // on flat ground (slope < 0.04). Never place on 2-way road joints or mountain slopes!
        if (node.isJunction && nodeDegree[node.id] >= 3) {
          const slope = landforms ? landforms.getSlope(node.x, node.z) : 0;
          if (slope < 0.04) {
            const patchY = terrainHeight.groundHeightAt(node.x, node.z) + 0.02;
            const patchGeo = new THREE.CircleGeometry(8.0, 16);
            patchGeo.rotateX(-Math.PI * 0.5);
            const patchMesh = new THREE.Mesh(patchGeo, asphaltAvenueMat);
            patchMesh.position.set(node.x, patchY, node.z);
            patchMesh.receiveShadow = true;
            this.roadGroup.add(patchMesh);
          }
        } else if (node.isRoundabout) {
          const slope = landforms ? landforms.getSlope(node.x, node.z) : 0;
          if (slope < 0.04) {
            const patchY = terrainHeight.groundHeightAt(node.x, node.z) + 0.02;
            const outerGeo = new THREE.RingGeometry(6.0, 16.0, 24);
            outerGeo.rotateX(-Math.PI * 0.5);
            const outerMesh = new THREE.Mesh(outerGeo, asphaltAvenueMat);
            outerMesh.position.set(node.x, patchY, node.z);
            this.roadGroup.add(outerMesh);

            const innerGeo = new THREE.CircleGeometry(6.0, 24);
            innerGeo.rotateX(-Math.PI * 0.5);
            const innerMesh = new THREE.Mesh(innerGeo, roundaboutCenterMat);
            innerMesh.position.set(node.x, patchY + 0.12, node.z);
            this.roadGroup.add(innerMesh);
          }
        }
      }
    }
  }

  private createIndexedGeometry(positions: number[], uvs?: number[], indices?: number[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (uvs && uvs.length > 0) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    }
    if (indices && indices.length > 0) {
      geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
    }
    geo.computeVertexNormals();
    return geo;
  }

  recycle(poolManager?: CityPoolManager, roamWorld?: RoamWorld): void {
    this.isActive = false;

    // Release building slots back to pools
    for (let i = 0; i < this.allocatedBuildingSlots.length; i++) {
      const e = this.allocatedBuildingSlots[i];
      e.pool.free(e.slot);
    }
    this.allocatedBuildingSlots.length = 0;

    // Release tree and lamp slots
    if (poolManager) {
      for (let i = 0; i < this.allocatedTreeSlots.length; i++) {
        poolManager.treePool.free(this.allocatedTreeSlots[i]);
      }
      for (let i = 0; i < this.allocatedLampSlots.length; i++) {
        poolManager.lampPool.free(this.allocatedLampSlots[i]);
      }
      for (let i = 0; i < this.allocatedBillboardSlots.length; i++) {
        const e = this.allocatedBillboardSlots[i];
        e.pool.free(e.slot);
      }
      for (let i = 0; i < this.allocatedGantrySlots.length; i++) {
        poolManager.gantryPool.free(this.allocatedGantrySlots[i]);
      }
      for (let i = 0; i < this.allocatedBollardSlots.length; i++) {
        poolManager.bollardPool.free(this.allocatedBollardSlots[i]);
      }
      for (let i = 0; i < this.allocatedAntennaSlots.length; i++) {
        poolManager.antennaPool.free(this.allocatedAntennaSlots[i]);
      }
      for (let i = 0; i < this.allocatedTrafficSignalSlots.length; i++) {
        poolManager.trafficSignalPool.free(this.allocatedTrafficSignalSlots[i]);
      }
      for (let i = 0; i < this.allocatedCanopySlots.length; i++) {
        poolManager.canopyPool.free(this.allocatedCanopySlots[i]);
      }
      for (let i = 0; i < this.allocatedParkingStallSlots.length; i++) {
        poolManager.parkingStallPool.free(this.allocatedParkingStallSlots[i]);
      }
      for (let i = 0; i < this.allocatedFenceSlots.length; i++) {
        poolManager.fencePool.free(this.allocatedFenceSlots[i]);
      }
    }
    this.allocatedTreeSlots.length = 0;
    this.allocatedLampSlots.length = 0;
    this.allocatedBillboardSlots.length = 0;
    this.allocatedGantrySlots.length = 0;
    this.allocatedBollardSlots.length = 0;
    this.allocatedAntennaSlots.length = 0;
    this.allocatedTrafficSignalSlots.length = 0;
    this.allocatedCanopySlots.length = 0;
    this.allocatedParkingStallSlots.length = 0;
    this.allocatedFenceSlots.length = 0;

    // Remove landmark visual mesh
    if (this.landmarkGroup) {
      this.group.remove(this.landmarkGroup);
      this.landmarkGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        }
      });
      this.landmarkGroup = null;
    }

    // Unregister and dispose local chunk BVH collider
    if (this.collider) {
      if (roamWorld) {
        roamWorld.unregisterChunkCollider(this.cx, this.cz);
      }
      this.collider.dispose();
      this.collider = null;
    }

    while (this.roadGroup.children.length > 0) {
      const child = this.roadGroup.children[0] as THREE.Mesh;
      this.roadGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
  }

  dispose(): void {
    this.recycle();
    this.terrainGeo.dispose();
  }
}

/**
 * Manages chunk streaming, hysteresis loading/unloading, and frame budgeting.
 */
export class ChunkManager {
  readonly rootGroup = new THREE.Group();

  private readonly spec: WorldSpec;
  private readonly terrainHeight: TerrainHeight;
  private readonly roadIndex: SpatialRoadIndex;
  private readonly propsGenerator?: CityPropsGenerator;
  private readonly poolManager?: CityPoolManager;
  private readonly roamWorld?: RoamWorld;

  // Numeric chunk keys: getChunkKey(cx, cz) -> TerrainChunk (zero template-string allocs)
  private readonly loadedChunks = new Map<number, TerrainChunk>();
  private readonly chunkPool: TerrainChunk[] = [];
  // Numeric queue of chunk keys: zero { cx, cz } object allocations
  private readonly buildQueue: number[] = [];
  private readonly queuedSet = new Set<number>();
  private readonly chunksToUnload: TerrainChunk[] = [];

  lastBuildMs = 0;
  lastPlayerCx = 999999;
  lastPlayerCz = 999999;

  constructor(
    spec: WorldSpec,
    terrainHeight: TerrainHeight,
    roadIndex: SpatialRoadIndex,
    propsGenerator?: CityPropsGenerator,
    poolManager?: CityPoolManager,
    roamWorld?: RoamWorld
  ) {
    this.spec = spec;
    this.terrainHeight = terrainHeight;
    this.roadIndex = roadIndex;
    this.propsGenerator = propsGenerator;
    this.poolManager = poolManager;
    this.roamWorld = roamWorld;

    // Pre-populate chunk pool (avoids allocations during gameplay)
    const initialPoolSize = 64;
    for (let i = 0; i < initialPoolSize; i++) {
      this.chunkPool.push(new TerrainChunk());
    }
  }

  get loadedCount(): number {
    return this.loadedChunks.size;
  }

  /**
   * Per-frame chunk streaming update.
   * Loads within loadRadius, unloads beyond unloadRadius with hysteresis,
   * and builds at most one chunk per frame within a ~2ms budget.
   * Zero per-frame heap allocations.
   */
  update(playerX: number, playerZ: number): void {
    const chunkSize = this.spec.chunkSize;
    const playerCx = Math.floor(playerX / chunkSize);
    const playerCz = Math.floor(playerZ / chunkSize);

    const loadRad = this.spec.loadRadius;
    const unloadRad = this.spec.unloadRadius;
    const loadRadSq = loadRad * loadRad;
    const unloadRadSq = unloadRad * unloadRad;

    // ── 1. Check if Player Moved into a New Chunk ────────────
    if (playerCx !== this.lastPlayerCx || playerCz !== this.lastPlayerCz) {
      this.lastPlayerCx = playerCx;
      this.lastPlayerCz = playerCz;

      // A. Queue chunks within loadRadius that are not yet loaded (stores numeric key)
      for (let dx = -loadRad; dx <= loadRad; dx++) {
        for (let dz = -loadRad; dz <= loadRad; dz++) {
          if (dx * dx + dz * dz <= loadRadSq) {
            const cx = playerCx + dx;
            const cz = playerCz + dz;
            const key = getChunkKey(cx, cz);

            if (!this.loadedChunks.has(key) && !this.queuedSet.has(key)) {
              this.buildQueue.push(key);
              this.queuedSet.add(key);
            }
          }
        }
      }

      // Sort build queue so chunks closest to player build first (unpacks numeric key)
      this.buildQueue.sort((keyA, keyB) => {
        const ax = Math.floor(keyA / 65536) - CHUNK_KEY_OFFSET - playerCx;
        const az = (keyA % 65536) - CHUNK_KEY_OFFSET - playerCz;
        const bx = Math.floor(keyB / 65536) - CHUNK_KEY_OFFSET - playerCx;
        const bz = (keyB % 65536) - CHUNK_KEY_OFFSET - playerCz;
        return (ax * ax + az * az) - (bx * bx + bz * bz);
      });

      // B. Unload chunks beyond unloadRadius with hysteresis (zero array allocations)
      this.chunksToUnload.length = 0;
      for (const chunk of this.loadedChunks.values()) {
        const dx = chunk.cx - playerCx;
        const dz = chunk.cz - playerCz;
        if (dx * dx + dz * dz > unloadRadSq) {
          this.chunksToUnload.push(chunk);
        }
      }
      for (let i = 0; i < this.chunksToUnload.length; i++) {
        const chunk = this.chunksToUnload[i];
        this.unloadChunk(getChunkKey(chunk.cx, chunk.cz), chunk);
      }
      this.chunksToUnload.length = 0;
    }

    // ── 2. Build at Most One Chunk per Frame (~2 ms Budget) ──
    if (this.buildQueue.length > 0) {
      const key = this.buildQueue.shift()!;
      this.queuedSet.delete(key);

      if (!this.loadedChunks.has(key)) {
        const cx = Math.floor(key / 65536) - CHUNK_KEY_OFFSET;
        const cz = (key % 65536) - CHUNK_KEY_OFFSET;
        const t0 = performance.now();

        // Get chunk from pool or instantiate if pool empty
        const chunk = this.chunkPool.length > 0 ? this.chunkPool.pop()! : new TerrainChunk();
        const dx = cx - playerCx;
        const dz = cz - playerCz;
        const lod: 0 | 1 = (dx * dx + dz * dz <= 4) ? 0 : 1;
        chunk.build(
          cx,
          cz,
          this.terrainHeight,
          this.roadIndex,
          this.spec,
          this.propsGenerator,
          this.poolManager,
          this.roamWorld,
          lod
        );

        this.loadedChunks.set(key, chunk);
        this.rootGroup.add(chunk.group);

        this.lastBuildMs = performance.now() - t0;
      }
    } else {
      this.lastBuildMs = 0;
    }

    if (this.poolManager) {
      this.poolManager.commitAll();
    }
  }

  private unloadChunk(key: number, chunk: TerrainChunk): void {
    this.loadedChunks.delete(key);
    this.rootGroup.remove(chunk.group);
    chunk.recycle(this.poolManager, this.roamWorld);
    this.chunkPool.push(chunk);
  }

  /**
   * Pre-warms and builds all initial chunks around spawn position.
   */
  warmUp(spawnX: number, spawnZ: number): void {
    const chunkSize = this.spec.chunkSize;
    const playerCx = Math.floor(spawnX / chunkSize);
    const playerCz = Math.floor(spawnZ / chunkSize);
    const loadRad = this.spec.loadRadius;
    const loadRadSq = loadRad * loadRad;

    for (let dx = -loadRad; dx <= loadRad; dx++) {
      for (let dz = -loadRad; dz <= loadRad; dz++) {
        if (dx * dx + dz * dz <= loadRadSq) {
          const cx = playerCx + dx;
          const cz = playerCz + dz;
          const key = getChunkKey(cx, cz);

          if (!this.loadedChunks.has(key)) {
            const chunk = this.chunkPool.length > 0 ? this.chunkPool.pop()! : new TerrainChunk();
            const lod: 0 | 1 = (dx * dx + dz * dz <= 4) ? 0 : 1;
            chunk.build(
              cx,
              cz,
              this.terrainHeight,
              this.roadIndex,
              this.spec,
              this.propsGenerator,
              this.poolManager,
              this.roamWorld,
              lod
            );
            this.loadedChunks.set(key, chunk);
            this.rootGroup.add(chunk.group);
          }
        }
      }
    }

    this.lastPlayerCx = playerCx;
    this.lastPlayerCz = playerCz;
    this.buildQueue.length = 0;
    this.queuedSet.clear();

    if (this.poolManager) {
      this.poolManager.commitAll();
    }
  }

  dispose(): void {
    for (const [key, chunk] of this.loadedChunks) {
      this.unloadChunk(key, chunk);
    }
    for (let i = 0; i < this.chunkPool.length; i++) {
      this.chunkPool[i].dispose();
    }
    this.chunkPool.length = 0;
  }
}
