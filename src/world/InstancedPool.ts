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
  getNeonBillboardTexture,
  getGantryTexture,
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
  // Lower walls: unit box 1.0 x 0.65 x 1.0, centered at y = -0.175 (bounds [-0.5, 0.15])
  const walls = new THREE.BoxGeometry(1.0, 0.65, 1.0);
  walls.translate(0, -0.175, 0);

  // Upper hipped roof: 4-sided pyramid, base rotated 45 deg to align with walls.
  // Radius to corner = 0.5 * sqrt(2) ≈ 0.7071. We use 0.74 for a crisp eave overhang.
  // Height = 0.35, centered at y = 0.325 (bounds [0.15, 0.50])
  const roof = new THREE.ConeGeometry(0.74, 0.35, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.325, 0);

  return mergeBufferGeometries([walls, roof]);
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

function createNeonBillboardGeometry(): THREE.BufferGeometry {
  // Front glowing display screen (10m x 4.8m x 0.4m)
  const screen = new THREE.BoxGeometry(10.0, 4.8, 0.4);
  screen.translate(0, 5.0, 0);

  // Twin vertical steel support legs
  const leg1 = new THREE.CylinderGeometry(0.2, 0.25, 4.0, 6);
  leg1.translate(-3.6, 2.0, 0);
  const leg2 = new THREE.CylinderGeometry(0.2, 0.25, 4.0, 6);
  leg2.translate(3.6, 2.0, 0);

  // Rear diagonal structural bracing
  const strut1 = new THREE.CylinderGeometry(0.12, 0.12, 4.5, 6);
  strut1.rotateX(0.4);
  strut1.translate(-3.6, 2.6, -0.9);
  const strut2 = new THREE.CylinderGeometry(0.12, 0.12, 4.5, 6);
  strut2.rotateX(0.4);
  strut2.translate(3.6, 2.6, -0.9);

  return mergeBufferGeometries([screen, leg1, leg2, strut1, strut2]);
}

function createHighwayGantryGeometry(): THREE.BufferGeometry {
  // Spanning arch across roadway: left column, right column, crossbeam, sign board
  const p1 = new THREE.CylinderGeometry(0.35, 0.45, 9.5, 8);
  p1.translate(-12.0, 4.75, 0);

  const p2 = new THREE.CylinderGeometry(0.35, 0.45, 9.5, 8);
  p2.translate(12.0, 4.75, 0);

  const beam = new THREE.BoxGeometry(25.0, 1.2, 1.2);
  beam.translate(0, 9.0, 0);

  const sign = new THREE.BoxGeometry(14.0, 2.8, 0.3);
  sign.translate(0, 8.8, 0.65);

  return mergeBufferGeometries([p1, p2, beam, sign]);
}

function createStreetBollardGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.16, 0.20, 1.2, 8);
  body.translate(0, 0.60, 0);

  const ring = new THREE.CylinderGeometry(0.18, 0.18, 0.25, 8);
  ring.translate(0, 1.10, 0);

  return mergeBufferGeometries([body, ring]);
}

function createRooftopAntennaGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(2.5, 1.5, 2.5);
  base.translate(0, 0.75, 0);

  const mast = new THREE.CylinderGeometry(0.08, 0.35, 18.0, 6);
  mast.translate(0, 10.5, 0);

  const beacon = new THREE.SphereGeometry(0.55, 6, 6);
  beacon.translate(0, 19.5, 0);

  return mergeBufferGeometries([base, mast, beacon]);
}

function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  let hasUV = false;

  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    if (g.index) totalIndices += g.index.count;
    if (g.getAttribute('uv')) hasUV = true;
  }

  const mergedPos = new Float32Array(totalVerts * 3);
  const mergedNorm = new Float32Array(totalVerts * 3);
  const mergedUv = hasUV ? new Float32Array(totalVerts * 2) : null;
  const mergedIndices = new Uint16Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  let indexVertexOffset = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');

    mergedPos.set(pos.array as Float32Array, vOffset * 3);
    if (norm) {
      mergedNorm.set(norm.array as Float32Array, vOffset * 3);
    }
    if (mergedUv && uv) {
      mergedUv.set(uv.array as Float32Array, vOffset * 2);
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
  if (mergedUv) {
    merged.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
  }
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
  readonly billboardPools: InstancedPool[];
  readonly gantryPool: InstancedPool;
  readonly bollardPool: InstancedPool;
  readonly antennaPool: InstancedPool;
  readonly rootGroup = new THREE.Group();

  // Capacities configured with generous safety factor
  static readonly BUILDING_CAPACITY = 500;
  static readonly TREE_CAPACITY = 2500;
  static readonly LAMP_CAPACITY = 1500;
  static readonly BILLBOARD_CAPACITY = 300;
  static readonly GANTRY_CAPACITY = 150;
  static readonly BOLLARD_CAPACITY = 1200;
  static readonly ANTENNA_CAPACITY = 400;

  constructor() {
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitHouse = createUnitHouseGeometry();
    const treeGeo = createTreeGeometry();
    const lampGeo = createStreetLampGeometry();
    const billboardGeo = createNeonBillboardGeometry();
    const gantryGeo = createHighwayGantryGeometry();
    const bollardGeo = createStreetBollardGeometry();
    const antennaGeo = createRooftopAntennaGeometry();

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

    // 3. Cyberpunk Architectural Materials
    const bbMat1 = new THREE.MeshStandardMaterial({
      map: getNeonBillboardTexture(0),
      emissiveMap: getNeonBillboardTexture(0),
      emissive: 0xffffff,
      emissiveIntensity: 2.2,
      roughness: 0.25,
      metalness: 0.80,
    });

    const bbMat2 = new THREE.MeshStandardMaterial({
      map: getNeonBillboardTexture(1),
      emissiveMap: getNeonBillboardTexture(1),
      emissive: 0xffffff,
      emissiveIntensity: 2.2,
      roughness: 0.25,
      metalness: 0.80,
    });

    const gantryMat = new THREE.MeshStandardMaterial({
      map: getGantryTexture(),
      emissiveMap: getGantryTexture(),
      emissive: 0x34d399,
      emissiveIntensity: 1.4,
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.35,
    });

    const bollardMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.8,
      metalness: 0.90,
      roughness: 0.20,
    });

    const antennaMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      emissive: 0xef4444,
      emissiveIntensity: 2.5,
      metalness: 0.85,
      roughness: 0.30,
    });

    // 4. Instantiate pools
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

    this.billboardPools = [
      new InstancedPool('Props_NeonBB1', billboardGeo, bbMat1, CityPoolManager.BILLBOARD_CAPACITY),
      new InstancedPool('Props_NeonBB2', billboardGeo, bbMat2, CityPoolManager.BILLBOARD_CAPACITY),
    ];

    this.gantryPool = new InstancedPool('Props_Gantry', gantryGeo, gantryMat, CityPoolManager.GANTRY_CAPACITY);
    this.bollardPool = new InstancedPool('Props_Bollard', bollardGeo, bollardMat, CityPoolManager.BOLLARD_CAPACITY);
    this.antennaPool = new InstancedPool('Props_Antenna', antennaGeo, antennaMat, CityPoolManager.ANTENNA_CAPACITY);

    // Mount to rootGroup
    for (const style of Object.values(BuildingStyle)) {
      this.rootGroup.add(this.buildingPools[style].mesh);
    }
    this.rootGroup.add(this.treePool.mesh);
    this.rootGroup.add(this.lampPool.mesh);
    for (let i = 0; i < this.billboardPools.length; i++) {
      this.rootGroup.add(this.billboardPools[i].mesh);
    }
    this.rootGroup.add(this.gantryPool.mesh);
    this.rootGroup.add(this.bollardPool.mesh);
    this.rootGroup.add(this.antennaPool.mesh);
  }

  commitAll(): void {
    for (const style of Object.values(BuildingStyle)) {
      this.buildingPools[style].commit();
    }
    this.treePool.commit();
    this.lampPool.commit();
    for (let i = 0; i < this.billboardPools.length; i++) {
      this.billboardPools[i].commit();
    }
    this.gantryPool.commit();
    this.bollardPool.commit();
    this.antennaPool.commit();
  }

  dispose(): void {
    for (const style of Object.values(BuildingStyle)) {
      this.buildingPools[style].dispose();
    }
    this.treePool.dispose();
    this.lampPool.dispose();
    for (let i = 0; i < this.billboardPools.length; i++) {
      this.billboardPools[i].dispose();
    }
    this.gantryPool.dispose();
    this.bollardPool.dispose();
    this.antennaPool.dispose();
  }
}
