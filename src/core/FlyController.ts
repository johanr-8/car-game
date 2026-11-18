/**
 * src/core/FlyController.ts
 * ─────────────────────────────────────────────────────────────
 * High-Speed Spectator Fly-Camera for map exploration, level design & debug.
 *
 * Capabilities:
 *   - 6DOF high-speed flight across the 4000m procedural world.
 *   - Base speed: ~140 m/s (~500 km/h) for rapid traversal.
 *   - Turbo speed (holding Shift): ~390 m/s (~1400 km/h) to cross the whole map in seconds.
 *   - Slow speed (holding Ctrl/Alt): ~35 m/s for precision inspecting of roads & lots.
 *   - Controls:
 *       • WASD: Forward / Strafe Left / Backward / Strafe Right
 *       • Space / E: Ascend (upward)
 *       • C / Q: Descend (downward)
 *       • Mouse Drag (Left/Right Click): Look pitch & yaw
 *       • Arrow Keys: Keyboard-only look (yaw & pitch)
 *       • Shift: 2.8x Turbo boost
 *       • Ctrl / Alt: 0.25x Slow precision
 *   - Disables car physics input while flying to prevent collisions.
 *   - Drives chunk streaming around the fly-cam position.
 *   - Zero per-frame allocations. Pre-allocated scratch vectors.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';

// Pre-allocated scratch math structures (Zero heap allocation per frame)
const _flyFwd   = new THREE.Vector3();
const _flyRight = new THREE.Vector3();
const _flyMove  = new THREE.Vector3();
const _euler    = new THREE.Euler(0, 0, 0, 'YXZ');

export class FlyController {
  private camera: THREE.PerspectiveCamera | null = null;
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  baseSpeed = 140;       // m/s
  turboMultiplier = 2.8; // ~392 m/s
  slowMultiplier = 0.25; // ~35 m/s

  mouseSensitivity = 0.0024;
  keyTurnSpeed = 2.0;    // rad/s
  keyPitchSpeed = 1.6;   // rad/s

  private _enabled = false;
  private readonly keys = new Set<string>();
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;

  constructor() {
    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (!this._enabled) return;
      this.keys.add(e.code);
    };

    this.onKeyUpBound = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    this.onMouseDownBound = (e: MouseEvent) => {
      if (!this._enabled) return;
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };

    this.onMouseUpBound = () => {
      this.isDragging = false;
    };

    this.onMouseMoveBound = (e: MouseEvent) => {
      if (!this._enabled || !this.isDragging) return;
      const dx = (e.movementX !== undefined && e.movementX !== 0) ? e.movementX : (e.clientX - this.lastMouseX);
      const dy = (e.movementY !== undefined && e.movementY !== 0) ? e.movementY : (e.clientY - this.lastMouseY);
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.yaw -= dx * this.mouseSensitivity;
      this.pitch -= dy * this.mouseSensitivity;
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDownBound);
      window.addEventListener('keyup', this.onKeyUpBound);
      window.addEventListener('mousedown', this.onMouseDownBound);
      window.addEventListener('mouseup', this.onMouseUpBound);
      window.addEventListener('mousemove', this.onMouseMoveBound);
    }
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  enable(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this._enabled = true;
    this.position.copy(camera.position);

    // Compute initial yaw & pitch from camera's forward vector
    camera.getWorldDirection(_flyFwd);
    this.yaw = Math.atan2(-_flyFwd.x, -_flyFwd.z);
    this.pitch = Math.asin(Math.max(-0.999, Math.min(0.999, _flyFwd.y)));
    this.keys.clear();
    this.isDragging = false;
  }

  disable(): void {
    this._enabled = false;
    this.keys.clear();
    this.isDragging = false;
  }

  toggle(camera: THREE.PerspectiveCamera): boolean {
    if (this._enabled) {
      this.disable();
      return false;
    } else {
      this.enable(camera);
      return true;
    }
  }

  update(dt: number): void {
    if (!this._enabled || !this.camera) return;

    // Safety guard against large time steps when un-focusing window
    const safeDt = Math.min(dt, 0.1);

    // Keyboard look controls (Arrow keys)
    if (this.keys.has('ArrowLeft'))  this.yaw += this.keyTurnSpeed * safeDt;
    if (this.keys.has('ArrowRight')) this.yaw -= this.keyTurnSpeed * safeDt;
    if (this.keys.has('ArrowUp'))    this.pitch += this.keyPitchSpeed * safeDt;
    if (this.keys.has('ArrowDown'))  this.pitch -= this.keyPitchSpeed * safeDt;

    // Clamp pitch to avoid gimbal flip
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));

    // Update orientation
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);

    // Direction vectors from camera orientation
    _flyFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _flyRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    // Movement calculation
    _flyMove.set(0, 0, 0);
    if (this.keys.has('KeyW')) _flyMove.add(_flyFwd);
    if (this.keys.has('KeyS')) _flyMove.sub(_flyFwd);
    if (this.keys.has('KeyD')) _flyMove.add(_flyRight);
    if (this.keys.has('KeyA')) _flyMove.sub(_flyRight);
    if (this.keys.has('Space') || this.keys.has('KeyE')) _flyMove.y += 1;
    if (this.keys.has('KeyC')  || this.keys.has('KeyQ')) _flyMove.y -= 1;

    let speed = this.baseSpeed;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
      speed *= this.turboMultiplier;
    } else if (
      this.keys.has('ControlLeft') || this.keys.has('ControlRight') ||
      this.keys.has('AltLeft')     || this.keys.has('AltRight')
    ) {
      speed *= this.slowMultiplier;
    }

    if (_flyMove.lengthSq() > 0.0001) {
      _flyMove.normalize().multiplyScalar(speed * safeDt);
      this.position.add(_flyMove);
    }

    this.camera.position.copy(this.position);
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDownBound);
      window.removeEventListener('keyup', this.onKeyUpBound);
      window.removeEventListener('mousedown', this.onMouseDownBound);
      window.removeEventListener('mouseup', this.onMouseUpBound);
      window.removeEventListener('mousemove', this.onMouseMoveBound);
    }
    this.keys.clear();
    this.camera = null;
    this._enabled = false;
  }
}
