import Link from "next/link";
import { prisma } from "@/lib/db";
import { MARINERS_ABBREVIATION } from "@/lib/mlb-teams";
import { TeamLogo } from "@/components/TeamLogo";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const season = await prisma.season.findFirst({ orderBy: { id: "desc" } });
  if (!season) {
    return (
      <div>
        <p className="text-gray-300">Noch keine Saison vorhanden.</p>
        <Link href="/" className="text-teal-300 underline">
          Zur Startseite
        </Link>
      </div>
    );
  }

  const games = await prisma.game.findMany({
    where: { seasonId: season.id, isComplete: true },
    include: {
      homeTeam: true,
      awayTeam: true,
      series: { include: { teamA: true, teamB: true } },
    },
    orderBy: [{ id: "asc" }],
  });

  // Group by stage + round
  type GameWithRel = (typeof games)[number];
  const regularByRound = new Map<number, GameWithRel[]>();
  const playoffsByStage = new Map<string, GameWithRel[]>();

  for (const g of games) {
    if (g.stage === "regular") {
      const arr = regularByRound.get(g.roundNumber) ?? [];
      arr.push(g);
      regularByRound.set(g.roundNumber, arr);
    } else {
      const arr = playoffsByStage.get(g.stage) ?? [];
      arr.push(g);
      playoffsByStage.set(g.stage, arr);
    }
  }

  const regularRounds = Array.from(regularByRound.keys()).sort((a, b) => b - a);
  const playoffStages: Array<[string, string]> = [
    ["worldseries", "World Series"],
    ["championship", "League Championship Series"],
    ["divisional", "Division Series"],
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Resultate — Saison {season.year}</h1>
        <span className="text-sm text-gray-400">
          {games.length} gespielte Spiele insgesamt
        </span>
      </div>

      {playoffStages.map(([stage, label]) => {
        const list = playoffsByStage.get(stage);
        if (!list || list.length === 0) return null;
        return (
          <section key={stage} className="space-y-3">
            <h2 className="text-lg font-semibold text-amber-300">{label}</h2>
            <ResultsList games={list} />
          </section>
        );
      })}

      {regularRounds.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-teal-300">Regular Season</h2>
          <div className="space-y-3">
            {regularRounds.map((round) => (
              <details
                key={round}
                open={round === regularRounds[0]}
                className="border border-gray-800 rounded-lg bg-gray-900/30"
              >
                <summary className="px-4 py-2 cursor-pointer text-sm font-semibold flex items-center justify-between select-none hover:text-teal-300">
                  <span>Spiel-Tag {round}</span>
                  <span className="text-xs text-gray-500 font-normal">
                    {regularByRound.get(round)!.length} Spiele
                  </span>
                </summary>
                <div className="px-2 pb-3">
                  <ResultsList games={regularByRound.get(round)!} compact />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {games.length === 0 && (
        <p className="text-gray-400">Noch keine Spiele gespielt.</p>
      )}
    </div>
  );
}

function ResultsList({
  games,
  compact = false,
}: {
  games: Array<{
    id: number;
    homeTeam: { abbreviation: string; city: string; name: string };
    awayTeam: { abbreviation: string; city: string; name: string };
    homeScore: number;
    awayScore: number;
    isUserGame: boolean;
    stage: string;
    seriesId: number | null;
    roundNumber: number;
  }>;
  compact?: boolean;
}) {
  return (
    <ul className={`divide-y divide-gray-800 ${compact ? "" : "border border-gray-800 rounded-lg overflow-hidden"}`}>
      {games.map((g) => {
        const awayWin = g.awayScore > g.homeScore;
        const isMariners =
          g.homeTeam.abbreviation === MARINERS_ABBREVIATION ||
          g.awayTeam.abbreviation === MARINERS_ABBREVIATION;
        return (
          <li
            key={g.id}
            className={`px-3 py-2 text-sm flex items-center justify-between gap-3 ${
              isMariners ? "bg-mariners-navy/40" : ""
            }`}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <TeamRow
                abbr={g.awayTeam.abbreviation}
                city={g.awayTeam.city}
                name={g.awayTeam.name}
                win={awayWin}
              />
              <span className="text-gray-500 mx-1">@</span>
              <TeamRow
                abbr={g.homeTeam.abbreviation}
                city={g.homeTeam.city}
                name={g.homeTeam.name}
                win={!awayWin}
              />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-sm tabular-nums">
                {g.awayScore} – {g.homeScore}
              </span>
              {g.isUserGame && (
                <Link
                  href={`/game/${g.id}`}
                  className="text-teal-300 underline text-xs"
                >
                  Details
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TeamRow({
  abbr,
  city,
  name,
  win,
}: {
  abbr: string;
  city: string;
  name: string;
  win: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 min-w-0 ${
        win ? "font-semibold" : "text-gray-300"
      }`}
    >
      <TeamLogo abbreviation={abbr} size={20} />
      <span className="font-mono text-xs text-gray-400">{abbr}</span>
      <span className="truncate hidden sm:inline">{city} {name}</span>
    </span>
  );
}
