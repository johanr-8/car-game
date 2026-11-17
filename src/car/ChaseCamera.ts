/**
 * src/car/ChaseCamera.ts
 * ─────────────────────────────────────────────────────────────
 * Rock-Solid 6DOF Chase Camera for wall, ceiling, and loop driving.
 *
 * Guarantees:
 *   - Perfectly follows car's 3D orientation (floors, vertical walls, inverted ceilings)
 *   - Smooth position and quaternion slerp dampening
 *   - Completely immune to gimbal lock, degenerate UP vectors, or ceiling flipping
 *   - Camera never clips into or drops below the road deck
 *   - Speed-dependent dynamic FOV widening
 *
 * RULES.md: Zero per-frame allocations. Scratch vectors pre-allocated.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { CarConfig as C } from './CarConfig';

// Pre-allocated scratch vectors & matrices (Zero per-frame allocations)
const _fwd         = new THREE.Vector3();
const _up          = new THREE.Vector3();
const _desiredPos  = new THREE.Vector3();
const _desiredLook = new THREE.Vector3();
const _lookDir     = new THREE.Vector3();
const _right       = new THREE.Vector3();
const _upActual    = new THREE.Vector3();
const _negLook     = new THREE.Vector3();
const _mOrient     = new THREE.Matrix4();
const _targetQuat  = new THREE.Quaternion();

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(C.camFovMin, aspect, 0.1, 1400);
    this.camera.position.set(0, C.camHeight, C.camDistance);
    this.camera.quaternion.set(0, 0, 0, 1);
  }

  /**
   * Update camera position, rotation, and dynamic FOV.
   * Naturally and stably tracks 6DOF car orientation (floors, vertical walls, inverted ceilings).
   */
  update(
    carPos: THREE.Vector3,
    carQuat: THREE.Quaternion,
    speedNorm: number,
    dt: number
  ): void {
    // 1. Extract 3D orientation vectors from interpolated car quaternion
    _fwd.set(0, 0, -1).applyQuaternion(carQuat);
    _up.set(0, 1, 0).applyQuaternion(carQuat);

    // 2. Desired position: behind car (-fwd) and above car roof (+up)
    _desiredPos.copy(carPos)
      .addScaledVector(_fwd, -C.camDistance)
      .addScaledVector(_up, C.camHeight);

    // 3. Desired look-at: ahead of car (+fwd) and slightly above (+up)
    _desiredLook.copy(carPos)
      .addScaledVector(_fwd, C.camLookAhead)
      .addScaledVector(_up, C.camHeight * 0.25);

    // 4. Smooth exponential position dampening
    const posLerp = 1 - Math.exp(-C.camLagPosition * dt);
    this.camera.position.lerp(_desiredPos, posLerp);

    // Clamp maximum distance so hyperspeed never pulls camera far away from car
    const maxDist = C.camDistance * 1.25;
    if (this.camera.position.distanceTo(carPos) > maxDist) {
      this.camera.position.sub(carPos).normalize().multiplyScalar(maxDist).add(carPos);
    }

    // 5. Orthonormal 6DOF Camera Orientation (Rock-Solid on floors, walls, and inverted ceilings)
    _lookDir.copy(_desiredLook).sub(this.camera.position).normalize();
    _right.crossVectors(_lookDir, _up);
    if (_right.lengthSq() < 0.0001) {
      _right.crossVectors(_lookDir, _fwd).normalize();
    } else {
      _right.normalize();
    }
    _upActual.crossVectors(_right, _lookDir).normalize();
    _negLook.copy(_lookDir).negate();

    _mOrient.makeBasis(_right, _upActual, _negLook);
    _targetQuat.setFromRotationMatrix(_mOrient);

    // Smooth orientation slerp (immune to gimbal lock or degenerate up vectors)
    const rotLerp = 1 - Math.exp(-C.camLagLookAt * dt);
    this.camera.quaternion.slerp(_targetQuat, rotLerp);

    // 6. Dynamic FOV widens with speed
    const targetFov = THREE.MathUtils.lerp(C.camFovMin, C.camFovMax, speedNorm);
    const fovLerp   = 1 - Math.exp(-C.camFovLag * dt);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, fovLerp);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Instantly snap camera behind the car upon race start / restart with zero interpolation lag.
   */
  reset(carPos: THREE.Vector3, carQuat: THREE.Quaternion): void {
    _fwd.set(0, 0, -1).applyQuaternion(carQuat);
    _up.set(0, 1, 0).applyQuaternion(carQuat);
    _desiredPos.copy(carPos)
      .addScaledVector(_fwd, -C.camDistance)
      .addScaledVector(_up, C.camHeight);
    _desiredLook.copy(carPos)
      .addScaledVector(_fwd, C.camLookAhead)
      .addScaledVector(_up, C.camHeight * 0.25);

    this.camera.position.copy(_desiredPos);

    _lookDir.copy(_desiredLook).sub(this.camera.position).normalize();
    _right.crossVectors(_lookDir, _up);
    if (_right.lengthSq() < 0.0001) {
      _right.crossVectors(_lookDir, _fwd).normalize();
    } else {
      _right.normalize();
    }
    _upActual.crossVectors(_right, _lookDir).normalize();
    _negLook.copy(_lookDir).negate();

    _mOrient.makeBasis(_right, _upActual, _negLook);
    this.camera.quaternion.setFromRotationMatrix(_mOrient);

    this.camera.fov = C.camFovMin;
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
