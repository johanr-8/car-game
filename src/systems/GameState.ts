/**
 * src/systems/GameState.ts
 * ─────────────────────────────────────────────────────────────
 * Finite State Machine for Game Lifecycle.
 * ─────────────────────────────────────────────────────────────
 */

export enum GameState {
  MENU = 'MENU',
  COUNTDOWN = 'COUNTDOWN',
  RACING = 'RACING',
  FINISHED = 'FINISHED',
  PAUSED = 'PAUSED',
}
