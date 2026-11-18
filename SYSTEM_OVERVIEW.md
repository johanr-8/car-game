# System Overview: Warp City (Velocity Drift)

> Forensic Architectural Reconnaissance Report  
> Generated: 2026-11-18 | Target: Read-Only Audit | Mode: Single-File Synthesis

---

## 1. STRUCTURE

### Source Tree (`src/`)
```
src/
├── main.ts                         # Application entrypoint; orchestrates 120Hz physics loop, alpha-rendering, and HUD
├── audio/
│   └── index.ts                    # Empty audio module stub (88 bytes); sound system is currently UNIMPLEMENTED
├── car/
│   ├── AIRival.ts                  # [DEAD CODE] Legacy waypoint AI racer with gravity well queries; unreferenced
│   ├── ArcadeCarController.ts      # 6DOF surface-snapping raycast vehicle physics, steering, throttle, and wall deflection
│   ├── BoostSystem.ts              # Kinetic boost economy; manages charge refills via drifting, wall-riding, and jumps
│   ├── CarConfig.ts                # Centralized static tuning parameters, vehicle dimensions, speeds, and camera offsets
│   ├── CarModel.ts                 # Visual supercar mesh assembly (bodywork, wheels, cockpit, brake lights, contact shadow)
│   ├── ChaseCamera.ts              # 6DOF chase camera; orthonormal basis matrix alignment and quaternion SLERP follow
│   ├── GhostModel.ts               # Semi-transparent cyan ghost supercar mesh used for personal best replay playback
│   ├── GhostRecorder.ts            # Fixed-size Float32Array trajectory recorder and interpolating playback sampler
│   └── index.ts                    # Barrel export for vehicle controllers, models, cameras, and recorders
├── core/
│   ├── constants.ts                # Engine constants: 120Hz physics timestep (FIXED_DT), bloom parameters, draw call budget
│   ├── index.ts                    # Barrel export for core engine utilities
│   ├── InputManager.ts             # Keyboard event listener capturing continuous WASD/Arrows and edge-triggered reset
│   ├── PostProcessing.ts           # Three.js EffectComposer setup: RenderPass, UnrealBloomPass, and OutputPass
│   ├── Renderer.ts                 # WebGL2 renderer initialization with ACES tone mapping and PCFSoft shadow maps
│   ├── scratch.ts                  # [UNUSED] Module exporting pre-allocated scratch math objects (_v0.._v3, _q0, _m0)
│   ├── SeededRandom.ts             # Linear Congruential Generator (LCG) PRNG supporting daily seeds and seed remixing
│   └── StatsCollector.ts           # Rolling 60-frame buffer computing smoothed FPS, frame times, and physics tick counts
├── ui/
│   ├── DebugOverlay.ts             # F3-toggleable telemetry overlay displaying FPS, frame ms, draw calls, and triangles
│   ├── index.ts                    # Barrel export for UI components
│   └── RaceHUD.ts                  # DOM racing telemetry overlay: lap time, best time, speedometer, boost bar, modals
├── weapons/
│   ├── index.ts                    # [DEAD CODE] Barrel export for weapon system; unreferenced
│   └── WeaponSystem.ts             # [DEAD CODE] Legacy projectile system (Gravity Grenade, Pull Beam); unreferenced
└── world/
    ├── CollisionWorld.ts           # three-mesh-bvh collision proxy manager; merges proxy geometries and runs raycasts
    ├── GravityWell.ts              # [DEAD CODE] Legacy spherical black hole and moon orbital pull logic; unreferenced
    ├── Ground.ts                   # [DEAD CODE] Standalone flat neon grid ground plane mesh; unreferenced
    ├── index.ts                    # Barrel export for world generation and collision systems
    ├── InversionSystem.ts          # State tracker flagging inverted high-altitude skyway sections for HUD alerts
    ├── ProceduralCity.ts           # Chunked instanced skyscraper metropolis generator with track corridor avoidance
    ├── SurrealElements.ts          # [DEAD CODE] Legacy flying whales, melting clocks, and suspended rivers; unreferenced
    ├── TestLevel.ts                # [DEAD CODE] Legacy test playground with ramps and obstacles; unreferenced
    ├── TextureGenerator.ts         # HTML5 2D canvas procedural texture generator (asphalt, concrete, grass, plaza)
    ├── TimeOfDay.ts                # Atmosphere definitions (Daylight, Golden Hour, Tropical, Dusk) with sun/fog params
    └── TrackSpline.ts              # 33-node Catmull-Rom spline, parallel transport frames, 3D barriers, curbs, gantries
```

### Dependencies & Versions (`package.json`)
- **Runtime Dependencies**:
  - `three`: `^0.170.0` (Core 3D WebGL scenegraph and rendering library)
  - `three-mesh-bvh`: `^0.9.18` (Spatial bounding volume hierarchy for accelerated triangle-level raycasting)
- **Dev Dependencies**:
  - `@rollup/wasm-node`: `^4.68.5`
  - `@types/three`: `^0.170.0`
  - `typescript`: `^5.7.2`
  - `vite`: `^6.0.1`

### Build Tool & TypeScript Configuration
- **Bundler**: Vite 6.0.1 configured in `vite.config.ts`. Target: `es2022`, sourcemap enabled, dev server running on port `5173`. Path aliases configured for `@core`, `@car`, `@world`, `@weapons`, `@ui`, `@audio`.
- **TypeScript**: `tsconfig.json` targets `ES2022`, module `ESNext`, moduleResolution `bundler`. Strict type checking enabled (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noImplicitReturns: true`).

---

## 2. MAIN LOOP

### Organization (`src/main.ts`)
The loop uses a standard Glenn Fiedler "Fix Your Timestep" accumulator pattern running inside `requestAnimationFrame`.
- **Physics Timestep**: `FIXED_DT = 1 / 120` seconds (~8.333 milliseconds).
- **Accumulator Clamping**: `MAX_ACCUMULATOR = 0.25` seconds (prevents spiral of death if tab loses focus).
- **Interpolation Mechanism**: Leftover accumulator time produces blending fraction `alpha = accumulator / FIXED_DT`. Car visual transform is blended via `Vector3.lerpVectors(prevPosition, position, alpha)` and `Quaternion.slerpQuaternions(prevQuaternion, quaternion, alpha)`.

### Order of Operations
1. **Per Physics Tick (`while (accumulator >= FIXED_DT)`)**:
   1. Decrement `countdownTimer` (staging from 3.0 down to 0, then -0.7s for "GO!" display).
   2. Evaluate high-altitude inversion thresholds via `inversion.evaluateInversion()` and damp transition scalar.
   3. Step `boostSystem.update()` to evaluate nitro input, power-drift charging, wall-ride charging, and clean landings.
   4. Update car controller: `carCtrl.update()` if racing, or `carCtrl.updateStaging()` if counting down.
   5. Enforce track containment via `track.containCar()`.
   6. Fail-safe void check: if `carCtrl.position.y < -5`, respawn car at last cleared checkpoint.
   7. Advance race timers (`currentLapTime`, `totalRaceTime`) and record frame into `ghostRecorder.recordFrame()`.
   8. Check checkpoint crossing via `track.checkCarPassing()`: advance checkpoint index, or trigger lap completion / championship victory.
   9. Subtract `FIXED_DT` from `accumulator` and increment `stats.ticksThisFrame`.

2. **Per Render Frame (`requestAnimationFrame`)**:
   1. Calculate delta time (`performance.now() - lastTime`) clamped to `MAX_ACCUMULATOR`.
   2. Poll keyboard inputs via `readInput()`. Handle instant restart pulse (`input.restart`).
   3. Execute fixed physics tick loop.
   4. Compute render blending factor `alpha = accumulator / FIXED_DT`.
   5. Blend car position and rotation between `prevPosition`/`position` and `prevQuaternion`/`quaternion`.
   6. Update visual wheels (`carModel.updateVisuals()`).
   7. Update city chunk streaming / distance LOD around car (`city.updateChunkLOD()`).
   8. Query and interpolate ghost replay transform (`ghostRecorder.getGhostTransform()`).
   9. Update 6DOF chase camera position and orientation (`chaseCamera.update()`).
   10. Clear render stats and draw scene via `composer.render()`.
   11. Update debug overlay (`debug.update()`) and telemetry HUD (`raceHUD.update()`).

### Quoted Main Loop Code (`src/main.ts:230-269`)
```typescript
function loop(): void {
  requestAnimationFrame(loop);

  const now  = performance.now();
  const dtMs = now - lastTime;
  lastTime   = now;

  const dt = Math.min(dtMs / 1000, MAX_ACCUMULATOR);
  accumulator += dt;

  const input = readInput();

  if (input.restart) {
    restartRace();
  }

  // ── Fixed-Timestep Physics (120 Hz) ──
  stats.ticksThisFrame = 0;
  while (accumulator >= FIXED_DT) {
    // 1. Countdown staging
    if (countdownTimer > 0) {
      countdownTimer -= FIXED_DT;
      if (countdownTimer <= 0) {
        countdownTimer = -0.7; // 'GO!' banner
      }
    } else if (countdownTimer > -1.0) {
      countdownTimer -= FIXED_DT;
    }

    // 2. Inversion Event Evaluation
    inversion.evaluateInversion(activeCheckpointIndex, carCtrl.position.y);
    inversion.update(FIXED_DT);

    // 3. Kinetic Boost System Update (Track-based Skill Rewards)
    const { isBoosting, boostForce } = boostSystem.update(
      FIXED_DT,
      input.boost,
      carCtrl.isGrounded,
      carCtrl.surfaceNormal.y,
      carCtrl.speed,
      carCtrl.isDrifting
    );
```

---

## 3. STATE MANAGEMENT

### Architecture: Scattered Variables vs. State Machine
There is **no finite state machine (FSM)**. Game flow is controlled through scattered module-level mutable primitive variables and booleans inside `src/main.ts`.

### Module-Level Mutable Variables in `src/main.ts`
| Variable | Type | Initial Value | Purpose / Mutation Triggers |
| :--- | :--- | :--- | :--- |
| `currentThemeIndex` | `number` | `0` | Index into `CITY_THEMES`; incremented on city remix |
| `currentTheme` | `CityTheme` | `CITY_THEMES[0]` | Active lighting/fog configuration; mutated on city remix |
| `collisionWorld` | `CollisionWorld` | `new CollisionWorld()` | Re-instantiated during scene rebuilds |
| `city` | `ProceduralCity` | `undefined` | Re-instantiated during city rebuilds |
| `inversion` | `InversionSystem` | `undefined` | Re-instantiated during city rebuilds |
| `track` | `TrackSpline` | `undefined` | Re-instantiated during city rebuilds |
| `currentSeed` | `number` | `dailySeed` | RNG seed; modified during city remix (`(seed + 7919) % 1000000`) |
| `isDaily` | `boolean` | `true` | Set to `false` when user remixes city |
| `countdownTimer` | `number` | `3.0` | Staging timer; decremented by `FIXED_DT`; freezes car when `> 0` |
| `isRacing` | `boolean` | `true` | Flags active race; set to `false` when 3 laps complete |
| `totalRaceTime` | `number` | `0` | Cumulative race time across all 3 laps |
| `currentLapTime` | `number` | `0` | Elapsed timer for active lap; reset at finish line |
| `lapCount` | `number` | `1` | Current lap number (1 to 3); incremented at finish line |
| `activeCheckpointIndex` | `number` | `1` | Index of next gate car must trigger; incremented sequentially |
| `awaitingFinishLine` | `boolean` | `false` | True when all intermediate gates passed; awaiting gate 0 |
| `accumulator` | `number` | `0` | Delta time accumulator for 120Hz fixed physics ticks |
| `lastTime` | `number` | `performance.now()` | Timestamp of previous animation frame |

---

## 4. CAR CONTROLLER & CONFIG

### Public Interface: `ArcadeCarController`
- **Properties**:
  - `readonly position: THREE.Vector3` — Current 3D world position
  - `readonly quaternion: THREE.Quaternion` — Current 3D orientation quaternion
  - `readonly velocity: THREE.Vector3` — World velocity vector
  - `readonly surfaceNormal: THREE.Vector3` — Smoothed normal of surface car is adhered to
  - `readonly prevPosition: THREE.Vector3` — Snapshot position from previous physics tick
  - `readonly prevQuaternion: THREE.Quaternion` — Snapshot quaternion from previous physics tick
  - `speed: number` — Scalar longitudinal speed (units/s)
  - `isGrounded: boolean` — True if downward surface raycast detected track
  - `isDrifting: boolean` — True if drift key held and speed threshold met
  - `steerVisual: number` — Smoothed steering input for wheel turning visuals
  - `boostActive: boolean` — Set externally by `BoostSystem`
  - `boostForce: number` — Additional acceleration applied when boosting
  - `hasBarrierContact: boolean` — Sector barrier contact flag (cleared on checkpoint crossing)
  - `get speedNorm(): number` — Speed scalar normalized against top speed (0..1)
- **Methods**:
  - `update(dt: number, input: InputState, collision: CollisionWorld): void` — Full 120Hz physics step
  - `updateStaging(collision: CollisionWorld): void` — Standstill surface adherence during countdown

### Quoted Physics Update Function (`src/car/ArcadeCarController.ts:99-135`)
```typescript
  update(dt: number, input: InputState, collision: CollisionWorld): void {
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
```

### Handling Grounded vs. Airborne, Drifting, Boost & Barriers
- **Grounded vs. Airborne**: Handled in `detectSurface()`. Casts probe downward along `-surfaceNormal` for distance `snapDistance + 1.4` (4.9m). If `_hitDown.normal.dot(surfaceNormal) > 0.35`, car is grounded; position is snapped to `targetRideHeight = carHeight * 0.5` (0.34m) along the hit normal. If raycast misses, `isGrounded = false`, downward gravity (`gravityStrength = 28`) is integrated into `velocity.y`, and steering authority drops to `airControlFactor = 0.4`.
- **Drifting**: Triggered if `input.drift && absSpeed > driftEntrySpeed` (10 units/s). Increases steering rate by `driftSteerBoost` (1.35x) and sets `grip = gripDrift` (0.52).
- **Boost**: Adds `boostForce` (36) to acceleration and raises top speed to `maxSpeed * 1.5` (72 units/s ~ 259 km/h).
- **Barrier Contact**: Evaluated in `integrateMotion()`. Probes laterally left and right to wheel boundaries (`halfW + 0.12`). If penetration occurs, position is projected out along the barrier normal, lateral velocity is canceled, and forward speed is scrubbed by 6% (`speed *= 0.94`). Forward swept probes detect perpendicular walls, deflecting velocity along the wall plane and scrubbing speed by 15%.

### Complete Dump of `CarConfig.ts`
```typescript
export const CarConfig = {
  // Speed & Power
  maxSpeed:          48,     // units/s (~173 km/h base cruising, ~259 km/h with nitro boost)
  reverseMaxSpeed:   16,     // units/s — max reverse speed
  acceleration:      20,     // units/s² — progressive supercar torque curve
  brakeForce:        42,     // units/s² — responsive braking
  reverseAccel:      18,     // units/s² — reverse throttle
  drag:              0.42,   // natural air resistance
  rollingResistance: 2.0,    // deceleration when no input

  // Steering & Handling
  steerSpeed:        3.5,    // rad/s — base steering rate
  steerSpeedDecay:   0.46,   // speed decay factor
  steerReturnSpeed:  6.5,    // rad/s — centering rate
  maxSteerAngle:     1.0,    // rad — visual front wheel turn

  // Grip & Drift
  gripNormal:        0.92,   // solid grip on tarmac
  gripDrift:         0.52,   // drift slip factor
  driftEntrySpeed:   10,     // min speed for drift
  driftSteerBoost:   1.35,   // steering boost while drifting

  // 6DOF Surface Physics
  gravityDir:        [0, -1, 0] as readonly [number, number, number],
  gravityStrength:   28,     // world gravity in air
  downforce:         1.5,    // surface adhesion downforce
  probeOffset:       1.0,    // raycast origin offset
  snapDistance:      3.5,    // surface snap distance
  surfaceAlignSpeed: 24,     // normal alignment rate
  airControlFactor:  0.4,    // airborne steering control
  ccdMargin:         0.06,   // obstacle safety margin
  groundY:           0,

  // Chase Camera
  camDistance:       5.4,    // tight behind car
  camHeight:         2.2,    // low over-the-shoulder angle
  camLookAhead:      5.5,    // look-ahead target
  camLagPosition:    14.0,   // snappy follow lag
  camLagLookAt:      12.0,   // look-target smoothing
  camFovMin:         60,     // natural FOV at standstill
  camFovMax:         68,     // controlled FOV at top speed
  camFovLag:         4.0,

  // Realistic Supercar Dimensions & Styling
  carLength:         2.6,
  carWidth:          1.35,
  carHeight:         0.68,
  bodyColor:         0xd41c1c, // vibrant glossy race red
  cabinColor:        0x14202c, // tinted glass
  chassisColor:      0x1c1e22, // carbon fiber / matte black trim
  wheelColor:        0x202226, // rubber tire & alloy
  caliperColor:      0xffc400, // yellow sport brake calipers
} as const;
```

---

## 5. COLLISION PIPELINE

### End-to-End Architecture
Collision detection is decoupled from visuals and executed via `CollisionWorld` using `three-mesh-bvh`:

```
[Level Build] -> Add Low-Poly Proxies -> StaticGeometryGenerator -> Merged BufferGeometry -> computeBoundsTree() -> BVH Collision Mesh
                                                                                                                                |
[120Hz Physics Tick] <----------------------- acceleratedRaycast() <------------------------------------------------------------+
```

1. **Geometry Registration**: Road surface mesh and crash barrier mesh are registered into `CollisionWorld.addProxy()`. Building bounding boxes are added in `ProceduralCity.registerCollisionProxies()`.
2. **BVH Generation (`buildBVH()`)**: `StaticGeometryGenerator` merges all proxy meshes into a single `BufferGeometry` containing only `position` and `normal` attributes. `computeBoundsTree()` constructs an AABB hierarchy tree. A single invisible `THREE.Mesh` wraps the merged geometry with `acceleratedRaycast`.
3. **Collision Query Return**:
   - `CollisionWorld.raycast(origin, direction, maxDistance, outHit: SurfaceHit): boolean`
   - Populates `SurfaceHit`: `{ hit: boolean, distance: number, point: Vector3, normal: Vector3 }`.
   - **Does NOT return penetration depth**: Penetration is computed by callers (`(halfW + 0.04) - hit.distance`).
   - **Does NOT return impact angle**: Dot products are calculated at the call site.
4. **Per-Tick Raycasts (Executed 120 times/second)**:
   - `detectSurface()`: 1 downward raycast + 1 lookahead raycast (2 raycasts).
   - `integrateMotion()`: 1 lateral left wheel raycast + 1 lateral right wheel raycast (2 raycasts).
   - `integrateMotion()`: 1 to 3 forward swept raycasts (center bumper, front-left wheel corner, front-right wheel corner).
   - **Total per tick**: 5 to 7 BVH raycasts per car per tick (600 to 840 raycasts/second at 120Hz).
5. **Fail-Safe Containment (`TrackSpline.containCar()`)**:
   - Runs independently of BVH raycasts at the end of each tick.
   - Performs a localized window search ($\pm 25$ segments) along track center points to locate nearest spline node.
   - Measures lateral distance along track binormal: `latDist = (carPos - centerPoint).dot(binormal)`.
   - If `|latDist| > 6.25m` (road half-width 7.0m - 0.75m wheel margin), it hard-clamps position to 6.25m and zeroes out outward lateral velocity.

---

## 6. TRACK GENERATION & INVERSION

### Track Spline Definition
- Defined by **33 hardcoded 3D control points** in `TrackSpline.ts` (`this.pointDefs`).
- Interpolated using a closed centripetal Catmull-Rom spline: `new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5)`.
- Divided into **320 discrete segments**. Tangents, normals, and binormals are computed via **Rotation Minimizing Frames (Bishop / Parallel Transport)**. The holonomy loop-closure twist angle at $u=1.0$ vs $u=0.0$ is evenly distributed across all 320 segments, preventing Gram-Schmidt flips.

### Meshes & Features
- **Road Ribbon Mesh**: Procedurally built continuous quad strip (14m road width). Double-sided `MeshStandardMaterial` using procedural asphalt texture map.
- **Solid Crash Barriers**: 2.2m tall, 0.5m thick 3D volumetric extrusion bordering both edges with inner face, top cap, and outer face.
- **Rumble Curbs**: 3D red-and-white curbs built as two `THREE.InstancedMesh` nodes placed every 2 segments along both road lips.
- **Checkpoints**: 8 steel truss gantry gates built with support pillars, crossbars, and emissive LED rings.

### Inverted & Wall Sections: Physical Reality vs. Camera Roll
- **Physical Road Geometry**: Tower Ascent (Points 5 to 10) climbs the South face of the Apex Skyscraper from $Y = 2.5$ to $Y = 96.0$ (90° vertical wall). Celestial Skyway (Points 21 to 26) curves overhead from $Y = 18$ to $Y = 25$ with inverted normals. The track ribbon has **genuine 3D physical surface geometry and BVH collision**. The car physically drives upside-down because its surface raycasts and orthonormal basis alignment stick it to the inverted face.
- **Camera Roll in `InversionSystem.ts`**: `evaluateInversion()` monitors whether `activeCheckpoint === 6 || carPosY > 90` and sets `this.isInverted = true`. The main loop uses `isInverted` **ONLY to toggle the red HUD alert banner** (`raceHUD.setInversionAlert()`). An earlier camera roll multiplier was removed because the chase camera's quaternion SLERP already follows the car's physical upside-down orientation.

### What Does the Daily Seed Change?
- **Track Spline**: **UNCHANGED**. The 33 track control points, curbs, gantries, and barriers are 100% hardcoded.
- **Procedural City**: **CHANGED**. `ProceduralCity` uses `SeededRandom(seed)` to determine skyscraper positions, lot widths, depths, heights, material styles (glass/concrete/limestone/steel), and spires outside the track corridor.

---

## 7. RACE LOGIC

### Checkpoint & Lap Validation
- **8 Sequential Gates**: Defined at spline fractions $u \in [0.00, 0.12, 0.25, 0.38, 0.50, 0.62, 0.76, 0.88]$.
- **Shortcut Protection**: `track.checkCarPassing(carPos, activeCheckpointIndex)` checks Euclidean distance to the *active* gate (`radius = 12m` or `14m`). Gates **must be cleared in strict sequential order** ($0 \rightarrow 1 \rightarrow 2 \rightarrow 3 \rightarrow 4 \rightarrow 5 \rightarrow 6 \rightarrow 7 \rightarrow 0$). Skipping ahead to checkpoint 3 while checkpoint 1 is active fails the check. Track cutting across grass/city is blocked by `containCar()` lateral barriers (6.25m boundary) and building collision meshes.
- **Wrong-Way Handling**: **NON-EXISTENT**. There is no backward driving detection, wrong-way alert, or turn-around penalty. If a player drives backward, gates simply do not advance.

### Reset Behavior (`restartRace()`)
- **Restored**: Car position reset to start line `(0, 0.94, 25)` heading `-Z`. Velocity, speed, and angular rotation zeroed out. Chase camera snapped to car without interpolation lag. Checkpoints reset: gate 1 set to active, others cleared. `countdownTimer` reset to `3.0s`. `boostSystem.charge` reset to `50%`. `lapCount` reset to 1; `currentLapTime` and `totalRaceTime` reset to 0.
- **Ghost Preservation**: `ghostRecorder.startLap()` resets current recording buffer (`currentFrameCount = 0`). **The best lap buffer and best lap time are PRESERVED**. Restarting does not wipe your ghost record.

### Finish Handling
- Once `lapCount >= 3` and finish gate (index 0) is crossed: `isRacing` set to `false`. `raceHUD.showVictory(1, totalRaceTime, ghostRecorder.bestLapTime)` displays championship podium modal with restart and remix buttons.

---

## 8. GHOST REPLAY SYSTEM

- **Recording Frequency**: 120 Hz (runs inside physics loop: `ghostRecorder.recordFrame()`).
- **Data Structure**: Pre-allocated typed array `Float32Array(MAX_FRAMES * FLOATS_PER_FRAME)`. Frame layout: 7 floats `[x, y, z, qx, qy, qz, qw]`.
- **Capacity & Memory Footprint**:
  - `MAX_FRAMES = 120 * 180 = 21,600` frames (3.0 minutes capacity).
  - Floats per buffer: $21,600 \times 7 = 151,200$ floats.
  - Bytes per buffer: $151,200 \times 4\text{ bytes} = 604,800\text{ bytes}$ (~604.8 KB).
  - Two buffers (`currentLapBuffer` and `bestLapBuffer`): **~1.21 MB total RAM**.
- **Storage Location**: In-memory JavaScript heap inside `GhostRecorder` instance. **No persistent storage**: Not saved to `localStorage` or `IndexedDB`. Page reload wipes the ghost.
- **Delta Computation**: **NOT IMPLEMENTED**. `GhostRecorder` does not record checkpoint split timestamps or compute real-time delta intervals.
- **Track Invalidation on Remix**: When user remixes city, the track spline does not change, so the ghost remains physically aligned. If track geometry changes in future versions, `GhostRecorder` has no validation logic and will replay the ghost along obsolete coordinates.

---

## 9. SINGLE-CAR ASSUMPTIONS & MULTI-CAR WORK ESTIMATE

### Hardcoded Single-Car Assumptions
1. **Physics & Controller**: `carCtrl` in `main.ts` is an isolated instance; physics updates, staging, and void rescue assume one player.
2. **Scenegraph & Visuals**: `carModel` is a single instance added directly to `scene`.
3. **Chase Camera**: `ChaseCamera` accepts one target position and quaternion. No viewport splitting or multi-target framing exists.
4. **Collision Architecture**: `CollisionWorld` only evaluates car-vs-environment raycasts. There is zero vehicle-to-vehicle collision detection, restitution, or bumper bounding sphere queries.
5. **HUD & Telemetry**: `RaceHUD` binds to a single speed, boost charge, lap time, and checkpoint progression.
6. **Checkpoint System**: `track.checkCarPassing(carPos, activeIndex)` uses a single global `activeCheckpointIndex`. It cannot track multiple racers at different points along the track.
7. **Containment System**: `track.containCar(carPos, carVel)` tracks one `lastNearestIdx` cache variable. Passing multiple cars will cause cache thrashing across disparate track segments.
8. **Ghost System**: `GhostRecorder` handles exactly one recording stream and one replay stream.
9. **Input System**: `InputManager` listens to global keyboard events and returns one singleton `_state`.

### Work Estimate to Support $N$ Cars (AI Rivals or Multiplayer)
- **Refactor Scope**: **Medium-High (14 to 20 engineering hours)**.
- **Required Architectural Changes**:
  1. *Vehicle Manager*: Encapsulate `ArcadeCarController`, `CarModel`, `BoostSystem`, and vehicle state into a `VehicleEntity` class. Maintain an array `vehicles: VehicleEntity[]`.
  2. *Car-to-Car Collision*: Add inter-vehicle swept sphere-capsule or oriented bounding box (OBB) separation in `integrateMotion` ($O(N^2)$ checks, trivial for $N \le 12$).
  3. *Independent Race Telemetry*: Move `activeCheckpointIndex`, `lapCount`, and `currentLapTime` from `main.ts` into each vehicle entity.
  4. *Multi-Instance Checkpoint Tracking*: Refactor `TrackSpline.checkCarPassing` to take a vehicle ID and individual progress index.
  5. *Leaderboard & Position Sorting*: Compute track progress spline distance $u$ per vehicle each tick to drive a dynamic 1st..Nth race ranking.

---

## 10. DETERMINISM & HEAP ALLOCATIONS

### Non-Deterministic Calls in Physics Path
- `Math.random`: **0 calls** in physics path. (Used only in offline texture generation and dead weapon file).
- `Date.now`: **0 calls** in physics path.
- `performance.now`: **0 calls** inside physics loop. (Called once per frame in `main.ts` render loop to measure frame delta).
- **PRNG**: `ProceduralCity` uses `SeededRandom` (deterministic linear congruential generator).
- **Physics Timestep**: Purely deterministic fixed-rate stepping (`dt = FIXED_DT = 1 / 120`).

### Per-Tick and Per-Frame Heap Allocations
1. **Physics Loop Violations**:
   - `main.ts:298` (Void rescue): Calls `cp.position.clone()` and `track.getNormalAt()`.
   - `TrackSpline.ts:170`: `getNormalAt()` instantiates `new THREE.Vector3().lerpVectors(...)` on every call.
2. **Render Frame Violations**:
   - `RaceHUD.ts:529` (`formatTime`): Instantiates 3 string objects (`String.padStart`) plus template literals on every render frame.
   - `RaceHUD.ts:560-585`: Unconditional DOM writes to `.textContent` and `.style` across 11 elements every frame without dirty checks.
3. **Clean Zero-Allocation Subsystems**:
   - `ArcadeCarController`: All 18 scratch vectors, quaternions, and hit structures are pre-allocated at module scope.
   - `ChaseCamera`: All 10 basis matrices, directions, and quaternions are pre-allocated at module scope.
   - `GhostRecorder`: Float32Array buffers and scratch vectors pre-allocated; zero GC allocations during recording or playback.
   - `CollisionWorld`: Reuses a single `Raycaster` and internal `hits` array.

---

## 11. RENDERING PIPELINE

### Scene Setup & Lighting
- **Scene**: `THREE.Scene` with exponential distance fog `THREE.FogExp2(theme.fogColor, theme.fogDensity)`.
- **Directional Sunlight**: Primary directional light (`sunLight`, intensity 2.4 to 3.0) casting real-time shadows. Shadow map: $2048 \times 2048$, `PCFSoftShadowMap`, shadow camera bounds $[-160, 160]$ with bias $-0.0004$ and normalBias $0.02$.
- **Hemisphere Ambient Light**: `THREE.HemisphereLight` providing ambient illumination with sky color bounce and green ground bounce (zero pitch-black surfaces).
- **Secondary Fill Light**: Unshadowed directional fill light (`intensity = 0.8`) at `(-80, 100, -80)`.

### Geometry & Material Construction
- **City Skyscrapers**: Built as **4 `THREE.InstancedMesh` nodes** (White Concrete, Blue Glass, Limestone, Slate Steel) plus 1 cornice mesh and 1 spire mesh. Total city draw calls: **6 draw calls**.
- **Road Surface**: Single continuous indexed `THREE.BufferGeometry` (640 vertices, 640 triangles).
- **Crash Barriers**: Single continuous indexed `THREE.BufferGeometry` (2,560 vertices, 2,560 triangles).
- **Rumble Curbs**: Built as **2 `THREE.InstancedMesh` nodes** (Red and White).
- **Checkpoints**: 8 gantry gates built as individual group hierarchies (support pillars, crossbars, status rings).

### Post-Processing Pipeline
- Managed via `EffectComposer`:
  1. `RenderPass`: Base WebGL2 scene pass.
  2. `UnrealBloomPass`: Luminance threshold `0.95`, strength `0.15`, radius `0.2` (subtle high-luminance bloom on headlights, taillights, and LED checkpoint rings).
  3. `OutputPass`: ACES Filmic tone mapping and sRGB color space conversion.

### Estimated Draw Calls & Polygon Budget
- **Draw Calls**: **22 to 36 draw calls** total per frame (well under the 200 draw call limit).
- **Triangles**: **65,000 to 110,000 triangles** depending on active city chunk LOD.
- **Live Performance Monitoring**: Press **`F3`** in-game to display `DebugOverlay`. Read draw calls from row: `Draw Calls :` (`renderer.info.render.calls`). Read triangle count from row: `Triangles :` (`renderer.info.render.triangles`).

---

## 12. UI & INPUT SUBSYSTEM

### HUD Per-Frame Updates & DOM Overhead
- `RaceHUD.update()` is called on every render frame.
- **Overwrites DOM properties every frame without change detection**:
  - `elLapTime.textContent` (string generated via `formatTime`)
  - `elBestTime.textContent`, `elLapCount.textContent`, `elCheckpoints.textContent`, `elPosition.textContent`
  - `elSpeed.textContent` (numeric value smoothed with `THREE.MathUtils.lerp`)
  - `elBoostBar.style.width` and `elBoostBar.style.background`
  - `elGhostState.textContent` and `elGhostState.style.color`
  - `elInversion.style.display`

### Input Support & Hardware Mapping
- **Hardware Supported**: **Keyboard only**. (The Gamepad API `navigator.getGamepads()` is UNIMPLEMENTED despite file header notes).
- **Key Mappings**:
  - `KeyW` / `ArrowUp`: Throttle (1.0)
  - `KeyS` / `ArrowDown`: Brake / Reverse (1.0)
  - `KeyA` / `ArrowLeft`: Steer Left (-1.0)
  - `KeyD` / `ArrowRight`: Steer Right (+1.0)
  - `Space`: Power Drift (engages drift slip and boost charging)
  - `ShiftLeft` / `ShiftRight` / `KeyB`: Nitro Boost
  - `KeyR` / `Enter`: Instant race restart
  - `KeyH`: Toggle Objective / Mission Briefing modal
  - `F3`: Toggle telemetry debug overlay
  - `KeyM`: Displayed on Victory UI for "City Remix (M)", but **unbound in keyboard listener** (clicking button works, pressing 'M' does nothing).

---

## 13. DATA PERSISTENCE

- **Persistent Storage**: **NONE**.
- The game does not read or write to `localStorage`, `sessionStorage`, or `IndexedDB`.
- Best lap time, ghost trajectory buffers, and selected city themes reside strictly in RAM.
- **Reload Consequence**: Refreshing the browser tab completely resets personal bests, ghost replays, and race records.

---

## 14. DEAD CODE & UNUSED EXPORTS

### Dead Code Files (Unreferenced in `src/main.ts`)
1. `src/weapons/WeaponSystem.ts` (325 lines) & `src/weapons/index.ts`: Entire projectile weapon and pickup pod subsystem.
2. `src/car/AIRival.ts` (152 lines): Waypoint-following AI rival car with gravity well hooks.
3. `src/world/GravityWell.ts` (168 lines): Radial black hole and moon slingshot pull fields.
4. `src/world/SurrealElements.ts` (282 lines): Procedural flying whales, melting clocks, and suspended rivers.
5. `src/world/TestLevel.ts` (148 lines): Legacy test ground plaza and obstacle courses.
6. `src/world/Ground.ts` (34 lines): Standalone grid ground plane.
7. `src/audio/index.ts` (4 lines): Empty stub.

### Unused Exports & Stale Declarations
- `src/core/scratch.ts`: Exports `_v0.._v3`, `_q0.._q1`, `_m0`, `_e0`, `_c0`. Re-exported by `src/core/index.ts`, but never imported by any active module.
- `src/world/index.ts`: Still exports dead classes `SurrealElements`, `Ground`, `GravityWell`.
- `src/car/index.ts`: Still exports dead class `AIRival`.
- `src/core/InputManager.ts:6`: Header comment references dead actions `fire weapon (KeyE / KeyF)`.
- `RULES.md:26`: States "No real-time shadows (`renderer.shadowMap.enabled = false`)", contradicting the active `PCFSoftShadowMap` pipeline.
- `TODO / FIXME` Comments: **0 found** across all `.ts` files.

---

## 15. TOP 10 ARCHITECTURAL RISKS

Ordered by severity from highest blocker to lowest:

1. **Monolithic Physics & Track Coupling in `TrackSpline.ts`**:
   - *Risk*: `TrackSpline` mixes visual spline construction, 3D barrier extrusion, checkpoint gantry instantiation, and the physics containment routine (`containCar`) inside a single 639-line class.
   - *Impact*: Blocking for a Trackmania-style modular track builder. Assembling a track from modular pieces requires decoupling the spline generation from the physics containment and collision proxy systems.
2. **Missing Vehicle-to-Vehicle Collision in `CollisionWorld`**:
   - *Risk*: `CollisionWorld` only supports raycasting against a static pre-baked BVH. It has no dynamic collision primitives, capsule colliders, or vehicle-to-vehicle separation.
   - *Impact*: Blocking for AI rivals, combat abilities, and multiplayer. Cars will phase through one another like ghosts.
3. **Hardcoded Single-Car State in `main.ts`**:
   - *Risk*: Active checkpoint index, lap count, race timers, and fail-safe void rescues are loose module-level variables tied to one car.
   - *Impact*: Adding AI rivals or multiplayer requires refactoring these variables into an encapsulated vehicle entity or player state container.
4. **Exponential Lateral Friction Decay Bug in `ArcadeCarController`**:
   - *Risk*: `latSpeed = velocity.dot(_rightTan) * (1 - grip)` executes per tick at 120Hz, decaying lateral slip momentum to zero within 16 milliseconds.
   - *Impact*: High-speed power drifting feels snappy and digital rather than analog and controllable. Counter-steering and holding lines is impossible without exponential time-based decay.
5. **No Dynamic / Streaming BVH for Open-World Mode**:
   - *Risk*: The BVH is baked once at startup into a single merged mesh via `StaticGeometryGenerator`.
   - *Impact*: Blocking for large open-world maps. A giant GTA-sized metropolis cannot bake all collision geometry into a single static BVH without exceeding memory budgets and stalling the main thread. Requires a chunked, dynamic BVH tree.
6. **Hardcoded Track Definition Precludes Dynamic Tracks**:
   - *Risk*: 33 control points are hardcoded inside `TrackSpline.ts`. `main.ts` directly calls `new TrackSpline(collisionWorld)`.
   - *Impact*: Cannot load custom player tracks, URL seeds, or user-built circuits without abstracting track data into a serializable schema (e.g., JSON node arrays).
7. **Complete Absence of Audio Engine**:
   - *Risk*: `src/audio/index.ts` is an empty stub. The game produces zero sound.
   - *Impact*: Severely degrades game feel and player engagement. High-speed racing requires audio cues for engine RPM, tire slip, boost activation, and barrier impacts.
8. **Unconditional DOM Layout Thrashing in `RaceHUD`**:
   - *Risk*: 11 DOM elements have their `textContent` and `style` rewritten every single frame at 60/120Hz without dirty checks.
   - *Impact*: Causes micro-stutters and browser layout recalculations on lower-end hardware and laptops with integrated graphics.
9. **Zero Data Persistence**:
   - *Risk*: Ghost records, best lap times, and vehicle settings exist only in RAM.
   - *Impact*: Players lose their best lap times and ghost replays upon browser refresh, destroying long-term progression.
10. **Dead Code & Stale Configuration Clutter**:
    - *Risk*: Over 1,000 lines of unreferenced legacy code (`WeaponSystem`, `AIRival`, `GravityWell`, `SurrealElements`, `TestLevel`) remain in the codebase.
    - *Impact*: Increases cognitive overhead, pollutes module exports, and causes confusion regarding active vs. obsolete features.
