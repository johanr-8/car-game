/**
 * src/audio/AudioSettings.ts
 * ─────────────────────────────────────────────────────────────
 * Audio bus volume settings and localStorage persistence.
 * ─────────────────────────────────────────────────────────────
 */

export type AudioBus = 'master' | 'engine' | 'effects' | 'ui';

export interface AudioSettingsData {
  master: number;
  engine: number;
  effects: number;
  ui: number;
  muted: boolean;
}

const STORAGE_KEY = 'warp_drift_audio_settings';

const DEFAULT_SETTINGS: AudioSettingsData = {
  master:  0.80,
  engine:  0.70,
  effects: 0.75,
  ui:      0.80,
  muted:   false,
};

export class AudioSettings {
  private data: AudioSettingsData = { ...DEFAULT_SETTINGS };
  private onChangeCallbacks: Array<(data: AudioSettingsData) => void> = [];

  constructor() {
    this.load();
  }

  get master(): number  { return this.data.master; }
  get engine(): number  { return this.data.engine; }
  get effects(): number { return this.data.effects; }
  get ui(): number      { return this.data.ui; }
  get muted(): boolean  { return this.data.muted; }

  getBusVolume(bus: AudioBus): number {
    if (this.data.muted) return 0;
    return Math.max(0, Math.min(1, this.data[bus] * this.data.master));
  }

  setVolume(bus: AudioBus, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.data[bus] = clamped;
    this.save();
    this.notify();
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted;
    this.save();
    this.notify();
  }

  toggleMute(): boolean {
    this.setMuted(!this.data.muted);
    return this.data.muted;
  }

  onChange(cb: (data: AudioSettingsData) => void): void {
    this.onChangeCallbacks.push(cb);
  }

  private notify(): void {
    for (let i = 0; i < this.onChangeCallbacks.length; i++) {
      this.onChangeCallbacks[i](this.data);
    }
  }

  private load(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.master === 'number')  this.data.master = parsed.master;
          if (typeof parsed.engine === 'number')  this.data.engine = parsed.engine;
          if (typeof parsed.effects === 'number') this.data.effects = parsed.effects;
          if (typeof parsed.ui === 'number')      this.data.ui = parsed.ui;
          if (typeof parsed.muted === 'boolean')   this.data.muted = parsed.muted;
        }
      }
    } catch {
      // Fallback to defaults if localStorage is disabled or throws
      this.data = { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      }
    } catch {
      // Storage unavailable or full
    }
  }
}
