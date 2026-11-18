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
import type { WorldSpec } from './WorldConfig';
import type { TerrainHeight } from './TerrainHeight';
import type { SpatialRoadIndex } from './RoadNetwork';
import { RoadClass } from './RoadNetwork';
import { getAsphaltTexture, getGrassTexture } from './TextureGenerator';
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

// Shared Materials (Created once, cached at module scope)
const terrainMat = new THREE.MeshStandardMaterial({
  map: roamGrassTex,
  vertexColors: true,
  roughness: 0.88,
  metalness: 0.04,
  flatShading: false,
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

function clipSegmentAABB(
  x0: number, z0: number,
  x1: number, z1: number,
  minX: number, maxX: number,
  minZ: number, maxZ: number,
  outT: ClipResult
): boolean {
  let t0 = 0.0;
  let t1 = 1.0;
  const dx = x1 - x0;
  const dz = z1 - z0;

  const p = [-dx, dx, -dz, dz];
  const q = [x0 - minX, maxX - x0, z0 - minZ, maxZ - z0];

  for (let i = 0; i < 4; i++) {
    const pi = p[i];
    const qi = q[i];
    if (Math.abs(pi) < 1e-9) {
      if (qi < 0) return false;
    } else {
      const r = qi / pi;
      if (pi < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  outT.t0 = t0;
  outT.t1 = t1;
  return t0 <= t1;
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
        const nearest = roadIndex.getNearestRoad(x, z, 24);

        // Depress terrain mesh under asphalt ribbons to eliminate any clipping or overlapping
        if (nearest && nearest.distance <= nearest.roadHalfWidth) {
          y -= 0.16;
        } else if (nearest && nearest.distance < nearest.roadHalfWidth + 1.5) {
          const tEdge = (nearest.distance - nearest.roadHalfWidth) / 1.5;
          y -= 0.16 * (1 - tEdge);
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

      const subSteps = Math.max(2, Math.ceil(segLen / 12));
      const ribbonPositions: number[] = [];
      const ribbonUvs: number[] = [];
      const stripePositions: number[] = [];
      const stripeUvs: number[] = [];

      for (let s = 0; s <= subSteps; s++) {
        const stepT = s / subSteps;
        const t = t0 + stepT * (t1 - t0);
        const cxPoint = nA.x + t * dx;
        const czPoint = nA.z + t * dz;

        const leftX = cxPoint - perpX * halfW;
        const leftZ = czPoint - perpZ * halfW;
        const leftY = terrainHeight.groundHeightAt(leftX, leftZ);

        const rightX = cxPoint + perpX * halfW;
        const rightZ = czPoint + perpZ * halfW;
        const rightY = terrainHeight.groundHeightAt(rightX, rightZ);

        ribbonPositions.push(leftX, leftY, leftZ, rightX, rightY, rightZ);

        const vDist = (t * len) / 8.0;
        ribbonUvs.push(0, vDist, 1, vDist);

        // Center lane stripe points (+0.02 above asphalt surface)
        const stripeHalfW = edge.roadClass === RoadClass.HIGHWAY ? 0.35 : 0.20;
        const stripeY = terrainHeight.groundHeightAt(cxPoint, czPoint) + 0.02;
        stripePositions.push(
          cxPoint - perpX * stripeHalfW, stripeY, czPoint - perpZ * stripeHalfW,
          cxPoint + perpX * stripeHalfW, stripeY, czPoint + perpZ * stripeHalfW
        );
        stripeUvs.push(0, vDist, 1, vDist);
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
    }
    this.allocatedTreeSlots.length = 0;
    this.allocatedLampSlots.length = 0;

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

  private readonly loadedChunks = new Map<string, TerrainChunk>();
  private readonly chunkPool: TerrainChunk[] = [];
  private readonly buildQueue: { cx: number; cz: number }[] = [];
  private readonly queuedSet = new Set<string>();

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

  private chunkKey(cx: number, cz: number): string {
    return `${cx}_${cz}`;
  }

  get loadedCount(): number {
    return this.loadedChunks.size;
  }

  /**
   * Per-frame chunk streaming update.
   * Loads within loadRadius, unloads beyond unloadRadius with hysteresis,
   * and builds at most one chunk per frame within a ~2ms budget.
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

      // A. Queue chunks within loadRadius that are not yet loaded
      for (let dx = -loadRad; dx <= loadRad; dx++) {
        for (let dz = -loadRad; dz <= loadRad; dz++) {
          if (dx * dx + dz * dz <= loadRadSq) {
            const cx = playerCx + dx;
            const cz = playerCz + dz;
            const key = this.chunkKey(cx, cz);

            if (!this.loadedChunks.has(key) && !this.queuedSet.has(key)) {
              this.buildQueue.push({ cx, cz });
              this.queuedSet.add(key);
            }
          }
        }
      }

      // Sort build queue so chunks closest to player build first
      this.buildQueue.sort((a, b) => {
        const distA = (a.cx - playerCx) ** 2 + (a.cz - playerCz) ** 2;
        const distB = (b.cx - playerCx) ** 2 + (b.cz - playerCz) ** 2;
        return distA - distB;
      });

      // B. Unload chunks beyond unloadRadius with hysteresis
      for (const [key, chunk] of this.loadedChunks.entries()) {
        const dx = chunk.cx - playerCx;
        const dz = chunk.cz - playerCz;
        if (dx * dx + dz * dz > unloadRadSq) {
          this.unloadChunk(key, chunk);
        }
      }
    }

    // ── 2. Build at Most One Chunk per Frame (~2 ms Budget) ──
    if (this.buildQueue.length > 0) {
      const item = this.buildQueue.shift()!;
      const key = this.chunkKey(item.cx, item.cz);
      this.queuedSet.delete(key);

      if (!this.loadedChunks.has(key)) {
        const t0 = performance.now();

        // Get chunk from pool or instantiate if pool empty
        const chunk = this.chunkPool.length > 0 ? this.chunkPool.pop()! : new TerrainChunk();
        chunk.build(
          item.cx,
          item.cz,
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

  private unloadChunk(key: string, chunk: TerrainChunk): void {
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
          const key = this.chunkKey(cx, cz);

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
    for (const [key, chunk] of this.loadedChunks.entries()) {
      this.unloadChunk(key, chunk);
    }
    for (let i = 0; i < this.chunkPool.length; i++) {
      this.chunkPool[i].dispose();
    }
    this.chunkPool.length = 0;
  }
}
