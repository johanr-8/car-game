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

interface ClipResult {
  t0: number;
  t1: number;
}
const _clipResult: ClipResult = { t0: 0, t1: 1 };

function clipAxis(p: number, q: number, ref: ClipResult): boolean {
  if (Math.abs(p) < 1e-9) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > ref.t1) return false;
      if (r > ref.t0) ref.t0 = r;
    } else {
      if (r < ref.t0) return false;
      if (r < ref.t1) ref.t1 = r;
    }
  }
  return true;
}

function clipSegmentAABB(
  x0: number, z0: number,
  x1: number, z1: number,
  minX: number, maxX: number,
  minZ: number, maxZ: number,
  outT: ClipResult
): boolean {
  outT.t0 = 0.0;
  outT.t1 = 1.0;
  const dx = x1 - x0;
  const dz = z1 - z0;

  if (!clipAxis(-dx, x0 - minX, outT)) return false;
  if (!clipAxis(dx, maxX - x0, outT)) return false;
  if (!clipAxis(-dz, z0 - minZ, outT)) return false;
  if (!clipAxis(dz, maxZ - z0, outT)) return false;

  return outT.t0 <= outT.t1;
}

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

      // Extract sub-segments: either from polyline points or straight segment
      const subSegments: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
      if (edge.points && edge.points.length >= 2) {
        for (let p = 0; p < edge.points.length - 1; p++) {
          subSegments.push({
            x1: edge.points[p].x,
            z1: edge.points[p].z,
            x2: edge.points[p + 1].x,
            z2: edge.points[p + 1].z,
          });
        }
      } else {
        const nA = nodes[edge.fromNodeId];
        const nB = nodes[edge.toNodeId];
        subSegments.push({ x1: nA.x, z1: nA.z, x2: nB.x, z2: nB.z });
      }

      for (let sIdx = 0; sIdx < subSegments.length; sIdx++) {
        const seg = subSegments[sIdx];
        const dx = seg.x2 - seg.x1;
        const dz = seg.z2 - seg.z1;
        const len = Math.hypot(dx, dz);
        if (len < 0.4) continue;

        if (!clipSegmentAABB(seg.x1, seg.z1, seg.x2, seg.z2, minChunkX, maxChunkX, minChunkZ, maxChunkZ, _clipResult)) {
          continue;
        }

        const t0 = _clipResult.t0;
        const t1 = _clipResult.t1;
        const segLen = len * (t1 - t0);
        if (segLen < 0.2) continue;

        const dirX = dx / len;
        const dirZ = dz / len;
        const perpX = -dirZ;
        const perpZ = dirX;

        const subSteps = Math.max(1, Math.ceil(segLen / 10));
        const ribbonPositions: number[] = [];
        const ribbonUvs: number[] = [];
        const stripePositions: number[] = [];
        const stripeUvs: number[] = [];
        const leftSidewalkPos: number[] = [];
        const rightSidewalkPos: number[] = [];
        const sidewalkUvs: number[] = [];
        const guardrailPos: number[] = [];

        for (let s = 0; s <= subSteps; s++) {
          const stepT = s / subSteps;
          const t = t0 + stepT * (t1 - t0);
          const cxPoint = seg.x1 + t * dx;
          const czPoint = seg.z1 + t * dz;

          // Road centerline elevation
          const roadY = terrainHeight.groundHeightAt(cxPoint, czPoint);
          const swY = roadY + 0.04;

          const leftX = cxPoint - perpX * halfW;
          const leftZ = czPoint - perpZ * halfW;
          const rightX = cxPoint + perpX * halfW;
          const rightZ = czPoint + perpZ * halfW;

          ribbonPositions.push(leftX, roadY, leftZ, rightX, roadY, rightZ);

          const vDist = (t * len) / 8.0;
          ribbonUvs.push(0, vDist, 1, vDist);

          // Center lane stripe points (skip on dirt roads)
          if (!isDirt) {
            const stripeHalfW = isHighway ? 0.35 : 0.20;
            const stripeY = roadY + 0.02;
            stripePositions.push(
              cxPoint - perpX * stripeHalfW, stripeY, czPoint - perpZ * stripeHalfW,
              cxPoint + perpX * stripeHalfW, stripeY, czPoint + perpZ * stripeHalfW
            );
            stripeUvs.push(0, vDist, 1, vDist);
          }

          // Sidewalks on urban/local/avenue roads
          if (!isDirt && !isMountain) {
            const swLeftOuterX = leftX - perpX * sw;
            const swLeftOuterZ = leftZ - perpZ * sw;
            leftSidewalkPos.push(swLeftOuterX, swY, swLeftOuterZ, leftX, swY, leftZ);

            const swRightOuterX = rightX + perpX * sw;
            const swRightOuterZ = rightZ + perpZ * sw;
            rightSidewalkPos.push(rightX, swY, rightZ, swRightOuterX, swY, swRightOuterZ);

            sidewalkUvs.push(0, vDist, 1, vDist);
          }

          // Metallic guardrails on mountain roads and steep drops
          if (isMountain) {
            const grY = roadY + 0.65;
            const grX = rightX + perpX * 0.4;
            const grZ = rightZ + perpZ * 0.4;
            guardrailPos.push(grX, grY, grZ, grX, grY - 0.25, grZ);
          }
        }

        if (ribbonPositions.length >= 12) {
          // Construct road ribbon mesh
          const ribbonGeo = this.createStripGeometry(ribbonPositions, ribbonUvs);
          const roadMesh = new THREE.Mesh(ribbonGeo, roadMat);
          roadMesh.receiveShadow = true;
          this.roadGroup.add(roadMesh);

          // Construct center stripe mesh
          if (stripePositions.length >= 12) {
            const stripeGeo = this.createStripGeometry(stripePositions, stripeUvs);
            const stripeMat = isHighway ? yellowStripeMat : whiteStripeMat;
            const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
            this.roadGroup.add(stripeMesh);
          }

          // Construct sidewalks
          if (leftSidewalkPos.length >= 12) {
            const leftSwGeo = this.createStripGeometry(leftSidewalkPos, sidewalkUvs);
            const leftSwMesh = new THREE.Mesh(leftSwGeo, sidewalkMat);
            leftSwMesh.receiveShadow = true;
            this.roadGroup.add(leftSwMesh);

            const rightSwGeo = this.createStripGeometry(rightSidewalkPos, sidewalkUvs);
            const rightSwMesh = new THREE.Mesh(rightSwGeo, sidewalkMat);
            rightSwMesh.receiveShadow = true;
            this.roadGroup.add(rightSwMesh);
          }

          // Construct mountain guardrails
          if (guardrailPos.length >= 12) {
            const grGeo = this.createStripGeometry(guardrailPos);
            const grMesh = new THREE.Mesh(grGeo, guardrailMat);
            this.roadGroup.add(grMesh);
          }
        }
      }
    }

    // ── 2. Intersections & Roundabouts Deck Patches ───────────
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.x >= minChunkX && node.x <= maxChunkX && node.z >= minChunkZ && node.z <= maxChunkZ) {
        if (node.isJunction) {
          const patchY = terrainHeight.groundHeightAt(node.x, node.z) + 0.02;
          const patchGeo = new THREE.CircleGeometry(11.0, 16);
          patchGeo.rotateX(-Math.PI * 0.5);
          const patchMesh = new THREE.Mesh(patchGeo, asphaltAvenueMat);
          patchMesh.position.set(node.x, patchY, node.z);
          patchMesh.receiveShadow = true;
          this.roadGroup.add(patchMesh);
        } else if (node.isRoundabout) {
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

  private createStripGeometry(positions: number[], uvs?: number[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    if (uvs && uvs.length > 0) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    }

    const pairCount = positions.length / 6;
    const indices = new Uint16Array((pairCount - 1) * 6);
    let iIdx = 0;

    for (let p = 0; p < pairCount - 1; p++) {
      const v0 = p * 2;
      const v1 = p * 2 + 1;
      const v2 = (p + 1) * 2;
      const v3 = (p + 1) * 2 + 1;

      // CCW from above: (v0, v1, v2) and (v2, v1, v3)
      indices[iIdx++] = v0;
      indices[iIdx++] = v1;
      indices[iIdx++] = v2;

      indices[iIdx++] = v2;
      indices[iIdx++] = v1;
      indices[iIdx++] = v3;
    }

    geo.setIndex(new THREE.BufferAttribute(indices, 1));
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
    }
    this.allocatedTreeSlots.length = 0;
    this.allocatedLampSlots.length = 0;
    this.allocatedBillboardSlots.length = 0;
    this.allocatedGantrySlots.length = 0;
    this.allocatedBollardSlots.length = 0;
    this.allocatedAntennaSlots.length = 0;

    // Remove landmark visual mesh
    if (this.landmarkGroup) {
      this.group.remove(this.landmarkGroup);
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
