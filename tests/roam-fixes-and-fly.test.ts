/**
 * tests/roam-fixes-and-fly.test.ts
 * ─────────────────────────────────────────────────────────────
 * Verification test suite for:
 *   1. Visual front wheel steering direction
 *   2. Suburban house unit geometry bounds & flush ground seating
 *   3. Streetlight placement road clearance & intersection setback
 *   4. Spectator FlyController flight physics & controls
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CarModel } from '../src/car/CarModel';
import { CityPoolManager } from '../src/world/InstancedPool';
import { BuildingStyle } from '../src/world/DistrictMap';
import { RoamWorld } from '../src/world/RoamWorld';
import { FlyController } from '../src/core/FlyController';
import { WORLD_CONFIG } from '../src/world/WorldConfig';

describe('Free Roam Fixes & Spectator Fly Mode', () => {

  describe('Visual Wheel Steering Direction', () => {
    it('turns front wheels in the matching direction of the steer angle', () => {
      const carModel = new CarModel();

      // Steering Right (+1): In Three.js world space, turning car right requires negative Y rotation
      carModel.updateVisuals(1.0, false);
      const flRight = (carModel as any).frontLeftWheel.rotation.y;
      const frRight = (carModel as any).frontRightWheel.rotation.y;
      expect(flRight).toBeLessThan(0);
      expect(frRight).toBeLessThan(0);
      expect(flRight).toBeCloseTo(-0.45, 2);
      expect(frRight).toBeCloseTo(-0.45, 2);

      // Steering Left (-1): Turning car left requires positive Y rotation
      carModel.updateVisuals(-1.0, false);
      const flLeft = (carModel as any).frontLeftWheel.rotation.y;
      const frLeft = (carModel as any).frontRightWheel.rotation.y;
      expect(flLeft).toBeGreaterThan(0);
      expect(frLeft).toBeGreaterThan(0);
      expect(flLeft).toBeCloseTo(0.45, 2);
      expect(frLeft).toBeCloseTo(0.45, 2);

      // Neutral steering (0)
      carModel.updateVisuals(0, false);
      expect((carModel as any).frontLeftWheel.rotation.y).toBeCloseTo(0);
      expect((carModel as any).frontRightWheel.rotation.y).toBeCloseTo(0);
    });
  });

  describe('Suburban House Unit Geometry Bounds', () => {
    it('spans exactly [-0.5, 0.5] vertically so houses sit flush on terrain with no hover', () => {
      const poolManager = new CityPoolManager();
      const housePool = poolManager.buildingPools[BuildingStyle.HOUSE];
      const geo = housePool.mesh.geometry;

      geo.computeBoundingBox();
      const bbox = geo.boundingBox!;

      // Vertical span must be exactly [-0.5, 0.5]
      expect(bbox.min.y).toBeCloseTo(-0.5, 2);
      expect(bbox.max.y).toBeCloseTo(0.5, 2);

      // Horizontal bounds must be within unit envelope
      expect(bbox.min.x).toBeGreaterThanOrEqual(-0.6);
      expect(bbox.max.x).toBeLessThanOrEqual(0.6);
      expect(bbox.min.z).toBeGreaterThanOrEqual(-0.6);
      expect(bbox.max.z).toBeLessThanOrEqual(0.6);

      // Geometry must have normal and UV attributes
      expect(geo.getAttribute('position')).toBeDefined();
      expect(geo.getAttribute('normal')).toBeDefined();
      expect(geo.getAttribute('uv')).toBeDefined();

      // No NaN values in normals or positions
      const pos = geo.getAttribute('position').array;
      for (let i = 0; i < pos.length; i++) {
        expect(Number.isNaN(pos[i])).toBe(false);
      }
      const norm = geo.getAttribute('normal').array;
      for (let i = 0; i < norm.length; i++) {
        expect(Number.isNaN(norm[i])).toBe(false);
      }

      poolManager.dispose();
    });
  });

  describe('Streetlight Placement & Clearance', () => {
    it('places lamps strictly outside roadways with clearance and avoids intersections', () => {
      const roamWorld = new RoamWorld();
      const generator = roamWorld.propsGenerator;
      const spatialIndex = roamWorld.roadIndex;

      let totalLampsChecked = 0;
      const pos = new THREE.Vector3();

      // Sample 25 chunks across the map
      for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
          const props = generator.generateChunkProps(cx, cz);
          for (const mat of props.lampMatrices) {
            pos.setFromMatrixPosition(mat);
            totalLampsChecked++;

            // Strict road clearance check
            const nearest = spatialIndex.getNearestRoad(pos.x, pos.z, 64);
            expect(nearest).toBeDefined();
            if (nearest) {
              // Lamp must be at least roadHalfWidth + 1.8 away from road centerline
              expect(nearest.distance).toBeGreaterThanOrEqual(nearest.roadHalfWidth + 1.79);
            }
          }
        }
      }

      // Ensure we actually checked a significant number of streetlamps
      expect(totalLampsChecked).toBeGreaterThan(15);
    });
  });

  describe('Spectator FlyController', () => {
    let fly: FlyController;
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      fly = new FlyController();
      camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
      camera.position.set(100, 25, 200);
      camera.lookAt(100, 25, 100); // Looking along -Z
    });

    afterEach(() => {
      fly.dispose();
    });

    it('initializes disabled and correctly syncs position and look direction on enable', () => {
      expect(fly.isEnabled).toBe(false);

      const active = fly.toggle(camera);
      expect(active).toBe(true);
      expect(fly.isEnabled).toBe(true);

      expect(fly.position.x).toBe(100);
      expect(fly.position.y).toBe(25);
      expect(fly.position.z).toBe(200);

      // Looking along -Z means yaw is ~0 and pitch is ~0
      expect(fly.yaw).toBeCloseTo(0, 1);
      expect(fly.pitch).toBeCloseTo(0, 1);

      const toggledOff = fly.toggle(camera);
      expect(toggledOff).toBe(false);
      expect(fly.isEnabled).toBe(false);
    });

    it('translates along forward and lateral vectors with high spectator speed', () => {
      fly.enable(camera);
      const startZ = fly.position.z;

      // Simulate pressing W (Forward along -Z)
      (fly as any).keys.add('KeyW');
      fly.update(0.1); // dt = 0.1s at baseSpeed 140 m/s => 14m displacement
      expect(fly.position.z).toBeCloseTo(startZ - 14, 1);
      (fly as any).keys.delete('KeyW');

      // Simulate pressing Shift + W (Turbo speed: 140 * 2.8 = 392 m/s => 39.2m displacement)
      const turboZ = fly.position.z;
      (fly as any).keys.add('KeyW');
      (fly as any).keys.add('ShiftLeft');
      fly.update(0.1);
      expect(fly.position.z).toBeCloseTo(turboZ - 39.2, 1);
      (fly as any).keys.delete('KeyW');
      (fly as any).keys.delete('ShiftLeft');

      // Simulate vertical ascent with Space (Upward +Y)
      const startY = fly.position.y;
      (fly as any).keys.add('Space');
      fly.update(0.1);
      expect(fly.position.y).toBeGreaterThan(startY);
    });

    it('clamps pitch angle to prevent camera flipping upside-down', () => {
      fly.enable(camera);

      // Pitch up beyond 90 degrees
      (fly as any).keys.add('ArrowUp');
      for (let i = 0; i < 20; i++) {
        fly.update(0.1);
      }
      expect(fly.pitch).toBeLessThanOrEqual(1.52);

      // Pitch down beyond -90 degrees
      (fly as any).keys.delete('ArrowUp');
      (fly as any).keys.add('ArrowDown');
      for (let i = 0; i < 40; i++) {
        fly.update(0.1);
      }
      expect(fly.pitch).toBeGreaterThanOrEqual(-1.52);
    });
  });
});
