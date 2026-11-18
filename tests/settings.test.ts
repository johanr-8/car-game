import { describe, it, expect, beforeEach } from 'vitest';
import {
  SettingsManager,
  SETTINGS_STORAGE_KEY,
  DEFAULT_SETTINGS,
  DEFAULT_KEY_BINDINGS,
} from '../src/core/Settings';

describe('Game Settings & Leaderboard Module (SettingsManager)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('performs clean settings round-trip (save -> load)', () => {
    const mgr1 = new SettingsManager();

    // Mutate various fields
    mgr1.setVolume('master', 0.45);
    mgr1.setVolume('engine', 0.90);
    mgr1.setGraphicsQuality('low');
    mgr1.setCameraComfort(true);

    const rebindRes = mgr1.rebindKey('throttle', 'KeyI');
    expect(rebindRes.success).toBe(true);

    // Save
    mgr1.save();

    // Verify localStorage has payload
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();

    // Instantiate fresh manager to test deserialization
    const mgr2 = new SettingsManager();
    expect(mgr2.getVolume('master')).toBeCloseTo(0.45, 2);
    expect(mgr2.getVolume('engine')).toBeCloseTo(0.90, 2);
    expect(mgr2.data.graphicsQuality).toBe('low');
    expect(mgr2.data.cameraComfort).toBe(true);
    expect(mgr2.data.keyBindings.throttle).toBe('KeyI');
  });

  it('corrupt or invalid save data safely falls back to defaults without throwing', () => {
    // 1. Corrupt JSON syntax
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{ broken_json: [ unclosed string');
    const mgrCorrupt = new SettingsManager();
    expect(mgrCorrupt.data.version).toBe(DEFAULT_SETTINGS.version);
    expect(mgrCorrupt.getVolume('master')).toBe(DEFAULT_SETTINGS.volumes.master);
    expect(mgrCorrupt.data.graphicsQuality).toBe(DEFAULT_SETTINGS.graphicsQuality);
    expect(mgrCorrupt.data.keyBindings.throttle).toBe(DEFAULT_KEY_BINDINGS.throttle);

    // 2. Incompatible schema version
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 999, volumes: { master: 0.1 } }));
    const mgrWrongVer = new SettingsManager();
    expect(mgrWrongVer.data.version).toBe(DEFAULT_SETTINGS.version);
    expect(mgrWrongVer.getVolume('master')).toBe(DEFAULT_SETTINGS.volumes.master);
  });

  it('leaderboard keeps only the top 10 times sorted ascending per seed', () => {
    const mgr = new SettingsManager();
    const testSeed = 849201;

    // Record 14 different race total times
    const times = [55.2, 42.1, 60.5, 38.4, 49.0, 35.8, 70.2, 41.3, 44.7, 50.1, 39.9, 46.2, 48.3, 40.0];

    times.forEach(t => {
      mgr.recordRaceResult(testSeed, t, [t / 3, t / 3, t / 3]);
    });

    const lb = mgr.getLeaderboard(testSeed);

    // Must keep exactly top 10
    expect(lb.length).toBe(10);

    // Must be strictly sorted ascending (lowest total time first)
    for (let i = 0; i < lb.length - 1; i++) {
      expect(lb[i].time).toBeLessThanOrEqual(lb[i + 1].time);
    }

    // Best time must be 35.8
    expect(lb[0].time).toBe(35.8);
    // 10th time must be the 10th lowest from the original 14 times
    const sortedTimes = [...times].sort((a, b) => a - b);
    expect(lb[9].time).toBe(sortedTimes[9]);

    // Independent seeds do not leak
    expect(mgr.getLeaderboard(999999).length).toBe(0);
  });

  it('key rebinding rejects duplicate keys and accepts valid unique keys', () => {
    const mgr = new SettingsManager();

    // Default: throttle is 'KeyW', brake is 'KeyS'
    expect(mgr.data.keyBindings.throttle).toBe('KeyW');
    expect(mgr.data.keyBindings.brake).toBe('KeyS');

    // Attempt to rebind throttle to 'KeyS' (already used by brake)
    const dupRes = mgr.rebindKey('throttle', 'KeyS');
    expect(dupRes.success).toBe(false);
    expect(dupRes.error).toContain('already bound');
    // Key MUST NOT have changed
    expect(mgr.data.keyBindings.throttle).toBe('KeyW');

    // Rebind to unused key 'KeyE'
    const validRes = mgr.rebindKey('throttle', 'KeyE');
    expect(validRes.success).toBe(true);
    expect(mgr.data.keyBindings.throttle).toBe('KeyE');

    // Resetting restores default KeyW
    mgr.resetKeyBindings();
    expect(mgr.data.keyBindings.throttle).toBe('KeyW');
  });
});
