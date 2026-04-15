import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
import {
  adjustInningScore,
  finishUserGame,
  rollBottomHalfAction,
  submitTopHalf,
} from "@/lib/actions";
import { TeamLogo } from "@/components/TeamLogo";
import { SubmitButton } from "@/components/SubmitButton";
import {
  ALTESSING_ROLL,
  ALTESSING_START_INNING,
  NORMAL_ROLL,
  REGULAR_INNINGS,
  isAltessingBottomHalf,
} from "@/lib/game-logic";

async function submitTopHalfAction(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("gameId"));
  const inning = Number(formData.get("inning"));
  const runs = Number(formData.get("runs"));
  await submitTopHalf(gameId, inning, runs);
}

async function rollBottom(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("gameId"));
  const inning = Number(formData.get("inning"));
  await rollBottomHalfAction(gameId, inning);
}

async function finishGame(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("gameId"));
  await finishUserGame(gameId);
  redirect("/");
}

async function adjustScore(formData: FormData) {
  "use server";
  const gameId = Number(formData.get("gameId"));
  const inning = Number(formData.get("inning"));
  const field = String(formData.get("field")) as "top" | "bottom";
  const runs = Number(formData.get("runs"));
  await adjustInningScore(gameId, inning, field, runs);
}

export default async function GamePage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!id) notFound();

  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      homeTeam: true,
      awayTeam: true,
      innings: { orderBy: { inningNumber: "asc" } },
      series: { include: { teamA: true, teamB: true } },
    },
  });
  if (!game) notFound();

  const innings = game.innings;

  // Determine what state we're in
  // "need_top" = need opponent top-half runs for inning N
  // "need_bottom" = need to roll bottom half for inning N
  // "done" = game can be finished
  let currentInning = innings.length === 0 ? 1 : innings[innings.length - 1].inningNumber;
  let state: "need_top" | "need_bottom" | "done" = "need_top";
  const last = innings[innings.length - 1];
  if (!last) {
    state = "need_top";
    currentInning = 1;
  } else if (last.bottomScore === null) {
    state = "need_bottom";
  } else {
    // bottom has been played — decide if game is over
    const homeScore = innings.reduce((s, i) => s + (i.bottomScore ?? 0), 0);
    const awayScore = innings.reduce((s, i) => s + i.topScore, 0);
    const inRegulation = last.inningNumber >= REGULAR_INNINGS;
    // Game ends if we're at or past 9 and scores differ
    if (inRegulation && homeScore !== awayScore) {
      state = "done";
    } else {
      state = "need_top";
      currentInning = last.inningNumber + 1;
    }
  }

  // Running scores up to each inning
  const opponentRunning = innings.reduce((s, i) => s + i.topScore, 0);
  const userRunning = innings.reduce((s, i) => s + (i.bottomScore ?? 0), 0);

  // Preview altessing: for current inning's bottom half given current scores
  const altessingPreview =
    state === "need_bottom" &&
    isAltessingBottomHalf(last!.inningNumber, opponentRunning, userRunning);

  const displayInnings = Math.max(REGULAR_INNINGS, innings.length);

  const seriesInfo =
    game.series && (game.series.teamAWins > 0 || game.series.teamBWins > 0)
      ? `${game.series.teamA.abbreviation} ${game.series.teamAWins} – ${game.series.teamBWins} ${game.series.teamB.abbreviation}`
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
          <TeamLogo abbreviation={game.awayTeam.abbreviation} size={32} />
          <span>
            {game.awayTeam.city} {game.awayTeam.name}
          </span>
          <span className="text-gray-500 mx-1">@</span>
          <TeamLogo abbreviation={game.homeTeam.abbreviation} size={32} />
          <span>
            {game.homeTeam.city} {game.homeTeam.name}
          </span>
        </h1>
        <span className="text-sm text-teal-300 uppercase tracking-wide">
          {game.stage === "regular"
            ? `Regular Season · Spiel ${game.roundNumber}`
            : `Playoffs · ${stageLabel(game.stage)} · Spiel ${game.roundNumber}${
                seriesInfo ? ` (${seriesInfo})` : ""
              }`}
        </span>
      </div>

      <Linescore
        innings={innings}
        displayInnings={displayInnings}
        awayAbbr={game.awayTeam.abbreviation}
        homeAbbr={game.homeTeam.abbreviation}
        opponentRunning={opponentRunning}
        userRunning={userRunning}
        currentInning={state === "done" ? null : currentInning}
      />

      {game.isComplete ? (
        <div className="p-4 border border-gray-800 rounded-lg bg-gray-900/60">
          Spiel beendet. Final: <b>{opponentRunning}</b> – <b>{userRunning}</b>
        </div>
      ) : (
        <>
          <ControlPanel
            game={game}
            state={state}
            currentInning={currentInning}
            altessingPreview={altessingPreview}
            opponentRunning={opponentRunning}
            userRunning={userRunning}
          />
          {innings.length > 0 && (
            <EditPanel
              gameId={game.id}
              innings={innings}
              awayAbbr={game.awayTeam.abbreviation}
              homeAbbr={game.homeTeam.abbreviation}
            />
          )}
        </>
      )}
    </div>
  );
}

function EditPanel(props: {
  gameId: number;
  innings: Array<{
    inningNumber: number;
    topScore: number;
    bottomScore: number | null;
  }>;
  awayAbbr: string;
  homeAbbr: string;
}) {
  const { gameId, innings, awayAbbr, homeAbbr } = props;
  return (
    <details className="border border-gray-800 rounded-lg bg-gray-900/30">
      <summary className="px-4 py-3 cursor-pointer text-sm text-gray-300 hover:text-teal-300 select-none">
        Scores anpassen (Korrekturen)
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-2">
        <p className="text-xs text-gray-500">
          Alle bisher eingegebenen Werte können hier korrigiert werden. Das
          Bottom-Half kann nur editiert werden nachdem es gewürfelt wurde.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr>
                <th className="text-left px-2 py-1">Inning</th>
                <th className="text-left px-2 py-1">Top ({awayAbbr})</th>
                <th className="text-left px-2 py-1">Bottom ({homeAbbr})</th>
              </tr>
            </thead>
            <tbody>
              {innings.map((i) => (
                <tr key={i.inningNumber} className="border-t border-gray-800">
                  <td className="px-2 py-2 font-mono">{i.inningNumber}</td>
                  <td className="px-2 py-2">
                    <form
                      action={adjustScore}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="gameId" value={gameId} />
                      <input type="hidden" name="inning" value={i.inningNumber} />
                      <input type="hidden" name="field" value="top" />
                      <input
                        type="number"
                        name="runs"
                        defaultValue={i.topScore}
                        min={0}
                        max={30}
                        className="w-16 bg-black/60 border border-gray-700 rounded px-2 py-1 font-mono text-sm focus:border-teal-400 outline-none"
                      />
                      <SubmitButton
                        className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
                        pendingText="..."
                      >
                        Speichern
                      </SubmitButton>
                    </form>
                  </td>
                  <td className="px-2 py-2">
                    {i.bottomScore === null ? (
                      <span className="text-xs text-gray-500 italic">
                        noch nicht gewürfelt
                      </span>
                    ) : (
                      <form
                        action={adjustScore}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="gameId" value={gameId} />
                        <input
                          type="hidden"
                          name="inning"
                          value={i.inningNumber}
                        />
                        <input type="hidden" name="field" value="bottom" />
                        <input
                          type="number"
                          name="runs"
                          defaultValue={i.bottomScore}
                          min={0}
                          max={30}
                          className="w-16 bg-black/60 border border-gray-700 rounded px-2 py-1 font-mono text-sm focus:border-teal-400 outline-none"
                        />
                        <SubmitButton
                          className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
                          pendingText="..."
                        >
                          Speichern
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function stageLabel(s: string) {
  switch (s) {
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

function Linescore(props: {
  innings: Array<{
    inningNumber: number;
    topScore: number;
    bottomScore: number | null;
    isAltessing: boolean;
  }>;
  displayInnings: number;
  awayAbbr: string;
  homeAbbr: string;
  opponentRunning: number;
  userRunning: number;
  currentInning: number | null;
}) {
  const {
    innings,
    displayInnings,
    awayAbbr,
    homeAbbr,
    opponentRunning,
    userRunning,
    currentInning,
  } = props;

  const cols: number[] = [];
  for (let i = 1; i <= displayInnings; i++) cols.push(i);

  const byInn = new Map<number, (typeof innings)[number]>();
  for (const i of innings) byInn.set(i.inningNumber, i);

  return (
    <div className="overflow-x-auto">
      <table className="scoreboard text-sm w-full">
        <thead>
          <tr className="text-xs text-gray-400">
            <th></th>
            {cols.map((n) => (
              <th
                key={n}
                className={
                  n >= ALTESSING_START_INNING ? "text-amber-300" : ""
                }
              >
                {n}
              </th>
            ))}
            <th>R</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-semibold">
              <span className="inline-flex items-center gap-2">
                <TeamLogo abbreviation={awayAbbr} size={22} />
                {awayAbbr}
              </span>
            </td>
            {cols.map((n) => {
              const inn = byInn.get(n);
              const isCurrent = n === currentInning;
              return (
                <td
                  key={n}
                  className={isCurrent ? "current-inning" : ""}
                >
                  {inn ? inn.topScore : ""}
                </td>
              );
            })}
            <td className="font-mono">{opponentRunning}</td>
          </tr>
          <tr>
            <td className="font-semibold">
              <span className="inline-flex items-center gap-2">
                <TeamLogo abbreviation={homeAbbr} size={22} />
                {homeAbbr}
              </span>
            </td>
            {cols.map((n) => {
              const inn = byInn.get(n);
              const isCurrent = n === currentInning;
              const altessing = inn?.isAltessing;
              return (
                <td
                  key={n}
                  className={`${isCurrent ? "current-inning" : ""} ${
                    altessing ? "altessing" : ""
                  }`}
                >
                  {inn && inn.bottomScore !== null ? inn.bottomScore : ""}
                </td>
              );
            })}
            <td className="font-mono">{userRunning}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ControlPanel(props: {
  game: { id: number };
  state: "need_top" | "need_bottom" | "done";
  currentInning: number;
  altessingPreview: boolean;
  opponentRunning: number;
  userRunning: number;
}) {
  const {
    game,
    state,
    currentInning,
    altessingPreview,
    opponentRunning,
    userRunning,
  } = props;

  const diff = userRunning - opponentRunning;

  return (
    <div className="border border-gray-800 rounded-lg p-5 bg-gray-900/40 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-400">
            Aktueller Stand (Mariners – Gegner)
          </div>
          <div className="font-mono text-2xl">
            {userRunning} – {opponentRunning}
            <span
              className={`ml-3 text-sm ${
                diff > 0
                  ? "text-teal-400"
                  : diff < 0
                  ? "text-rose-400"
                  : "text-gray-400"
              }`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">Aktuelles Inning</div>
          <div className="font-mono text-2xl">
            {state === "done" ? "Finale" : currentInning}
            <span className="text-xs text-gray-400 ml-1">
              {state === "need_top"
                ? "· Top"
                : state === "need_bottom"
                ? "· Bottom"
                : ""}
            </span>
          </div>
        </div>
      </div>

      {state === "need_top" && (
        <form
          action={submitTopHalfAction}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="gameId" value={game.id} />
          <input type="hidden" name="inning" value={currentInning} />
          <label className="flex-1 min-w-[200px]">
            <div className="text-sm text-gray-300 mb-1">
              Top {currentInning}. Inning — Runs des Gegners
            </div>
            <input
              type="number"
              name="runs"
              defaultValue={0}
              min={0}
              max={30}
              autoFocus
              required
              className="w-full bg-black/60 border border-gray-700 rounded-md px-3 py-2 text-lg font-mono focus:border-teal-400 outline-none"
            />
          </label>
          <SubmitButton
            className="bg-teal-500 hover:bg-teal-400 text-black font-semibold px-5 py-2 rounded-md"
            pendingText="Speichere..."
          >
            Top bestätigen
          </SubmitButton>
        </form>
      )}

      {state === "need_bottom" && (
        <form action={rollBottom} className="space-y-3">
          <input type="hidden" name="gameId" value={game.id} />
          <input type="hidden" name="inning" value={currentInning} />
          <div className="text-sm text-gray-300">
            Bottom {currentInning}. Inning — Mariners Offense
          </div>
          {altessingPreview ? (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <b className="text-amber-300">ALTESSING-INNINGS AKTIV!</b> Die
              Mariners liegen im{" "}
              {currentInning}. Inning zurück. Jeder Run zählt doppelt.
              <div className="font-mono text-xs text-amber-200 mt-1">
                Pool: {ALTESSING_ROLL.join(", ")}
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400 font-mono">
              Pool: {NORMAL_ROLL.join(", ")}
            </div>
          )}
          <SubmitButton
            className={`${
              altessingPreview
                ? "bg-amber-400 hover:bg-amber-300"
                : "bg-teal-500 hover:bg-teal-400"
            } text-black font-semibold px-5 py-2 rounded-md`}
            pendingText="Würfle..."
          >
            Würfeln
          </SubmitButton>
        </form>
      )}

      {state === "done" && (
        <form action={finishGame} className="flex flex-wrap gap-3">
          <input type="hidden" name="gameId" value={game.id} />
          <SubmitButton
            className="bg-teal-500 hover:bg-teal-400 text-black font-semibold px-5 py-2 rounded-md"
            pendingText="Schliesse Spiel ab & simuliere Liga..."
          >
            Spiel abschliessen &amp; Saison fortsetzen →
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
