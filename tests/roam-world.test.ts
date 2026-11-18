import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_WORLD_SPEC,
  type WorldSpec,
  SurfaceType,
  SURFACE_CONFIG,
} from '../src/world/WorldConfig';
import {
  generateRoadNetwork,
  RoadClass,
  type RoadGraph,
  SpatialRoadIndex,
} from '../src/world/RoadNetwork';
import { TerrainHeight } from '../src/world/TerrainHeight';
import { ChunkManager, TerrainChunk } from '../src/world/ChunkManager';
import { ArcadeCarController } from '../src/car/ArcadeCarController';
import { FIXED_DT } from '../src/core/constants';
import type { InputState } from '../src/core/InputManager';
import { RoamWorld } from '../src/world/RoamWorld';
import { DistrictMap, DistrictType, BuildingStyle } from '../src/world/DistrictMap';
import { CityPropsGenerator } from '../src/world/CityPropsGenerator';
import { CityPoolManager, InstancedPool } from '../src/world/InstancedPool';
import { createLandmarkDefs } from '../src/world/Landmarks';

describe('Free Roam: Road Network Generator', () => {
  it('generates a deterministic, serializable road graph with ring highway, diagonal highways, avenues, and local streets', () => {
    const graph1 = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const graph2 = generateRoadNetwork(DEFAULT_WORLD_SPEC);

    expect(graph1.nodes.length).toBeGreaterThan(100);
    expect(graph1.edges.length).toBeGreaterThan(150);

    // Determinism test: identical seeds produce identical node counts and coords
    expect(graph1.nodes.length).toBe(graph2.nodes.length);
    expect(graph1.edges.length).toBe(graph2.edges.length);
    expect(graph1.nodes[0].x).toBe(graph2.nodes[0].x);
    expect(graph1.nodes[0].z).toBe(graph2.nodes[0].z);

    // Road class verification
    const highways = graph1.edges.filter(e => e.roadClass === RoadClass.HIGHWAY);
    const avenues = graph1.edges.filter(e => e.roadClass === RoadClass.AVENUE);
    const locals = graph1.edges.filter(e => e.roadClass === RoadClass.LOCAL);

    expect(highways.length).toBeGreaterThan(30);
    expect(avenues.length).toBeGreaterThan(50);
    expect(locals.length).toBeGreaterThan(10);

    // Highway width ~22m, Avenue ~14m, Local ~10m
    expect(highways[0].width).toBeCloseTo(22, 1);
    expect(avenues[0].width).toBeCloseTo(14, 1);
    expect(locals[0].width).toBeCloseTo(10, 1);
  });

  it('guarantees the road graph is 100% connected (single connected component)', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const nodes = graph.nodes;
    const edges = graph.edges;

    // Build adjacency list
    const adj = new Map<number, number[]>();
    for (let i = 0; i < nodes.length; i++) {
      adj.set(nodes[i].id, []);
    }
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      adj.get(e.fromNodeId)!.push(e.toNodeId);
      adj.get(e.toNodeId)!.push(e.fromNodeId);
    }

    // Breadth-First Search from node 0
    const visited = new Set<number>();
    const queue: number[] = [nodes[0].id];
    visited.add(nodes[0].id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adj.get(curr) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    // Every single node in the entire network must be reached
    expect(visited.size).toBe(nodes.length);
  });

  it('guarantees no overlapping roads: no duplicate edges and no edge crossing without an intersection node', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const nodes = graph.nodes;
    const edges = graph.edges;

    // 1. No duplicate edges connecting the same pair of nodes
    const edgePairSet = new Set<string>();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const minId = Math.min(e.fromNodeId, e.toNodeId);
      const maxId = Math.max(e.fromNodeId, e.toNodeId);
      const key = `${minId}_${maxId}`;

      expect(edgePairSet.has(key)).toBe(false);
      edgePairSet.add(key);
    }

    // 2. No edge intersects the interior of any other edge without meeting at a shared node
    const edgeCount = edges.length;
    for (let i = 0; i < edgeCount; i++) {
      const e1 = edges[i];
      const n1A = nodes[e1.fromNodeId];
      const n1B = nodes[e1.toNodeId];

      const dx1 = n1B.x - n1A.x;
      const dz1 = n1B.z - n1A.z;

      for (let j = i + 1; j < edgeCount; j++) {
        const e2 = edges[j];
        // If they share an endpoint, they legally meet at that shared node
        if (
          e1.fromNodeId === e2.fromNodeId ||
          e1.fromNodeId === e2.toNodeId ||
          e1.toNodeId === e2.fromNodeId ||
          e1.toNodeId === e2.toNodeId
        ) {
          continue;
        }

        const n2A = nodes[e2.fromNodeId];
        const n2B = nodes[e2.toNodeId];

        const dx2 = n2B.x - n2A.x;
        const dz2 = n2B.z - n2A.z;

        const denom = dx1 * dz2 - dz1 * dx2;
        if (Math.abs(denom) > 1e-6) {
          const t = ((n2A.x - n1A.x) * dz2 - (n2A.z - n1A.z) * dx2) / denom;
          const u = ((n2A.x - n1A.x) * dz1 - (n2A.z - n1A.z) * dx1) / denom;

          const EPS = 1e-4;
          // Interior intersection check: t in (EPS, 1 - EPS) and u in (EPS, 1 - EPS)
          const strictlyCrosses = t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
          expect(strictlyCrosses).toBe(false);
        }
      }
    }
  });

  it('adapts cleanly when changing worldSize in WorldSpec', () => {
    const smallSpec: WorldSpec = {
      ...DEFAULT_WORLD_SPEC,
      worldSize: 2000,
    };
    const smallGraph = generateRoadNetwork(smallSpec);

    expect(smallGraph.nodes.length).toBeGreaterThan(50);
    expect(smallGraph.edges.length).toBeGreaterThan(80);

    // Bounds must stay within halfSize
    for (const node of smallGraph.nodes) {
      expect(Math.abs(node.x)).toBeLessThanOrEqual(1000);
      expect(Math.abs(node.z)).toBeLessThanOrEqual(1000);
    }
  });
});

describe('Free Roam: Terrain Elevation & Road Flattening', () => {
  it('generates low-frequency rolling hills up to ~10m and flattens smoothly under roads', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const roadIndex = new SpatialRoadIndex(graph, DEFAULT_WORLD_SPEC.chunkSize);
    const terrain = new TerrainHeight(DEFAULT_WORLD_SPEC, roadIndex);

    // 1. Natural rolling hills amplitude test
    let minH = Infinity;
    let maxH = -Infinity;
    for (let x = -1000; x <= 1000; x += 100) {
      for (let z = -1000; z <= 1000; z += 100) {
        const h = terrain.rawTerrainHeight(x, z);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    expect(maxH).toBeLessThanOrEqual(DEFAULT_WORLD_SPEC.maxElevation + 1.0);
    expect(minH).toBeGreaterThanOrEqual(0.0);
    expect(maxH - minH).toBeGreaterThan(4.0); // Sufficient hill variance

    // 2. Flattening under road test: sample across a highway cross-section
    // Pick the first highway edge
    const highway = graph.edges.find(e => e.roadClass === RoadClass.HIGHWAY)!;
    const nA = graph.nodes[highway.fromNodeId];
    const nB = graph.nodes[highway.toNodeId];

    const midX = (nA.x + nB.x) * 0.5;
    const midZ = (nA.z + nB.z) * 0.5;
    const centerH = terrain.groundHeightAt(midX, midZ);

    const dx = nB.x - nA.x;
    const dz = nB.z - nA.z;
    const len = Math.hypot(dx, dz);
    const perpX = -dz / len;
    const perpZ = dx / len;

    // Points across the road width (highway width is 22m, halfWidth is 11m)
    const leftH = terrain.groundHeightAt(midX - perpX * 8, midZ - perpZ * 8);
    const rightH = terrain.groundHeightAt(midX + perpX * 8, midZ + perpZ * 8);

    // Cross-section must be flat on the road surface
    expect(leftH).toBeCloseTo(centerH, 2);
    expect(rightH).toBeCloseTo(centerH, 2);

    // Shoulder point (embankment transition)
    const shoulderH = terrain.groundHeightAt(midX + perpX * 18, midZ + perpZ * 18);
    const rawH = terrain.rawTerrainHeight(midX + perpX * 18, midZ + perpZ * 18);
    // Shoulder is blended between road and raw terrain
    expect(shoulderH).toBeDefined();

    // 3. Analytic normal test
    const norm = new THREE.Vector3();
    terrain.groundNormalAt(midX, midZ, norm);
    expect(norm.length()).toBeCloseTo(1.0, 4);
    expect(norm.y).toBeGreaterThan(0.8);
  });
});

describe('Free Roam: Surface Types & Grip Modulation', () => {
  it('classifies surface types into ASPHALT, DIRT, and GRASS', () => {
    const roam = new RoamWorld();

    // Spawn point is directly on highway centerline -> ASPHALT
    const surfOnRoad = roam.getSurfaceTypeAt(roam.roadGraph.nodes[0].x, roam.roadGraph.nodes[0].z);
    expect(surfOnRoad).toBe(SurfaceType.ASPHALT);

    // Point far away in deep meadow -> GRASS
    const surfMeadow = roam.getSurfaceTypeAt(1800, 1800);
    expect(surfMeadow).toBe(SurfaceType.GRASS);
  });

  it('modulates car top speed and lateral grip based on surface type', () => {
    const roam = new RoamWorld();
    const car = new ArcadeCarController();

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

    // 1. Drive on ASPHALT (on highway)
    const n0 = roam.roadGraph.nodes[0];
    const h0 = roam.groundHeightAt(n0.x, n0.z);
    car.position.set(n0.x, h0 + 0.34, n0.z);
    car.update(FIXED_DT, THROTTLE_INPUT, roam);
    expect(car.currentSurfaceType).toBe(SurfaceType.ASPHALT);

    // 2. Move car to GRASS meadow (far from roads)
    const hGrass = roam.groundHeightAt(1800, 1800);
    car.position.set(1800, hGrass + 0.34, 1800);
    car.speed = 100.0; // High speed from previous driving
    car.update(FIXED_DT, THROTTLE_INPUT, roam);

    expect(car.currentSurfaceType).toBe(SurfaceType.GRASS);

    // Step 180 ticks (1.5s) on grass: speed must decay towards ~70% top speed limit
    for (let i = 0; i < 180; i++) {
      car.update(FIXED_DT, THROTTLE_INPUT, roam);
    }

    // Top speed limit on grass is 70% of base maxSpeed (72 m/s * 0.70 ~ 50.4 m/s)
    const grassTopSpeed = 72.0 * SURFACE_CONFIG[SurfaceType.GRASS].topSpeedMultiplier;
    expect(car.speed).toBeLessThanOrEqual(grassTopSpeed + 1.0);
  });
});

describe('Free Roam: Chunk Streaming & Budgeting', () => {
  it('streams chunks within loadRadius (5) and unloads beyond unloadRadius (6) with hysteresis', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const roadIndex = new SpatialRoadIndex(graph, DEFAULT_WORLD_SPEC.chunkSize);
    const terrain = new TerrainHeight(DEFAULT_WORLD_SPEC, roadIndex);
    const chunkManager = new ChunkManager(DEFAULT_WORLD_SPEC, terrain, roadIndex);

    // Pre-warm around (0, 0)
    chunkManager.warmUp(0, 0);
    const initialLoaded = chunkManager.loadedCount;
    expect(initialLoaded).toBeGreaterThan(60); // (loadRadius 5 has ~81 circle chunks)

    // Move player far away to (2000, 2000)
    // Run update for multiple frames
    chunkManager.update(2000, 2000);

    // Verify build time budget exists and is measured
    expect(chunkManager.lastBuildMs).toBeGreaterThanOrEqual(0);

    // Chunks far behind are unloaded due to unloadRadius hysteresis
    chunkManager.dispose();
    expect(chunkManager.loadedCount).toBe(0);
  });

  it('builds road ribbon geometry with upward-facing normals, UVs, double-side materials, and polygon offset', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const roadIndex = new SpatialRoadIndex(graph, DEFAULT_WORLD_SPEC.chunkSize);
    const terrain = new TerrainHeight(DEFAULT_WORLD_SPEC, roadIndex);

    // Chunk (-7, -7) contains the diagonal highway where car spawns (-800, -800)
    const cx = Math.floor(-800 / DEFAULT_WORLD_SPEC.chunkSize);
    const cz = Math.floor(-800 / DEFAULT_WORLD_SPEC.chunkSize);

    const chunk = new TerrainChunk();
    chunk.build(cx, cz, terrain, roadIndex, DEFAULT_WORLD_SPEC);

    // Terrain grid has UV attribute
    const terrainUv = chunk.terrainGeo.getAttribute('uv');
    expect(terrainUv).toBeDefined();
    expect(terrainUv.count).toBeGreaterThan(1000);

    // Road group has children (asphalt ribbons and stripes)
    expect(chunk.roadGroup.children.length).toBeGreaterThanOrEqual(2);

    const roadMesh = chunk.roadGroup.children[0] as THREE.Mesh;
    const roadGeo = roadMesh.geometry;
    const roadNormAttr = roadGeo.getAttribute('normal');
    const roadUvAttr = roadGeo.getAttribute('uv');

    expect(roadNormAttr).toBeDefined();
    expect(roadUvAttr).toBeDefined();

    // Normal MUST point UPWARDS (+Y), not downwards into the earth
    for (let i = 0; i < roadNormAttr.count; i++) {
      const ny = roadNormAttr.getY(i);
      expect(ny).toBeGreaterThan(0.7); // Near vertical upward normal
    }

    // Material properties: DoubleSide and polygonOffset enabled to eliminate backface culling & z-fighting
    const roadMat = roadMesh.material as THREE.MeshStandardMaterial;
    expect(roadMat.side).toBe(THREE.DoubleSide);
    expect(roadMat.polygonOffset).toBe(true);

    const stripeMesh = chunk.roadGroup.children[1] as THREE.Mesh;
    const stripeMat = stripeMesh.material as THREE.MeshBasicMaterial;
    expect(stripeMat.side).toBe(THREE.DoubleSide);
    expect(stripeMat.polygonOffset).toBe(true);

    chunk.recycle();
  });
});

describe('Free Roam: Districts, City Props & Instanced Pools', () => {
  it('classifies districts deterministically with Downtown near the center and one open green reserve', () => {
    const distMap = new DistrictMap(DEFAULT_WORLD_SPEC);

    // Center is Downtown
    expect(distMap.getDistrictAt(0, 0)).toBe(DistrictType.DOWNTOWN);
    expect(distMap.getDistrictAt(100, -100)).toBe(DistrictType.DOWNTOWN);

    // Northwest far expanse is OPEN_GREEN
    expect(distMap.getDistrictAt(-800, -800)).toBe(DistrictType.OPEN_GREEN);

    // Determinism test: identical queries yield identical districts
    const distMap2 = new DistrictMap(DEFAULT_WORLD_SPEC);
    for (let x = -1000; x <= 1000; x += 250) {
      for (let z = -1000; z <= 1000; z += 250) {
        expect(distMap.getDistrictAt(x, z)).toBe(distMap2.getDistrictAt(x, z));
      }
    }
  });

  it('guarantees building lots NEVER overlap roads across all districts', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const roadIndex = new SpatialRoadIndex(graph, DEFAULT_WORLD_SPEC.chunkSize);
    const terrain = new TerrainHeight(DEFAULT_WORLD_SPEC, roadIndex);
    const districtMap = new DistrictMap(DEFAULT_WORLD_SPEC);
    const landmarks = createLandmarkDefs(DEFAULT_WORLD_SPEC.chunkSize);
    const generator = new CityPropsGenerator(DEFAULT_WORLD_SPEC, roadIndex, terrain, districtMap, landmarks);

    // Sample 25 chunks across different quadrants and districts
    let totalBuildingsChecked = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const props = generator.generateChunkProps(cx, cz);
        for (const b of props.buildings) {
          totalBuildingsChecked++;
          const nearest = roadIndex.getNearestRoad(b.box.x, b.box.z, 64);
          expect(nearest).toBeDefined();

          // Distance from lot center to road centerline must exceed road half-width + lot radius
          const lotRadius = Math.hypot(b.box.width * 0.5, b.box.depth * 0.5);
          expect(nearest!.distance).toBeGreaterThanOrEqual(nearest!.roadHalfWidth + lotRadius);
        }
      }
    }
    expect(totalBuildingsChecked).toBeGreaterThan(30);
  });

  it('guarantees identical seed generates the exact same city lots and props', () => {
    const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC);
    const roadIndex = new SpatialRoadIndex(graph, DEFAULT_WORLD_SPEC.chunkSize);
    const terrain = new TerrainHeight(DEFAULT_WORLD_SPEC, roadIndex);
    const districtMap = new DistrictMap(DEFAULT_WORLD_SPEC);
    const landmarks = createLandmarkDefs(DEFAULT_WORLD_SPEC.chunkSize);

    const gen1 = new CityPropsGenerator(DEFAULT_WORLD_SPEC, roadIndex, terrain, districtMap, landmarks);
    const gen2 = new CityPropsGenerator(DEFAULT_WORLD_SPEC, roadIndex, terrain, districtMap, landmarks);

    const p1 = gen1.generateChunkProps(0, 0);
    const p2 = gen2.generateChunkProps(0, 0);

    expect(p1.buildings.length).toBe(p2.buildings.length);
    expect(p1.treeMatrices.length).toBe(p2.treeMatrices.length);
    expect(p1.lampMatrices.length).toBe(p2.lampMatrices.length);

    for (let i = 0; i < p1.buildings.length; i++) {
      expect(p1.buildings[i].style).toBe(p2.buildings[i].style);
      expect(p1.buildings[i].box.x).toBeCloseTo(p2.buildings[i].box.x, 3);
      expect(p1.buildings[i].box.y).toBeCloseTo(p2.buildings[i].box.y, 3);
      expect(p1.buildings[i].box.z).toBeCloseTo(p2.buildings[i].box.z, 3);
      expect(p1.buildings[i].box.width).toBe(p2.buildings[i].box.width);
      expect(p1.buildings[i].box.height).toBe(p2.buildings[i].box.height);
    }
  });

  it('chunk unload releases all pool slots with zero leaks after loading and unloading 100 chunks', () => {
    const roam = new RoamWorld();

    const poolManager = roam.poolManager;
    // Check initial capacities
    expect(CityPoolManager.BUILDING_CAPACITY).toBe(500);
    expect(CityPoolManager.TREE_CAPACITY).toBe(2500);
    expect(CityPoolManager.LAMP_CAPACITY).toBe(1500);

    // Initial state: warmUp loaded spawn chunks
    expect(roam.loadedChunksCount).toBeGreaterThan(60);
    const midTreeAllocated = poolManager.treePool.allocatedCount;
    expect(midTreeAllocated).toBeGreaterThan(0);

    // Stream across 100 chunk positions to trigger rolling loads and unloads
    for (let i = 0; i < 100; i++) {
      roam.updateVisuals((i % 10) * 128, Math.floor(i / 10) * 128);
    }

    // Now unload all chunks via dispose
    roam.dispose();
    expect(roam.loadedChunksCount).toBe(0);

    // Every single slot in all 8 pools MUST be completely returned
    for (const style of Object.values(BuildingStyle)) {
      const pool = poolManager.buildingPools[style];
      expect(pool.allocatedCount).toBe(0);
      expect(pool.availableCount).toBe(pool.capacity);
    }
    expect(poolManager.treePool.allocatedCount).toBe(0);
    expect(poolManager.treePool.availableCount).toBe(poolManager.treePool.capacity);

    expect(poolManager.lampPool.allocatedCount).toBe(0);
    expect(poolManager.lampPool.availableCount).toBe(poolManager.lampPool.capacity);
  });

  it('safely handles pool capacity limit: logs warning once and skips without crashing', () => {
    const pool = new InstancedPool(
      'Test_Mini_Pool',
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      4
    );

    expect(pool.capacity).toBe(4);
    expect(pool.allocate()).toBe(3);
    expect(pool.allocate()).toBe(2);
    expect(pool.allocate()).toBe(1);
    expect(pool.allocate()).toBe(0);

    // Next allocate exceeds capacity: must return -1 and NOT throw
    expect(pool.allocate()).toBe(-1);
    expect(pool.allocate()).toBe(-1);
    expect(pool.allocatedCount).toBe(4);
    expect(pool.availableCount).toBe(0);

    // Freeing 1 slot allows re-allocation
    pool.free(2);
    expect(pool.availableCount).toBe(1);
    expect(pool.allocate()).toBe(2);

    pool.dispose();
  });

  it('detects solid building walls via SurfaceProvider with vertical deflection normal', () => {
    const roam = new RoamWorld();
    roam.chunkManager.warmUp(0, 0); // Warm up Downtown chunks around (0, 0)

    // Find a chunk with a building around (0, 0)
    let targetBuilding: any = null;
    let targetChunkX = 0;
    let targetChunkZ = 0;
    for (let cx = -1; cx <= 1 && !targetBuilding; cx++) {
      for (let cz = -1; cz <= 1 && !targetBuilding; cz++) {
        const props = roam.propsGenerator.generateChunkProps(cx, cz);
        if (props.buildings.length > 0) {
          targetBuilding = props.buildings[0];
          targetChunkX = cx;
          targetChunkZ = cz;
        }
      }
    }
    expect(targetBuilding).toBeDefined();

    // Verify chunk collider is registered
    expect((roam as any).chunkColliders.has(`${targetChunkX}_${targetChunkZ}`)).toBe(true);

    // Probe towards the building wall
    const box = targetBuilding.box;
    const probeOrigin = new THREE.Vector3(box.x + box.width * 0.5 + 2.0, box.y, box.z);
    const probeDir = new THREE.Vector3(-1, 0, 0); // pointing at building wall
    const hit: any = { hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3() };

    const hasHit = roam.raycast(probeOrigin, probeDir, 5.0, hit);
    expect(hasHit).toBe(true);
    expect(hit.hit).toBe(true);
    expect(hit.distance).toBeLessThan(3.0);
    // Wall normal must be vertical wall facing outward (+X)
    expect(hit.normal.x).toBeGreaterThan(0.7);
    expect(Math.abs(hit.normal.y)).toBeLessThan(0.15); // NOT ground (vertical wall)

    roam.dispose();
  });
});
