/**
 * src/main.ts
 * ─────────────────────────────────────────────────────────────
 * Warp City: Velocity Drift — High-Octane 6DOF Arcade Time Trial.
 *
 * Architecture:
 *   - 120Hz fixed-timestep physics loop with α-interpolated rendering
 *   - Contiguous 6DOF surface-sticking arcade car controller
 *   - Procedurally generated metropolis with cleared track corridor
 *   - 3-Lap Time Trial with personal best Ghost replay
 *   - Skill-based Nitro Boost (Power Drifting, Wall Riding, Clean Landings)
 *
 * RULES.md: Zero per-frame allocations. WebGL2. Single config source.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { FIXED_DT, MAX_ACCUMULATOR } from './core/constants';
import { createRenderer } from './core/Renderer';
import { createComposer } from './core/PostProcessing';
import { readInput } from './core/InputManager';
import { StatsCollector } from './core/StatsCollector';
import { SeededRandom } from './core/SeededRandom';

import { CollisionWorld } from './world/CollisionWorld';
import { TrackSpline } from './world/TrackSpline';
import { ProceduralCity } from './world/ProceduralCity';
import { InversionSystem } from './world/InversionSystem';
import { CITY_THEMES, type CityTheme } from './world/TimeOfDay';

import { ArcadeCarController } from './car/ArcadeCarController';
import { CarModel } from './car/CarModel';
import { BoostSystem } from './car/BoostSystem';
import { ChaseCamera } from './car/ChaseCamera';
import { GhostRecorder } from './car/GhostRecorder';
import { GhostModel } from './car/GhostModel';

import { DebugOverlay } from './ui/DebugOverlay';
import { RaceHUD } from './ui/RaceHUD';

// ── Scratch Objects for Zero Per-Frame Allocations ───────────
const _interpPos   = new THREE.Vector3();
const _interpQuat  = new THREE.Quaternion();
const _ghostPos    = new THREE.Vector3();
const _ghostQuat   = new THREE.Quaternion();

// ── Scene & WebGL Renderer ───────────────────────────────────
const container = document.getElementById('canvas-container') as HTMLElement;
const renderer  = createRenderer(container);
const scene     = new THREE.Scene();

// ── Realistic Daylight & Atmosphere Lighting ─────────────────
let currentThemeIndex = 0;
let currentTheme: CityTheme = CITY_THEMES[currentThemeIndex];

// 1. Natural Golden Sunlight (DirectionalLight with Soft Real-Time Shadows)
const sunLight = new THREE.DirectionalLight(currentTheme.sunColor, currentTheme.sunIntensity);
sunLight.position.set(100, 220, 80);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 450;
sunLight.shadow.camera.left = -160;
sunLight.shadow.camera.right = 160;
sunLight.shadow.camera.top = 160;
sunLight.shadow.camera.bottom = -160;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.02;
scene.add(sunLight);

// 2. Realistic Hemisphere Light (Sky bounce + Ground green bounce)
const hemiLight = new THREE.HemisphereLight(
  currentTheme.hemiSkyColor,
  currentTheme.hemiGroundColor,
  currentTheme.hemiIntensity
);
scene.add(hemiLight);

// 3. Subtle Fill Light
const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
fillLight.position.set(-80, 100, -80);
scene.add(fillLight);

function applyTheme(theme: CityTheme): void {
  currentTheme = theme;
  renderer.setClearColor(theme.skyColor, 1);
  scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity);

  sunLight.color.setHex(theme.sunColor);
  sunLight.intensity = theme.sunIntensity;

  hemiLight.color.setHex(theme.hemiSkyColor);
  hemiLight.groundColor.setHex(theme.hemiGroundColor);
  hemiLight.intensity = theme.hemiIntensity;
}

applyTheme(currentTheme);

// ── Level, Procedural City, Track & Collision ────────────────
let collisionWorld = new CollisionWorld();
let city!: ProceduralCity;
let inversion!: InversionSystem;
let track!: TrackSpline;

const dailySeed = SeededRandom.getDailySeed();
let currentSeed = dailySeed;
let isDaily = true;

// ── Player Car (Rosso Corsa Supercar), Boost, Camera, Ghost ──
const carCtrl     = new ArcadeCarController();
const carModel    = new CarModel(0xd41c1c); // Vibrant Rosso Corsa
const boostSystem = new BoostSystem();
scene.add(carModel.group);

const ghostRecorder = new GhostRecorder();
const ghostModel    = new GhostModel();
scene.add(ghostModel.group);

const chaseCamera = new ChaseCamera(container.clientWidth / container.clientHeight);
scene.add(chaseCamera.camera);

// ── Post-Processing & HUD ────────────────────────────────────
const composer = createComposer(renderer, scene, chaseCamera.camera);
const stats    = new StatsCollector();
const debug    = new DebugOverlay();
const raceHUD  = new RaceHUD();

// ── Race State Variables ─────────────────────────────────────
let countdownTimer = 3.0; // 3-2-1-GO!
let isRacing = true;
let totalRaceTime = 0;
let currentLapTime = 0;
let lapCount = 1;
let activeCheckpointIndex = 1;
let awaitingFinishLine = false;

/**
 * Procedurally rebuilds city, tarmac ribbon, and BVH collision world.
 */
function buildCityEnvironment(seed: number, theme: CityTheme): void {
  if (city) scene.remove(city.visualGroup);
  if (inversion) scene.remove(inversion.visualGroup);
  if (track) scene.remove(track.group);

  collisionWorld = new CollisionWorld();

  // 1. Realistic Grand Prix Asphalt Roadway with Red & White Curbs
  track = new TrackSpline(collisionWorld);
  scene.add(track.group);

  // 2. Procedural Realistic City Architecture (masking out track corridor)
  city = new ProceduralCity(collisionWorld, theme, seed, track.curve);
  scene.add(city.visualGroup);

  // 3. Inversion System (Elevated Skyway camera roll)
  inversion = new InversionSystem(collisionWorld, theme);
  scene.add(inversion.visualGroup);

  // 4. Bake BVH
  collisionWorld.buildBVH();

  raceHUD.setSeedBadge(seed, theme.name, isDaily);
}

// Initial Build
buildCityEnvironment(currentSeed, currentTheme);

/**
 * City Remix: Reshuffles buildings, track, and cycles time of day.
 */
function remixCity(): void {
  isDaily = false;
  currentSeed = (currentSeed + 7919) % 1000000;
  currentThemeIndex = (currentThemeIndex + 1) % CITY_THEMES.length;
  applyTheme(CITY_THEMES[currentThemeIndex]);

  buildCityEnvironment(currentSeed, currentTheme);
  restartRace();
}

/**
 * Reset race state, player car, and rivals to starting grid.
 */
function restartRace(): void {
  carCtrl.position.set(0, 0.94, 25);
  carCtrl.quaternion.set(0, 0, 0, 1);
  carCtrl.prevPosition.copy(carCtrl.position);
  carCtrl.prevQuaternion.copy(carCtrl.quaternion);

  carCtrl.velocity.set(0, 0, 0);
  carCtrl.surfaceNormal.set(0, 1, 0);
  carCtrl.speed = 0;
  carCtrl.isGrounded = true;

  carModel.group.position.copy(carCtrl.position);
  carModel.group.quaternion.copy(carCtrl.quaternion);
  chaseCamera.reset(carCtrl.position, carCtrl.quaternion);

  track.resetCheckpoints();
  activeCheckpointIndex = 1;
  awaitingFinishLine = false;
  boostSystem.charge = 50;

  countdownTimer = 3.0; // 3-2-1-GO!
  isRacing = true;
  totalRaceTime = 0;
  currentLapTime = 0;
  lapCount = 1;

  raceHUD.hideVictory();
  ghostRecorder.startLap();
  ghostModel.setVisible(ghostRecorder.hasBestLap);
}

restartRace();

// Wire UI action handlers
raceHUD.onRestartRace = restartRace;
raceHUD.onRemixCity = remixCity;

// ── Window Resize ────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  chaseCamera.resize(w / h);
});

// ── Main Engine Loop (120Hz Physics + Interpolated Render) ────
let accumulator = 0;
let lastTime    = performance.now();

function loop(): void {
  requestAnimationFrame(loop);

  const now  = performance.now();
  const dtMs = now - lastTime;
  lastTime   = now;

  const dt = Math.min(dtMs / 1000, MAX_ACCUMULATOR);
  accumulator += dt;

  const input = readInput();

  if (input.restart) {
    restartRace();
  }

  if (input.remix) {
    remixCity();
  }

  // ── Fixed-Timestep Physics (120 Hz) ──
  stats.ticksThisFrame = 0;
  while (accumulator >= FIXED_DT) {
    // 1. Countdown staging
    if (countdownTimer > 0) {
      countdownTimer -= FIXED_DT;
      if (countdownTimer <= 0) {
        countdownTimer = -0.7; // 'GO!' banner
      }
    } else if (countdownTimer > -1.0) {
      countdownTimer -= FIXED_DT;
    }

    // 2. Inversion Event Evaluation
    inversion.evaluateInversion(activeCheckpointIndex, carCtrl.position.y);
    inversion.update(FIXED_DT);

    // 3. Kinetic Boost System Update (Skill-based Nitro: Drifting, Wall Riding, Clean Landings)
    const { isBoosting, boostForce } = boostSystem.update(
      FIXED_DT,
      input.boost,
      carCtrl.isGrounded,
      carCtrl.surfaceNormal.y,
      carCtrl.speed,
      carCtrl.isDrifting,
      carCtrl.wasAirborneJustLanded
    );
    carCtrl.boostActive = isBoosting;
    carCtrl.boostForce = boostForce;

    if (boostSystem.refillEventTimer > 1.3 && boostSystem.lastRefillReason) {
      raceHUD.showTrickPopup(boostSystem.lastRefillReason);
    }

    // 4. Update Player Car Physics
    if (isRacing && countdownTimer <= 0) {
      carCtrl.update(FIXED_DT, input, collisionWorld);
      track.containCar(carCtrl.position, carCtrl.velocity);
    } else {
      carCtrl.updateStaging(collisionWorld);
      track.containCar(carCtrl.position, carCtrl.velocity);
    }

    // 5. Track Boundary & Void Fail-Safe Rescue
    if (carCtrl.position.y < -5) {
      const rescueCPIndex = activeCheckpointIndex > 0 ? activeCheckpointIndex - 1 : 0;
      const cp = track.checkpoints[rescueCPIndex];
      if (cp) {
        const rescuePos = cp.position.clone().addScaledVector(track.getNormalAt(cp.index / track.checkpoints.length), 0.35);
        carCtrl.position.copy(rescuePos);
        carCtrl.prevPosition.copy(rescuePos);
        carCtrl.velocity.set(0, 0, 0);
        carCtrl.speed = 0;
      }
    }

    // 6. Race Timing & Checkpoint Tracking
    if (isRacing && countdownTimer <= 0) {
      currentLapTime += FIXED_DT;
      totalRaceTime += FIXED_DT;
      ghostRecorder.recordFrame(carCtrl.position, carCtrl.quaternion);
    }

    if (track.checkCarPassing(carCtrl.position, activeCheckpointIndex)) {
      if (!awaitingFinishLine) {
        activeCheckpointIndex++;
        if (activeCheckpointIndex >= track.checkpoints.length) {
          activeCheckpointIndex = 0;
          awaitingFinishLine = true;
        }
        track.updateGateVisuals(activeCheckpointIndex);
      } else if (activeCheckpointIndex === 0) {
        // Lap complete!
        const isRecord = ghostRecorder.finishLap(currentLapTime);
        const timeStr = `${Math.floor(currentLapTime / 60)}:${(currentLapTime % 60).toFixed(2).padStart(5, '0')}`;
        const msg = isRecord
          ? `★ NEW RECORD: ${timeStr} ★`
          : `LAP ${lapCount} COMPLETE: ${timeStr}`;

        raceHUD.showLapNotification(msg, isRecord);

        if (lapCount >= 3) {
          // Championship Complete!
          isRacing = false;
          raceHUD.showVictory(1, totalRaceTime, ghostRecorder.bestLapTime);
        } else {
          lapCount++;
          currentLapTime = 0;
          awaitingFinishLine = false;
          activeCheckpointIndex = 1;
          track.resetCheckpoints();
          ghostRecorder.startLap();
          ghostModel.setVisible(ghostRecorder.hasBestLap);
        }
      }
    }

    accumulator -= FIXED_DT;
    stats.ticksThisFrame++;
  }

  // ── α-Interpolated Rendering ──
  const alpha = accumulator / FIXED_DT;

  // Player car transform interpolation
  _interpPos.lerpVectors(carCtrl.prevPosition, carCtrl.position, alpha);
  _interpQuat.slerpQuaternions(carCtrl.prevQuaternion, carCtrl.quaternion, alpha);

  carModel.group.position.copy(_interpPos);
  carModel.group.quaternion.copy(_interpQuat);
  carModel.updateVisuals(carCtrl.steerVisual, input.brake > 0);

  // Chunk Streaming and Distance LOD around player
  city.updateChunkLOD(carCtrl.position.x, carCtrl.position.z);

  // Ghost Car replay
  if (ghostRecorder.hasBestLap && isRacing) {
    ghostModel.setVisible(true);
    const hasFrame = ghostRecorder.getGhostTransform(currentLapTime, _ghostPos, _ghostQuat);
    if (hasFrame) {
      ghostModel.group.position.copy(_ghostPos);
      ghostModel.group.quaternion.copy(_ghostQuat);
    }
  } else {
    ghostModel.setVisible(false);
  }

  // 6DOF chase camera (natural orientation follow)
  chaseCamera.update(
    carCtrl.position,
    carCtrl.quaternion,
    carCtrl.speedNorm,
    dt
  );

  // Render scene
  renderer.info.reset();
  composer.render();

  // ── Update HUD & Debug Info ──
  stats.record(dtMs);
  const n = carCtrl.surfaceNormal;
  const status = carCtrl.isGrounded ? 'GROUND' : 'AIR';
  stats.gravityLabel = `[${status}] N:(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) | ${(carCtrl.speed * 3.6).toFixed(0)} km/h`;
  debug.update(stats, renderer, dt);

  // Update Telemetry HUD
  raceHUD.updateCountdown(countdownTimer);
  raceHUD.update({
    currentLapTime,
    bestLapTime: ghostRecorder.bestLapTime,
    lapCount,
    activeCheckpoint: activeCheckpointIndex,
    totalCheckpoints: track.checkpoints.length,
    speedKmh: carCtrl.speed * 3.6,
    boostCharge: boostSystem.charge,
    isBoosting: carCtrl.boostActive,
    hasGhost: ghostRecorder.hasBestLap,
    isInverted: inversion.isInverted,
    dt,
  });
}

loop();
