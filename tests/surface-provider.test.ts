import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { SurfaceHit, SurfaceProvider } from '../src/world/SurfaceProvider';
import { RoamWorld } from '../src/world/RoamWorld';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';

class MockFlatSurfaceProvider implements SurfaceProvider {
  readonly groundY: number;

  constructor(groundY: number = 0) {
    this.groundY = groundY;
  }

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    outHit: SurfaceHit
  ): boolean {
    outHit.hit = false;
    if (Math.abs(direction.y) < 1e-6) return false;
    const t = (this.groundY - origin.y) / direction.y;
    if (t >= 0 && t <= maxDistance) {
      outHit.hit = true;
      outHit.distance = t;
      outHit.point.set(
        origin.x + direction.x * t,
        this.groundY,
        origin.z + direction.z * t
      );
      outHit.normal.set(0, 1, 0);
      return true;
    }
    return false;
  }

  groundHeightAt?(x: number, z: number): number {
    return this.groundY;
  }
}

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

const THROTTLE_INPUT: InputState = {
  steer: 0,
  throttle: 1,
  brake: 0,
  drift: false,
  boost: false,
  restart: false,
  remix: false,
  debug: false,
};

describe('SurfaceProvider Interface & Mock Implementation', () => {
  it('mock SurfaceProvider returns the right hit point, normal, and distance for vertical raycasts', () => {
    const mock = new MockFlatSurfaceProvider(0);
    const hit: SurfaceHit = {
      hit: false,
      distance: 0,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
    };

    // 1. Raycast straight down from y = 10
    const origin = new THREE.Vector3(5, 10, -12);
    const dirDown = new THREE.Vector3(0, -1, 0);
    const didHit = mock.raycast(origin, dirDown, 50, hit);

    expect(didHit).toBe(true);
    expect(hit.hit).toBe(true);
    expect(hit.distance).toBeCloseTo(10, 5);
    expect(hit.point.x).toBeCloseTo(5, 5);
    expect(hit.point.y).toBeCloseTo(0, 5);
    expect(hit.point.z).toBeCloseTo(-12, 5);
    expect(hit.normal.x).toBe(0);
    expect(hit.normal.y).toBe(1);
    expect(hit.normal.z).toBe(0);

    // 2. Upward raycast should not hit flat ground below
    const dirUp = new THREE.Vector3(0, 1, 0);
    const hitUp = mock.raycast(origin, dirUp, 50, hit);
    expect(hitUp).toBe(false);

    // 3. Raycast with maxDistance shorter than distance to ground
    const hitShort = mock.raycast(origin, dirDown, 5, hit);
    expect(hitShort).toBe(false);
  });

  it('ArcadeCarController works against mock SurfaceProvider: stays grounded with normal (0, 1, 0) and correct distance', () => {
    const mock = new MockFlatSurfaceProvider(0);
    const car = new ArcadeCarController();

    // Start car at nominal ride height above y = 0
    car.position.set(0, 0.34, 0);
    car.prevPosition.copy(car.position);
    car.quaternion.set(0, 0, 0, 1);
    car.prevQuaternion.copy(car.quaternion);

    // Step physics with idle input
    car.update(FIXED_DT, IDLE_INPUT, mock);

    // Car must detect surface and be grounded at ride height (~0.34m above ground)
    expect(car.isGrounded).toBe(true);
    expect(car.surfaceNormal.y).toBeCloseTo(1.0, 3);
    expect(car.surfaceNormal.x).toBeCloseTo(0.0, 3);
    expect(car.surfaceNormal.z).toBeCloseTo(0.0, 3);
    expect(car.position.y).toBeCloseTo(0.34, 2);
  });

  it('ArcadeCarController accelerates and drives smoothly forward over mock SurfaceProvider', () => {
    const mock = new MockFlatSurfaceProvider(0);
    const car = new ArcadeCarController();

    car.position.set(0, 0.34, 0);
    car.prevPosition.copy(car.position);
    car.quaternion.set(0, 0, 0, 1);
    car.prevQuaternion.copy(car.quaternion);

    // Drive forward for 60 ticks (0.5 seconds)
    for (let i = 0; i < 60; i++) {
      car.update(FIXED_DT, THROTTLE_INPUT, mock);
    }

    // Car moves along -Z forward vector
    expect(car.position.z).toBeLessThan(-1.5);
    expect(car.speed).toBeGreaterThan(5.0);
    expect(car.isGrounded).toBe(true);
    expect(car.surfaceNormal.y).toBeCloseTo(1.0, 3);
    expect(car.position.y).toBeCloseTo(0.34, 2);
  });

  it('ArcadeCarController detects airborne state when lifted above mock SurfaceProvider', () => {
    const mock = new MockFlatSurfaceProvider(0);
    const car = new ArcadeCarController();

    // Spawn 15m in the air
    car.position.set(0, 15.0, 0);
    car.prevPosition.copy(car.position);
    car.quaternion.set(0, 0, 0, 1);
    car.prevQuaternion.copy(car.quaternion);

    car.update(FIXED_DT, IDLE_INPUT, mock);

    // Must be recognized as airborne
    expect(car.isGrounded).toBe(false);

    // Step 20 ticks: gravity must pull car downwards
    for (let i = 0; i < 20; i++) {
      car.update(FIXED_DT, IDLE_INPUT, mock);
    }
    expect(car.position.y).toBeLessThan(15.0);
  });

  it('RoamWorld implements SurfaceProvider and detects ground height and normal analytically', () => {
    const roamWorld = new RoamWorld();
    const hit: SurfaceHit = {
      hit: false,
      distance: 0,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
    };

    // 1. Raycast down onto terrain from y = 20
    const originGround = new THREE.Vector3(50, 20, 50);
    const dirDown = new THREE.Vector3(0, -1, 0);
    const hitGround = roamWorld.raycast(originGround, dirDown, 30, hit);

    expect(hitGround).toBe(true);
    expect(hit.hit).toBe(true);
    expect(hit.normal.y).toBeGreaterThan(0.85);
    const expectedHeight = roamWorld.groundHeightAt(50, 50);
    expect(hit.point.y).toBeCloseTo(expectedHeight, 2);

    // 2. Direct groundHeightAt and groundNormalAt queries
    const gh = roamWorld.groundHeightAt(0, 0);
    expect(gh).toBeGreaterThan(0);
    const norm = new THREE.Vector3();
    roamWorld.groundNormalAt(0, 0, norm);
    expect(norm.length()).toBeCloseTo(1.0, 4);
    expect(norm.y).toBeGreaterThan(0.8);
  });
});
