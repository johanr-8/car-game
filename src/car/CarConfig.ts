/**
 * src/car/CarConfig.ts
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for tuning knobs & supercar styling.
 * ─────────────────────────────────────────────────────────────
 */

export const CarConfig = {

  // ── Speed & Power ──────────────────────────────────────────
  maxSpeed:          48,     // units/s (~173 km/h base cruising, ~235 km/h with nitro boost)
  reverseMaxSpeed:   16,     // units/s — max reverse speed
  acceleration:      20,     // units/s² — progressive realistic supercar torque curve
  brakeForce:        42,     // units/s² — strong, responsive braking
  reverseAccel:      18,     // units/s² — reverse throttle
  drag:              0.42,   // natural air resistance
  rollingResistance: 2.0,    // deceleration when no input

  // ── Steering & Handling ────────────────────────────────────
  steerSpeed:        3.8,    // rad/s — base steering rate
  steerSpeedDecay:   0.40,   // speed decay factor
  steerReturnSpeed:  6.5,    // rad/s — centering rate
  maxSteerAngle:     1.0,    // rad — visual front wheel turn

  // ── Grip & Drift ──────────────────────────────────────────
  gripNormal:        0.92,   // solid grip on tarmac
  gripDrift:         0.52,   // drift slip factor
  driftEntrySpeed:   10,     // min speed for drift
  driftSteerBoost:   1.35,   // steering boost while drifting

  // ── 6DOF Surface Physics ───────────────────────────────────
  gravityDir:        [0, -1, 0] as readonly [number, number, number],
  gravityStrength:   28,     // world gravity in air
  downforce:         1.5,    // surface adhesion downforce
  probeOffset:       1.0,    // raycast origin offset
  snapDistance:      3.5,    // surface snap distance
  surfaceAlignSpeed: 24,     // normal alignment rate
  airControlFactor:  0.4,    // airborne steering control
  ccdMargin:         0.06,   // obstacle safety margin
  groundY:           0,

  // ── Chase Camera ───────────────────────────────────────────
  camDistance:       5.4,    // tight behind car
  camHeight:         2.2,    // low over-the-shoulder angle
  camLookAhead:      5.5,    // look-ahead target
  camLagPosition:    14.0,   // snappy follow lag (never drifts far behind)
  camLagLookAt:      12.0,   // look-target smoothing
  camFovMin:         60,     // natural FOV at standstill
  camFovMax:         68,     // controlled FOV at top speed (avoids distant blowout)
  camFovLag:         4.0,

  // ── Realistic Supercar Dimensions & Styling ────────────────
  carLength:         2.6,
  carWidth:          1.35,
  carHeight:         0.68,
  bodyColor:         0xd41c1c, // vibrant glossy race red
  cabinColor:        0x14202c, // tinted glass
  chassisColor:      0x1c1e22, // carbon fiber / matte black trim
  wheelColor:        0x202226, // rubber tire & alloy
  caliperColor:      0xffc400, // yellow sport brake calipers

} as const;
