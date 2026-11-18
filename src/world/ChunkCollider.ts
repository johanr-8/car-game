/**
 * src/world/ChunkCollider.ts
 * ─────────────────────────────────────────────────────────────
 * Per-Chunk Local BVH Collider.
 *
 * Each loaded chunk builds a tiny, self-contained BVH tree from its
 * local solid objects (buildings, walls, landmark bases).
 * Never rebuilds a global BVH. Disposed cleanly on chunk unload.
 *
 * RULES.md: Microsecond collision query. Zero global BVH rebuilds.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

// Ensure BVH methods are attached to prototypes
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface SolidBox {
  x: number;
  y: number; // center elevation
  z: number;
  width: number;
  height: number;
  depth: number;
  rotationY?: number;
  rotationX?: number;
  rotationZ?: number;
}

const invisibleCollisionMat = new THREE.MeshBasicMaterial({
  visible: false,
  wireframe: true,
  side: THREE.DoubleSide,
});

export class ChunkCollider {
  readonly cx: number;
  readonly cz: number;
  readonly mesh: THREE.Mesh | null = null;
  private readonly geo: THREE.BufferGeometry | null = null;

  constructor(cx: number, cz: number, boxes: SolidBox[]) {
    this.cx = cx;
    this.cz = cz;

    if (boxes.length === 0) {
      return;
    }

    // Merge box geometries for local chunk BVH
    const boxGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const g = new THREE.BoxGeometry(b.width, b.height, b.depth);
      if (b.rotationX) {
        g.rotateX(b.rotationX);
      }
      if (b.rotationY) {
        g.rotateY(b.rotationY);
      }
      if (b.rotationZ) {
        g.rotateZ(b.rotationZ);
      }
      g.translate(b.x, b.y, b.z);
      boxGeos.push(g);
    }

    this.geo = this.mergeGeometries(boxGeos);
    (this.geo as any).computeBoundsTree();

    this.mesh = new THREE.Mesh(this.geo, invisibleCollisionMat);
    this.mesh.matrixAutoUpdate = false;
  }

  private mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
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

  dispose(): void {
    if (this.geo) {
      (this.geo as any).disposeBoundsTree();
      this.geo.dispose();
    }
  }
}
