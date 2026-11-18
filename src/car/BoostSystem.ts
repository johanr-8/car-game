/**
 * src/car/BoostSystem.ts
 * ─────────────────────────────────────────────────────────────
 * Nitro / Kinetic Boost System with Track-Based Skill Refills:
 *   - Power Drifting: continuous charge generation while holding drift
 *   - Wall-riding & Inversions: continuous charge on vertical walls/skyway
 *   - Clean Sector: instant +10% charge reward for completing sector without barrier contact
 *   - Apex Bonus: +3% charge reward for clipping inside rumble curb at speed (rate-limited)
 *
 * RULES.md: Zero per-frame allocations. All tuning in CarConfig.
 * ─────────────────────────────────────────────────────────────
 */
import { CarConfig } from './CarConfig';

export class BoostSystem {
  charge = 50; // starts at 50%
  readonly maxCharge = 100;

  isBoosting = false;
  private readonly drainRate = 32;       // % per second while boosting
  private readonly wallRideRate = 18;    // % per second while wall-riding
  private readonly driftChargeRate = 22; // % per second while power drifting

  apexCooldown = 0; // Cooldown timer for apex curb reward

  // Visual event triggers for HUD popup
  lastRefillReason = '';
  refillEventTimer = 0;

  /**
   * Called each physics tick to manage charge and boost output.
   * Returns current acceleration boost multiplier.
   */
  update(
    dt: number,
    wantsBoost: boolean,
    isGrounded: boolean,
    surfaceNormalY: number,
    speed: number,
    isDrifting: boolean
  ): { isBoosting: boolean; boostForce: number } {
    if (this.apexCooldown > 0) this.apexCooldown = Math.max(0, this.apexCooldown - dt);
    if (this.refillEventTimer > 0) this.refillEventTimer = Math.max(0, this.refillEventTimer - dt);

    // ── 1. Refill: Power Drifting ────────────────────────────
    if (isGrounded && isDrifting && Math.abs(speed) > CarConfig.driftEntrySpeed) {
      this.addCharge(this.driftChargeRate * dt, 'POWER DRIFT');
    }

    // ── 2. Refill: Wall-Riding & Ceiling-Riding ──────────────
    if (isGrounded && Math.abs(speed) > 8) {
      // Wall: |Ny| < 0.7, Ceiling: Ny < -0.3
      const isWallOrCeiling = Math.abs(surfaceNormalY) < 0.7 || surfaceNormalY < -0.3;
      if (isWallOrCeiling) {
        this.addCharge(this.wallRideRate * dt, 'WALL RIDE');
      }
    }

    // ── 3. Boost Consumption ─────────────────────────────────
    if (wantsBoost && this.charge > 1) {
      this.isBoosting = true;
      this.charge = Math.max(0, this.charge - this.drainRate * dt);
      return { isBoosting: true, boostForce: 36 };
    }

    this.isBoosting = false;
    return { isBoosting: false, boostForce: 0 };
  }

  /**
   * Awards clean sector bonus (+10%) for clearing a checkpoint without barrier contact.
   */
  triggerCleanSector(): void {
    this.addCharge(CarConfig.cleanSectorBonus, 'CLEAN SECTOR');
  }

  /**
   * Awards apex curb bonus (+3%) for clipping inside curb at speed, rate-limited by cooldown.
   * Returns true if bonus was successfully granted.
   */
  triggerApexBonus(): boolean {
    if (this.apexCooldown <= 0) {
      this.addCharge(CarConfig.apexBonusAmount, 'APEX CURB');
      this.apexCooldown = CarConfig.apexBonusCooldown;
      return true;
    }
    return false;
  }

  addCharge(amount: number, reason?: string): void {
    this.charge = Math.min(this.maxCharge, this.charge + amount);
    if (reason && (!this.lastRefillReason || this.refillEventTimer <= 0)) {
      this.lastRefillReason = reason;
      this.refillEventTimer = 1.5;
    }
  }
}
