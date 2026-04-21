// Core mechanics of the Altessing-Innings game.

// Normal bottom-half distribution: avg 0.5 runs
export const NORMAL_ROLL = [3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// Altessing-Innings distribution (all values doubled)
export const ALTESSING_ROLL = [6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const REGULAR_INNINGS = 9;
export const ALTESSING_START_INNING = 8; // innings 8 and 9 qualify

/**
 * Altessing-Innings are active for the bottom half if:
 *  - The current inning is one of the last two regulation innings (8 or 9).
 *  - The user (home team) is behind on the scoreboard entering their at-bat.
 */
export function isAltessingBottomHalf(
  inningNumber: number,
  opponentScore: number,
  userScore: number
): boolean {
  if (inningNumber < ALTESSING_START_INNING || inningNumber > REGULAR_INNINGS) {
    return false;
  }
  return userScore < opponentScore;
}

export function rollBottomHalf(isAltessing: boolean): number {
  const table = isAltessing ? ALTESSING_ROLL : NORMAL_ROLL;
  const idx = Math.floor(Math.random() * table.length);
  return table[idx];
}

/**
 * Simulate a random baseball score between two teams.
 * Uses a simple distribution centered around 4 runs.
 */
export function simulateScore(): number {
  // Weighted-ish distribution 0..15
  const r = Math.random();
  if (r < 0.05) return 0;
  if (r < 0.15) return 1;
  if (r < 0.3) return 2;
  if (r < 0.5) return 3;
  if (r < 0.67) return 4;
  if (r < 0.8) return 5;
  if (r < 0.88) return 6;
  if (r < 0.93) return 7;
  if (r < 0.96) return 8;
  if (r < 0.98) return 9;
  if (r < 0.99) return 10;
  return 11 + Math.floor(Math.random() * 5);
}

/**
 * Simulate a game between two CPU teams (no ties).
 */
export function simulateCpuGame(): { home: number; away: number } {
  let home = simulateScore();
  let away = simulateScore();
  while (home === away) {
    // break tie with extra-innings style single run
    if (Math.random() < 0.5) home += 1;
    else away += 1;
  }
  return { home, away };
}

/**
 * Randomly pair a list of team ids into matchups.
 * Returns array of [teamA, teamB] tuples. Assumes even length.
 */
export function randomPairings<T>(items: T[]): [T, T][] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const pairs: [T, T][] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }
  return pairs;
}

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
