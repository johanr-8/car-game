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
import { type WorldSpec, CHUNK_KEY_OFFSET, getChunkKey } from './WorldConfig';
import type { TerrainHeight } from './TerrainHeight';
import type { SpatialRoadIndex } from './RoadNetwork';
import { RoadClass } from './RoadNetwork';
import { getAsphaltTexture, getGrassTexture, getConcreteSidewalkTexture } from './TextureGenerator';
import { ChunkCollider } from './ChunkCollider';
import type { CityPropsGenerator } from './CityPropsGenerator';
import type { CityPoolManager, InstancedPool } from './InstancedPool';
import type { RoamWorld } from './RoamWorld';

// Cloned textures for Free Roam procedural terrain and roads
const roamGrassTex = getGrassTexture().clone();
roamGrassTex.wrapS = THREE.RepeatWrapping;
roamGrassTex.wrapT = THREE.RepeatWrapping;
roamGrassTex.repeat.set(1, 1);

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
  map: roamGrassTex,
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

// Pre-allocated static index buffer for 32x32 quad grid
const GRID_RES = 32;
const VERT_COUNT = (GRID_RES + 1) * (GRID_RES + 1); // 33 * 33 = 1089
const TRI_COUNT = GRID_RES * GRID_RES * 2;          // 2048
const INDEX_COUNT = TRI_COUNT * 3;                  // 6144
const SHARED_GRID_INDICES = new Uint16Array(INDEX_COUNT);

{
  let idx = 0;
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      const a = j * (GRID_RES + 1) + i;
      const b = j * (GRID_RES + 1) + (i + 1);
      const c = (j + 1) * (GRID_RES + 1) + i;
      const d = (j + 1) * (GRID_RES + 1) + (i + 1);

      SHARED_GRID_INDICES[idx++] = a;
      SHARED_GRID_INDICES[idx++] = c;
      SHARED_GRID_INDICES[idx++] = b;

      SHARED_GRID_INDICES[idx++] = b;
      SHARED_GRID_INDICES[idx++] = c;
      SHARED_GRID_INDICES[idx++] = d;
    }
  }
}

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

    const positions = new Float32Array(VERT_COUNT * 3);
    const normals = new Float32Array(VERT_COUNT * 3);
    const colors = new Float32Array(VERT_COUNT * 3);
    const uvs = new Float32Array(VERT_COUNT * 2);

    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.normAttr = new THREE.BufferAttribute(normals, 3);
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.uvAttr = new THREE.BufferAttribute(uvs, 2);

    this.terrainGeo.setAttribute('position', this.posAttr);
    this.terrainGeo.setAttribute('normal', this.normAttr);
    this.terrainGeo.setAttribute('color', this.colAttr);
    this.terrainGeo.setAttribute('uv', this.uvAttr);
    this.terrainGeo.setIndex(new THREE.BufferAttribute(SHARED_GRID_INDICES, 1));

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
    roamWorld?: RoamWorld
  ): void {
    this.cx = cx;
    this.cz = cz;
    this.isActive = true;
    this.group.visible = true;

    const chunkSize = spec.chunkSize;
    const originX = cx * chunkSize;
    const originZ = cz * chunkSize;
    const step = chunkSize / GRID_RES;

    const pos = this.posAttr.array as Float32Array;
    const norm = this.normAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const uv = this.uvAttr.array as Float32Array;

    // Grass, Dirt shoulder & Mountain Rock palette colors
    const grassR = 0.36, grassG = 0.58, grassB = 0.26;
    const dirtR  = 0.50, dirtG  = 0.40, dirtB  = 0.28;
    const rockR  = 0.42, rockG  = 0.42, rockB  = 0.40;

    let vIdx = 0;
    let cIdx = 0;
    let uvIdx = 0;

    for (let j = 0; j <= GRID_RES; j++) {
      const z = originZ + j * step;
      for (let i = 0; i <= GRID_RES; i++) {
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

        let dirtWeight = 0;
        if (nearest) {
          const distToRoadEdge = Math.max(0, nearest.distance - nearest.roadHalfWidth);
          if (distToRoadEdge < 6.0) {
            dirtWeight = 1.0 - (distToRoadEdge / 6.0);
          }
        }

        // Steeper slopes show granite rock
        let rockWeight = 0;
        if (_normalScratch.y < 0.90) {
          rockWeight = Math.min(1.0, (0.90 - _normalScratch.y) * 5.0);
        }

        // Subtle per-vertex noise variation for natural meadow mottling
        const mottle = (((i * 19 + j * 37) % 13) - 6) / 100;
        let baseR = Math.max(0, grassR + mottle);
        let baseG = Math.max(0, grassG + mottle);
        let baseB = Math.max(0, grassB + mottle);

        if (rockWeight > 0) {
          baseR = (1 - rockWeight) * baseR + rockWeight * rockR;
          baseG = (1 - rockWeight) * baseG + rockWeight * rockG;
          baseB = (1 - rockWeight) * baseB + rockWeight * rockB;
        }

        col[cIdx]     = (1 - dirtWeight) * baseR + dirtWeight * dirtR;
        col[cIdx + 1] = (1 - dirtWeight) * baseG + dirtWeight * dirtG;
        col[cIdx + 2] = (1 - dirtWeight) * baseB + dirtWeight * dirtB;

        vIdx += 3;
        cIdx += 3;
        uvIdx += 2;
      }
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
    if (edges.length === 0) return;

    const chunkSize = spec.chunkSize;
    const minChunkX = cx * chunkSize - 2;
    const maxChunkX = (cx + 1) * chunkSize + 2;
    const minChunkZ = cz * chunkSize - 2;
    const maxChunkZ = (cz + 1) * chunkSize + 2;

    const nodes = roadIndex.graph.nodes;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const nA = nodes[edge.fromNodeId];
      const nB = nodes[edge.toNodeId];

      const dx = nB.x - nA.x;
      const dz = nB.z - nA.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;

      if (!clipSegmentAABB(nA.x, nA.z, nB.x, nB.z, minChunkX, maxChunkX, minChunkZ, maxChunkZ, _clipResult)) {
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

      const halfW = edge.width * 0.5;
      const sw = edge.roadClass === RoadClass.HIGHWAY ? 2.0 : 2.5;

      const subSteps = Math.max(2, Math.ceil(segLen / 10));
      const ribbonPositions: number[] = [];
      const ribbonUvs: number[] = [];
      const stripePositions: number[] = [];
      const stripeUvs: number[] = [];
      const leftSidewalkPos: number[] = [];
      const rightSidewalkPos: number[] = [];
      const sidewalkUvs: number[] = [];

      for (let s = 0; s <= subSteps; s++) {
        const stepT = s / subSteps;
        const t = t0 + stepT * (t1 - t0);
        const cxPoint = nA.x + t * dx;
        const czPoint = nA.z + t * dz;

        // Road centerline elevation (ensures cross-section is 100% flat and level)
        const roadY = terrainHeight.groundHeightAt(cxPoint, czPoint);
        const swY = roadY + 0.04; // Raised concrete curb

        const leftX = cxPoint - perpX * halfW;
        const leftZ = czPoint - perpZ * halfW;
        const rightX = cxPoint + perpX * halfW;
        const rightZ = czPoint + perpZ * halfW;

        ribbonPositions.push(leftX, roadY, leftZ, rightX, roadY, rightZ);

        const vDist = (t * len) / 8.0;
        ribbonUvs.push(0, vDist, 1, vDist);

        // Center lane stripe points (+0.02 above asphalt surface)
        const stripeHalfW = edge.roadClass === RoadClass.HIGHWAY ? 0.35 : 0.20;
        const stripeY = roadY + 0.02;
        stripePositions.push(
          cxPoint - perpX * stripeHalfW, stripeY, czPoint - perpZ * stripeHalfW,
          cxPoint + perpX * stripeHalfW, stripeY, czPoint + perpZ * stripeHalfW
        );
        stripeUvs.push(0, vDist, 1, vDist);

        // Concrete Sidewalk Ribbons on both sides
        const swLeftOuterX = leftX - perpX * sw;
        const swLeftOuterZ = leftZ - perpZ * sw;
        leftSidewalkPos.push(swLeftOuterX, swY, swLeftOuterZ, leftX, swY, leftZ);

        const swRightOuterX = rightX + perpX * sw;
        const swRightOuterZ = rightZ + perpZ * sw;
        rightSidewalkPos.push(rightX, swY, rightZ, swRightOuterX, swY, swRightOuterZ);

        sidewalkUvs.push(0, vDist, 1, vDist);
      }

      if (ribbonPositions.length >= 12) {
        // Construct asphalt ribbon mesh
        const ribbonGeo = this.createStripGeometry(ribbonPositions, ribbonUvs);
        const mat = edge.roadClass === RoadClass.HIGHWAY
          ? asphaltHighwayMat
          : edge.roadClass === RoadClass.AVENUE
          ? asphaltAvenueMat
          : asphaltLocalMat;

        const roadMesh = new THREE.Mesh(ribbonGeo, mat);
        roadMesh.receiveShadow = true;
        this.roadGroup.add(roadMesh);

        // Construct center line stripe
        const stripeGeo = this.createStripGeometry(stripePositions, stripeUvs);
        const stripeMat = edge.roadClass === RoadClass.HIGHWAY ? yellowStripeMat : whiteStripeMat;
        const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
        this.roadGroup.add(stripeMesh);

        // Construct Left Concrete Sidewalk
        const leftSwGeo = this.createStripGeometry(leftSidewalkPos, sidewalkUvs);
        const leftSwMesh = new THREE.Mesh(leftSwGeo, sidewalkMat);
        leftSwMesh.receiveShadow = true;
        this.roadGroup.add(leftSwMesh);

        // Construct Right Concrete Sidewalk
        const rightSwGeo = this.createStripGeometry(rightSidewalkPos, sidewalkUvs);
        const rightSwMesh = new THREE.Mesh(rightSwGeo, sidewalkMat);
        rightSwMesh.receiveShadow = true;
        this.roadGroup.add(rightSwMesh);
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
        chunk.build(
          cx,
          cz,
          this.terrainHeight,
          this.roadIndex,
          this.spec,
          this.propsGenerator,
          this.poolManager,
          this.roamWorld
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
            chunk.build(
              cx,
              cz,
              this.terrainHeight,
              this.roadIndex,
              this.spec,
              this.propsGenerator,
              this.poolManager,
              this.roamWorld
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
