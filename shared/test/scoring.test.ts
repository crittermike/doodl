import { describe, expect, it } from 'vitest';
import { DRAWER_POINTS_MAX, GUESS_POINTS_MAX, GUESS_POINTS_MIN } from '../src/constants.js';
import { drawerPoints, guesserPoints, rankPlayers } from '../src/scoring.js';

const TOTAL = 80_000;

describe('guesserPoints', () => {
  it('awards the maximum for an instant guess', () => {
    expect(guesserPoints(TOTAL, TOTAL)).toBe(GUESS_POINTS_MAX);
  });

  it('awards the minimum on the buzzer, never zero', () => {
    expect(guesserPoints(0, TOTAL)).toBe(GUESS_POINTS_MIN);
    expect(guesserPoints(0, TOTAL)).toBeGreaterThan(0);
  });

  it('awards the midpoint at half time', () => {
    expect(guesserPoints(TOTAL / 2, TOTAL)).toBe((GUESS_POINTS_MIN + GUESS_POINTS_MAX) / 2);
  });

  it('decreases monotonically as time runs out', () => {
    let prev = Infinity;
    for (let left = TOTAL; left >= 0; left -= TOTAL / 8) {
      const pts = guesserPoints(left, TOTAL);
      expect(pts).toBeLessThanOrEqual(prev);
      prev = pts;
    }
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(guesserPoints(TOTAL * 2, TOTAL)).toBe(GUESS_POINTS_MAX);
    expect(guesserPoints(-5000, TOTAL)).toBe(GUESS_POINTS_MIN);
  });

  it('does not divide by zero', () => {
    expect(guesserPoints(0, 0)).toBe(GUESS_POINTS_MIN);
  });

  it('always returns a whole number', () => {
    expect(Number.isInteger(guesserPoints(12_345, TOTAL))).toBe(true);
  });
});

describe('drawerPoints', () => {
  it('gives zero when nobody guessed', () => {
    expect(drawerPoints(0, 5)).toBe(0);
  });

  it('gives the maximum when everyone guessed', () => {
    expect(drawerPoints(5, 5)).toBe(DRAWER_POINTS_MAX);
  });

  it('scales with the fraction who guessed', () => {
    expect(drawerPoints(2, 4)).toBe(DRAWER_POINTS_MAX / 2);
    // Rounded, because points are always whole: 250 * 0.25 = 62.5 -> 63.
    expect(drawerPoints(1, 4)).toBe(Math.round(DRAWER_POINTS_MAX / 4));
  });

  it('is monotonic in the number of correct guessers', () => {
    let prev = -1;
    for (let c = 0; c <= 6; c++) {
      const pts = drawerPoints(c, 6);
      expect(pts).toBeGreaterThanOrEqual(prev);
      prev = pts;
    }
  });

  it('handles a room with no eligible guessers', () => {
    expect(drawerPoints(0, 0)).toBe(0);
  });

  it('clamps if more guessers are reported than exist', () => {
    expect(drawerPoints(9, 4)).toBe(DRAWER_POINTS_MAX);
  });

  it('always returns a whole number', () => {
    expect(Number.isInteger(drawerPoints(1, 3))).toBe(true);
  });
});

describe('rankPlayers', () => {
  const p = (id: string, score: number) => ({ id, name: id, avatar: '🐙', score });

  it('sorts highest first', () => {
    const out = rankPlayers([p('a', 10), p('b', 30), p('c', 20)]);
    expect(out.map((r) => r.player.id)).toEqual(['b', 'c', 'a']);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('gives tied players the same rank and skips the next one', () => {
    const out = rankPlayers([p('a', 30), p('b', 30), p('c', 10)]);
    expect(out.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('handles an all-tied room', () => {
    const out = rankPlayers([p('a', 0), p('b', 0), p('c', 0)]);
    expect(out.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it('handles an empty room', () => {
    expect(rankPlayers([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const players = [p('a', 10), p('b', 30)];
    rankPlayers(players);
    expect(players.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
