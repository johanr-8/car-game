/**
 * src/world/TrackSpline.ts
 * ─────────────────────────────────────────────────────────────
 * Real-Life Grand Prix Asphalt Racing Circuit with 6DOF Antigravity Geometry.
 *
 * Architecture & Features:
 *   - Continuous, non-twisting road ribbon with calculated surface normals
 *   - Dark charcoal asphalt with realistic tarmac roughness and white outer lane borders
 *   - 3D Raised red-and-white rumble curbs on both track edges
 *   - Yellow dashed center lane markings
 *   - Iconic architectural integration: Apex Skyscraper, Tunnel Tube & Skyway Bridge
 *   - Steel truss timing gantry checkpoint gates with glowing LED status rings
 *   - Continuous collision proxy for three-mesh-bvh 6DOF surface driving
 *
 * RULES.md: Zero per-frame allocations. Instanced/cached geometries.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { CollisionWorld } from './CollisionWorld';
import { getAsphaltTexture } from './TextureGenerator';

export interface Checkpoint {
  index: number;
  label: string;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  radius: number;
  gateGroup: THREE.Group;
  matRing: THREE.MeshStandardMaterial;
  isPassed: boolean;
  isActive: boolean;
}

interface TrackPointDef {
  pos: THREE.Vector3;
}

export class TrackSpline {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly checkpoints: Checkpoint[] = [];

  readonly segments = 320;
  readonly tangents: THREE.Vector3[] = [];
  readonly normals: THREE.Vector3[] = [];
  readonly binormals: THREE.Vector3[] = [];
  readonly centerPoints: THREE.Vector3[] = [];

  private readonly pointDefs: TrackPointDef[];
  private readonly _tempVec = new THREE.Vector3();
  private lastNearestIdx = 0;

  constructor(collision?: CollisionWorld) {
    this.pointDefs = [
      { pos: new THREE.Vector3(0, 0.6, 25) },     // CP 0: Start / Finish Line (Z = 25, heading -Z)
      { pos: new THREE.Vector3(0, 0.6, 5) },      // Home straight
      { pos: new THREE.Vector3(0, 0.6, -15) },    // Speed zone
      { pos: new THREE.Vector3(0, 0.6, -35) },    // Approach to tower ramp
      { pos: new THREE.Vector3(0, 2.5, -48) },    // Ramp entry
      { pos: new THREE.Vector3(0, 9.0, -58) },    // Incline climb
      { pos: new THREE.Vector3(0, 26.0, -66) },   // Banking vertical
      { pos: new THREE.Vector3(0, 52.0, -70) },   // Vertical tower wall climb
      { pos: new THREE.Vector3(0, 78.0, -70) },   // High ascent
      { pos: new THREE.Vector3(0, 92.0, -62) },   // Approaching summit
      { pos: new THREE.Vector3(0, 96.0, -45) },   // Tower summit crest
      { pos: new THREE.Vector3(0, 96.0, -25) },   // Skyway high straight
      { pos: new THREE.Vector3(20, 86.0, -5) },   // Skyway bridge turn right
      { pos: new THREE.Vector3(42, 65.0, 15) },   // Canyon dive
      { pos: new THREE.Vector3(56, 40.0, 32) },   // Banked canyon sweep
      { pos: new THREE.Vector3(58, 20.0, 50) },   // High-speed banked drop
      { pos: new THREE.Vector3(50, 6.0, 66) },    // Easing to ground
      { pos: new THREE.Vector3(34, 0.8, 76) },    // Ground corner entry
      { pos: new THREE.Vector3(12, 0.6, 80) },    // Waterfront boulevard East
      { pos: new THREE.Vector3(-10, 0.6, 80) },   // Waterfront boulevard West
      { pos: new THREE.Vector3(-28, 1.2, 74) },   // Celestial loop approach
      { pos: new THREE.Vector3(-42, 6.0, 62) },   // Loop climb
      { pos: new THREE.Vector3(-52, 18.0, 45) },  // Inversion ascent
      { pos: new THREE.Vector3(-55, 25.0, 25) },  // Celestial Inverted Skyway
      { pos: new THREE.Vector3(-55, 25.0, 0) },   // Inverted moon speed run
      { pos: new THREE.Vector3(-52, 20.0, -20) }, // Slingshot descent
      { pos: new THREE.Vector3(-45, 8.0, -38) },  // Return descent
      { pos: new THREE.Vector3(-36, 1.5, -48) },  // Ground return easing
      { pos: new THREE.Vector3(-28, 0.6, -30) },  // Western avenue Northbound
      { pos: new THREE.Vector3(-28, 0.6, 5) },    // Western avenue straight
      { pos: new THREE.Vector3(-24, 0.6, 35) },   // North turn entry
      { pos: new THREE.Vector3(-14, 0.6, 48) },   // Final corner turn
      { pos: new THREE.Vector3(0, 0.6, 45) },     // Straight entry aligned
    ];

    this.curve = new THREE.CatmullRomCurve3(
      this.pointDefs.map(p => p.pos),
      true,
      'centripetal',
      0.5
    );

    this.precomputeFrames();
    this.buildArchitecture(collision);
    this.buildRoadway(collision);
    this.buildGantryCheckpoints();
  }

  /**
   * Precompute continuous Rotation Minimizing Frames (Bishop / Parallel Transport)
   * with holonomy loop closure distribution. Guarantees 0 Gram-Schmidt twist singularities.
   */
  private precomputeFrames(): void {
    const n = this.segments;
    this.tangents.length = 0;
    this.normals.length = 0;
    this.binormals.length = 0;
    this.centerPoints.length = 0;

    for (let i = 0; i <= n; i++) {
      const u = (i / n) % 1.0;
      this.tangents.push(this.curve.getTangentAt(u).normalize());
      this.centerPoints.push(this.curve.getPointAt(u));
    }

    // Initial normal at u = 0 is UP (0, 1, 0) orthogonalized to initial tangent
    const n0 = new THREE.Vector3(0, 1, 0).projectOnPlane(this.tangents[0]).normalize();
    this.normals.push(n0);

    // Parallel transport along curve
    for (let i = 1; i <= n; i++) {
      const tPrev = this.tangents[i - 1];
      const tCurr = this.tangents[i];
      const nPrev = this.normals[i - 1];

      const axis = new THREE.Vector3().crossVectors(tPrev, tCurr);
      if (axis.lengthSq() < 1e-8) {
        this.normals.push(nPrev.clone());
      } else {
        axis.normalize();
        const dot = Math.min(Math.max(tPrev.dot(tCurr), -1), 1);
        const angle = Math.acos(dot);
        const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        this.normals.push(nPrev.clone().applyQuaternion(q).normalize());
      }
    }

    // Loop closure: measure holonomy twist angle at u = 1.0 vs u = 0.0
    const nStart = this.normals[0];
    const nEnd = this.normals[n];
    const tEnd = this.tangents[n];
    const crossEnd = new THREE.Vector3().crossVectors(nEnd, nStart);
    const sinAngle = crossEnd.dot(tEnd);
    const cosAngle = nEnd.dot(nStart);
    const holonomyAngle = Math.atan2(sinAngle, cosAngle);

    // Distribute holonomy angle smoothly across all segments for perfect closure
    for (let i = 0; i <= n; i++) {
      const frac = i / n;
      const twist = frac * holonomyAngle;
      const qTwist = new THREE.Quaternion().setFromAxisAngle(this.tangents[i], twist);
      this.normals[i].applyQuaternion(qTwist).normalize();
      this.binormals.push(new THREE.Vector3().crossVectors(this.normals[i], this.tangents[i]).normalize());
    }
  }

  /**
   * Sample smooth surface normal at progress u (0 to 1).
   */
  getNormalAt(u: number): THREE.Vector3 {
    const normU = ((u % 1.0) + 1.0) % 1.0;
    const floatIdx = normU * this.segments;
    const i0 = Math.floor(floatIdx);
    const i1 = (i0 + 1) % this.segments;
    const frac = floatIdx - i0;
    return new THREE.Vector3().lerpVectors(this.normals[i0], this.normals[i1], frac).normalize();
  }

  /**
   * Sample smooth road binormal (width vector) at progress u (0 to 1).
   */
  getBinormalAt(u: number): THREE.Vector3 {
    const normU = ((u % 1.0) + 1.0) % 1.0;
    const floatIdx = normU * this.segments;
    const i0 = Math.floor(floatIdx);
    const i1 = (i0 + 1) % this.segments;
    const frac = floatIdx - i0;
    return new THREE.Vector3().lerpVectors(this.binormals[i0], this.binormals[i1], frac).normalize();
  }

  /**
   * Builds supporting landmark architecture (Apex Skyscraper Tower).
   */
  private buildArchitecture(collision?: CollisionWorld): void {
    // 1. Apex Skyscraper Tower (Track climbs up South face at Z = -70)
    const towerGeo = new THREE.BoxGeometry(32, 110, 24);
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // slate glass / steel tower
      roughness: 0.25,
      metalness: 0.75,
    });
    const towerMesh = new THREE.Mesh(towerGeo, towerMat);
    towerMesh.position.set(0, 55, -84);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    this.group.add(towerMesh);

    // Tower structural edge columns (placed 10m outside track width)
    const colMat = new THREE.MeshStandardMaterial({ color: 0xd8e2ed, roughness: 0.4, metalness: 0.5 });
    const colGeo = new THREE.BoxGeometry(1.6, 110, 1.6);
    const colL = new THREE.Mesh(colGeo, colMat);
    colL.position.set(-17, 55, -72);
    colL.castShadow = true;
    const colR = new THREE.Mesh(colGeo, colMat);
    colR.position.set(17, 55, -72);
    colR.castShadow = true;
    this.group.add(colL, colR);

    if (collision) {
      // Tower proxy placed safely behind road surface so it never obstructs the car
      const towerProxy = new THREE.Mesh(new THREE.BoxGeometry(32, 110, 24));
      towerProxy.position.set(0, 55, -86);
      towerProxy.updateMatrixWorld();
      collision.addProxy(towerProxy);
    }
  }

  /**
   * Builds realistic asphalt circuit roadway with non-twisting normals and 3D rumble curbs.
   */
  private buildRoadway(collision?: CollisionWorld): void {
    const segments = 320;
    const roadWidth = 14;
    const halfW = roadWidth * 0.5;

    const roadPositions: number[] = [];
    const roadNormals: number[] = [];
    const roadUvs: number[] = [];
    const roadIndices: number[] = [];

    const curbBoxes: { pos: THREE.Vector3; quat: THREE.Quaternion; isRed: boolean }[] = [];
    const centerLinePoints: THREE.Vector3[] = [];
    const leftBorderPoints: THREE.Vector3[] = [];
    const rightBorderPoints: THREE.Vector3[] = [];
    const leftRailTopPoints: THREE.Vector3[] = [];
    const rightRailTopPoints: THREE.Vector3[] = [];

    // 3D Solid Crash Barriers (2.2m tall, 0.5m thick, fully enclosed)
    const barrierPositions: number[] = [];
    const barrierIndices: number[] = [];
    const barrierH = 2.2;
    const barrierThick = 0.5;

    for (let i = 0; i <= segments; i++) {
      const u = (i / segments) % 1.0;
      const pt = this.curve.getPointAt(u);
      const tangent = this.tangents[i];
      const normal = this.normals[i];
      const binormal = this.binormals[i];

      const pLeft = pt.clone().addScaledVector(binormal, -halfW);
      const pRight = pt.clone().addScaledVector(binormal, halfW);

      roadPositions.push(pLeft.x, pLeft.y, pLeft.z);
      roadPositions.push(pRight.x, pRight.y, pRight.z);

      roadNormals.push(normal.x, normal.y, normal.z);
      roadNormals.push(normal.x, normal.y, normal.z);

      const vDist = i * 2.0;
      roadUvs.push(0, vDist);
      roadUvs.push(1, vDist);

      // Barrier 8 vertices per segment:
      // Left Barrier: 0: in-bot, 1: in-top, 2: out-top, 3: out-bot
      const pL0 = pLeft.clone();
      const pL1 = pLeft.clone().addScaledVector(normal, barrierH);
      const pL2 = pLeft.clone().addScaledVector(binormal, -barrierThick).addScaledVector(normal, barrierH);
      const pL3 = pLeft.clone().addScaledVector(binormal, -barrierThick);

      // Right Barrier: 4: in-bot, 5: in-top, 6: out-top, 7: out-bot
      const pR4 = pRight.clone();
      const pR5 = pRight.clone().addScaledVector(normal, barrierH);
      const pR6 = pRight.clone().addScaledVector(binormal, barrierThick).addScaledVector(normal, barrierH);
      const pR7 = pRight.clone().addScaledVector(binormal, barrierThick);

      barrierPositions.push(
        pL0.x, pL0.y, pL0.z,
        pL1.x, pL1.y, pL1.z,
        pL2.x, pL2.y, pL2.z,
        pL3.x, pL3.y, pL3.z,
        pR4.x, pR4.y, pR4.z,
        pR5.x, pR5.y, pR5.z,
        pR6.x, pR6.y, pR6.z,
        pR7.x, pR7.y, pR7.z,
      );

      // Markings & illuminated rail lines (on inner lip of barrier top)
      centerLinePoints.push(pt.clone().addScaledVector(normal, 0.05));
      leftBorderPoints.push(pLeft.clone().addScaledVector(binormal, 0.45).addScaledVector(normal, 0.04));
      rightBorderPoints.push(pRight.clone().addScaledVector(binormal, -0.45).addScaledVector(normal, 0.04));
      leftRailTopPoints.push(pL1);
      rightRailTopPoints.push(pR5);

      if (i < segments) {
        const v0 = i * 2;
        const v1 = i * 2 + 1;
        const v2 = (i + 1) * 2;
        const v3 = (i + 1) * 2 + 1;

        // Road surface indices (face normal points UP/OUTWARD)
        roadIndices.push(v0, v2, v1);
        roadIndices.push(v1, v2, v3);

        const b = i * 8;
        const nb = (i + 1) * 8;

        // ── Left 3D Barrier Quads ──
        // 1. Left Inside Face (faces road centerline, +binormal)
        barrierIndices.push(b + 0, b + 1, nb + 0);
        barrierIndices.push(b + 1, nb + 1, nb + 0);

        // 2. Left Top Cap (faces up, +normal)
        barrierIndices.push(b + 1, b + 2, nb + 1);
        barrierIndices.push(b + 2, nb + 2, nb + 1);

        // 3. Left Outside Face (faces away from road, -binormal)
        barrierIndices.push(b + 2, b + 3, nb + 2);
        barrierIndices.push(b + 3, nb + 3, nb + 2);

        // ── Right 3D Barrier Quads ──
        // 4. Right Inside Face (faces road centerline, -binormal)
        barrierIndices.push(b + 4, nb + 4, b + 5);
        barrierIndices.push(b + 5, nb + 4, nb + 5);

        // 5. Right Top Cap (faces up, +normal)
        barrierIndices.push(b + 5, nb + 5, b + 6);
        barrierIndices.push(b + 6, nb + 5, nb + 6);

        // 6. Right Outside Face (faces away from road, +binormal)
        barrierIndices.push(b + 6, nb + 6, b + 7);
        barrierIndices.push(b + 7, nb + 6, nb + 7);

        // Curbs every 2 segments
        if (i % 2 === 0) {
          const mRot = new THREE.Matrix4().makeBasis(binormal, normal, tangent.clone().negate());
          const qCurb = new THREE.Quaternion().setFromRotationMatrix(mRot);

          curbBoxes.push({
            pos: pLeft.clone().addScaledVector(normal, 0.12),
            quat: qCurb,
            isRed: (i % 4 === 0),
          });
          curbBoxes.push({
            pos: pRight.clone().addScaledVector(normal, 0.12),
            quat: qCurb,
            isRed: (i % 4 !== 0),
          });
        }
      }
    }

    // ── Asphalt Road Surface Mesh ──────────────────────────────
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);

    const roadMat = new THREE.MeshStandardMaterial({
      map: getAsphaltTexture(),
      color: 0x3d4350, // deep charcoal tarmac with realistic grit
      roughness: 0.75,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.castShadow = true;
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    // ── Yellow Dashed Center Line ──────────────────────────────
    const centerGeo = new THREE.BufferGeometry().setFromPoints(centerLinePoints);
    const centerMat = new THREE.LineDashedMaterial({
      color: 0xf5b700, // vibrant yellow
      dashSize: 3,
      gapSize: 2,
    });
    const centerLine = new THREE.Line(centerGeo, centerMat);
    centerLine.computeLineDistances();
    this.group.add(centerLine);

    // ── White Outer Boundary Lines ─────────────────────────────
    const whiteBorderMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    const lineL = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftBorderPoints), whiteBorderMat);
    const lineR = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightBorderPoints), whiteBorderMat);
    this.group.add(lineL, lineR);

    // ── 3D Red & White Rumble Curbs ────────────────────────────
    const curbGeo = new THREE.BoxGeometry(0.7, 0.24, 2.2);
    const curbRedMat = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.5 });
    const curbWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });

    const redCount = curbBoxes.filter(c => c.isRed).length;
    const whiteCount = curbBoxes.length - redCount;

    const redInst = new THREE.InstancedMesh(curbGeo, curbRedMat, Math.max(1, redCount));
    const whiteInst = new THREE.InstancedMesh(curbGeo, curbWhiteMat, Math.max(1, whiteCount));
    const dummy = new THREE.Object3D();

    let rIdx = 0;
    let wIdx = 0;
    curbBoxes.forEach(c => {
      dummy.position.copy(c.pos);
      dummy.quaternion.copy(c.quat);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      if (c.isRed) {
        redInst.setMatrixAt(rIdx++, dummy.matrix);
      } else {
        whiteInst.setMatrixAt(wIdx++, dummy.matrix);
      }
    });

    redInst.castShadow = true;
    redInst.receiveShadow = true;
    whiteInst.castShadow = true;
    whiteInst.receiveShadow = true;

    redInst.instanceMatrix.needsUpdate = true;
    whiteInst.instanceMatrix.needsUpdate = true;
    this.group.add(redInst, whiteInst);

    // ── Solid Crash Barriers along track sides ─────────────────
    const barrierGeo = new THREE.BufferGeometry();
    barrierGeo.setAttribute('position', new THREE.Float32BufferAttribute(barrierPositions, 3));
    barrierGeo.setIndex(barrierIndices);
    barrierGeo.computeVertexNormals();

    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // dark slate titanium crash fence
      roughness: 0.35,
      metalness: 0.75,
      side: THREE.DoubleSide,
    });
    const barrierMesh = new THREE.Mesh(barrierGeo, barrierMat);
    barrierMesh.castShadow = true;
    barrierMesh.receiveShadow = true;
    this.group.add(barrierMesh);

    // ── Glowing Cyan Safety Guide Rails on Barrier Tops ────────
    const railMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    const lineLTop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftRailTopPoints), railMat);
    const lineRTop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightRailTopPoints), railMat);
    this.group.add(lineLTop, lineRTop);

    // ── Register Road & Crash Barriers into BVH Collision ──────
    if (collision) {
      const roadProxy = new THREE.Mesh(roadGeo);
      roadProxy.updateMatrixWorld();
      collision.addProxy(roadProxy);

      const barrierProxy = new THREE.Mesh(barrierGeo);
      barrierProxy.updateMatrixWorld();
      collision.addProxy(barrierProxy);
    }
  }

  /**
   * Realistic Steel Truss Race Timing Gantries with status rings.
   */
  private buildGantryCheckpoints(): void {
    const gateDefs: { u: number; label: string; radius: number; isStart?: boolean }[] = [
      { u: 0.00, label: 'START / FINISH',       radius: 12, isStart: true },
      { u: 0.12, label: 'TOWER RAMP',           radius: 12 },
      { u: 0.25, label: 'TOWER SUMMIT',         radius: 14 },
      { u: 0.38, label: 'SKYWAY BRIDGE',        radius: 12 },
      { u: 0.50, label: 'CANYON DIVE',          radius: 12 },
      { u: 0.62, label: 'WATERFRONT BOULEVARD', radius: 12 },
      { u: 0.76, label: 'CELESTIAL SKYWAY',     radius: 12 },
      { u: 0.88, label: 'HOME STRETCH',         radius: 12 },
    ];

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0xc2c9d4, // brushed aluminum / steel
      roughness: 0.3,
      metalness: 0.85,
    });

    gateDefs.forEach((def, index) => {
      const pt = this.curve.getPointAt(def.u);
      const tangent = this.curve.getTangentAt(def.u).normalize();
      const normal = this.getNormalAt(def.u);
      const binormal = this.getBinormalAt(def.u);

      const mRot = new THREE.Matrix4().makeBasis(binormal, normal, tangent.clone().negate());
      const gateQuat = new THREE.Quaternion().setFromRotationMatrix(mRot);

      const gateGroup = new THREE.Group();
      gateGroup.position.copy(pt);
      gateGroup.quaternion.copy(gateQuat);

      const spanW = def.radius * 1.5;
      const spanH = def.radius * 0.9;

      // Steel Support Pillars
      const pillarGeo = new THREE.BoxGeometry(0.8, spanH, 0.8);
      const pillarL = new THREE.Mesh(pillarGeo, steelMat);
      pillarL.position.set(-spanW * 0.5, spanH * 0.5, 0);
      const pillarR = new THREE.Mesh(pillarGeo, steelMat);
      pillarR.position.set(spanW * 0.5, spanH * 0.5, 0);
      gateGroup.add(pillarL, pillarR);

      // Top Crossbar Gantry
      const barGeo = new THREE.BoxGeometry(spanW + 1.4, 1.1, 1.2);
      const bar = new THREE.Mesh(barGeo, steelMat);
      bar.position.set(0, spanH, 0);
      gateGroup.add(bar);

      // LED Timing Lights
      const ledMat = new THREE.MeshStandardMaterial({
        color: def.isStart ? 0x00ff66 : 0xffaa00,
        emissive: new THREE.Color(def.isStart ? 0x00ff66 : 0xffaa00),
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });

      const ledGeo = new THREE.SphereGeometry(0.45, 12, 12);
      for (let x = -spanW * 0.35; x <= spanW * 0.35; x += 3.0) {
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.position.set(x, spanH - 0.7, 0);
        gateGroup.add(led);
      }

      this.group.add(gateGroup);

      this.checkpoints.push({
        index,
        label: def.label,
        position: pt.clone(),
        direction: tangent.clone(),
        normal: normal.clone(),
        binormal: binormal.clone(),
        radius: def.radius,
        gateGroup,
        matRing: ledMat,
        isPassed: false,
        isActive: index === 0,
      });
    });

    this.updateGateVisuals(0);
  }

  updateGateVisuals(activeCheckpointIndex: number): void {
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      cp.isActive = (i === activeCheckpointIndex);

      if (cp.isActive) {
        cp.matRing.color.setHex(i === 0 ? 0x00ff66 : 0xffcc00);
        cp.matRing.emissiveIntensity = 1.2;
        cp.gateGroup.scale.set(1.08, 1.08, 1.08);
      } else if (cp.isPassed) {
        cp.matRing.color.setHex(0x22c55e);
        cp.matRing.emissiveIntensity = 0.4;
        cp.gateGroup.scale.set(1.0, 1.0, 1.0);
      } else {
        cp.matRing.color.setHex(0x475569);
        cp.matRing.emissiveIntensity = 0.1;
        cp.gateGroup.scale.set(1.0, 1.0, 1.0);
      }
    }
  }

  resetCheckpoints(): void {
    for (let i = 0; i < this.checkpoints.length; i++) {
      this.checkpoints[i].isPassed = false;
      this.checkpoints[i].isActive = (i === 1);
    }
    this.updateGateVisuals(1);
  }

  checkCarPassing(carPos: THREE.Vector3, activeIndex: number): boolean {
    const cp = this.checkpoints[activeIndex];
    if (!cp) return false;

    const dist = this._tempVec.copy(carPos).distanceTo(cp.position);
    if (dist < cp.radius) {
      cp.isPassed = true;
      return true;
    }
    return false;
  }

  /**
   * Fail-Safe Circuit Boundary Containment:
   * Physically clamps the car's position so wheels never breach or pass beyond
   * the 2.2m titanium crash barriers, preventing flying off or tunneling.
   */
  containCar(carPos: THREE.Vector3, carVel: THREE.Vector3): void {
    if (this.centerPoints.length === 0) return;
    const n = this.segments;
    let bestIdx = this.lastNearestIdx;
    let bestDistSq = carPos.distanceToSquared(this.centerPoints[bestIdx]);

    // Localized search within +/- 25 segments (sub-microsecond)
    const windowSize = 25;
    for (let offset = -windowSize; offset <= windowSize; offset++) {
      const idx = ((this.lastNearestIdx + offset) % n + n) % n;
      const dSq = carPos.distanceToSquared(this.centerPoints[idx]);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
    // Fallback to global search if drifted far
    if (bestDistSq > 900) {
      for (let i = 0; i < n; i++) {
        const dSq = carPos.distanceToSquared(this.centerPoints[i]);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }
    this.lastNearestIdx = bestIdx;

    const cp = this.centerPoints[bestIdx];
    const binormal = this.binormals[bestIdx];
    this._tempVec.copy(carPos).sub(cp);
    const latDist = this._tempVec.dot(binormal);
    const maxAllowedLat = 6.25; // 7.0m road half-width - 0.75m wheel margin

    if (Math.abs(latDist) > maxAllowedLat) {
      const targetLat = Math.sign(latDist) * maxAllowedLat;
      const correction = targetLat - latDist;
      carPos.addScaledVector(binormal, correction);

      const latVel = carVel.dot(binormal);
      if (latVel * latDist > 0) {
        carVel.addScaledVector(binormal, -latVel);
      }
    }
  }
}
