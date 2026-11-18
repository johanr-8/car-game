/**
 * src/ui/SettingsModal.ts
 * ─────────────────────────────────────────────────────────────
 * Complete Game Settings Modal:
 *   - Volume sliders (Master, Engine, Effects, UI)
 *   - Graphics quality presets (Low, Medium, High)
 *   - Camera comfort toggle (disables shake & FOV kick)
 *   - Key rebinding with duplicate protection & reset button
 *
 * Persisted live through SettingsManager with Light DOM dirty checking.
 * ─────────────────────────────────────────────────────────────
 */
import { settings, type GraphicsQuality, type KeyBindings, type VolumeSettings } from '../core/Settings';
import { formatKeyCode, setInputSuppressed } from '../core/InputManager';

export class SettingsModal {
  private readonly root: HTMLDivElement;
  private rebindingAction: keyof KeyBindings | null = null;
  private readonly keyButtons: Map<keyof KeyBindings, HTMLButtonElement> = new Map();
  private readonly errorEl: HTMLDivElement;
  private readonly volumeValueDisplays: Map<keyof VolumeSettings, HTMLSpanElement> = new Map();

  onClose?: () => void;
  onGraphicsChanged?: (quality: GraphicsQuality) => void;
  onCameraComfortChanged?: (comfort: boolean) => void;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      background:      'rgba(3, 7, 18, 0.88)',
      backdropFilter:  'blur(12px)',
      display:         'none',
      justifyContent:  'center',
      alignItems:      'center',
      zIndex:          '9700',
      pointerEvents:   'auto',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color:           '#ffffff',
      userSelect:      'none',
    } as Partial<CSSStyleDeclaration>);

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width:           '560px',
      maxHeight:       '90vh',
      overflowY:       'auto',
      padding:         '28px 32px',
      background:      'rgba(15, 23, 42, 0.98)',
      border:          '1px solid rgba(56, 189, 248, 0.35)',
      borderRadius:    '16px',
      boxShadow:       '0 25px 60px rgba(0,0,0,0.8)',
      display:         'flex',
      flexDirection:   'column',
      gap:             '20px',
      boxSizing:       'border-box',
    } as Partial<CSSStyleDeclaration>);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;';
    header.innerHTML = `
      <div>
        <h2 style="margin:0;font-size:22px;font-weight:900;letter-spacing:1.5px;color:#38bdf8;">⚙ SETTINGS</h2>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Audio, Graphics & Key Bindings</div>
      </div>
      <button id="btn-close-settings" style="background:transparent;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
    `;
    panel.appendChild(header);

    // ── 1. Audio Volumes (Stored for future Audio Engine) ──
    const audioSection = document.createElement('div');
    audioSection.innerHTML = '<div style="font-size:13px;font-weight:800;letter-spacing:1px;color:#e2e8f0;margin-bottom:10px;">AUDIO VOLUMES</div>';
    const audioGrid = document.createElement('div');
    audioGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;';

    const createVolumeSlider = (bus: keyof VolumeSettings, label: string) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      const headerLine = document.createElement('div');
      headerLine.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;font-weight:600;';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;

      const valSpan = document.createElement('span');
      valSpan.style.cssText = 'color:#38bdf8;font-family:monospace;font-weight:700;';
      const curVal = settings.getVolume(bus);
      valSpan.textContent = `${Math.round(curVal * 100)}%`;
      this.volumeValueDisplays.set(bus, valSpan);

      headerLine.appendChild(labelSpan);
      headerLine.appendChild(valSpan);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.05';
      slider.value = String(curVal);
      slider.style.cssText = 'width:100%;accent-color:#38bdf8;cursor:pointer;';
      slider.oninput = () => {
        const num = parseFloat(slider.value);
        settings.setVolume(bus, num);
        valSpan.textContent = `${Math.round(num * 100)}%`;
      };

      row.appendChild(headerLine);
      row.appendChild(slider);
      return row;
    };

    audioGrid.appendChild(createVolumeSlider('master', 'Master Volume'));
    audioGrid.appendChild(createVolumeSlider('engine', 'Engine Sounds'));
    audioGrid.appendChild(createVolumeSlider('effects', 'Tires & Nitro Effects'));
    audioGrid.appendChild(createVolumeSlider('ui', 'UI & Notifications'));
    audioSection.appendChild(audioGrid);
    panel.appendChild(audioSection);

    // ── 2. Graphics Quality Presets ──
    const gfxSection = document.createElement('div');
    gfxSection.innerHTML = '<div style="font-size:13px;font-weight:800;letter-spacing:1px;color:#e2e8f0;margin-bottom:8px;">GRAPHICS PRESET</div>';

    const gfxBtnGroup = document.createElement('div');
    gfxBtnGroup.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;';

    const qualities: Array<{ id: GraphicsQuality; title: string; desc: string }> = [
      { id: 'low',    title: 'LOW',    desc: 'Shadows OFF, Bloom OFF, 0.75x Scale' },
      { id: 'medium', title: 'MEDIUM', desc: '1K Shadows, Bloom ON, 0.9x Scale' },
      { id: 'high',   title: 'HIGH',   desc: '2K Soft Shadows, Bloom ON, 1.0x Scale' },
    ];

    const gfxButtons: HTMLButtonElement[] = [];
    qualities.forEach(q => {
      const btn = document.createElement('button');
      btn.style.cssText = 'padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#1e293b;color:#e2e8f0;cursor:pointer;text-align:center;transition:all 0.15s;';
      btn.innerHTML = `
        <div style="font-size:13px;font-weight:800;">${q.title}</div>
        <div style="font-size:9px;color:#94a3b8;margin-top:4px;">${q.desc}</div>
      `;
      btn.onclick = () => {
        settings.setGraphicsQuality(q.id);
        updateGfxButtons();
        this.onGraphicsChanged?.(q.id);
      };
      gfxButtons.push(btn);
      gfxBtnGroup.appendChild(btn);
    });

    const updateGfxButtons = () => {
      qualities.forEach((q, idx) => {
        const isCurrent = settings.data.graphicsQuality === q.id;
        const btn = gfxButtons[idx];
        if (isCurrent) {
          btn.style.borderColor = '#38bdf8';
          btn.style.background = 'rgba(2, 132, 199, 0.25)';
          btn.style.boxShadow = '0 0 14px rgba(56,189,248,0.3)';
        } else {
          btn.style.borderColor = 'rgba(255,255,255,0.1)';
          btn.style.background = '#1e293b';
          btn.style.boxShadow = 'none';
        }
      });
    };
    updateGfxButtons();
    gfxSection.appendChild(gfxBtnGroup);
    panel.appendChild(gfxSection);

    // ── 3. Camera Comfort Toggle ──
    const comfortRow = document.createElement('label');
    comfortRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.08);padding:12px 16px;border-radius:10px;cursor:pointer;';

    const comfortLabel = document.createElement('div');
    comfortLabel.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;">Camera Comfort Mode</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:2px;">Disables dynamic FOV speed-kick and camera shake</div>
    `;

    const comfortCheckbox = document.createElement('input');
    comfortCheckbox.type = 'checkbox';
    comfortCheckbox.checked = settings.data.cameraComfort;
    comfortCheckbox.style.cssText = 'width:18px;height:18px;accent-color:#38bdf8;cursor:pointer;';
    comfortCheckbox.onchange = () => {
      settings.setCameraComfort(comfortCheckbox.checked);
      this.onCameraComfortChanged?.(comfortCheckbox.checked);
    };

    comfortRow.appendChild(comfortLabel);
    comfortRow.appendChild(comfortCheckbox);
    panel.appendChild(comfortRow);

    // ── 4. Keyboard Rebinding ──
    const keysSection = document.createElement('div');
    keysSection.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:800;letter-spacing:1px;color:#e2e8f0;">KEYBOARD BINDINGS</span>
        <button id="btn-reset-keys" style="background:transparent;border:none;color:#38bdf8;font-size:11px;font-weight:700;cursor:pointer;text-decoration:underline;">Reset Defaults</button>
      </div>
    `;

    const keysGrid = document.createElement('div');
    keysGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;';

    const actions: Array<{ key: keyof KeyBindings; label: string }> = [
      { key: 'throttle',   label: 'Accelerate' },
      { key: 'brake',      label: 'Brake / Reverse' },
      { key: 'steerLeft',  label: 'Steer Left' },
      { key: 'steerRight', label: 'Steer Right' },
      { key: 'drift',      label: 'Power Drift' },
      { key: 'boost',      label: 'Nitro Boost' },
      { key: 'restart',    label: 'Restart Run' },
      { key: 'remix',      label: 'City Remix' },
    ];

    actions.forEach(({ key, label }) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:rgba(30,41,59,0.6);border-radius:6px;font-size:12px;';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      labelSpan.style.color = '#cbd5e1';

      const btn = document.createElement('button');
      btn.style.cssText = 'background:#334155;color:#38bdf8;border:1px solid rgba(56,189,248,0.3);padding:4px 10px;border-radius:4px;font-size:11px;font-family:monospace;font-weight:800;cursor:pointer;min-width:70px;text-align:center;';
      btn.textContent = formatKeyCode(settings.data.keyBindings[key]);

      btn.onclick = () => this.startRebinding(key);

      this.keyButtons.set(key, btn);
      row.appendChild(labelSpan);
      row.appendChild(btn);
      keysGrid.appendChild(row);
    });

    keysSection.appendChild(keysGrid);

    this.errorEl = document.createElement('div');
    this.errorEl.style.cssText = 'color:#f43f5e;font-size:11px;font-weight:700;margin-top:6px;min-height:16px;';
    keysSection.appendChild(this.errorEl);

    panel.appendChild(keysSection);

    // Footer with Back button
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;border-top:1px solid rgba(255,255,255,0.1);padding-top:14px;';
    const btnBack = document.createElement('button');
    btnBack.style.cssText = 'background:#0284c7;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer;';
    btnBack.textContent = 'DONE';
    btnBack.onclick = () => this.close();
    footer.appendChild(btnBack);
    panel.appendChild(footer);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);

    // Header close button
    const btnClose = panel.querySelector('#btn-close-settings') as HTMLButtonElement;
    if (btnClose) btnClose.onclick = () => this.close();

    // Reset keys button
    const btnResetKeys = panel.querySelector('#btn-reset-keys') as HTMLButtonElement;
    if (btnResetKeys) {
      btnResetKeys.onclick = () => {
        settings.resetKeyBindings();
        this.updateKeyButtons();
        this.errorEl.textContent = 'Key bindings restored to defaults.';
        this.errorEl.style.color = '#38bdf8';
        setTimeout(() => { this.errorEl.textContent = ''; }, 2500);
      };
    }

    // Keydown listener for rebinding
    window.addEventListener('keydown', e => {
      if (!this.rebindingAction) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        this.cancelRebinding();
        return;
      }

      const res = settings.rebindKey(this.rebindingAction, e.code);
      if (res.success) {
        this.errorEl.textContent = '';
        this.updateKeyButtons();
        this.cancelRebinding();
      } else {
        this.errorEl.textContent = res.error || 'Failed to bind key';
        this.errorEl.style.color = '#f43f5e';
      }
    });
  }

  private startRebinding(action: keyof KeyBindings): void {
    this.rebindingAction = action;
    setInputSuppressed(true);
    this.errorEl.textContent = '';

    this.keyButtons.forEach((btn, k) => {
      if (k === action) {
        btn.textContent = '[PRESS KEY]';
        btn.style.background = '#f59e0b';
        btn.style.color = '#000000';
      } else {
        btn.style.opacity = '0.5';
      }
    });
  }

  private cancelRebinding(): void {
    this.rebindingAction = null;
    setInputSuppressed(false);
    this.keyButtons.forEach(btn => {
      btn.style.opacity = '1';
      btn.style.background = '#334155';
      btn.style.color = '#38bdf8';
    });
    this.updateKeyButtons();
  }

  private updateKeyButtons(): void {
    const b = settings.data.keyBindings;
    this.keyButtons.forEach((btn, action) => {
      btn.textContent = formatKeyCode(b[action]);
    });
  }

  show(): void {
    setInputSuppressed(true);
    this.errorEl.textContent = '';
    this.updateKeyButtons();
    this.root.style.display = 'flex';
  }

  close(): void {
    if (this.rebindingAction) {
      this.cancelRebinding();
    }
    setInputSuppressed(false);
    this.root.style.display = 'none';
    this.onClose?.();
  }

  get isVisible(): boolean {
    return this.root.style.display !== 'none';
  }
}
