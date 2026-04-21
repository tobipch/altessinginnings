import { prisma } from "./db";

export type StandingRow = {
  teamId: number;
  abbreviation: string;
  city: string;
  name: string;
  league: string;
  division: string;
  wins: number;
  losses: number;
  pct: number;
  gb: number;
  runsFor: number;
  runsAgainst: number;
  runDiff: number;
};

export async function getStandings(seasonId: number): Promise<StandingRow[]> {
  const stats = await prisma.teamSeasonStats.findMany({
    where: { seasonId },
    include: { team: true },
  });

  const rows: StandingRow[] = stats.map((s) => {
    const total = s.wins + s.losses;
    const pct = total === 0 ? 0 : s.wins / total;
    return {
      teamId: s.teamId,
      abbreviation: s.team.abbreviation,
      city: s.team.city,
      name: s.team.name,
      league: s.team.league,
      division: s.team.division,
      wins: s.wins,
      losses: s.losses,
      pct,
      gb: 0,
      runsFor: s.runsFor,
      runsAgainst: s.runsAgainst,
      runDiff: s.runsFor - s.runsAgainst,
    };
  });

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.runDiff - a.runDiff;
  });

  return rows;
}

export function groupByDivision(
  rows: StandingRow[]
): Record<string, Record<string, StandingRow[]>> {
  const grouped: Record<string, Record<string, StandingRow[]>> = {
    AL: { East: [], Central: [], West: [] },
    NL: { East: [], Central: [], West: [] },
  };
  for (const r of rows) {
    grouped[r.league][r.division].push(r);
  }
  for (const league of Object.keys(grouped)) {
    for (const div of Object.keys(grouped[league])) {
      const list = grouped[league][div];
      list.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
      const leader = list[0];
      if (leader) {
        for (const t of list) {
          t.gb = ((leader.wins - t.wins) + (t.losses - leader.losses)) / 2;
        }
      }
    }
  }
  return grouped;
}

/**
 * Compute current win/loss streak and last-10 record from a list of
 * completed user games (sorted by id ASC, i.e. oldest first).
 * Mariners are always the home team.
 */
export function calcStreakAndLastTen(
  games: Array<{ homeScore: number; awayScore: number }>
): { streak: string; lastTenWins: number; lastTenLosses: number } {
  if (games.length === 0) {
    return { streak: "—", lastTenWins: 0, lastTenLosses: 0 };
  }

  // Work from most recent to oldest
  const reversed = [...games].reverse();

  // Streak: count consecutive same result from most recent
  const firstWin = reversed[0].homeScore > reversed[0].awayScore;
  let streakCount = 0;
  for (const g of reversed) {
    const won = g.homeScore > g.awayScore;
    if (won === firstWin) streakCount++;
    else break;
  }
  const streak = `${firstWin ? "W" : "L"}${streakCount}`;

  // Last 10
  const lastTen = reversed.slice(0, 10);
  const lastTenWins = lastTen.filter((g) => g.homeScore > g.awayScore).length;
  const lastTenLosses = lastTen.length - lastTenWins;

  return { streak, lastTenWins, lastTenLosses };
}

/**
 * Return the top N teams per league by record (used for playoff seeding).
 */
export function topTeamsPerLeague(
  rows: StandingRow[],
  n: number
): Record<"AL" | "NL", StandingRow[]> {
  const al = rows.filter((r) => r.league === "AL").slice(0, n);
  const nl = rows.filter((r) => r.league === "NL").slice(0, n);
  return { AL: al, NL: nl };
}

/**
 * Get top 2 from each division, seeded by overall record within the league.
 * Returns 6 teams per league: 3 division winners + 3 runners-up, sorted by
 * overall record. Division winners are seeded 1-3, runners-up are seeded 4-6.
 */
export function playoffTeamsPerLeague(
  rows: StandingRow[]
): Record<"AL" | "NL", StandingRow[]> {
  const result: Record<"AL" | "NL", StandingRow[]> = { AL: [], NL: [] };

  for (const league of ["AL", "NL"] as const) {
    const divWinners: StandingRow[] = [];
    const divRunners: StandingRow[] = [];

    for (const div of ["East", "Central", "West"]) {
      const divTeams = rows
        .filter((r) => r.league === league && r.division === div)
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.runDiff - a.runDiff);
      if (divTeams.length >= 1) divWinners.push(divTeams[0]);
      if (divTeams.length >= 2) divRunners.push(divTeams[1]);
    }

    divWinners.sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.runDiff - a.runDiff);
    divRunners.sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.runDiff - a.runDiff);

    result[league] = [...divWinners, ...divRunners];
  }

  return result;
}
