import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
import {
  createSeason,
  ensureCurrentUserGame,
  simulateRestOfPlayoffs,
} from "@/lib/actions";
import { redirect } from "next/navigation";
import { REGULAR_SEASON_GAMES, MARINERS_ABBREVIATION } from "@/lib/mlb-teams";

async function playCurrentGame(formData: FormData) {
  "use server";
  const seasonId = Number(formData.get("seasonId"));
  const gameId = await ensureCurrentUserGame(seasonId);
  redirect(`/game/${gameId}`);
}

async function newSeason() {
  "use server";
  const id = await createSeason();
  redirect(`/?seasonId=${id}`);
}

async function simulateRest(formData: FormData) {
  "use server";
  const seasonId = Number(formData.get("seasonId"));
  await simulateRestOfPlayoffs(seasonId);
  redirect("/");
}

export default async function Home() {
  const season = await prisma.season.findFirst({
    orderBy: { id: "desc" },
    include: {
      games: {
        where: { isUserGame: true },
        orderBy: { id: "desc" },
        include: { homeTeam: true, awayTeam: true },
        take: 5,
      },
    },
  });

  const mariners = await prisma.team.findUnique({
    where: { abbreviation: MARINERS_ABBREVIATION },
  });

  // Team count check (did seed run?)
  const teamCount = await prisma.team.count();

  if (teamCount === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Setup benötigt</h1>
        <p className="text-gray-300">
          Es sind noch keine MLB-Teams in der Datenbank. Führe einmalig aus:
        </p>
        <pre className="bg-gray-900 p-3 rounded text-sm overflow-x-auto">
{`npx prisma db push
npm run db:seed`}
        </pre>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="space-y-6">
        <div className="bg-mariners-navy/50 border border-mariners-teal/40 rounded-xl p-6">
          <h1 className="text-3xl font-bold mb-2">Willkommen, Mariners!</h1>
          <p className="text-gray-300 mb-4">
            Noch keine Saison gestartet. Starte eine neue 20-Spiele Regular Season
            und spiele dich zum World-Series-Titel.
          </p>
          <form action={newSeason}>
            <button
              type="submit"
              className="bg-teal-500 hover:bg-teal-400 text-black font-semibold px-5 py-2 rounded-md"
            >
              Neue Saison starten
            </button>
          </form>
        </div>
      </div>
    );
  }

  const marinersStats = mariners
    ? await prisma.teamSeasonStats.findUnique({
        where: { seasonId_teamId: { seasonId: season.id, teamId: mariners.id } },
      })
    : null;

  const marinersEliminated = await isMarinersEliminated(season.id);
  const currentUserGame = await prisma.game.findFirst({
    where: { seasonId: season.id, isUserGame: true, isComplete: false },
  });

  return (
    <div className="space-y-6">
      <div className="bg-mariners-navy/50 border border-mariners-teal/40 rounded-xl p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold">Saison {season.year}</h1>
          <span className="text-sm uppercase tracking-wider text-teal-300">
            {season.status === "regular"
              ? `Regular Season — Spiel ${season.currentRound} / ${REGULAR_SEASON_GAMES}`
              : season.status === "playoffs"
              ? "Playoffs"
              : "Abgeschlossen"}
          </span>
        </div>
        {marinersStats && (
          <p className="text-sm text-gray-300 mt-1">
            Mariners Bilanz: <b>{marinersStats.wins}</b>–<b>{marinersStats.losses}</b>
            {marinersStats.wins + marinersStats.losses > 0 &&
              ` (${(marinersStats.wins / (marinersStats.wins + marinersStats.losses)).toFixed(3).replace(/^0/, "")})`}
          </p>
        )}

        <div className="mt-5 flex gap-3 flex-wrap">
          {season.status !== "complete" && !marinersEliminated && (
            <form action={playCurrentGame}>
              <input type="hidden" name="seasonId" value={season.id} />
              <button
                type="submit"
                className="bg-teal-500 hover:bg-teal-400 text-black font-semibold px-5 py-2 rounded-md"
              >
                {currentUserGame
                  ? "Aktuelles Spiel fortsetzen →"
                  : season.status === "regular"
                  ? `Spiel ${season.currentRound} starten →`
                  : "Nächstes Playoff-Spiel →"}
              </button>
            </form>
          )}

          {season.status === "playoffs" && marinersEliminated && (
            <form action={simulateRest}>
              <input type="hidden" name="seasonId" value={season.id} />
              <button
                type="submit"
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-md"
              >
                Restliche Playoffs simulieren
              </button>
            </form>
          )}

          {season.status === "complete" && (
            <form action={newSeason}>
              <button
                type="submit"
                className="bg-teal-500 hover:bg-teal-400 text-black font-semibold px-5 py-2 rounded-md"
              >
                Nächste Saison starten
              </button>
            </form>
          )}

          <Link
            href="/standings"
            className="px-4 py-2 rounded-md border border-gray-700 hover:border-teal-400"
          >
            Standings ansehen
          </Link>
          <Link
            href="/history"
            className="px-4 py-2 rounded-md border border-gray-700 hover:border-teal-400"
          >
            Spielverlauf
          </Link>
        </div>
      </div>

      {season.games.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Letzte Mariners-Spiele</h2>
          <ul className="divide-y divide-gray-800 border border-gray-800 rounded-lg overflow-hidden">
            {season.games.map((g) => {
              const win = g.homeScore > g.awayScore;
              return (
                <li
                  key={g.id}
                  className="px-4 py-2 flex items-center justify-between text-sm"
                >
                  <div>
                    <span className="font-mono">
                      {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                    </span>
                    <span className="ml-3 text-gray-400">{g.stage}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">
                      {g.awayScore} – {g.homeScore}
                    </span>
                    {g.isComplete ? (
                      <span
                        className={
                          win
                            ? "text-teal-400 font-semibold"
                            : "text-rose-400 font-semibold"
                        }
                      >
                        {win ? "W" : "L"}
                      </span>
                    ) : (
                      <Link
                        href={`/game/${g.id}`}
                        className="text-teal-300 underline"
                      >
                        fortsetzen
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

async function isMarinersEliminated(seasonId: number): Promise<boolean> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || season.status !== "playoffs") return false;

  const mariners = await prisma.team.findUnique({
    where: { abbreviation: MARINERS_ABBREVIATION },
  });
  if (!mariners) return false;

  const series = await prisma.playoffSeries.findMany({
    where: {
      seasonId,
      OR: [{ teamAId: mariners.id }, { teamBId: mariners.id }],
    },
  });
  if (series.length === 0) return true; // didn't qualify
  const latest = series[series.length - 1];
  if (latest.isComplete && latest.winnerId !== mariners.id) return true;
  return false;
}
