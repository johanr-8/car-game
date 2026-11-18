/**
 * src/world/InstancedPool.ts
 * ─────────────────────────────────────────────────────────────
 * High-Performance Shared InstancedMesh Pools with O(1) Slot Allocation.
 *
 * Capabilities:
 *   - Global InstancedMesh pools shared across all chunks
 *   - Zero per-frame heap allocations during gameplay
 *   - O(1) stack-based slot acquisition and release
 *   - Collapses freed instances off-screen (scale 0 at y = -9999)
 *   - Safe capacity boundary: logs once and skips gracefully, never crashes
 *
 * RULES.md: Zero per-tick heap allocations. Low draw calls.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { BuildingStyle } from './DistrictMap';
import {
  getBuildingTexture,
  getBrickTexture,
  getWarehouseTexture,
  getHouseTexture,
} from './TextureGenerator';

export class InstancedPool {
  readonly name: string;
  readonly capacity: number;
  readonly mesh: THREE.InstancedMesh;

  private readonly freeList: Int32Array;
  private freeTop: number;
  private hasLoggedFull = false;
  private needsMatrixUpdate = false;

  private static readonly scratchZeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -9999, 0);

  constructor(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.name = name;
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Initialize all slots collapsed off-screen
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, InstancedPool.scratchZeroMatrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // Pre-allocated slot stack
    this.freeList = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.freeList[i] = i;
    }
    this.freeTop = capacity;
  }

  /**
   * Allocates a free slot index in O(1).
   * Returns -1 if capacity is reached (logs once and skips safely).
   */
  allocate(): number {
    if (this.freeTop <= 0) {
      if (!this.hasLoggedFull) {
        console.warn(`[InstancedPool ${this.name}] Capacity ${this.capacity} reached; skipping instance placement.`);
        this.hasLoggedFull = true;
      }
      return -1;
    }
    return this.freeList[--this.freeTop];
  }

  /**
   * Sets transformation matrix for an allocated slot.
   */
  setMatrix(slot: number, matrix: THREE.Matrix4): void {
    if (slot < 0 || slot >= this.capacity) return;
    this.mesh.setMatrixAt(slot, matrix);
    this.needsMatrixUpdate = true;
  }

  /**
   * Releases a slot back to the free pool in O(1).
   * Collapses instance geometry off-screen so it does not render.
   */
  free(slot: number): void {
    if (slot < 0 || slot >= this.capacity) return;
    this.mesh.setMatrixAt(slot, InstancedPool.scratchZeroMatrix);
    this.freeList[this.freeTop++] = slot;
    this.needsMatrixUpdate = true;
  }

  /**
   * Flushes modified instance matrices to GPU.
   */
  commit(): void {
    if (this.needsMatrixUpdate) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.needsMatrixUpdate = false;
    }
  }

  get allocatedCount(): number {
    return this.capacity - this.freeTop;
  }

  get availableCount(): number {
    return this.freeTop;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach(m => m.dispose());
    } else {
      this.mesh.material.dispose();
    }
  }
}

// ── Shared Unit Geometries ───────────────────────────────────

function createUnitHouseGeometry(): THREE.BufferGeometry {
  // Unit box base (walls) from y = 0 to 0.65, hipped roof prism from 0.65 to 1.0
  const geo = new THREE.BufferGeometry();

  const hw = 0.5, hd = 0.5;
  const wallH = 0.65;
  const roofPeakH = 1.0;

  // 14 vertices: 8 for box + 2 for roof ridge
  const positions: number[] = [
    // Bottom 4 (0..3)
    -hw, 0, -hd,
     hw, 0, -hd,
     hw, 0,  hd,
    -hw, 0,  hd,
    // Wall top 4 (4..7)
    -hw, wallH, -hd,
     hw, wallH, -hd,
     hw, wallH,  hd,
    -hw, wallH,  hd,
    // Roof ridge line 2 (8..9)
    -hw * 0.4, roofPeakH, 0,
     hw * 0.4, roofPeakH, 0,
  ];

  const indices: number[] = [
    // South wall
    7, 6, 2,  7, 2, 3,
    // North wall
    4, 1, 5,  4, 0, 1,
    // East wall
    5, 2, 6,  5, 1, 2,
    // West wall
    6, 0, 4,  6, 3, 0,
    // Roof South slope
    7, 9, 8,  7, 6, 9,
    // Roof North slope
    4, 8, 9,  4, 9, 5,
    // Roof West gable
    4, 7, 8,
    // Roof East gable
    6, 5, 9,
  ];

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Basic planar UVs
  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push(positions[i] + 0.5, positions[i + 1]);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return geo;
}

function createTreeGeometry(): THREE.BufferGeometry {
  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 1.8, 6);
  trunkGeo.translate(0, 0.9, 0);

  // Foliage cone 1 (lower)
  const f1Geo = new THREE.ConeGeometry(1.6, 2.8, 6);
  f1Geo.translate(0, 2.8, 0);

  // Foliage cone 2 (upper)
  const f2Geo = new THREE.ConeGeometry(1.2, 2.4, 6);
  f2Geo.translate(0, 4.2, 0);

  // Merge geometries
  return mergeBufferGeometries([trunkGeo, f1Geo, f2Geo]);
}

function createStreetLampGeometry(): THREE.BufferGeometry {
  // Thin vertical pole + horizontal arm + lamp head
  const pole = new THREE.CylinderGeometry(0.08, 0.12, 6.5, 6);
  pole.translate(0, 3.25, 0);

  const arm = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6);
  arm.rotateZ(Math.PI / 2.3);
  arm.translate(0.8, 6.6, 0);

  const head = new THREE.BoxGeometry(0.35, 0.15, 0.22);
  head.translate(1.6, 6.7, 0);

  return mergeBufferGeometries([pole, arm, head]);
}

function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;

  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    if (g.index) totalIndices += g.index.count;
  }

  const mergedPos = new Float32Array(totalVerts * 3);
  const mergedNorm = new Float32Array(totalVerts * 3);
  const mergedIndices = new Uint16Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  let indexVertexOffset = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    mergedPos.set(pos.array as Float32Array, vOffset * 3);
    if (norm) {
      mergedNorm.set(norm.array as Float32Array, vOffset * 3);
    }

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        mergedIndices[iOffset + i] = idx[i] + indexVertexOffset;
      }
      iOffset += idx.length;
    }

    indexVertexOffset += pos.count;
    vOffset += pos.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
  if (totalIndices > 0) {
    merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
  }
  return merged;
}

// ── Global Instanced Pool Registry ───────────────────────────

export class CityPoolManager {
  readonly buildingPools: Record<BuildingStyle, InstancedPool>;
  readonly treePool: InstancedPool;
  readonly lampPool: InstancedPool;
  readonly rootGroup = new THREE.Group();

  // Capacities configured with generous safety factor
  static readonly BUILDING_CAPACITY = 500;
  static readonly TREE_CAPACITY = 2500;
  static readonly LAMP_CAPACITY = 1500;

  constructor() {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitHouse = createUnitHouseGeometry();
    const treeGeo = createTreeGeometry();
    const lampGeo = createStreetLampGeometry();

    // 1. Materials for 6 building styles
    const glassMat = new THREE.MeshStandardMaterial({
      map: getBuildingTexture(1), // Reflective curtain wall
      color: 0x93c5fd,
      roughness: 0.25,
      metalness: 0.85,
    });

    const concreteMat = new THREE.MeshStandardMaterial({
      map: getBuildingTexture(0), // Concrete panel
      color: 0xcbd5e1,
      roughness: 0.82,
      metalness: 0.15,
    });

    const brickMat = new THREE.MeshStandardMaterial({
      map: getBrickTexture(),
      color: 0xb97262,
      roughness: 0.85,
      metalness: 0.08,
    });

    const steelMat = new THREE.MeshStandardMaterial({
      map: getBuildingTexture(3), // Dark slate steel
      color: 0x64748b,
      roughness: 0.45,
      metalness: 0.75,
    });

    const warehouseMat = new THREE.MeshStandardMaterial({
      map: getWarehouseTexture(),
      color: 0x94a3b8,
      roughness: 0.70,
      metalness: 0.40,
    });

    const houseMat = new THREE.MeshStandardMaterial({
      map: getHouseTexture(),
      color: 0xf1f5f9,
      roughness: 0.78,
      metalness: 0.12,
    });

    // 2. Tree and Lamp materials
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x245428,
      roughness: 0.88,
      metalness: 0.05,
    });

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x29313d,
      roughness: 0.35,
      metalness: 0.80,
      emissive: 0xfff2cc,
      emissiveIntensity: 0.25,
    });

    // 3. Instantiate pools
    this.buildingPools = {
      [BuildingStyle.GLASS]: new InstancedPool('Building_Glass', unitBox, glassMat, CityPoolManager.BUILDING_CAPACITY),
      [BuildingStyle.CONCRETE]: new InstancedPool('Building_Concrete', unitBox, concreteMat, CityPoolManager.BUILDING_CAPACITY),
      [BuildingStyle.BRICK]: new InstancedPool('Building_Brick', unitBox, brickMat, CityPoolManager.BUILDING_CAPACITY),
      [BuildingStyle.STEEL]: new InstancedPool('Building_Steel', unitBox, steelMat, CityPoolManager.BUILDING_CAPACITY),
      [BuildingStyle.WAREHOUSE]: new InstancedPool('Building_Warehouse', unitBox, warehouseMat, CityPoolManager.BUILDING_CAPACITY),
      [BuildingStyle.HOUSE]: new InstancedPool('Building_House', unitHouse, houseMat, CityPoolManager.BUILDING_CAPACITY),
    };

    this.treePool = new InstancedPool('Props_Tree', treeGeo, treeMat, CityPoolManager.TREE_CAPACITY);
    this.lampPool = new InstancedPool('Props_StreetLamp', lampGeo, lampMat, CityPoolManager.LAMP_CAPACITY);

    // Mount to rootGroup (strictly 8 draw calls total for all city props!)
    for (const style of Object.values(BuildingStyle)) {
      this.rootGroup.add(this.buildingPools[style].mesh);
    }
    this.rootGroup.add(this.treePool.mesh);
    this.rootGroup.add(this.lampPool.mesh);
  }

  commitAll(): void {
    for (const style of Object.values(BuildingStyle)) {
      this.buildingPools[style].commit();
    }
    this.treePool.commit();
    this.lampPool.commit();
  }

  dispose(): void {
    for (const style of Object.values(BuildingStyle)) {
      this.buildingPools[style].dispose();
    }
    this.treePool.dispose();
    this.lampPool.dispose();
  }
}
