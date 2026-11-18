/**
 * src/systems/GameState.ts
 * ─────────────────────────────────────────────────────────────
 * Finite State Machine for Game Lifecycle and Game Modes.
 * ─────────────────────────────────────────────────────────────
 */

export enum GameState {
  MENU = 'MENU',
  COUNTDOWN = 'COUNTDOWN',
  RACING = 'RACING',
  ROAMING = 'ROAMING',
  FINISHED = 'FINISHED',
  PAUSED = 'PAUSED',
}

export enum GameMode {
  RACE = 'RACE',
  ROAM = 'ROAM',
}
