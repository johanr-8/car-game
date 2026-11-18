/**
 * src/main.ts
 * ─────────────────────────────────────────────────────────────
 * Warp City: Velocity Drift — High-Octane 6DOF Arcade Time Trial & Free Roam.
 *
 * Architecture:
 *   - Thin loop orchestrator delegating to specialized subsystems:
 *       • WorldSystem: Atmosphere, lighting, city LOD & track query (Race mode)
 *       • RoamWorld: Large flat grass, test road cross & obstacle boxes (Roam mode)
 *       • VehicleSystem: Multi-vehicle array, physics, camera & ghost
 *       • HudSystem: Dirty-checked telemetry, debug overlay & tuning panel
 *       • RaceSystem: State machine (MENU, COUNTDOWN, RACING, ROAMING, FINISHED, PAUSED)
 *   - 120Hz fixed-timestep physics loop with α-interpolated rendering
 *   - WebGL2 + Bloom Post-Processing
 *
 * RULES.md: Zero per-frame allocations. Single config source.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { FIXED_DT, MAX_ACCUMULATOR } from './core/constants';
import { createRenderer } from './core/Renderer';
import { createComposer } from './core/PostProcessing';
import { readInput, isInputSuppressed, type InputState } from './core/InputManager';
import { FlyController } from './core/FlyController';
import { VehicleSystem, HudSystem, RaceSystem, GameState, GameMode } from './systems';
import { isDevMode } from './core/DevMode';
import { SeededRandom } from './core/SeededRandom';
import { CITY_THEMES } from './world/TimeOfDay';
import type { GraphicsQuality } from './core/Settings';

// ── Scene & WebGL Renderer ───────────────────────────────────
const container = document.getElementById('canvas-container') as HTMLElement;
const renderer = createRenderer(container);
const scene = new THREE.Scene();

// ── Subsystems ───────────────────────────────────────────────
const vehicleSystem = new VehicleSystem(scene, container.clientWidth / container.clientHeight);
const hudSystem = new HudSystem();
const flyController = new FlyController();

// Fly-Mode Keyboard Toggle (Shortcut: F)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && !isInputSuppressed()) {
    if (raceSystem.gameState === GameState.ROAMING || raceSystem.gameState === GameState.RACING) {
      const active = flyController.toggle(vehicleSystem.chaseCamera.camera);
      hudSystem.raceHUD.setFlyMode(active);
      if (!active) {
        const player = vehicleSystem.playerVehicle;
        vehicleSystem.chaseCamera.reset(player.controller.position, player.controller.quaternion);
      }
    }
  }
});

// Post-Processing pipeline
const composer = createComposer(renderer, scene, vehicleSystem.chaseCamera.camera);

const raceSystem = new RaceSystem(scene, renderer, vehicleSystem, hudSystem, composer);

// ── Quick-Testing URL Parameter (?mode=roam) ─────────────────
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('mode') === 'roam') {
  raceSystem.startRoam();
}

if (isDevMode()) {
  (window as any).__WARP_DEBUG__ = {
    raceSystem,
    vehicleSystem,
    worldSystem: raceSystem.worldSystem,
    hudSystem,
    renderer,
    composer,
    initSession: async (quality: GraphicsQuality) => {
      raceSystem.applyGraphicsQuality(quality);
      await raceSystem.startRaceWithWarmUp();
      raceSystem.setGameState(GameState.RACING);

      // Pre-warm 60 frames to stabilize JIT and shader caches
      const DT_FRAME = 1 / 60;
      const FIXED_DT = 1 / 120;
      const dummyInput = { steer: 0, throttle: 1, brake: 0, drift: false, boost: false, restart: false, remix: false, debug: false };
      let accum = 0;
      for (let i = 0; i < 60; i++) {
        accum += DT_FRAME;
        while (accum >= FIXED_DT - 1e-8) {
          raceSystem.updatePhysics(FIXED_DT, dummyInput);
          if (raceSystem.worldSystem) {
            raceSystem.worldSystem.updatePhysics(FIXED_DT, 1, 0.94);
          }
          accum -= FIXED_DT;
        }
        vehicleSystem.updateVisuals(1, DT_FRAME, false, true);
        renderer.info.reset();
        composer.render();
        hudSystem.stats.record(1.0);
      }

      hudSystem.debugOverlay.reset();
    },
    stepSession: (batchFrames = 600) => {
      const player = vehicleSystem.playerVehicle;
      const DT_FRAME = 1 / 60;
      const FIXED_DT = 1 / 120;
      let accum = 0;

      const input = {
        steer: 0,
        throttle: 1,
        brake: 0,
        drift: false,
        boost: false,
        restart: false,
        remix: false,
        debug: false,
      };

      for (let f = 0; f < batchFrames; f++) {
        const simTime = (f % 900) * DT_FRAME;
        const cycle = simTime % 15;
        if (cycle < 6) {
          input.steer = 0.2;
          input.drift = false;
          input.boost = true;
        } else if (cycle < 11) {
          input.steer = -0.45;
          input.drift = true;
          input.boost = false;
        } else {
          input.steer = 0;
          input.drift = false;
          input.boost = false;
        }

        accum += DT_FRAME;
        hudSystem.stats.ticksThisFrame = 0;
        while (accum >= FIXED_DT - 1e-8) {
          if (raceSystem.gameState === GameState.FINISHED) {
            raceSystem.setGameState(GameState.RACING);
            player.progress.lapCount = 1;
          }
          raceSystem.updatePhysics(FIXED_DT, input);
          if (raceSystem.worldSystem) {
            raceSystem.worldSystem.updatePhysics(
              FIXED_DT,
              player.progress.activeCheckpointIndex,
              player.controller.position.y
            );
          }
          accum -= FIXED_DT;
          hudSystem.stats.ticksThisFrame++;
        }

        vehicleSystem.updateVisuals(accum / FIXED_DT, DT_FRAME, false, true);
        if (raceSystem.worldSystem) {
          raceSystem.worldSystem.updateVisuals(player.controller.position.x, player.controller.position.z);
        }

        renderer.info.reset();
        const t0 = performance.now();
        composer.render();
        const t1 = performance.now();
        const frameMs = t1 - t0;

        hudSystem.stats.record(frameMs);
        hudSystem.debugOverlay.update(hudSystem.stats, renderer, DT_FRAME);
      }
    },
    finalizeSession: (quality: GraphicsQuality) => {
      const snapshots = hudSystem.debugOverlay.getSnapshots();
      const peakDrawCalls = Math.max(...snapshots.map(s => s.drawCalls));
      const peakTriangles = Math.max(...snapshots.map(s => s.triangles));

      const p50s = snapshots.map(s => s.p50Ms).sort((a, b) => a - b);
      const p99s = snapshots.map(s => s.p99Ms).sort((a, b) => a - b);
      const fps = snapshots.map(s => s.avgFps);

      const medianP50 = p50s[Math.floor(p50s.length * 0.5)];
      const worstP99 = p99s[Math.floor(p99s.length * 0.95)] || p99s[p99s.length - 1];
      const avgFps = fps.reduce((a, b) => a + b, 0) / fps.length;

      return {
        quality,
        snapshotCount: snapshots.length,
        p50: medianP50,
        p99: worstP99,
        avgFps,
        peakDrawCalls,
        peakTriangles,
      };
    }
  };
}

// Initial HUD seed badge
const initialSeed = SeededRandom.getDailySeed();
const initialTheme = CITY_THEMES[0];
hudSystem.raceHUD.setSeedBadge(initialSeed, initialTheme.name, true);

// ── Window Resize ────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  vehicleSystem.chaseCamera.resize(w / h);
});

// ── Main Engine Loop (120Hz Physics + Interpolated Render) ────
let accumulator = 0;
let lastTime = performance.now();

const _flyNeutralInput: InputState = {
  steer: 0,
  throttle: 0,
  brake: 1,
  drift: false,
  boost: false,
  restart: false,
  remix: false,
  debug: false,
};

function loop(): void {
  requestAnimationFrame(loop);

  const now = performance.now();
  const dtMs = now - lastTime;
  lastTime = now;

  const dt = Math.min(dtMs / 1000, MAX_ACCUMULATOR);
  accumulator += dt;

  // Auto-disable fly mode when paused or returning to menu
  if (flyController.isEnabled && (raceSystem.gameState === GameState.MENU || raceSystem.gameState === GameState.PAUSED)) {
    flyController.disable();
    hudSystem.raceHUD.setFlyMode(false);
  }

  const input = readInput();

  if (raceSystem.gameState !== GameState.MENU) {
    if (input.restart) {
      if (raceSystem.gameMode === GameMode.ROAM) {
        raceSystem.respawnRoam();
      } else {
        raceSystem.restartRace();
      }
    }

    if (input.remix && raceSystem.gameMode === GameMode.RACE) {
      raceSystem.remixCity();
    }
  }

  // ── Fixed-Timestep Physics (120 Hz) ──
  hudSystem.stats.ticksThisFrame = 0;
  while (accumulator >= FIXED_DT - 1e-8) {
    const player = vehicleSystem.playerVehicle;

    // Neutralize player car input while flying so vehicle remains parked
    const carInput = flyController.isEnabled ? _flyNeutralInput : input;

    // 1. Mode-specific physics progression (Race or Roam)
    raceSystem.updatePhysics(FIXED_DT, carInput);

    // 2. World & Inversion update (Race mode only)
    if (raceSystem.gameMode === GameMode.RACE && raceSystem.worldSystem) {
      raceSystem.worldSystem.updatePhysics(
        FIXED_DT,
        player.progress.activeCheckpointIndex,
        player.controller.position.y
      );
    }

    accumulator -= FIXED_DT;
    hudSystem.stats.ticksThisFrame++;
  }

  // ── α-Interpolated Rendering ──
  const alpha = accumulator / FIXED_DT;
  const player = vehicleSystem.playerVehicle;

  // 1. Update fly camera orientation & translation if active
  if (flyController.isEnabled) {
    flyController.update(dt);
  }

  // 2. Vehicle visual interpolation, ghost replay, and camera follow
  vehicleSystem.updateVisuals(
    alpha,
    dt,
    input.brake > 0,
    raceSystem.gameState === GameState.RACING,
    flyController.isEnabled
  );

  // 3. Chunk streaming LOD around spectator camera or player car
  const streamX = flyController.isEnabled ? flyController.position.x : player.controller.position.x;
  const streamZ = flyController.isEnabled ? flyController.position.z : player.controller.position.z;

  if (raceSystem.gameMode === GameMode.RACE && raceSystem.worldSystem) {
    raceSystem.worldSystem.updateVisuals(streamX, streamZ);
  } else if (raceSystem.gameMode === GameMode.ROAM && raceSystem.roamWorld) {
    raceSystem.roamWorld.updateVisuals(streamX, streamZ);
    hudSystem.stats.loadedChunks = raceSystem.roamWorld.loadedChunksCount;
    hudSystem.stats.chunkBuildMs = raceSystem.roamWorld.chunkBuildMs;
  }

  // 4. Render scene
  renderer.info.reset();
  composer.render();

  // 5. Update HUD, profiler, and debug overlay
  hudSystem.update(
    raceSystem.gameState,
    raceSystem.countdownTimer,
    player,
    raceSystem.worldSystem,
    vehicleSystem.ghostRecorder ? vehicleSystem.ghostRecorder.hasBestLap : false,
    vehicleSystem.ghostRecorder ? vehicleSystem.ghostRecorder.bestLapTime : null,
    dt,
    dtMs,
    renderer
  );
}

loop();
