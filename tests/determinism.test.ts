import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { TrackSpline } from '../src/world/TrackSpline';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';

describe('Physics Step Determinism (1,000 Fixed Ticks)', () => {
  it('guarantees identical end states given identical inputs and start states across 1,000 ticks', () => {
    // 1. Build two independent worlds with identical geometry
    const world1 = new CollisionWorld();
    const track1 = new TrackSpline(world1);
    world1.buildBVH();

    const world2 = new CollisionWorld();
    const track2 = new TrackSpline(world2);
    world2.buildBVH();

    // 2. Initialize two independent car controllers with identical state
    const car1 = new ArcadeCarController();
    const car2 = new ArcadeCarController();

    const startPos = new THREE.Vector3(0, 0.94, 25);
    const startQuat = new THREE.Quaternion(0, 0, 0, 1);

    car1.position.copy(startPos);
    car1.quaternion.copy(startQuat);
    car1.velocity.set(0, 0, 0);
    car1.speed = 0;

    car2.position.copy(startPos);
    car2.quaternion.copy(startQuat);
    car2.velocity.set(0, 0, 0);
    car2.speed = 0;

    // 3. Define a deterministic sequence of varied driving inputs over 1,000 ticks
    const getDeterministicInput = (tick: number): InputState => {
      if (tick < 250) {
        // High-speed acceleration straightaway
        return { steer: 0, throttle: 1, brake: 0, drift: false, boost: false, restart: false, remix: false, debug: false };
      } else if (tick < 500) {
        // Corner entry with power drift
        return { steer: -0.45, throttle: 1, brake: 0, drift: true, boost: false, restart: false, remix: false, debug: false };
      } else if (tick < 750) {
        // Counter-steering with nitro boost
        return { steer: 0.60, throttle: 1, brake: 0, drift: false, boost: true, restart: false, remix: false, debug: false };
      } else {
        // Hard threshold braking into chicane
        return { steer: -0.25, throttle: 0, brake: 1, drift: false, boost: false, restart: false, remix: false, debug: false };
      }
    };

    // 4. Step both cars through 1,000 ticks (8.33 seconds of simulated physics)
    for (let tick = 0; tick < 1000; tick++) {
      const input = getDeterministicInput(tick);

      car1.update(FIXED_DT, input, world1);
      track1.containCar(car1.position, car1.velocity);

      car2.update(FIXED_DT, input, world2);
      track2.containCar(car2.position, car2.velocity);
    }

    // 5. Assert strict bitwise-level determinism between the two runs
    const posDiff = car1.position.distanceTo(car2.position);
    const quatDiff = car1.quaternion.angleTo(car2.quaternion);
    const velDiff = car1.velocity.distanceTo(car2.velocity);

    expect(posDiff).toBeLessThan(1e-9);
    expect(quatDiff).toBeLessThan(1e-9);
    expect(velDiff).toBeLessThan(1e-9);
    expect(car1.speed).toBe(car2.speed);
    expect(car1.isGrounded).toBe(car2.isGrounded);
    expect(car1.isDrifting).toBe(car2.isDrifting);
    expect(car1.surfaceNormal.distanceTo(car2.surfaceNormal)).toBeLessThan(1e-9);
  });
});
