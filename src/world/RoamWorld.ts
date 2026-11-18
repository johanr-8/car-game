/**
 * src/world/RoamWorld.ts
 * ─────────────────────────────────────────────────────────────
 * Free Roam Streaming World:
 *   - Config-driven WorldSpec (worldSize 4000m, chunkSize 128m)
 *   - Planar road network (Ring Highway, Diagonals, Avenues, Local Streets)
 *   - Low-frequency seeded rolling terrain height with road flattening
 *   - ChunkManager streaming within load/unload radii with hysteresis
 *   - SurfaceProvider implementation with analytic ground height/normal
 *   - Spawns car directly on highway with clear straightaway
 *
 * RULES.md: Zero per-tick heap allocations. Budgeted chunk builds.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { SurfaceHit, SurfaceProvider } from './SurfaceProvider';
import { SurfaceType, DEFAULT_WORLD_SPEC, type WorldSpec, getChunkKey } from './WorldConfig';
import { generateRoadNetwork, SpatialRoadIndex, type RoadGraph } from './RoadNetwork';
import { TerrainHeight } from './TerrainHeight';
import { ChunkManager } from './ChunkManager';
import { CITY_THEMES, type CityTheme } from './TimeOfDay';
import { DistrictMap } from './DistrictMap';
import { createLandmarkDefs, type LandmarkDef } from './Landmarks';
import { CityPoolManager } from './InstancedPool';
import { CityPropsGenerator } from './CityPropsGenerator';
import type { ChunkCollider } from './ChunkCollider';
import { WaterSystem } from './WaterSystem';

const _scratchSolidPoint = new THREE.Vector3();
const _scratchSolidNormal = new THREE.Vector3();

// Coastal Meadow Spawn Point: Spawns on a flat, lush meadow overlooking the western ocean
export const ROAM_SPAWN_POS = new THREE.Vector3(-960, 22.0, -320);
// Heading East/Inland towards the city basin
export const ROAM_SPAWN_QUAT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  -Math.PI * 0.5
);

export class RoamWorld implements SurfaceProvider {
  readonly spec: WorldSpec;
  readonly roadGraph: RoadGraph;
  readonly roadIndex: SpatialRoadIndex;
  readonly terrainHeight: TerrainHeight;
  readonly districtMap: DistrictMap;
  readonly landmarks: LandmarkDef[];
  readonly poolManager: CityPoolManager;
  readonly propsGenerator: CityPropsGenerator;
  readonly waterSystem: WaterSystem;
  readonly chunkManager: ChunkManager;

  readonly visualGroup = new THREE.Group();

  // Local Chunk BVH Colliders Map (Numeric keys: getChunkKey(cx, cz) -> ChunkCollider)
  private readonly chunkColliders = new Map<number, ChunkCollider>();
  private readonly bvhRaycaster = new THREE.Raycaster();
  private readonly bvhHits: THREE.Intersection[] = [];

  // Atmosphere & Lighting
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly currentTheme: CityTheme;

  constructor(
    _scene?: THREE.Scene,
    renderer?: THREE.WebGLRenderer,
    spec: WorldSpec = DEFAULT_WORLD_SPEC
  ) {
    this.spec = spec;
    this.currentTheme = CITY_THEMES[0]; // High-noon vibrant daylight theme
    this.bvhRaycaster.firstHitOnly = true;

    // 1. Atmosphere Lights (matching race mode style)
    this.sunLight = new THREE.DirectionalLight(this.currentTheme.sunColor, this.currentTheme.sunIntensity);
    this.sunLight.position.set(100, 220, 80);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 450;
    this.sunLight.shadow.camera.left = -160;
    this.sunLight.shadow.camera.right = 160;
    this.sunLight.shadow.camera.top = 160;
    this.sunLight.shadow.camera.bottom = -160;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;

    this.hemiLight = new THREE.HemisphereLight(
      this.currentTheme.hemiSkyColor,
      this.currentTheme.hemiGroundColor,
      this.currentTheme.hemiIntensity
    );

    // 2. Generate Road Network & Spatial Index
    this.roadGraph = generateRoadNetwork(this.spec);
    this.roadIndex = new SpatialRoadIndex(this.roadGraph, this.spec.chunkSize);

    // 3. Terrain Height Engine (analytic elevation + road flattening)
    this.terrainHeight = new TerrainHeight(this.spec, this.roadIndex);

    // 4. District Map & Landmarks
    this.districtMap = new DistrictMap(this.spec);
    this.landmarks = createLandmarkDefs(this.spec.chunkSize);

    // 5. Shared Global InstancedMesh Pools
    this.poolManager = new CityPoolManager();
    this.visualGroup.add(this.poolManager.rootGroup);

    // 6. City Props Generator (Lots, Buildings, Trees, Lamps)
    this.propsGenerator = new CityPropsGenerator(
      this.spec,
      this.roadIndex,
      this.terrainHeight,
      this.districtMap,
      this.landmarks
    );

    // 7. Water System (Sea plane + Inland Lake)
    this.waterSystem = new WaterSystem(this.spec, this.terrainHeight.landforms ?? undefined);
    this.visualGroup.add(this.waterSystem.rootGroup);

    // Update spawn position to exact ground elevation
    const spawnGroundY = this.terrainHeight.groundHeightAt(ROAM_SPAWN_POS.x, ROAM_SPAWN_POS.z);
    ROAM_SPAWN_POS.y = spawnGroundY + 0.34;

    // 8. Procedural Chunk Manager
    this.chunkManager = new ChunkManager(
      this.spec,
      this.terrainHeight,
      this.roadIndex,
      this.propsGenerator,
      this.poolManager,
      this
    );
    this.visualGroup.add(this.chunkManager.rootGroup);

    // Pre-warm initial chunks around spawn
    this.chunkManager.warmUp(ROAM_SPAWN_POS.x, ROAM_SPAWN_POS.z);

    if (renderer) {
      this.applyAtmosphere(renderer);
    }
  }

  registerChunkCollider(collider: ChunkCollider): void {
    this.chunkColliders.set(getChunkKey(collider.cx, collider.cz), collider);
  }

  unregisterChunkCollider(cx: number, cz: number): void {
    this.chunkColliders.delete(getChunkKey(cx, cz));
  }

  /**
   * Resets per-tick caches and telemetry counters at the start of each physics tick.
   */
  startPhysicsTick(): void {
    this.terrainHeight.resetTickCache();
    this.roadIndex.resetTickCounters();
  }

  applyAtmosphere(renderer: THREE.WebGLRenderer): void {
    renderer.setClearColor(this.currentTheme.skyColor, 1);
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.visualGroup);
    scene.add(this.sunLight);
    scene.add(this.hemiLight);
    // Tuned daylight fog: clear within 260m, smooth daylight haze to 620m (hides chunk streaming)
    scene.fog = new THREE.Fog(this.currentTheme.fogColor, 260, 620);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.visualGroup);
    scene.remove(this.sunLight);
    scene.remove(this.hemiLight);
  }

  /**
   * Per-frame visual update for chunk streaming and water animation.
   */
  updateVisuals(playerX: number, playerZ: number, dt: number = 0.016): void {
    this.chunkManager.update(playerX, playerZ);
    this.waterSystem.update(dt);

    // Keep sunlight shadow camera centered near player for sharp shadows
    this.sunLight.position.set(playerX + 100, 220, playerZ + 80);
    this.sunLight.target.position.set(playerX, 0, playerZ);
    this.sunLight.target.updateMatrixWorld();
  }

  get loadedChunksCount(): number {
    return this.chunkManager.loadedCount;
  }

  get chunkBuildMs(): number {
    return this.chunkManager.lastBuildMs;
  }

  // ── SurfaceProvider Implementation (Terrain + Local Chunk BVH) ──

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    outHit: SurfaceHit
  ): boolean {
    outHit.hit = false;

    // 1. Check Local Chunk BVH Colliders (Solid Buildings, Walls, Landmarks)
    let hitSolid = false;
    let bestSolidDist = Infinity;

    const chunkSize = this.spec.chunkSize;
    const minCx = Math.floor((origin.x - maxDistance) / chunkSize);
    const maxCx = Math.floor((origin.x + maxDistance) / chunkSize);
    const minCz = Math.floor((origin.z - maxDistance) / chunkSize);
    const maxCz = Math.floor((origin.z + maxDistance) / chunkSize);

    this.bvhRaycaster.ray.origin.copy(origin);
    this.bvhRaycaster.ray.direction.copy(direction).normalize();
    this.bvhRaycaster.far = maxDistance;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const collider = this.chunkColliders.get(getChunkKey(cx, cz));
        if (collider && collider.mesh) {
          this.bvhHits.length = 0;
          collider.mesh.raycast(this.bvhRaycaster, this.bvhHits);

          if (this.bvhHits.length > 0 && this.bvhHits[0].distance < bestSolidDist) {
            const h = this.bvhHits[0];
            bestSolidDist = h.distance;
            _scratchSolidPoint.copy(h.point);
            if (h.face) {
              _scratchSolidNormal.copy(h.face.normal);
            } else {
              _scratchSolidNormal.set(0, 1, 0);
            }
            hitSolid = true;
          }
        }
      }
    }

    // 2. Check Ground Surface
    let hitGround = false;
    let groundDist = Infinity;
    let groundPointY = 0;

    // Downward ground probes (car suspension, surface sticking)
    if (direction.y < -0.05) {
      const h0 = this.terrainHeight.groundHeightAt(origin.x, origin.z);
      let t = (origin.y - h0) / (-direction.y);

      if (t >= 0 && t <= maxDistance) {
        const x1 = origin.x + direction.x * t;
        const z1 = origin.z + direction.z * t;
        const h1 = this.terrainHeight.groundHeightAt(x1, z1);
        t = (origin.y - h1) / (-direction.y);

        if (t >= 0 && t <= maxDistance) {
          hitGround = true;
          groundDist = t;
          groundPointY = h1;
        }
      }
    } else {
      // General path: check if forward ray penetrates the terrain surface
      const endX = origin.x + direction.x * maxDistance;
      const endY = origin.y + direction.y * maxDistance;
      const endZ = origin.z + direction.z * maxDistance;
      const endGround = this.terrainHeight.groundHeightAt(endX, endZ);

      if (endY < endGround) {
        let tLo = 0;
        let tHi = maxDistance;
        for (let iter = 0; iter < 4; iter++) {
          const tMid = (tLo + tHi) * 0.5;
          const mx = origin.x + direction.x * tMid;
          const my = origin.y + direction.y * tMid;
          const mz = origin.z + direction.z * tMid;
          const gh = this.terrainHeight.groundHeightAt(mx, mz);
          if (my < gh) {
            tHi = tMid;
          } else {
            tLo = tMid;
          }
        }
        hitGround = true;
        groundDist = tHi;
        groundPointY = origin.y + direction.y * tHi;
      }
    }

    // 3. Resolve closest hit between Solid Objects and Ground
    if (hitSolid && (!hitGround || bestSolidDist <= groundDist)) {
      outHit.hit = true;
      outHit.distance = bestSolidDist;
      outHit.point.copy(_scratchSolidPoint);
      outHit.normal.copy(_scratchSolidNormal);
      if (outHit.normal.dot(direction) > 0) {
        outHit.normal.negate();
      }
      return true;
    }

    if (hitGround) {
      outHit.hit = true;
      outHit.distance = groundDist;
      outHit.point.set(
        origin.x + direction.x * groundDist,
        groundPointY,
        origin.z + direction.z * groundDist
      );
      this.terrainHeight.groundNormalAt(outHit.point.x, outHit.point.z, outHit.normal);
      return true;
    }

    return false;
  }

  groundHeightAt(x: number, z: number): number {
    return this.terrainHeight.groundHeightAt(x, z);
  }

  groundNormalAt(x: number, z: number, outNormal: THREE.Vector3): void {
    this.terrainHeight.groundNormalAt(x, z, outNormal);
  }

  getSurfaceTypeAt(x: number, z: number): SurfaceType {
    return this.terrainHeight.getSurfaceTypeAt(x, z);
  }

  dispose(): void {
    this.chunkManager.dispose();
    this.waterSystem.dispose();
    this.poolManager.dispose();
    this.chunkColliders.clear();
  }
}
