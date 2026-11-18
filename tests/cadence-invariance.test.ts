import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { TrackSpline } from '../src/world/TrackSpline';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';

describe('Display Refresh Rate Invariance (60 Hz vs 144 Hz Cadence)', () => {
  it('guarantees identical end state regardless of frame cadence (60 Hz vs 144 Hz)', () => {
    // 1. Build identical collision worlds and track splines
    const world60 = new CollisionWorld();
    const track60 = new TrackSpline(world60);
    world60.buildBVH();

    const world144 = new CollisionWorld();
    const track144 = new TrackSpline(world144);
    world144.buildBVH();

    // 2. Initialize identical cars
    const car60 = new ArcadeCarController();
    const car144 = new ArcadeCarController();

    const startPos = new THREE.Vector3(0, 0.94, 25);
    const startQuat = new THREE.Quaternion(0, 0, 0, 1);

    car60.position.copy(startPos);
    car60.quaternion.copy(startQuat);
    car60.velocity.set(0, 0, 0);

    car144.position.copy(startPos);
    car144.quaternion.copy(startQuat);
    car144.velocity.set(0, 0, 0);

    // 3. Generate 1,200 recorded input ticks (10.0 seconds of gameplay)
    const TOTAL_TICKS = 1200;
    const recordedInputs: InputState[] = [];
    for (let i = 0; i < TOTAL_TICKS; i++) {
      if (i < 300) {
        // High-speed straight acceleration
        recordedInputs.push({ steer: 0, throttle: 1, brake: 0, drift: false, boost: false, restart: false, remix: false, debug: false });
      } else if (i < 600) {
        // High-speed drift turn
        recordedInputs.push({ steer: -0.5, throttle: 1, brake: 0, drift: true, boost: false, restart: false, remix: false, debug: false });
      } else if (i < 900) {
        // Counter-steer with nitro boost
        recordedInputs.push({ steer: 0.4, throttle: 1, brake: 0, drift: false, boost: true, restart: false, remix: false, debug: false });
      } else {
        // Trail braking into apex
        recordedInputs.push({ steer: 0.2, throttle: 0, brake: 0.8, drift: false, boost: false, restart: false, remix: false, debug: false });
      }
    }

    // 4. Run 60 Hz frame cadence (600 render frames, 10.0 seconds)
    // Frame times simulate requestAnimationFrame timestamps: performance.now()
    let accum60 = 0;
    let tickCount60 = 0;
    let lastTime60 = 0;
    const frames60 = 600;

    for (let f = 1; f <= frames60; f++) {
      const nowMs = f * (1000 / 60);
      const dt = (nowMs - lastTime60) / 1000;
      lastTime60 = nowMs;
      accum60 += dt;

      while (accum60 >= FIXED_DT - 1e-8 && tickCount60 < TOTAL_TICKS) {
        const input = recordedInputs[tickCount60++];
        car60.update(FIXED_DT, input, world60);
        track60.containCar(car60.position, car60.velocity);
        accum60 -= FIXED_DT;
      }
    }

    // 5. Run 144 Hz frame cadence (1,440 render frames, 10.0 seconds)
    let accum144 = 0;
    let tickCount144 = 0;
    let lastTime144 = 0;
    const frames144 = 1440;

    for (let f = 1; f <= frames144; f++) {
      const nowMs = f * (1000 / 144);
      const dt = (nowMs - lastTime144) / 1000;
      lastTime144 = nowMs;
      accum144 += dt;

      while (accum144 >= FIXED_DT - 1e-8 && tickCount144 < TOTAL_TICKS) {
        const input = recordedInputs[tickCount144++];
        car144.update(FIXED_DT, input, world144);
        track144.containCar(car144.position, car144.velocity);
        accum144 -= FIXED_DT;
      }
    }

    // Verify both executed exact same number of ticks
    expect(tickCount60).toBe(TOTAL_TICKS);
    expect(tickCount144).toBe(TOTAL_TICKS);

    // Verify end state is identical
    const posDiff = car60.position.distanceTo(car144.position);
    const quatDiff = car60.quaternion.angleTo(car144.quaternion);
    const velDiff = car60.velocity.distanceTo(car144.velocity);

    expect(posDiff).toBeLessThan(1e-9);
    expect(quatDiff).toBeLessThan(1e-9);
    expect(velDiff).toBeLessThan(1e-9);
    expect(car60.speed).toBe(car144.speed);
    expect(car60.isGrounded).toBe(car144.isGrounded);
    expect(car60.isDrifting).toBe(car144.isDrifting);
  });
});
