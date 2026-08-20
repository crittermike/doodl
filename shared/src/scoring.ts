/**
 * Scoring.
 *
 * Kept pure and dependency-free so it can be unit tested without spinning up a
 * room, and so the client can display the same numbers the server computed.
 */

import { DRAWER_POINTS_MAX, GUESS_POINTS_MAX, GUESS_POINTS_MIN } from './constants.js';

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Points awarded to a player who guessed correctly.
 *
 * Linear in the fraction of the turn still remaining, so guessing instantly is
 * worth `GUESS_POINTS_MAX` and guessing on the buzzer is still worth
 * `GUESS_POINTS_MIN` — being last is better than not guessing at all.
 */
export function guesserPoints(remainingMs: number, totalMs: number): number {
  if (totalMs <= 0) return GUESS_POINTS_MIN;
  const frac = clamp01(remainingMs / totalMs);
  return Math.round(GUESS_POINTS_MIN + (GUESS_POINTS_MAX - GUESS_POINTS_MIN) * frac);
}

/**
 * Points awarded to the drawer, scaled by how much of the room got the word.
 *
 * If nobody guessed, the drawer scores nothing — either the drawing was
 * unreadable or they were stalling. `guesserCount` excludes the drawer.
 */
export function drawerPoints(correctCount: number, guesserCount: number): number {
  if (guesserCount <= 0 || correctCount <= 0) return 0;
  const frac = clamp01(correctCount / guesserCount);
  return Math.round(DRAWER_POINTS_MAX * frac);
}

export interface Scoreish {
  id: string;
  name: string;
  avatar: string;
  score: number;
}

export interface RankedStanding<T extends Scoreish> {
  player: T;
  rank: number;
}

/**
 * Sort players into final standings, highest score first, with ties sharing a
 * rank (1, 2, 2, 4 — not 1, 2, 2, 3).
 */
export function rankPlayers<T extends Scoreish>(players: readonly T[]): RankedStanding<T>[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const out: RankedStanding<T>[] = [];
  let lastScore = Number.NaN;
  let lastRank = 0;

  sorted.forEach((player, i) => {
    const rank = player.score === lastScore ? lastRank : i + 1;
    lastScore = player.score;
    lastRank = rank;
    out.push({ player, rank });
  });

  return out;
}
