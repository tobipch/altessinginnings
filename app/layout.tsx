import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Altessing-Innings Tracker",
  description: "Track your Seattle Mariners Altessing-Innings season",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        <header className="border-b border-gray-800 bg-mariners-navy/80 backdrop-blur">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg tracking-tight">
              <span className="text-mariners-silver">Altessing</span>
              <span className="text-teal-300">-Innings</span>
            </Link>
            <nav className="flex gap-3 text-sm flex-wrap">
              <Link href="/" className="hover:text-teal-300">Dashboard</Link>
              <Link href="/standings" className="hover:text-teal-300">Standings</Link>
              <Link href="/results" className="hover:text-teal-300">Resultate</Link>
              <Link href="/history" className="hover:text-teal-300">History</Link>
              <Link href="/playoffs" className="hover:text-teal-300">Playoffs</Link>
              <Link href="/records" className="hover:text-teal-300">Records</Link>
              <Link href="/head-to-head" className="hover:text-teal-300">H2H</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
        <footer className="max-w-5xl mx-auto px-4 py-6 text-xs text-gray-500">
          Seattle Mariners &middot; Altessing-Innings custom league
        </footer>
      </body>
    </html>
  );
}
