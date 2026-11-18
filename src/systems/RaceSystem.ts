/**
 * src/systems/RaceSystem.ts
 * ─────────────────────────────────────────────────────────────
 * Race Progression & Game State Machine:
 *   - States: MENU, COUNTDOWN, RACING, FINISHED, PAUSED
 *   - Unified restartRace() reset function
 *   - Plane-crossing checkpoint gates with layer height checks
 *   - Lap records & 3-lap victory trigger
 *   - ESC pause menu orchestration
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { GameState } from './GameState';
import { audioEngine } from '../audio';
import type { WorldSystem } from './WorldSystem';
import type { VehicleSystem } from './VehicleSystem';
import type { HudSystem } from './HudSystem';
import type { InputState } from '../core/InputManager';

const START_POS = new THREE.Vector3(0, 0.94, 25);
const START_QUAT = new THREE.Quaternion(0, 0, 0, 1);

export class RaceSystem {
  gameState: GameState = GameState.COUNTDOWN;
  previousState: GameState = GameState.COUNTDOWN;
  countdownTimer = 3.0; // 3-2-1-GO!

  constructor(
    readonly worldSystem: WorldSystem,
    readonly vehicleSystem: VehicleSystem,
    readonly hudSystem: HudSystem,
    readonly renderer: THREE.WebGLRenderer
  ) {
    // Wire UI callbacks
    this.hudSystem.raceHUD.onRestartRace = () => this.restartRace();
    this.hudSystem.raceHUD.onRemixCity = () => this.remixCity();

    this.hudSystem.pauseMenu.onResume = () => this.resume();
    this.hudSystem.pauseMenu.onRestart = () => this.restartRace();
    this.hudSystem.pauseMenu.onBriefing = () => {
      this.hudSystem.pauseMenu.hide();
      this.hudSystem.raceHUD.toggleBriefing(true);
    };
    this.hudSystem.pauseMenu.onRemix = () => this.remixCity();

    // Escape key listener for pausing
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.togglePause();
      }
    });

    this.restartRace();
  }

  setGameState(newState: GameState): void {
    if (this.gameState === newState) return;
    this.previousState = this.gameState;
    this.gameState = newState;

    if (newState === GameState.PAUSED) {
      this.hudSystem.pauseMenu.show();
      audioEngine.setGamePaused(true);
    } else {
      this.hudSystem.pauseMenu.hide();
      audioEngine.setGamePaused(false);
    }
  }

  togglePause(): void {
    if (this.gameState === GameState.PAUSED) {
      this.resume();
    } else if (this.gameState === GameState.RACING || this.gameState === GameState.COUNTDOWN) {
      this.pause();
    }
  }

  pause(): void {
    this.setGameState(GameState.PAUSED);
  }

  resume(): void {
    const resumeTo = (this.previousState === GameState.RACING || this.previousState === GameState.COUNTDOWN)
      ? this.previousState
      : GameState.RACING;
    this.setGameState(resumeTo);
  }

  /**
   * Unified reset: restores vehicles, checkpoints, timers, and cameras through one single pipeline.
   */
  restartRace(): void {
    this.vehicleSystem.resetAll(START_POS, START_QUAT);
    this.worldSystem.track.resetCheckpoints();

    this.countdownTimer = 3.0;
    this.setGameState(GameState.COUNTDOWN);

    this.hudSystem.raceHUD.hideVictory();
    this.hudSystem.pauseMenu.hide();

    this.vehicleSystem.ghostRecorder.startLap();
    this.vehicleSystem.ghostModel.setVisible(this.vehicleSystem.ghostRecorder.hasBestLap);
  }

  remixCity(): void {
    this.worldSystem.remixCity(this.renderer);
    this.hudSystem.raceHUD.setSeedBadge(
      this.worldSystem.currentSeed,
      this.worldSystem.currentTheme.name,
      this.worldSystem.isDaily
    );
    this.restartRace();
  }

  /**
   * Fixed 120Hz physics update for race lifecycle.
   */
  updatePhysics(dt: number, input: InputState): void {
    // 0. Frozen while paused
    if (this.gameState === GameState.PAUSED) return;

    // 1. Staging Countdown
    if (this.gameState === GameState.COUNTDOWN) {
      const prevSecond = Math.ceil(this.countdownTimer);
      this.countdownTimer -= dt;
      const currentSecond = Math.ceil(this.countdownTimer);

      if (currentSecond < prevSecond && currentSecond > 0 && currentSecond <= 3) {
        audioEngine.playCountdownBeep(false);
      }

      if (this.countdownTimer <= 0) {
        this.countdownTimer = -0.7; // 'GO!' banner active
        audioEngine.playCountdownBeep(true);
        this.setGameState(GameState.RACING);
      }
      this.vehicleSystem.updateStaging(this.worldSystem.collisionWorld, this.worldSystem.trackQuery);
      return;
    }

    if (this.countdownTimer > -1.0) {
      this.countdownTimer -= dt;
    }

    // 2. Active Racing Physics
    if (this.gameState === GameState.RACING) {
      this.vehicleSystem.updatePhysics(
        dt,
        input,
        this.worldSystem.collisionWorld,
        this.worldSystem.trackQuery
      );

      // Checkpoint passing & lap evaluation for each vehicle
      for (let i = 0; i < this.vehicleSystem.vehicles.length; i++) {
        const v = this.vehicleSystem.vehicles[i];
        v.progress.currentLapTime += dt;
        v.progress.totalRaceTime += dt;

        if (v.isPlayer) {
          this.vehicleSystem.ghostRecorder.recordFrame(v.controller.position, v.controller.quaternion);

          // Boost refill notification
          if (v.boost.refillEventTimer > 1.3 && v.boost.lastRefillReason) {
            this.hudSystem.raceHUD.showTrickPopup(v.boost.lastRefillReason);
          }
        }

        const targetCP = this.worldSystem.track.checkpoints[v.progress.activeCheckpointIndex];
        if (this.worldSystem.trackQuery.checkGateCrossing(v.controller.position, targetCP)) {
          if (!v.progress.awaitingFinishLine) {
            v.progress.activeCheckpointIndex++;
            if (v.progress.activeCheckpointIndex >= this.worldSystem.track.checkpoints.length) {
              v.progress.activeCheckpointIndex = 0;
              v.progress.awaitingFinishLine = true;
            }
            if (v.isPlayer) {
              this.worldSystem.track.updateGateVisuals(v.progress.activeCheckpointIndex);
              audioEngine.playCheckpointChime();
            }
          } else if (v.progress.activeCheckpointIndex === 0) {
            // Lap complete!
            let isRecord = false;
            if (v.isPlayer) {
              isRecord = this.vehicleSystem.ghostRecorder.finishLap(v.progress.currentLapTime);
              audioEngine.playLapComplete(isRecord);
              const m = Math.floor(v.progress.currentLapTime / 60);
              const s = (v.progress.currentLapTime % 60).toFixed(2).padStart(5, '0');
              const timeStr = `${m}:${s}`;
              const msg = isRecord ? `★ NEW RECORD: ${timeStr} ★` : `LAP ${v.progress.lapCount} COMPLETE: ${timeStr}`;
              this.hudSystem.raceHUD.showLapNotification(msg, isRecord);
            }

            if (v.progress.lapCount >= 3) {
              // Championship victory!
              this.setGameState(GameState.FINISHED);
              if (v.isPlayer) {
                this.hudSystem.raceHUD.showVictory(
                  1,
                  v.progress.totalRaceTime,
                  this.vehicleSystem.ghostRecorder.bestLapTime
                );
              }
            } else {
              v.progress.lapCount++;
              v.progress.currentLapTime = 0;
              v.progress.awaitingFinishLine = false;
              v.progress.activeCheckpointIndex = 1;
              if (v.isPlayer) {
                this.worldSystem.track.resetCheckpoints();
                this.vehicleSystem.ghostRecorder.startLap();
                this.vehicleSystem.ghostModel.setVisible(this.vehicleSystem.ghostRecorder.hasBestLap);
              }
            }
          }
        }
      }
    } else if (this.gameState === GameState.FINISHED) {
      // Natural rolling deceleration after finish
      this.vehicleSystem.updatePhysics(
        dt,
        { ...input, throttle: 0, boost: false },
        this.worldSystem.collisionWorld,
        this.worldSystem.trackQuery
      );
    }
  }
}
