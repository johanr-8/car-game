/**
 * src/world/SurfaceProvider.ts
 * ─────────────────────────────────────────────────────────────
 * Abstract surface & raycast interface decoupling vehicle physics
 * from concrete world/track implementations.
 *
 * RULES.md: Zero per-frame allocations. Populates SurfaceHit in-place.
 * ─────────────────────────────────────────────────────────────
 */
import type * as THREE from 'three';
import type { SurfaceType } from './WorldConfig';

export interface SurfaceHit {
  hit: boolean;
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface SurfaceProvider {
  /**
   * Raycasts against world collision geometry.
   * In-place mutation of outHit prevents heap allocations in fixed tick.
   */
  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    outHit: SurfaceHit
  ): boolean;

  /**
   * Optional analytical ground height query at (x, z).
   */
  groundHeightAt?(x: number, z: number): number;

  /**
   * Optional analytical ground surface normal query at (x, z).
   * Populates outNormal in-place to avoid heap allocations.
   */
  groundNormalAt?(x: number, z: number, outNormal: THREE.Vector3): void;

  /**
   * Returns surface type (ASPHALT, GRASS, DIRT) at given world coordinate.
   */
  getSurfaceTypeAt?(x: number, z: number): SurfaceType;
}
