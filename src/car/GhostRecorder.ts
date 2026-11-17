/**
 * src/car/GhostRecorder.ts
 * ─────────────────────────────────────────────────────────────
 * Zero-allocation Ghost Recording & Playback System.
 *
 * Records car transforms (pos x,y,z + quat x,y,z,w) at 120Hz fixed-timestep.
 * Uses pre-allocated Float32Array typed buffers for zero garbage collection.
 * Replays best lap with smooth sub-tick Hermite/slerp interpolation.
 *
 * RULES.md: Zero per-frame heap allocations.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { FIXED_DT } from '../core/constants';

// 3 minutes maximum lap capacity at 120Hz = 21,600 frames * 7 floats
const MAX_FRAMES = 120 * 180;
const FLOATS_PER_FRAME = 7; // [x, y, z, qx, qy, qz, qw]

export class GhostRecorder {
  // Pre-allocated typed storage (Zero GC per frame)
  private readonly currentLapBuffer = new Float32Array(MAX_FRAMES * FLOATS_PER_FRAME);
  private readonly bestLapBuffer    = new Float32Array(MAX_FRAMES * FLOATS_PER_FRAME);

  private currentFrameCount = 0;
  private bestFrameCount    = 0;

  bestLapTime: number | null = null;
  hasBestLap = false;

  // Scratch objects for playback interpolation (reused)
  private readonly _p0 = new THREE.Vector3();
  private readonly _p1 = new THREE.Vector3();
  private readonly _q0 = new THREE.Quaternion();
  private readonly _q1 = new THREE.Quaternion();

  /**
   * Reset current lap recording to start afresh.
   */
  startLap(): void {
    this.currentFrameCount = 0;
  }

  /**
   * Record car transform during physics tick. Zero allocations.
   */
  recordFrame(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    if (this.currentFrameCount >= MAX_FRAMES) return;

    const offset = this.currentFrameCount * FLOATS_PER_FRAME;
    this.currentLapBuffer[offset + 0] = position.x;
    this.currentLapBuffer[offset + 1] = position.y;
    this.currentLapBuffer[offset + 2] = position.z;
    this.currentLapBuffer[offset + 3] = quaternion.x;
    this.currentLapBuffer[offset + 4] = quaternion.y;
    this.currentLapBuffer[offset + 5] = quaternion.z;
    this.currentLapBuffer[offset + 6] = quaternion.w;

    this.currentFrameCount++;
  }

  /**
   * Check if completed lap is a new record. If so, copy to best lap buffer.
   * Returns true if a new best lap was set.
   */
  finishLap(lapTime: number): boolean {
    const isNewRecord = this.bestLapTime === null || lapTime < this.bestLapTime;

    if (isNewRecord && this.currentFrameCount > 60) {
      this.bestLapTime = lapTime;
      this.bestFrameCount = this.currentFrameCount;

      // Copy current lap buffer to best lap buffer
      this.bestLapBuffer.set(this.currentLapBuffer.subarray(0, this.currentFrameCount * FLOATS_PER_FRAME));
      this.hasBestLap = true;
      return true;
    }

    return false;
  }

  /**
   * Sample ghost transform at elapsed lap time with smooth sub-tick interpolation.
   * Zero per-frame allocations: populates outPos and outQuat in-place.
   */
  getGhostTransform(
    elapsedLapTime: number,
    outPos: THREE.Vector3,
    outQuat: THREE.Quaternion
  ): boolean {
    if (!this.hasBestLap || this.bestFrameCount < 2) return false;

    // Calculate exact float frame index from elapsed time
    const frameFloat = elapsedLapTime / FIXED_DT;

    if (frameFloat <= 0) {
      this.readFrame(0, outPos, outQuat);
      return true;
    }

    const frameIndex0 = Math.floor(frameFloat);
    const frameIndex1 = frameIndex0 + 1;

    if (frameIndex1 >= this.bestFrameCount) {
      // Reached finish line: hold final transform
      this.readFrame(this.bestFrameCount - 1, outPos, outQuat);
      return true;
    }

    const alpha = frameFloat - frameIndex0;

    // Read frame 0
    this.readFrame(frameIndex0, this._p0, this._q0);
    // Read frame 1
    this.readFrame(frameIndex1, this._p1, this._q1);

    // Interpolate
    outPos.lerpVectors(this._p0, this._p1, alpha);
    outQuat.slerpQuaternions(this._q0, this._q1, alpha);

    return true;
  }

  private readFrame(frameIndex: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const offset = frameIndex * FLOATS_PER_FRAME;
    outPos.set(
      this.bestLapBuffer[offset + 0],
      this.bestLapBuffer[offset + 1],
      this.bestLapBuffer[offset + 2]
    );
    outQuat.set(
      this.bestLapBuffer[offset + 3],
      this.bestLapBuffer[offset + 4],
      this.bestLapBuffer[offset + 5],
      this.bestLapBuffer[offset + 6]
    );
  }
}
