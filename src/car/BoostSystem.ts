/**
 * src/car/BoostSystem.ts
 * ─────────────────────────────────────────────────────────────
 * Nitro / Kinetic Boost System with Racing Skill Refills:
 *   - Power Drifting: continuous charge generation while holding drift
 *   - Wall-riding & Inversions: continuous charge on vertical walls/skyway
 *   - Clean Landings: instant +20% charge reward after jumps
 *   - Near-Barrier Apex Clipping: +14% proximity reward
 *
 * RULES.md: Zero per-frame allocations.
 * ─────────────────────────────────────────────────────────────
 */

export class BoostSystem {
  charge = 50; // starts at 50%
  readonly maxCharge = 100;

  isBoosting = false;
  private readonly drainRate = 32;       // % per second while boosting
  private readonly wallRideRate = 18;    // % per second while wall-riding
  private readonly driftChargeRate = 22; // % per second while power drifting
  private nearMissCooldown = 0;

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
    isDrifting: boolean,
    wasAirborneJustLanded: boolean
  ): { isBoosting: boolean; boostForce: number } {
    if (this.nearMissCooldown > 0) this.nearMissCooldown -= dt;
    if (this.refillEventTimer > 0) this.refillEventTimer -= dt;

    // ── 1. Refill: Power Drifting ────────────────────────────
    if (isGrounded && isDrifting && Math.abs(speed) > 10) {
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

    // ── 3. Refill: Clean Landing ─────────────────────────────
    if (wasAirborneJustLanded) {
      this.addCharge(20, 'CLEAN LANDING');
    }

    // ── 4. Boost Consumption ─────────────────────────────────
    if (wantsBoost && this.charge > 1) {
      this.isBoosting = true;
      this.charge = Math.max(0, this.charge - this.drainRate * dt);
      return { isBoosting: true, boostForce: 36 };
    }

    this.isBoosting = false;
    return { isBoosting: false, boostForce: 0 };
  }

  /**
   * Award charge for near-miss proximity.
   */
  triggerNearMiss(): void {
    if (this.nearMissCooldown <= 0) {
      this.addCharge(14, 'NEAR MISS');
      this.nearMissCooldown = 1.2; // 1.2s cooldown
    }
  }

  addCharge(amount: number, reason?: string): void {
    this.charge = Math.min(this.maxCharge, this.charge + amount);
    if (reason && (!this.lastRefillReason || this.refillEventTimer <= 0)) {
      this.lastRefillReason = reason;
      this.refillEventTimer = 1.5;
    }
  }
}
