/**
 * src/car/VehicleEntity.ts
 * ─────────────────────────────────────────────────────────────
 * Encapsulated Vehicle Entity owning physics, visuals, boost,
 * and individual race progress tracking.
 *
 * Designed to seamlessly support 1..N vehicles (player & AI).
 * RULES.md: Zero per-frame allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { ArcadeCarController } from './ArcadeCarController';
import { CarModel } from './CarModel';
import { BoostSystem } from './BoostSystem';
import type { InputState } from '../core/InputManager';
import type { CollisionWorld } from '../world/CollisionWorld';

export interface RaceProgress {
  activeCheckpointIndex: number;
  lapCount: number;
  currentLapTime: number;
  totalRaceTime: number;
  awaitingFinishLine: boolean;
  cachedNearestSegment: number;
  wrongWayTimer: number;
  isWrongWay: boolean;
  progressU: number; // Lap + normalized spline progress for ranking
  hasBarrierContact: boolean; // Barrier contact flag in current sector
  lapTimes: number[]; // Completed lap times in seconds
}

const _interpPos = new THREE.Vector3();
const _interpQuat = new THREE.Quaternion();

export class VehicleEntity {
  readonly id: string;
  readonly isPlayer: boolean;

  readonly controller: ArcadeCarController;
  readonly model: CarModel;
  readonly boost: BoostSystem;

  readonly progress: RaceProgress = {
    activeCheckpointIndex: 1,
    lapCount: 1,
    currentLapTime: 0,
    totalRaceTime: 0,
    awaitingFinishLine: false,
    cachedNearestSegment: 0,
    wrongWayTimer: 0,
    isWrongWay: false,
    progressU: 0,
    hasBarrierContact: false,
    lapTimes: [],
  };

  constructor(id: string = 'player', paintColor: number = 0xd41c1c, isPlayer: boolean = true) {
    this.id = id;
    this.isPlayer = isPlayer;

    this.controller = new ArcadeCarController();
    this.model = new CarModel(paintColor);
    this.boost = new BoostSystem();
  }

  /**
   * Resets vehicle state, velocity, boost, and lap progress to starting gate.
   */
  reset(startPos: THREE.Vector3, startQuat: THREE.Quaternion): void {
    this.controller.position.copy(startPos);
    this.controller.quaternion.copy(startQuat);
    this.controller.prevPosition.copy(startPos);
    this.controller.prevQuaternion.copy(startQuat);

    this.controller.velocity.set(0, 0, 0);
    this.controller.surfaceNormal.set(0, 1, 0);
    this.controller.speed = 0;
    this.controller.isGrounded = true;
    this.controller.isDrifting = false;
    this.controller.driftTransition = 0;
    this.controller.brakeDeadzoneTimer = 0;

    this.model.group.position.copy(startPos);
    this.model.group.quaternion.copy(startQuat);

    this.boost.charge = 50;

    this.progress.activeCheckpointIndex = 1;
    this.progress.lapCount = 1;
    this.progress.currentLapTime = 0;
    this.progress.totalRaceTime = 0;
    this.progress.awaitingFinishLine = false;
    this.progress.cachedNearestSegment = 0;
    this.progress.wrongWayTimer = 0;
    this.progress.isWrongWay = false;
    this.progress.progressU = 0;
    this.progress.hasBarrierContact = false;
    this.controller.hasBarrierContact = false;
    this.progress.lapTimes = [];
  }

  /**
   * 120Hz fixed-timestep physics update.
   */
  updatePhysics(dt: number, input: InputState, collision: CollisionWorld): void {
    // 1. Kinetic Boost Update
    const { isBoosting, boostForce } = this.boost.update(
      dt,
      input.boost,
      this.controller.isGrounded,
      this.controller.surfaceNormal.y,
      this.controller.speed,
      this.controller.isDrifting
    );
    this.controller.boostActive = isBoosting;
    this.controller.boostForce = boostForce;

    // 2. Step vehicle dynamics
    this.controller.update(dt, input, collision);

    // 3. Propagate barrier contact from controller collision probes
    if (this.controller.hasBarrierContact) {
      this.progress.hasBarrierContact = true;
    }
  }

  /**
   * Staging standstill update during countdown.
   */
  updateStaging(collision: CollisionWorld): void {
    this.controller.updateStaging(collision);
  }

  /**
   * Visual transform interpolation for α-rendering. Zero heap allocations.
   */
  updateVisuals(alpha: number, isBraking: boolean): void {
    _interpPos.lerpVectors(this.controller.prevPosition, this.controller.position, alpha);
    _interpQuat.slerpQuaternions(this.controller.prevQuaternion, this.controller.quaternion, alpha);

    this.model.group.position.copy(_interpPos);
    this.model.group.quaternion.copy(_interpQuat);
    this.model.updateVisuals(this.controller.steerVisual, isBraking);
  }
}
