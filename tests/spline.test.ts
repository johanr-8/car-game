import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrackSpline } from '../src/world/TrackSpline';

describe('Track Spline Continuity and Loop Closure', () => {
  const track = new TrackSpline();

  it('verifies that the track spline is a closed curve', () => {
    expect(track.curve).toBeDefined();
    expect(track.curve.closed).toBe(true);
  });

  it('guarantees position loop closure (start point equals end point)', () => {
    const ptStart = track.curve.getPointAt(0);
    const ptEnd = track.curve.getPointAt(1);
    const distance = ptStart.distanceTo(ptEnd);
    expect(distance).toBeLessThan(1e-4);
  });

  it('guarantees tangent vector continuity across the seam (u = 0 vs u = 1)', () => {
    const tanStart = track.curve.getTangentAt(0).normalize();
    const tanEnd = track.curve.getTangentAt(1).normalize();
    const distance = tanStart.distanceTo(tanEnd);
    // Catmull-Rom numerical differentiation delta at u=0 vs u=1 is < 0.002 (< 0.1 degrees)
    expect(distance).toBeLessThan(2e-3);
  });

  it('verifies no discontinuous spatial jumps along 320 segments', () => {
    const segments = track.segments;
    expect(track.centerPoints.length).toBe(segments + 1);

    for (let i = 0; i < segments; i++) {
      const pCurrent = track.centerPoints[i];
      const pNext = track.centerPoints[i + 1];
      const stepDist = pCurrent.distanceTo(pNext);

      // Average segment is ~1.5 - 3.5m; none should exceed 10m
      expect(stepDist).toBeGreaterThan(0.2);
      expect(stepDist).toBeLessThan(10.0);
      expect(Number.isFinite(pCurrent.x)).toBe(true);
      expect(Number.isFinite(pCurrent.y)).toBe(true);
      expect(Number.isFinite(pCurrent.z)).toBe(true);
    }
  });

  it('guarantees parallel transport frame holonomy closure (normals & binormals)', () => {
    const n = track.segments;
    const nStart = track.normals[0];
    const nEnd = track.normals[n];
    const bStart = track.binormals[0];
    const bEnd = track.binormals[n];

    expect(nStart.distanceTo(nEnd)).toBeLessThan(1e-3);
    expect(bStart.distanceTo(bEnd)).toBeLessThan(1e-3);

    // Verify orthogonality across all segments
    for (let i = 0; i <= n; i++) {
      const normal = track.normals[i];
      const tangent = track.tangents[i];
      const binormal = track.binormals[i];

      expect(Math.abs(normal.length() - 1.0)).toBeLessThan(1e-3);
      expect(Math.abs(binormal.length() - 1.0)).toBeLessThan(1e-3);
      expect(Math.abs(tangent.length() - 1.0)).toBeLessThan(1e-3);

      // Normal perpendicular to tangent
      expect(Math.abs(normal.dot(tangent))).toBeLessThan(1e-3);
      // Binormal perpendicular to normal
      expect(Math.abs(binormal.dot(normal))).toBeLessThan(1e-3);
    }
  });
});
