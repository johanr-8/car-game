import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TrackSpline } from '../src/world/TrackSpline';

describe('Checkpoint Sequential Ordering and Validation', () => {
  let track: TrackSpline;

  beforeEach(() => {
    track = new TrackSpline();
  });

  it('initializes exactly 8 race checkpoints sequentially positioned', () => {
    expect(track.checkpoints.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(track.checkpoints[i].index).toBe(i);
      expect(track.checkpoints[i].position).toBeInstanceOf(THREE.Vector3);
      expect(track.checkpoints[i].radius).toBeGreaterThanOrEqual(10);
    }
  });

  it('validates passing the active checkpoint in order', () => {
    // Gate 1 is the first checkpoint after start line
    const cp1 = track.checkpoints[1];
    const carAtGate1 = cp1.position.clone();

    // Passing gate 1 while active index is 1 MUST succeed
    const passedGate1 = track.checkCarPassing(carAtGate1, 1);
    expect(passedGate1).toBe(true);
    expect(cp1.isPassed).toBe(true);
  });

  it('prevents shortcuts by rejecting out-of-order checkpoint passage', () => {
    const cp2 = track.checkpoints[2];
    const cp3 = track.checkpoints[3];
    const cp0 = track.checkpoints[0];

    // Car attempts to trigger gate 2 when gate 1 is active
    expect(track.checkCarPassing(cp2.position, 1)).toBe(false);
    expect(cp2.isPassed).toBe(false);

    // Car attempts to trigger gate 3 when gate 1 is active
    expect(track.checkCarPassing(cp3.position, 1)).toBe(false);
    expect(cp3.isPassed).toBe(false);

    // Car attempts to cross finish line (gate 0) when gate 1 is active
    expect(track.checkCarPassing(cp0.position, 1)).toBe(false);
    expect(cp0.isPassed).toBe(false);
  });

  it('verifies strict sequential progression across an entire lap (0 -> 1..7 -> 0)', () => {
    let activeIndex = 1;
    let lapCompleted = false;

    // Simulate car traversing sequentially from gate 1 through 7 then finish (gate 0)
    for (let target = 1; target <= 7; target++) {
      const cpTarget = track.checkpoints[target];
      const hit = track.checkCarPassing(cpTarget.position, activeIndex);
      expect(hit).toBe(true);
      expect(cpTarget.isPassed).toBe(true);

      // Advance to next checkpoint
      activeIndex++;
    }

    // Now activeIndex should wrap to finish line (index 0)
    if (activeIndex >= track.checkpoints.length) {
      activeIndex = 0;
    }
    expect(activeIndex).toBe(0);

    // Crossing finish line completes the lap
    const cpFinish = track.checkpoints[0];
    const hitFinish = track.checkCarPassing(cpFinish.position, activeIndex);
    expect(hitFinish).toBe(true);
    lapCompleted = true;
    expect(lapCompleted).toBe(true);
  });

  it('resets checkpoint status cleanly on race restart', () => {
    // Pass gate 1 and 2
    track.checkCarPassing(track.checkpoints[1].position, 1);
    track.checkCarPassing(track.checkpoints[2].position, 2);
    expect(track.checkpoints[1].isPassed).toBe(true);
    expect(track.checkpoints[2].isPassed).toBe(true);

    track.resetCheckpoints();

    for (let i = 0; i < track.checkpoints.length; i++) {
      expect(track.checkpoints[i].isPassed).toBe(false);
      expect(track.checkpoints[i].isActive).toBe(i === 1);
    }
  });
});
