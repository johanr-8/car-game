/**
 * src/world/InversionSystem.ts
 * ─────────────────────────────────────────────────────────────
 * World Inversion Events & Camera Roll Transitions:
 *   - Tracks when the car navigates the high-altitude Celestial Skyway
 *   - Drives dynamic 180° camera barrel-roll transition
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { CollisionWorld } from './CollisionWorld';
import type { CityTheme } from './TimeOfDay';

export class InversionSystem {
  readonly visualGroup = new THREE.Group();

  isInverted = false;
  inversionTransition = 0;

  constructor(_collision?: CollisionWorld, _theme?: CityTheme) {}

  evaluateInversion(activeCheckpoint: number, carPosY: number): boolean {
    const shouldInvert = (activeCheckpoint === 6) || (carPosY > 90);

    if (shouldInvert && !this.isInverted) {
      this.isInverted = true;
      return true;
    } else if (!shouldInvert && this.isInverted && carPosY < 70) {
      this.isInverted = false;
      return true;
    }

    return false;
  }

  update(dt: number): void {
    const target = this.isInverted ? 1 : 0;
    this.inversionTransition = THREE.MathUtils.lerp(
      this.inversionTransition,
      target,
      1 - Math.exp(-6.0 * dt)
    );
  }
}
