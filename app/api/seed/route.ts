import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MLB_TEAMS } from "@/lib/mlb-teams";

export const dynamic = "force-dynamic";

/**
 * One-shot seeder to populate the 30 MLB teams.
 * Safe to call multiple times — uses upsert, so it's idempotent.
 *
 * Usage:   GET  /api/seed
 * or:      POST /api/seed
 */
async function runSeed() {
  let created = 0;
  let updated = 0;
  for (const t of MLB_TEAMS) {
    const existing = await prisma.team.findUnique({
      where: { abbreviation: t.abbreviation },
    });
    await prisma.team.upsert({
      where: { abbreviation: t.abbreviation },
      update: { name: t.name, city: t.city, league: t.league, division: t.division },
      create: t,
    });
    if (existing) updated++;
    else created++;
  }
  const total = await prisma.team.count();
  return { created, updated, total };
}

export async function GET() {
  try {
    const result = await runSeed();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST() {
  return GET();
}
