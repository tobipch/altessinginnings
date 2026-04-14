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
