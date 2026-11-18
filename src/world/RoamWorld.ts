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
import { SurfaceType, DEFAULT_WORLD_SPEC, type WorldSpec } from './WorldConfig';
import { generateRoadNetwork, SpatialRoadIndex, type RoadGraph } from './RoadNetwork';
import { TerrainHeight } from './TerrainHeight';
import { ChunkManager } from './ChunkManager';
import { CITY_THEMES, type CityTheme } from './TimeOfDay';

// Highway Spawn Point: Spawns on the 22m-wide diagonal highway heading Northeast
export const ROAM_SPAWN_POS = new THREE.Vector3(-800, 2.84, -800);
// -135 degrees around Y turns (0, 0, -1) into (+X, +Z) along diagonal highway
export const ROAM_SPAWN_QUAT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  -Math.PI * 0.75
);

export class RoamWorld implements SurfaceProvider {
  readonly spec: WorldSpec;
  readonly roadGraph: RoadGraph;
  readonly roadIndex: SpatialRoadIndex;
  readonly terrainHeight: TerrainHeight;
  readonly chunkManager: ChunkManager;

  readonly visualGroup = new THREE.Group();

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

    // Update spawn position to exact ground elevation
    const spawnGroundY = this.terrainHeight.groundHeightAt(ROAM_SPAWN_POS.x, ROAM_SPAWN_POS.z);
    ROAM_SPAWN_POS.y = spawnGroundY + 0.34;

    // 4. Procedural Chunk Manager
    this.chunkManager = new ChunkManager(this.spec, this.terrainHeight, this.roadIndex);
    this.visualGroup.add(this.chunkManager.rootGroup);

    // Pre-warm initial chunks around spawn
    this.chunkManager.warmUp(ROAM_SPAWN_POS.x, ROAM_SPAWN_POS.z);

    if (renderer) {
      this.applyAtmosphere(renderer);
    }
  }

  applyAtmosphere(renderer: THREE.WebGLRenderer): void {
    renderer.setClearColor(this.currentTheme.skyColor, 1);
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.visualGroup);
    scene.add(this.sunLight);
    scene.add(this.hemiLight);
    scene.fog = new THREE.FogExp2(this.currentTheme.fogColor, this.currentTheme.fogDensity);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.visualGroup);
    scene.remove(this.sunLight);
    scene.remove(this.hemiLight);
  }

  /**
   * Per-frame visual update for chunk streaming.
   */
  updateVisuals(playerX: number, playerZ: number): void {
    this.chunkManager.update(playerX, playerZ);

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

  // ── SurfaceProvider Implementation (Zero Mesh BVH for Terrain) ──

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    outHit: SurfaceHit
  ): boolean {
    outHit.hit = false;

    // Fast path: Downward ground probes (car suspension, surface sticking)
    if (direction.y < -0.05) {
      const h0 = this.terrainHeight.groundHeightAt(origin.x, origin.z);
      let t = (origin.y - h0) / (-direction.y);

      if (t >= 0 && t <= maxDistance) {
        // Refine once for ground slope
        const x1 = origin.x + direction.x * t;
        const z1 = origin.z + direction.z * t;
        const h1 = this.terrainHeight.groundHeightAt(x1, z1);
        t = (origin.y - h1) / (-direction.y);

        if (t >= 0 && t <= maxDistance) {
          outHit.hit = true;
          outHit.distance = t;
          outHit.point.set(
            origin.x + direction.x * t,
            h1,
            origin.z + direction.z * t
          );
          this.terrainHeight.groundNormalAt(outHit.point.x, outHit.point.z, outHit.normal);
          return true;
        }
      }
    } else {
      // General path: check if forward ray penetrates the terrain surface
      const endX = origin.x + direction.x * maxDistance;
      const endY = origin.y + direction.y * maxDistance;
      const endZ = origin.z + direction.z * maxDistance;
      const endGround = this.terrainHeight.groundHeightAt(endX, endZ);

      if (endY < endGround) {
        // Ray penetrates ground: find intersection via bisection
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
        outHit.hit = true;
        outHit.distance = tHi;
        outHit.point.set(
          origin.x + direction.x * tHi,
          origin.y + direction.y * tHi,
          origin.z + direction.z * tHi
        );
        this.terrainHeight.groundNormalAt(outHit.point.x, outHit.point.z, outHit.normal);
        return true;
      }
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
  }
}
