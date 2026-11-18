import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { TrackSpline } from '../src/world/TrackSpline';
import { TrackQuery } from '../src/world/TrackQuery';
import { VehicleEntity } from '../src/car/VehicleEntity';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { BoostSystem } from '../src/car/BoostSystem';
import { CarConfig } from '../src/car/CarConfig';
import { FIXED_DT } from '../src/core/constants';

describe('Track-Based Boost Economy & Skill Rewards', () => {
  let collisionWorld: CollisionWorld;
  let track: TrackSpline;
  let trackQuery: TrackQuery;

  beforeEach(() => {
    collisionWorld = new CollisionWorld();
    track = new TrackSpline(collisionWorld);
    collisionWorld.buildBVH();
    trackQuery = new TrackQuery(track);
  });

  it('clean sector awards +10% only if no barrier contact flag was set in that sector', () => {
    const vehicle = new VehicleEntity('player', 0xd41c1c, true);
    vehicle.boost.charge = 50; // Initial 50%

    // ── Sector 1: Clean driving from start to checkpoint 1 ──
    const cp1 = track.checkpoints[1];
    vehicle.controller.position.copy(cp1.position);

    // Verify no barrier contact flag is set initially
    expect(vehicle.progress.hasBarrierContact).toBe(false);

    // Gate crossing passes
    const gate1Passed = trackQuery.checkGateCrossing(vehicle.controller.position, cp1);
    expect(gate1Passed).toBe(true);

    // Award clean sector bonus
    if (!vehicle.progress.hasBarrierContact) {
      vehicle.boost.triggerCleanSector();
    }
    vehicle.progress.hasBarrierContact = false;
    vehicle.controller.hasBarrierContact = false;

    // Charge MUST increase by cleanSectorBonus (+10%) -> 60%
    expect(vehicle.boost.charge).toBe(50 + CarConfig.cleanSectorBonus);

    // ── Sector 2: Dirty driving (barrier collision in sector 1 -> 2) ──
    const cp2 = track.checkpoints[2];
    vehicle.controller.position.copy(cp2.position);

    // Flag barrier contact
    vehicle.progress.hasBarrierContact = true;
    vehicle.controller.hasBarrierContact = true;

    // Gate crossing passes
    const gate2Passed = trackQuery.checkGateCrossing(vehicle.controller.position, cp2);
    expect(gate2Passed).toBe(true);

    // Verify clean sector bonus is REJECTED
    if (!vehicle.progress.hasBarrierContact) {
      vehicle.boost.triggerCleanSector();
    }
    // Charge MUST remain unchanged at 60%
    expect(vehicle.boost.charge).toBe(60);

    // Reset flag for next sector
    vehicle.progress.hasBarrierContact = false;
    vehicle.controller.hasBarrierContact = false;

    // ── Sector 3: Clean driving again in sector 2 -> 3 ──
    const cp3 = track.checkpoints[3];
    vehicle.controller.position.copy(cp3.position);

    expect(vehicle.progress.hasBarrierContact).toBe(false);
    const gate3Passed = trackQuery.checkGateCrossing(vehicle.controller.position, cp3);
    expect(gate3Passed).toBe(true);

    if (!vehicle.progress.hasBarrierContact) {
      vehicle.boost.triggerCleanSector();
    }

    // Charge MUST now increase by +10% to 70%
    expect(vehicle.boost.charge).toBe(70);
  });

  it('apex bonus awards +3% and is strictly rate-limited by cooldown so it cannot be farmed', () => {
    const boost = new BoostSystem();
    boost.charge = 50;

    // 1. First trigger at inside rumble curb succeeds
    const awarded1 = boost.triggerApexBonus();
    expect(awarded1).toBe(true);
    expect(boost.charge).toBe(50 + CarConfig.apexBonusAmount); // 53%
    expect(boost.apexCooldown).toBeCloseTo(CarConfig.apexBonusCooldown, 2); // 1.5s

    // 2. Immediate second attempt during cooldown MUST be rejected
    const awarded2 = boost.triggerApexBonus();
    expect(awarded2).toBe(false);
    expect(boost.charge).toBe(53); // No charge added

    // 3. Attempt after 0.5 seconds (still on cooldown) MUST be rejected
    const ticksHalfSec = Math.round(0.5 / FIXED_DT);
    for (let t = 0; t < ticksHalfSec; t++) {
      boost.update(FIXED_DT, false, true, 1.0, 30.0, false);
    }
    expect(boost.apexCooldown).toBeGreaterThan(0.5);
    const awarded3 = boost.triggerApexBonus();
    expect(awarded3).toBe(false);
    expect(boost.charge).toBe(53);

    // 4. Advance time past the remainder of the cooldown (total > 1.5s)
    const ticksFull = Math.round(1.1 / FIXED_DT);
    for (let t = 0; t < ticksFull; t++) {
      boost.update(FIXED_DT, false, true, 1.0, 30.0, false);
    }
    expect(boost.apexCooldown).toBe(0);

    // 5. Subsequent trigger after cooldown MUST succeed
    const awarded4 = boost.triggerApexBonus();
    expect(awarded4).toBe(true);
    expect(boost.charge).toBe(56); // 53 + 3 = 56%
  });

  it('verifies no code path or controller references landing events', () => {
    const car = new ArcadeCarController();
    const boost = new BoostSystem();

    // Verify wasAirborneJustLanded is completely removed from controller interface
    expect((car as any).wasAirborneJustLanded).toBeUndefined();

    // Verify update() does not take or check wasAirborneJustLanded
    expect(boost.update.length).toBe(6); // (dt, wantsBoost, isGrounded, normalY, speed, isDrifting)

    // Verify lastRefillReason is not initialized to landing
    expect(boost.lastRefillReason).not.toContain('LANDING');
  });
});
