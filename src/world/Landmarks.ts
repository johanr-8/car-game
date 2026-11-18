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

    // ── 4. Velocity Multi-Story Drift & Launch Garage ─────────
    {
      id: 'landmark_drift_garage',
      name: 'Velocity Spiral Parking Garage',
      x: -96,
      z: 32,
      chunkX: Math.floor(-96 / chunkSize),
      chunkZ: Math.floor(32 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(-96, 32);

        const concreteMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.85,
          metalness: 0.15,
        });
        const darkDeckMat = new THREE.MeshStandardMaterial({
          color: 0x334155,
          roughness: 0.90,
          metalness: 0.10,
        });
        const yellowRampMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          roughness: 0.40,
          metalness: 0.50,
        });
        const redAccentMat = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          roughness: 0.50,
          metalness: 0.30,
        });

        // 1. Concrete Decks: Ground, Level 1 (5.5m), Rooftop (11.0m)
        const groundDeck = new THREE.Mesh(new THREE.BoxGeometry(42, 0.4, 42), darkDeckMat);
        groundDeck.position.set(-96, baseH + 0.2, 32);
        groundDeck.receiveShadow = true;
        group.add(groundDeck);

        const l1Deck = new THREE.Mesh(new THREE.BoxGeometry(42, 0.6, 42), darkDeckMat);
        l1Deck.position.set(-96, baseH + 5.5, 32);
        l1Deck.castShadow = true;
        l1Deck.receiveShadow = true;
        group.add(l1Deck);

        const roofDeck = new THREE.Mesh(new THREE.BoxGeometry(42, 0.6, 42), darkDeckMat);
        roofDeck.position.set(-96, baseH + 11.0, 32);
        roofDeck.castShadow = true;
        roofDeck.receiveShadow = true;
        group.add(roofDeck);

        // 2. Structural Concrete Columns (12 perimeter and interior columns)
        for (let ix = -16; ix <= 16; ix += 16) {
          for (let iz = -16; iz <= 16; iz += 16) {
            const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, 11.0, 1.4), concreteMat);
            col.position.set(-96 + ix, baseH + 5.5, 32 + iz);
            col.castShadow = true;
            group.add(col);
          }
        }

        // 3. Exterior Drivable Ramps
        // Ramp 1 (Ground to Level 1, along East side, length 36m, rise 5.5m)
        const ramp1 = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.4, 36), concreteMat);
        ramp1.rotation.x = -0.153;
        ramp1.position.set(-96 + 16, baseH + 2.75, 32);
        ramp1.castShadow = true;
        ramp1.receiveShadow = true;
        group.add(ramp1);

        // Ramp 2 (Level 1 to Rooftop, along West side, length 36m, rise 5.5m)
        const ramp2 = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.4, 36), concreteMat);
        ramp2.rotation.x = 0.153;
        ramp2.position.set(-96 - 16, baseH + 8.25, 32);
        ramp2.castShadow = true;
        ramp2.receiveShadow = true;
        group.add(ramp2);

        // 4. Rooftop Stunt Kicker Ramp (South-facing launch ramp toward avenue)
        const kicker = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.5, 10), yellowRampMat);
        kicker.rotation.x = -0.22;
        kicker.position.set(-96, baseH + 12.1, 32 - 12);
        kicker.castShadow = true;
        kicker.receiveShadow = true;
        group.add(kicker);

        // 5. Rooftop Perimeter Crash Parapet Walls with open stunt gap
        const northWall = new THREE.Mesh(new THREE.BoxGeometry(42, 1.2, 0.6), redAccentMat);
        northWall.position.set(-96, baseH + 11.9, 32 + 20.7);
        group.add(northWall);

        const eastWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 42), redAccentMat);
        eastWall.position.set(-96 + 20.7, baseH + 11.9, 32);
        group.add(eastWall);

        const westWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 42), redAccentMat);
        westWall.position.set(-96 - 20.7, baseH + 11.9, 32);
        group.add(westWall);

        // South wall wings (leaves 10m center gap for the kicker ramp)
        const southLeft = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.2, 0.6), redAccentMat);
        southLeft.position.set(-96 - 13.0, baseH + 11.9, 32 - 20.7);
        group.add(southLeft);

        const southRight = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.2, 0.6), redAccentMat);
        southRight.position.set(-96 + 13.0, baseH + 11.9, 32 - 20.7);
        group.add(southRight);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(-96, 32);
        return [
          // Elevated deck slabs
          { x: -96, y: baseH + 5.5, z: 32, width: 42, height: 0.6, depth: 42 },
          { x: -96, y: baseH + 11.0, z: 32, width: 42, height: 0.6, depth: 42 },
          // Drivable ramps
          { x: -96 + 16, y: baseH + 2.75, z: 32, width: 7.5, height: 0.5, depth: 36, rotationX: -0.153 },
          { x: -96 - 16, y: baseH + 8.25, z: 32, width: 7.5, height: 0.5, depth: 36, rotationX: 0.153 },
          // Rooftop stunt kicker ramp
          { x: -96, y: baseH + 12.1, z: 20, width: 8.0, height: 0.6, depth: 10, rotationX: -0.22 },
          // Exterior crash barrier parapets
          { x: -96, y: baseH + 11.9, z: 52.7, width: 42, height: 1.2, depth: 0.8 },
          { x: -75.3, y: baseH + 11.9, z: 32, width: 0.8, height: 1.2, depth: 42 },
          { x: -116.7, y: baseH + 11.9, z: 32, width: 0.8, height: 1.2, depth: 42 },
          { x: -109.0, y: baseH + 11.9, z: 11.3, width: 16, height: 1.2, depth: 0.8 },
          { x: -83.0, y: baseH + 11.9, z: 11.3, width: 16, height: 1.2, depth: 0.8 },
        ];
      },
    },

    // ── 5. Arroyo Concrete Stormwater Canal Basin ─────────────
    {
      id: 'landmark_storm_canal',
      name: 'Arroyo Concrete Floodway & Banked Wall-Ride',
      x: -224,
      z: -96,
      chunkX: Math.floor(-224 / chunkSize),
      chunkZ: Math.floor(-96 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(-224, -96);

        const channelMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.88,
          metalness: 0.10,
        });
        const bridgeMat = new THREE.MeshStandardMaterial({
          color: 0x475569,
          roughness: 0.50,
          metalness: 0.60,
        });

        // 1. Sunken Channel Bed: 100m long (X), 14m wide (Z), 4.5m below grade
        const bed = new THREE.Mesh(new THREE.BoxGeometry(100, 0.6, 14), channelMat);
        bed.position.set(-224, baseH - 4.5, -96);
        bed.receiveShadow = true;
        group.add(bed);

        // 2. Banked 45° Concrete Wall Slopes (surfable at speed)
        // South Bank
        const southBank = new THREE.Mesh(new THREE.BoxGeometry(100, 0.5, 6.5), channelMat);
        southBank.rotation.x = 0.785;
        southBank.position.set(-224, baseH - 2.25, -96 - 9.2);
        southBank.receiveShadow = true;
        group.add(southBank);

        // North Bank
        const northBank = new THREE.Mesh(new THREE.BoxGeometry(100, 0.5, 6.5), channelMat);
        northBank.rotation.x = -0.785;
        northBank.position.set(-224, baseH - 2.25, -96 + 9.2);
        northBank.receiveShadow = true;
        group.add(northBank);

        // 3. East & West Incline Entrance Ramps (24m long, transitions from ground to canal bed)
        const eastRamp = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 14), channelMat);
        eastRamp.rotation.z = -0.185;
        eastRamp.position.set(-224 + 58, baseH - 2.25, -96);
        eastRamp.receiveShadow = true;
        group.add(eastRamp);

        const westRamp = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 14), channelMat);
        westRamp.rotation.z = 0.185;
        westRamp.position.set(-224 - 58, baseH - 2.25, -96);
        westRamp.receiveShadow = true;
        group.add(westRamp);

        // 4. City Avenue Cross-Bridge spanning over the canal at x = -224
        const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 32), bridgeMat);
        bridgeDeck.position.set(-224, baseH + 0.6, -96);
        bridgeDeck.castShadow = true;
        bridgeDeck.receiveShadow = true;
        group.add(bridgeDeck);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(-224, -96);
        return [
          // Channel floor bed
          { x: -224, y: baseH - 4.5, z: -96, width: 100, height: 0.6, depth: 14 },
          // Banked wall slopes
          { x: -224, y: baseH - 2.25, z: -105.2, width: 100, height: 0.5, depth: 6.5, rotationX: 0.785 },
          { x: -224, y: baseH - 2.25, z: -86.8, width: 100, height: 0.5, depth: 6.5, rotationX: -0.785 },
          // Entrance and exit ramps
          { x: -166, y: baseH - 2.25, z: -96, width: 24, height: 0.5, depth: 14, rotationZ: -0.185 },
          { x: -282, y: baseH - 2.25, z: -96, width: 24, height: 0.5, depth: 14, rotationZ: 0.185 },
          // Overhead bridge deck
          { x: -224, y: baseH + 0.6, z: -96, width: 14, height: 1.2, depth: 32 },
        ];
      },
    },

    // ── 6. Forge Freight Container Maze & Drift Yard ──────────
    {
      id: 'landmark_forge_skidpad',
      name: 'Forge Freight Container Drift Yard',
      x: -360,
      z: 360,
      chunkX: Math.floor(-360 / chunkSize),
      chunkZ: Math.floor(360 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(-360, 360);

        // Materials
        const asphaltMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.92,
          metalness: 0.08,
        });
        const blueContainerMat = new THREE.MeshStandardMaterial({
          color: 0x0284c7,
          roughness: 0.45,
          metalness: 0.70,
        });
        const orangeContainerMat = new THREE.MeshStandardMaterial({
          color: 0xea580c,
          roughness: 0.45,
          metalness: 0.70,
        });
        const yellowContainerMat = new THREE.MeshStandardMaterial({
          color: 0xeab308,
          roughness: 0.45,
          metalness: 0.70,
        });
        const dockMat = new THREE.MeshStandardMaterial({
          color: 0x64748b,
          roughness: 0.75,
          metalness: 0.25,
        });

        // 1. Heavy Asphalt Skidpad Slab (80m x 80m)
        const slab = new THREE.Mesh(new THREE.BoxGeometry(80, 0.4, 80), asphaltMat);
        slab.position.set(-360, baseH + 0.2, 360);
        slab.receiveShadow = true;
        group.add(slab);

        // 2. Painted Circular Drift Donut Markings
        const donut = new THREE.Mesh(
          new THREE.RingGeometry(10.0, 12.5, 24),
          new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
        );
        donut.rotation.x = -Math.PI * 0.5;
        donut.position.set(-360, baseH + 0.42, 360);
        group.add(donut);

        // 3. Shipping Container Stacks (Chicane & Alley Layout)
        const containerLayouts = [
          // East Chicane Stack (Blue)
          { x: -360 + 22, z: 360 - 15, h: 2, mat: blueContainerMat, rotY: 0 },
          { x: -360 + 22, z: 360 - 2, h: 2, mat: orangeContainerMat, rotY: 0 },
          { x: -360 + 22, z: 360 + 11, h: 1, mat: yellowContainerMat, rotY: 0 },
          // West Slalom Stack (Orange & Yellow)
          { x: -360 - 20, z: 360 - 18, h: 2, mat: orangeContainerMat, rotY: 0.2 },
          { x: -360 - 20, z: 360 - 5, h: 1, mat: blueContainerMat, rotY: 0.2 },
          { x: -360 - 20, z: 360 + 8, h: 2, mat: yellowContainerMat, rotY: 0.2 },
          // North Barrier Wall
          { x: -360 - 10, z: 360 + 26, h: 2, mat: blueContainerMat, rotY: Math.PI * 0.5 },
          { x: -360 + 4, z: 360 + 26, h: 2, mat: orangeContainerMat, rotY: Math.PI * 0.5 },
        ];

        for (const c of containerLayouts) {
          for (let tier = 0; tier < c.h; tier++) {
            const box = new THREE.Mesh(new THREE.BoxGeometry(6.0, 2.6, 12.0), c.mat);
            box.rotation.y = c.rotY;
            box.position.set(c.x, baseH + 0.4 + 1.3 + tier * 2.6, c.z);
            box.castShadow = true;
            box.receiveShadow = true;
            group.add(box);
          }
        }

        // 4. Concrete Loading Dock & Launch Ramp
        const dock = new THREE.Mesh(new THREE.BoxGeometry(18.0, 1.4, 10.0), dockMat);
        dock.position.set(-360 - 25, baseH + 0.7, 360 - 25);
        dock.castShadow = true;
        dock.receiveShadow = true;
        group.add(dock);

        const dockRamp = new THREE.Mesh(new THREE.BoxGeometry(18.0, 0.4, 8.0), yellowContainerMat);
        dockRamp.rotation.x = -0.175;
        dockRamp.position.set(-360 - 25, baseH + 0.7, 360 - 34);
        dockRamp.castShadow = true;
        dockRamp.receiveShadow = true;
        group.add(dockRamp);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(-360, 360);
        return [
          { x: -360, y: baseH + 0.2, z: 360, width: 80, height: 0.4, depth: 80 },
          // Container colliders
          { x: -360 + 22, y: baseH + 3.0, z: 360 - 15, width: 6.0, height: 5.2, depth: 12.0 },
          { x: -360 + 22, y: baseH + 3.0, z: 360 - 2, width: 6.0, height: 5.2, depth: 12.0 },
          { x: -360 + 22, y: baseH + 1.7, z: 360 + 11, width: 6.0, height: 2.6, depth: 12.0 },
          { x: -360 - 20, y: baseH + 3.0, z: 360 - 18, width: 6.0, height: 5.2, depth: 12.0, rotationY: 0.2 },
          { x: -360 - 20, y: baseH + 1.7, z: 360 - 5, width: 6.0, height: 2.6, depth: 12.0, rotationY: 0.2 },
          { x: -360 - 20, y: baseH + 3.0, z: 360 + 8, width: 6.0, height: 5.2, depth: 12.0, rotationY: 0.2 },
          { x: -360 - 10, y: baseH + 3.0, z: 360 + 26, width: 12.0, height: 5.2, depth: 6.0 },
          { x: -360 + 4, y: baseH + 3.0, z: 360 + 26, width: 12.0, height: 5.2, depth: 6.0 },
          // Loading dock & ramp
          { x: -385, y: baseH + 0.7, z: 335, width: 18.0, height: 1.4, depth: 10.0 },
          { x: -385, y: baseH + 0.7, z: 326, width: 18.0, height: 0.5, depth: 8.0, rotationX: -0.175 },
        ];
      },
    },

    // ── 7. Eagle Peak Summit Observatory & Cliffside Promenade ─
    {
      id: 'landmark_eagle_observatory',
      name: 'Eagle Peak Alpine Radio Observatory',
      x: 680,
      z: 680,
      chunkX: Math.floor(680 / chunkSize),
      chunkZ: Math.floor(680 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(680, 680);

        const rotundaMat = new THREE.MeshStandardMaterial({
          color: 0xe2e8f0,
          roughness: 0.80,
          metalness: 0.20,
        });
        const domeMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.18,
          metalness: 0.90,
        });
        const mastMat = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          roughness: 0.40,
          metalness: 0.70,
        });
        const beaconMat = new THREE.MeshStandardMaterial({
          color: 0xff0000,
          emissive: 0xff0000,
          emissiveIntensity: 1.2,
        });

        // 1. Concrete Octagonal Observatory Base
        const rotunda = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 10, 8), rotundaMat);
        rotunda.position.set(680, baseH + 5.0, 680);
        rotunda.castShadow = true;
        rotunda.receiveShadow = true;
        group.add(rotunda);

        // 2. Geodesic Telescope Silver Dome
        const dome = new THREE.Mesh(new THREE.SphereGeometry(8.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), domeMat);
        dome.position.set(680, baseH + 10.0, 680);
        dome.castShadow = true;
        group.add(dome);

        // 3. Steel Broadcast Tower Mast (40m height) with flashing red beacon
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.8, 38, 6), mastMat);
        mast.position.set(680 - 15, baseH + 19, 680 - 15);
        mast.castShadow = true;
        group.add(mast);

        const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), beaconMat);
        beacon.position.set(680 - 15, baseH + 38, 680 - 15);
        group.add(beacon);

        // 4. Cantilevered Cliffside Viewing Deck (extends out over the valley)
        const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 16), rotundaMat);
        deck.position.set(680 + 15, baseH + 3.0, 680 + 12);
        deck.castShadow = true;
        deck.receiveShadow = true;
        group.add(deck);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(680, 680);
        return [
          { x: 680, y: baseH + 5.0, z: 680, width: 22, height: 10, depth: 22 },
          { x: 665, y: baseH + 19.0, z: 665, width: 3, height: 38, depth: 3 },
          { x: 695, y: baseH + 3.0, z: 692, width: 22, height: 0.8, depth: 16 },
        ];
      },
    },

    // ── 8. Ocean Gate Suspension Bay Bridge ────────────────────
    {
      id: 'landmark_bay_bridge',
      name: 'Ocean Gate Suspension Bridge Pylons',
      x: -560,
      z: -140,
      chunkX: Math.floor(-560 / chunkSize),
      chunkZ: Math.floor(-140 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(-560, -140);

        const concreteMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.70,
          metalness: 0.20,
        });
        const steelCableMat = new THREE.MeshStandardMaterial({
          color: 0x334155,
          roughness: 0.35,
          metalness: 0.85,
        });

        // Twin Suspension Towers flanking the highway deck (width 22m, lateral offset +/-14m)
        const towerHeight = 44.0;
        const tower1 = new THREE.Mesh(new THREE.BoxGeometry(3.5, towerHeight, 3.5), concreteMat);
        tower1.position.set(-560, baseH + towerHeight * 0.5, -140 - 14);
        tower1.castShadow = true;
        group.add(tower1);

        const tower2 = new THREE.Mesh(new THREE.BoxGeometry(3.5, towerHeight, 3.5), concreteMat);
        tower2.position.set(-560, baseH + towerHeight * 0.5, -140 + 14);
        tower2.castShadow = true;
        group.add(tower2);

        // Tower Top Crossbeam
        const topBeam = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.0, 31.5), concreteMat);
        topBeam.position.set(-560, baseH + towerHeight - 1.5, -140);
        topBeam.castShadow = true;
        group.add(topBeam);

        // Marine Foundations (Caissons anchored into water)
        const caisson1 = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 6.0, 12, 12), concreteMat);
        caisson1.position.set(-560, baseH - 4.0, -140 - 14);
        group.add(caisson1);

        const caisson2 = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 6.0, 12, 12), concreteMat);
        caisson2.position.set(-560, baseH - 4.0, -140 + 14);
        group.add(caisson2);

        // Sweeping Parabolic Suspension Cables
        for (let side = -1; side <= 1; side += 2) {
          const zOffset = side * 14;
          for (let seg = -4; seg <= 4; seg++) {
            const t = seg / 4;
            const xPos = -560 + t * 40;
            const yPos = baseH + 3.0 + (1 - Math.abs(t)) * (towerHeight - 4.0);
            const dropCable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 16, 4), steelCableMat);
            dropCable.position.set(xPos, yPos * 0.5, -140 + zOffset);
            group.add(dropCable);
          }
        }

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(-560, -140);
        return [
          { x: -560, y: baseH + 22.0, z: -154, width: 4.5, height: 44, depth: 4.5 },
          { x: -560, y: baseH + 22.0, z: -126, width: 4.5, height: 44, depth: 4.5 },
          { x: -560, y: baseH - 4.0, z: -154, width: 10, height: 12, depth: 10 },
          { x: -560, y: baseH - 4.0, z: -126, width: 10, height: 12, depth: 10 },
        ];
      },
    },

    // ── 9. Metropolis Express Viaduct Flyover & Underpass ─────
    {
      id: 'landmark_skyway_flyover',
      name: 'Metropolis Express Viaduct Flyover',
      x: 160,
      z: 160,
      chunkX: Math.floor(160 / chunkSize),
      chunkZ: Math.floor(160 / chunkSize),

      createMesh(terrainHeight: TerrainHeight): THREE.Group {
        const group = new THREE.Group();
        const baseH = terrainHeight.groundHeightAt(160, 160);

        const concreteMat = new THREE.MeshStandardMaterial({
          color: 0x64748b,
          roughness: 0.85,
          metalness: 0.15,
        });
        const asphaltMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.80,
          metalness: 0.10,
        });
        const barrierMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.60,
          metalness: 0.20,
        });
        const cautionMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          roughness: 0.40,
          metalness: 0.50,
        });

        // 1. Elevated Highway Deck (96m long along Z, 14m wide along X, at elevation +8.5m)
        const flyoverElevation = baseH + 8.5;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(14.0, 1.2, 96.0), asphaltMat);
        deck.position.set(160, flyoverElevation, 160);
        deck.castShadow = true;
        deck.receiveShadow = true;
        group.add(deck);

        // 2. Concrete New Jersey Safety Crash Barriers along deck edges
        for (const side of [-1, 1]) {
          const xPos = 160 + side * 6.8;
          const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 96.0), barrierMat);
          barrier.position.set(xPos, flyoverElevation + 1.0, 160);
          barrier.castShadow = true;
          group.add(barrier);
        }

        // 3. Concrete Support Portal Bents (underpass clearance)
        for (const zOffset of [-24, 24]) {
          const zPos = 160 + zOffset;
          // Left column
          const colL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 8.5, 1.8), concreteMat);
          colL.position.set(160 - 5.5, baseH + 4.25, zPos);
          colL.castShadow = true;
          group.add(colL);

          // Right column
          const colR = new THREE.Mesh(new THREE.BoxGeometry(1.8, 8.5, 1.8), concreteMat);
          colR.position.set(160 + 5.5, baseH + 4.25, zPos);
          colR.castShadow = true;
          group.add(colR);

          // Crosshead cap beam
          const crosshead = new THREE.Mesh(new THREE.BoxGeometry(14.0, 1.4, 2.2), concreteMat);
          crosshead.position.set(160, flyoverElevation - 0.7, zPos);
          crosshead.castShadow = true;
          group.add(crosshead);

          // Caution clearance stripe
          const warnBand = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.35, 2.25), cautionMat);
          warnBand.position.set(160, flyoverElevation - 1.2, zPos);
          group.add(warnBand);
        }

        // 4. North & South Approach Ramps (slope connecting ground to flyover deck)
        const rampLen = 32.0;
        const rampAngle = Math.atan2(8.5, rampLen);

        const rampN = new THREE.Mesh(new THREE.BoxGeometry(14.0, 1.0, rampLen), asphaltMat);
        rampN.rotation.x = -rampAngle;
        rampN.position.set(160, baseH + 4.25, 160 - 48 - rampLen * 0.5);
        rampN.castShadow = true;
        rampN.receiveShadow = true;
        group.add(rampN);

        const rampS = new THREE.Mesh(new THREE.BoxGeometry(14.0, 1.0, rampLen), asphaltMat);
        rampS.rotation.x = rampAngle;
        rampS.position.set(160, baseH + 4.25, 160 + 48 + rampLen * 0.5);
        rampS.castShadow = true;
        rampS.receiveShadow = true;
        group.add(rampS);

        return group;
      },

      getSolidBoxes(terrainHeight: TerrainHeight): SolidBox[] {
        const baseH = terrainHeight.groundHeightAt(160, 160);
        const flyoverElevation = baseH + 8.5;
        const rampLen = 32.0;
        const rampAngle = Math.atan2(8.5, rampLen);

        return [
          // Main elevated viaduct deck
          { x: 160, y: flyoverElevation, z: 160, width: 14.0, height: 1.2, depth: 96.0 },

          // Concrete Barriers
          { x: 160 - 6.8, y: flyoverElevation + 1.0, z: 160, width: 0.5, height: 0.9, depth: 96.0 },
          { x: 160 + 6.8, y: flyoverElevation + 1.0, z: 160, width: 0.5, height: 0.9, depth: 96.0 },

          // Support Pier Columns
          { x: 160 - 5.5, y: baseH + 4.25, z: 136, width: 1.8, height: 8.5, depth: 1.8 },
          { x: 160 + 5.5, y: baseH + 4.25, z: 136, width: 1.8, height: 8.5, depth: 1.8 },
          { x: 160 - 5.5, y: baseH + 4.25, z: 184, width: 1.8, height: 8.5, depth: 1.8 },
          { x: 160 + 5.5, y: baseH + 4.25, z: 184, width: 1.8, height: 8.5, depth: 1.8 },

          // Approach Ramps
          { x: 160, y: baseH + 4.25, z: 160 - 48 - rampLen * 0.5, width: 14.0, height: 1.0, depth: rampLen, rotationX: -rampAngle },
          { x: 160, y: baseH + 4.25, z: 160 + 48 + rampLen * 0.5, width: 14.0, height: 1.0, depth: rampLen, rotationX: rampAngle },
        ];
      },
    },
  ];
}
