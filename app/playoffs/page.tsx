import Link from "next/link";
import { prisma } from "@/lib/db";
import { PLAYOFF_WINS_NEEDED, MARINERS_ABBREVIATION } from "@/lib/mlb-teams";
import { TeamLogo } from "@/components/TeamLogo";

export const dynamic = "force-dynamic";

type SeriesWithTeams = {
  id: number;
  round: string;
  league: string | null;
  teamAId: number;
  teamBId: number;
  teamAWins: number;
  teamBWins: number;
  winnerId: number | null;
  isComplete: boolean;
  teamA: { id: number; abbreviation: string; city: string; name: string };
  teamB: { id: number; abbreviation: string; city: string; name: string };
};

type Bracket = {
  al: { ds: SeriesWithTeams[]; lcs: SeriesWithTeams | null };
  nl: { ds: SeriesWithTeams[]; lcs: SeriesWithTeams | null };
  ws: SeriesWithTeams | null;
};

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

  if (series.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Playoffs — Saison {season.year}</h1>
        <p className="text-gray-400">
          Playoffs wurden noch nicht gestartet. Beende zuerst die Regular Season.
        </p>
      </div>
    );
  }

  const bracket: Bracket = {
    al: {
      ds: series.filter((s) => s.round === "divisional" && s.league === "AL"),
      lcs: series.find((s) => s.round === "championship" && s.league === "AL") ?? null,
    },
    nl: {
      ds: series.filter((s) => s.round === "divisional" && s.league === "NL"),
      lcs: series.find((s) => s.round === "championship" && s.league === "NL") ?? null,
    },
    ws: series.find((s) => s.round === "worldseries") ?? null,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Playoffs — Saison {season.year}</h1>
        <span className="text-xs text-gray-400 uppercase tracking-wider">
          First to {PLAYOFF_WINS_NEEDED}
        </span>
      </div>

      {/* Desktop bracket */}
      <div className="hidden md:grid grid-cols-5 gap-x-3 gap-y-4 items-center min-h-[500px]">
        {/* Column 1: AL Division Series */}
        <div className="flex flex-col justify-around h-full gap-12">
          {bracket.al.ds.map((s) => (
            <MatchupCard key={s.id} series={s} label="AL DS" />
          ))}
        </div>

        {/* Column 2: AL LCS */}
        <div className="flex items-center justify-center h-full">
          {bracket.al.lcs ? (
            <MatchupCard series={bracket.al.lcs} label="ALCS" />
          ) : (
            <PendingCard label="ALCS" />
          )}
        </div>

        {/* Column 3: World Series */}
        <div className="flex items-center justify-center h-full">
          {bracket.ws ? (
            <MatchupCard series={bracket.ws} label="World Series" highlight />
          ) : (
            <PendingCard label="World Series" />
          )}
        </div>

        {/* Column 4: NL LCS */}
        <div className="flex items-center justify-center h-full">
          {bracket.nl.lcs ? (
            <MatchupCard series={bracket.nl.lcs} label="NLCS" />
          ) : (
            <PendingCard label="NLCS" />
          )}
        </div>

        {/* Column 5: NL Division Series */}
        <div className="flex flex-col justify-around h-full gap-12">
          {bracket.nl.ds.map((s) => (
            <MatchupCard key={s.id} series={s} label="NL DS" />
          ))}
        </div>
      </div>

      {/* Mobile layout: stacked */}
      <div className="md:hidden space-y-6">
        <Section label="AL Division Series" list={bracket.al.ds} />
        <Section label="ALCS" list={bracket.al.lcs ? [bracket.al.lcs] : []} pending={!bracket.al.lcs} />
        <Section label="World Series" list={bracket.ws ? [bracket.ws] : []} pending={!bracket.ws} highlight />
        <Section label="NLCS" list={bracket.nl.lcs ? [bracket.nl.lcs] : []} pending={!bracket.nl.lcs} />
        <Section label="NL Division Series" list={bracket.nl.ds} />
      </div>
    </div>
  );
}

function Section({
  label,
  list,
  pending = false,
  highlight = false,
}: {
  label: string;
  list: SeriesWithTeams[];
  pending?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className={`text-sm font-semibold ${highlight ? "text-amber-300" : "text-teal-300"}`}>
        {label}
      </h3>
      {list.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((s) => (
            <MatchupCard key={s.id} series={s} label={label} highlight={highlight} />
          ))}
        </div>
      ) : pending ? (
        <PendingCard label={label} />
      ) : null}
    </div>
  );
}

function MatchupCard({
  series,
  label,
  highlight = false,
}: {
  series: SeriesWithTeams;
  label: string;
  highlight?: boolean;
}) {
  const isMariners = (id: number) =>
    series.teamA.abbreviation === MARINERS_ABBREVIATION && id === series.teamAId ||
    series.teamB.abbreviation === MARINERS_ABBREVIATION && id === series.teamBId;

  return (
    <div
      className={`rounded-lg p-3 border ${
        highlight
          ? "border-amber-500/50 bg-amber-500/5"
          : "border-gray-700 bg-gray-900/60"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        {label} · {series.teamAWins + series.teamBWins} game{series.teamAWins + series.teamBWins !== 1 ? "s" : ""}
      </div>
      <TeamRow
        team={series.teamA}
        wins={series.teamAWins}
        isWinner={series.winnerId === series.teamAId}
        isMariners={isMariners(series.teamAId)}
      />
      <TeamRow
        team={series.teamB}
        wins={series.teamBWins}
        isWinner={series.winnerId === series.teamBId}
        isMariners={isMariners(series.teamBId)}
      />
    </div>
  );
}

function TeamRow({
  team,
  wins,
  isWinner,
  isMariners,
}: {
  team: { abbreviation: string; city: string; name: string };
  wins: number;
  isWinner: boolean;
  isMariners: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 ${
        isWinner ? "text-teal-300 font-bold" : isMariners ? "text-white" : "text-gray-300"
      }`}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <TeamLogo abbreviation={team.abbreviation} size={20} />
        <span className="font-mono text-xs">{team.abbreviation}</span>
        <span className="truncate text-sm hidden sm:inline">
          {team.name}
        </span>
      </span>
      <span className="font-mono text-lg ml-2">{wins}</span>
    </div>
  );
}

function PendingCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg p-3 border border-gray-800 border-dashed bg-gray-900/20 text-center">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-gray-600 text-sm mt-1">TBD</div>
    </div>
  );
}
