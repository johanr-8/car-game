/**
 * src/ui/ResultsModal.ts
 * ─────────────────────────────────────────────────────────────
 * Post-Race Results Screen & Local Leaderboard Modal (GameState.FINISHED).
 * Displays total race time, each lap time, session best lap,
 * new-record badge, and Top 10 leaderboard for current daily seed.
 * ─────────────────────────────────────────────────────────────
 */
import { settings } from '../core/Settings';

export class ResultsModal {
  private readonly root: HTMLDivElement;
  private readonly elTotalTime: HTMLDivElement;
  private readonly elRecordBadge: HTMLDivElement;
  private readonly elLapsContainer: HTMLDivElement;
  private readonly elBestLap: HTMLSpanElement;
  private readonly elLeaderboardBody: HTMLTableSectionElement;
  private readonly elSeedHeading: HTMLSpanElement;

  onRestart?: () => void;
  onRemix?: () => void;
  onMenu?: () => void;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      background:      'rgba(2, 6, 23, 0.90)',
      backdropFilter:  'blur(14px)',
      display:         'none',
      justifyContent:  'center',
      alignItems:      'center',
      zIndex:          '9600',
      pointerEvents:   'auto',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color:           '#ffffff',
      userSelect:      'none',
    } as Partial<CSSStyleDeclaration>);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width:           '540px',
      maxHeight:       '92vh',
      overflowY:       'auto',
      padding:         '28px 32px',
      background:      'rgba(15, 23, 42, 0.98)',
      border:          '1px solid rgba(56, 189, 248, 0.4)',
      borderRadius:    '16px',
      boxShadow:       '0 25px 60px rgba(0,0,0,0.85)',
      display:         'flex',
      flexDirection:   'column',
      gap:             '18px',
      boxSizing:       'border-box',
    } as Partial<CSSStyleDeclaration>);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'text-align:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;';
    header.innerHTML = `
      <div style="font-size:12px;font-weight:800;letter-spacing:3px;color:#38bdf8;text-transform:uppercase;">Grand Prix Complete</div>
      <h1 style="margin:2px 0 0 0;font-size:32px;font-weight:950;letter-spacing:2px;color:#ffffff;">VICTORY FINISH</h1>
    `;
    panel.appendChild(header);

    // Total Time Display + Record Badge
    const timeCard = document.createElement('div');
    timeCard.style.cssText = 'background:rgba(30,41,59,0.7);border:1px solid rgba(56,189,248,0.25);border-radius:12px;padding:16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px;';

    this.elRecordBadge = document.createElement('div');
    this.elRecordBadge.style.cssText = 'display:none;background:linear-gradient(135deg, #f59e0b, #ef4444);color:#ffffff;font-size:11px;font-weight:900;letter-spacing:2px;padding:4px 12px;border-radius:20px;text-transform:uppercase;box-shadow:0 0 16px rgba(245,158,11,0.5);margin-bottom:4px;';
    this.elRecordBadge.textContent = '★ NEW RECORD ★';
    timeCard.appendChild(this.elRecordBadge);

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;';
    lbl.textContent = 'TOTAL TIME';
    timeCard.appendChild(lbl);

    this.elTotalTime = document.createElement('div');
    this.elTotalTime.style.cssText = 'font-size:38px;font-weight:950;font-family:monospace;color:#38bdf8;letter-spacing:1px;text-shadow:0 0 20px rgba(56,189,248,0.4);';
    this.elTotalTime.textContent = '00:00.00';
    timeCard.appendChild(this.elTotalTime);

    panel.appendChild(timeCard);

    // Lap Breakdown & Best Lap
    const lapCard = document.createElement('div');
    lapCard.style.cssText = 'background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px 16px;';

    this.elLapsContainer = document.createElement('div');
    this.elLapsContainer.style.cssText = 'display:flex;justify-content:space-around;font-size:12px;font-family:monospace;font-weight:700;';
    lapCard.appendChild(this.elLapsContainer);

    const bestLapLine = document.createElement('div');
    bestLapLine.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;font-size:12px;color:#94a3b8;';
    bestLapLine.innerHTML = '<span>BEST LAP THIS SESSION:</span>';
    this.elBestLap = document.createElement('span');
    this.elBestLap.style.cssText = 'color:#ffd700;font-family:monospace;font-weight:800;';
    bestLapLine.appendChild(this.elBestLap);
    lapCard.appendChild(bestLapLine);

    panel.appendChild(lapCard);

    // Leaderboard Section
    const lbSection = document.createElement('div');
    lbSection.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:800;letter-spacing:1px;color:#e2e8f0;">TRACK LEADERBOARD</span>
        <span id="lb-seed-heading" style="font-size:11px;color:#38bdf8;font-family:monospace;font-weight:700;">#SEED</span>
      </div>
    `;
    this.elSeedHeading = lbSection.querySelector('#lb-seed-heading') as HTMLSpanElement;

    const lbTable = document.createElement('table');
    lbTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
    lbTable.innerHTML = `
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:left;">
          <th style="padding:6px 4px;width:30px;">#</th>
          <th style="padding:6px 4px;">Time</th>
          <th style="padding:6px 4px;text-align:right;">Date</th>
        </tr>
      </thead>
    `;
    this.elLeaderboardBody = document.createElement('tbody');
    lbTable.appendChild(this.elLeaderboardBody);
    lbSection.appendChild(lbTable);

    panel.appendChild(lbSection);

    // Action Buttons
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;';

    const createBtn = (text: string, isPrimary: boolean, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.style.cssText = isPrimary
        ? 'background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%);color:#ffffff;border:none;padding:12px;border-radius:8px;font-size:13px;font-weight:900;letter-spacing:1px;cursor:pointer;box-shadow:0 4px 14px rgba(2,132,199,0.4);'
        : 'background:#1e293b;color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);padding:12px;border-radius:8px;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;';
      btn.textContent = text;
      btn.onclick = onClick;
      return btn;
    };

    const btnRestart = createBtn('🔄 RACE AGAIN (R)', true, () => this.onRestart?.());
    const btnRemix = createBtn('🎲 CITY REMIX (M)', false, () => this.onRemix?.());
    btnGroup.appendChild(btnRestart);
    btnGroup.appendChild(btnRemix);
    panel.appendChild(btnGroup);

    const btnMenu = document.createElement('button');
    btnMenu.style.cssText = 'background:transparent;color:#94a3b8;border:none;padding:6px;font-size:12px;font-weight:700;cursor:pointer;text-decoration:underline;margin-top:-6px;';
    btnMenu.textContent = '« Return to Main Menu';
    btnMenu.onclick = () => this.onMenu?.();
    panel.appendChild(btnMenu);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  showResults(
    totalTime: number,
    lapTimes: number[],
    bestLapTime: number | null,
    seed: number
  ): void {
    // 1. Format and display total time
    this.elTotalTime.textContent = this.formatTime(totalTime);

    // 2. Record result into persistent leaderboard
    const { isNewOverallBest, isNewSeedBest, rank } = settings.recordRaceResult(seed, totalTime, lapTimes);

    if (isNewOverallBest || isNewSeedBest) {
      this.elRecordBadge.style.display = 'block';
      this.elRecordBadge.textContent = isNewOverallBest ? '★ NEW ALL-TIME RECORD ★' : '★ NEW SEED RECORD ★';
    } else {
      this.elRecordBadge.style.display = 'none';
    }

    // 3. Lap breakdown
    this.elLapsContainer.innerHTML = '';
    lapTimes.forEach((time, idx) => {
      const col = document.createElement('div');
      col.innerHTML = `
        <div style="font-size:10px;color:#94a3b8;font-family:sans-serif;">LAP ${idx + 1}</div>
        <div style="color:#e2e8f0;margin-top:2px;">${this.formatTime(time)}</div>
      `;
      this.elLapsContainer.appendChild(col);
    });

    // 4. Session best lap
    const sessionBest = bestLapTime !== null ? bestLapTime : Math.min(...lapTimes);
    this.elBestLap.textContent = this.formatTime(sessionBest);

    // 5. Update Leaderboard Table
    this.elSeedHeading.textContent = `Seed #${seed}`;
    this.elLeaderboardBody.innerHTML = '';
    const leaderboard = settings.getLeaderboard(seed);

    if (leaderboard.length === 0) {
      const trEmpty = document.createElement('tr');
      trEmpty.innerHTML = '<td colspan="3" style="padding:12px;text-align:center;color:#64748b;">No times recorded for this seed yet.</td>';
      this.elLeaderboardBody.appendChild(trEmpty);
    } else {
      leaderboard.forEach((entry, idx) => {
        const tr = document.createElement('tr');
        const isCurrentRun = (idx + 1 === rank) && Math.abs(entry.time - totalTime) < 0.001;
        tr.style.cssText = `border-bottom:1px solid rgba(255,255,255,0.05);${isCurrentRun ? 'background:rgba(56,189,248,0.15);color:#38bdf8;' : ''}`;

        tr.innerHTML = `
          <td style="padding:6px 4px;font-weight:800;color:${idx === 0 ? '#ffd700' : idx === 1 ? '#cbd5e1' : idx === 2 ? '#cd7f32' : '#94a3b8'};">#${idx + 1}</td>
          <td style="padding:6px 4px;font-family:monospace;font-weight:700;">${this.formatTime(entry.time)} ${isCurrentRun ? '◄' : ''}</td>
          <td style="padding:6px 4px;text-align:right;color:#64748b;font-size:11px;">${entry.date}</td>
        `;
        this.elLeaderboardBody.appendChild(tr);
      });
    }

    this.root.style.display = 'flex';
  }

  private formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}.${ms < 10 ? '0' : ''}${ms}`;
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get isVisible(): boolean {
    return this.root.style.display !== 'none';
  }
}
