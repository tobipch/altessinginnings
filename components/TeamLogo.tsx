/* eslint-disable @next/next/no-img-element */

/**
 * Maps our internal MLB team abbreviations to the abbreviations used by
 * ESPN's public logo CDN. ESPN serves PNGs at:
 *   https://a.espncdn.com/i/teamlogos/mlb/500/{abbr}.png
 */
const ESPN_ABBR: Record<string, string> = {
  CWS: "chw",
};

function toEspnAbbr(abbr: string): string {
  return ESPN_ABBR[abbr] ?? abbr.toLowerCase();
}

export function teamLogoUrl(abbreviation: string, scoreboard = false): string {
  const a = toEspnAbbr(abbreviation);
  // `scoreboard/` variant is a transparent light-friendly version that looks
  // better on dark backgrounds for smaller list items.
  return scoreboard
    ? `https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${a}.png`
    : `https://a.espncdn.com/i/teamlogos/mlb/500/${a}.png`;
}

export function TeamLogo({
  abbreviation,
  size = 20,
  alt,
  className = "",
  scoreboard = false,
}: {
  abbreviation: string;
  size?: number;
  alt?: string;
  className?: string;
  scoreboard?: boolean;
}) {
  return (
    <img
      src={teamLogoUrl(abbreviation, scoreboard)}
      alt={alt ?? abbreviation}
      width={size}
      height={size}
      className={`inline-block align-middle object-contain ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
