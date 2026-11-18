/**
 * src/core/InputManager.ts
 * ─────────────────────────────────────────────────────────────
 * Tracks keyboard state without allocating per-frame.
 * Uses dynamic bindings from SettingsManager with fallback secondary keys.
 * Supports modal input suppression to prevent key conflicts during rebinding.
 * ─────────────────────────────────────────────────────────────
 */
import { settings } from './Settings';

export interface InputState {
  steer:      number;  // -1 (left) … +1 (right)
  throttle:   number;  //  0 … 1
  brake:      number;  //  0 … 1
  drift:      boolean; // Bound drift key
  boost:      boolean; // Bound boost key
  restart:    boolean; // Edge pulse
  remix:      boolean; // Edge pulse
  debug:      boolean;
}

const keys: Set<string> = new Set();
let restartQueued = false;
let remixQueued = false;
let inputSuppressed = false;

window.addEventListener('keydown', e => {
  keys.add(e.code);

  if (inputSuppressed) return;

  const b = settings.data.keyBindings;
  if (e.code === b.restart || e.code === 'KeyR') {
    restartQueued = true;
  }
  if (e.code === b.remix || e.code === 'KeyM') {
    remixQueued = true;
  }
});

window.addEventListener('keyup', e => {
  keys.delete(e.code);
});

export function setInputSuppressed(suppressed: boolean): void {
  inputSuppressed = suppressed;
  if (suppressed) {
    keys.clear();
    restartQueued = false;
    remixQueued = false;
  }
}

export function isInputSuppressed(): boolean {
  return inputSuppressed;
}

const _state: InputState = {
  steer: 0,
  throttle: 0,
  brake: 0,
  drift: false,
  boost: false,
  restart: false,
  remix: false,
  debug: false,
};

export function readInput(): Readonly<InputState> {
  if (inputSuppressed) {
    _state.throttle = 0;
    _state.brake = 0;
    _state.steer = 0;
    _state.drift = false;
    _state.boost = false;
    _state.restart = false;
    _state.remix = false;
    return _state;
  }

  const b = settings.data.keyBindings;

  // Throttle (Primary bound key + ArrowUp fallback)
  _state.throttle = keys.has(b.throttle) || keys.has('ArrowUp') ? 1 : 0;

  // Brake / Reverse (Primary bound key + ArrowDown fallback)
  _state.brake = keys.has(b.brake) || keys.has('ArrowDown') ? 1 : 0;

  // Steering Left / Right
  const right = keys.has(b.steerRight) || keys.has('ArrowRight') ? 1 : 0;
  const left  = keys.has(b.steerLeft)  || keys.has('ArrowLeft')  ? 1 : 0;
  _state.steer = right - left;

  // Drift & Nitro Boost
  _state.drift = keys.has(b.drift);
  _state.boost = keys.has(b.boost) || keys.has('ShiftRight') || keys.has('KeyB');

  // Single-pulse edge events
  _state.restart = restartQueued;
  restartQueued = false;

  _state.remix = remixQueued;
  remixQueued = false;

  return _state;
}

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'Space': return 'Spacebar';
    case 'ShiftLeft': return 'Left Shift';
    case 'ShiftRight': return 'Right Shift';
    case 'ControlLeft': return 'Left Ctrl';
    case 'ControlRight': return 'Right Ctrl';
    case 'AltLeft': return 'Left Alt';
    case 'AltRight': return 'Right Alt';
    case 'ArrowUp': return 'Up Arrow';
    case 'ArrowDown': return 'Down Arrow';
    case 'ArrowLeft': return 'Left Arrow';
    case 'ArrowRight': return 'Right Arrow';
    case 'Enter': return 'Enter';
    case 'Escape': return 'Escape';
    default: return code;
  }
}
