import Link from "next/link";
import { prisma } from "@/lib/db";
import { MARINERS_ABBREVIATION } from "@/lib/mlb-teams";
import { TeamLogo } from "@/components/TeamLogo";

export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const mariners = await prisma.team.findUnique({
    where: { abbreviation: MARINERS_ABBREVIATION },
  });
  if (!mariners) {
    return <p className="text-gray-300">Teams nicht geladen. Bitte /api/seed aufrufen.</p>;
  }

  const allSeasons = await prisma.season.findMany({ orderBy: { year: "asc" } });
  const completedSeasons = allSeasons.filter((s) => s.status === "complete");

  const allStats = await prisma.teamSeasonStats.findMany({
    where: { teamId: mariners.id },
    include: { season: true },
    orderBy: { seasonId: "asc" },
  });

  const allUserGames = await prisma.game.findMany({
    where: { isUserGame: true, isComplete: true },
    include: {
      innings: { where: { isAltessing: true } },
      awayTeam: true,
    },
    orderBy: { id: "asc" },
  });

  const worldSeriesTitles = await prisma.playoffSeries.count({
    where: {
      round: "worldseries",
      isComplete: true,
      winnerId: mariners.id,
    },
  });

  // Aggregate stats
  const totalWins = allStats.reduce((s, r) => s + r.wins, 0);
  const totalLosses = allStats.reduce((s, r) => s + r.losses, 0);
  const totalRF = allStats.reduce((s, r) => s + r.runsFor, 0);
  const totalRA = allStats.reduce((s, r) => s + r.runsAgainst, 0);
  const totalPct =
    totalWins + totalLosses > 0
      ? (totalWins / (totalWins + totalLosses)).toFixed(3).replace(/^0/, "")
      : ".000";

  const bestSeason = allStats.length > 0
    ? allStats.reduce((best, r) => (r.wins > best.wins ? r : best))
    : null;
  const worstCompletedSeason = allStats.filter((s) =>
    completedSeasons.some((cs) => cs.id === s.seasonId)
  );
  const worstSeason = worstCompletedSeason.length > 0
    ? worstCompletedSeason.reduce((w, r) => (r.wins < w.wins ? r : w))
    : null;

  // Biggest win (max run diff in user games)
  let biggestWin: (typeof allUserGames)[number] | null = null;
  let biggestWinDiff = 0;
  for (const g of allUserGames) {
    const diff = g.homeScore - g.awayScore;
    if (diff > biggestWinDiff) {
      biggestWinDiff = diff;
      biggestWin = g;
    }
  }

  // Altessing stats
  const allAltessingInnings = await prisma.inning.findMany({
    where: { isAltessing: true },
  });
  const altessingTotal = allAltessingInnings.length;
  const altessingWithRuns = allAltessingInnings.filter(
    (i) => (i.bottomScore ?? 0) > 0
  ).length;
  const altessingPct =
    altessingTotal > 0
      ? Math.round((altessingWithRuns / altessingTotal) * 100)
      : 0;

  // Biggest Altessing comeback: games where Mariners were behind in inning 8+
  // and ultimately won.
  let biggestComeback: { game: (typeof allUserGames)[number]; deficit: number } | null = null;
  for (const g of allUserGames) {
    if (g.homeScore <= g.awayScore) continue; // didn't win
    if (g.innings.length === 0) continue; // no altessing innings
    // Find max deficit entering any altessing inning
    const gameInnings = await prisma.inning.findMany({
      where: { gameId: g.id },
      orderBy: { inningNumber: "asc" },
    });
    let runningHome = 0;
    let runningAway = 0;
    let maxDeficit = 0;
    for (const inn of gameInnings) {
      runningAway += inn.topScore;
      if (inn.isAltessing) {
        const deficit = runningAway - runningHome;
        if (deficit > maxDeficit) maxDeficit = deficit;
      }
      runningHome += inn.bottomScore ?? 0;
    }
    if (maxDeficit > 0 && (!biggestComeback || maxDeficit > biggestComeback.deficit)) {
      biggestComeback = { game: g, deficit: maxDeficit };
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Franchise Records</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Saisons gespielt"
          value={String(allSeasons.length)}
          sub={`${completedSeasons.length} abgeschlossen`}
        />
        <StatCard
          label="All-Time Bilanz"
          value={`${totalWins}–${totalLosses}`}
          sub={`PCT ${totalPct} · RD ${totalRF - totalRA >= 0 ? "+" : ""}${totalRF - totalRA}`}
        />
        <StatCard
          label="World Series Titel"
          value={String(worldSeriesTitles)}
          sub={worldSeriesTitles > 0 ? "🏆" : "—"}
          highlight={worldSeriesTitles > 0}
        />
        {bestSeason && (
          <StatCard
            label="Beste Saison"
            value={`${bestSeason.wins}–${bestSeason.losses}`}
            sub={`Saison ${bestSeason.season.year}`}
          />
        )}
        {worstSeason && (
          <StatCard
            label="Schlechteste Saison"
            value={`${worstSeason.wins}–${worstSeason.losses}`}
            sub={`Saison ${worstSeason.season.year}`}
          />
        )}
        {biggestWin && (
          <StatCard
            label="Grösster Sieg"
            value={`+${biggestWinDiff} Runs`}
            sub={`${biggestWin.homeScore}–${biggestWin.awayScore} vs ${biggestWin.awayTeam.abbreviation}`}
          />
        )}
        <StatCard
          label="Altessing Aktivierungen"
          value={String(altessingTotal)}
          sub={`${altessingWithRuns}× Runs erzielt (${altessingPct}%)`}
        />
        {biggestComeback && (
          <StatCard
            label="Grösstes Altessing-Comeback"
            value={`${biggestComeback.deficit} Runs Rückstand`}
            sub={`${biggestComeback.game.homeScore}–${biggestComeback.game.awayScore} vs ${biggestComeback.game.awayTeam.abbreviation}`}
            highlight
          />
        )}
        <StatCard
          label="Spiele gespielt (User)"
          value={String(allUserGames.length)}
          sub={`${allUserGames.filter((g) => g.homeScore > g.awayScore).length} Siege`}
        />
      </div>

      {allStats.length > 1 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Saison-Übersicht</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400">
                <tr>
                  <th className="text-left px-2 py-1">Jahr</th>
                  <th className="px-2">W</th>
                  <th className="px-2">L</th>
                  <th className="px-2">PCT</th>
                  <th className="px-2">RF</th>
                  <th className="px-2">RA</th>
                  <th className="px-2">RD</th>
                  <th className="text-left px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {allStats.map((s) => {
                  const total = s.wins + s.losses;
                  const pct = total > 0 ? (s.wins / total).toFixed(3).replace(/^0/, "") : ".000";
                  const rd = s.runsFor - s.runsAgainst;
                  return (
                    <tr key={s.id} className="border-t border-gray-800">
                      <td className="px-2 py-1 font-mono">{s.season.year}</td>
                      <td className="px-2 text-center">{s.wins}</td>
                      <td className="px-2 text-center">{s.losses}</td>
                      <td className="px-2 text-center font-mono">{pct}</td>
                      <td className="px-2 text-center">{s.runsFor}</td>
                      <td className="px-2 text-center">{s.runsAgainst}</td>
                      <td className={`px-2 text-center ${rd >= 0 ? "text-teal-400" : "text-rose-400"}`}>
                        {rd >= 0 ? "+" : ""}{rd}
                      </td>
                      <td className="px-2 text-xs text-gray-400">{s.season.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        highlight
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-gray-800 bg-gray-900/40"
      }`}
    >
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-bold font-mono mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
