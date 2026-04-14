export type MlbTeam = {
  abbreviation: string;
  name: string;
  city: string;
  league: "AL" | "NL";
  division: "East" | "Central" | "West";
};

export const MLB_TEAMS: MlbTeam[] = [
  // AL East
  { abbreviation: "BAL", name: "Orioles", city: "Baltimore", league: "AL", division: "East" },
  { abbreviation: "BOS", name: "Red Sox", city: "Boston", league: "AL", division: "East" },
  { abbreviation: "NYY", name: "Yankees", city: "New York", league: "AL", division: "East" },
  { abbreviation: "TB",  name: "Rays",    city: "Tampa Bay", league: "AL", division: "East" },
  { abbreviation: "TOR", name: "Blue Jays", city: "Toronto", league: "AL", division: "East" },
  // AL Central
  { abbreviation: "CWS", name: "White Sox", city: "Chicago",   league: "AL", division: "Central" },
  { abbreviation: "CLE", name: "Guardians", city: "Cleveland", league: "AL", division: "Central" },
  { abbreviation: "DET", name: "Tigers",    city: "Detroit",   league: "AL", division: "Central" },
  { abbreviation: "KC",  name: "Royals",    city: "Kansas City", league: "AL", division: "Central" },
  { abbreviation: "MIN", name: "Twins",     city: "Minnesota", league: "AL", division: "Central" },
  // AL West
  { abbreviation: "HOU", name: "Astros",    city: "Houston",   league: "AL", division: "West" },
  { abbreviation: "LAA", name: "Angels",    city: "Los Angeles", league: "AL", division: "West" },
  { abbreviation: "OAK", name: "Athletics", city: "Oakland",   league: "AL", division: "West" },
  { abbreviation: "SEA", name: "Mariners",  city: "Seattle",   league: "AL", division: "West" },
  { abbreviation: "TEX", name: "Rangers",   city: "Texas",     league: "AL", division: "West" },
  // NL East
  { abbreviation: "ATL", name: "Braves",   city: "Atlanta",   league: "NL", division: "East" },
  { abbreviation: "MIA", name: "Marlins",  city: "Miami",     league: "NL", division: "East" },
  { abbreviation: "NYM", name: "Mets",     city: "New York",  league: "NL", division: "East" },
  { abbreviation: "PHI", name: "Phillies", city: "Philadelphia", league: "NL", division: "East" },
  { abbreviation: "WSH", name: "Nationals", city: "Washington", league: "NL", division: "East" },
  // NL Central
  { abbreviation: "CHC", name: "Cubs",     city: "Chicago",     league: "NL", division: "Central" },
  { abbreviation: "CIN", name: "Reds",     city: "Cincinnati",  league: "NL", division: "Central" },
  { abbreviation: "MIL", name: "Brewers",  city: "Milwaukee",   league: "NL", division: "Central" },
  { abbreviation: "PIT", name: "Pirates",  city: "Pittsburgh",  league: "NL", division: "Central" },
  { abbreviation: "STL", name: "Cardinals", city: "St. Louis",  league: "NL", division: "Central" },
  // NL West
  { abbreviation: "ARI", name: "Diamondbacks", city: "Arizona", league: "NL", division: "West" },
  { abbreviation: "COL", name: "Rockies",  city: "Colorado",    league: "NL", division: "West" },
  { abbreviation: "LAD", name: "Dodgers",  city: "Los Angeles", league: "NL", division: "West" },
  { abbreviation: "SD",  name: "Padres",   city: "San Diego",   league: "NL", division: "West" },
  { abbreviation: "SF",  name: "Giants",   city: "San Francisco", league: "NL", division: "West" },
];

export const MARINERS_ABBREVIATION = "SEA";
export const REGULAR_SEASON_GAMES = 20;
export const PLAYOFF_WINS_NEEDED = 3;
