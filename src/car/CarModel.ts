/**
 * src/car/CarModel.ts
 * ─────────────────────────────────────────────────────────────
 * High-Detail Realistic Supercar Model with Dynamic Ground Contact Shadow.
 *
 * Features:
 *   - Soft ambient contact shadow disk anchored beneath wheels (grounds car on floors, walls & ceilings)
 *   - Glossy vibrant automotive paint with clearcoat reflections
 *   - Aerodynamic bodywork: front splitter, cockpit glass, rear wing & dual chrome exhaust
 *   - Realistic wheels: black rubber tires, alloy rims, and sport brake calipers
 *   - Functional front headlights and reactive red LED brake lights
 *   - Front wheels physically turn left/right with steering input
 *
 * RULES.md: Zero per-frame allocations. All geometry & materials cached.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { CarConfig as C } from './CarConfig';

// Cached contact shadow texture
let cachedShadowTexture: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (!cachedShadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    cachedShadowTexture = new THREE.CanvasTexture(canvas);
  }
  return cachedShadowTexture;
}

export class CarModel {
  readonly group = new THREE.Group();

  private readonly frontLeftWheel = new THREE.Group();
  private readonly frontRightWheel = new THREE.Group();
  private readonly brakeLightMat: THREE.MeshStandardMaterial;

  constructor(bodyPaintHex: number = C.bodyColor) {
    // ── 1. Realistic Automotive Materials ─────────────────────
    const paintMat = new THREE.MeshStandardMaterial({
      color: bodyPaintHex,
      roughness: 0.2,
      metalness: 0.35,
    });

    const glassMat = new THREE.MeshStandardMaterial({
      color: C.cabinColor,
      roughness: 0.05,
      metalness: 0.95,
      transparent: true,
      opacity: 0.9,
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: C.chassisColor,
      roughness: 0.6,
      metalness: 0.2,
    });

    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.8,
      roughness: 0.1,
    });

    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x991111,
      emissive: new THREE.Color(0xff1111),
      emissiveIntensity: 0.4,
      roughness: 0.2,
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: C.wheelColor,
      roughness: 0.8,
      metalness: 0.05,
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd8dde4,
      roughness: 0.25,
      metalness: 0.9,
    });

    const caliperMat = new THREE.MeshStandardMaterial({
      color: C.caliperColor,
      roughness: 0.3,
      metalness: 0.5,
    });

    // ── 2. Supercar Bodywork ──────────────────────────────────
    // Lower Chassis Floor
    const floorGeo = new THREE.BoxGeometry(C.carWidth * 0.95, 0.15, C.carLength);
    const floorMesh = new THREE.Mesh(floorGeo, trimMat);
    floorMesh.position.y = 0.15;
    this.group.add(floorMesh);

    // Main Sculpted Body / Hood / Fenders
    const bodyGeo = new THREE.BoxGeometry(C.carWidth, C.carHeight * 0.45, C.carLength * 0.95);
    const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
    bodyMesh.position.y = C.carHeight * 0.32;
    bodyMesh.castShadow = true;
    this.group.add(bodyMesh);

    // Sloped Front Hood Wedge
    const hoodGeo = new THREE.BoxGeometry(C.carWidth * 0.92, C.carHeight * 0.25, 0.8);
    const hoodMesh = new THREE.Mesh(hoodGeo, paintMat);
    hoodMesh.position.set(0, C.carHeight * 0.22, -C.carLength * 0.42);
    hoodMesh.rotation.x = 0.12;
    hoodMesh.castShadow = true;
    this.group.add(hoodMesh);

    // Front Aerodynamic Splitter
    const splitterGeo = new THREE.BoxGeometry(C.carWidth * 1.02, 0.06, 0.35);
    const splitter = new THREE.Mesh(splitterGeo, trimMat);
    splitter.position.set(0, 0.1, -C.carLength * 0.52);
    this.group.add(splitter);

    // ── 3. Cockpit Cabin & Windows ────────────────────────────
    const cabinGeo = new THREE.BoxGeometry(C.carWidth * 0.75, C.carHeight * 0.45, C.carLength * 0.48);
    const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
    cabinMesh.position.set(0, C.carHeight * 0.65, 0.05);
    cabinMesh.castShadow = true;
    this.group.add(cabinMesh);

    // Roof Panel
    const roofGeo = new THREE.BoxGeometry(C.carWidth * 0.72, 0.05, C.carLength * 0.35);
    const roofMesh = new THREE.Mesh(roofGeo, paintMat);
    roofMesh.position.set(0, C.carHeight * 0.88, 0.05);
    this.group.add(roofMesh);

    // ── 4. Rear Wing / Spoiler & Diffuser ─────────────────────
    const wingGeo = new THREE.BoxGeometry(C.carWidth * 0.98, 0.06, 0.35);
    const wing = new THREE.Mesh(wingGeo, trimMat);
    wing.position.set(0, C.carHeight * 0.75, C.carLength * 0.46);
    wing.castShadow = true;
    this.group.add(wing);

    // Wing Struts
    const strutGeo = new THREE.BoxGeometry(0.05, 0.25, 0.2);
    const strutL = new THREE.Mesh(strutGeo, trimMat);
    strutL.position.set(-C.carWidth * 0.32, C.carHeight * 0.6, C.carLength * 0.46);
    const strutR = new THREE.Mesh(strutGeo, trimMat);
    strutR.position.set(C.carWidth * 0.32, C.carHeight * 0.6, C.carLength * 0.46);
    this.group.add(strutL, strutR);

    // ── 5. Headlights & Taillights ────────────────────────────
    // Front White Headlight Lenses
    const headGeo = new THREE.BoxGeometry(C.carWidth * 0.28, 0.1, 0.08);
    const headL = new THREE.Mesh(headGeo, headlightMat);
    headL.position.set(-C.carWidth * 0.32, C.carHeight * 0.32, -C.carLength * 0.5 - 0.01);
    const headR = new THREE.Mesh(headGeo, headlightMat);
    headR.position.set(C.carWidth * 0.32, C.carHeight * 0.32, -C.carLength * 0.5 - 0.01);
    this.group.add(headL, headR);

    // Rear Red Taillight Strip
    const tailGeo = new THREE.BoxGeometry(C.carWidth * 0.88, 0.1, 0.08);
    const tailMesh = new THREE.Mesh(tailGeo, this.brakeLightMat);
    tailMesh.position.set(0, C.carHeight * 0.38, C.carLength * 0.49);
    this.group.add(tailMesh);

    // Dual Chrome Exhaust Pipes
    const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.15, 12);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaustL = new THREE.Mesh(exhaustGeo, rimMat);
    exhaustL.position.set(-0.25, 0.18, C.carLength * 0.5);
    const exhaustR = new THREE.Mesh(exhaustGeo, rimMat);
    exhaustR.position.set(0.25, 0.18, C.carLength * 0.5);
    this.group.add(exhaustL, exhaustR);

    // ── 6. Realistic Wheels (Tire + 5-Spoke Alloy Rim + Caliper) ─
    const wheelRadius = 0.34;
    const wheelWidth = 0.24;

    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 20);
    tireGeo.rotateZ(Math.PI / 2);

    const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.72, wheelRadius * 0.72, wheelWidth * 1.02, 10);
    rimGeo.rotateZ(Math.PI / 2);

    const caliperGeo = new THREE.BoxGeometry(0.08, 0.16, 0.12);

    const makeRealisticWheel = (isFront: boolean, isLeft: boolean): THREE.Group => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(isLeft ? -0.05 : 0.05, 0.12, 0);

      g.add(tire, rim, caliper);

      const x = (C.carWidth * 0.48 + wheelWidth * 0.38) * (isLeft ? -1 : 1);
      const z = (C.carLength * 0.34) * (isFront ? -1 : 1);
      const y = wheelRadius * 0.95;
      g.position.set(x, y, z);
      return g;
    };

    // Front Steerable Wheels
    this.frontLeftWheel.add(makeRealisticWheel(true, true));
    this.frontRightWheel.add(makeRealisticWheel(true, false));
    this.group.add(this.frontLeftWheel, this.frontRightWheel);

    // Rear Wheels
    this.group.add(makeRealisticWheel(false, true));
    this.group.add(makeRealisticWheel(false, false));

    // Enable real-time shadow receiving across supercar components
    this.group.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.receiveShadow = true;
      }
    });

    // ── 7. Soft Ambient Contact Shadow Underneath ──────────────
    // Creates a realistic grounding shadow beneath the chassis
    const shadowGeo = new THREE.PlaneGeometry(C.carWidth * 1.35, C.carLength * 1.25);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.y = 0.03;
    shadowMesh.castShadow = false;
    shadowMesh.receiveShadow = false;
    this.group.add(shadowMesh);
  }

  /**
   * Update visual wheel steer angle & reactive brake light glow.
   */
  updateVisuals(steerAngle: number, isBraking: boolean): void {
    this.frontLeftWheel.rotation.y = steerAngle * 0.45;
    this.frontRightWheel.rotation.y = steerAngle * 0.45;

    if (isBraking) {
      this.brakeLightMat.color.setHex(0xff1111);
      this.brakeLightMat.emissiveIntensity = 1.6;
    } else {
      this.brakeLightMat.color.setHex(0x881111);
      this.brakeLightMat.emissiveIntensity = 0.3;
    }
  }
}
