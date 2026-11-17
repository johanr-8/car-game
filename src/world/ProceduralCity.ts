/**
 * src/world/ProceduralCity.ts
 * ─────────────────────────────────────────────────────────────
 * Realistic Daytime Procedural Metropolis with Architectural Outlines.
 *
 * Visual Features:
 *   - Real architectural materials: white concrete, glass curtain-walls, limestone & steel
 *   - Dark foundation podiums and rooftop architectural cornices for depth & outlines
 *   - Track corridor collision avoidance: buildings never obstruct the circuit
 *   - Vibrant park lawns and green turf surrounding the race circuit
 *   - Instanced meshes for ultra-high performance (< 25 draw calls)
 *   - Chunk streaming with distance-based LOD
 *
 * RULES.md: Zero per-frame allocations. InstancedMesh for repeated geometry.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { SeededRandom } from '../core/SeededRandom';
import type { CollisionWorld } from './CollisionWorld';
import type { CityTheme } from './TimeOfDay';
import { getBuildingTexture, getGrassTexture, getPlazaTexture } from './TextureGenerator';

export interface BuildingData {
  chunkX: number;
  chunkZ: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  materialStyle: number; // 0: White panel, 1: Blue glass, 2: Limestone, 3: Slate steel
  hasSpire: boolean;
}

const _dummyObj   = new THREE.Object3D();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export class ProceduralCity {
  readonly visualGroup = new THREE.Group();

  readonly seed: number;
  readonly theme: CityTheme;
  private readonly rng: SeededRandom;

  readonly chunkSize = 75;
  readonly gridHalfSize = 3;

  readonly buildings: BuildingData[] = [];

  // Instanced Meshes for Realistic Architectural Styles
  private buildingInstMeshes: THREE.InstancedMesh[] = [];
  private roofCorniceInstMesh!: THREE.InstancedMesh;
  private roofSpireInstMesh!: THREE.InstancedMesh;

  private readonly fullMatrices: THREE.Matrix4[][] = [[], [], [], []];
  private readonly corniceMatrices: THREE.Matrix4[] = [];
  private readonly spireMatrices: THREE.Matrix4[] = [];

  private lastChunkX = 9999;
  private lastChunkZ = 9999;

  constructor(
    collision: CollisionWorld,
    theme: CityTheme,
    seed: number = SeededRandom.getDailySeed(),
    trackCurve?: THREE.CatmullRomCurve3
  ) {
    this.seed = seed;
    this.theme = theme;
    this.rng = new SeededRandom(seed);

    this.generateCityLayout(trackCurve);
    this.createInstancedMeshes();
    this.buildGroundAndParks(collision);
    this.registerCollisionProxies(collision);
  }

  private generateCityLayout(trackCurve?: THREE.CatmullRomCurve3): void {
    const minHeight = 25;
    const maxHeight = 100;

    // Sample dense track points for rigorous corridor collision avoidance
    const trackPoints: THREE.Vector3[] = trackCurve ? trackCurve.getSpacedPoints(300) : [];

    for (let cx = -this.gridHalfSize; cx <= this.gridHalfSize; cx++) {
      for (let cz = -this.gridHalfSize; cz <= this.gridHalfSize; cz++) {
        const isCenterAvenue = (Math.abs(cx) <= 0 && Math.abs(cz) <= 0);
        if (isCenterAvenue) continue;

        const bCount = this.rng.rangeInt(2, 4);

        for (let b = 0; b < bCount; b++) {
          const offsetX = this.rng.range(-this.chunkSize * 0.38, this.chunkSize * 0.38);
          const offsetZ = this.rng.range(-this.chunkSize * 0.38, this.chunkSize * 0.38);

          const posX = cx * this.chunkSize + offsetX;
          const posZ = cz * this.chunkSize + offsetZ;

          const width = this.rng.range(16, 26);
          const depth = this.rng.range(16, 26);
          const radius = Math.max(width, depth) * 0.5 + 24; // 24m generous safety buffer

          // Avoid central avenue
          if (Math.abs(posX) < 26 && posZ > -55 && posZ < 65) continue;

          // Avoid Apex Tower area
          if (Math.abs(posX) < 30 && posZ > -100 && posZ < -60) continue;

          // Avoid Eastern skyway & canyon dive zone
          if (posX > 15 && posX < 65 && posZ > -15 && posZ < 65) continue;

          // Avoid Western celestial loop zone
          if (posX < -20 && posX > -70 && posZ > -45 && posZ < 65) continue;

          // Corridor check against all 300 track points
          let collidesWithTrack = false;
          let maxAllowedHeight = maxHeight;

          for (let p = 0; p < trackPoints.length; p++) {
            const tp = trackPoints[p];
            const dx = tp.x - posX;
            const dz = tp.z - posZ;
            const distSq = dx * dx + dz * dz;

            if (distSq < radius * radius) {
              collidesWithTrack = true;
              break;
            }

            // Height-envelope check for elevated skyways: ensure no building or spire pokes near track
            if (distSq < (radius + 20) * (radius + 20) && tp.y > 10) {
              maxAllowedHeight = Math.min(maxAllowedHeight, Math.max(12, tp.y - 14));
            }
          }
          if (collidesWithTrack) continue;

          const rawHeight = this.rng.range(minHeight, maxHeight);
          const height = Math.min(rawHeight, maxAllowedHeight);
          if (height < 12) continue; // Skip if too squashed

          const materialStyle = this.rng.rangeInt(0, 3);
          const hasSpire = (height > 30) && (this.rng.next() > 0.45);

          this.buildings.push({
            chunkX: cx,
            chunkZ: cz,
            x: posX,
            z: posZ,
            width,
            depth,
            height,
            materialStyle,
            hasSpire,
          });
        }
      }
    }
  }

  private createInstancedMeshes(): void {
    // ── 4 Realistic Architectural Building Materials with Window Textures ──
    const mats = [
      // Style 0: Modern White Architectural Paneling with Window Grid
      new THREE.MeshStandardMaterial({
        map: getBuildingTexture(0),
        color: 0xebf0f7,
        roughness: 0.5,
        metalness: 0.2,
      }),
      // Style 1: Blue Reflective Curtain-Wall Glass
      new THREE.MeshStandardMaterial({
        map: getBuildingTexture(1),
        color: 0x5a8fcb,
        roughness: 0.15,
        metalness: 0.75,
      }),
      // Style 2: Warm Classical Limestone
      new THREE.MeshStandardMaterial({
        map: getBuildingTexture(2),
        color: 0xdfd3c3,
        roughness: 0.65,
        metalness: 0.1,
      }),
      // Style 3: Dark Slate & Brushed Steel
      new THREE.MeshStandardMaterial({
        map: getBuildingTexture(3),
        color: 0x3d4757,
        roughness: 0.35,
        metalness: 0.55,
      }),
    ];

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    // Count buildings per style
    const counts = [0, 0, 0, 0];
    this.buildings.forEach(b => counts[b.materialStyle]++);

    // Create 4 InstancedMeshes (one for each realistic material)
    this.buildingInstMeshes = mats.map((mat, idx) => {
      const im = new THREE.InstancedMesh(boxGeo, mat, Math.max(1, counts[idx]));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.receiveShadow = true;
      this.visualGroup.add(im);
      return im;
    });

    // Dark Architectural Rooftop Cornices / Capping (Gives buildings crisp silhouettes)
    const corniceGeo = new THREE.BoxGeometry(1.04, 0.04, 1.04);
    const corniceMat = new THREE.MeshStandardMaterial({
      color: 0x1a202c, // deep graphite trim
      roughness: 0.4,
      metalness: 0.6,
    });
    this.roofCorniceInstMesh = new THREE.InstancedMesh(corniceGeo, corniceMat, Math.max(1, this.buildings.length));
    this.roofCorniceInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.roofCorniceInstMesh.castShadow = true;
    this.roofCorniceInstMesh.receiveShadow = true;
    this.visualGroup.add(this.roofCorniceInstMesh);

    // Rooftop Spire Antennas
    const spireGeo = new THREE.ConeGeometry(0.8, 18, 6);
    spireGeo.translate(0, 9, 0);
    const spireMat = new THREE.MeshStandardMaterial({
      color: 0xc0c8d4,
      roughness: 0.3,
      metalness: 0.8,
    });
    this.roofSpireInstMesh = new THREE.InstancedMesh(spireGeo, spireMat, Math.max(1, this.buildings.length));
    this.roofSpireInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.roofSpireInstMesh.castShadow = true;
    this.visualGroup.add(this.roofSpireInstMesh);

    // Populate transforms
    const currentIndices = [0, 0, 0, 0];
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const style = b.materialStyle;
      const idx = currentIndices[style]++;

      _dummyObj.position.set(b.x, b.height * 0.5, b.z);
      _dummyObj.scale.set(b.width, b.height, b.depth);
      _dummyObj.rotation.set(0, 0, 0);
      _dummyObj.updateMatrix();

      const bMat = _dummyObj.matrix.clone();
      this.fullMatrices[style].push(bMat);
      this.buildingInstMeshes[style].setMatrixAt(idx, bMat);

      // Rooftop Cornice
      _dummyObj.position.set(b.x, b.height + 0.3, b.z);
      _dummyObj.scale.set(b.width * 1.03, 0.8, b.depth * 1.03);
      _dummyObj.updateMatrix();
      const cMat = _dummyObj.matrix.clone();
      this.corniceMatrices.push(cMat);
      this.roofCorniceInstMesh.setMatrixAt(i, cMat);

      // Spire
      if (b.hasSpire) {
        _dummyObj.position.set(b.x, b.height, b.z);
        _dummyObj.scale.set(1, 1, 1);
        _dummyObj.updateMatrix();
        const sMat = _dummyObj.matrix.clone();
        this.spireMatrices.push(sMat);
        this.roofSpireInstMesh.setMatrixAt(i, sMat);
      } else {
        this.spireMatrices.push(_zeroMatrix);
        this.roofSpireInstMesh.setMatrixAt(i, _zeroMatrix);
      }
    }

    this.buildingInstMeshes.forEach(im => (im.instanceMatrix.needsUpdate = true));
    this.roofCorniceInstMesh.instanceMatrix.needsUpdate = true;
    this.roofSpireInstMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Realistic Green Park Lawns and Ground Plaza.
   */
  private buildGroundAndParks(collision: CollisionWorld): void {
    const totalSize = (this.gridHalfSize * 2 + 1) * this.chunkSize;

    // Lush Green Park Grass Ground with fine fiber texture
    const grassGeo = new THREE.PlaneGeometry(totalSize, totalSize);
    const grassMat = new THREE.MeshStandardMaterial({
      map: getGrassTexture(),
      color: 0x487a38,
      roughness: 0.85,
      metalness: 0.05,
    });
    const grassMesh = new THREE.Mesh(grassGeo, grassMat);
    grassMesh.rotation.x = -Math.PI / 2;
    grassMesh.position.y = 0;
    grassMesh.receiveShadow = true;
    this.visualGroup.add(grassMesh);

    // Concrete Sidewalks and Plaza Walkways with pavers texture
    const plazaGeo = new THREE.PlaneGeometry(90, 90);
    const plazaMat = new THREE.MeshStandardMaterial({
      map: getPlazaTexture(),
      color: 0xc4cbd5,
      roughness: 0.75,
      metalness: 0.1,
    });
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.02, 10);
    plaza.receiveShadow = true;
    this.visualGroup.add(plaza);

    // Ground collision proxy
    const proxyGeo = new THREE.BoxGeometry(totalSize, 2, totalSize);
    const proxyMesh = new THREE.Mesh(proxyGeo);
    proxyMesh.position.set(0, -1, 0);
    proxyMesh.updateMatrixWorld();
    collision.addProxy(proxyMesh);
  }

  private registerCollisionProxies(collision: CollisionWorld): void {
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (Math.hypot(b.x, b.z) < 220) {
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.depth));
        proxy.position.set(b.x, b.height * 0.5, b.z);
        proxy.updateMatrixWorld();
        collision.addProxy(proxy);
      }
    }
  }

  updateChunkLOD(playerX: number, playerZ: number): void {
    const curChunkX = Math.floor(playerX / this.chunkSize);
    const curChunkZ = Math.floor(playerZ / this.chunkSize);

    if (curChunkX === this.lastChunkX && curChunkZ === this.lastChunkZ) return;
    this.lastChunkX = curChunkX;
    this.lastChunkZ = curChunkZ;

    const visibleRadius = 3;
    let matrixNeedsUpdate = false;

    const currentIndices = [0, 0, 0, 0];

    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const distChunks = Math.max(Math.abs(b.chunkX - curChunkX), Math.abs(b.chunkZ - curChunkZ));
      const isVisible = distChunks <= visibleRadius;

      const style = b.materialStyle;
      const idx = currentIndices[style]++;

      if (isVisible) {
        this.buildingInstMeshes[style].setMatrixAt(idx, this.fullMatrices[style][idx]);
        this.roofCorniceInstMesh.setMatrixAt(i, this.corniceMatrices[i]);
        this.roofSpireInstMesh.setMatrixAt(i, this.spireMatrices[i]);
      } else {
        this.buildingInstMeshes[style].setMatrixAt(idx, _zeroMatrix);
        this.roofCorniceInstMesh.setMatrixAt(i, _zeroMatrix);
        this.roofSpireInstMesh.setMatrixAt(i, _zeroMatrix);
      }
      matrixNeedsUpdate = true;
    }

    if (matrixNeedsUpdate) {
      this.buildingInstMeshes.forEach(im => (im.instanceMatrix.needsUpdate = true));
      this.roofCorniceInstMesh.instanceMatrix.needsUpdate = true;
      this.roofSpireInstMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
