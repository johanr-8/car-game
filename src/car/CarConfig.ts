/**
 * src/car/CarConfig.ts
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for tuning knobs & supercar styling.
 * Supports live mutation via F4 dev tuning panel & localStorage.
 * ─────────────────────────────────────────────────────────────
 */

export interface CarConfigType {
  // ── Speed & Power ──
  maxSpeed: number;
  reverseMaxSpeed: number;
  acceleration: number;
  brakeForce: number;
  reverseAccel: number;
  drag: number;
  rollingResistance: number;

  // ── Steering & Handling ──
  steerSpeed: number;
  steerSpeedDecay: number;
  steerReturnSpeed: number;
  maxSteerAngle: number;

  // ── Grip & Drift Lateral Friction ──
  lateralFrictionNormal: number;  // exponential decay rate on tarmac (/s)
  lateralFrictionDrift: number;   // exponential decay rate while drifting (/s)
  driftTransitionTime: number;    // seconds to blend between normal and drift grip
  driftEntrySpeed: number;        // min speed to initiate power drift
  driftSteerBoost: number;        // steering authority multiplier while drifting
  brakeDeadzoneTime: number;      // standstill seconds before reversing

  // ── 6DOF Surface Physics ──
  gravityDir: readonly [number, number, number];
  gravityStrength: number;
  downforce: number;
  probeOffset: number;
  snapDistance: number;
  surfaceAlignSpeed: number;
  airControlFactor: number;
  ccdMargin: number;
  groundY: number;

  // ── Chase Camera ──
  camDistance: number;
  camHeight: number;
  camLookAhead: number;
  camLagPosition: number;
  camLagLookAt: number;
  camFovMin: number;
  camFovMax: number;
  camFovLag: number;

  // ── Realistic Supercar Dimensions & Styling ──
  carLength: number;
  carWidth: number;
  carHeight: number;
  bodyColor: number;
  cabinColor: number;
  chassisColor: number;
  wheelColor: number;
  caliperColor: number;
}

export const DEFAULT_CAR_CONFIG: Readonly<CarConfigType> = {
  // Speed & Power
  maxSpeed:          48,
  reverseMaxSpeed:   16,
  acceleration:      20,
  brakeForce:        42,
  reverseAccel:      18,
  drag:              0.42,
  rollingResistance: 2.0,

  // Steering & Handling
  steerSpeed:        3.8,
  steerSpeedDecay:   0.40,
  steerReturnSpeed:  6.5,
  maxSteerAngle:     1.0,

  // Grip & Drift Lateral Friction
  lateralFrictionNormal: 10.0,
  lateralFrictionDrift:  2.0,
  driftTransitionTime:   0.15,
  driftEntrySpeed:       10,
  driftSteerBoost:       1.35,
  brakeDeadzoneTime:     0.12,

  // 6DOF Surface Physics
  gravityDir:        [0, -1, 0],
  gravityStrength:   28,
  downforce:         1.5,
  probeOffset:       1.0,
  snapDistance:      3.5,
  surfaceAlignSpeed: 24,
  airControlFactor:  0.4,
  ccdMargin:         0.06,
  groundY:           0,

  // Chase Camera
  camDistance:       5.4,
  camHeight:         2.2,
  camLookAhead:      5.5,
  camLagPosition:    14.0,
  camLagLookAt:      12.0,
  camFovMin:         60,
  camFovMax:         68,
  camFovLag:         4.0,

  // Supercar Dimensions & Styling
  carLength:         2.6,
  carWidth:          1.35,
  carHeight:         0.68,
  bodyColor:         0xd41c1c,
  cabinColor:        0x14202c,
  chassisColor:      0x1c1e22,
  wheelColor:        0x202226,
  caliperColor:      0xffc400,
};

export const CarConfig: CarConfigType = { ...DEFAULT_CAR_CONFIG };
