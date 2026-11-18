/**
 * src/systems/RaceSystem.ts
 * ─────────────────────────────────────────────────────────────
 * Game State Machine & Mode Orchestrator:
 *   - Modes: RACE (Championship time trial) | ROAM (Free Roam sandbox)
 *   - States: MENU, COUNTDOWN, RACING, ROAMING, FINISHED, PAUSED
 *   - Main menu, pause menu, settings, controls, results orchestration
 *   - GPU shader warm-up before race countdown
 *   - Race rules: plane-crossing gates, clean sector & apex rewards, 3-lap victory
 *   - Roam rules: sandbox traversal, R respawns, y < -50 void fail-safe, no race systems
 *   - Conflict-free Escape, R, M, and F-key routing
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GameState, GameMode } from './GameState';
import { WorldSystem } from './WorldSystem';
import type { VehicleSystem } from './VehicleSystem';
import type { HudSystem } from './HudSystem';
import { RoamWorld, ROAM_SPAWN_POS, ROAM_SPAWN_QUAT } from '../world/RoamWorld';
import { CITY_THEMES } from '../world/TimeOfDay';
import { SeededRandom } from '../core/SeededRandom';
import type { InputState } from '../core/InputManager';
import { settings, type GraphicsQuality } from '../core/Settings';

const START_POS = new THREE.Vector3(0, 0.94, 25);
const START_QUAT = new THREE.Quaternion(0, 0, 0, 1);

export class RaceSystem {
  gameMode: GameMode = GameMode.RACE;
  gameState: GameState = GameState.MENU;
  previousState: GameState = GameState.MENU;
  countdownTimer = 3.0; // 3-2-1-GO!

  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly vehicleSystem: VehicleSystem;
  readonly hudSystem: HudSystem;
  readonly composer?: EffectComposer;

  worldSystem: WorldSystem | null = null;
  roamWorld: RoamWorld | null = null;

  constructor(
    sceneOrWorld: THREE.Scene | WorldSystem,
    rendererOrVehicles: THREE.WebGLRenderer | VehicleSystem,
    vehicleOrHud: VehicleSystem | HudSystem,
    hudOrRenderer: HudSystem | THREE.WebGLRenderer,
    composer?: EffectComposer
  ) {
    if ('scene' in sceneOrWorld && 'track' in sceneOrWorld) {
      // Legacy signature: (worldSystem, vehicleSystem, hudSystem, renderer, composer)
      this.worldSystem = sceneOrWorld as WorldSystem;
      this.scene = this.worldSystem.scene;
      this.vehicleSystem = rendererOrVehicles as VehicleSystem;
      this.hudSystem = vehicleOrHud as HudSystem;
      this.renderer = hudOrRenderer as THREE.WebGLRenderer;
      this.composer = composer;
    } else {
      // Primary signature: (scene, renderer, vehicleSystem, hudSystem, composer)
      this.scene = sceneOrWorld as THREE.Scene;
      this.renderer = rendererOrVehicles as THREE.WebGLRenderer;
      this.vehicleSystem = vehicleOrHud as VehicleSystem;
      this.hudSystem = hudOrRenderer as HudSystem;
      this.composer = composer;
    }

    // 1. Wire Main Menu callbacks
    this.hudSystem.mainMenu.onPlay = () => this.startRaceWithWarmUp();
    this.hudSystem.mainMenu.onRoam = () => this.startRoam();
    this.hudSystem.mainMenu.onSettings = () => this.hudSystem.settingsModal.show();
    this.hudSystem.mainMenu.onControls = () => this.hudSystem.controlsModal.show();

    // 2. Wire Pause Menu callbacks
    this.hudSystem.pauseMenu.onResume = () => this.resume();
    this.hudSystem.pauseMenu.onRestart = () => {
      if (this.gameMode === GameMode.ROAM) {
        this.respawnRoam();
      } else {
        this.restartRace();
      }
    };
    this.hudSystem.pauseMenu.onSettings = () => this.hudSystem.settingsModal.show();
    this.hudSystem.pauseMenu.onQuit = () => this.goToMenu();

    // 3. Wire Results Modal callbacks
    this.hudSystem.resultsModal.onRestart = () => this.restartRace();
    this.hudSystem.resultsModal.onRemix = () => this.remixCity();
    this.hudSystem.resultsModal.onMenu = () => this.goToMenu();

    // 4. Wire Settings Modal callbacks
    this.hudSystem.settingsModal.onGraphicsChanged = q => this.applyGraphicsQuality(q);
    this.hudSystem.settingsModal.onCameraComfortChanged = c => {
      this.vehicleSystem.chaseCamera.comfortMode = c;
    };

    // 5. Wire In-Game HUD callbacks
    this.hudSystem.raceHUD.onRestartRace = () => {
      if (this.gameMode === GameMode.ROAM) {
        this.respawnRoam();
      } else {
        this.restartRace();
      }
    };
    this.hudSystem.raceHUD.onRemixCity = () => {
      if (this.gameMode === GameMode.RACE) {
        this.remixCity();
      }
    };

    // 6. Escape key listener for clean modal closing and pausing
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        e.preventDefault();

        if (this.hudSystem.settingsModal.isVisible) {
          this.hudSystem.settingsModal.close();
        } else if (this.hudSystem.controlsModal.isVisible) {
          this.hudSystem.controlsModal.hide();
        } else if (this.gameState === GameState.PAUSED) {
          this.resume();
        } else if (
          this.gameState === GameState.RACING ||
          this.gameState === GameState.COUNTDOWN ||
          this.gameState === GameState.ROAMING
        ) {
          this.pause();
        }
      }
    });

    // 7. Apply saved graphics & camera comfort on boot
    this.applyGraphicsQuality(settings.data.graphicsQuality);
    this.vehicleSystem.chaseCamera.comfortMode = settings.data.cameraComfort;

    // Start in Main Menu
    this.goToMenu();
  }

  ensureRaceWorld(): WorldSystem {
    if (this.roamWorld) {
      this.roamWorld.removeFromScene(this.scene);
    }
    if (!this.worldSystem) {
      this.worldSystem = new WorldSystem(this.scene, this.renderer);
    } else {
      this.scene.add(this.worldSystem.track.group);
      this.scene.add(this.worldSystem.city.visualGroup);
      this.scene.add(this.worldSystem.inversion.visualGroup);
      this.scene.add(this.worldSystem.sunLight);
      this.scene.add(this.worldSystem.hemiLight);
      this.scene.add(this.worldSystem.fillLight);
      this.worldSystem.applyTheme(this.worldSystem.currentTheme, this.renderer);
    }
    return this.worldSystem;
  }

  ensureRoamWorld(): RoamWorld {
    if (this.worldSystem) {
      this.scene.remove(this.worldSystem.track.group);
      this.scene.remove(this.worldSystem.city.visualGroup);
      this.scene.remove(this.worldSystem.inversion.visualGroup);
      this.scene.remove(this.worldSystem.sunLight);
      this.scene.remove(this.worldSystem.hemiLight);
      this.scene.remove(this.worldSystem.fillLight);
    }
    if (!this.roamWorld) {
      this.roamWorld = new RoamWorld(this.scene, this.renderer);
    }
    this.roamWorld.addToScene(this.scene);
    this.roamWorld.applyAtmosphere(this.renderer);
    return this.roamWorld;
  }

  setGameState(newState: GameState): void {
    if (this.gameState === newState) return;
    this.previousState = this.gameState;
    this.gameState = newState;

    if (newState === GameState.PAUSED) {
      this.hudSystem.pauseMenu.show();
    } else {
      this.hudSystem.pauseMenu.hide();
    }

    if (newState === GameState.MENU) {
      const seed = this.worldSystem ? this.worldSystem.currentSeed : SeededRandom.getDailySeed();
      const themeName = this.worldSystem ? this.worldSystem.currentTheme.name : CITY_THEMES[0].name;
      this.hudSystem.mainMenu.updateInfo(
        seed,
        themeName,
        settings.data.bestTotalTime
      );
      this.hudSystem.mainMenu.show();
    } else {
      this.hudSystem.mainMenu.hide();
    }

    if (newState !== GameState.FINISHED) {
      this.hudSystem.resultsModal.hide();
    }
  }

  togglePause(): void {
    if (this.gameState === GameState.PAUSED) {
      this.resume();
    } else if (
      this.gameState === GameState.RACING ||
      this.gameState === GameState.COUNTDOWN ||
      this.gameState === GameState.ROAMING
    ) {
      this.pause();
    }
  }

  pause(): void {
    this.setGameState(GameState.PAUSED);
  }

  resume(): void {
    if (this.gameMode === GameMode.ROAM) {
      this.setGameState(GameState.ROAMING);
      return;
    }
    const resumeTo = (this.previousState === GameState.RACING || this.previousState === GameState.COUNTDOWN)
      ? this.previousState
      : GameState.RACING;
    this.setGameState(resumeTo);
  }

  goToMenu(): void {
    this.setGameState(GameState.MENU);
    this.hudSystem.pauseMenu.hide();
    this.hudSystem.resultsModal.hide();
    this.hudSystem.settingsModal.close();
    this.hudSystem.controlsModal.hide();
    this.hudSystem.raceHUD.hide();

    const seed = this.worldSystem ? this.worldSystem.currentSeed : SeededRandom.getDailySeed();
    const themeName = this.worldSystem ? this.worldSystem.currentTheme.name : CITY_THEMES[0].name;

    this.hudSystem.mainMenu.updateInfo(
      seed,
      themeName,
      settings.data.bestTotalTime
    );
    this.hudSystem.mainMenu.show();
  }

  /**
   * Starts Free Roam sandbox mode.
   */
  startRoam(): void {
    this.gameMode = GameMode.ROAM;
    this.countdownTimer = -999;
    this.hudSystem.raceHUD.setMode(GameMode.ROAM);

    this.hudSystem.mainMenu.hide();
    this.hudSystem.pauseMenu.hide();
    this.hudSystem.resultsModal.hide();
    this.hudSystem.settingsModal.close();
    this.hudSystem.controlsModal.hide();

    // Ensure Roam World scene is mounted
    this.ensureRoamWorld();

    // Reset vehicle and camera at Roam spawn point
    this.vehicleSystem.resetAll(ROAM_SPAWN_POS, ROAM_SPAWN_QUAT);

    this.setGameState(GameState.ROAMING);
  }

  /**
   * Respawns car at Free Roam spawn point.
   */
  respawnRoam(): void {
    this.countdownTimer = -999;
    this.vehicleSystem.respawnRoam();
    if (this.gameState === GameState.PAUSED) {
      this.resume();
    }
  }

  /**
   * Starts race from Main Menu with GPU shader warm-up.
   */
  async startRaceWithWarmUp(): Promise<void> {
    this.gameMode = GameMode.RACE;
    this.hudSystem.raceHUD.setMode(GameMode.RACE);

    this.hudSystem.mainMenu.hide();
    this.hudSystem.settingsModal.close();
    this.hudSystem.controlsModal.hide();

    const ws = this.ensureRaceWorld();
    this.vehicleSystem.initRaceGhosts();

    this.vehicleSystem.resetAll(START_POS, START_QUAT);
    ws.track.resetCheckpoints();

    // 1. Warm-up GPU shaders and compile materials
    await this.hudSystem.loadingScreen.warmUp(
      this.renderer,
      ws.scene,
      this.vehicleSystem.chaseCamera.camera
    );

    // 2. Begin 3-2-1 Countdown
    this.countdownTimer = 3.0;
    this.setGameState(GameState.COUNTDOWN);

    if (this.vehicleSystem.ghostRecorder) {
      this.vehicleSystem.ghostRecorder.startLap();
      if (this.vehicleSystem.ghostModel) {
        this.vehicleSystem.ghostModel.setVisible(this.vehicleSystem.ghostRecorder.hasBestLap);
      }
    }
  }

  /**
   * Unified reset for race or roam.
   */
  restartRace(): void {
    if (this.gameMode === GameMode.ROAM) {
      this.respawnRoam();
      return;
    }

    this.hudSystem.mainMenu.hide();
    this.hudSystem.pauseMenu.hide();
    this.hudSystem.resultsModal.hide();
    this.hudSystem.settingsModal.close();
    this.hudSystem.controlsModal.hide();

    const ws = this.ensureRaceWorld();
    this.vehicleSystem.initRaceGhosts();

    this.vehicleSystem.resetAll(START_POS, START_QUAT);
    ws.track.resetCheckpoints();

    this.countdownTimer = 3.0;
    this.setGameState(GameState.COUNTDOWN);

    if (this.vehicleSystem.ghostRecorder) {
      this.vehicleSystem.ghostRecorder.startLap();
      if (this.vehicleSystem.ghostModel) {
        this.vehicleSystem.ghostModel.setVisible(this.vehicleSystem.ghostRecorder.hasBestLap);
      }
    }
  }

  async remixCity(): Promise<void> {
    if (this.gameMode !== GameMode.RACE) return;
    const ws = this.ensureRaceWorld();
    ws.remixCity(this.renderer);
    this.hudSystem.raceHUD.setSeedBadge(
      ws.currentSeed,
      ws.currentTheme.name,
      ws.isDaily
    );

    this.applyGraphicsQuality(settings.data.graphicsQuality);

    if (this.gameState === GameState.MENU) {
      this.hudSystem.mainMenu.updateInfo(
        ws.currentSeed,
        ws.currentTheme.name,
        settings.data.bestTotalTime
      );
    } else {
      await this.startRaceWithWarmUp();
    }
  }

  /**
   * Applies graphics quality preset to renderer, shadows, bloom, and resolution scale.
   */
  applyGraphicsQuality(quality: GraphicsQuality): void {
    const sun = this.worldSystem ? this.worldSystem.sunLight : (this.roamWorld ? this.roamWorld.sunLight : null);
    const bloomPass = (this.composer as any)?.bloomPass;

    switch (quality) {
      case 'high':
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if (sun) {
          sun.castShadow = true;
          sun.shadow.mapSize.set(2048, 2048);
          if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
          }
        }
        if (bloomPass) bloomPass.enabled = true;
        if (typeof window !== 'undefined') {
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
        }
        break;

      case 'medium':
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        if (sun) {
          sun.castShadow = true;
          sun.shadow.mapSize.set(1024, 1024);
          if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
          }
        }
        if (bloomPass) bloomPass.enabled = true;
        if (typeof window !== 'undefined') {
          this.renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 0.9, 1.5));
        }
        break;

      case 'low':
        this.renderer.shadowMap.enabled = false;
        if (sun) sun.castShadow = false;
        if (bloomPass) bloomPass.enabled = false;
        this.renderer.setPixelRatio(0.75);
        break;
    }
  }

  /**
   * Fixed 120Hz physics update for active lifecycle.
   */
  updatePhysics(dt: number, input: InputState): void {
    // 0. Frozen while paused or in main menu
    if (this.gameState === GameState.PAUSED || this.gameState === GameState.MENU) return;

    // ── 1. Free Roam Physics ──
    if (this.gameMode === GameMode.ROAM) {
      if (this.gameState === GameState.ROAMING && this.roamWorld) {
        this.vehicleSystem.updatePhysics(dt, input, this.roamWorld);
        const player = this.vehicleSystem.playerVehicle;
        if (player.controller.position.y < -50) {
          this.respawnRoam();
        }
      }
      return;
    }

    // ── 2. Active Race Physics ──
    if (!this.worldSystem) return;

    // Staging Countdown
    if (this.gameState === GameState.COUNTDOWN) {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.countdownTimer = -0.7; // 'GO!' banner active
        this.setGameState(GameState.RACING);
      }
      this.vehicleSystem.updateStaging(this.worldSystem.collisionWorld, this.worldSystem.trackQuery);
      return;
    }

    if (this.countdownTimer > -1.0) {
      this.countdownTimer -= dt;
    }

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

        if (v.isPlayer && this.vehicleSystem.ghostRecorder) {
          this.vehicleSystem.ghostRecorder.recordFrame(v.controller.position, v.controller.quaternion);

          // Boost refill notification
          if (v.boost.refillEventTimer > 1.3 && v.boost.lastRefillReason) {
            const color = v.boost.lastRefillReason === 'APEX CURB'
              ? 'rgba(245, 158, 11, 0.95)'
              : v.boost.lastRefillReason === 'CLEAN SECTOR'
              ? 'rgba(16, 185, 129, 0.95)'
              : undefined;
            this.hudSystem.raceHUD.showTrickPopup(v.boost.lastRefillReason, color);
          }
        }

        const targetCP = this.worldSystem.track.checkpoints[v.progress.activeCheckpointIndex];
        if (this.worldSystem.trackQuery.checkGateCrossing(v.controller.position, targetCP)) {
          // Clean sector skill reward (+10%)
          if (!v.progress.hasBarrierContact) {
            v.boost.triggerCleanSector();
            if (v.isPlayer) {
              this.hudSystem.raceHUD.showTrickPopup('CLEAN SECTOR +10%', 'rgba(16, 185, 129, 0.95)');
            }
          }
          v.progress.hasBarrierContact = false;
          v.controller.hasBarrierContact = false;

          if (!v.progress.awaitingFinishLine) {
            v.progress.activeCheckpointIndex++;
            if (v.progress.activeCheckpointIndex >= this.worldSystem.track.checkpoints.length) {
              v.progress.activeCheckpointIndex = 0;
              v.progress.awaitingFinishLine = true;
            }
            if (v.isPlayer) {
              this.worldSystem.track.updateGateVisuals(v.progress.activeCheckpointIndex);
            }
          } else if (v.progress.activeCheckpointIndex === 0) {
            // Lap complete!
            v.progress.lapTimes.push(v.progress.currentLapTime);

            let isRecord = false;
            if (v.isPlayer) {
              if (this.vehicleSystem.ghostRecorder) {
                isRecord = this.vehicleSystem.ghostRecorder.finishLap(v.progress.currentLapTime);
              }
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
                this.hudSystem.raceHUD.hide();
                this.hudSystem.resultsModal.showResults(
                  v.progress.totalRaceTime,
                  v.progress.lapTimes,
                  this.vehicleSystem.ghostRecorder ? this.vehicleSystem.ghostRecorder.bestLapTime : null,
                  this.worldSystem.currentSeed
                );
              }
            } else {
              v.progress.lapCount++;
              v.progress.currentLapTime = 0;
              v.progress.awaitingFinishLine = false;
              v.progress.activeCheckpointIndex = 1;
              if (v.isPlayer) {
                this.worldSystem.track.resetCheckpoints();
                if (this.vehicleSystem.ghostRecorder) {
                  this.vehicleSystem.ghostRecorder.startLap();
                  if (this.vehicleSystem.ghostModel) {
                    this.vehicleSystem.ghostModel.setVisible(this.vehicleSystem.ghostRecorder.hasBestLap);
                  }
                }
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
