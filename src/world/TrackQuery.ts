/**
 * src/world/TrackQuery.ts
 * ─────────────────────────────────────────────────────────────
 * Centralized High-Performance Track Spatial Query Service.
 *
 * Responsibilities:
 *   - Fast per-vehicle cached nearest-segment lookup
 *   - Track containment with airborne clamping bypass
 *   - Checkpoint plane-crossing validation (layer height rejection)
 *   - Wrong-way direction detection (forwardDot < 0 for 1.0s)
 *   - Continuous race ranking by progress U
 *
 * RULES.md: Zero per-frame allocations. All scratch vectors pre-allocated.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import type { TrackSpline, Checkpoint } from './TrackSpline';
import type { VehicleEntity } from '../car/VehicleEntity';

export interface TrackQueryResult {
  segmentIndex: number;
  u: number;
  centerPoint: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  lateralOffset: number;   // Signed distance along binormal (+right, -left)
  verticalOffset: number;  // Signed distance along normal (+up, -down)
  distanceSq: number;
  forwardDot: number;      // Dot product of vehicle forward with track tangent
  onTrack: boolean;        // Within road width and reasonable height
}

// Scratch objects for zero per-frame allocations
const _delta      = new THREE.Vector3();
const _fwdVec     = new THREE.Vector3();
const _cachedRes: TrackQueryResult = {
  segmentIndex: 0,
  u: 0,
  centerPoint: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  binormal: new THREE.Vector3(),
  lateralOffset: 0,
  verticalOffset: 0,
  distanceSq: 0,
  forwardDot: 1,
  onTrack: true,
};

export class TrackQuery {
  constructor(readonly track: TrackSpline) {}

  /**
   * Evaluates spatial position relative to track spline.
   * Employs localized search around vehicle's cached segment index with global fallback.
   * Zero heap allocations.
   */
  query(
    pos: THREE.Vector3,
    cachedSegment: number,
    forwardDir?: THREE.Vector3,
    outResult: TrackQueryResult = _cachedRes
  ): TrackQueryResult {
    const centerPoints = this.track.centerPoints;
    const n = this.track.segments;
    if (centerPoints.length === 0) return outResult;

    let bestIdx = ((cachedSegment % n) + n) % n;
    let bestDistSq = pos.distanceToSquared(centerPoints[bestIdx]);

    // 1. Localized search within +/- 25 segments
    const windowSize = 25;
    for (let offset = -windowSize; offset <= windowSize; offset++) {
      const idx = ((cachedSegment + offset) % n + n) % n;
      const dSq = pos.distanceToSquared(centerPoints[idx]);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }

    // 2. Global search fallback if vehicle drifted or respawned far away
    if (bestDistSq > 900) {
      for (let i = 0; i < n; i++) {
        const dSq = pos.distanceToSquared(centerPoints[i]);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    const cp = centerPoints[bestIdx];
    const tangent = this.track.tangents[bestIdx];
    const normal = this.track.normals[bestIdx];
    const binormal = this.track.binormals[bestIdx];

    _delta.copy(pos).sub(cp);
    const lateralOffset = _delta.dot(binormal);
    const verticalOffset = _delta.dot(normal);
    const forwardDot = forwardDir ? forwardDir.dot(tangent) : 1.0;
    const onTrack = Math.abs(lateralOffset) <= 7.0 && Math.abs(verticalOffset) <= 6.0;

    outResult.segmentIndex = bestIdx;
    outResult.u = bestIdx / n;
    outResult.centerPoint.copy(cp);
    outResult.tangent.copy(tangent);
    outResult.normal.copy(normal);
    outResult.binormal.copy(binormal);
    outResult.lateralOffset = lateralOffset;
    outResult.verticalOffset = verticalOffset;
    outResult.distanceSq = bestDistSq;
    outResult.forwardDot = forwardDot;
    outResult.onTrack = onTrack;

    return outResult;
  }

  /**
   * Lateral Barrier Containment with Airborne Bypass.
   * If vehicle is airborne, clamping is bypassed to allow natural jump arcs.
   */
  containVehicle(vehicle: VehicleEntity): void {
    // Phase F3 rule: Disable containCar() clamping while airborne!
    if (!vehicle.controller.isGrounded) return;

    _fwdVec.set(0, 0, -1).applyQuaternion(vehicle.controller.quaternion);
    const result = this.query(
      vehicle.controller.position,
      vehicle.progress.cachedNearestSegment,
      _fwdVec,
      _cachedRes
    );

    // Update per-vehicle cache & continuous progress
    vehicle.progress.cachedNearestSegment = result.segmentIndex;
    vehicle.progress.progressU = vehicle.progress.lapCount + result.u;

    const maxAllowedLat = 6.25; // 7.0m road half-width - 0.75m wheel margin
    if (Math.abs(result.lateralOffset) > maxAllowedLat) {
      const targetLat = Math.sign(result.lateralOffset) * maxAllowedLat;
      const correction = targetLat - result.lateralOffset;
      vehicle.controller.position.addScaledVector(result.binormal, correction);

      const latVel = vehicle.controller.velocity.dot(result.binormal);
      if (latVel * result.lateralOffset > 0) {
        vehicle.controller.velocity.addScaledVector(result.binormal, -latVel);
      }
    }
  }

  /**
   * Checkpoint Plane-Crossing Validation:
   * Replaces crude 3D spheres with a plane-crossing test along the track tangent
   * plus a lateral road bound and a vertical layer-height separation bound.
   * Prevents false triggers from adjacent or multi-layer track sections.
   */
  checkGateCrossing(carPos: THREE.Vector3, checkpoint: Checkpoint): boolean {
    if (!checkpoint) return false;

    _delta.copy(carPos).sub(checkpoint.position);

    // 1. Distance along gate tangent (forward racing direction)
    const tangentDist = _delta.dot(checkpoint.direction);
    // Must be in the gate plane crossing slice (-1.5m before to +3.5m after)
    if (tangentDist < -1.5 || tangentDist > 3.5) return false;

    // 2. Lateral road width bound (+/- 7.5m from road centerline)
    const lateralDist = Math.abs(_delta.dot(checkpoint.binormal));
    if (lateralDist > 7.5) return false;

    // 3. Vertical layer height bound (must be within 4.0m of the road surface)
    // REJECTS vehicles on upper elevated skyways or lower bridges!
    const verticalDist = Math.abs(_delta.dot(checkpoint.normal));
    if (verticalDist > 4.0) return false;

    return true;
  }

  /**
   * Evaluates wrong-way driving direction.
   * If forwardDot < -0.15 for 1.0 consecutive seconds, triggers wrong-way status.
   */
  updateWrongWay(vehicle: VehicleEntity, dt: number): boolean {
    _fwdVec.set(0, 0, -1).applyQuaternion(vehicle.controller.quaternion);
    const segIdx = vehicle.progress.cachedNearestSegment;
    const tangent = this.track.tangents[segIdx] || this.track.tangents[0];

    const forwardDot = _fwdVec.dot(tangent);

    if (forwardDot < -0.15 && Math.abs(vehicle.controller.speed) > 2.0) {
      vehicle.progress.wrongWayTimer += dt;
      if (vehicle.progress.wrongWayTimer >= 1.0) {
        vehicle.progress.isWrongWay = true;
      }
    } else if (forwardDot > 0.15) {
      vehicle.progress.wrongWayTimer = Math.max(0, vehicle.progress.wrongWayTimer - dt * 2.0);
      if (vehicle.progress.wrongWayTimer < 0.2) {
        vehicle.progress.isWrongWay = false;
      }
    }

    return vehicle.progress.isWrongWay;
  }
}
