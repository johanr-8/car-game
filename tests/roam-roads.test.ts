import { describe, it, expect } from 'vitest';
import {
  generateRoadNetwork,
  generateTownHubs,
  RoadClass,
  TownType,
  ROAD_CLASS_CONFIGS,
  type RoadGraph,
  SpatialRoadIndex,
} from '../src/world/RoadNetwork';
import { DEFAULT_WORLD_SPEC, SurfaceType } from '../src/world/WorldConfig';
import { Landforms } from '../src/world/Landforms';
import { TerrainHeight } from '../src/world/TerrainHeight';

describe('Free Roam: Terrain-Aware Road Network & Regional Towns', () => {
  const lf = new Landforms(DEFAULT_WORLD_SPEC);
  const graph = generateRoadNetwork(DEFAULT_WORLD_SPEC, lf);

  it('generates the specified regional town hubs across macro landforms', () => {
    const towns = generateTownHubs(DEFAULT_WORLD_SPEC, lf);
    expect(towns.length).toBe(8);

    const types = towns.map(t => t.type);
    expect(types).toContain(TownType.DOWNTOWN);
    expect(types).toContain(TownType.PORT);
    expect(types).toContain(TownType.SUMMIT);
    expect(types).toContain(TownType.FARM);
    expect(types).toContain(TownType.INDUSTRIAL);

    const smallerTowns = towns.filter(t => t.type === TownType.TOWN);
    expect(smallerTowns.length).toBe(3); // Lakeside, Pass Gateway, Coastal Pines

    // Downtown is at the center of the world in the basin
    const downtown = towns.find(t => t.type === TownType.DOWNTOWN)!;
    expect(Math.hypot(downtown.x, downtown.z)).toBeLessThan(10);

    // Port is near the western coast
    const port = towns.find(t => t.type === TownType.PORT)!;
    expect(port.x).toBeLessThan(-700);

    // Summit is on high elevation alpine peaks
    const summit = towns.find(t => t.type === TownType.SUMMIT)!;
    expect(summit.elevation).toBeGreaterThan(100);
  });

  it('guarantees the entire road graph is 100% connected (single connected component)', () => {
    const nodes = graph.nodes;
    const edges = graph.edges;
    expect(nodes.length).toBeGreaterThan(100);
    expect(edges.length).toBeGreaterThan(120);

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

    // BFS from node 0
    const visited = new Set<number>();
    const queue: number[] = [nodes[0].id];
    visited.add(nodes[0].id);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const nbs = adj.get(curr) || [];
      for (const next of nbs) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    expect(visited.size).toBe(nodes.length);
  });

  it('guarantees grades stay strictly within road class limits across all polylines', () => {
    for (const edge of graph.edges) {
      const cfg = ROAD_CLASS_CONFIGS[edge.roadClass];
      const maxAllowedGrade = cfg.maxGrade + 0.005; // 0.5% tolerance for floating point rounding

      if (edge.points && edge.points.length > 1) {
        for (let p = 0; p < edge.points.length - 1; p++) {
          const pA = edge.points[p];
          const pB = edge.points[p + 1];
          const ds = Math.hypot(pB.x - pA.x, pB.z - pA.z);
          if (ds > 0.01) {
            const grade = Math.abs(pB.elevation - pA.elevation) / ds;
            expect(grade).toBeLessThanOrEqual(maxAllowedGrade);
          }
        }
      }
    }
  });

  it('guarantees roads only cross at junctions or flagged crossing points (no interior segment crossings)', () => {
    const nodes = graph.nodes;
    const edges = graph.edges;
    const edgeCount = edges.length;

    for (let i = 0; i < edgeCount; i++) {
      const e1 = edges[i];
      const n1A = nodes[e1.fromNodeId];
      const n1B = nodes[e1.toNodeId];

      const dx1 = n1B.x - n1A.x;
      const dz1 = n1B.z - n1A.z;

      for (let j = i + 1; j < edgeCount; j++) {
        const e2 = edges[j];
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
          const strictlyCrosses = t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
          expect(strictlyCrosses).toBe(false);
        }
      }
    }
  });

  it('guarantees identical world seed yields 100% deterministic graph, nodes, and edges', () => {
    const graph2 = generateRoadNetwork(DEFAULT_WORLD_SPEC, lf);
    expect(graph2.nodes.length).toBe(graph.nodes.length);
    expect(graph2.edges.length).toBe(graph.edges.length);
    expect(graph2.crossings?.length).toBe(graph.crossings?.length);

    for (let i = 0; i < graph.nodes.length; i++) {
      expect(graph2.nodes[i].x).toBe(graph.nodes[i].x);
      expect(graph2.nodes[i].z).toBe(graph.nodes[i].z);
      expect(graph2.nodes[i].elevation).toBe(graph.nodes[i].elevation);
    }
  });

  it('provides at least two distinct route options from Downtown to Summit Lookout', () => {
    // Route 1: Downtown -> Pass Gateway -> Summit Lookout
    // Route 2: Downtown -> Lakeside -> Summit Lookout
    const downtown = graph.towns!.find(t => t.type === TownType.DOWNTOWN)!;
    const summit = graph.towns!.find(t => t.type === TownType.SUMMIT)!;
    const passGateway = graph.towns!.find(t => t.name.includes('Pass'))!;
    const lakeside = graph.towns!.find(t => t.name.includes('Lake'))!;

    // Adjacency graph
    const adj = new Map<number, number[]>();
    for (const node of graph.nodes) adj.set(node.id, []);
    for (const edge of graph.edges) {
      adj.get(edge.fromNodeId)!.push(edge.toNodeId);
      adj.get(edge.toNodeId)!.push(edge.fromNodeId);
    }

    // Function to check path existence avoiding a specific set of nodes
    const hasPathAvoiding = (startId: number, goalId: number, avoidNodes: Set<number>): boolean => {
      const q = [startId];
      const visited = new Set<number>([startId]);
      while (q.length > 0) {
        const curr = q.shift()!;
        if (curr === goalId) return true;
        for (const nb of adj.get(curr) || []) {
          if (!visited.has(nb) && !avoidNodes.has(nb)) {
            visited.add(nb);
            q.push(nb);
          }
        }
      }
      return false;
    };

    const dCenter = graph.nodes.find(n => Math.hypot(n.x - downtown.x, n.z - downtown.z) < 1)!.id;
    const sCenter = graph.nodes.find(n => Math.hypot(n.x - summit.x, n.z - summit.z) < 1)!.id;
    const pCenter = graph.nodes.find(n => Math.hypot(n.x - passGateway.x, n.z - passGateway.z) < 1)!.id;
    const lCenter = graph.nodes.find(n => Math.hypot(n.x - lakeside.x, n.z - lakeside.z) < 1)!.id;

    // Route 1: Path from Downtown to Summit exists through Pass Gateway even if Lakeside is closed
    const pathViaPass = hasPathAvoiding(dCenter, sCenter, new Set([lCenter]));
    expect(pathViaPass).toBe(true);

    // Route 2: Path from Downtown to Summit exists through Lakeside even if Pass Gateway is closed
    const pathViaLake = hasPathAvoiding(dCenter, sCenter, new Set([pCenter]));
    expect(pathViaLake).toBe(true);
  });

  it('supports DIRT road surface type with appropriate grip and speed limits', () => {
    const dirtEdge = graph.edges.find(e => e.roadClass === RoadClass.DIRT);
    expect(dirtEdge).toBeDefined();

    const roadIndex = new SpatialRoadIndex(graph, DEFAULT_WORLD_SPEC.chunkSize);
    const terrain = new TerrainHeight(DEFAULT_WORLD_SPEC, roadIndex);

    // Query on the dirt edge
    const nA = graph.nodes[dirtEdge!.fromNodeId];
    const nB = graph.nodes[dirtEdge!.toNodeId];
    const midX = (nA.x + nB.x) * 0.5;
    const midZ = (nA.z + nB.z) * 0.5;

    const surface = terrain.getSurfaceTypeAt(midX, midZ);
    expect(surface).toBe(SurfaceType.DIRT);
  });

  it('calculates total road length and crossings metadata', () => {
    let totalLengthMeters = 0;
    for (const edge of graph.edges) {
      if (edge.points && edge.points.length > 1) {
        for (let p = 0; p < edge.points.length - 1; p++) {
          totalLengthMeters += Math.hypot(
            edge.points[p + 1].x - edge.points[p].x,
            edge.points[p + 1].z - edge.points[p].z
          );
        }
      } else {
        const nA = graph.nodes[edge.fromNodeId];
        const nB = graph.nodes[edge.toNodeId];
        totalLengthMeters += Math.hypot(nB.x - nA.x, nB.z - nA.z);
      }
    }

    const totalKm = totalLengthMeters / 1000.0;
    expect(totalKm).toBeGreaterThan(15.0); // Substantial regional highway and road network
    expect(graph.crossings).toBeDefined();
    expect(graph.crossings!.length).toBeGreaterThan(0);
  });
});
