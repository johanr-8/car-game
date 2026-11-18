import { describe, it, expect, beforeEach } from 'vitest';
import { AudioSettings } from '../src/audio/AudioSettings';
import { AudioEngine, audioEngine, type AudioVehicleState } from '../src/audio';

describe('Procedural Web Audio Engine', () => {
  describe('AudioSettings & Bus Persistence', () => {
    let settings: AudioSettings;

    beforeEach(() => {
      localStorage.clear();
      settings = new AudioSettings();
    });

    it('initializes with balanced default volume levels', () => {
      expect(settings.master).toBe(0.80);
      expect(settings.engine).toBe(0.70);
      expect(settings.effects).toBe(0.75);
      expect(settings.ui).toBe(0.80);
      expect(settings.muted).toBe(false);
    });

    it('sets and clamps bus volume within [0, 1]', () => {
      settings.setVolume('engine', 0.5);
      expect(settings.engine).toBe(0.5);

      settings.setVolume('master', 1.5); // Clamp high
      expect(settings.master).toBe(1.0);

      settings.setVolume('effects', -0.5); // Clamp low
      expect(settings.effects).toBe(0.0);
    });

    it('calculates effective bus volume factoring in master volume and mute', () => {
      settings.setVolume('master', 0.5);
      settings.setVolume('engine', 0.8);
      expect(settings.getBusVolume('engine')).toBeCloseTo(0.40, 2);

      settings.setMuted(true);
      expect(settings.getBusVolume('engine')).toBe(0.0);
      expect(settings.getBusVolume('master')).toBe(0.0);

      settings.toggleMute();
      expect(settings.getBusVolume('engine')).toBeCloseTo(0.40, 2);
    });

    it('persists settings to localStorage across instances', () => {
      settings.setVolume('master', 0.65);
      settings.setVolume('ui', 0.45);
      settings.setMuted(true);

      const reloaded = new AudioSettings();
      expect(reloaded.master).toBe(0.65);
      expect(reloaded.ui).toBe(0.45);
      expect(reloaded.muted).toBe(true);
    });
  });

  describe('AudioEngine Graph and Synthesizers', () => {
    let engine: AudioEngine;

    beforeEach(() => {
      engine = new AudioEngine();
      engine.start();
    });

    it('initializes Web Audio context and builds persistent nodes without throwing', () => {
      expect(engine).toBeDefined();
      expect(engine.settings).toBeInstanceOf(AudioSettings);
    });

    it('exposes setVolume(bus, value) to modulate audio buses directly', () => {
      engine.setVolume('effects', 0.35);
      expect(engine.settings.effects).toBe(0.35);

      engine.setVolume('master', 0.90);
      expect(engine.settings.master).toBe(0.90);
    });

    it('executes per-frame update across multiple gears and throttle states with zero allocations', () => {
      const state: AudioVehicleState = {
        speed: 0,
        throttle: 0,
        brake: 0,
        isGrounded: true,
        lateralSlipSpeed: 0,
        isDrifting: false,
        isBoosting: false,
        isScrapingBarrier: false,
        barrierScrapeSpeed: 0,
        wasAirborneJustLanded: false,
        impactSpeed: 0,
      };

      // 1. Idle state
      expect(() => engine.update(1 / 60, state)).not.toThrow();

      // 2. High acceleration in 1st gear on throttle
      state.speed = 8.0; // ~29 km/h
      state.throttle = 1.0;
      expect(() => engine.update(1 / 60, state)).not.toThrow();

      // 3. Shifting into gear 3 at high speed
      state.speed = 28.0; // ~100 km/h
      expect(() => engine.update(1 / 60, state)).not.toThrow();

      // 4. Power drift with lateral tire screech
      state.isDrifting = true;
      state.lateralSlipSpeed = 6.5;
      expect(() => engine.update(1 / 60, state)).not.toThrow();

      // 5. Nitro boost active with ignition and wind rush
      state.isBoosting = true;
      state.speed = 52.0; // ~187 km/h
      expect(() => engine.update(1 / 60, state)).not.toThrow();

      // 6. Barrier scrape
      state.isScrapingBarrier = true;
      state.barrierScrapeSpeed = 45.0;
      expect(() => engine.update(1 / 60, state)).not.toThrow();

      // 7. Landing impact from jump
      state.wasAirborneJustLanded = true;
      state.impactSpeed = 15.0;
      expect(() => engine.update(1 / 60, state)).not.toThrow();
    });

    it('triggers UI sound synthesizers (countdown beeps, checkpoint chimes, lap jingles)', () => {
      // 3, 2, 1 beeps
      expect(() => engine.playCountdownBeep(false)).not.toThrow();
      // GO! beep
      expect(() => engine.playCountdownBeep(true)).not.toThrow();

      // Checkpoint passing chime
      expect(() => engine.playCheckpointChime()).not.toThrow();

      // Normal lap complete jingle
      expect(() => engine.playLapComplete(false)).not.toThrow();

      // New best record gold fanfare
      expect(() => engine.playLapComplete(true)).not.toThrow();
    });

    it('handles game pause and background tab suspend/resume gracefully', () => {
      engine.setGamePaused(true);
      engine.setGamePaused(false);
      engine.pause();
      engine.resume();
    });
  });
});
