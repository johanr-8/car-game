/**
 * src/core/InputManager.ts
 * ─────────────────────────────────────────────────────────────
 * Tracks keyboard state without allocating per-frame.
 * Includes edge-triggered actions like restart (KeyR / Enter)
 * and city remix (KeyM).
 * ─────────────────────────────────────────────────────────────
 */
export interface InputState {
  steer:      number;  // -1 (left) … +1 (right)
  throttle:   number;  //  0 … 1
  brake:      number;  //  0 … 1
  drift:      boolean; // Space
  boost:      boolean; // Shift / B
  restart:    boolean; // R / Enter (single-pulse)
  remix:      boolean; // M (single-pulse)
  debug:      boolean;
}

const keys: Set<string> = new Set();
let restartQueued = false;
let remixQueued = false;

window.addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'KeyR' || e.code === 'Enter') {
    restartQueued = true;
  }
  if (e.code === 'KeyM') {
    remixQueued = true;
  }
});

window.addEventListener('keyup', e => {
  keys.delete(e.code);
});

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
  _state.throttle   = keys.has('ArrowUp')    || keys.has('KeyW') ? 1 : 0;
  _state.brake      = keys.has('ArrowDown')  || keys.has('KeyS') ? 1 : 0;
  _state.steer      = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0)
                    - (keys.has('ArrowLeft')  || keys.has('KeyA') ? 1 : 0);
  _state.drift      = keys.has('Space');
  _state.boost      = keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyB');

  _state.restart    = restartQueued;
  restartQueued     = false;

  _state.remix      = remixQueued;
  remixQueued       = false;

  return _state;
}

export function isKeyJustPressed(code: string): boolean {
  return keys.has(code);
}
