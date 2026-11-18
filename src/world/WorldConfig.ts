/**
 * src/world/WorldConfig.ts
 * ─────────────────────────────────────────────────────────────
 * World Configuration & Surface Tuning Specifications.
 *
 * RULES.md: All tuning in config. Fully parameter-driven so changing
 * worldSize or radii scales the entire world cleanly.
 * ─────────────────────────────────────────────────────────────
 */

export interface WorldSpec {
  /** Total world extent in meters (e.g. 4000m, spanning [-2000, 2000]). */
  worldSize: number;
  /** Size of each square terrain chunk in meters. */
  chunkSize: number;
  /** Seed for deterministic terrain and road network generation. */
  seed: number;
  /** Distance in chunks around player within which chunks are loaded. */
  loadRadius: number;
  /** Distance in chunks beyond which chunks are unloaded (hysteresis). */
  unloadRadius: number;
  /** Max milliseconds allotted to build chunks in a single frame. */
  maxBuildMsPerFrame: number;
  /** Grid subdivisions per chunk (e.g. 32 -> 32x32 quads). */
  terrainResolution: number;
  /** Maximum elevation amplitude in meters for rolling hills. */
  maxElevation: number;
}

export const DEFAULT_WORLD_SPEC: WorldSpec = {
  worldSize: 4000,
  chunkSize: 128,
  seed: 4242,
  loadRadius: 5,
  unloadRadius: 6,
  maxBuildMsPerFrame: 2.0,
  terrainResolution: 32,
  maxElevation: 10.0,
};

/**
 * Coordinate offset ensuring non-negative indices for chunk coordinates [-32768, 32767].
 */
export const CHUNK_KEY_OFFSET = 32768;

/**
 * Bijective 32-bit numeric key for 2D chunk/grid coordinates [-32768, 32767].
 * Zero heap allocations (no template strings or objects).
 * Key range [0, 4,294,967,295] fits comfortably within JavaScript's 53-bit safe integer limit.
 */
export function getChunkKey(cx: number, cz: number): number {
  return (cx + CHUNK_KEY_OFFSET) * 65536 + (cz + CHUNK_KEY_OFFSET);
}

export enum SurfaceType {
  ASPHALT = 'ASPHALT',
  GRASS = 'GRASS',
  DIRT = 'DIRT',
}

export interface SurfaceTuning {
  gripMultiplier: number;
  topSpeedMultiplier: number;
  lateralFrictionMultiplier: number;
  label: string;
}

export const SURFACE_CONFIG: Record<SurfaceType, SurfaceTuning> = {
  [SurfaceType.ASPHALT]: {
    gripMultiplier: 1.0,
    topSpeedMultiplier: 1.0,
    lateralFrictionMultiplier: 1.0,
    label: 'ASPHALT (100% GRIP)',
  },
  [SurfaceType.GRASS]: {
    gripMultiplier: 0.65,
    topSpeedMultiplier: 0.70, // Limits top speed to ~70%
    lateralFrictionMultiplier: 0.65,
    label: 'GRASS (65% GRIP / 70% SPD)',
  },
  [SurfaceType.DIRT]: {
    gripMultiplier: 0.60,
    topSpeedMultiplier: 0.70, // Limits top speed to ~70%
    lateralFrictionMultiplier: 0.60,
    label: 'DIRT (60% GRIP / 70% SPD)',
  },
};
