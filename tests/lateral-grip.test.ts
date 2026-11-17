import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { TrackSpline } from '../src/world/TrackSpline';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { CarConfig } from '../src/car/CarConfig';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';

describe('Lateral Grip & Drift Physics (Phase F2)', () => {
  let collisionWorld: CollisionWorld;
  let car: ArcadeCarController;

  const DRIFT_INPUT: InputState = {
    steer: 0,
    throttle: 1,
    brake: 0,
    drift: true,
    boost: false,
    restart: false,
    remix: false,
    debug: false,
  };

  const NORMAL_INPUT: InputState = {
    steer: 0,
    throttle: 1,
    brake: 0,
    drift: false,
    boost: false,
    restart: false,
    remix: false,
    debug: false,
  };

  const BRAKE_INPUT: InputState = {
    steer: 0,
    throttle: 0,
    brake: 1,
    drift: false,
    boost: false,
    restart: false,
    remix: false,
    debug: false,
  };

  beforeEach(() => {
    collisionWorld = new CollisionWorld();
    new TrackSpline(collisionWorld);
    collisionWorld.buildBVH();
    car = new ArcadeCarController();
  });

  it('guarantees car at 150 km/h turned 20° retains > 50% lateral velocity after 0.3s with drift held', () => {
    const speed150 = 150.0 / 3.6; // ~41.667 m/s
    const angle20 = (20.0 * Math.PI) / 180.0; // 20 degrees in radians

    // Position car on flat ground heading -Z
    car.position.set(0, 0.94, 20);
    car.prevPosition.copy(car.position);

    // Turn chassis 20 degrees relative to motion vector
    car.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle20);
    car.prevQuaternion.copy(car.quaternion);

    // Initial velocity continues in the original heading (-Z)
    car.speed = speed150 * Math.cos(angle20);
    car.velocity.set(0, 0, -speed150);

    // Calculate initial lateral velocity relative to car's rotated right vector
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
    const initialLatVel = Math.abs(car.velocity.dot(right));
    expect(initialLatVel).toBeGreaterThan(10.0); // ~14.25 m/s

    // Set initial drift state active (drift held)
    car.isDrifting = true;
    car.driftTransition = 1.0;

    // Simulate 0.3 seconds (36 ticks at 120Hz)
    const ticks = Math.round(0.3 / FIXED_DT);
    for (let t = 0; t < ticks; t++) {
      car.update(FIXED_DT, DRIFT_INPUT, collisionWorld);
    }

    // Measure final lateral velocity
    right.set(1, 0, 0).applyQuaternion(car.quaternion);
    const finalLatVel = Math.abs(car.velocity.dot(right));
    const retentionRatio = finalLatVel / initialLatVel;

    // Must retain more than 50% of lateral velocity
    expect(retentionRatio).toBeGreaterThan(0.50);
  });

  it('guarantees car at 150 km/h turned 20° retains < 10% lateral velocity after 0.3s with normal grip', () => {
    const speed150 = 150.0 / 3.6;
    const angle20 = (20.0 * Math.PI) / 180.0;

    car.position.set(0, 0.94, 20);
    car.prevPosition.copy(car.position);

    car.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle20);
    car.prevQuaternion.copy(car.quaternion);

    car.speed = speed150 * Math.cos(angle20);
    car.velocity.set(0, 0, -speed150);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
    const initialLatVel = Math.abs(car.velocity.dot(right));
    expect(initialLatVel).toBeGreaterThan(10.0);

    // Normal grip (no drift)
    car.isDrifting = false;
    car.driftTransition = 0.0;

    // Simulate 0.3 seconds (36 ticks at 120Hz)
    const ticks = Math.round(0.3 / FIXED_DT);
    for (let t = 0; t < ticks; t++) {
      car.update(FIXED_DT, NORMAL_INPUT, collisionWorld);
    }

    right.set(1, 0, 0).applyQuaternion(car.quaternion);
    const finalLatVel = Math.abs(car.velocity.dot(right));
    const retentionRatio = finalLatVel / initialLatVel;

    // Must retain less than 10% of lateral velocity
    expect(retentionRatio).toBeLessThan(0.10);
  });

  it('guarantees lateral velocity decay results are bitwise identical when run at the same dt twice', () => {
    const runSimulation = () => {
      const testCar = new ArcadeCarController();
      testCar.position.set(0, 0.94, 20);
      testCar.prevPosition.copy(testCar.position);

      const angle20 = (20.0 * Math.PI) / 180.0;
      testCar.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle20);
      testCar.prevQuaternion.copy(testCar.quaternion);

      testCar.speed = (150.0 / 3.6) * Math.cos(angle20);
      testCar.velocity.set(0, 0, -(150.0 / 3.6));
      testCar.isDrifting = true;
      testCar.driftTransition = 1.0;

      const ticks = Math.round(0.3 / FIXED_DT);
      for (let t = 0; t < ticks; t++) {
        testCar.update(FIXED_DT, DRIFT_INPUT, collisionWorld);
      }

      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(testCar.quaternion);
      return {
        latVel: testCar.velocity.dot(r),
        posX: testCar.position.x,
        posY: testCar.position.y,
        posZ: testCar.position.z,
        speed: testCar.speed,
      };
    };

    const run1 = runSimulation();
    const run2 = runSimulation();

    expect(run1.latVel).toBe(run2.latVel);
    expect(run1.posX).toBe(run2.posX);
    expect(run1.posY).toBe(run2.posY);
    expect(run1.posZ).toBe(run2.posZ);
    expect(run1.speed).toBe(run2.speed);
  });

  it('enforces a 0.12s dead-stop transition between braking and reversing', () => {
    // Start moving forward at 5 m/s
    car.position.set(0, 0.94, 20);
    car.speed = 5.0;

    // Brake to standstill
    while (car.speed > 0) {
      car.update(FIXED_DT, BRAKE_INPUT, collisionWorld);
    }

    // Car must be at standstill (speed === 0)
    expect(car.speed).toBe(0);
    expect(car.brakeDeadzoneTimer).toBeCloseTo(CarConfig.brakeDeadzoneTime, 2);

    // During the 0.12s dead-stop window (~14 ticks), holding brake must keep speed at 0
    const deadzoneTicks = Math.floor(0.10 / FIXED_DT); // 12 ticks
    for (let t = 0; t < deadzoneTicks; t++) {
      car.update(FIXED_DT, BRAKE_INPUT, collisionWorld);
      expect(car.speed).toBe(0);
    }

    // After the dead-stop window expires, continuing to hold brake engages reverse throttle
    for (let t = 0; t < 10; t++) {
      car.update(FIXED_DT, BRAKE_INPUT, collisionWorld);
    }

    // Speed must now be negative (reversing)
    expect(car.speed).toBeLessThan(0);
  });
});
