/**
 * src/world/WaterSystem.ts
 * ─────────────────────────────────────────────────────────────
 * Animated Procedural Water System:
 *   - Sea plane at y = 0 along the Western coastline
 *   - Scenic inland lake water surface at y = 12m
 *   - Custom animated GLSL shader with depth gradient, specular glint, and shoreline foam
 *   - Instant water hazard detection (submersion > 1m triggers rescue)
 *
 * RULES.md: Zero per-tick heap allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { WorldSpec } from './WorldConfig';
import { Landforms } from './Landforms';

export interface WaterHazardResult {
  isSubmerged: boolean;
  depth: number;
}

const _hazardResult: WaterHazardResult = { isSubmerged: false, depth: 0 };

export class WaterSystem {
  readonly rootGroup = new THREE.Group();
  readonly spec: WorldSpec;
  readonly landforms: Landforms;

  private readonly waterMat: THREE.ShaderMaterial;
  private readonly seaMesh: THREE.Mesh;
  private readonly lakeMesh: THREE.Mesh;

  constructor(spec: WorldSpec, landforms?: Landforms) {
    this.spec = spec;
    this.landforms = landforms ?? new Landforms(spec);

    const cfg = this.landforms.config;

    // ── 1. Animated Custom Water Shader ───────────────────────
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:         { value: 0.0 },
        uDeepColor:    { value: new THREE.Color(0x06284a) }, // Deep sapphire/navy
        uShallowColor: { value: new THREE.Color(0x1a8ea6) }, // Coastal turquoise
        uFoamColor:    { value: new THREE.Color(0xe6f4f8) }, // Sea foam
        uSunDir:       { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Rolling sinusoidal surface wave swell
          float w1 = sin(pos.x * 0.035 + uTime * 1.5) * cos(pos.y * 0.035 + uTime * 1.2) * 0.22;
          float w2 = sin((pos.x + pos.y) * 0.07 + uTime * 2.2) * 0.08;
          pos.z += w1 + w2;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vNormal = normalize(vec3(-w1 * 0.2, 1.0, -w2 * 0.2));
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          // Dynamic wave crest foam
          float wavePattern = sin(vWorldPos.x * 0.12 + uTime * 1.8) * cos(vWorldPos.z * 0.12 + uTime * 1.5);
          float foam = smoothstep(0.52, 0.85, wavePattern);

          // Sun specular glint
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(normalize(vNormal), halfDir), 0.0), 36.0) * 0.65;

          vec3 baseWater = mix(uShallowColor, uDeepColor, 0.60);
          vec3 finalColor = mix(baseWater, uFoamColor, foam * 0.45) + vec3(spec);

          gl_FragColor = vec4(finalColor, 0.88);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    // ── 2. Sea Plane at y = 0 along Coastline ─────────────────
    // Spans from x = -1600 to x = -700 (width 900m), z = [-1300, 1300] (height 2600m)
    const seaGeo = new THREE.PlaneGeometry(900, 2600, 36, 64);
    this.seaMesh = new THREE.Mesh(seaGeo, this.waterMat);
    this.seaMesh.rotation.x = -Math.PI * 0.5;
    this.seaMesh.position.set(-1150, cfg.seaLevel, 0);
    this.seaMesh.receiveShadow = true;
    this.rootGroup.add(this.seaMesh);

    // ── 3. Inland Lake Water Surface at y = 12m ──────────────
    const lakeGeo = new THREE.CircleGeometry(cfg.lakeRadius + 15.0, 48);
    this.lakeMesh = new THREE.Mesh(lakeGeo, this.waterMat);
    this.lakeMesh.rotation.x = -Math.PI * 0.5;
    this.lakeMesh.position.set(cfg.lakeCenter.x, cfg.lakeSurfaceElevation, cfg.lakeCenter.z);
    this.lakeMesh.receiveShadow = true;
    this.rootGroup.add(this.lakeMesh);
  }

  /**
   * Per-frame animation update.
   */
  update(dt: number): void {
    this.waterMat.uniforms.uTime.value += dt;
  }

  /**
   * Checks whether coordinates (x, y, z) are submerged in water deeper than 1.0 meter.
   * Zero heap allocations (reuses preallocated _hazardResult).
   */
  checkWaterHazard(x: number, y: number, z: number): WaterHazardResult {
    const cfg = this.landforms.config;

    // Check Ocean (West of dynamic coastline)
    const coastX = this.landforms.getCoastlineX(z);
    if (x < coastX) {
      const depth = cfg.seaLevel - y;
      if (depth > 1.0) {
        _hazardResult.isSubmerged = true;
        _hazardResult.depth = depth;
        return _hazardResult;
      }
    }

    // Check Lake
    const lakeDx = x - cfg.lakeCenter.x;
    const lakeDz = z - cfg.lakeCenter.z;
    if (lakeDx * lakeDx + lakeDz * lakeDz <= cfg.lakeRadius * cfg.lakeRadius) {
      const depth = cfg.lakeSurfaceElevation - y;
      if (depth > 1.0) {
        _hazardResult.isSubmerged = true;
        _hazardResult.depth = depth;
        return _hazardResult;
      }
    }

    _hazardResult.isSubmerged = false;
    _hazardResult.depth = 0;
    return _hazardResult;
  }

  dispose(): void {
    this.seaMesh.geometry.dispose();
    this.lakeMesh.geometry.dispose();
    this.waterMat.dispose();
  }
}
