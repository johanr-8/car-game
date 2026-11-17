/**
 * src/core/constants.ts
 * Engine-wide constants.
 */

/** Fixed physics timestep: 120 Hz */
export const FIXED_DT = 1 / 120;

/** Max accumulated time before physics is clamped (prevents spiral of death) */
export const MAX_ACCUMULATOR = 0.25;

/** Target draw call budget */
export const MAX_DRAW_CALLS = 200;

/** Max point lights in scene */
export const MAX_POINT_LIGHTS = 8;

/** Subtle natural bloom pass — no blinding neon blowout */
export const BLOOM_THRESHOLD = 0.95;
export const BLOOM_STRENGTH  = 0.15;
export const BLOOM_RADIUS    = 0.2;

/** Bright vibrant sky horizon colour */
export const BG_COLOR = 0x5a9ad6;
