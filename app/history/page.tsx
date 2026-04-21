import Link from "next/link";
import { prisma } from "@/lib/db";
import { MARINERS_ABBREVIATION } from "@/lib/mlb-teams";
import { TeamLogo } from "@/components/TeamLogo";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const season = await prisma.season.findFirst({ orderBy: { id: "desc" } });
  if (!season) {
    return (
      <div>
        <p className="text-gray-300">Noch keine Saison vorhanden.</p>
        <Link href="/" className="text-teal-300 underline">Zur Startseite</Link>
      </div>
    );
  }

  const mariners = await prisma.team.findUnique({
    where: { abbreviation: MARINERS_ABBREVIATION },
  });
  if (!mariners) {
    return <p className="text-gray-300">Teams nicht geladen.</p>;
  }

  const games = await prisma.game.findMany({
    where: {
      seasonId: season.id,
      isComplete: true,
      OR: [{ homeTeamId: mariners.id }, { awayTeamId: mariners.id }],
    },
    include: {
      homeTeam: true,
      awayTeam: true,
      innings: { orderBy: { inningNumber: "asc" } },
    },
    orderBy: { id: "asc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        Mariners Spielverlauf — Saison {season.year}
      </h1>

      {games.length === 0 ? (
        <p className="text-gray-400">Noch keine Spiele gespielt.</p>
      ) : (
        <div className="space-y-3">
          {games.map((g) => {
            const marinersHome = g.homeTeam.abbreviation === MARINERS_ABBREVIATION;
            const marinersScore = marinersHome ? g.homeScore : g.awayScore;
            const opponentScore = marinersHome ? g.awayScore : g.homeScore;
            const win = marinersScore > opponentScore;
            const opponent = marinersHome ? g.awayTeam : g.homeTeam;
            return (
              <div
                key={g.id}
                className="border border-gray-800 rounded-lg bg-gray-900/40 p-4"
              >
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-xs text-gray-400 mr-2">
                      {g.stage === "regular" ? `Spiel ${g.roundNumber}` : stageLabel(g.stage)}
                    </span>
                    <span className="font-semibold inline-flex items-center gap-2">
                      vs <TeamLogo abbreviation={opponent.abbreviation} size={22} />
                      {opponent.city} {opponent.name}
                    </span>
                  </div>
                  <div className="font-mono">
                    {marinersScore} – {opponentScore}{" "}
                    {g.isComplete && (
                      <span
                        className={
                          win ? "text-teal-400 ml-2" : "text-rose-400 ml-2"
                        }
                      >
                        {win ? "W" : "L"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto mt-2">
                  <table className="scoreboard text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th></th>
                        {g.innings.map((i) => (
                          <th key={i.inningNumber}>{i.inningNumber}</th>
                        ))}
                        <th>R</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{g.awayTeam.abbreviation}</td>
                        {g.innings.map((i) => (
                          <td key={i.inningNumber}>{i.topScore}</td>
                        ))}
                        <td className="font-bold">{g.awayScore}</td>
                      </tr>
                      <tr>
                        <td>{g.homeTeam.abbreviation}</td>
                        {g.innings.map((i) => (
                          <td
                            key={i.inningNumber}
                            className={i.isAltessing ? "altessing" : ""}
                          >
                            {i.bottomScore ?? ""}
                          </td>
                        ))}
                        <td className="font-bold">{g.homeScore}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!g.isComplete && (
                  <div className="mt-2">
                    <Link
                      href={`/game/${g.id}`}
                      className="text-teal-300 underline text-sm"
                    >
                      Spiel fortsetzen →
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function stageLabel(s: string) {
  switch (s) {
    case "wildcard":
      return "Wild Card";
    case "divisional":
      return "Division Series";
    case "championship":
      return "LCS";
    case "worldseries":
      return "World Series";
    default:
      return s;
  }
}
