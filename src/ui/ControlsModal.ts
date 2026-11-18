/**
 * src/ui/ControlsModal.ts
 * ─────────────────────────────────────────────────────────────
 * Dynamic Controls Screen:
 * Lists all active keyboard bindings generated directly from
 * the actual SettingsManager binding table so it never goes stale.
 * ─────────────────────────────────────────────────────────────
 */
import { settings, type KeyBindings } from '../core/Settings';
import { formatKeyCode } from '../core/InputManager';

export class ControlsModal {
  private readonly root: HTMLDivElement;
  private readonly tableBody: HTMLTableSectionElement;

  onClose?: () => void;

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
      width:           '480px',
      maxHeight:       '90vh',
      overflowY:       'auto',
      padding:         '28px 32px',
      background:      'rgba(15, 23, 42, 0.98)',
      border:          '1px solid rgba(56, 189, 248, 0.35)',
      borderRadius:    '16px',
      boxShadow:       '0 25px 60px rgba(0,0,0,0.8)',
      display:         'flex',
      flexDirection:   'column',
      gap:             '18px',
      boxSizing:       'border-box',
    } as Partial<CSSStyleDeclaration>);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;';
    header.innerHTML = `
      <div>
        <h2 style="margin:0;font-size:22px;font-weight:900;letter-spacing:1.5px;color:#38bdf8;">🎮 CONTROLS</h2>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Live Active Keyboard Bindings</div>
      </div>
      <button id="btn-close-controls" style="background:transparent;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
    `;
    panel.appendChild(header);

    // Controls Table
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:left;">
        <th style="padding:8px 6px;">Action</th>
        <th style="padding:8px 6px;text-align:right;">Key</th>
      </tr>
    `;
    table.appendChild(thead);

    this.tableBody = document.createElement('tbody');
    table.appendChild(this.tableBody);
    panel.appendChild(table);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;border-top:1px solid rgba(255,255,255,0.1);padding-top:14px;';
    const btnDone = document.createElement('button');
    btnDone.style.cssText = 'background:#0284c7;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer;';
    btnDone.textContent = 'BACK';
    btnDone.onclick = () => this.hide();
    footer.appendChild(btnDone);
    panel.appendChild(footer);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);

    const btnClose = panel.querySelector('#btn-close-controls') as HTMLButtonElement;
    if (btnClose) btnClose.onclick = () => this.hide();
  }

  refreshBindings(): void {
    this.tableBody.innerHTML = '';
    const b = settings.data.keyBindings;

    const actionDefs: Array<{ key: keyof KeyBindings; label: string; secondary?: string }> = [
      { key: 'throttle',   label: 'Accelerate',       secondary: 'Up Arrow' },
      { key: 'brake',      label: 'Brake / Reverse',  secondary: 'Down Arrow' },
      { key: 'steerLeft',  label: 'Steer Left',       secondary: 'Left Arrow' },
      { key: 'steerRight', label: 'Steer Right',      secondary: 'Right Arrow' },
      { key: 'drift',      label: 'Power Drift',      secondary: '' },
      { key: 'boost',      label: 'Nitro Boost',      secondary: 'Shift / B' },
      { key: 'restart',    label: 'Restart Run',      secondary: 'Enter' },
      { key: 'remix',      label: 'City Remix',       secondary: '' },
    ];

    actionDefs.forEach(({ key, label, secondary }) => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.05);';

      const tdAction = document.createElement('td');
      tdAction.style.cssText = 'padding:9px 6px;color:#e2e8f0;font-weight:600;';
      tdAction.textContent = label;

      const tdKey = document.createElement('td');
      tdKey.style.cssText = 'padding:9px 6px;text-align:right;';

      const primaryBadge = document.createElement('span');
      primaryBadge.style.cssText = 'background:#1e293b;border:1px solid rgba(56,189,248,0.4);color:#38bdf8;padding:3px 8px;border-radius:4px;font-family:monospace;font-weight:800;font-size:12px;';
      primaryBadge.textContent = formatKeyCode(b[key]);
      tdKey.appendChild(primaryBadge);

      if (secondary) {
        const secSpan = document.createElement('span');
        secSpan.style.cssText = 'color:#64748b;font-size:11px;margin-left:6px;';
        secSpan.textContent = `or ${secondary}`;
        tdKey.appendChild(secSpan);
      }

      tr.appendChild(tdAction);
      tr.appendChild(tdKey);
      this.tableBody.appendChild(tr);
    });

    // Add Pause (Esc) static row
    const trPause = document.createElement('tr');
    trPause.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.05);';
    trPause.innerHTML = `
      <td style="padding:9px 6px;color:#e2e8f0;font-weight:600;">Pause Game</td>
      <td style="padding:9px 6px;text-align:right;">
        <span style="background:#1e293b;border:1px solid rgba(56,189,248,0.4);color:#38bdf8;padding:3px 8px;border-radius:4px;font-family:monospace;font-weight:800;font-size:12px;">Escape</span>
      </td>
    `;
    this.tableBody.appendChild(trPause);
  }

  show(): void {
    this.refreshBindings();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onClose?.();
  }

  get isVisible(): boolean {
    return this.root.style.display !== 'none';
  }
}
