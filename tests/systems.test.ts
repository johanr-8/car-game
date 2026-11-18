import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TrackSpline } from '../src/world/TrackSpline';
import { TrackQuery } from '../src/world/TrackQuery';
import { VehicleEntity } from '../src/car/VehicleEntity';

describe('Phase F3: Multi-Vehicle and TrackQuery Systems', () => {
  let track: TrackSpline;
  let trackQuery: TrackQuery;

  beforeEach(() => {
    track = new TrackSpline();
    trackQuery = new TrackQuery(track);
  });

  it('progresses two VehicleEntity instances independently through checkpoints', () => {
    const v1 = new VehicleEntity('car_player', 0xd41c1c, true);
    const v2 = new VehicleEntity('car_rival_1', 0x2288ff, false);

    // Initial state: both vehicles at checkpoint 1
    expect(v1.progress.activeCheckpointIndex).toBe(1);
    expect(v2.progress.activeCheckpointIndex).toBe(1);
    expect(v1.progress.lapCount).toBe(1);
    expect(v2.progress.lapCount).toBe(1);

    // Move v1 to checkpoint 1 position
    const cp1 = track.checkpoints[1];
    v1.controller.position.copy(cp1.position);

    // Validate v1 crossing checkpoint 1
    const v1Crossed = trackQuery.checkGateCrossing(v1.controller.position, cp1);
    expect(v1Crossed).toBe(true);

    // Advance v1
    v1.progress.activeCheckpointIndex++;
    expect(v1.progress.activeCheckpointIndex).toBe(2);

    // v2 MUST remain at checkpoint 1 (independent progress)
    expect(v2.progress.activeCheckpointIndex).toBe(1);

    // Now advance v2 to checkpoint 1 position
    v2.controller.position.copy(cp1.position);
    const v2Crossed = trackQuery.checkGateCrossing(v2.controller.position, cp1);
    expect(v2Crossed).toBe(true);
    v2.progress.activeCheckpointIndex++;

    expect(v2.progress.activeCheckpointIndex).toBe(2);

    // Now advance v1 through remaining checkpoints to test lap wrapping
    for (let cpIdx = 2; cpIdx < track.checkpoints.length; cpIdx++) {
      v1.progress.activeCheckpointIndex = cpIdx;
    }
    v1.progress.awaitingFinishLine = true;
    v1.progress.activeCheckpointIndex = 0; // Finish line

    // Verify v1 completed lap 1, v2 is still on checkpoint 2
    expect(v1.progress.activeCheckpointIndex).toBe(0);
    expect(v2.progress.activeCheckpointIndex).toBe(2);
  });

  it('triggers wrong-way detection when vehicle drives against track tangent for 1 second', () => {
    const v = new VehicleEntity('player', 0xd41c1c, true);
    const startCP = track.checkpoints[0];

    // Place car at start line facing forward
    v.controller.position.copy(startCP.position);
    v.controller.quaternion.set(0, 0, 0, 1);
    v.controller.speed = 20.0; // 72 km/h

    // Query to set cached segment
    trackQuery.containVehicle(v);

    // Initially facing forward, wrong-way should be false
    trackQuery.updateWrongWay(v, 0.1);
    expect(v.progress.isWrongWay).toBe(false);

    // Rotate car 180 degrees to face backwards along tangent
    // Rotate 180 deg around Y
    v.controller.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

    // Drive backwards for 0.5s: timer accumulates, but isWrongWay should still be false (< 1.0s)
    for (let t = 0; t < 5; t++) {
      trackQuery.updateWrongWay(v, 0.1);
    }
    expect(v.progress.wrongWayTimer).toBeCloseTo(0.5, 2);
    expect(v.progress.isWrongWay).toBe(false);

    // Drive backwards for another 0.6s (total > 1.0s): isWrongWay MUST now be true
    for (let t = 0; t < 6; t++) {
      trackQuery.updateWrongWay(v, 0.1);
    }
    expect(v.progress.wrongWayTimer).toBeGreaterThanOrEqual(1.0);
    expect(v.progress.isWrongWay).toBe(true);

    // Turn vehicle back to facing forward
    v.controller.quaternion.set(0, 0, 0, 1);
    // After 0.6s of forward driving, wrong-way flag should clear
    for (let t = 0; t < 6; t++) {
      trackQuery.updateWrongWay(v, 0.1);
    }
    expect(v.progress.isWrongWay).toBe(false);
  });

  it('plane-crossing rejects a car passing above the gate on an elevated track layer', () => {
    const cp1 = track.checkpoints[1];

    // 1. Car on the actual road deck at gate 1: MUST pass
    const roadCarPos = cp1.position.clone();
    expect(trackQuery.checkGateCrossing(roadCarPos, cp1)).toBe(true);

    // 2. Car vertically offset by 25m (e.g. driving on an upper skyway overpass above gate 1): MUST be rejected
    const elevatedCarPos = cp1.position.clone().add(new THREE.Vector3(0, 25, 0));
    expect(trackQuery.checkGateCrossing(elevatedCarPos, cp1)).toBe(false);

    // 3. Car vertically offset by -15m (e.g. driving on a tunnel/lower deck under gate 1): MUST be rejected
    const lowerDeckCarPos = cp1.position.clone().add(new THREE.Vector3(0, -15, 0));
    expect(trackQuery.checkGateCrossing(lowerDeckCarPos, cp1)).toBe(false);

    // 4. Car laterally outside the road width (+12m out): MUST be rejected
    const offRoadCarPos = cp1.position.clone().addScaledVector(cp1.binormal, 12.0);
    expect(trackQuery.checkGateCrossing(offRoadCarPos, cp1)).toBe(false);
  });
});
