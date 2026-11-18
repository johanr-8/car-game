/**
 * src/systems/VehicleSystem.ts
 * ─────────────────────────────────────────────────────────────
 * Vehicle Management System:
 *   - Owns vehicles array (player & future AI rivals)
 *   - Chase camera follow
 *   - Ghost telemetry recording and replay
 *   - Multi-vehicle physics step, containment & void rescue
 *
 * RULES.md: Zero per-frame allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { VehicleEntity } from '../car/VehicleEntity';
import { ChaseCamera } from '../car/ChaseCamera';
import { GhostRecorder } from '../car/GhostRecorder';
import { GhostModel } from '../car/GhostModel';
import type { InputState } from '../core/InputManager';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { TrackQuery } from '../world/TrackQuery';

const _ghostPos = new THREE.Vector3();
const _ghostQuat = new THREE.Quaternion();
const _rescuePos = new THREE.Vector3();

export class VehicleSystem {
  readonly scene: THREE.Scene;
  readonly vehicles: VehicleEntity[] = [];
  readonly playerVehicle: VehicleEntity;

  readonly ghostRecorder = new GhostRecorder();
  readonly ghostModel = new GhostModel();
  readonly chaseCamera: ChaseCamera;

  constructor(scene: THREE.Scene, aspect: number) {
    this.scene = scene;

    // 1. Primary Player Vehicle (Rosso Corsa Supercar)
    this.playerVehicle = new VehicleEntity('player', 0xd41c1c, true);
    this.addVehicle(this.playerVehicle);

    // 2. Ghost Model for Best Lap Telemetry
    this.scene.add(this.ghostModel.group);

    // 3. 6DOF Chase Camera
    this.chaseCamera = new ChaseCamera(aspect);
    this.scene.add(this.chaseCamera.camera);
  }

  addVehicle(vehicle: VehicleEntity): void {
    this.vehicles.push(vehicle);
    this.scene.add(vehicle.model.group);
  }

  /**
   * Resets vehicle transforms to grid start and snaps camera.
   */
  resetAll(startPos: THREE.Vector3, startQuat: THREE.Quaternion): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      this.vehicles[i].reset(startPos, startQuat);
    }
    this.chaseCamera.reset(startPos, startQuat);
  }

  /**
   * 120Hz physics update across all vehicles.
   */
  updatePhysics(
    dt: number,
    playerInput: InputState,
    collision: CollisionWorld,
    trackQuery: TrackQuery
  ): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const input = v.isPlayer ? playerInput : playerInput; // Future: AI controller input

      // 1. Vehicle dynamics & boost step
      v.updatePhysics(dt, input, collision);

      // 2. Track containment (bypassed if airborne)
      trackQuery.containVehicle(v);

      // 3. Apex inside curb clipping bonus (+3%)
      trackQuery.checkApexBonus(v);

      // 4. Wrong-way detection
      trackQuery.updateWrongWay(v, dt);

      // 4. Void Fail-Safe Rescue
      if (v.controller.position.y < -5) {
        const rescueIdx = v.progress.activeCheckpointIndex > 0 ? v.progress.activeCheckpointIndex - 1 : 0;
        const cp = trackQuery.track.checkpoints[rescueIdx];
        if (cp) {
          _rescuePos.copy(cp.position).addScaledVector(cp.normal, 0.35);
          v.controller.position.copy(_rescuePos);
          v.controller.prevPosition.copy(_rescuePos);
          v.controller.velocity.set(0, 0, 0);
          v.controller.speed = 0;
        }
      }
    }
  }

  /**
   * Staging standstill update during countdown.
   */
  updateStaging(collision: CollisionWorld, trackQuery: TrackQuery): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      v.updateStaging(collision);
      trackQuery.containVehicle(v);
    }
  }

  /**
   * Visual interpolation and camera update.
   */
  updateVisuals(alpha: number, dt: number, isBraking: boolean, isRacing: boolean): void {
    // 1. Visual transform interpolation
    for (let i = 0; i < this.vehicles.length; i++) {
      this.vehicles[i].updateVisuals(alpha, isBraking);
    }

    // 2. Ghost Car replay
    if (this.ghostRecorder.hasBestLap && isRacing) {
      this.ghostModel.setVisible(true);
      const hasFrame = this.ghostRecorder.getGhostTransform(
        this.playerVehicle.progress.currentLapTime,
        _ghostPos,
        _ghostQuat
      );
      if (hasFrame) {
        this.ghostModel.group.position.copy(_ghostPos);
        this.ghostModel.group.quaternion.copy(_ghostQuat);
      }
    } else {
      this.ghostModel.setVisible(false);
    }

    // 3. 6DOF chase camera follow
    this.chaseCamera.update(
      this.playerVehicle.controller.position,
      this.playerVehicle.controller.quaternion,
      this.playerVehicle.controller.speedNorm,
      dt
    );
  }
}
