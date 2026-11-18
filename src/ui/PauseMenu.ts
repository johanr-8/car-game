/**
 * src/ui/PauseMenu.ts
 * ─────────────────────────────────────────────────────────────
 * Modal Pause Menu toggled via [ESC] key.
 *
 * Actions:
 *   - Resume
 *   - Restart
 *   - Settings
 *   - Quit to menu
 * ─────────────────────────────────────────────────────────────
 */

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private visible = false;

  onResume?: () => void;
  onRestart?: () => void;
  onSettings?: () => void;
  onQuit?: () => void;
  onBriefing?: () => void;
  onRemix?: () => void;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      background:      'rgba(5, 8, 16, 0.8)',
      backdropFilter:  'blur(12px)',
      display:         'none',
      justifyContent:  'center',
      alignItems:      'center',
      zIndex:          '9500',
      pointerEvents:   'auto',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color:           '#ffffff',
      userSelect:      'none',
    } as Partial<CSSStyleDeclaration>);

    const card = document.createElement('div');
    Object.assign(card.style, {
      width:           '360px',
      maxHeight:       '94vh',
      overflowY:       'auto',
      padding:         '32px',
      background:      'rgba(15, 23, 42, 0.95)',
      border:          '1px solid rgba(56, 189, 248, 0.3)',
      borderRadius:    '14px',
      boxShadow:       '0 20px 50px rgba(0,0,0,0.7)',
      textAlign:       'center',
      display:         'flex',
      flexDirection:   'column',
      gap:             '12px',
    } as Partial<CSSStyleDeclaration>);

    card.innerHTML = `
      <h1 style="margin:0 0 4px 0;font-size:26px;font-weight:900;letter-spacing:2px;color:#38bdf8;">PAUSED</h1>
      <p style="margin:0 0 14px 0;font-size:12px;color:#94a3b8;">Race clock halted</p>
    `;

    const createBtn = (text: string, primary: boolean, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.style.cssText = primary
        ? 'background:#0284c7;color:#fff;border:none;padding:12px;border-radius:8px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(2,132,199,0.4);transition:all 0.15s;'
        : 'background:#1e293b;color:#e2e8f0;border:1px solid rgba(255,255,255,0.08);padding:11px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;transition:all 0.15s;';
      btn.textContent = text;
      btn.onmouseenter = () => { btn.style.background = primary ? '#0369a1' : '#334155'; };
      btn.onmouseleave = () => { btn.style.background = primary ? '#0284c7' : '#1e293b'; };
      btn.onclick = onClick;
      return btn;
    };

    const btnResume = createBtn('RESUME (ESC)', true, () => this.onResume?.());
    const btnRestart = createBtn('RESTART (R)', false, () => this.onRestart?.());
    const btnSettings = createBtn('⚙ SETTINGS', false, () => this.onSettings?.());
    const btnQuit = createBtn('🚪 QUIT TO MENU', false, () => this.onQuit?.());

    card.appendChild(btnResume);
    card.appendChild(btnRestart);
    card.appendChild(btnSettings);
    card.appendChild(btnQuit);

    this.root.appendChild(card);
    document.body.appendChild(this.root);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }
}
