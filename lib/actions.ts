"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import {
  REGULAR_SEASON_GAMES,
  MARINERS_ABBREVIATION,
  PLAYOFF_WINS_NEEDED,
} from "./mlb-teams";
import {
  isAltessingBottomHalf,
  pickRandom,
  randomPairings,
  rollBottomHalf,
  simulateCpuGame,
} from "./game-logic";
import { getStandings, playoffTeamsPerLeague } from "./standings";

async function getMariners() {
  const t = await prisma.team.findUnique({
    where: { abbreviation: MARINERS_ABBREVIATION },
  });
  if (!t) throw new Error("Mariners team not seeded. Run `npm run db:seed`.");
  return t;
}

/**
 * Start a brand new season. Creates the Season row and TeamSeasonStats for all
 * 30 MLB teams. Does NOT generate any games yet; games are created per round
 * as the user plays.
 */
export async function createSeason(): Promise<number> {
  const latest = await prisma.season.findFirst({ orderBy: { year: "desc" } });
  const year = latest ? latest.year + 1 : new Date().getFullYear();

  const teams = await prisma.team.findMany();
  if (teams.length !== 30) {
    throw new Error(
      `Expected 30 MLB teams in DB, found ${teams.length}. Did you run the seed?`
    );
  }

  const season = await prisma.season.create({
    data: {
      year,
      status: "regular",
      currentRound: 1,
      stats: {
        create: teams.map((t) => ({ teamId: t.id })),
      },
    },
  });

  revalidatePath("/");
  return season.id;
}

/**
 * Ensure there is a current user game for the season. Creates one if missing.
 * Returns the game id.
 */
export async function ensureCurrentUserGame(seasonId: number): Promise<number> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) throw new Error("Season not found.");
  if (season.status === "complete") {
    throw new Error("Season is already complete.");
  }

  const existing = await prisma.game.findFirst({
    where: { seasonId, isUserGame: true, isComplete: false },
    orderBy: { id: "desc" },
  });
  if (existing) return existing.id;

  if (season.status === "regular") {
    return createRegularUserGame(seasonId, season.currentRound);
  }
  return createPlayoffUserGame(seasonId);
}

async function createRegularUserGame(
  seasonId: number,
  roundNumber: number
): Promise<number> {
  const mariners = await getMariners();
  const others = await prisma.team.findMany({
    where: { id: { not: mariners.id } },
  });
  const opponent = pickRandom(others);

  // User always home for simplicity
  const game = await prisma.game.create({
    data: {
      seasonId,
      roundNumber,
      stage: "regular",
      homeTeamId: mariners.id,
      awayTeamId: opponent.id,
      isUserGame: true,
    },
  });
  return game.id;
}

async function createPlayoffUserGame(seasonId: number): Promise<number> {
  const mariners = await getMariners();
  // Find current active series containing Mariners
  let series = await prisma.playoffSeries.findFirst({
    where: {
      seasonId,
      isComplete: false,
      OR: [{ teamAId: mariners.id }, { teamBId: mariners.id }],
    },
  });
  if (!series) {
    // Mariners' previous series is complete but next stage hasn't been built yet
    // because other series in the previous round are still pending. Force-advance.
    await forceAdvancePlayoffs(seasonId);
    series = await prisma.playoffSeries.findFirst({
      where: {
        seasonId,
        isComplete: false,
        OR: [{ teamAId: mariners.id }, { teamBId: mariners.id }],
      },
    });
  }
  if (!series) throw new Error("No active playoff series for Mariners.");

  const prevGames = await prisma.game.count({ where: { seriesId: series.id } });
  const seriesGameNo = prevGames + 1;

  const opponentId =
    series.teamAId === mariners.id ? series.teamBId : series.teamAId;

  const game = await prisma.game.create({
    data: {
      seasonId,
      roundNumber: seriesGameNo,
      stage: series.round,
      seriesId: series.id,
      homeTeamId: mariners.id,
      awayTeamId: opponentId,
      isUserGame: true,
    },
  });
  return game.id;
}

/**
 * Manually adjust a previously-entered score on an active (not yet finalized)
 * game. Used for score corrections during play. Recomputes the game totals.
 */
export async function adjustInningScore(
  gameId: number,
  inningNumber: number,
  field: "top" | "bottom",
  runs: number
) {
  if (runs < 0 || runs > 30 || !Number.isInteger(runs)) {
    throw new Error("Ungültiger Wert für Runs.");
  }
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { innings: true },
  });
  if (!game) throw new Error("Spiel nicht gefunden.");
  if (game.isComplete) throw new Error("Spiel ist bereits abgeschlossen.");

  const inning = game.innings.find((i) => i.inningNumber === inningNumber);
  if (!inning) throw new Error("Inning existiert noch nicht.");

  if (field === "top") {
    await prisma.inning.update({
      where: { id: inning.id },
      data: { topScore: runs },
    });
  } else {
    // Only allow editing bottom score if it was already rolled (not null)
    if (inning.bottomScore === null) {
      throw new Error(
        "Bottom Half wurde noch nicht gewürfelt und kann nicht editiert werden."
      );
    }
    await prisma.inning.update({
      where: { id: inning.id },
      data: { bottomScore: runs },
    });
  }

  await recalcGameTotals(gameId);
  revalidatePath(`/game/${gameId}`);
}

/**
 * Submit the top half of an inning (opponent runs).
 */
export async function submitTopHalf(gameId: number, inningNumber: number, runs: number) {
  if (runs < 0 || runs > 30 || !Number.isInteger(runs)) {
    throw new Error("Invalid run count.");
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { innings: true },
  });
  if (!game) throw new Error("Game not found.");
  if (game.isComplete) throw new Error("Game already finished.");

  const existing = game.innings.find((i) => i.inningNumber === inningNumber);
  if (existing) {
    // Overwrite top half if bottom not played yet
    await prisma.inning.update({
      where: { id: existing.id },
      data: { topScore: runs },
    });
  } else {
    await prisma.inning.create({
      data: { gameId, inningNumber, topScore: runs, bottomScore: null },
    });
  }

  await recalcGameTotals(gameId);
  revalidatePath(`/game/${gameId}`);
}

/**
 * Roll and store the bottom half of an inning.
 * The Altessing-Innings logic is applied based on current score differential.
 */
export async function rollBottomHalfAction(gameId: number, inningNumber: number) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { innings: { orderBy: { inningNumber: "asc" } } },
  });
  if (!game) throw new Error("Game not found.");
  if (game.isComplete) throw new Error("Game already finished.");

  const inning = game.innings.find((i) => i.inningNumber === inningNumber);
  if (!inning) throw new Error("Top half must be played first.");

  // Current score BEFORE this bottom half
  let opponent = 0;
  let user = 0;
  for (const i of game.innings) {
    opponent += i.topScore;
    if (i.inningNumber < inningNumber) user += i.bottomScore ?? 0;
  }

  const altessing = isAltessingBottomHalf(inningNumber, opponent, user);
  const rolled = rollBottomHalf(altessing);

  // New running totals after this roll
  const newAway = opponent;
  const newHome = user + rolled;

  // Batch the inning update + game totals update into one transaction
  await prisma.$transaction([
    prisma.inning.update({
      where: { id: inning.id },
      data: { bottomScore: rolled, isAltessing: altessing },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: { homeScore: newHome, awayScore: newAway },
    }),
  ]);

  revalidatePath(`/game/${gameId}`);
  return { rolled, altessing };
}

async function recalcGameTotals(gameId: number) {
  // Used after manual score adjustments. Recomputes from the innings table.
  const innings = await prisma.inning.findMany({ where: { gameId } });
  const homeScore = innings.reduce((s, i) => s + (i.bottomScore ?? 0), 0);
  const awayScore = innings.reduce((s, i) => s + i.topScore, 0);
  await prisma.game.update({
    where: { id: gameId },
    data: { homeScore, awayScore },
  });
}

/**
 * Finalize the current user game. Simulates all other games of the round
 * and advances the season state.
 */
export async function finishUserGame(gameId: number) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { innings: { orderBy: { inningNumber: "asc" } }, season: true },
  });
  if (!game) throw new Error("Game not found.");
  if (game.isComplete) throw new Error("Already complete.");

  // Must have at least 9 innings and no tie
  if (game.innings.length < 9) {
    throw new Error("Game has fewer than 9 innings.");
  }
  if (game.homeScore === game.awayScore) {
    throw new Error("Game is tied — play an extra inning.");
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { isComplete: true, completedAt: new Date() },
  });

  if (game.stage === "regular") {
    await finalizeRegularRound(game.seasonId, game.roundNumber, game);
  } else {
    await finalizePlayoffGame(game.seasonId, game.seriesId!, game);
  }

  revalidatePath("/");
  revalidatePath("/standings");
  revalidatePath("/history");
}

async function finalizeRegularRound(
  seasonId: number,
  roundNumber: number,
  userGame: { homeTeamId: number; awayTeamId: number; homeScore: number; awayScore: number }
) {
  const mariners = await getMariners();
  const others = await prisma.team.findMany({
    where: { id: { not: mariners.id } },
  });
  const opponentId =
    userGame.homeTeamId === mariners.id ? userGame.awayTeamId : userGame.homeTeamId;
  const pool = others.filter((t) => t.id !== opponentId);
  const pairs = randomPairings(pool);

  // Pre-compute all CPU games and aggregate per-team stat deltas in memory.
  type GameRow = {
    seasonId: number;
    roundNumber: number;
    stage: string;
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number;
    awayScore: number;
    isUserGame: boolean;
    isComplete: boolean;
    completedAt: Date;
  };
  const cpuGames: GameRow[] = [];
  const allResults: Array<{
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number;
    awayScore: number;
  }> = [userGame];
  const now = new Date();
  for (const [a, b] of pairs) {
    const { home, away } = simulateCpuGame();
    cpuGames.push({
      seasonId,
      roundNumber,
      stage: "regular",
      homeTeamId: a.id,
      awayTeamId: b.id,
      homeScore: home,
      awayScore: away,
      isUserGame: false,
      isComplete: true,
      completedAt: now,
    });
    allResults.push({
      homeTeamId: a.id,
      awayTeamId: b.id,
      homeScore: home,
      awayScore: away,
    });
  }
  const statDeltas = aggregateStatDeltas(allResults);

  // Single batched transaction:
  //  - createMany for 14 CPU games (1 round trip)
  //  - one update per affected team (sent as single batch)
  //  - season currentRound bump
  const nextRound = roundNumber + 1;
  const advanceToPlayoffs = nextRound > REGULAR_SEASON_GAMES;

  await prisma.$transaction([
    prisma.game.createMany({ data: cpuGames }),
    ...statDeltas.map((d) =>
      prisma.teamSeasonStats.update({
        where: { seasonId_teamId: { seasonId, teamId: d.teamId } },
        data: {
          wins: { increment: d.wins },
          losses: { increment: d.losses },
          runsFor: { increment: d.runsFor },
          runsAgainst: { increment: d.runsAgainst },
        },
      })
    ),
    ...(advanceToPlayoffs
      ? []
      : [
          prisma.season.update({
            where: { id: seasonId },
            data: { currentRound: nextRound },
          }),
        ]),
  ]);

  if (advanceToPlayoffs) {
    await startPlayoffs(seasonId);
  }
}

/**
 * Aggregate per-team W/L/RF/RA increments for a batch of game results.
 * Reduces the number of individual UPDATE statements we send to Postgres.
 */
function aggregateStatDeltas(
  results: Array<{
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number;
    awayScore: number;
  }>
): Array<{
  teamId: number;
  wins: number;
  losses: number;
  runsFor: number;
  runsAgainst: number;
}> {
  const map = new Map<
    number,
    { wins: number; losses: number; runsFor: number; runsAgainst: number }
  >();
  const get = (id: number) => {
    let row = map.get(id);
    if (!row) {
      row = { wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 };
      map.set(id, row);
    }
    return row;
  };
  for (const r of results) {
    const homeWins = r.homeScore > r.awayScore;
    const home = get(r.homeTeamId);
    const away = get(r.awayTeamId);
    home.wins += homeWins ? 1 : 0;
    home.losses += homeWins ? 0 : 1;
    home.runsFor += r.homeScore;
    home.runsAgainst += r.awayScore;
    away.wins += homeWins ? 0 : 1;
    away.losses += homeWins ? 1 : 0;
    away.runsFor += r.awayScore;
    away.runsAgainst += r.homeScore;
  }
  return Array.from(map.entries()).map(([teamId, v]) => ({ teamId, ...v }));
}

/**
 * Create playoff bracket. Top 2 from each division per league (6 per league).
 * Seeds 1-2 get a bye. Wildcard round: 3v6, 4v5.
 * Then divisional: 1 vs lowest surviving, 2 vs other.
 */
async function startPlayoffs(seasonId: number) {
  const standings = await getStandings(seasonId);
  const { AL, NL } = playoffTeamsPerLeague(standings);

  await prisma.season.update({
    where: { id: seasonId },
    data: { status: "playoffs" },
  });

  // Wildcard round: seed 3 vs 6, seed 4 vs 5
  for (const [league, teams] of [
    ["AL", AL],
    ["NL", NL],
  ] as const) {
    if (teams.length < 6) continue;
    await prisma.playoffSeries.createMany({
      data: [
        {
          seasonId,
          round: "wildcard",
          league,
          teamAId: teams[2].teamId,
          teamBId: teams[5].teamId,
        },
        {
          seasonId,
          round: "wildcard",
          league,
          teamAId: teams[3].teamId,
          teamBId: teams[4].teamId,
        },
      ],
    });
  }
}

async function finalizePlayoffGame(
  seasonId: number,
  seriesId: number,
  userGame: { homeTeamId: number; awayTeamId: number; homeScore: number; awayScore: number }
) {
  // Update series wins for user game
  const homeWins = userGame.homeScore > userGame.awayScore;
  const series = await prisma.playoffSeries.findUnique({ where: { id: seriesId } });
  if (!series) return;

  const winnerTeamId = homeWins ? userGame.homeTeamId : userGame.awayTeamId;
  const teamAWins = series.teamAWins + (winnerTeamId === series.teamAId ? 1 : 0);
  const teamBWins = series.teamBWins + (winnerTeamId === series.teamBId ? 1 : 0);
  let finalWinner: number | null = null;
  let isComplete = false;
  if (teamAWins >= PLAYOFF_WINS_NEEDED) {
    finalWinner = series.teamAId;
    isComplete = true;
  } else if (teamBWins >= PLAYOFF_WINS_NEEDED) {
    finalWinner = series.teamBId;
    isComplete = true;
  }
  await prisma.playoffSeries.update({
    where: { id: seriesId },
    data: { teamAWins, teamBWins, winnerId: finalWinner, isComplete },
  });

  // Simulate other series games for this round until the Mariners' series catches up OR
  // advance the other series by one game each time the user plays one.
  await advanceOtherSeriesByOneGame(seasonId, series.round, seriesId);

  // If Mariners series done, maybe advance to next round
  await maybeAdvancePlayoffRound(seasonId);
}

async function advanceOtherSeriesByOneGame(
  seasonId: number,
  round: string,
  excludeSeriesId: number
) {
  const otherSeries = await prisma.playoffSeries.findMany({
    where: { seasonId, round, isComplete: false, id: { not: excludeSeriesId } },
  });
  for (const s of otherSeries) {
    const { home, away } = simulateCpuGame();
    const homeWins = home > away;
    const gamesPlayed = await prisma.game.count({ where: { seriesId: s.id } });
    await prisma.game.create({
      data: {
        seasonId,
        roundNumber: gamesPlayed + 1,
        stage: s.round,
        seriesId: s.id,
        homeTeamId: s.teamAId,
        awayTeamId: s.teamBId,
        homeScore: home,
        awayScore: away,
        isUserGame: false,
        isComplete: true,
        completedAt: new Date(),
      },
    });
    const winnerTeamId = homeWins ? s.teamAId : s.teamBId;
    const teamAWins = s.teamAWins + (winnerTeamId === s.teamAId ? 1 : 0);
    const teamBWins = s.teamBWins + (winnerTeamId === s.teamBId ? 1 : 0);
    let finalWinner: number | null = null;
    let isComplete = false;
    if (teamAWins >= PLAYOFF_WINS_NEEDED) {
      finalWinner = s.teamAId;
      isComplete = true;
    } else if (teamBWins >= PLAYOFF_WINS_NEEDED) {
      finalWinner = s.teamBId;
      isComplete = true;
    }
    await prisma.playoffSeries.update({
      where: { id: s.id },
      data: { teamAWins, teamBWins, winnerId: finalWinner, isComplete },
    });
  }

  // If any series in round still incomplete (e.g. mariners lost, but other series
  // still going), keep simulating so bracket progresses with each "round" click.
}

async function maybeAdvancePlayoffRound(seasonId: number) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || season.status !== "playoffs") return;

  const mariners = await getMariners();

  // Ensure all series in the current stage are complete (catch-up simulate if not)
  const stages = ["wildcard", "divisional", "championship", "worldseries"];
  for (const stage of stages) {
    const incomplete = await prisma.playoffSeries.findMany({
      where: { seasonId, round: stage, isComplete: false },
    });
    if (incomplete.length === 0) continue;

    // Mariners still in this round?
    const marinersSeries = incomplete.find(
      (s) => s.teamAId === mariners.id || s.teamBId === mariners.id
    );
    if (marinersSeries) {
      // Wait for user to finish this series
      return;
    }
    // Otherwise simulate remaining series to completion
    for (const s of incomplete) {
      await simulateSeriesToCompletion(seasonId, s.id);
    }
  }

  // Build next stage if needed
  await buildNextPlayoffStage(seasonId);
}

async function simulateSeriesToCompletion(seasonId: number, seriesId: number) {
  while (true) {
    const s = await prisma.playoffSeries.findUnique({ where: { id: seriesId } });
    if (!s || s.isComplete) return;
    const { home, away } = simulateCpuGame();
    const homeWins = home > away;
    const gamesPlayed = await prisma.game.count({ where: { seriesId: s.id } });
    await prisma.game.create({
      data: {
        seasonId,
        roundNumber: gamesPlayed + 1,
        stage: s.round,
        seriesId: s.id,
        homeTeamId: s.teamAId,
        awayTeamId: s.teamBId,
        homeScore: home,
        awayScore: away,
        isUserGame: false,
        isComplete: true,
        completedAt: new Date(),
      },
    });
    const winnerTeamId = homeWins ? s.teamAId : s.teamBId;
    const teamAWins = s.teamAWins + (winnerTeamId === s.teamAId ? 1 : 0);
    const teamBWins = s.teamBWins + (winnerTeamId === s.teamBId ? 1 : 0);
    let finalWinner: number | null = null;
    let isComplete = false;
    if (teamAWins >= PLAYOFF_WINS_NEEDED) {
      finalWinner = s.teamAId;
      isComplete = true;
    } else if (teamBWins >= PLAYOFF_WINS_NEEDED) {
      finalWinner = s.teamBId;
      isComplete = true;
    }
    await prisma.playoffSeries.update({
      where: { id: s.id },
      data: { teamAWins, teamBWins, winnerId: finalWinner, isComplete },
    });
    if (isComplete) return;
  }
}

async function buildNextPlayoffStage(seasonId: number) {
  const allSeries = await prisma.playoffSeries.findMany({
    where: { seasonId },
    orderBy: { id: "asc" },
  });

  const wildcard = allSeries.filter((s) => s.round === "wildcard");
  const divisional = allSeries.filter((s) => s.round === "divisional");
  const championship = allSeries.filter((s) => s.round === "championship");
  const worldseries = allSeries.filter((s) => s.round === "worldseries");

  const allDone = (list: typeof allSeries) =>
    list.length > 0 && list.every((s) => s.isComplete);

  // Wildcard → Divisional: seed 1 vs lowest WC winner, seed 2 vs other
  if (divisional.length === 0 && allDone(wildcard)) {
    const standings = await getStandings(seasonId);
    const { AL, NL } = playoffTeamsPerLeague(standings);

    for (const [league, seeds] of [
      ["AL", AL],
      ["NL", NL],
    ] as const) {
      if (seeds.length < 6) continue;
      const leagueWC = wildcard
        .filter((s) => s.league === league)
        .sort((a, b) => a.id - b.id);
      if (leagueWC.length !== 2 || !leagueWC.every((s) => s.winnerId)) continue;

      const seed1 = seeds[0].teamId;
      const seed2 = seeds[1].teamId;
      // WC winners: figure out which is higher/lower seed
      const wcWinners = leagueWC.map((s) => s.winnerId!);
      const wcSeeds = wcWinners.map((id) => {
        const idx = seeds.findIndex((s) => s.teamId === id);
        return { teamId: id, seed: idx >= 0 ? idx : 99 };
      });
      wcSeeds.sort((a, b) => a.seed - b.seed);

      // Seed 1 vs lowest surviving seed, seed 2 vs highest surviving seed
      await prisma.playoffSeries.createMany({
        data: [
          {
            seasonId,
            round: "divisional",
            league,
            teamAId: seed1,
            teamBId: wcSeeds[1].teamId,
          },
          {
            seasonId,
            round: "divisional",
            league,
            teamAId: seed2,
            teamBId: wcSeeds[0].teamId,
          },
        ],
      });
    }
    return;
  }

  // Championship round: AL LCS, NL LCS
  if (championship.length === 0 && allDone(divisional)) {
    for (const league of ["AL", "NL"] as const) {
      const leagueSeries = divisional
        .filter((s) => s.league === league)
        .sort((a, b) => a.id - b.id);
      if (leagueSeries.length === 2 && leagueSeries.every((s) => s.winnerId)) {
        await prisma.playoffSeries.create({
          data: {
            seasonId,
            round: "championship",
            league,
            teamAId: leagueSeries[0].winnerId!,
            teamBId: leagueSeries[1].winnerId!,
          },
        });
      }
    }
    return;
  }

  // World Series
  if (worldseries.length === 0 && allDone(championship)) {
    const al = championship.find((s) => s.league === "AL");
    const nl = championship.find((s) => s.league === "NL");
    if (al?.winnerId && nl?.winnerId) {
      await prisma.playoffSeries.create({
        data: {
          seasonId,
          round: "worldseries",
          league: null,
          teamAId: al.winnerId,
          teamBId: nl.winnerId,
        },
      });
    }
    return;
  }

  // Season complete?
  if (allDone(worldseries)) {
    await prisma.season.update({
      where: { id: seasonId },
      data: { status: "complete" },
    });
  }
}

/**
 * Simulate all series in the current round that Mariners are NOT in, so the
 * bracket can advance to the next stage. Useful when the user finishes their
 * series faster than the rest of the league.
 */
async function forceAdvancePlayoffs(seasonId: number) {
  for (let i = 0; i < 4; i++) {
    const incomplete = await prisma.playoffSeries.findMany({
      where: { seasonId, isComplete: false },
    });
    if (incomplete.length === 0) {
      await buildNextPlayoffStage(seasonId);
      const newOnes = await prisma.playoffSeries.count({
        where: { seasonId, isComplete: false },
      });
      if (newOnes === 0) break;
      continue;
    }
    for (const s of incomplete) {
      await simulateSeriesToCompletion(seasonId, s.id);
    }
    await buildNextPlayoffStage(seasonId);
  }
}

/**
 * For when user is eliminated early but wants to finish simulating the season
 * automatically to see the final result. Called from the "Saison abschliessen"
 * button on the home page if status == playoffs and Mariners are out.
 */
export async function simulateRestOfPlayoffs(seasonId: number) {
  for (let i = 0; i < 10; i++) {
    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season || season.status !== "playoffs") break;
    const incomplete = await prisma.playoffSeries.findMany({
      where: { seasonId, isComplete: false },
    });
    if (incomplete.length === 0) {
      await buildNextPlayoffStage(seasonId);
      continue;
    }
    for (const s of incomplete) {
      await simulateSeriesToCompletion(seasonId, s.id);
    }
    await buildNextPlayoffStage(seasonId);
  }
  revalidatePath("/");
  revalidatePath("/standings");
  revalidatePath("/history");
}

export async function goToCurrentGame(seasonId: number) {
  const gameId = await ensureCurrentUserGame(seasonId);
  redirect(`/game/${gameId}`);
}

/**
 * Wipe the current season completely (games, innings, stats, playoff bracket)
 * and start a fresh one.
 */
export async function resetSeason(seasonId: number) {
  // Cascading deletes on Season → Games → Innings, Stats, Series.
  await prisma.season.delete({ where: { id: seasonId } }).catch(() => {});
  await createSeason();
  revalidatePath("/");
  revalidatePath("/standings");
  revalidatePath("/history");
  revalidatePath("/results");
  revalidatePath("/playoffs");
}

/**
 * Test helper: simulate the entire remaining regular season at once and
 * jump straight into the playoffs. Mariners' remaining games are auto-played
 * with random scores so the standings stay consistent.
 */
export async function skipToPlayoffs(seasonId: number) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) throw new Error("Season not found.");
  if (season.status !== "regular") {
    // Already past regular season — nothing to skip
    revalidatePath("/");
    return;
  }

  const mariners = await getMariners();
  const allTeams = await prisma.team.findMany();
  const teamsExceptMariners = allTeams.filter((t) => t.id !== mariners.id);

  // Drop any in-progress user game so the user doesn't end up with an orphan.
  await prisma.game.deleteMany({
    where: { seasonId, isUserGame: true, isComplete: false },
  });

  // For every remaining round, simulate all 15 matchups (Mariners included).
  for (let round = season.currentRound; round <= REGULAR_SEASON_GAMES; round++) {
    // Mariners game vs random opponent
    const opponent = pickRandom(teamsExceptMariners);
    const userGameSim = simulateCpuGame();
    const remainingPool = teamsExceptMariners.filter((t) => t.id !== opponent.id);
    const pairs = randomPairings(remainingPool);

    type GameRow = {
      seasonId: number;
      roundNumber: number;
      stage: string;
      homeTeamId: number;
      awayTeamId: number;
      homeScore: number;
      awayScore: number;
      isUserGame: boolean;
      isComplete: boolean;
      completedAt: Date;
    };
    const now = new Date();
    const allGames: GameRow[] = [
      {
        seasonId,
        roundNumber: round,
        stage: "regular",
        homeTeamId: mariners.id,
        awayTeamId: opponent.id,
        homeScore: userGameSim.home,
        awayScore: userGameSim.away,
        isUserGame: false, // recorded as auto-sim, no inning detail
        isComplete: true,
        completedAt: now,
      },
    ];
    const allResults = [
      {
        homeTeamId: mariners.id,
        awayTeamId: opponent.id,
        homeScore: userGameSim.home,
        awayScore: userGameSim.away,
      },
    ];
    for (const [a, b] of pairs) {
      const { home, away } = simulateCpuGame();
      allGames.push({
        seasonId,
        roundNumber: round,
        stage: "regular",
        homeTeamId: a.id,
        awayTeamId: b.id,
        homeScore: home,
        awayScore: away,
        isUserGame: false,
        isComplete: true,
        completedAt: now,
      });
      allResults.push({
        homeTeamId: a.id,
        awayTeamId: b.id,
        homeScore: home,
        awayScore: away,
      });
    }
    const deltas = aggregateStatDeltas(allResults);
    await prisma.$transaction([
      prisma.game.createMany({ data: allGames }),
      ...deltas.map((d) =>
        prisma.teamSeasonStats.update({
          where: { seasonId_teamId: { seasonId, teamId: d.teamId } },
          data: {
            wins: { increment: d.wins },
            losses: { increment: d.losses },
            runsFor: { increment: d.runsFor },
            runsAgainst: { increment: d.runsAgainst },
          },
        })
      ),
    ]);
  }

  await startPlayoffs(seasonId);

  revalidatePath("/");
  revalidatePath("/standings");
  revalidatePath("/results");
  revalidatePath("/playoffs");
}
