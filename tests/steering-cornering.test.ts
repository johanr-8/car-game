import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { TrackSpline } from '../src/world/TrackSpline';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { CarConfig } from '../src/car/CarConfig';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';

describe('Steering Sensitivity & High-Speed Cornering (150+ km/h)', () => {
  let collisionWorld: CollisionWorld;
  let track: TrackSpline;

  beforeEach(() => {
    collisionWorld = new CollisionWorld();
    track = new TrackSpline(collisionWorld);
    collisionWorld.buildBVH();
  });

  it('guarantees turning radius at 150 km/h is <= 21m, easily clearing normal corners without understeering', () => {
    const car = new ArcadeCarController();
    const speed150 = 150.0 / 3.6; // 41.67 m/s

    car.position.set(0, 0.94, 25);
    car.quaternion.set(0, 0, 0, 1);
    car.speed = speed150;
    car.velocity.set(0, 0, -speed150);
    car.isGrounded = true;

    // Full right steer input without drift
    const input: InputState = {
      steer: 1.0,
      throttle: 1,
      brake: 0,
      drift: false,
      boost: false,
      restart: false,
      remix: false,
      debug: false,
    };

    // Run 1 tick to measure instantaneous yaw angular velocity
    const qBefore = car.quaternion.clone();
    car.update(FIXED_DT, input, collisionWorld);
    const qAfter = car.quaternion.clone();

    // Yaw angle change in 1 tick
    const fwdBefore = new THREE.Vector3(0, 0, -1).applyQuaternion(qBefore);
    const fwdAfter = new THREE.Vector3(0, 0, -1).applyQuaternion(qAfter);
    const deltaAngle = fwdBefore.angleTo(fwdAfter);
    const angularVelocity = deltaAngle / FIXED_DT; // rad/s

    // At 150 km/h with steerSpeed=3.5 and steerSpeedDecay=0.46:
    // speedFactor = 1 - 0.46 * (41.67 / 48) ~ 0.60
    // angularVelocity ~ 3.5 * 0.60 = 2.10 rad/s
    expect(angularVelocity).toBeGreaterThan(2.0);
    expect(angularVelocity).toBeLessThan(2.3);

    // Turning radius R = v / omega
    const turningRadius = speed150 / angularVelocity;
    // Must be <= 21m (main ground corners on track have curvature radii of 35-55m)
    expect(turningRadius).toBeLessThanOrEqual(21.0);
  });

  it('verifies steerSpeedDecay calms steering at 150 km/h compared to low speed', () => {
    const carSlow = new ArcadeCarController();
    const carFast = new ArcadeCarController();

    const speedSlow = 10.0 / 3.6; // 10 km/h
    const speedFast = 150.0 / 3.6; // 150 km/h

    carSlow.position.set(0, 0.94, 25);
    carSlow.speed = speedSlow;
    carSlow.velocity.set(0, 0, -speedSlow);
    carSlow.isGrounded = true;

    carFast.position.set(0, 0.94, 25);
    carFast.speed = speedFast;
    carFast.velocity.set(0, 0, -speedFast);
    carFast.isGrounded = true;

    const input: InputState = {
      steer: 1.0,
      throttle: 1,
      brake: 0,
      drift: false,
      boost: false,
      restart: false,
      remix: false,
      debug: false,
    };

    carSlow.update(FIXED_DT, input, collisionWorld);
    carFast.update(FIXED_DT, input, collisionWorld);

    const fwd0 = new THREE.Vector3(0, 0, -1);
    const fwdSlow = fwd0.clone().applyQuaternion(carSlow.quaternion);
    const fwdFast = fwd0.clone().applyQuaternion(carFast.quaternion);

    const rateSlow = fwd0.angleTo(fwdSlow) / FIXED_DT;
    const rateFast = fwd0.angleTo(fwdFast) / FIXED_DT;

    // Fast steering rate should be roughly ~60% of slow steering rate
    const ratio = rateFast / rateSlow;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.68);
  });

  it('proves drifting provides sharper turn rate than normal steering at 150 km/h', () => {
    const carNormal = new ArcadeCarController();
    const carDrift = new ArcadeCarController();

    const speed = 150.0 / 3.6;
    carNormal.position.set(0, 0.94, 25);
    carNormal.speed = speed;
    carNormal.velocity.set(0, 0, -speed);
    carNormal.isGrounded = true;

    carDrift.position.set(0, 0.94, 25);
    carDrift.speed = speed;
    carDrift.velocity.set(0, 0, -speed);
    carDrift.isGrounded = true;
    carDrift.isDrifting = true;
    carDrift.driftTransition = 1.0;

    const inputNormal: InputState = {
      steer: 1.0,
      throttle: 1,
      brake: 0,
      drift: false,
      boost: false,
      restart: false,
      remix: false,
      debug: false,
    };

    const inputDrift: InputState = {
      steer: 1.0,
      throttle: 1,
      brake: 0,
      drift: true,
      boost: false,
      restart: false,
      remix: false,
      debug: false,
    };

    carNormal.update(FIXED_DT, inputNormal, collisionWorld);
    carDrift.update(FIXED_DT, inputDrift, collisionWorld);

    const fwd0 = new THREE.Vector3(0, 0, -1);
    const fwdNormal = fwd0.clone().applyQuaternion(carNormal.quaternion);
    const fwdDrift = fwd0.clone().applyQuaternion(carDrift.quaternion);

    const rateNormal = fwd0.angleTo(fwdNormal) / FIXED_DT;
    const rateDrift = fwd0.angleTo(fwdDrift) / FIXED_DT;

    // Drift steer boost is 1.35x
    const boostRatio = rateDrift / rateNormal;
    expect(boostRatio).toBeGreaterThan(1.30);
    expect(boostRatio).toBeLessThan(1.40);
  });
});
