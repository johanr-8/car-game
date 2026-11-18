/**
 * src/audio/AudioEngine.ts
 * ─────────────────────────────────────────────────────────────
 * Procedural Web Audio Engine for Warp City: Velocity Drift.
 *
 * Synthesizers:
 *   - 3-Oscillator + Filtered Noise Engine with 5 Gears & Throttle Dynamics
 *   - Lateral Slip Tire Screech (Band-pass modulated noise)
 *   - Nitro Boost Jet Whoosh + Sub Rumble + Ignition Thump
 *   - Speed-scaled Wind Rush
 *   - Metallic Barrier Scrape
 *   - Clean Landing & Collision Impacts
 *   - UI Countdown Beeps, Checkpoint Chimes & Victory Fanfares
 *
 * RULES.md: Zero per-frame allocations. All audio nodes are persistent / pooled.
 * ─────────────────────────────────────────────────────────────
 */
import { AudioSettings, type AudioBus } from './AudioSettings';

export interface AudioVehicleState {
  speed: number;               // Current vehicle speed (m/s)
  throttle: number;            // 0..1 throttle input
  brake: number;               // 0..1 brake input
  isGrounded: boolean;         // Surface contact status
  lateralSlipSpeed: number;    // Lateral drift velocity magnitude (m/s)
  isDrifting: boolean;         // Power drift active
  isBoosting: boolean;         // Nitro boost active
  isScrapingBarrier: boolean;  // Scraping lateral barrier
  barrierScrapeSpeed: number;  // Tangential velocity against barrier
  wasAirborneJustLanded: boolean; // Just touched down from jump
  impactSpeed: number;         // Barrier / obstacle impact velocity
}

export class AudioEngine {
  readonly settings = new AudioSettings();

  private ctx: AudioContext | null = null;
  private isStarted = false;
  private isGamePaused = false;

  // Master & Bus Gain Nodes
  private masterGain!: GainNode;
  private engineBus!: GainNode;
  private effectsBus!: GainNode;
  private uiBus!: GainNode;

  // Noise Buffer
  private noiseBuffer!: AudioBuffer;

  // ── Engine Voice (3 Detuned Oscillators + Filter + Mechanical Noise) ──
  private engineOsc1!: OscillatorNode; // Sawtooth fundamental
  private engineOsc2!: OscillatorNode; // Sawtooth +7 cents detuned
  private engineOsc3!: OscillatorNode; // Triangle sub-octave
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private engineNoiseSource!: AudioBufferSourceNode;
  private engineNoiseFilter!: BiquadFilterNode;
  private engineNoiseGain!: GainNode;

  private currentGear = 1;
  private gearShiftDipTimer = 0;

  // ── Tire Screech Voice ──
  private screechSource!: AudioBufferSourceNode;
  private screechFilter!: BiquadFilterNode;
  private screechGain!: GainNode;

  // ── Nitro Boost Voice ──
  private nitroSource!: AudioBufferSourceNode;
  private nitroFilter!: BiquadFilterNode;
  private nitroGain!: GainNode;
  private nitroRumbleOsc!: OscillatorNode;
  private nitroRumbleGain!: GainNode;
  private ignitionOsc!: OscillatorNode;
  private ignitionGain!: GainNode;
  private wasBoosting = false;

  // ── Wind Rush Voice ──
  private windSource!: AudioBufferSourceNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;

  // ── Barrier Scrape Voice ──
  private scrapeSource!: AudioBufferSourceNode;
  private scrapeFilter!: BiquadFilterNode;
  private scrapeGain!: GainNode;

  // ── Impacts & Landings ──
  private landingOsc!: OscillatorNode;
  private landingGain!: GainNode;
  private impactOsc!: OscillatorNode;
  private impactFilter!: BiquadFilterNode;
  private impactGain!: GainNode;
  private impactNoiseSource!: AudioBufferSourceNode;
  private impactNoiseGain!: GainNode;

  // ── UI Synthesizer Voices ──
  private uiBeepOsc!: OscillatorNode;
  private uiBeepGain!: GainNode;
  private uiChimeOsc1!: OscillatorNode;
  private uiChimeGain1!: GainNode;
  private uiChimeOsc2!: OscillatorNode;
  private uiChimeGain2!: GainNode;

  // Jingle Oscillators (for 3-tone chords)
  private uiJingleOsc1!: OscillatorNode;
  private uiJingleOsc2!: OscillatorNode;
  private uiJingleOsc3!: OscillatorNode;
  private uiJingleGain!: GainNode;

  constructor() {
    this.settings.onChange(() => this.applyBusVolumes());

    // Hook auto-start on first user interaction
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.start();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });

      // Tab visibility pause / resume
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            this.pause();
          } else if (!this.isGamePaused) {
            this.resume();
          }
        });
      }
    }
  }

  /**
   * Initializes Web Audio Context on first user interaction.
   */
  start(): void {
    if (this.isStarted) {
      if (this.ctx && this.ctx.state === 'suspended' && !this.isGamePaused) {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.buildAudioGraph();
      this.isStarted = true;
      this.applyBusVolumes();
    } catch {
      // AudioContext unavailable in headless / restricted environments
    }
  }

  /**
   * Constructs all persistent audio nodes and loops.
   * Zero node allocations occur after this point.
   */
  private buildAudioGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Master & Bus Structure
    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);

    this.engineBus = ctx.createGain();
    this.engineBus.connect(this.masterGain);

    this.effectsBus = ctx.createGain();
    this.effectsBus.connect(this.masterGain);

    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.masterGain);

    // 2. Procedural White Noise Buffer (2.0s looped)
    const sampleRate = ctx.sampleRate || 44100;
    this.noiseBuffer = ctx.createBuffer(1, sampleRate * 2, sampleRate);
    const noiseData = this.noiseBuffer.getChannelData(0);
    let seed = 0x12345678;
    for (let i = 0; i < noiseData.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noiseData[i] = ((seed / 0xffffffff) * 2 - 1) * 0.45;
    }

    // 3. Engine Synthesizer Voice
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(55, now);

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.setValueAtTime(55, now);
    this.engineOsc2.detune.setValueAtTime(7, now); // +7 cents chorus

    this.engineOsc3 = ctx.createOscillator();
    this.engineOsc3.type = 'triangle';
    this.engineOsc3.frequency.setValueAtTime(27.5, now); // Sub-octave

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(1200, now);
    this.engineFilter.Q.setValueAtTime(2.2, now);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.setValueAtTime(0, now);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineOsc3.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.engineBus);

    // Engine mechanical noise branch
    this.engineNoiseSource = ctx.createBufferSource();
    this.engineNoiseSource.buffer = this.noiseBuffer;
    this.engineNoiseSource.loop = true;

    this.engineNoiseFilter = ctx.createBiquadFilter();
    this.engineNoiseFilter.type = 'bandpass';
    this.engineNoiseFilter.frequency.setValueAtTime(280, now);
    this.engineNoiseFilter.Q.setValueAtTime(1.8, now);

    this.engineNoiseGain = ctx.createGain();
    this.engineNoiseGain.gain.setValueAtTime(0, now);

    this.engineNoiseSource.connect(this.engineNoiseFilter);
    this.engineNoiseFilter.connect(this.engineNoiseGain);
    this.engineNoiseGain.connect(this.engineBus);

    this.engineOsc1.start(now);
    this.engineOsc2.start(now);
    this.engineOsc3.start(now);
    this.engineNoiseSource.start(now);

    // 4. Tire Screech Voice
    this.screechSource = ctx.createBufferSource();
    this.screechSource.buffer = this.noiseBuffer;
    this.screechSource.loop = true;

    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.setValueAtTime(1200, now);
    this.screechFilter.Q.setValueAtTime(3.8, now);

    this.screechGain = ctx.createGain();
    this.screechGain.gain.setValueAtTime(0, now);

    this.screechSource.connect(this.screechFilter);
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.effectsBus);
    this.screechSource.start(now);

    // 5. Nitro Boost Voice
    this.nitroSource = ctx.createBufferSource();
    this.nitroSource.buffer = this.noiseBuffer;
    this.nitroSource.loop = true;

    this.nitroFilter = ctx.createBiquadFilter();
    this.nitroFilter.type = 'bandpass';
    this.nitroFilter.frequency.setValueAtTime(800, now);
    this.nitroFilter.Q.setValueAtTime(3.5, now);

    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.setValueAtTime(0, now);

    this.nitroSource.connect(this.nitroFilter);
    this.nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.effectsBus);
    this.nitroSource.start(now);

    // Nitro low rumble
    this.nitroRumbleOsc = ctx.createOscillator();
    this.nitroRumbleOsc.type = 'sine';
    this.nitroRumbleOsc.frequency.setValueAtTime(54, now);

    this.nitroRumbleGain = ctx.createGain();
    this.nitroRumbleGain.gain.setValueAtTime(0, now);

    this.nitroRumbleOsc.connect(this.nitroRumbleGain);
    this.nitroRumbleGain.connect(this.effectsBus);
    this.nitroRumbleOsc.start(now);

    // Ignition thump
    this.ignitionOsc = ctx.createOscillator();
    this.ignitionOsc.type = 'sine';
    this.ignitionOsc.frequency.setValueAtTime(180, now);

    this.ignitionGain = ctx.createGain();
    this.ignitionGain.gain.setValueAtTime(0, now);

    this.ignitionOsc.connect(this.ignitionGain);
    this.ignitionGain.connect(this.effectsBus);
    this.ignitionOsc.start(now);

    // 6. Wind Rush Voice
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setValueAtTime(400, now);
    this.windFilter.Q.setValueAtTime(0.7, now);

    this.windGain = ctx.createGain();
    this.windGain.gain.setValueAtTime(0, now);

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.effectsBus);
    this.windSource.start(now);

    // 7. Barrier Scrape Voice
    this.scrapeSource = ctx.createBufferSource();
    this.scrapeSource.buffer = this.noiseBuffer;
    this.scrapeSource.loop = true;

    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'highpass';
    this.scrapeFilter.frequency.setValueAtTime(2800, now);
    this.scrapeFilter.Q.setValueAtTime(5.5, now);

    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.setValueAtTime(0, now);

    this.scrapeSource.connect(this.scrapeFilter);
    this.scrapeFilter.connect(this.scrapeGain);
    this.scrapeGain.connect(this.effectsBus);
    this.scrapeSource.start(now);

    // 8. Clean Landing & Barrier Collision Hits
    this.landingOsc = ctx.createOscillator();
    this.landingOsc.type = 'sine';
    this.landingOsc.frequency.setValueAtTime(110, now);

    this.landingGain = ctx.createGain();
    this.landingGain.gain.setValueAtTime(0, now);

    this.landingOsc.connect(this.landingGain);
    this.landingGain.connect(this.effectsBus);
    this.landingOsc.start(now);

    this.impactOsc = ctx.createOscillator();
    this.impactOsc.type = 'sine';
    this.impactOsc.frequency.setValueAtTime(80, now);

    this.impactGain = ctx.createGain();
    this.impactGain.gain.setValueAtTime(0, now);

    this.impactOsc.connect(this.impactGain);
    this.impactGain.connect(this.effectsBus);
    this.impactOsc.start(now);

    this.impactNoiseSource = ctx.createBufferSource();
    this.impactNoiseSource.buffer = this.noiseBuffer;
    this.impactNoiseSource.loop = true;

    this.impactFilter = ctx.createBiquadFilter();
    this.impactFilter.type = 'bandpass';
    this.impactFilter.frequency.setValueAtTime(1600, now);
    this.impactFilter.Q.setValueAtTime(2.0, now);

    this.impactNoiseGain = ctx.createGain();
    this.impactNoiseGain.gain.setValueAtTime(0, now);

    this.impactNoiseSource.connect(this.impactFilter);
    this.impactFilter.connect(this.impactNoiseGain);
    this.impactNoiseGain.connect(this.effectsBus);
    this.impactNoiseSource.start(now);

    // 9. UI Synthesizer Voices
    this.uiBeepOsc = ctx.createOscillator();
    this.uiBeepOsc.type = 'triangle';
    this.uiBeepOsc.frequency.setValueAtTime(440, now);

    this.uiBeepGain = ctx.createGain();
    this.uiBeepGain.gain.setValueAtTime(0, now);

    this.uiBeepOsc.connect(this.uiBeepGain);
    this.uiBeepGain.connect(this.uiBus);
    this.uiBeepOsc.start(now);

    this.uiChimeOsc1 = ctx.createOscillator();
    this.uiChimeOsc1.type = 'sine';
    this.uiChimeOsc1.frequency.setValueAtTime(784, now);

    this.uiChimeGain1 = ctx.createGain();
    this.uiChimeGain1.gain.setValueAtTime(0, now);

    this.uiChimeOsc1.connect(this.uiChimeGain1);
    this.uiChimeGain1.connect(this.uiBus);
    this.uiChimeOsc1.start(now);

    this.uiChimeOsc2 = ctx.createOscillator();
    this.uiChimeOsc2.type = 'sine';
    this.uiChimeOsc2.frequency.setValueAtTime(1046.5, now);

    this.uiChimeGain2 = ctx.createGain();
    this.uiChimeGain2.gain.setValueAtTime(0, now);

    this.uiChimeOsc2.connect(this.uiChimeGain2);
    this.uiChimeGain2.connect(this.uiBus);
    this.uiChimeOsc2.start(now);

    // Jingle Polyphonic Voices
    this.uiJingleOsc1 = ctx.createOscillator();
    this.uiJingleOsc1.type = 'sine';
    this.uiJingleOsc2 = ctx.createOscillator();
    this.uiJingleOsc2.type = 'sine';
    this.uiJingleOsc3 = ctx.createOscillator();
    this.uiJingleOsc3.type = 'triangle';

    this.uiJingleGain = ctx.createGain();
    this.uiJingleGain.gain.setValueAtTime(0, now);

    this.uiJingleOsc1.connect(this.uiJingleGain);
    this.uiJingleOsc2.connect(this.uiJingleGain);
    this.uiJingleOsc3.connect(this.uiJingleGain);
    this.uiJingleGain.connect(this.uiBus);

    this.uiJingleOsc1.start(now);
    this.uiJingleOsc2.start(now);
    this.uiJingleOsc3.start(now);
  }

  /**
   * Applies master and individual bus volume levels.
   */
  applyBusVolumes(): void {
    if (!this.ctx || !this.isStarted) return;
    const now = this.ctx.currentTime;
    const master = this.settings.muted ? 0 : this.settings.master;

    this.masterGain.gain.setTargetAtTime(master, now, 0.05);
    this.engineBus.gain.setTargetAtTime(this.settings.engine, now, 0.05);
    this.effectsBus.gain.setTargetAtTime(this.settings.effects, now, 0.05);
    this.uiBus.gain.setTargetAtTime(this.settings.ui, now, 0.05);
  }

  /**
   * Sets bus volume (0..1) directly.
   */
  setVolume(bus: AudioBus, value: number): void {
    this.settings.setVolume(bus, value);
  }

  /**
   * Pauses audio context (used during game pause or background tab).
   */
  pause(): void {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  /**
   * Resumes audio context.
   */
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && !this.isGamePaused) {
      this.ctx.resume().catch(() => {});
    }
  }

  setGamePaused(paused: boolean): void {
    this.isGamePaused = paused;
    if (paused) {
      this.pause();
    } else {
      this.resume();
    }
  }

  /**
   * Per-frame audio update.
   * RULES.md: Zero allocations. Updates persistent audio params only.
   */
  update(dt: number, state: AudioVehicleState): void {
    if (!this.ctx || !this.isStarted || this.isGamePaused) return;

    const now = this.ctx.currentTime;
    const absSpeed = Math.abs(state.speed);

    // ── 1. Gear Selection & Shift Dip ──
    let gear = 1;
    let gearMin = 0;
    let gearMax = 11;

    if (absSpeed < 11) {
      gear = 1; gearMin = 0; gearMax = 11;
    } else if (absSpeed < 21) {
      gear = 2; gearMin = 9; gearMax = 21;
    } else if (absSpeed < 33) {
      gear = 3; gearMin = 19; gearMax = 33;
    } else if (absSpeed < 44) {
      gear = 4; gearMin = 30; gearMax = 44;
    } else {
      gear = 5; gearMin = 41; gearMax = 58;
    }

    if (gear !== this.currentGear) {
      this.currentGear = gear;
      this.gearShiftDipTimer = 0.14; // Gear shift RPM dip duration
    }

    if (this.gearShiftDipTimer > 0) {
      this.gearShiftDipTimer -= dt;
    }

    // ── 2. Engine Synthesizer Modulation ──
    const gearSpan = gearMax - gearMin;
    const gearRatio = Math.max(0, Math.min(1, (absSpeed - gearMin) / gearSpan));
    const shiftDipFactor = this.gearShiftDipTimer > 0 ? 0.35 : 0.0;

    // RPM frequency curve
    const baseFreq = 54 + (1.0 - shiftDipFactor) * (36 + gearRatio * 180);
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc3.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.03);

    // Throttle on/off character: brighter and louder on throttle, bassy burble on lift-off
    const isOnThrottle = state.throttle > 0.05;
    const filterCutoff = isOnThrottle
      ? 1600 + gearRatio * 2400
      : 700 + gearRatio * 600;
    this.engineFilter.frequency.setTargetAtTime(filterCutoff, now, 0.04);

    const targetEngineGain = isOnThrottle ? 0.42 + state.throttle * 0.18 : 0.28;
    this.engineGain.gain.setTargetAtTime(targetEngineGain, now, 0.05);

    const targetNoiseGain = isOnThrottle ? 0.12 + gearRatio * 0.08 : 0.04;
    this.engineNoiseGain.gain.setTargetAtTime(targetNoiseGain, now, 0.05);

    // ── 3. Tire Screech (Drift & Lateral Slip) ──
    const slip = state.lateralSlipSpeed;
    if (state.isGrounded && slip > 1.2) {
      const screechVol = Math.min(0.55, (slip - 1.2) / 8.0);
      this.screechGain.gain.setTargetAtTime(screechVol, now, 0.03);
      const screechPitch = 1100 + absSpeed * 22;
      this.screechFilter.frequency.setTargetAtTime(screechPitch, now, 0.03);
    } else {
      this.screechGain.gain.setTargetAtTime(0, now, 0.06);
    }

    // ── 4. Nitro Boost ──
    if (state.isBoosting) {
      if (!this.wasBoosting) {
        this.triggerIgnitionThump(now);
      }
      this.nitroGain.gain.setTargetAtTime(0.48, now, 0.05);
      this.nitroFilter.frequency.setTargetAtTime(2200, now, 0.08);
      this.nitroRumbleGain.gain.setTargetAtTime(0.32, now, 0.05);
    } else {
      this.nitroGain.gain.setTargetAtTime(0, now, 0.22);
      this.nitroFilter.frequency.setTargetAtTime(700, now, 0.20);
      this.nitroRumbleGain.gain.setTargetAtTime(0, now, 0.15);
    }
    this.wasBoosting = state.isBoosting;

    // ── 5. Wind Rush ──
    const speedNorm = Math.min(1.0, absSpeed / 50.0);
    const windVol = (speedNorm * speedNorm) * 0.38;
    this.windGain.gain.setTargetAtTime(windVol, now, 0.05);
    this.windFilter.frequency.setTargetAtTime(320 + absSpeed * 22, now, 0.05);

    // ── 6. Barrier Scrape ──
    if (state.isScrapingBarrier && state.barrierScrapeSpeed > 2.0) {
      const scrapeVol = Math.min(0.42, (state.barrierScrapeSpeed / 35.0) * 0.42);
      this.scrapeGain.gain.setTargetAtTime(scrapeVol, now, 0.02);
    } else {
      this.scrapeGain.gain.setTargetAtTime(0, now, 0.08);
    }

    // ── 7. Impacts & Landings ──
    if (state.wasAirborneJustLanded) {
      this.triggerLanding(now, absSpeed);
    }
    if (state.impactSpeed > 2.0) {
      this.triggerBarrierImpact(now, state.impactSpeed);
    }
  }

  // ── Transient Trigger Methods (Zero Node Allocations) ───────

  private triggerIgnitionThump(now: number): void {
    this.ignitionOsc.frequency.setValueAtTime(200, now);
    this.ignitionOsc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
    this.ignitionGain.gain.setValueAtTime(0.55, now);
    this.ignitionGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  }

  private triggerLanding(now: number, speed: number): void {
    const vol = Math.min(0.65, Math.max(0.15, speed / 40.0));
    this.landingOsc.frequency.setValueAtTime(120, now);
    this.landingOsc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    this.landingGain.gain.setValueAtTime(vol, now);
    this.landingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  }

  private triggerBarrierImpact(now: number, impactSpeed: number): void {
    const vol = Math.min(0.85, impactSpeed / 25.0);
    this.impactOsc.frequency.setValueAtTime(95, now);
    this.impactOsc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
    this.impactGain.gain.setValueAtTime(vol, now);
    this.impactGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    this.impactNoiseGain.gain.setValueAtTime(vol * 0.7, now);
    this.impactNoiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  }

  /**
   * UI Countdown Beeps: 3, 2, 1 (440Hz low), GO (880Hz high)
   */
  playCountdownBeep(isFinalGo: boolean): void {
    if (!this.ctx || !this.isStarted || this.isGamePaused) return;
    const now = this.ctx.currentTime;
    const freq = isFinalGo ? 880 : 440;
    const vol = isFinalGo ? 0.45 : 0.30;
    const dur = isFinalGo ? 0.20 : 0.10;

    this.uiBeepOsc.frequency.setValueAtTime(freq, now);
    this.uiBeepGain.gain.setValueAtTime(vol, now);
    this.uiBeepGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  }

  /**
   * Checkpoint Crossing Chime (bright ascending two-tone)
   */
  playCheckpointChime(): void {
    if (!this.ctx || !this.isStarted || this.isGamePaused) return;
    const now = this.ctx.currentTime;

    // Tone 1: 784 Hz (G5)
    this.uiChimeOsc1.frequency.setValueAtTime(783.99, now);
    this.uiChimeGain1.gain.setValueAtTime(0.32, now);
    this.uiChimeGain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    // Tone 2: 1046.5 Hz (C6)
    this.uiChimeOsc2.frequency.setValueAtTime(1046.5, now + 0.06);
    this.uiChimeGain2.gain.setValueAtTime(0.40, now + 0.06);
    this.uiChimeGain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
  }

  /**
   * Lap Completion Jingle:
   *   - Standard lap: 4-note ascending triumphant arpeggio (C5, E5, G5, C6)
   *   - New Best Lap Record: 5-note golden fanfare with shimmer
   */
  playLapComplete(isNewRecord: boolean): void {
    if (!this.ctx || !this.isStarted || this.isGamePaused) return;
    const now = this.ctx.currentTime;

    if (!isNewRecord) {
      // 4-note standard lap chime
      const notes = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) {
        const t = now + i * 0.08;
        this.uiJingleOsc1.frequency.setValueAtTime(notes[i], t);
        this.uiJingleGain.gain.setValueAtTime(0.35, t);
        this.uiJingleGain.gain.exponentialRampToValueAtTime(0.001, t + (i === 3 ? 0.38 : 0.075));
      }
    } else {
      // 5-note gold record fanfare with chord ring
      const notes = [392.0, 523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) {
        const t = now + i * 0.07;
        this.uiJingleOsc1.frequency.setValueAtTime(notes[i], t);
        if (i === 4) {
          // Add harmony on last chord
          this.uiJingleOsc2.frequency.setValueAtTime(1318.5, t); // E6
          this.uiJingleOsc3.frequency.setValueAtTime(523.25, t); // C5
        }
        this.uiJingleGain.gain.setValueAtTime(0.42, t);
        this.uiJingleGain.gain.exponentialRampToValueAtTime(0.001, t + (i === 4 ? 0.65 : 0.065));
      }
    }
  }
}

// Global engine singleton
export const audioEngine = new AudioEngine();
