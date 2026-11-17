/**
 * src/ui/DevTuningPanel.ts
 * ─────────────────────────────────────────────────────────────
 * F4-toggleable Developer Drift & Handling Tuning Panel.
 *
 * Sliders:
 *   - lateralFrictionNormal (Normal grip decay rate)
 *   - lateralFrictionDrift  (Drift grip decay rate)
 *   - steerSpeed            (Base steering rate)
 *   - driftSteerBoost       (Steering multiplier while drifting)
 *   - driftTransitionTime   (Blend duration between normal & drift)
 *
 * Saves live overrides to localStorage so you can tune by feel.
 * ─────────────────────────────────────────────────────────────
 */
import { CarConfig, DEFAULT_CAR_CONFIG } from '../car/CarConfig';

const STORAGE_KEY = 'warp_drift_tuning';

interface TuningData {
  lateralFrictionNormal: number;
  lateralFrictionDrift: number;
  steerSpeed: number;
  driftSteerBoost: number;
  driftTransitionTime: number;
}

export class DevTuningPanel {
  private readonly root: HTMLDivElement;
  private visible = false;

  private readonly sliderMap: Record<keyof TuningData, { input: HTMLInputElement; valueDisplay: HTMLSpanElement }> = {} as any;

  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position:        'fixed',
      top:             '16px',
      right:           '16px',
      width:           '320px',
      padding:         '16px',
      background:      'rgba(12, 18, 32, 0.94)',
      border:          '1px solid rgba(56, 189, 248, 0.4)',
      borderRadius:    '10px',
      color:           '#e2e8f0',
      fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize:        '12px',
      boxShadow:       '0 10px 30px rgba(0,0,0,0.6)',
      backdropFilter:  'blur(12px)',
      zIndex:          '9998',
      display:         'none',
      pointerEvents:   'auto',
    } as Partial<CSSStyleDeclaration>);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;';
    header.innerHTML = `
      <div style="font-weight:800;color:#38bdf8;letter-spacing:0.5px;font-size:13px;">⚙️ DRIFT TUNING (F4)</div>
      <button id="btn-close-tuning" style="background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;line-height:1;">&times;</button>
    `;
    this.root.appendChild(header);

    // Controls container
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    this.root.appendChild(controls);

    // Create sliders
    this.createSlider(controls, 'lateralFrictionNormal', 'Normal Grip Friction', 4.0, 20.0, 0.1, '/s');
    this.createSlider(controls, 'lateralFrictionDrift', 'Drift Lateral Friction', 0.5, 8.0, 0.1, '/s');
    this.createSlider(controls, 'steerSpeed', 'Base Steering Rate', 1.5, 7.0, 0.1, ' rad/s');
    this.createSlider(controls, 'driftSteerBoost', 'Drift Steering Boost', 1.0, 2.5, 0.05, 'x');
    this.createSlider(controls, 'driftTransitionTime', 'Drift Blend Duration', 0.05, 0.40, 0.01, 's');

    // Footer with Reset Defaults button
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:14px;display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);';

    const btnReset = document.createElement('button');
    btnReset.style.cssText = 'background:#334155;color:#e2e8f0;border:none;padding:6px 12px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;';
    btnReset.textContent = 'RESET DEFAULTS';
    btnReset.onclick = () => this.resetDefaults();

    const hint = document.createElement('span');
    hint.style.cssText = 'color:#64748b;font-size:10px;';
    hint.textContent = 'Auto-saved to localStorage';

    footer.appendChild(btnReset);
    footer.appendChild(hint);
    this.root.appendChild(footer);

    document.body.appendChild(this.root);

    // Close button
    const btnClose = this.root.querySelector('#btn-close-tuning') as HTMLButtonElement;
    if (btnClose) btnClose.onclick = () => this.hide();

    // Keydown listener for F4
    window.addEventListener('keydown', e => {
      if (e.code === 'F4') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Load saved settings from localStorage
    this.loadSavedSettings();
  }

  private createSlider(
    container: HTMLElement,
    prop: keyof TuningData,
    label: string,
    min: number,
    max: number,
    step: number,
    unit: string
  ): void {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex;justify-content:space-between;font-weight:600;font-size:11px;color:#cbd5e1;';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = label;

    const valSpan = document.createElement('span');
    valSpan.style.cssText = 'color:#38bdf8;font-family:ui-monospace,SFMono-Regular,monospace;font-weight:700;';
    valSpan.textContent = `${CarConfig[prop]}${unit}`;

    labelRow.appendChild(titleSpan);
    labelRow.appendChild(valSpan);
    row.appendChild(labelRow);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(CarConfig[prop]);
    slider.style.cssText = 'width:100%;cursor:pointer;accent-color:#38bdf8;';

    slider.oninput = () => {
      const val = parseFloat(slider.value);
      (CarConfig[prop] as number) = val;
      valSpan.textContent = `${val.toFixed(step < 0.1 ? 2 : 1)}${unit}`;
      this.saveSettings();
    };

    row.appendChild(slider);
    container.appendChild(row);

    this.sliderMap[prop] = { input: slider, valueDisplay: valSpan };
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  private saveSettings(): void {
    if (typeof localStorage === 'undefined') return;
    const data: TuningData = {
      lateralFrictionNormal: CarConfig.lateralFrictionNormal,
      lateralFrictionDrift:  CarConfig.lateralFrictionDrift,
      steerSpeed:            CarConfig.steerSpeed,
      driftSteerBoost:       CarConfig.driftSteerBoost,
      driftTransitionTime:   CarConfig.driftTransitionTime,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore private browsing storage quota exceptions
    }
  }

  private loadSavedSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<TuningData>;

      if (data.lateralFrictionNormal !== undefined) CarConfig.lateralFrictionNormal = data.lateralFrictionNormal;
      if (data.lateralFrictionDrift !== undefined)  CarConfig.lateralFrictionDrift = data.lateralFrictionDrift;
      if (data.steerSpeed !== undefined)            CarConfig.steerSpeed = data.steerSpeed;
      if (data.driftSteerBoost !== undefined)       CarConfig.driftSteerBoost = data.driftSteerBoost;
      if (data.driftTransitionTime !== undefined)   CarConfig.driftTransitionTime = data.driftTransitionTime;

      this.syncSlidersFromConfig();
    } catch {
      // Ignore parsing errors
    }
  }

  private syncSlidersFromConfig(): void {
    for (const key of Object.keys(this.sliderMap) as (keyof TuningData)[]) {
      const entry = this.sliderMap[key];
      if (!entry) continue;
      const val = CarConfig[key];
      entry.input.value = String(val);
      const isSec = key.includes('Time');
      const isBoost = key.includes('Boost');
      const unit = isSec ? 's' : isBoost ? 'x' : key.includes('Friction') ? '/s' : ' rad/s';
      entry.valueDisplay.textContent = `${Number(val).toFixed(2)}${unit}`;
    }
  }

  private resetDefaults(): void {
    CarConfig.lateralFrictionNormal = DEFAULT_CAR_CONFIG.lateralFrictionNormal;
    CarConfig.lateralFrictionDrift  = DEFAULT_CAR_CONFIG.lateralFrictionDrift;
    CarConfig.steerSpeed            = DEFAULT_CAR_CONFIG.steerSpeed;
    CarConfig.driftSteerBoost       = DEFAULT_CAR_CONFIG.driftSteerBoost;
    CarConfig.driftTransitionTime   = DEFAULT_CAR_CONFIG.driftTransitionTime;

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }

    this.syncSlidersFromConfig();
  }
}
