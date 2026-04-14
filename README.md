# Altessing-Innings Tracker

Ein Scoretracker für ein selbsterfundenes baseballähnliches Spiel. Du spielst
immer die **Seattle Mariners**, spielst 20 Regular-Season-Spiele gegen
zufällige MLB-Teams, die restliche MLB-Liga wird im Hintergrund simuliert und
du kämpfst dich durch First-to-3-Playoffs bis zur World Series.

## Spielmechanik

- 9 Innings, jedes Inning mit Top- und Bottom-Half.
- **Top Half**: Ihr simuliert das Pitching (Ball hin-und-her). Am Ende des Top
  Halves tippst du ein, wie viele Runs die Gegner gescored haben.
- **Bottom Half**: Die App würfelt einen Wert aus
  `[3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]` (∅ 0.5 Runs).
- **Altessing-Innings**: Im 8. und 9. Inning gilt: wenn die Mariners
  **zurückliegen** bevor sie ans Bat kommen, wird aus dem Pool
  `[6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]` gewürfelt — jeder offensive Run zählt
  doppelt.
- Bei Gleichstand nach 9 Innings → Extra Innings mit der normalen Verteilung.

## Playoff-Format

- Top 4 Teams pro League → Division Series (1 vs 4, 2 vs 3, First-to-3).
- Gewinner → League Championship Series (First-to-3).
- AL-Champ vs NL-Champ → World Series (First-to-3).

## Tech Stack

- **Next.js 14 (App Router)** + React Server Components + Server Actions
- **Prisma ORM** mit **PostgreSQL** (auf Vercel am besten via
  [Neon](https://neon.tech) oder
  [Vercel Postgres](https://vercel.com/storage/postgres))
- **Tailwind CSS**

## Lokales Setup

```bash
npm install
cp .env.example .env     # DATABASE_URL eintragen (Neon/Postgres)
npx prisma db push        # Tabellen erstellen
npm run db:seed           # 30 MLB-Teams laden
npm run dev
```

App läuft auf http://localhost:3000.

## Deployment auf Vercel

1. Repo zu GitHub pushen (passiert automatisch beim Fertigstellen).
2. Auf vercel.com das Repo importieren.
3. Im Vercel-Dashboard **Storage → Create Database → Neon Postgres** (oder
   Vercel Postgres) hinzufügen. Vercel hängt dann automatisch die Env-Vars
   (`DATABASE_URL`) an das Projekt.
4. In "Settings → Environment Variables" sicherstellen, dass `DATABASE_URL`
   gesetzt ist.
5. Deploy starten. Beim ersten Deploy in der Vercel-CLI oder via `vercel env
   pull` lokal verbinden und einmalig ausführen:

   ```bash
   npx prisma db push
   npm run db:seed
   ```

   Alternativ per Vercel "Post-deploy script" oder einmalig via Neon-SQL-Editor.

Danach ist die App unter deiner Vercel-URL erreichbar und alle Daten werden
persistent in Postgres gespeichert.

## Struktur

```
app/
  page.tsx              Dashboard (aktuelle Saison, Aktionen)
  game/[id]/page.tsx    Inning-für-Inning Tracker
  standings/page.tsx    Divisions-Standings
  history/page.tsx      Mariners Spielverlauf
  playoffs/page.tsx     Playoff-Bracket
lib/
  actions.ts            Server Actions (DB-Mutationen)
  game-logic.ts         Würfellogik, Altessing-Regeln
  standings.ts          Standings-Berechnung
  mlb-teams.ts          Liste der 30 MLB-Teams
  db.ts                 Prisma Client
prisma/
  schema.prisma         Datenmodell
  seed.ts               Team-Seeding
```
