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

/**
 * Estimate Mariners' (home team) win probability given current game state.
 *
 * Heuristic model inspired by real baseball win-expectancy tables but tuned
 * for the Altessing-Innings custom scoring (avg 0.5 runs/inning, with the
 * doubled pool in late innings when behind).
 *
 * @param homeScore     Mariners runs so far
 * @param awayScore     Opponent runs so far
 * @param fullInnings   Number of fully completed innings (both halves done)
 * @param isTopDone     True if top of current inning is done but bottom pending
 * @param totalInnings  Regulation innings (normally 9)
 */
export function calcWinProbability(
  homeScore: number,
  awayScore: number,
  fullInnings: number,
  isTopDone: boolean,
  totalInnings: number = REGULAR_INNINGS
): number {
  const diff = homeScore - awayScore;
  const inningsLeft = Math.max(0, totalInnings - fullInnings);
  const halfInningsLeft = inningsLeft * 2 - (isTopDone ? 1 : 0);

  if (halfInningsLeft <= 0) {
    // Game essentially over (regulation done)
    if (diff > 0) return 0.98;
    if (diff < 0) return 0.02;
    return 0.5;
  }

  // Expected runs per remaining half-inning for the home team:
  //  - Normal pool averages 0.5 runs
  //  - In innings 8 & 9, if behind, Altessing doubles it to ~1.0
  // For the opponent (top half), we assume similar ~0.5 avg.
  // Net expected swing per full remaining inning ≈ 0 (symmetric).
  //
  // We use a logistic-style model: probability = sigmoid(k * diff / sqrt(halfInningsLeft))
  // The k factor controls how decisive each run of lead is.
  // With ~0.5 runs/half-inning variance, k ≈ 1.2 gives good spread.
  const k = 1.2;
  const z = (k * diff) / Math.sqrt(halfInningsLeft);

  // Altessing boost: if home is behind and we're in the last ~2 innings,
  // the doubled pool makes comebacks more likely. Shift z upward slightly.
  let altessingBoost = 0;
  if (diff < 0 && fullInnings >= ALTESSING_START_INNING - 1) {
    altessingBoost = 0.3 * Math.min(Math.abs(diff), 4);
  }

  const raw = 1 / (1 + Math.exp(-(z + altessingBoost)));

  // Clamp to [2%, 98%]
  return Math.max(0.02, Math.min(0.98, raw));
}
