/**
 * src/ui/MainMenu.ts
 * ─────────────────────────────────────────────────────────────
 * Futuristic Main Menu screen (GameState.MENU).
 * Displays title, today's daily seed, personal best total time,
 * and navigation buttons: Play, Settings, Controls.
 * ─────────────────────────────────────────────────────────────
 */

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly elSeed: HTMLDivElement;
  private readonly elBestTime: HTMLDivElement;

  onPlay?: () => void;
  onSettings?: () => void;
  onControls?: () => void;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      background:      'radial-gradient(ellipse at center, rgba(15, 23, 42, 0.85) 0%, rgba(3, 7, 18, 0.96) 100%)',
      backdropFilter:  'blur(8px)',
      display:         'flex',
      flexDirection:   'column',
      justifyContent:  'center',
      alignItems:      'center',
      zIndex:          '9000',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color:           '#ffffff',
      userSelect:      'none',
    } as Partial<CSSStyleDeclaration>);

    const container = document.createElement('div');
    Object.assign(container.style, {
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      gap:            '20px',
      maxWidth:       '480px',
      width:          '90%',
      textAlign:      'center',
    } as Partial<CSSStyleDeclaration>);

    // Title & Subtitle
    const titleBlock = document.createElement('div');
    titleBlock.innerHTML = `
      <div style="font-size:12px;font-weight:800;letter-spacing:4px;color:#38bdf8;text-transform:uppercase;margin-bottom:8px;">
        6DOF Arcade Time Trial
      </div>
      <h1 style="margin:0;font-size:38px;font-weight:950;letter-spacing:3px;line-height:1.1;background:linear-gradient(135deg, #ffffff 30%, #38bdf8 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 40px rgba(56,189,248,0.3);">
        WARP CITY
      </h1>
      <div style="font-size:18px;font-weight:900;letter-spacing:6px;color:#f43f5e;margin-top:2px;">
        VELOCITY DRIFT
      </div>
    `;
    container.appendChild(titleBlock);

    // Seed & Record Badge Card
    const infoCard = document.createElement('div');
    Object.assign(infoCard.style, {
      background:    'rgba(30, 41, 59, 0.7)',
      border:        '1px solid rgba(56, 189, 248, 0.25)',
      borderRadius:  '12px',
      padding:       '14px 20px',
      width:         '100%',
      boxSizing:     'border-box',
      display:       'flex',
      flexDirection: 'column',
      gap:           '6px',
    } as Partial<CSSStyleDeclaration>);

    this.elSeed = document.createElement('div');
    this.elSeed.style.cssText = 'font-size:13px;font-weight:700;color:#94a3b8;display:flex;justify-content:space-between;';
    this.elSeed.innerHTML = '<span>TODAY’S SEED</span><span style="color:#38bdf8;font-family:monospace;font-weight:800;">#000000</span>';

    this.elBestTime = document.createElement('div');
    this.elBestTime.style.cssText = 'font-size:13px;font-weight:700;color:#94a3b8;display:flex;justify-content:space-between;';
    this.elBestTime.innerHTML = '<span>BEST TOTAL TIME</span><span style="color:#ffd700;font-family:monospace;font-weight:800;">--:--.--</span>';

    infoCard.appendChild(this.elSeed);
    infoCard.appendChild(this.elBestTime);
    container.appendChild(infoCard);

    // Action Buttons
    const btnGroup = document.createElement('div');
    Object.assign(btnGroup.style, {
      display:       'flex',
      flexDirection: 'column',
      gap:           '12px',
      width:         '100%',
      marginTop:     '10px',
    } as Partial<CSSStyleDeclaration>);

    const createBtn = (text: string, isPrimary: boolean, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.style.cssText = isPrimary
        ? 'background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%);color:#ffffff;border:none;padding:15px;border-radius:10px;font-size:16px;font-weight:900;letter-spacing:1.5px;cursor:pointer;box-shadow:0 8px 24px rgba(2,132,199,0.45);transition:all 0.15s;'
        : 'background:rgba(30, 41, 59, 0.85);color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);padding:13px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:1px;cursor:pointer;transition:all 0.15s;';
      btn.textContent = text;
      btn.onmouseenter = () => { btn.style.transform = 'translateY(-2px)'; };
      btn.onmouseleave = () => { btn.style.transform = 'translateY(0)'; };
      btn.onclick = onClick;
      return btn;
    };

    const btnPlay = createBtn('▶ PLAY RACE', true, () => this.onPlay?.());
    const btnSettings = createBtn('⚙ SETTINGS', false, () => this.onSettings?.());
    const btnControls = createBtn('🎮 CONTROLS', false, () => this.onControls?.());

    btnGroup.appendChild(btnPlay);
    btnGroup.appendChild(btnSettings);
    btnGroup.appendChild(btnControls);
    container.appendChild(btnGroup);

    this.root.appendChild(container);
    document.body.appendChild(this.root);
  }

  updateInfo(seed: number, themeName: string, bestTime: number | null): void {
    this.elSeed.innerHTML = `<span>DAILY TRACK SEED</span><span style="color:#38bdf8;font-family:monospace;font-weight:800;">#${seed} (${themeName})</span>`;

    if (bestTime !== null && bestTime > 0) {
      const m = Math.floor(bestTime / 60);
      const s = (bestTime % 60).toFixed(2).padStart(5, '0');
      this.elBestTime.innerHTML = `<span>BEST TOTAL TIME</span><span style="color:#ffd700;font-family:monospace;font-weight:800;">${m}:${s} ★</span>`;
    } else {
      this.elBestTime.innerHTML = `<span>BEST TOTAL TIME</span><span style="color:#64748b;font-family:monospace;">NO RECORD YET</span>`;
    }
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  get isVisible(): boolean {
    return this.root.style.display !== 'none';
  }
}
