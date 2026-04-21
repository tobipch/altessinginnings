import { prisma } from "@/lib/db";
import { MARINERS_ABBREVIATION } from "@/lib/mlb-teams";
import { TeamLogo } from "@/components/TeamLogo";

export const dynamic = "force-dynamic";

type H2HRow = {
  teamId: number;
  abbreviation: string;
  city: string;
  name: string;
  gp: number;
  wins: number;
  losses: number;
  pct: number;
  runsFor: number;
  runsAgainst: number;
  runDiff: number;
};

export default async function HeadToHeadPage() {
  const mariners = await prisma.team.findUnique({
    where: { abbreviation: MARINERS_ABBREVIATION },
  });
  if (!mariners) {
    return <p className="text-gray-300">Teams nicht geladen.</p>;
  }

  // All completed Mariners games across all seasons.
  const games = await prisma.game.findMany({
    where: {
      isComplete: true,
      OR: [{ homeTeamId: mariners.id }, { awayTeamId: mariners.id }],
    },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { id: "asc" },
  });

  if (games.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Head-to-Head</h1>
        <p className="text-gray-400">Noch keine Spiele gespielt.</p>
      </div>
    );
  }

  // Aggregate by opponent
  const map = new Map<number, H2HRow>();
  for (const g of games) {
    const marinersHome = g.homeTeamId === mariners.id;
    const opp = marinersHome ? g.awayTeam : g.homeTeam;
    let row = map.get(opp.id);
    if (!row) {
      row = {
        teamId: opp.id,
        abbreviation: opp.abbreviation,
        city: opp.city,
        name: opp.name,
        gp: 0,
        wins: 0,
        losses: 0,
        pct: 0,
        runsFor: 0,
        runsAgainst: 0,
        runDiff: 0,
      };
      map.set(opp.id, row);
    }
    row.gp++;
    const mScore = marinersHome ? g.homeScore : g.awayScore;
    const oScore = marinersHome ? g.awayScore : g.homeScore;
    if (mScore > oScore) row.wins++;
    else row.losses++;
    row.runsFor += mScore;
    row.runsAgainst += oScore;
  }

  const rows = Array.from(map.values());
  for (const r of rows) {
    r.pct = r.gp > 0 ? r.wins / r.gp : 0;
    r.runDiff = r.runsFor - r.runsAgainst;
  }
  rows.sort((a, b) => b.gp - a.gp || b.wins - a.wins);

  const totalGP = rows.reduce((s, r) => s + r.gp, 0);
  const totalW = rows.reduce((s, r) => s + r.wins, 0);
  const totalL = rows.reduce((s, r) => s + r.losses, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Head-to-Head Bilanz</h1>
        <span className="text-sm text-gray-400">
          {totalGP} Spiele · {totalW}W–{totalL}L · {rows.length} Gegner
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-400 border-b border-gray-800">
            <tr>
              <th className="text-left px-2 py-2">Gegner</th>
              <th className="px-2">GP</th>
              <th className="px-2">W</th>
              <th className="px-2">L</th>
              <th className="px-2">PCT</th>
              <th className="px-2">RF</th>
              <th className="px-2">RA</th>
              <th className="px-2">RD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dominant = r.wins > r.losses;
              const struggling = r.losses > r.wins;
              return (
                <tr
                  key={r.teamId}
                  className="border-t border-gray-800 hover:bg-gray-800/40"
                >
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-2">
                      <TeamLogo abbreviation={r.abbreviation} size={22} />
                      <span className="font-mono text-xs text-gray-400">
                        {r.abbreviation}
                      </span>
                      <span className="hidden sm:inline">
                        {r.city} {r.name}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 text-center">{r.gp}</td>
                  <td className="px-2 text-center font-semibold">{r.wins}</td>
                  <td className="px-2 text-center">{r.losses}</td>
                  <td
                    className={`px-2 text-center font-mono ${
                      dominant
                        ? "text-teal-400"
                        : struggling
                        ? "text-rose-400"
                        : ""
                    }`}
                  >
                    {r.pct.toFixed(3).replace(/^0/, "")}
                  </td>
                  <td className="px-2 text-center">{r.runsFor}</td>
                  <td className="px-2 text-center">{r.runsAgainst}</td>
                  <td
                    className={`px-2 text-center ${
                      r.runDiff >= 0 ? "text-teal-400" : "text-rose-400"
                    }`}
                  >
                    {r.runDiff >= 0 ? "+" : ""}
                    {r.runDiff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
