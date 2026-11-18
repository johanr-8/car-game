/**
 * src/car/ArcadeCarController.ts
 * ─────────────────────────────────────────────────────────────
 * Rock-Solid 6DOF Surface-Sticking Arcade Car Controller.
 *
 * Guarantees:
 *   - Snappy, responsive controls (WASD/Arrows) that never lock up
 *   - Local-axis steering that feels completely natural on floors, walls & ceilings
 *   - Continuous 6DOF surface normal snapping: glues car to floors, vertical walls & inverted ceilings
 *   - Tangential velocity integration: zero floor snagging or clipping
 *   - Obstacle detection with smooth wall deflection
 *   - Nitro Boost acceleration and Gravity Flip status effects
 *
 * RULES.md: Zero per-frame allocations. 120Hz fixed-timestep.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { CarConfig as C } from './CarConfig';
import type { InputState } from '../core/InputManager';
import type { SurfaceProvider, SurfaceHit } from '../world/SurfaceProvider';
import { SurfaceType, SURFACE_CONFIG } from '../world/WorldConfig';

// Pre-allocated scratch objects (Zero per-frame allocations)
const _fwd          = new THREE.Vector3();
const _up           = new THREE.Vector3();
const _right        = new THREE.Vector3();
const _fwdTan       = new THREE.Vector3();
const _rightTan     = new THREE.Vector3();
const _probePos     = new THREE.Vector3();
const _probePosL    = new THREE.Vector3();
const _probePosR    = new THREE.Vector3();
const _probeDir     = new THREE.Vector3();
const _probeDirL    = new THREE.Vector3();
const _lookAheadPos = new THREE.Vector3();
const _disp         = new THREE.Vector3();
const _fwdVel       = new THREE.Vector3();
const _latVel       = new THREE.Vector3();
const _qTurn        = new THREE.Quaternion();
const _qTarget      = new THREE.Quaternion();
const _mBasis       = new THREE.Matrix4();
const _localY       = new THREE.Vector3(0, 1, 0);

const _hitDown: SurfaceHit = {
  hit: false,
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
};

const _hitLook: SurfaceHit = {
  hit: false,
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
};

const _hitFwd: SurfaceHit = {
  hit: false,
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
};

const _hitSide: SurfaceHit = {
  hit: false,
  distance: 0,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
};

export class ArcadeCarController {
  // ── Physics State ──────────────────────────────────────────
  readonly position = new THREE.Vector3(0, 0.94, 25);
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly surfaceNormal = new THREE.Vector3(0, 1, 0);

  speed = 0;             // forward scalar speed (units/s)
  isGrounded = true;
  isDrifting = false;
  driftTransition = 0;   // 0 (normal grip) to 1 (full drift)
  brakeDeadzoneTimer = 0; // standstill delay before reverse acceleration
  steerVisual = 0;       // smoothed steer visual angle

  // Boost and status effects
  boostActive = false;
  boostForce = 0;
  hasBarrierContact = false;
  currentSurfaceType: SurfaceType = SurfaceType.ASPHALT;

  // ── Interpolation State (for α-rendering) ───────────────────
  readonly prevPosition = new THREE.Vector3(0, 0.94, 25);
  readonly prevQuaternion = new THREE.Quaternion();

  get speedNorm(): number {
    const max = this.boostActive ? C.maxSpeed * 1.5 : C.maxSpeed;
    return Math.min(Math.abs(this.speed) / max, 1);
  }

  /**
   * 120Hz fixed-timestep physics update.
   */
  update(dt: number, input: InputState, collision: SurfaceProvider): void {
    // 1. Snapshot previous state for interpolated rendering
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);

    // 2. Extract local direction vectors
    _fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);

    // Compute surface tangents immediately so surface detection has forward reference
    _rightTan.crossVectors(_fwd, this.surfaceNormal);
    if (_rightTan.lengthSq() < 0.001) {
      _rightTan.copy(_right).projectOnPlane(this.surfaceNormal).normalize();
    } else {
      _rightTan.normalize();
    }
    _fwdTan.crossVectors(this.surfaceNormal, _rightTan).normalize();

    // 4. Ground / Surface detection via BVH raycast
    this.detectSurface(collision);

    // 5. Arcade dynamics (Throttle, Brake, Steer, Grip, Boost)
    this.handleArcadeDynamics(dt, input);

    // 6. Integrate motion & obstacle collision
    this.integrateMotion(dt, collision);

    // 7. Align orientation to current surface normal
    this.alignToSurface(dt);
  }

  /**
   * Surface raycasting: downward probe along surfaceNormal to glue car to track on any 6DOF surface.
   */
  private detectSurface(collision: SurfaceProvider): void {
    // Cast probe from slightly above car down along -surfaceNormal
    _probePos.copy(this.position).addScaledVector(this.surfaceNormal, 1.4);
    _probeDir.copy(this.surfaceNormal).negate();
    const probeDist = C.snapDistance + 1.4;

    const hit = collision.raycast(_probePos, _probeDir, probeDist, _hitDown);

    if (hit) {
      if (collision.getSurfaceTypeAt) {
        this.currentSurfaceType = collision.getSurfaceTypeAt(this.position.x, this.position.z);
      } else {
        this.currentSurfaceType = SurfaceType.ASPHALT;
      }
      // Reject side walls (only snap to surfaces facing along current car up, dot > 0.35)
      const upDot = _hitDown.normal.dot(this.surfaceNormal);
      if (upDot > 0.35) {
        this.isGrounded = true;

        // Lookahead probe to anticipate upcoming curved ramps and inclines
        _lookAheadPos.copy(this.position)
          .addScaledVector(_fwdTan, 1.2)
          .addScaledVector(this.surfaceNormal, 1.4);
        const lookHit = collision.raycast(_lookAheadPos, _probeDir, probeDist, _hitLook);

        if (lookHit && _hitLook.normal.dot(_hitDown.normal) > 0.15) {
          this.surfaceNormal.copy(_hitDown.normal).lerp(_hitLook.normal, 0.35).normalize();
        } else {
          this.surfaceNormal.copy(_hitDown.normal);
        }

        // 6DOF Distance Snapping along surface normal
        // Measure car's current distance above the surface along _hitDown.normal
        const currentDist = (this.position.x - _hitDown.point.x) * _hitDown.normal.x +
                            (this.position.y - _hitDown.point.y) * _hitDown.normal.y +
                            (this.position.z - _hitDown.point.z) * _hitDown.normal.z;
        const targetRideHeight = C.carHeight * 0.5;
        const delta = targetRideHeight - currentDist;

        // Adjust car position strictly along surface normal
        this.position.addScaledVector(_hitDown.normal, delta);
        return;
      }
    }

    // No surface underneath -> Airborne
    this.isGrounded = false;
  }

  /**
   * Snappy arcade throttle, braking, and local-axis steering.
   */
  private handleArcadeDynamics(dt: number, input: InputState): void {
    const surfaceTuning = SURFACE_CONFIG[this.currentSurfaceType] || SURFACE_CONFIG[SurfaceType.ASPHALT];
    const baseMaxSpeed = this.boostActive ? C.maxSpeed * 1.5 : C.maxSpeed;
    const effectiveMaxSpeed = baseMaxSpeed * surfaceTuning.topSpeedMultiplier;

    if (this.isGrounded) {
      // ── Throttle, Braking & Reversing with 0.12s Dead-Stop Transition ──
      if (input.throttle > 0 || this.boostActive) {
        this.brakeDeadzoneTimer = 0;
        if (this.speed < 0) {
          // Braking out of reverse
          this.speed += C.brakeForce * dt;
          if (this.speed > 0) this.speed = 0;
        } else if (this.speed < effectiveMaxSpeed) {
          // Progressive supercar torque curve modulated by surface grip
          const speedRatio = Math.min(Math.abs(this.speed) / effectiveMaxSpeed, 1.0);
          const torqueCurve = Math.max(0.35, 1.0 - speedRatio * 0.65);
          const accel = ((C.acceleration * torqueCurve) + (this.boostActive ? this.boostForce : 0)) * surfaceTuning.gripMultiplier;
          this.speed += accel * dt;
          if (this.speed > effectiveMaxSpeed) this.speed = effectiveMaxSpeed;
        } else if (this.speed > effectiveMaxSpeed) {
          // Off-road / reduced surface top speed clamp
          this.speed = Math.max(effectiveMaxSpeed, this.speed - C.brakeForce * 0.4 * dt);
        }
      } else if (input.brake > 0) {
        if (this.speed > 0) {
          // Braking while moving forward
          this.speed -= C.brakeForce * input.brake * dt;
          if (this.speed <= 0) {
            this.speed = 0;
            this.brakeDeadzoneTimer = C.brakeDeadzoneTime; // 0.12s pause before reversing
          }
        } else if (this.speed === 0) {
          // At standstill: enforce 0.12s dead-stop pause before reverse throttle engages
          if (this.brakeDeadzoneTimer > 0) {
            this.brakeDeadzoneTimer -= dt;
            this.speed = 0;
          } else {
            this.speed -= C.reverseAccel * input.brake * dt;
            if (this.speed < -C.reverseMaxSpeed) this.speed = -C.reverseMaxSpeed;
          }
        } else {
          // Already reversing
          this.speed -= C.reverseAccel * input.brake * dt;
          if (this.speed < -C.reverseMaxSpeed) this.speed = -C.reverseMaxSpeed;
        }
      } else {
        // Brake released
        if (this.speed >= 0) {
          this.brakeDeadzoneTimer = 0;
        }
      }

      // ── Drag & Natural Rolling Deceleration ──
      if (input.throttle === 0 && input.brake === 0 && !this.boostActive) {
        this.speed -= Math.sign(this.speed) * C.rollingResistance * dt;
        if (Math.abs(this.speed) < 0.1) this.speed = 0;
      }
      this.speed *= (1 - C.drag * dt);

      // ── Drift State & Smooth 0.15s Grip Blend ──
      const absSpeed = Math.abs(this.speed);
      const canDrift = input.drift && absSpeed > C.driftEntrySpeed;
      this.isDrifting = canDrift;

      const targetDrift = canDrift ? 1.0 : 0.0;
      const blendRate = 1.0 / C.driftTransitionTime;
      if (this.driftTransition < targetDrift) {
        this.driftTransition = Math.min(targetDrift, this.driftTransition + blendRate * dt);
      } else if (this.driftTransition > targetDrift) {
        this.driftTransition = Math.max(targetDrift, this.driftTransition - blendRate * dt);
      }

      // ── Local-Axis Steering with Counter-Steer Assist ──
      const speedFactor = 1 - C.steerSpeedDecay * (absSpeed / effectiveMaxSpeed);
      const steerSign = this.speed >= 0 ? 1 : -1;
      const driftMul = 1.0 + (C.driftSteerBoost - 1.0) * this.driftTransition;

      if (input.steer !== 0) {
        let turnAngle = -input.steer * C.steerSpeed * speedFactor * driftMul * steerSign * dt;

        // Counter-steer assist: boost angular control when steering against lateral slide
        const currentLatSpeed = this.velocity.dot(_rightTan);
        if (this.driftTransition > 0.05 && Math.abs(currentLatSpeed) > 0.5) {
          const isCounterSteering = (input.steer * currentLatSpeed < 0);
          if (isCounterSteering) {
            turnAngle *= 1.25;
          }
        }

        _qTurn.setFromAxisAngle(_localY, turnAngle);
        this.quaternion.multiply(_qTurn);
        this.steerVisual = input.steer;
      } else {
        this.steerVisual *= Math.exp(-C.steerReturnSpeed * dt);

        // Drift recovery assist: gently align car heading with motion vector on releasing drift
        if (this.driftTransition > 0.02 && !this.isDrifting) {
          const latSpeedNow = this.velocity.dot(_rightTan);
          if (Math.abs(latSpeedNow) > 0.4) {
            const recoveryTurn = -Math.sign(latSpeedNow) * Math.min(1.0, Math.abs(latSpeedNow) / 10.0) * 1.5 * dt;
            _qTurn.setFromAxisAngle(_localY, recoveryTurn);
            this.quaternion.multiply(_qTurn);
          }
        }
      }

      // ── Build Tangential Velocity & Time-Based Lateral Friction Decay ──
      _fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
      _right.set(1, 0, 0).applyQuaternion(this.quaternion);

      // Project forward and right onto surface tangent plane
      _rightTan.crossVectors(_fwd, this.surfaceNormal);
      if (_rightTan.lengthSq() < 0.001) {
        _rightTan.copy(_right).projectOnPlane(this.surfaceNormal).normalize();
      } else {
        _rightTan.normalize();
      }
      _fwdTan.crossVectors(this.surfaceNormal, _rightTan).normalize();

      // Effective lateral friction blended exponentially over drift transition and surface
      const baseLatFriction = THREE.MathUtils.lerp(
        C.lateralFrictionNormal,
        C.lateralFrictionDrift,
        this.driftTransition
      );
      const lateralFriction = baseLatFriction * surfaceTuning.lateralFrictionMultiplier;

      // Time-based exponential decay: lateralVel *= Math.exp(-lateralFriction * dt)
      const prevLatSpeed = this.velocity.dot(_rightTan);
      const latSpeed = prevLatSpeed * Math.exp(-lateralFriction * dt);

      _fwdVel.copy(_fwdTan).multiplyScalar(this.speed);
      _latVel.copy(_rightTan).multiplyScalar(latSpeed);
      this.velocity.copy(_fwdVel).add(_latVel);

    } else {
      // ── Airborne Flight Dynamics ──
      if (input.steer !== 0) {
        const turnAngle = -input.steer * C.steerSpeed * C.airControlFactor * dt;
        _qTurn.setFromAxisAngle(_localY, turnAngle);
        this.quaternion.multiply(_qTurn);
      }
      // World gravity pulls down in air
      this.velocity.y -= C.gravityStrength * dt;
      this.velocity.multiplyScalar(1 - 0.15 * dt);
    }
  }

  /**
   * Integrate displacement and handle obstacle collision (walls, barriers, buildings).
   * Employs multi-point wheel swept probes so the car hitbox uses the wheels as boundary edges.
   */
  private integrateMotion(dt: number, collision: SurfaceProvider): void {
    const halfW = C.carWidth * 0.5; // 0.675m (wheel edge distance)
    const probeY = C.carHeight * 0.35; // raised slightly above road

    // ── 1. Lateral Wheel Edge Collision (Side containment) ──
    // Probe Left (towards left wheels)
    _probePos.copy(this.position).addScaledVector(this.surfaceNormal, probeY);
    _probeDirL.copy(_rightTan).negate();
    const sideReach = halfW + 0.12;

    if (collision.raycast(_probePos, _probeDirL, sideReach, _hitSide)) {
      const penetration = (halfW + 0.04) - _hitSide.distance;
      if (penetration > 0) {
        this.hasBarrierContact = true;
        this.position.addScaledVector(_hitSide.normal, penetration);
        if (this.velocity.dot(_hitSide.normal) < 0) {
          this.velocity.projectOnPlane(_hitSide.normal);
        }
        this.speed *= 0.94; // slight friction on barrier brush
      }
    }

    // Probe Right (towards right wheels)
    if (collision.raycast(_probePos, _rightTan, sideReach, _hitSide)) {
      const penetration = (halfW + 0.04) - _hitSide.distance;
      if (penetration > 0) {
        this.hasBarrierContact = true;
        this.position.addScaledVector(_hitSide.normal, penetration);
        if (this.velocity.dot(_hitSide.normal) < 0) {
          this.velocity.projectOnPlane(_hitSide.normal);
        }
        this.speed *= 0.94;
      }
    }

    // ── 2. Forward / Motion Swept Collision (Front Bumper & Wheels) ──
    _disp.copy(this.velocity).multiplyScalar(dt);
    const dispDist = _disp.length();

    if (dispDist > 0.0001) {
      _probeDir.copy(this.velocity).projectOnPlane(this.surfaceNormal);

      if (_probeDir.lengthSq() > 0.0001) {
        _probeDir.normalize();
        const sweepDist = dispDist + C.carLength * 0.45;

        // Check Center, Front-Left wheel corner, Front-Right wheel corner
        _probePos.copy(this.position).addScaledVector(this.surfaceNormal, probeY);
        _probePosL.copy(_probePos).addScaledVector(_rightTan, -halfW * 0.92);
        _probePosR.copy(_probePos).addScaledVector(_rightTan, halfW * 0.92);

        let hitObstacle = collision.raycast(_probePos, _probeDir, sweepDist, _hitFwd);
        if (!hitObstacle) {
          hitObstacle = collision.raycast(_probePosL, _probeDir, sweepDist, _hitFwd);
        }
        if (!hitObstacle) {
          hitObstacle = collision.raycast(_probePosR, _probeDir, sweepDist, _hitFwd);
        }

        if (hitObstacle && _hitFwd.distance < sweepDist) {
          const wallNormal = _hitFwd.normal;
          const slopeDot = wallNormal.dot(this.surfaceNormal);

          if (slopeDot > 0.15) {
            // Upcoming climbable ramp or incline curve!
            this.surfaceNormal.lerp(wallNormal, 0.4).normalize();
            _disp.projectOnPlane(this.surfaceNormal);
            this.position.add(_disp);
            return;
          }

          // Perpendicular obstacle/wall deflection: glide along the wall without locking up
          this.velocity.projectOnPlane(wallNormal);
          this.speed *= 0.85; // slight speed scrub on wall brush
          this.hasBarrierContact = true;
          const pushBack = Math.max(0.08, (sweepDist - _hitFwd.distance) + 0.04);
          this.position.addScaledVector(wallNormal, pushBack);
          return;
        }
      }
    }

    // Unobstructed motion
    this.position.add(_disp);
  }

  /**
   * Ground and align car at standstill during race countdown staging.
   */
  updateStaging(collision: SurfaceProvider): void {
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.detectSurface(collision);
    this.alignToSurface(0.016);
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
  }

  /**
   * Robust Orthonormal Basis Alignment:
   * Smoothly aligns the car's local UP to surface normal while preserving forward heading.
   * Completely immune to gimbal lock, roll flips, or 180° yaw spins.
   */
  private alignToSurface(dt: number): void {
    if (!this.isGrounded) return;

    // Current forward vector
    _fwd.set(0, 0, -1).applyQuaternion(this.quaternion);

    // Compute robust orthonormal basis on surface
    _rightTan.crossVectors(_fwd, this.surfaceNormal);
    if (_rightTan.lengthSq() < 0.001) {
      _rightTan.copy(_right).projectOnPlane(this.surfaceNormal).normalize();
    } else {
      _rightTan.normalize();
    }
    _fwdTan.crossVectors(this.surfaceNormal, _rightTan).normalize();

    // Orthonormal basis matrix: columns [Right, Up, -Forward]
    // Note: use _fwdVel scratch to hold -_fwdTan without mutating _fwdTan
    _fwdVel.copy(_fwdTan).negate();
    _mBasis.makeBasis(_rightTan, this.surfaceNormal, _fwdVel);
    _qTarget.setFromRotationMatrix(_mBasis);

    // Snappy alignment slerp
    const slerpRate = Math.min(1, 40 * dt);
    this.quaternion.slerp(_qTarget, slerpRate);
  }
}
