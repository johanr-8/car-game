import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { TrackSpline } from '../src/world/TrackSpline';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';

describe('Anti-Tunneling Safety at 259 km/h (45-degree impact)', () => {
  let collisionWorld: CollisionWorld;
  let track: TrackSpline;
  let carCtrl: ArcadeCarController;

  const IDLE_INPUT: InputState = {
    steer: 0,
    throttle: 0,
    brake: 0,
    drift: false,
    boost: false,
    restart: false,
    remix: false,
    debug: false,
  };

  beforeEach(() => {
    collisionWorld = new CollisionWorld();
    track = new TrackSpline(collisionWorld);
    collisionWorld.buildBVH();
    carCtrl = new ArcadeCarController();
  });

  it('guarantees car at 259 km/h (72 m/s) does not tunnel through side barrier at 45° angle', () => {
    // 259.2 km/h = 72 m/s
    const speed72 = 72.0;
    const angle45 = Math.PI / 4;

    // Position car near right edge of straightaway (Z = 0, track center is X = 0)
    // Heading 45 degrees towards the right barrier (+X and -Z)
    carCtrl.position.set(4.0, 0.94, 0);
    carCtrl.prevPosition.copy(carCtrl.position);
    carCtrl.speed = speed72;
    carCtrl.velocity.set(
      Math.sin(angle45) * speed72,  // +X component into barrier (~50.91 m/s)
      0,
      -Math.cos(angle45) * speed72 // -Z forward component (~-50.91 m/s)
    );
    carCtrl.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle45);
    carCtrl.prevQuaternion.copy(carCtrl.quaternion);

    // Simulate 30 physics ticks (enough to travel ~18 meters without collision)
    let maxLateralDist = 0;
    for (let tick = 0; tick < 30; tick++) {
      carCtrl.update(FIXED_DT, IDLE_INPUT, collisionWorld);
      track.containCar(carCtrl.position, carCtrl.velocity);

      const lateralDist = Math.abs(carCtrl.position.x);
      if (lateralDist > maxLateralDist) {
        maxLateralDist = lateralDist;
      }

      // Assert that car never breached beyond the 6.30m containment limit
      expect(lateralDist).toBeLessThanOrEqual(6.30);
    }

    // Verify car impacted the barrier and was safely contained within the 6.30m track boundary
    expect(maxLateralDist).toBeGreaterThan(5.0);
    expect(maxLateralDist).toBeLessThanOrEqual(6.30);
    expect(carCtrl.position.x).toBeLessThanOrEqual(6.30);
  });

  it('guarantees car plunging at 259 km/h (72 m/s) at 45° downward angle does not tunnel through the road deck', () => {
    const speed72 = 72.0;
    const angle45 = Math.PI / 4;

    // Start slightly above the road surface on the home straight (road deck Y = 0.60m)
    // Direct plunge at 45 degrees downwards (-Y and -Z)
    carCtrl.position.set(0, 2.8, 15);
    carCtrl.prevPosition.copy(carCtrl.position);
    carCtrl.speed = speed72;
    carCtrl.velocity.set(
      0,
      -Math.sin(angle45) * speed72, // -Y downward plunge (~ -50.91 m/s)
      -Math.cos(angle45) * speed72  // -Z forward component (~ -50.91 m/s)
    );

    // Simulate 20 physics ticks
    for (let tick = 0; tick < 20; tick++) {
      carCtrl.update(FIXED_DT, IDLE_INPUT, collisionWorld);
      track.containCar(carCtrl.position, carCtrl.velocity);

      // The car must NEVER tunnel below the road deck (Y < 0.60m)
      expect(carCtrl.position.y).toBeGreaterThanOrEqual(0.60);
    }

    // Verify the car successfully adhered to the road surface at target ride height
    expect(carCtrl.isGrounded).toBe(true);
    expect(carCtrl.position.y).toBeCloseTo(0.94, 1);
  });
});
