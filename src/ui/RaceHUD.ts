/**
 * src/ui/RaceHUD.ts
 * ─────────────────────────────────────────────────────────────
 * Modern Racing Broadcast Telemetry HUD & Championship Mission Briefing.
 *
 * Designed for crystal-clear readability and comprehensive game direction:
 *   - Mission Briefing / How-To-Play modal (Aim of game, 6DOF gravity driving, controls)
 *   - High-contrast typography on frosted smoke-glass panels
 *   - Clean live digital speedometer and lap timing
 *   - Real-time race position leaderboard ranking (1ST, 2ND, 3RD, 4TH)
 *   - Kinetic boost energy meter with trick notifications
 *   - 3-Lap Championship Victory / Results Screen with restart & remix buttons
 *
 * RULES.md: Zero per-frame allocations. All DOM nodes cached.
 * ─────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';

export class RaceHUD {
  private readonly root: HTMLDivElement;
  private displaySpeed = 0;

  private readonly elLapTime:     HTMLSpanElement;
  private readonly elBestTime:    HTMLSpanElement;
  private readonly elLapCount:    HTMLSpanElement;
  private readonly elCheckpoints: HTMLSpanElement;
  private readonly elPosition:    HTMLSpanElement;
  private readonly elSpeed:       HTMLDivElement;
  private readonly elGhostState:  HTMLDivElement;

  private readonly elSeedBadge:   HTMLDivElement;
  private readonly elInversion:   HTMLDivElement;
  private readonly elWrongWay:    HTMLDivElement;

  private readonly elBoostBar:    HTMLDivElement;
  private readonly elTrickPopup:  HTMLDivElement;
  private trickTimer = 0;

  private readonly elCountdown:   HTMLDivElement;

  private readonly elBanner:      HTMLDivElement;
  private bannerTimer = 0;

  // ── Dirty-Checking State Caches (Zero DOM layout thrashing) ─
  private lastLapCentis = -1;
  private lastLapTimeStr = '';
  private lastBestCentis = -1;
  private lastBestTimeStr = '';
  private lastLapCount = -1;
  private lastCheckpoint = -1;
  private lastTotalCheckpoints = -1;
  private lastPositionStr = '';
  private lastSpeedRounded = -1;
  private lastBoostRounded = -1;
  private lastIsBoosting: boolean | null = null;
  private lastHasGhost: boolean | null = null;
  private lastIsInverted: boolean | null = null;
  private lastIsWrongWay: boolean | null = null;

  // Mission Briefing & Victory Overlays
  private readonly elBriefingModal: HTMLDivElement;
  private readonly elVictoryOverlay: HTMLDivElement;
  private readonly elVictoryTitle: HTMLHeadingElement;
  private readonly elVictoryStats: HTMLDivElement;

  onRestartRace?: () => void;
  onRemixCity?: () => void;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:      'fixed',
      top:           '0',
      left:          '0',
      width:         '100vw',
      height:        '100vh',
      pointerEvents: 'none',
      fontFamily:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color:         '#ffffff',
      zIndex:        '9000',
    } as Partial<CSSStyleDeclaration>);

    // ── 1. Top Left: Seed & Theme Badge + Help Button ─────────
    const topLeftBox = document.createElement('div');
    Object.assign(topLeftBox.style, {
      position:       'absolute',
      top:            '16px',
      left:           '16px',
      display:        'flex',
      gap:            '8px',
      alignItems:     'center',
      pointerEvents:  'auto',
    } as Partial<CSSStyleDeclaration>);

    this.elSeedBadge = document.createElement('div');
    Object.assign(this.elSeedBadge.style, {
      padding:        '8px 16px',
      background:     'rgba(18, 24, 36, 0.88)',
      border:         '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius:   '6px',
      fontSize:       '12px',
      fontWeight:     '600',
      color:          '#e2e8f0',
      backdropFilter: 'blur(8px)',
      boxShadow:      '0 4px 12px rgba(0,0,0,0.2)',
    } as Partial<CSSStyleDeclaration>);
    this.elSeedBadge.textContent = 'CIRCUIT: VIBRANT DAYLIGHT';
    topLeftBox.appendChild(this.elSeedBadge);

    const btnHelp = document.createElement('button');
    Object.assign(btnHelp.style, {
      padding:        '8px 14px',
      background:     '#2563eb',
      border:         'none',
      borderRadius:   '6px',
      fontSize:       '12px',
      fontWeight:     '700',
      color:          '#ffffff',
      cursor:         'pointer',
      boxShadow:      '0 4px 12px rgba(37,99,235,0.3)',
    } as Partial<CSSStyleDeclaration>);
    btnHelp.textContent = '? OBJECTIVE (H)';
    btnHelp.onclick = () => this.toggleBriefing();
    topLeftBox.appendChild(btnHelp);

    this.root.appendChild(topLeftBox);

    // ── 2. Top Header Bar (Timer, Position, Checkpoints) ─────
    const topBar = document.createElement('div');
    Object.assign(topBar.style, {
      position:       'absolute',
      top:            '16px',
      left:           '50%',
      transform:      'translate3d(-50%, 0, 0)',
      width:          '620px',
      boxSizing:      'border-box',
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'center',
      padding:        '10px 24px',
      background:     'rgba(18, 24, 36, 0.92)',
      border:         '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius:   '8px',
      backdropFilter: 'blur(8px)',
      boxShadow:      '0 6px 16px rgba(0,0,0,0.25)',
      willChange:     'contents',
    } as Partial<CSSStyleDeclaration>);

    // Mode / Record
    const colPos = document.createElement('div');
    colPos.style.cssText = 'width: 105px; text-align: center; flex-shrink: 0;';
    colPos.innerHTML = '<span style="color:#94a3b8;font-size:10px;font-weight:700;display:block;letter-spacing:1px;">MODE</span>';
    this.elPosition = document.createElement('span');
    this.elPosition.style.cssText = 'font-size:16px;font-weight:800;color:#38bdf8;line-height:1;letter-spacing:0.5px;display:block;';
    this.elPosition.textContent = 'SOLO TRIAL';
    colPos.appendChild(this.elPosition);

    // Lap
    const colLap = document.createElement('div');
    colLap.style.cssText = 'width: 75px; text-align: center; flex-shrink: 0;';
    colLap.innerHTML = '<span style="color:#94a3b8;font-size:10px;font-weight:700;display:block;letter-spacing:1px;">LAP</span>';
    this.elLapCount = document.createElement('span');
    this.elLapCount.style.cssText = 'font-size:22px;font-weight:800;color:#ffffff;line-height:1;display:block;';
    this.elLapCount.textContent = '1 / 3';
    colLap.appendChild(this.elLapCount);

    // Current Time
    const colTime = document.createElement('div');
    colTime.style.cssText = 'width: 160px; text-align: center; flex-shrink: 0;';
    colTime.innerHTML = '<span style="color:#94a3b8;font-size:10px;font-weight:700;display:block;letter-spacing:1px;">TIME</span>';
    this.elLapTime = document.createElement('span');
    this.elLapTime.style.cssText = 'font-size:26px;font-weight:800;color:#ffffff;font-family:ui-monospace,SFMono-Regular,"Roboto Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;line-height:1;display:block;width:100%;letter-spacing:0.5px;';
    this.elLapTime.textContent = '00:00.000';
    colTime.appendChild(this.elLapTime);

    // Best Time
    const colBest = document.createElement('div');
    colBest.style.cssText = 'width: 135px; text-align: center; flex-shrink: 0;';
    colBest.innerHTML = '<span style="color:#94a3b8;font-size:10px;font-weight:700;display:block;letter-spacing:1px;">BEST</span>';
    this.elBestTime = document.createElement('span');
    this.elBestTime.style.cssText = 'font-size:20px;font-weight:700;color:#f43f5e;font-family:ui-monospace,SFMono-Regular,"Roboto Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;line-height:1;display:block;width:100%;letter-spacing:0.5px;';
    this.elBestTime.textContent = '--:--.---';
    colBest.appendChild(this.elBestTime);

    // Checkpoint
    const colCP = document.createElement('div');
    colCP.style.cssText = 'width: 80px; text-align: center; flex-shrink: 0;';
    colCP.innerHTML = '<span style="color:#94a3b8;font-size:10px;font-weight:700;display:block;letter-spacing:1px;">GATE</span>';
    this.elCheckpoints = document.createElement('span');
    this.elCheckpoints.style.cssText = 'font-size:18px;font-weight:700;color:#10b981;line-height:1;display:block;';
    this.elCheckpoints.textContent = '0 / 8';
    colCP.appendChild(this.elCheckpoints);

    topBar.appendChild(colPos);
    topBar.appendChild(colLap);
    topBar.appendChild(colTime);
    topBar.appendChild(colBest);
    topBar.appendChild(colCP);
    this.root.appendChild(topBar);

    // ── 3. Center Inversion Alert Banner ─────────────────────
    this.elInversion = document.createElement('div');
    Object.assign(this.elInversion.style, {
      position:   'absolute',
      top:        '85px',
      left:       '50%',
      transform:  'translateX(-50%)',
      padding:    '6px 20px',
      background: 'rgba(239, 68, 68, 0.9)',
      border:     '1px solid #fca5a5',
      borderRadius:'4px',
      fontSize:   '13px',
      fontWeight: '800',
      letterSpacing:'1.5px',
      color:      '#ffffff',
      display:    'none',
    } as Partial<CSSStyleDeclaration>);
    this.elInversion.textContent = '⚠ GRAVITY INVERTED — SKY IS ROAD ⚠';
    this.root.appendChild(this.elInversion);

    // ── 3b. Center Wrong Way Alert Banner ───────────────────
    this.elWrongWay = document.createElement('div');
    Object.assign(this.elWrongWay.style, {
      position:      'absolute',
      top:           '125px',
      left:          '50%',
      transform:     'translateX(-50%)',
      padding:       '8px 26px',
      background:    'rgba(220, 38, 38, 0.95)',
      border:        '2px solid #ffffff',
      borderRadius:  '6px',
      fontSize:      '15px',
      fontWeight:    '900',
      letterSpacing: '2px',
      color:         '#ffffff',
      display:       'none',
      boxShadow:     '0 4px 20px rgba(220, 38, 38, 0.7)',
    } as Partial<CSSStyleDeclaration>);
    this.elWrongWay.textContent = '⛔ WRONG WAY — TURN AROUND ⛔';
    this.root.appendChild(this.elWrongWay);

    // ── 4. Bottom Right: Speedometer & Telemetry ─────────────
    const bottomBox = document.createElement('div');
    Object.assign(bottomBox.style, {
      position:       'absolute',
      bottom:         '24px',
      right:          '24px',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'flex-end',
      gap:            '8px',
      padding:        '16px 22px',
      background:     'rgba(18, 24, 36, 0.90)',
      border:         '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius:   '10px',
      backdropFilter: 'blur(8px)',
      boxShadow:      '0 6px 16px rgba(0,0,0,0.25)',
    } as Partial<CSSStyleDeclaration>);

    this.elSpeed = document.createElement('div');
    this.elSpeed.style.cssText = 'font-size:46px;font-weight:900;line-height:1;color:#ffffff;font-variant-numeric:tabular-nums;';
    this.elSpeed.textContent = '0 KM/H';

    const boostTrack = document.createElement('div');
    Object.assign(boostTrack.style, {
      width:        '180px',
      height:       '10px',
      background:   'rgba(255, 255, 255, 0.1)',
      borderRadius: '5px',
      overflow:     'hidden',
    } as Partial<CSSStyleDeclaration>);

    this.elBoostBar = document.createElement('div');
    Object.assign(this.elBoostBar.style, {
      width:        '50%',
      height:       '100%',
      background:   'linear-gradient(90deg, #0284c7, #38bdf8)',
      borderRadius: '5px',
      transition:   'width 0.08s ease-out',
    } as Partial<CSSStyleDeclaration>);
    boostTrack.appendChild(this.elBoostBar);

    const boostLabel = document.createElement('div');
    boostLabel.style.cssText = 'font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1px;width:180px;display:flex;justify-content:space-between;';
    boostLabel.innerHTML = '<span>NITRO BOOST</span><span>[SHIFT]</span>';

    this.elGhostState = document.createElement('div');
    this.elGhostState.style.cssText = 'font-size:11px;font-weight:600;color:#94a3b8;margin-top:4px;';
    this.elGhostState.textContent = 'GHOST: RECORDING';

    bottomBox.appendChild(this.elSpeed);
    bottomBox.appendChild(boostTrack);
    bottomBox.appendChild(boostLabel);
    bottomBox.appendChild(this.elGhostState);
    this.root.appendChild(bottomBox);

    // ── 5. Center Countdown (3-2-1-GO) ───────────────────────
    this.elCountdown = document.createElement('div');
    Object.assign(this.elCountdown.style, {
      position:   'absolute',
      top:        '42%',
      left:       '50%',
      transform:  'translate(-50%, -50%)',
      fontSize:   '108px',
      fontWeight: '900',
      color:      '#ef4444',
      textShadow: '0 6px 24px rgba(0,0,0,0.6)',
      display:    'none',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.elCountdown);

    // ── 7. Trick / Refill Notification Popup ─────────────────
    this.elTrickPopup = document.createElement('div');
    Object.assign(this.elTrickPopup.style, {
      position:       'absolute',
      bottom:         '120px',
      right:          '24px',
      padding:        '8px 16px',
      background:     'rgba(34, 197, 94, 0.9)',
      borderRadius:   '6px',
      fontSize:       '13px',
      fontWeight:     '800',
      color:          '#ffffff',
      opacity:        '0',
      transition:     'opacity 0.2s',
      boxShadow:      '0 4px 14px rgba(34,197,94,0.4)',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.elTrickPopup);

    // ── 8. Lap Completion Banner ─────────────────────────────
    this.elBanner = document.createElement('div');
    Object.assign(this.elBanner.style, {
      position:       'absolute',
      top:            '26%',
      left:           '50%',
      transform:      'translate(-50%, -50%)',
      padding:        '14px 36px',
      background:     'rgba(18, 24, 36, 0.95)',
      border:         '2px solid #ffd700',
      borderRadius:   '8px',
      fontSize:       '22px',
      fontWeight:     '900',
      color:          '#ffffff',
      letterSpacing:  '1px',
      display:        'none',
      boxShadow:      '0 8px 32px rgba(0,0,0,0.5)',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.elBanner);

    // ── 9. Interactive Mission Briefing Modal ────────────────
    this.elBriefingModal = document.createElement('div');
    Object.assign(this.elBriefingModal.style, {
      position:       'fixed',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%, -50%)',
      width:          '90%',
      maxWidth:       '620px',
      background:     'rgba(15, 23, 42, 0.97)',
      border:         '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius:   '12px',
      padding:        '28px 32px',
      color:          '#e2e8f0',
      boxShadow:      '0 16px 48px rgba(0,0,0,0.7)',
      backdropFilter: 'blur(16px)',
      pointerEvents:  'auto',
      zIndex:         '9500',
      display:        'none',
    } as Partial<CSSStyleDeclaration>);

    this.elBriefingModal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:10px;">
        <div>
          <h2 style="margin:0;font-size:22px;font-weight:900;color:#38bdf8;letter-spacing:1px;">WARP CITY: GRAVITY DRIFT</h2>
          <span style="font-size:11px;color:#94a3b8;font-weight:600;">CHAMPIONSHIP MISSION BRIEFING</span>
        </div>
        <button id="btn-close-briefing" style="background:transparent;border:none;color:#94a3b8;font-size:24px;cursor:pointer;line-height:1;">&times;</button>
      </div>

      <div style="font-size:13px;line-height:1.6;color:#cbd5e1;margin-bottom:16px;">
        <p style="margin:0 0 10px 0;"><strong style="color:#ffd700;">AIM OF THE GAME:</strong> Set the ultimate lap record and master the circuit against your personal best <strong>Ghost Replay</strong> through a towering 6DOF metropolis!</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0;">
          <div style="background:rgba(255,255,255,0.04);padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:800;color:#38bdf8;margin-bottom:4px;">🌀 6DOF Wall & Inversion Driving</div>
            Drive onto curved ramps to climb 90m up the <strong>Apex Tower</strong> and race upside-down along inverted skyways!
          </div>
          <div style="background:rgba(255,255,255,0.04);padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:800;color:#f59e0b;margin-bottom:4px;">⚡ Drift-Charged Nitro Boost</div>
            Hold [Space] into corners to power-drift and refill your Nitro tank. Tap [Shift] for explosive straightaway acceleration!
          </div>
          <div style="background:rgba(255,255,255,0.04);padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:800;color:#a855f7;margin-bottom:4px;">👻 Ghost Telemetry Replay</div>
            Race head-to-head against a translucent ghost of your best previous lap. Compare apex lines and optimize sector splits.
          </div>
          <div style="background:rgba(255,255,255,0.04);padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:800;color:#10b981;margin-bottom:4px;">🏁 8 Sector Timing Gates</div>
            Hit all 8 timing checkpoints sequentially to register valid lap times. Press [R] anytime to restart the run instantly.
          </div>
        </div>
      </div>

      <div style="background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;font-size:12px;margin-bottom:18px;">
        <div style="font-weight:800;color:#e2e8f0;margin-bottom:6px;">CONTROLS SUMMARY</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;color:#94a3b8;">
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">W</kbd> / <kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">↑</kbd> Accelerate</div>
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">S</kbd> / <kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">↓</kbd> Brake / Reverse</div>
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">A</kbd> <kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">D</kbd> / <kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">←</kbd> <kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">→</kbd> Steer</div>
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">SPACE</kbd> Power Drift (Charges Boost)</div>
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">SHIFT</kbd> Nitro Boost</div>
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">R</kbd> Restart Run</div>
          <div><kbd style="background:#334155;color:#fff;padding:2px 6px;border-radius:3px;">M</kbd> City Remix (Seed/Time)</div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:12px;">
        <button id="btn-start-race" style="background:#2563eb;color:#ffffff;border:none;padding:10px 24px;border-radius:6px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 4px 12px rgba(37,99,235,0.4);">START TIME TRIAL</button>
      </div>
    `;
    this.root.appendChild(this.elBriefingModal);

    // ── 10. Championship Victory / Podium Screen ─────────────
    this.elVictoryOverlay = document.createElement('div');
    Object.assign(this.elVictoryOverlay.style, {
      position:       'fixed',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%, -50%)',
      width:          '90%',
      maxWidth:       '580px',
      background:     'rgba(15, 23, 42, 0.98)',
      border:         '2px solid #ffd700',
      borderRadius:   '14px',
      padding:        '32px',
      textAlign:      'center',
      color:          '#ffffff',
      boxShadow:      '0 20px 60px rgba(0,0,0,0.8)',
      backdropFilter: 'blur(16px)',
      pointerEvents:  'auto',
      zIndex:         '9600',
      display:        'none',
    } as Partial<CSSStyleDeclaration>);

    this.elVictoryTitle = document.createElement('h1');
    this.elVictoryTitle.style.cssText = 'margin:0 0 10px 0;font-size:32px;font-weight:900;color:#ffd700;letter-spacing:1.5px;';
    this.elVictoryTitle.textContent = '🏆 1ST PLACE - GRAND CHAMPION!';
    this.elVictoryOverlay.appendChild(this.elVictoryTitle);

    this.elVictoryStats = document.createElement('div');
    this.elVictoryStats.style.cssText = 'font-size:16px;line-height:1.8;color:#cbd5e1;margin-bottom:24px;';
    this.elVictoryOverlay.appendChild(this.elVictoryStats);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:14px;justify-content:center;';

    const btnAgain = document.createElement('button');
    btnAgain.style.cssText = 'background:#2563eb;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,0.4);';
    btnAgain.textContent = 'RACE AGAIN';
    btnAgain.onclick = () => {
      this.hideVictory();
      this.onRestartRace?.();
    };

    const btnRemix = document.createElement('button');
    btnRemix.style.cssText = 'background:#475569;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:800;cursor:pointer;';
    btnRemix.textContent = 'CITY REMIX (M)';
    btnRemix.onclick = () => {
      this.hideVictory();
      this.onRemixCity?.();
    };

    btnRow.appendChild(btnAgain);
    btnRow.appendChild(btnRemix);
    this.elVictoryOverlay.appendChild(btnRow);
    this.root.appendChild(this.elVictoryOverlay);

    document.body.appendChild(this.root);

    // Event listeners
    const btnClose = this.elBriefingModal.querySelector('#btn-close-briefing') as HTMLElement;
    const btnStart = this.elBriefingModal.querySelector('#btn-start-race') as HTMLElement;
    if (btnClose) btnClose.onclick = () => this.toggleBriefing(false);
    if (btnStart) btnStart.onclick = () => this.toggleBriefing(false);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') {
        this.toggleBriefing();
      }
    });
  }

  toggleBriefing(force?: boolean): void {
    const isShowing = this.elBriefingModal.style.display === 'block';
    const next = force !== undefined ? force : !isShowing;
    this.elBriefingModal.style.display = next ? 'block' : 'none';
  }

  showVictory(_positionRank: number, totalTime: number, bestLapTime: number | null): void {
    this.elVictoryTitle.textContent = '🏆 TIME TRIAL COMPLETE!';
    this.elVictoryTitle.style.color = '#ffd700';

    const totalStr = this.formatTime(totalTime);
    const bestStr = bestLapTime !== null ? this.formatTime(bestLapTime) : '--:--.---';

    this.elVictoryStats.innerHTML = `
      <div style="background:rgba(255,255,255,0.05);padding:14px;border-radius:8px;margin-bottom:12px;">
        <div><strong>Total Race Time:</strong> <span style="color:#ffffff;font-weight:800;">${totalStr}</span></div>
        <div><strong>Best Lap:</strong> <span style="color:#f43f5e;font-weight:800;">${bestStr}</span></div>
        <div><strong>Laps Completed:</strong> 3 / 3</div>
        <div style="margin-top:6px;color:#a855f7;"><strong>Ghost Car:</strong> Saved & Recorded</div>
      </div>
    `;
    this.elVictoryOverlay.style.display = 'block';
  }

  hideVictory(): void {
    this.elVictoryOverlay.style.display = 'none';
  }

  updateCountdown(countdownTime: number): void {
    if (countdownTime > 0) {
      this.elCountdown.style.display = 'block';
      if (countdownTime > 2.0) {
        this.elCountdown.textContent = '3';
        this.elCountdown.style.color = '#ef4444';
      } else if (countdownTime > 1.0) {
        this.elCountdown.textContent = '2';
        this.elCountdown.style.color = '#f59e0b';
      } else {
        this.elCountdown.textContent = '1';
        this.elCountdown.style.color = '#38bdf8';
      }
    } else if (countdownTime > -0.7) {
      this.elCountdown.style.display = 'block';
      this.elCountdown.textContent = 'GO!';
      this.elCountdown.style.color = '#22c55e';
    } else {
      this.elCountdown.style.display = 'none';
    }
  }

  show(): void {
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  setSeedBadge(seed: number, themeName: string, isDaily: boolean): void {
    const dailyTag = isDaily ? ' (DAILY)' : ' (REMIX)';
    this.elSeedBadge.textContent = `#${seed}${dailyTag} | ${themeName}`;
  }

  setInversionAlert(active: boolean): void {
    if (this.lastIsInverted !== active) {
      this.lastIsInverted = active;
      this.elInversion.style.display = active ? 'block' : 'none';
    }
  }

  setWrongWayAlert(active: boolean): void {
    if (this.lastIsWrongWay !== active) {
      this.lastIsWrongWay = active;
      this.elWrongWay.style.display = active ? 'block' : 'none';
    }
  }

  showTrickPopup(text: string, color?: string): void {
    this.elTrickPopup.textContent = text;
    this.elTrickPopup.style.background = color || 'rgba(34, 197, 94, 0.9)';
    this.elTrickPopup.style.opacity = '1';
    this.trickTimer = 1.4;
  }

  showLapNotification(text: string, isRecord: boolean): void {
    this.elBanner.textContent = text;
    this.elBanner.style.borderColor = isRecord ? '#ffd700' : '#38bdf8';
    this.elBanner.style.display = 'block';
    this.bannerTimer = 3.5;
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}.${ms < 100 ? (ms < 10 ? '00' : '0') : ''}${ms}`;
  }

  update(options: {
    currentLapTime: number;
    bestLapTime: number | null;
    lapCount: number;
    activeCheckpoint: number;
    totalCheckpoints: number;
    speedKmh: number;
    positionRank?: number;
    boostCharge: number;
    isBoosting: boolean;
    hasGhost: boolean;
    isInverted: boolean;
    isWrongWay?: boolean;
    dt: number;
  }): void {
    const {
      currentLapTime,
      bestLapTime,
      lapCount,
      activeCheckpoint,
      totalCheckpoints,
      speedKmh,
      positionRank,
      boostCharge,
      isBoosting,
      hasGhost,
      isInverted,
      isWrongWay,
      dt,
    } = options;

    // 1. Lap Time (Dirty check on centisecond)
    const lapCentis = Math.floor(currentLapTime * 100);
    if (lapCentis !== this.lastLapCentis) {
      this.lastLapCentis = lapCentis;
      this.lastLapTimeStr = this.formatTime(currentLapTime);
      this.elLapTime.textContent = this.lastLapTimeStr;
    }

    // 2. Best Lap Time
    if (bestLapTime !== null) {
      const bestCentis = Math.floor(bestLapTime * 100);
      if (bestCentis !== this.lastBestCentis) {
        this.lastBestCentis = bestCentis;
        this.lastBestTimeStr = this.formatTime(bestLapTime);
        this.elBestTime.textContent = this.lastBestTimeStr;
      }
    } else if (this.lastBestCentis !== -999) {
      this.lastBestCentis = -999;
      this.elBestTime.textContent = '--:--.---';
    }

    // 3. Lap Count
    if (lapCount !== this.lastLapCount) {
      this.lastLapCount = lapCount;
      this.elLapCount.textContent = `${Math.min(3, lapCount)} / 3`;
    }

    // 4. Checkpoints
    if (activeCheckpoint !== this.lastCheckpoint || totalCheckpoints !== this.lastTotalCheckpoints) {
      this.lastCheckpoint = activeCheckpoint;
      this.lastTotalCheckpoints = totalCheckpoints;
      this.elCheckpoints.textContent = `${activeCheckpoint} / ${totalCheckpoints}`;
    }

    // 5. Position Rank
    const posStr = positionRank !== undefined ? `${positionRank} / 1` : 'SOLO TRIAL';
    if (posStr !== this.lastPositionStr) {
      this.lastPositionStr = posStr;
      this.elPosition.textContent = posStr;
    }

    // 6. Smooth digital tachometer response with integer dirty check
    this.displaySpeed = THREE.MathUtils.lerp(this.displaySpeed, Math.abs(speedKmh), Math.min(1, 10 * dt));
    const speedRounded = Math.round(this.displaySpeed);
    if (speedRounded !== this.lastSpeedRounded) {
      this.lastSpeedRounded = speedRounded;
      this.elSpeed.textContent = `${speedRounded} KM/H`;
    }

    // 7. Boost Bar width and gradient
    const boostRounded = Math.round(Math.max(0, Math.min(100, boostCharge)));
    if (boostRounded !== this.lastBoostRounded) {
      this.lastBoostRounded = boostRounded;
      this.elBoostBar.style.width = `${boostRounded}%`;
    }

    if (isBoosting !== this.lastIsBoosting) {
      this.lastIsBoosting = isBoosting;
      this.elBoostBar.style.background = isBoosting
        ? 'linear-gradient(90deg, #f59e0b, #38bdf8)'
        : 'linear-gradient(90deg, #0284c7, #38bdf8)';
    }

    // 8. Ghost State
    if (hasGhost !== this.lastHasGhost) {
      this.lastHasGhost = hasGhost;
      if (hasGhost) {
        this.elGhostState.textContent = 'GHOST: REPLAYING';
        this.elGhostState.style.color = '#a855f7';
      } else {
        this.elGhostState.textContent = 'GHOST: RECORDING';
        this.elGhostState.style.color = '#64748b';
      }
    }

    // 9. Inversion Alert
    this.setInversionAlert(isInverted);

    // 10. Wrong Way Alert
    if (isWrongWay !== undefined) {
      this.setWrongWayAlert(isWrongWay);
    }

    if (this.trickTimer > 0) {
      this.trickTimer -= dt;
      if (this.trickTimer <= 0) {
        this.elTrickPopup.style.opacity = '0';
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.elBanner.style.display = 'none';
      }
    }
  }
}
