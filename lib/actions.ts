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
import { getStandings, topTeamsPerLeague } from "./standings";

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

  await prisma.inning.update({
    where: { id: inning.id },
    data: { bottomScore: rolled, isAltessing: altessing },
  });

  await recalcGameTotals(gameId);
  revalidatePath(`/game/${gameId}`);
  return { rolled, altessing };
}

async function recalcGameTotals(gameId: number) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { innings: true },
  });
  if (!game) return;
  const homeScore = game.innings.reduce((s, i) => s + (i.bottomScore ?? 0), 0);
  const awayScore = game.innings.reduce((s, i) => s + i.topScore, 0);
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
  // Record stats for user game
  await applyGameResultToStats(seasonId, userGame);

  // Simulate the other 14 games: all non-Mariners teams paired into matchups.
  const mariners = await getMariners();
  const others = await prisma.team.findMany({
    where: { id: { not: mariners.id } },
  });
  // Exclude the Mariners' opponent so they don't double-up
  const opponentId =
    userGame.homeTeamId === mariners.id ? userGame.awayTeamId : userGame.homeTeamId;
  const pool = others.filter((t) => t.id !== opponentId);
  const pairs = randomPairings(pool);

  for (const [a, b] of pairs) {
    const { home, away } = simulateCpuGame();
    await prisma.game.create({
      data: {
        seasonId,
        roundNumber,
        stage: "regular",
        homeTeamId: a.id,
        awayTeamId: b.id,
        homeScore: home,
        awayScore: away,
        isUserGame: false,
        isComplete: true,
        completedAt: new Date(),
      },
    });
    await applyGameResultToStats(seasonId, {
      homeTeamId: a.id,
      awayTeamId: b.id,
      homeScore: home,
      awayScore: away,
    });
  }

  // Advance season
  const nextRound = roundNumber + 1;
  if (nextRound > REGULAR_SEASON_GAMES) {
    await startPlayoffs(seasonId);
  } else {
    await prisma.season.update({
      where: { id: seasonId },
      data: { currentRound: nextRound },
    });
  }
}

async function applyGameResultToStats(
  seasonId: number,
  g: { homeTeamId: number; awayTeamId: number; homeScore: number; awayScore: number }
) {
  const homeWins = g.homeScore > g.awayScore;
  await prisma.teamSeasonStats.update({
    where: { seasonId_teamId: { seasonId, teamId: g.homeTeamId } },
    data: {
      wins: { increment: homeWins ? 1 : 0 },
      losses: { increment: homeWins ? 0 : 1 },
      runsFor: { increment: g.homeScore },
      runsAgainst: { increment: g.awayScore },
    },
  });
  await prisma.teamSeasonStats.update({
    where: { seasonId_teamId: { seasonId, teamId: g.awayTeamId } },
    data: {
      wins: { increment: homeWins ? 0 : 1 },
      losses: { increment: homeWins ? 1 : 0 },
      runsFor: { increment: g.awayScore },
      runsAgainst: { increment: g.homeScore },
    },
  });
}

/**
 * Create playoff bracket. Top 4 per league by record.
 * Round 1 = "divisional"  (1v4 and 2v3 per league)
 */
async function startPlayoffs(seasonId: number) {
  const standings = await getStandings(seasonId);
  const { AL, NL } = topTeamsPerLeague(standings, 4);

  await prisma.season.update({
    where: { id: seasonId },
    data: { status: "playoffs" },
  });

  // Round 1: 1v4 and 2v3 for each league
  for (const [league, teams] of [
    ["AL", AL],
    ["NL", NL],
  ] as const) {
    if (teams.length < 4) continue;
    await prisma.playoffSeries.createMany({
      data: [
        {
          seasonId,
          round: "divisional",
          league,
          teamAId: teams[0].teamId,
          teamBId: teams[3].teamId,
        },
        {
          seasonId,
          round: "divisional",
          league,
          teamAId: teams[1].teamId,
          teamBId: teams[2].teamId,
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
  const stages = ["divisional", "championship", "worldseries"];
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

  const divisional = allSeries.filter((s) => s.round === "divisional");
  const championship = allSeries.filter((s) => s.round === "championship");
  const worldseries = allSeries.filter((s) => s.round === "worldseries");

  const allDone = (list: typeof allSeries) =>
    list.length > 0 && list.every((s) => s.isComplete);

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
