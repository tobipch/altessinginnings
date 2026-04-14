import Link from "next/link";
import { prisma } from "@/lib/db";
import { getStandings, groupByDivision } from "@/lib/standings";
import { MARINERS_ABBREVIATION } from "@/lib/mlb-teams";

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const season = await prisma.season.findFirst({ orderBy: { id: "desc" } });
  if (!season) {
    return (
      <div>
        <p className="text-gray-300">Noch keine Saison vorhanden.</p>
        <Link href="/" className="text-teal-300 underline">Zur Startseite</Link>
      </div>
    );
  }

  const rows = await getStandings(season.id);
  const grouped = groupByDivision(rows);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Standings — Saison {season.year}</h1>

      {(["AL", "NL"] as const).map((league) => (
        <div key={league} className="space-y-4">
          <h2 className="text-lg font-semibold text-teal-300">
            {league === "AL" ? "American League" : "National League"}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {(["East", "Central", "West"] as const).map((div) => (
              <DivisionCard
                key={div}
                title={`${league} ${div}`}
                teams={grouped[league][div]}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DivisionCard({
  title,
  teams,
}: {
  title: string;
  teams: Awaited<ReturnType<typeof getStandings>>;
}) {
  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/40">
      <div className="px-3 py-2 border-b border-gray-800 font-semibold text-sm">
        {title}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-400">
          <tr>
            <th className="text-left px-2 py-1">Team</th>
            <th className="px-1">W</th>
            <th className="px-1">L</th>
            <th className="px-1">PCT</th>
            <th className="px-1">GB</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const highlight = t.abbreviation === MARINERS_ABBREVIATION;
            return (
              <tr
                key={t.teamId}
                className={highlight ? "bg-mariners-navy/60" : ""}
              >
                <td className="px-2 py-1">
                  <span className="font-mono text-xs text-gray-400 mr-2">
                    {t.abbreviation}
                  </span>
                  {t.city} {t.name}
                </td>
                <td className="text-center px-1">{t.wins}</td>
                <td className="text-center px-1">{t.losses}</td>
                <td className="text-center px-1 font-mono">
                  {(t.pct).toFixed(3).replace(/^0/, "")}
                </td>
                <td className="text-center px-1">
                  {t.gb === 0 ? "—" : t.gb.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
