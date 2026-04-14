import { PrismaClient } from "@prisma/client";
import { MLB_TEAMS } from "../lib/mlb-teams";

const prisma = new PrismaClient();

async function main() {
  for (const t of MLB_TEAMS) {
    await prisma.team.upsert({
      where: { abbreviation: t.abbreviation },
      update: { name: t.name, city: t.city, league: t.league, division: t.division },
      create: t,
    });
  }
  console.log(`Seeded ${MLB_TEAMS.length} MLB teams.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
