/**
 * src/systems/HudSystem.ts
 * ─────────────────────────────────────────────────────────────
 * UI & HUD Subsystem:
 *   - Main Menu (GameState.MENU)
 *   - Race Telemetry HUD (dirty checked)
 *   - Pause Menu Modal (ESC)
 *   - Settings Modal (Volumes, Graphics, Camera, Rebinds)
 *   - Controls Modal (Dynamic active key bindings)
 *   - Results Modal (Laps, records & local Top 10 leaderboard)
 *   - Loading Screen (GPU shader warm-up)
 *   - Performance Profiler (F3) & Dev Tuning Panel (F4) in dev mode
 *   - Frame stats collector
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { RaceHUD } from '../ui/RaceHUD';
import { DebugOverlay } from '../ui/DebugOverlay';
import { PauseMenu } from '../ui/PauseMenu';
import { DevTuningPanel } from '../ui/DevTuningPanel';
import { MainMenu } from '../ui/MainMenu';
import { SettingsModal } from '../ui/SettingsModal';
import { ControlsModal } from '../ui/ControlsModal';
import { ResultsModal } from '../ui/ResultsModal';
import { LoadingScreen } from '../ui/LoadingScreen';
import { StatsCollector } from '../core/StatsCollector';
import type { VehicleEntity } from '../car/VehicleEntity';
import type { WorldSystem } from './WorldSystem';
import { GameState } from './GameState';

export class HudSystem {
  readonly raceHUD = new RaceHUD();
  readonly debugOverlay = new DebugOverlay();
  readonly devTuningPanel = new DevTuningPanel();
  readonly mainMenu = new MainMenu();
  readonly pauseMenu = new PauseMenu();
  readonly settingsModal = new SettingsModal();
  readonly controlsModal = new ControlsModal();
  readonly resultsModal = new ResultsModal();
  readonly loadingScreen = new LoadingScreen();
  readonly stats = new StatsCollector();

  /**
   * Per-render-frame HUD update.
   */
  update(
    gameState: GameState,
    countdownTimer: number,
    playerVehicle: VehicleEntity,
    worldSystem: WorldSystem,
    hasGhost: boolean,
    bestLapTime: number | null,
    dt: number,
    dtMs: number,
    renderer: THREE.WebGLRenderer
  ): void {
    // 1. Stats recording
    this.stats.record(dtMs);
    const n = playerVehicle.controller.surfaceNormal;
    const status = playerVehicle.controller.isGrounded ? 'GROUND' : 'AIR';
    this.stats.gravityLabel = `[${status}] N:(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) | ${(playerVehicle.controller.speed * 3.6).toFixed(0)} km/h`;

    // 2. Debug Overlay update
    if (this.debugOverlay.isVisible) {
      this.debugOverlay.update(this.stats, renderer, dt);
    }

    // 3. Telemetry HUD visibility
    if (gameState === GameState.COUNTDOWN || gameState === GameState.RACING) {
      this.raceHUD.show();
      if (gameState === GameState.COUNTDOWN || countdownTimer > -1.0) {
        this.raceHUD.updateCountdown(countdownTimer);
      } else {
        this.raceHUD.updateCountdown(-999);
      }

      this.raceHUD.update({
        currentLapTime: playerVehicle.progress.currentLapTime,
        bestLapTime,
        lapCount: playerVehicle.progress.lapCount,
        activeCheckpoint: playerVehicle.progress.activeCheckpointIndex,
        totalCheckpoints: worldSystem.track.checkpoints.length,
        speedKmh: playerVehicle.controller.speed * 3.6,
        boostCharge: playerVehicle.boost.charge,
        isBoosting: playerVehicle.controller.boostActive,
        hasGhost,
        isInverted: worldSystem.inversion.isInverted,
        isWrongWay: playerVehicle.progress.isWrongWay,
        dt,
      });
    } else {
      this.raceHUD.hide();
    }
  }
}
