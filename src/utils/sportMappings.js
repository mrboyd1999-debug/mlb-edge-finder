/** PrizePicks league id → app sport label */
export const PRIZEPICKS_MLB_LEAGUE_ID = "2";

export const PRIZEPICKS_LEAGUE_SPORTS = {
  "2": "MLB",
  "3": "MLB",
  "7": "NBA",
  "8": "WNBA",
  "9": "NFL",
  "10": "NCAAF",
  "15": "NHL",
  "26": "Soccer",
  "266": "Unsupported",
  "267": "NBA",
  "268": "WNBA",
};

export const MLB_SPORT = "MLB";
export const APP_SPORTS = { MLB: "MLB" };

export const UNDERDOG_SPORT_SLUGS = {
  mlb: "MLB",
  baseball: "MLB",
  nba: "NBA",
  basketball: "NBA",
  wnba: "WNBA",
  nfl: "NFL",
  ncaaf: "NCAAF",
  nhl: "NHL",
  soc: "Soccer",
  soccer: "Soccer",
  football: "Soccer",
  epl: "Soccer",
  mls: "Soccer",
};

export function sportFromPrizePicksLeague(leagueRecord = {}, leagueId = "") {
  const id = String(leagueId || leagueRecord?.id || leagueRecord?.attributes?.league_id || "");
  if (PRIZEPICKS_LEAGUE_SPORTS[id]) return PRIZEPICKS_LEAGUE_SPORTS[id];

  const attrs = leagueRecord?.attributes || {};
  const text = [
    attrs.name,
    attrs.display_name,
    attrs.league_name,
    attrs.sport,
    attrs.sport_name,
    attrs.icon,
    attrs.league_icon,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return inferSportFromText(text);
}

/** Canonical app sport label from prop sport/league/text aliases. */
export function normalizeSportLabel(value = "", league = "") {
  const text = `${value} ${league}`.trim();
  if (!text) return "";
  const inferred = inferSportFromText(text, { league });
  if (inferred && inferred !== "Unsupported") return inferred;
  return String(value || "").trim();
}

const SPORT_EQUIVALENTS = {
  MLB: new Set(["mlb", "baseball", "majorleaguebaseball", "baseballmlb", "baseball_mlb"]),
  NBA: new Set(["nba", "basketball", "basketballnba", "basketball_nba"]),
  WNBA: new Set(["wnba", "basketballwnba", "basketball_wnba", "womensbasketball"]),
  NFL: new Set(["nfl", "football"]),
  NCAAF: new Set(["ncaaf", "college football", "collegefootball"]),
  NHL: new Set(["nhl", "hockey"]),
  Soccer: new Set(["soccer", "football", "epl", "mls", "laliga", "premier"]),
  Tennis: new Set(["tennis", "tennisatp", "tenniswta", "tennisatpwta", "atp", "wta"]),
  "ATP Tennis": new Set(["atp", "tennis", "tennisatp", "mens tennis", "men's tennis"]),
  "WTA Tennis": new Set(["wta", "tennis", "tenniswta", "women's tennis", "womens tennis"]),
};

function sportToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function sportLabelsMatch(propSport = "", selectedSport = "", propLeague = "") {
  if (!selectedSport || selectedSport === "all") return true;
  const propCanonical = normalizeSportLabel(propSport, propLeague);
  const selectedCanonical = normalizeSportLabel(selectedSport);
  if (propCanonical && selectedCanonical && propCanonical === selectedCanonical) return true;

  const propTokenValue = sportToken(propSport || propLeague);
  const selectedToken = sportToken(selectedCanonical);
  if (propTokenValue && selectedToken && propTokenValue === selectedToken) return true;

  const aliases = SPORT_EQUIVALENTS[selectedCanonical];
  if (aliases && propTokenValue && aliases.has(propTokenValue)) return true;

  return propSport === selectedSport;
}

export function inferSportFromText(text = "", context = {}) {
  const key = String(text || "").toLowerCase();
  const compact = key.replace(/[^a-z0-9]/g, "");
  const blob = [text, context.description, context.playerName, context.opponent, context.statType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(esports?|e-sports|cs2|csgo|valorant|dota|lol\b|map ?\d|clutch|lazyfeel|clozer)\b/i.test(blob)) return "Esports";
  if (/\b(cricket|ipl|t20|odi|test cricket|wicket|innings?|royal challengers|sunrisers|kolkata|delhi capitals)\b/i.test(blob)) {
    return "Unsupported";
  }
  if (key.includes("wta") || (key.includes("women") && key.includes("tennis"))) return "WTA Tennis";
  if (key.includes("atp") || key.includes("tennis")) return "ATP Tennis";

  if (/\bseason\s+pass\s+yards\b/i.test(blob)) return "NFL";
  if (/\bseason\s+(receiving|rushing)\s+yards\b/i.test(blob)) return "NFL";
  if (/\bpass\s+yards\b/i.test(blob) && !/\bpitch/.test(blob)) return "NFL";
  if (/\b(receiving|rushing)\s+yards\b/i.test(blob) && !/\bmlb\b/.test(blob)) return "NFL";
  if (/\bpass\s+touchdowns?\b/i.test(blob)) return "NFL";
  if (/\binterceptions?\b/i.test(blob) && /\bpass/.test(blob)) return "NFL";

  if (compact.includes("wnba") || compact.includes("basketballwnba") || key.includes("women's basketball") || key.includes("womens basketball")) {
    return "WNBA";
  }
  if ((compact === "nba" || compact.includes("basketballnba") || key.includes("nba")) && !key.includes("wnba")) return "NBA";
  if (compact.includes("mlb") || key.includes("baseball") || compact.includes("baseballmlb") || key.includes("baseball_mlb")) {
    return "MLB";
  }
  if (key.includes("major league baseball") || compact.includes("majorleaguebaseball")) return "MLB";
  if (key.includes("nhl") || key.includes("hockey")) return "NHL";
  if (key.includes("ncaaf") || key.includes("college football")) return "NCAAF";
  if (key.includes("nfl") && !key.includes("soccer")) return "NFL";
  if (
    key.includes("soccer") ||
    key.includes("epl") ||
    key.includes("mls") ||
    key.includes("laliga") ||
    key.includes("premier") ||
    (key.includes("football") && !key.includes("college") && !key.includes("nfl"))
  ) {
    return "Soccer";
  }

  const description = String(context.description || "").toUpperCase();
  const statHint = String(context.statType || context.description || "").toLowerCase();
  const baseballMarket = /strikeout|pitch|hit|rbi|run|base|inning/.test(statHint);
  if (
    baseballMarket &&
    /\b(ARI|ATL|BAL|BOS|CHC|CIN|CLE|COL|CWS|DET|HOU|KC|LAA|LAD|MIA|MIL|MIN|NYM|NYY|OAK|PHI|PIT|SD|SEA|SF|STL|TB|TEX|TOR|WSH)\b/.test(description)
  ) {
    return "MLB";
  }
  if (description.includes("WNBA") || description.includes("GSV") || description.includes("LAS")) return "WNBA";

  return "";
}

export function sportFromUnderdogGame(game = {}, overUnder = {}) {
  const slug = String(game.sport_id || game.sport || overUnder.sport || "").toLowerCase();
  const compact = slug.replace(/[^a-z0-9]/g, "");
  if (UNDERDOG_SPORT_SLUGS[compact]) return UNDERDOG_SPORT_SLUGS[compact];
  return inferSportFromText(`${game.title || ""} ${game.short_title || ""} ${overUnder.title || ""}`);
}

export function isMlbSport(value = "") {
  return normalizeSportLabel(value) === "MLB";
}

export function getActiveFetchSport() {
  return "MLB";
}

/** @deprecated MLB-only app */
export function sportFromUnderdogSlug() {
  return "MLB";
}
