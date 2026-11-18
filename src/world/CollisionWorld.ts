/**
 * src/world/CollisionWorld.ts
 * ─────────────────────────────────────────────────────────────
 * Low-poly collision proxy system powered by three-mesh-bvh.
 * Visuals and collision geometry are kept completely separate.
 *
 * RULES.md:
 *   - Zero per-frame allocations: scratch Raycaster and vectors reused.
 *   - Instanced / merged BVH for microsecond raycasting.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  StaticGeometryGenerator,
} from 'three-mesh-bvh';
import type { SurfaceHit, SurfaceProvider } from './SurfaceProvider';

export type { SurfaceHit, SurfaceProvider };

// Install three-mesh-bvh methods onto Three prototypes
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class CollisionWorld implements SurfaceProvider {
  /** Group containing all low-poly collision proxy meshes */
  readonly proxyGroup = new THREE.Group();

  /** Unified collision mesh with precomputed BVH */
  private collisionMesh: THREE.Mesh | null = null;

  // Reusable scratch objects (zero per-frame allocs)
  private readonly raycaster = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];

  constructor() {
    this.raycaster.firstHitOnly = true; // BVH early exit
  }

  /**
   * Register a low-poly collision proxy mesh into the collision world.
   */
  addProxy(mesh: THREE.Mesh): void {
    this.proxyGroup.add(mesh);
  }

  /**
   * Bake all registered proxy meshes into a single BVH-accelerated mesh.
   * Call once after scene/level construction.
   */
  buildBVH(): void {
    this.proxyGroup.updateMatrixWorld(true);

    const generator = new StaticGeometryGenerator(this.proxyGroup);
    generator.attributes = ['position', 'normal'];
    const mergedGeo = generator.generate();

    (mergedGeo as any).computeBoundsTree();

    const mat = new THREE.MeshBasicMaterial({ visible: false, wireframe: true, side: THREE.DoubleSide });
    this.collisionMesh = new THREE.Mesh(mergedGeo, mat);
    this.collisionMesh.matrixAutoUpdate = false;
  }

  /**
   * Raycast against the BVH collision proxy mesh.
   * Zero per-frame allocations: populates outHit in-place.
   */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    outHit: SurfaceHit
  ): boolean {
    outHit.hit = false;
    if (!this.collisionMesh) return false;

    this.raycaster.ray.origin.copy(origin);
    this.raycaster.ray.direction.copy(direction).normalize();
    this.raycaster.near = 0;
    this.raycaster.far = maxDistance;

    this.hits.length = 0;
    this.collisionMesh.raycast(this.raycaster, this.hits);

    if (this.hits.length > 0) {
      const h = this.hits[0];
      outHit.hit = true;
      outHit.distance = h.distance;
      outHit.point.copy(h.point);

      if (h.face) {
        outHit.normal.copy(h.face.normal);
        // If hit backface due to double-side, flip normal to face outward towards probe origin
        if (outHit.normal.dot(this.raycaster.ray.direction) > 0) {
          outHit.normal.negate();
        }
      } else {
        outHit.normal.copy(direction).negate();
      }
      return true;
    }

    return false;
  }
}
