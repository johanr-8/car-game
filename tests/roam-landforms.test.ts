/**
 * tests/roam-landforms.test.ts
 * ─────────────────────────────────────────────────────────────
 * Verification test suite for Free Roam Macro Landforms & Biomes:
 *   1. Same seed gives bitwise identical heights across the map.
 *   2. Normals are strictly unit length everywhere.
 *   3. Slope stays below configured threshold on drivable biomes.
 *   4. Every biome (BEACH, MEADOW, FOREST, ROCK, URBAN) appears.
 *   5. TerrainHeight matches expected behavior on flat test inputs.
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_WORLD_SPEC,
  DEFAULT_MACRO_LANDFORMS,
  BiomeType,
  type WorldSpec,
} from '../src/world/WorldConfig';
import { Landforms, landformHeight, slopeAt, biomeAt } from '../src/world/Landforms';
import { TerrainHeight } from '../src/world/TerrainHeight';

describe('Free Roam: Macro Landforms & Biome Engine', () => {
  it('1. same seed gives same heights (deterministic landforms)', () => {
    const seed = 987654321;
    const spec1: WorldSpec = { ...DEFAULT_WORLD_SPEC, seed };
    const spec2: WorldSpec = { ...DEFAULT_WORLD_SPEC, seed };

    const landforms1 = new Landforms(spec1);
    const landforms2 = new Landforms(spec2);

    // Sample across varied coordinates (coast, basin, mountains, hills)
    const testPoints: [number, number][] = [
      [0, 0],
      [150, -200],
      [-1200, 100],
      [1050, 900], // Mountain pass
      [1400, 600], // Mountain ridge
      [320, -760], // Lake
      [-960, -320], // Coastal meadow spawn
      [-1500, 400], // Ocean
      [800, -800],
      [-400, 600],
    ];

    for (let i = 0; i < testPoints.length; i++) {
      const [x, z] = testPoints[i];
      const h1 = landforms1.getHeight(x, z);
      const h2 = landforms2.getHeight(x, z);
      expect(h1).toBe(h2);
    }
  });

  it('2. normals are unit length across the entire terrain', () => {
    const landforms = new Landforms(DEFAULT_WORLD_SPEC);
    const norm = new THREE.Vector3();

    const sampleCoords = [
      [0, 0],
      [350, 400],
      [1050, 900],
      [1450, 650], // Steep mountain ridge
      [-1100, 150], // Coastline transition
      [320, -760],
      [-500, -500],
      [600, 600],
    ];

    for (let i = 0; i < sampleCoords.length; i++) {
      const [x, z] = sampleCoords[i];
      landforms.getNormal(x, z, norm);

      const len = norm.length();
      expect(len).toBeCloseTo(1.0, 5);
      // Upward facing (y > 0)
      expect(norm.y).toBeGreaterThan(0.0);
    }
  });

  it('3. slope is below configured max on drivable biomes (MEADOW, URBAN, BEACH)', () => {
    const landforms = new Landforms(DEFAULT_WORLD_SPEC);

    // Sample grid in the city basin and coastal meadow regions
    let testedDrivableCount = 0;
    for (let x = -700; x <= 700; x += 70) {
      for (let z = -700; z <= 700; z += 70) {
        const biome = landforms.getBiome(x, z);
        if (biome === BiomeType.URBAN || biome === BiomeType.MEADOW || biome === BiomeType.BEACH) {
          const slope = landforms.getSlope(x, z);
          // Slope on drivable biomes must remain well below ~40 degrees (tan(40°) ~ 0.84)
          expect(slope).toBeLessThan(0.45);
          testedDrivableCount++;
        }
      }
    }

    expect(testedDrivableCount).toBeGreaterThan(50);
  });

  it('4. every biome appears across the map (BEACH, MEADOW, FOREST, ROCK, URBAN)', () => {
    const landforms = new Landforms(DEFAULT_WORLD_SPEC);
    const biomeCounts = new Map<BiomeType, number>([
      [BiomeType.BEACH, 0],
      [BiomeType.MEADOW, 0],
      [BiomeType.FOREST, 0],
      [BiomeType.ROCK, 0],
      [BiomeType.URBAN, 0],
    ]);

    // Sample world
    for (let x = -1500; x <= 1600; x += 100) {
      for (let z = -1500; z <= 1600; z += 100) {
        const biome = landforms.getBiome(x, z);
        const prev = biomeCounts.get(biome) || 0;
        biomeCounts.set(biome, prev + 1);
      }
    }

    // Every biome must be present with significant coverage
    expect(biomeCounts.get(BiomeType.BEACH)!).toBeGreaterThan(0);
    expect(biomeCounts.get(BiomeType.MEADOW)!).toBeGreaterThan(0);
    expect(biomeCounts.get(BiomeType.FOREST)!).toBeGreaterThan(0);
    expect(biomeCounts.get(BiomeType.ROCK)!).toBeGreaterThan(0);
    expect(biomeCounts.get(BiomeType.URBAN)!).toBeGreaterThan(0);
  });

  it('5. TerrainHeight matches expected behavior on flat test inputs', () => {
    // Mock flat world spec
    const flatSpec: WorldSpec = {
      ...DEFAULT_WORLD_SPEC,
      maxElevation: 10.0,
      macroLandforms: {
        ...DEFAULT_MACRO_LANDFORMS,
        cityBasinRadius: 2000.0, // whole test area is flat basin
        cityBasinElevation: 10.0,
      },
    };

    const terrain = new TerrainHeight(flatSpec); // No road index -> pure landforms
    const norm = new THREE.Vector3();

    // In flat basin, ground height matches basin elevation smoothly
    const hCenter = terrain.groundHeightAt(0, 0);
    expect(hCenter).toBeCloseTo(10.0, 1);

    terrain.groundNormalAt(0, 0, norm);
    expect(norm.x).toBeCloseTo(0.0, 1);
    expect(norm.y).toBeCloseTo(1.0, 1);
    expect(norm.z).toBeCloseTo(0.0, 1);

    // Height query without road index returns pure landform height
    const h100 = terrain.groundHeightAt(100, 100);
    expect(Math.abs(h100 - 10.0)).toBeLessThan(3.0);
  });

  it('6. pure export functions landformHeight, slopeAt, biomeAt work consistently', () => {
    const h = landformHeight(0, 0);
    expect(h).toBeGreaterThan(0);

    const s = slopeAt(0, 0);
    expect(s).toBeGreaterThanOrEqual(0);

    const b = biomeAt(0, 0);
    expect([BiomeType.URBAN, BiomeType.MEADOW]).toContain(b);
  });
});
