/**
 * src/main.ts
 * ─────────────────────────────────────────────────────────────
 * Warp City: Velocity Drift — High-Octane 6DOF Arcade Time Trial.
 *
 * Architecture:
 *   - Thin loop orchestrator delegating to specialized subsystems:
 *       • WorldSystem: Atmosphere, lighting, city LOD & track query
 *       • VehicleSystem: Multi-vehicle array, physics, camera & ghost
 *       • HudSystem: Dirty-checked telemetry, debug overlay & tuning panel
 *       • RaceSystem: State machine (MENU, COUNTDOWN, RACING, FINISHED, PAUSED)
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
import { readInput } from './core/InputManager';
import { WorldSystem, VehicleSystem, HudSystem, RaceSystem, GameState } from './systems';

// ── Scene & WebGL Renderer ───────────────────────────────────
const container = document.getElementById('canvas-container') as HTMLElement;
const renderer = createRenderer(container);
const scene = new THREE.Scene();

// ── Subsystems ───────────────────────────────────────────────
const worldSystem = new WorldSystem(scene, renderer);
const vehicleSystem = new VehicleSystem(scene, container.clientWidth / container.clientHeight);
const hudSystem = new HudSystem();

// Post-Processing pipeline
const composer = createComposer(renderer, scene, vehicleSystem.chaseCamera.camera);

const raceSystem = new RaceSystem(worldSystem, vehicleSystem, hudSystem, renderer, composer);

// Initial HUD seed badge
hudSystem.raceHUD.setSeedBadge(
  worldSystem.currentSeed,
  worldSystem.currentTheme.name,
  worldSystem.isDaily
);

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

function loop(): void {
  requestAnimationFrame(loop);

  const now = performance.now();
  const dtMs = now - lastTime;
  lastTime = now;

  const dt = Math.min(dtMs / 1000, MAX_ACCUMULATOR);
  accumulator += dt;

  const input = readInput();

  if (raceSystem.gameState !== GameState.MENU) {
    if (input.restart) {
      raceSystem.restartRace();
    }

    if (input.remix) {
      raceSystem.remixCity();
    }
  }

  // ── Fixed-Timestep Physics (120 Hz) ──
  hudSystem.stats.ticksThisFrame = 0;
  while (accumulator >= FIXED_DT) {
    const player = vehicleSystem.playerVehicle;

    // 1. Race & Vehicle physics progression
    raceSystem.updatePhysics(FIXED_DT, input);

    // 2. World & Inversion update
    worldSystem.updatePhysics(
      FIXED_DT,
      player.progress.activeCheckpointIndex,
      player.controller.position.y
    );

    accumulator -= FIXED_DT;
    hudSystem.stats.ticksThisFrame++;
  }

  // ── α-Interpolated Rendering ──
  const alpha = accumulator / FIXED_DT;
  const player = vehicleSystem.playerVehicle;

  // 1. Vehicle visual interpolation, ghost replay, and camera follow
  vehicleSystem.updateVisuals(
    alpha,
    dt,
    input.brake > 0,
    raceSystem.gameState === GameState.RACING
  );

  // 2. Chunk streaming LOD around player
  worldSystem.updateVisuals(player.controller.position.x, player.controller.position.z);

  // 3. Render scene
  renderer.info.reset();
  composer.render();

  // 4. Update HUD, profiler, and debug overlay
  hudSystem.update(
    raceSystem.gameState,
    raceSystem.countdownTimer,
    player,
    worldSystem,
    vehicleSystem.ghostRecorder.hasBestLap,
    vehicleSystem.ghostRecorder.bestLapTime,
    dt,
    dtMs,
    renderer
  );
}

loop();
