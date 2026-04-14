import Link from "next/link";
import { prisma } from "@/lib/db";
import { PLAYOFF_WINS_NEEDED } from "@/lib/mlb-teams";
import { TeamLogo } from "@/components/TeamLogo";

export const dynamic = "force-dynamic";

const ROUND_ORDER = ["divisional", "championship", "worldseries"] as const;

export default async function PlayoffsPage() {
  const season = await prisma.season.findFirst({ orderBy: { id: "desc" } });
  if (!season) {
    return (
      <div>
        <p className="text-gray-300">Noch keine Saison vorhanden.</p>
        <Link href="/" className="text-teal-300 underline">Zur Startseite</Link>
      </div>
    );
  }

  const series = await prisma.playoffSeries.findMany({
    where: { seasonId: season.id },
    include: { teamA: true, teamB: true },
    orderBy: { id: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Playoffs — Saison {season.year}</h1>

      {series.length === 0 ? (
        <p className="text-gray-400">
          Playoffs wurden noch nicht gestartet. Beende zuerst die Regular Season.
        </p>
      ) : (
        <div className="space-y-8">
          {ROUND_ORDER.map((round) => {
            const list = series.filter((s) => s.round === round);
            if (list.length === 0) return null;
            return (
              <section key={round} className="space-y-3">
                <h2 className="text-lg font-semibold text-teal-300">
                  {roundLabel(round)}
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {list.map((s) => (
                    <div
                      key={s.id}
                      className="border border-gray-800 rounded-lg bg-gray-900/40 p-4"
                    >
                      <div className="text-xs uppercase text-gray-400 mb-1">
                        {s.league ?? "World Series"} · Best-of-{PLAYOFF_WINS_NEEDED * 2 - 1} (First to {PLAYOFF_WINS_NEEDED})
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex items-center gap-2 ${
                            s.winnerId === s.teamAId
                              ? "font-bold text-teal-300"
                              : ""
                          }`}
                        >
                          <TeamLogo abbreviation={s.teamA.abbreviation} size={24} />
                          {s.teamA.city} {s.teamA.name}
                        </span>
                        <span className="font-mono">{s.teamAWins}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex items-center gap-2 ${
                            s.winnerId === s.teamBId
                              ? "font-bold text-teal-300"
                              : ""
                          }`}
                        >
                          <TeamLogo abbreviation={s.teamB.abbreviation} size={24} />
                          {s.teamB.city} {s.teamB.name}
                        </span>
                        <span className="font-mono">{s.teamBWins}</span>
                      </div>
                      {s.isComplete && s.winnerId && (
                        <div className="mt-2 text-xs text-teal-300">
                          Sieger:{" "}
                          {s.winnerId === s.teamAId
                            ? `${s.teamA.city} ${s.teamA.name}`
                            : `${s.teamB.city} ${s.teamB.name}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function roundLabel(r: string) {
  switch (r) {
    case "divisional":
      return "Division Series";
    case "championship":
      return "League Championship Series";
    case "worldseries":
      return "World Series";
    default:
      return r;
  }
}
