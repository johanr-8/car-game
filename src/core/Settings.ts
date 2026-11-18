/**
 * src/core/Settings.ts
 * ─────────────────────────────────────────────────────────────
 * Persistent Game Settings & Local Leaderboard Module.
 * Backed by localStorage with schema versioning and try/catch fallback.
 *
 * Persists:
 *   - Volume sliders (master, engine, effects, ui: 0..1)
 *   - Graphics quality ('low' | 'medium' | 'high')
 *   - Camera comfort toggle (disables camera shake & FOV kick)
 *   - Key bindings with duplicate protection
 *   - Local leaderboard (Top 10 total times per daily seed)
 *   - Personal best total time
 *
 * Does NOT persist ghost telemetry data.
 * ─────────────────────────────────────────────────────────────
 */

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface KeyBindings {
  throttle: string;
  brake: string;
  steerLeft: string;
  steerRight: string;
  drift: string;
  boost: string;
  restart: string;
  remix: string;
}

export interface VolumeSettings {
  master: number;
  engine: number;
  effects: number;
  ui: number;
}

export interface LeaderboardEntry {
  time: number;        // total race time in seconds
  lapTimes: number[];  // individual lap times in seconds
  date: string;        // readable date
}

export interface SettingsData {
  version: number;
  volumes: VolumeSettings;
  graphicsQuality: GraphicsQuality;
  cameraComfort: boolean;
  keyBindings: KeyBindings;
  bestTotalTime: number | null;
  leaderboardBySeed: Record<string, LeaderboardEntry[]>;
}

export const SETTINGS_STORAGE_KEY = 'warp_drift_game_settings';
export const SETTINGS_VERSION = 1;

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = {
  throttle:   'KeyW',
  brake:      'KeyS',
  steerLeft:  'KeyA',
  steerRight: 'KeyD',
  drift:      'Space',
  boost:      'ShiftLeft',
  restart:    'KeyR',
  remix:      'KeyM',
};

export const DEFAULT_SETTINGS: Readonly<SettingsData> = {
  version: SETTINGS_VERSION,
  volumes: {
    master:  0.8,
    engine:  0.7,
    effects: 0.8,
    ui:      0.7,
  },
  graphicsQuality: 'high',
  cameraComfort:   false,
  keyBindings:     { ...DEFAULT_KEY_BINDINGS },
  bestTotalTime:   null,
  leaderboardBySeed: {},
};

export class SettingsManager {
  data: SettingsData = this.cloneDefaults();

  private readonly changeListeners: Array<(data: SettingsData) => void> = [];

  constructor() {
    this.load();
  }

  private cloneDefaults(): SettingsData {
    return {
      version: SETTINGS_VERSION,
      volumes: { ...DEFAULT_SETTINGS.volumes },
      graphicsQuality: DEFAULT_SETTINGS.graphicsQuality,
      cameraComfort: DEFAULT_SETTINGS.cameraComfort,
      keyBindings: { ...DEFAULT_SETTINGS.keyBindings },
      bestTotalTime: DEFAULT_SETTINGS.bestTotalTime,
      leaderboardBySeed: {},
    };
  }

  load(): SettingsData {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) {
        this.data = this.cloneDefaults();
        return this.data;
      }

      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        this.data = this.cloneDefaults();
        return this.data;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SETTINGS_VERSION) {
        // Version mismatch or corrupt object -> safe fallback to defaults
        this.data = this.cloneDefaults();
        this.save();
        return this.data;
      }

      // Merge safely into defaults
      this.data = {
        version: SETTINGS_VERSION,
        volumes: {
          master:  typeof parsed.volumes?.master  === 'number' ? Math.max(0, Math.min(1, parsed.volumes.master))  : DEFAULT_SETTINGS.volumes.master,
          engine:  typeof parsed.volumes?.engine  === 'number' ? Math.max(0, Math.min(1, parsed.volumes.engine))  : DEFAULT_SETTINGS.volumes.engine,
          effects: typeof parsed.volumes?.effects === 'number' ? Math.max(0, Math.min(1, parsed.volumes.effects)) : DEFAULT_SETTINGS.volumes.effects,
          ui:      typeof parsed.volumes?.ui      === 'number' ? Math.max(0, Math.min(1, parsed.volumes.ui))      : DEFAULT_SETTINGS.volumes.ui,
        },
        graphicsQuality: ['low', 'medium', 'high'].includes(parsed.graphicsQuality) ? parsed.graphicsQuality : DEFAULT_SETTINGS.graphicsQuality,
        cameraComfort: Boolean(parsed.cameraComfort),
        keyBindings: {
          throttle:   typeof parsed.keyBindings?.throttle   === 'string' ? parsed.keyBindings.throttle   : DEFAULT_KEY_BINDINGS.throttle,
          brake:      typeof parsed.keyBindings?.brake      === 'string' ? parsed.keyBindings.brake      : DEFAULT_KEY_BINDINGS.brake,
          steerLeft:  typeof parsed.keyBindings?.steerLeft  === 'string' ? parsed.keyBindings.steerLeft  : DEFAULT_KEY_BINDINGS.steerLeft,
          steerRight: typeof parsed.keyBindings?.steerRight === 'string' ? parsed.keyBindings.steerRight : DEFAULT_KEY_BINDINGS.steerRight,
          drift:      typeof parsed.keyBindings?.drift      === 'string' ? parsed.keyBindings.drift      : DEFAULT_KEY_BINDINGS.drift,
          boost:      typeof parsed.keyBindings?.boost      === 'string' ? parsed.keyBindings.boost      : DEFAULT_KEY_BINDINGS.boost,
          restart:    typeof parsed.keyBindings?.restart    === 'string' ? parsed.keyBindings.restart    : DEFAULT_KEY_BINDINGS.restart,
          remix:      typeof parsed.keyBindings?.remix      === 'string' ? parsed.keyBindings.remix      : DEFAULT_KEY_BINDINGS.remix,
        },
        bestTotalTime: typeof parsed.bestTotalTime === 'number' ? parsed.bestTotalTime : null,
        leaderboardBySeed: typeof parsed.leaderboardBySeed === 'object' && parsed.leaderboardBySeed !== null ? parsed.leaderboardBySeed : {},
      };
    } catch {
      // JSON syntax error or storage failure -> fallback to defaults
      this.data = this.cloneDefaults();
    }

    return this.data;
  }

  save(): boolean {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.data));
      }
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  resetDefaults(): void {
    const keptLeaderboard = { ...this.data.leaderboardBySeed };
    const keptBest = this.data.bestTotalTime;
    this.data = this.cloneDefaults();
    this.data.leaderboardBySeed = keptLeaderboard;
    this.data.bestTotalTime = keptBest;
    this.save();
  }

  // ── Volume Getters & Setters ──

  getVolume(bus: keyof VolumeSettings): number {
    return this.data.volumes[bus] ?? 0.8;
  }

  setVolume(bus: keyof VolumeSettings, value: number): void {
    this.data.volumes[bus] = Math.max(0, Math.min(1, value));
    this.save();
  }

  // ── Graphics Quality & Camera Comfort ──

  setGraphicsQuality(quality: GraphicsQuality): void {
    this.data.graphicsQuality = quality;
    this.save();
  }

  setCameraComfort(comfort: boolean): void {
    this.data.cameraComfort = comfort;
    this.save();
  }

  // ── Key Rebinding with Duplicate Protection ──

  rebindKey(action: keyof KeyBindings, newCode: string): { success: boolean; error?: string } {
    if (!newCode || typeof newCode !== 'string') {
      return { success: false, error: 'Invalid key code' };
    }

    // Check duplicate key
    const currentBindings = this.data.keyBindings;
    for (const [otherAction, code] of Object.entries(currentBindings)) {
      if (otherAction !== action && code === newCode) {
        const readableAction = otherAction.replace(/([A-Z])/g, ' $1').toLowerCase();
        return {
          success: false,
          error: `Key '${newCode}' is already bound to ${readableAction}`,
        };
      }
    }

    this.data.keyBindings[action] = newCode;
    this.save();
    return { success: true };
  }

  resetKeyBindings(): void {
    this.data.keyBindings = { ...DEFAULT_KEY_BINDINGS };
    this.save();
  }

  // ── Local Leaderboard (Top 10 Sorted per Seed) ──

  getLeaderboard(seed: number | string): LeaderboardEntry[] {
    const key = String(seed);
    return this.data.leaderboardBySeed[key] || [];
  }

  recordRaceResult(
    seed: number | string,
    totalTime: number,
    lapTimes: number[]
  ): { isNewOverallBest: boolean; isNewSeedBest: boolean; rank: number } {
    const key = String(seed);
    const list = [...(this.data.leaderboardBySeed[key] || [])];

    // Check if new seed best (top rank)
    const prevBestForSeed = list.length > 0 ? list[0].time : Infinity;
    const isNewSeedBest = totalTime < prevBestForSeed;

    // Check overall best
    const isNewOverallBest = this.data.bestTotalTime === null || totalTime < this.data.bestTotalTime;
    if (isNewOverallBest) {
      this.data.bestTotalTime = totalTime;
    }

    // Insert new entry
    const newEntry: LeaderboardEntry = {
      time: totalTime,
      lapTimes: [...lapTimes],
      date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    };

    list.push(newEntry);
    // Sort ascending (fastest time first)
    list.sort((a, b) => a.time - b.time);
    // Keep only top 10
    const trimmed = list.slice(0, 10);
    this.data.leaderboardBySeed[key] = trimmed;

    this.save();

    const rank = trimmed.findIndex(entry => entry === newEntry) + 1;
    return { isNewOverallBest, isNewSeedBest, rank: rank > 0 ? rank : 11 };
  }

  // ── Subscriptions ──

  onChange(listener: (data: SettingsData) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const idx = this.changeListeners.indexOf(listener);
      if (idx !== -1) this.changeListeners.splice(idx, 1);
    };
  }

  private notify(): void {
    for (let i = 0; i < this.changeListeners.length; i++) {
      this.changeListeners[i](this.data);
    }
  }
}

export const settings = new SettingsManager();
