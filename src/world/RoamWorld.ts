/**
 * src/world/RoamWorld.ts
 * ─────────────────────────────────────────────────────────────
 * Free Roam Sandbox Environment:
 *   - Large flat grass terrain
 *   - Simple asphalt test road cross with lane stripes and rumble curbs
 *   - Scattered obstacle boxes (shipping containers, crates, slalom barriers)
 *   - Identical lighting (PCFSoft shadows, hemisphere & fill) and fog style as race mode
 *   - Fast BVH collision implementing SurfaceProvider
 *   - No laps, timers, or checkpoints
 *
 * RULES.md: Zero per-tick heap allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { CollisionWorld } from './CollisionWorld';
import type { SurfaceHit, SurfaceProvider } from './SurfaceProvider';
import { CITY_THEMES, type CityTheme } from './TimeOfDay';

export const ROAM_SPAWN_POS = new THREE.Vector3(0, 0.94, -30);
export const ROAM_SPAWN_QUAT = new THREE.Quaternion(0, 0, 0, 1);

export class RoamWorld implements SurfaceProvider {
  readonly visualGroup = new THREE.Group();
  private readonly collisionWorld = new CollisionWorld();

  // Atmosphere & Lighting
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fillLight: THREE.DirectionalLight;
  readonly currentTheme: CityTheme;

  constructor(_scene?: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    this.currentTheme = CITY_THEMES[0]; // High-noon vibrant daylight theme

    // 1. Atmosphere Lights
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

    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.fillLight.position.set(-80, 100, -80);

    // 2. Build World Geometry & Collision
    this.buildGround();
    this.buildRoadCross();
    this.buildObstacles();

    // 3. Bake Static Collision BVH Tree
    this.collisionWorld.buildBVH();

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
    scene.add(this.fillLight);
    scene.fog = new THREE.FogExp2(this.currentTheme.fogColor, this.currentTheme.fogDensity);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.visualGroup);
    scene.remove(this.sunLight);
    scene.remove(this.hemiLight);
    scene.remove(this.fillLight);
  }

  // ── Terrain Construction ───────────────────────────────────

  private buildGround(): void {
    // Large flat grass meadow (1000m x 1000m)
    const groundGeo = new THREE.PlaneGeometry(1000, 1000, 16, 16);
    groundGeo.rotateX(-Math.PI / 2);

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2e6f40,
      roughness: 0.85,
      metalness: 0.05,
    });

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = 0;
    this.visualGroup.add(groundMesh);

    // Low-poly ground collision proxy (2 triangles)
    const proxyGeo = new THREE.PlaneGeometry(1000, 1000, 1, 1);
    proxyGeo.rotateX(-Math.PI / 2);
    const proxyMesh = new THREE.Mesh(proxyGeo);
    proxyMesh.position.y = 0;
    proxyMesh.updateMatrixWorld(true);
    this.collisionWorld.addProxy(proxyMesh);
  }

  private buildRoadCross(): void {
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d20,
      roughness: 0.72,
      metalness: 0.15,
    });

    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const borderMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    // Road 1: North-South road (width 20m, length 400m, along Z)
    const roadGeoZ = new THREE.BoxGeometry(20, 0.1, 400);
    const roadMeshZ = new THREE.Mesh(roadGeoZ, roadMat);
    roadMeshZ.position.set(0, 0.05, 0);
    roadMeshZ.receiveShadow = true;
    this.visualGroup.add(roadMeshZ);

    const proxyZ = new THREE.Mesh(roadGeoZ);
    proxyZ.position.set(0, 0.05, 0);
    proxyZ.updateMatrixWorld(true);
    this.collisionWorld.addProxy(proxyZ);

    // Road 2: East-West road (width 400m, length 20m, along X)
    const roadGeoX = new THREE.BoxGeometry(400, 0.1, 20);
    const roadMeshX = new THREE.Mesh(roadGeoX, roadMat);
    roadMeshX.position.set(0, 0.05, 0);
    roadMeshX.receiveShadow = true;
    this.visualGroup.add(roadMeshX);

    const proxyX = new THREE.Mesh(roadGeoX);
    proxyX.position.set(0, 0.05, 0);
    proxyX.updateMatrixWorld(true);
    this.collisionWorld.addProxy(proxyX);

    // White dashed center line down Z
    for (let z = -190; z <= 190; z += 10) {
      if (Math.abs(z) < 12) continue; // Leave intersection center open
      const dashGeo = new THREE.PlaneGeometry(0.35, 5);
      dashGeo.rotateX(-Math.PI / 2);
      const dash = new THREE.Mesh(dashGeo, stripeMat);
      dash.position.set(0, 0.11, z);
      this.visualGroup.add(dash);
    }

    // White dashed center line down X
    for (let x = -190; x <= 190; x += 10) {
      if (Math.abs(x) < 12) continue;
      const dashGeo = new THREE.PlaneGeometry(5, 0.35);
      dashGeo.rotateX(-Math.PI / 2);
      const dash = new THREE.Mesh(dashGeo, stripeMat);
      dash.position.set(x, 0.11, 0);
      this.visualGroup.add(dash);
    }

    // Yellow boundary lines along road shoulders
    const borderGeoZ1 = new THREE.PlaneGeometry(0.25, 400);
    borderGeoZ1.rotateX(-Math.PI / 2);
    const borderLeftZ = new THREE.Mesh(borderGeoZ1, borderMat);
    borderLeftZ.position.set(-9.6, 0.11, 0);
    this.visualGroup.add(borderLeftZ);

    const borderRightZ = new THREE.Mesh(borderGeoZ1, borderMat);
    borderRightZ.position.set(9.6, 0.11, 0);
    this.visualGroup.add(borderRightZ);

    const borderGeoX1 = new THREE.PlaneGeometry(400, 0.25);
    borderGeoX1.rotateX(-Math.PI / 2);
    const borderTopX = new THREE.Mesh(borderGeoX1, borderMat);
    borderTopX.position.set(0, 0.11, -9.6);
    this.visualGroup.add(borderTopX);

    const borderBottomX = new THREE.Mesh(borderGeoX1, borderMat);
    borderBottomX.position.set(0, 0.11, 9.6);
    this.visualGroup.add(borderBottomX);

    // Rumble curbs at corner junctions
    this.buildIntersectionCurbs();
  }

  private buildIntersectionCurbs(): void {
    const curbGeo = new THREE.BoxGeometry(0.8, 0.18, 12);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.8 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });

    const addCurbStrip = (x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.09, z);
      g.rotation.y = rotY;

      // Alternating red and white segments
      for (let s = -5; s <= 5; s += 2) {
        const segGeo = new THREE.BoxGeometry(0.8, 0.18, 1.8);
        const segMesh = new THREE.Mesh(segGeo, Math.abs(s) % 4 === 1 ? redMat : whiteMat);
        segMesh.position.z = s;
        segMesh.castShadow = true;
        segMesh.receiveShadow = true;
        g.add(segMesh);
      }

      this.visualGroup.add(g);

      const proxy = new THREE.Mesh(curbGeo);
      proxy.position.copy(g.position);
      proxy.rotation.y = rotY;
      proxy.updateMatrixWorld(true);
      this.collisionWorld.addProxy(proxy);
    };

    // Four corners of the cross intersection
    addCurbStrip(-10.4, 18, 0);
    addCurbStrip(10.4, 18, 0);
    addCurbStrip(-10.4, -18, 0);
    addCurbStrip(10.4, -18, 0);
  }

  private buildObstacles(): void {
    // 1. Shipping Containers
    this.createObstacleBox(18, 1.5, 40, 3.5, 3.0, 8.0, 0x0284c7);  // Cyan container
    this.createObstacleBox(-18, 1.5, -50, 3.5, 3.0, 8.0, 0xe11d48); // Crimson container
    this.createObstacleBox(50, 1.5, 18, 8.0, 3.0, 3.5, 0xd97706);  // Amber container

    // 2. Stack of Cargo Crates
    this.createObstacleBox(16, 1.25, -25, 2.5, 2.5, 2.5, 0x78350f); // Lower crate
    this.createObstacleBox(16, 3.5, -25, 2.0, 2.0, 2.0, 0x92400e);  // Upper crate

    // 3. Slalom Obstacle Barriers along North road
    this.createObstacleBox(-4, 0.6, 70, 1.2, 1.2, 4.0, 0x64748b);
    this.createObstacleBox(4, 0.6, 110, 1.2, 1.2, 4.0, 0x64748b);
    this.createObstacleBox(-4, 0.6, 150, 1.2, 1.2, 4.0, 0x64748b);

    // 4. Test Barriers on East road
    this.createObstacleBox(80, 0.6, -4, 4.0, 1.2, 1.2, 0x64748b);
    this.createObstacleBox(120, 0.6, 4, 4.0, 1.2, 1.2, 0x64748b);
  }

  private createObstacleBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    colorHex: number
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.6,
      metalness: 0.2,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.visualGroup.add(mesh);

    const proxy = new THREE.Mesh(geo);
    proxy.position.set(x, y, z);
    proxy.updateMatrixWorld(true);
    this.collisionWorld.addProxy(proxy);
  }

  // ── SurfaceProvider Implementation ─────────────────────────

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    outHit: SurfaceHit
  ): boolean {
    return this.collisionWorld.raycast(origin, direction, maxDistance, outHit);
  }

  groundHeightAt(x: number, z: number): number {
    if ((Math.abs(x) <= 10 && Math.abs(z) <= 200) || (Math.abs(z) <= 10 && Math.abs(x) <= 200)) {
      return 0.1;
    }
    return 0;
  }
}
