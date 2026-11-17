# Warp City: Velocity Drift — Permanent Engineering Rules

These rules apply to **every** future step in this project without exception.
When in doubt, ask before violating any of them.

---

## ⚙️ Physics & Determinism

- **Fixed-timestep physics at 120 Hz** (`FIXED_DT = 1/120` s per tick).
- The render loop **accumulates delta time** and steps the physics world in fixed increments.
- **Interpolated rendering**: car/object transforms are blended between the previous and current physics state using the leftover accumulator fraction (`α`).
- **Deterministic physics**: Never call `Math.random()`, `Date.now()`, or `performance.now()` inside the physics tick — only use `FIXED_DT` and pre-seeded PRNGs (`SeededRandom`). Given identical inputs and initial state, runs must reproduce identical results after arbitrary tick counts.
- **Fail-safe surface containment**: Boundary clamping and obstacle swept-probes prevent car tunneling through road decks or containment barriers even at maximum boost speeds (259+ km/h).

## 🚀 Performance & Memory

- **Zero per-tick and per-frame heap allocations.**
  - Pre-allocate all `Vector3`, `Quaternion`, `Matrix4`, `Color`, `Euler` scratch objects at module or class scope.
  - Particle systems and projectiles use an **object pool** — no `new` inside `update()`.
  - Avoid string allocations, array spreads, or closure allocations in per-tick/per-frame loops.
- **Instanced meshes** (`THREE.InstancedMesh`) for every repeated geometry (road curbs, buildings, spires, cornices).
- Target **< 200 draw calls** per frame; monitor via the debug overlay.
- Geometry and materials are created **once** and cached — never inside a loop or per-frame path.

## 🎨 Rendering & Graphics

- **Real-time shadows**: Sunlight directional shadow mapping is active (`renderer.shadowMap.enabled = true`, `renderer.shadowMap.type = THREE.PCFSoftShadowMap`, map size `2048 x 2048`).
- **Graphics Quality Presets (Planned)**:
  - High: 2048 PCFSoft shadows + UnrealBloomPass + 4x chunk LOD.
  - Medium: 1024 PCFSoft shadows + UnrealBloomPass + 2x chunk LOD.
  - Low: Shadows disabled (`shadowMap.enabled = false`) + simplified materials.
- **Lighting**: Warm directional sunlight + realistic two-tone `THREE.HemisphereLight` (sky bounce + ground green bounce) + subtle directional fill light (zero pitch-black geometry).
- **Post-Processing**: One controlled **bloom pass** (`UnrealBloomPass`, threshold 0.95, strength 0.15, radius 0.2) + `OutputPass` (ACES Filmic tone mapping).

## 🏎️ Tuning & Vehicle Architecture

- **All tuning in config**: All speeds, accelerations, brake forces, drag coefficients, steering rates, grip factors, downforce, ride heights, and camera offsets must be defined in `CarConfig.ts` or designated config objects. Never bury magic tuning numbers in controller or physics update loops.
- **Custom arcade controller**: Rock-solid 6DOF surface-snapping raycast vehicle physics with local-axis steering and tangential velocity projection.
- **Camera follow**: Orthonormal basis matrix construction and quaternion SLERP follow — no LookAt gimbal lock or cross-product collapses.

## 🧪 Testing & Safety Net

- **Every feature must have an automated test where practical**:
  - Track spline continuity and loop closure holonomy.
  - Checkpoint sequential order validation and anti-shortcut integrity.
  - Anti-tunneling / high-speed barrier impact containment (259 km/h at 45°).
  - Physics step determinism (identical state after 1,000 fixed ticks).
- Run `npm test` and `npm run typecheck` before every milestone commit.

## 🖥️ Debug Overlay & Profiling

Always expose a live HUD (toggled with **F3**) showing:
- FPS (smoothed over 60 frames)
- Frame time (ms) with dev-only p50/p99 latency tracking
- Draw calls (`renderer.info.render.calls`)
- Triangle count (`renderer.info.render.triangles`)
- Physics ticks per rendered frame
- Surface normal and speed telemetry
- JS heap memory metrics (where supported)

## 🌐 Browser Target

- Runs at **60+ fps on a mid-range laptop** (integrated Intel/AMD GPU, ~4 GB VRAM).
- No WebGPU — WebGL 2 only.
- Total JS bundle < 2 MB gzipped.
- Use `import.meta.env` for feature flags, never `process.env`.

## 🗂️ Code Structure

```
src/
  core/      — engine loop, renderer, input, stats, postprocessing
  car/       — arcade controller, car model, chase camera, ghost recorder, boost system, config
  world/     — procedural city, track spline, collision world, time of day
  ui/        — race telemetry HUD, debug overlay
  audio/     — Web Audio synthesis, procedural engine & tire sounds
```

- Each folder has an `index.ts` barrel export.
- No circular imports between top-level modules.
- Pre-allocated scratch objects live at module scope within their respective subsystems.
