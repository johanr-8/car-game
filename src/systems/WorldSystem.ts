/**
 * src/systems/WorldSystem.ts
 * ─────────────────────────────────────────────────────────────
 * World Management System:
 *   - Atmosphere, lighting & shadows
 *   - Procedural city generation & LOD chunk streaming
 *   - Track geometry, checkpoints & spatial query service
 *   - Inversion state tracking
 *   - Collision world & BVH acceleration
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { SeededRandom } from '../core/SeededRandom';
import { CollisionWorld } from '../world/CollisionWorld';
import { TrackSpline } from '../world/TrackSpline';
import { TrackQuery } from '../world/TrackQuery';
import { ProceduralCity } from '../world/ProceduralCity';
import { InversionSystem } from '../world/InversionSystem';
import { CITY_THEMES, type CityTheme } from '../world/TimeOfDay';

export class WorldSystem {
  readonly scene: THREE.Scene;

  currentThemeIndex = 0;
  currentTheme: CityTheme;
  currentSeed: number;
  isDaily = true;

  // Atmosphere lights
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fillLight: THREE.DirectionalLight;

  // World geometry & physics
  collisionWorld!: CollisionWorld;
  track!: TrackSpline;
  trackQuery!: TrackQuery;
  city!: ProceduralCity;
  inversion!: InversionSystem;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.currentSeed = SeededRandom.getDailySeed();
    this.currentTheme = CITY_THEMES[this.currentThemeIndex];

    // 1. Directional Sun Light with Soft Real-Time Shadows
    this.sunLight = new THREE.DirectionalLight(this.currentTheme.sunColor, this.currentTheme.sunIntensity);
    this.sunLight.position.set(100, 220, 80);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 450;
    this.sunLight.shadow.camera.left = -160;
    this.sunLight.shadow.camera.right = 160;
    this.sunLight.shadow.camera.top = 160;
    this.sunLight.shadow.camera.bottom = -160;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    // 2. Realistic Hemisphere Ambient Light
    this.hemiLight = new THREE.HemisphereLight(
      this.currentTheme.hemiSkyColor,
      this.currentTheme.hemiGroundColor,
      this.currentTheme.hemiIntensity
    );
    this.scene.add(this.hemiLight);

    // 3. Subtle Fill Light
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.fillLight.position.set(-80, 100, -80);
    this.scene.add(this.fillLight);

    this.applyTheme(this.currentTheme, renderer);
    this.buildCityEnvironment(this.currentSeed, this.currentTheme);
  }

  applyTheme(theme: CityTheme, renderer: THREE.WebGLRenderer): void {
    this.currentTheme = theme;
    renderer.setClearColor(theme.skyColor, 1);
    this.scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity);

    this.sunLight.color.setHex(theme.sunColor);
    this.sunLight.intensity = theme.sunIntensity;

    this.hemiLight.color.setHex(theme.hemiSkyColor);
    this.hemiLight.groundColor.setHex(theme.hemiGroundColor);
    this.hemiLight.intensity = theme.hemiIntensity;
  }

  buildCityEnvironment(seed: number, theme: CityTheme): void {
    if (this.city) this.scene.remove(this.city.visualGroup);
    if (this.inversion) this.scene.remove(this.inversion.visualGroup);
    if (this.track) this.scene.remove(this.track.group);

    this.collisionWorld = new CollisionWorld();

    // 1. Asphalt Roadway with Curbs & Barriers
    this.track = new TrackSpline(this.collisionWorld);
    this.scene.add(this.track.group);

    // 2. Track Spatial Query Service
    this.trackQuery = new TrackQuery(this.track);

    // 3. Procedural Metropolis Architecture
    this.city = new ProceduralCity(this.collisionWorld, theme, seed, this.track.curve);
    this.scene.add(this.city.visualGroup);

    // 4. Inversion Event Tracker
    this.inversion = new InversionSystem(this.collisionWorld, theme);
    this.scene.add(this.inversion.visualGroup);

    // 5. Bake Static BVH Tree
    this.collisionWorld.buildBVH();
  }

  remixCity(renderer: THREE.WebGLRenderer): void {
    this.isDaily = false;
    this.currentSeed = (this.currentSeed + 7919) % 1000000;
    this.currentThemeIndex = (this.currentThemeIndex + 1) % CITY_THEMES.length;
    this.applyTheme(CITY_THEMES[this.currentThemeIndex], renderer);
    this.buildCityEnvironment(this.currentSeed, this.currentTheme);
  }

  updatePhysics(dt: number, activeCheckpoint: number, playerPosY: number): void {
    this.inversion.evaluateInversion(activeCheckpoint, playerPosY);
    this.inversion.update(dt);
  }

  updateVisuals(playerPosX: number, playerPosZ: number): void {
    this.city.updateChunkLOD(playerPosX, playerPosZ);
  }

  update(dt: number, activeCheckpoint: number, playerPosY: number, playerPosX: number, playerPosZ: number): void {
    this.updatePhysics(dt, activeCheckpoint, playerPosY);
    this.updateVisuals(playerPosX, playerPosZ);
  }
}
