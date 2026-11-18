/**
 * src/world/Landmarks.ts
 * ─────────────────────────────────────────────────────────────
 * Deterministic Iconic City Landmarks:
 *   1. The Apex Spire: 220m supertall skyscraper & broadcast needle in Downtown core
 *   2. The Grand Arena: Colosseum-scale circular sports stadium with suspension canopy
 *   3. The Skyway Arch: Monumental gateway suspension arch spanning over the highway
 *
 * RULES.md: Seeded determinism. Solid colliders for chunk BVH.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { SolidBox } from './ChunkCollider';
import type { TerrainHeight } from './TerrainHeight';

export interface LandmarkDef {
  id: string;
  name: string;
  x: number;
  z: number;
  chunkX: number;
  chunkZ: number;
  createMesh(terrainHeight: TerrainHeight): THREE.Group;
  getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[];
}

export function createLandmarkDefs(chunkSize: number): LandmarkDef[] {
  return [
    // ── 1. The Apex Spire (Downtown Supertall Tower) ───────────
    {
      id: 'landmark_apex_spire',
      name: 'Apex Celestial Spire',
      x: 32,
      z: 32,
      chunkX: Math.floor(32 / chunkSize),
      chunkZ: Math.floor(32 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(32, 32);

        // Materials
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          roughness: 0.15,
          metalness: 0.90,
        });
        const darkSteelMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.40,
          metalness: 0.85,
        });
        const beaconMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0xfacc15,
          emissiveIntensity: 1.0,
        });

        // 1. Podium Base (32x32m, 24m high)
        const podium = new THREE.Mesh(new THREE.BoxGeometry(32, 24, 32), darkSteelMat);
        podium.position.set(32, baseH + 12, 32);
        podium.castShadow = true;
        podium.receiveShadow = true;
        group.add(podium);

        // 2. Main Glass Shaft (32x32m, 110m high)
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(32, 110, 32), glassMat);
        shaft.position.set(32, baseH + 24 + 55, 32);
        shaft.castShadow = true;
        shaft.receiveShadow = true;
        group.add(shaft);

        // 3. Upper Stepped Shaft (20x20m, 50m high)
        const upper = new THREE.Mesh(new THREE.BoxGeometry(20, 50, 20), darkSteelMat);
        upper.position.set(32, baseH + 134 + 25, 32);
        upper.castShadow = true;
        upper.receiveShadow = true;
        group.add(upper);

        // 4. Observation Crown & Spire Needle (35m tall needle)
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 3.0, 35, 8), darkSteelMat);
        spire.position.set(32, baseH + 184 + 17.5, 32);
        spire.castShadow = true;
        group.add(spire);

        // 5. Crown Beacon Sphere
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 12), beaconMat);
        beacon.position.set(32, baseH + 220, 32);
        group.add(beacon);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(32, 32);
        return [
          { x: 32, y: baseH + 12, z: 32, width: 32, height: 24, depth: 32 },
          { x: 32, y: baseH + 24 + 55, z: 32, width: 32, height: 110, depth: 32 },
          { x: 32, y: baseH + 134 + 25, z: 32, width: 20, height: 50, depth: 20 },
        ];
      },
    },

    // ── 2. The Grand Arena (Colosseum Stadium) ────────────────
    {
      id: 'landmark_grand_arena',
      name: 'Titan Grand Arena',
      x: -360,
      z: 240,
      chunkX: Math.floor(-360 / chunkSize),
      chunkZ: Math.floor(240 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(-360, 240);

        const concreteMat = new THREE.MeshStandardMaterial({
          color: 0xc4cbd5,
          roughness: 0.82,
          metalness: 0.12,
        });
        const bowlMat = new THREE.MeshStandardMaterial({
          color: 0x1e3a5f,
          roughness: 0.60,
          metalness: 0.30,
        });
        const roofMat = new THREE.MeshStandardMaterial({
          color: 0x475569,
          roughness: 0.40,
          metalness: 0.70,
        });

        // 1. Stadium Outer Ring (Radius 56m, height 22m, 16-sided cylinder tube)
        const outerWall = new THREE.Mesh(
          new THREE.CylinderGeometry(56, 56, 22, 16, 1, true),
          concreteMat
        );
        outerWall.position.set(-360, baseH + 11, 240);
        outerWall.castShadow = true;
        outerWall.receiveShadow = true;
        group.add(outerWall);

        // 2. Interior Seating Bowl
        const bowl = new THREE.Mesh(
          new THREE.ConeGeometry(48, 12, 16, 1, true),
          bowlMat
        );
        bowl.rotation.x = Math.PI; // inverted cone for grandstands
        bowl.position.set(-360, baseH + 6, 240);
        bowl.receiveShadow = true;
        group.add(bowl);

        // 3. Tension-Ring Roof Canopy (spans over grandstands with center hole)
        const roof = new THREE.Mesh(
          new THREE.TorusGeometry(46, 7, 6, 16),
          roofMat
        );
        roof.rotation.x = Math.PI / 2;
        roof.position.set(-360, baseH + 22, 240);
        roof.castShadow = true;
        group.add(roof);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(-360, 240);
        // 4 perimeter collision bounding boxes covering the outer concourse walls
        return [
          { x: -360 + 46, y: baseH + 11, z: 240, width: 20, height: 22, depth: 40 },
          { x: -360 - 46, y: baseH + 11, z: 240, width: 20, height: 22, depth: 40 },
          { x: -360, y: baseH + 11, z: 240 + 46, width: 40, height: 22, depth: 20 },
          { x: -360, y: baseH + 11, z: 240 - 46, width: 40, height: 22, depth: 20 },
        ];
      },
    },

    // ── 3. The Skyway Gateway Arch (Highway Bridge Arch) ───────
    {
      id: 'landmark_skyway_arch',
      name: 'Skyway Gateway Arch',
      x: 440,
      z: 440,
      chunkX: Math.floor(440 / chunkSize),
      chunkZ: Math.floor(440 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(440, 440);

        // Highway passes along diagonal (+X, +Z)
        // Pylons are placed perpendicular to diagonal (-perpX, -perpZ) and (+perpX, +perpZ)
        // Highway width is 22m, halfWidth is 11m. Pylons at lateral offset +/-16m
        const pylonOffset = 16.0;
        const normPerpX = -0.7071;
        const normPerpZ = 0.7071;

        const steelMat = new THREE.MeshStandardMaterial({
          color: 0xd97706, // Iconic golden gate orange-amber
          roughness: 0.35,
          metalness: 0.80,
        });

        // Left Pylon
        const p1X = 440 - normPerpX * pylonOffset;
        const p1Z = 440 - normPerpZ * pylonOffset;
        const p1 = new THREE.Mesh(new THREE.BoxGeometry(4.5, 36, 4.5), steelMat);
        p1.position.set(p1X, baseH + 18, p1Z);
        p1.castShadow = true;
        group.add(p1);

        // Right Pylon
        const p2X = 440 + normPerpX * pylonOffset;
        const p2Z = 440 + normPerpZ * pylonOffset;
        const p2 = new THREE.Mesh(new THREE.BoxGeometry(4.5, 36, 4.5), steelMat);
        p2.position.set(p2X, baseH + 18, p2Z);
        p2.castShadow = true;
        group.add(p2);

        // High Arch Crossbeam spanning across the highway
        const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(36, 3.5, 3.5), steelMat);
        // Rotate crossbeam perpendicular to highway
        crossBeam.rotation.y = -Math.PI * 0.25;
        crossBeam.position.set(440, baseH + 34, 440);
        crossBeam.castShadow = true;
        group.add(crossBeam);

        // Suspension Cables dropping towards highway guardrails
        const cableMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let i = -3; i <= 3; i++) {
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 28, 4), cableMat);
          const t = i / 3;
          cable.position.set(
            440 + normPerpX * (t * 12),
            baseH + 20,
            440 + normPerpZ * (t * 12)
          );
          group.add(cable);
        }

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(440, 440);
        const pylonOffset = 16.0;
        const normPerpX = -0.7071;
        const normPerpZ = 0.7071;

        return [
          {
            x: 440 - normPerpX * pylonOffset,
            y: baseH + 18,
            z: 440 - normPerpZ * pylonOffset,
            width: 5,
            height: 36,
            depth: 5,
          },
          {
            x: 440 + normPerpX * pylonOffset,
            y: baseH + 18,
            z: 440 + normPerpZ * pylonOffset,
            width: 5,
            height: 36,
            depth: 5,
          },
        ];
      },
    },
  ];
}
