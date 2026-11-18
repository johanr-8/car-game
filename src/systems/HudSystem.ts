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
import { RaceHUD, type RaceHUDUpdateParams } from '../ui/RaceHUD';
import { DebugOverlay } from '../ui/DebugOverlay';
import { PauseMenu } from '../ui/PauseMenu';
import { DevTuningPanel } from '../ui/DevTuningPanel';
import { MainMenu } from '../ui/MainMenu';
import { SettingsModal } from '../ui/SettingsModal';
import { ControlsModal } from '../ui/ControlsModal';
import { ResultsModal } from '../ui/ResultsModal';
import { LoadingScreen } from '../ui/LoadingScreen';
import { StatsCollector } from '../core/StatsCollector';
import { isDevMode } from '../core/DevMode';
import { SURFACE_CONFIG } from '../world/WorldConfig';
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

  private readonly hudUpdateParams: RaceHUDUpdateParams = {
    currentLapTime: 0,
    bestLapTime: null,
    lapCount: 1,
    activeCheckpoint: 0,
    totalCheckpoints: 8,
    speedKmh: 0,
    positionRank: 1,
    boostCharge: 0,
    isBoosting: false,
    hasGhost: false,
    isInverted: false,
    isWrongWay: false,
    dt: 0,
  };

  /**
   * Per-render-frame HUD update.
   */
  update(
    gameState: GameState,
    countdownTimer: number,
    playerVehicle: VehicleEntity,
    worldSystem: WorldSystem | null | undefined,
    hasGhost: boolean,
    bestLapTime: number | null,
    dt: number,
    dtMs: number,
    renderer: THREE.WebGLRenderer
  ): void {
    // 1. Stats recording
    this.stats.record(dtMs);
    if (this.debugOverlay.isVisible) {
      const n = playerVehicle.controller.surfaceNormal;
      const status = playerVehicle.controller.isGrounded ? 'GROUND' : 'AIR';
      this.stats.gravityLabel = `[${status}] N:(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) | ${(playerVehicle.controller.speed * 3.6).toFixed(0)} km/h`;
      const surfType = playerVehicle.controller.currentSurfaceType;
      const tuning = SURFACE_CONFIG[surfType];
      this.stats.surfaceLabel = tuning ? tuning.label : surfType;
    }

    // 2. Debug Overlay update
    if (this.debugOverlay.isVisible || isDevMode()) {
      this.debugOverlay.update(this.stats, renderer, dt);
    }

    // 3. Telemetry HUD visibility
    if (gameState === GameState.COUNTDOWN || gameState === GameState.RACING || gameState === GameState.ROAMING) {
      this.raceHUD.show();
      if (gameState === GameState.COUNTDOWN || (gameState !== GameState.ROAMING && countdownTimer > -1.0)) {
        this.raceHUD.updateCountdown(countdownTimer);
      } else {
        this.raceHUD.updateCountdown(-999);
      }

      const p = this.hudUpdateParams;
      p.currentLapTime = playerVehicle.progress.currentLapTime;
      p.bestLapTime = bestLapTime;
      p.lapCount = playerVehicle.progress.lapCount;
      p.activeCheckpoint = playerVehicle.progress.activeCheckpointIndex;
      p.totalCheckpoints = worldSystem ? worldSystem.track.checkpoints.length : 0;
      p.speedKmh = playerVehicle.controller.speed * 3.6;
      p.boostCharge = playerVehicle.boost.charge;
      p.isBoosting = playerVehicle.controller.boostActive;
      p.hasGhost = hasGhost;
      p.isInverted = worldSystem ? worldSystem.inversion.isInverted : false;
      p.isWrongWay = playerVehicle.progress.isWrongWay;
      p.dt = dt;

      this.raceHUD.update(p);
    } else {
      this.raceHUD.hide();
    }
  }
}
