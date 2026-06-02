import { inferSportFromText, sportLabelsMatch } from "./sportMappings.js";
import {
  enrichPropMarketFields,
  getMarketSupportTier,
  isNoveltyMarket,
  isRegisteredMarket,
  isComboMarket,
  isResearchOnlyMarket,
} from "./marketNormalization.js";

/** App sport labels — never default unknown props to MLB. */
export const APP_SPORTS = {
  MLB: "MLB",
  NBA: "NBA",
  WNBA: "WNBA",
  Soccer: "Soccer",
  Tennis: "Tennis",
  ATP: "ATP Tennis",
  WTA: "WTA Tennis",
  Esports: "Esports",
  NFL: "NFL",
  NHL: "NHL",
  NCAAF: "NCAAF",
  Unsupported: "Unsupported",
};

const ESPORTS_KEYWORDS =
  /\b(esports?|e-sports|cs2|csgo|counterstrike|valorant|league of legends|lol\b|dota|overwatch|rainbow six|siege|call of duty|cod\b|rocket league|map ?\d|kills?|deaths?|headshots?|clutches?|rounds? won)\b/i;

const TENNIS_KEYWORDS =
  /\b(tennis|atp|wta|grand slam|roland garros|wimbledon|us open|australian open|set \d|total games|aces?|double faults?|break points?|tiebreak)\b/i;

const MLB_TEAM_ABBREVS =
  /\b(ARI|ATL|BAL|BOS|CHC|CIN|CLE|COL|CWS|DET|HOU|KC|LAA|LAD|MIA|MIL|MIN|NYM|NYY|OAK|PHI|PIT|SD|SEA|SF|STL|TB|TEX|TOR|WSH)\b/;

const CROSS_SPORT_JUNK_PATTERNS = [
  /\bdisposals?\b/i,
  /\bmaps?\s*(won|1|2|3)?\b/i,
  /\bfirst blood\b/i,
  /\bdragon\b/i,
  /\bbaron\b/i,
  /\b(wicket|cricket|ipl|t20|odi|1st inning runs)\b/i,
];

const SPORT_ALLOWED_MARKETS = {
  MLB: [
    "pitches thrown",
    "pitcher strikeouts",
    "strikeout",
    "hits+runs+rbis",
    "total bases",
    "singles",
    "single",
    "1b",
    "doubles",
    "double",
    "2b",
    "triples",
    "triple",
    "3b",
    "home runs",
    "home run",
    "hr",
    "stolen bases",
    "stolen base",
    "sb",
    "walks",
    "hits",
    "rbis",
    "runs",
    "outs",
    "pitching outs",
    "hits allowed",
    "fantasy score",
    "walks",
    "walks allowed",
    "earned runs",
    "earned runs allowed",
  ],
  NBA: [
    "points",
    "rebounds",
    "assists",
    "pr",
    "pa",
    "ra",
    "pra",
    "3-pointer",
    "3-pt",
    "threes",
    "steals",
    "blocks",
    "fantasy score",
    "turnover",
    "double-double",
    "double double",
    "1st 3 minutes",
    "first 3 minutes",
    "quarter",
  ],
  WNBA: [
    "points",
    "rebounds",
    "assists",
    "pr",
    "pa",
    "ra",
    "pra",
    "3-pointer",
    "3-pt",
    "threes",
    "steals",
    "blocks",
    "fantasy score",
    "turnover",
    "double-double",
    "double double",
    "1st 3 minutes",
    "first 3 minutes",
    "quarter",
  ],
  Soccer: ["shots", "shots on target", "passes", "crosses", "goals allowed", "goalie saves", "saves", "tackles", "fantasy score"],
  Tennis: [
    "total games",
    "total sets",
    "total tie breaks",
    "tie breaks",
    "games won",
    "player games",
    "aces",
    "double faults",
    "break points",
    "fantasy score",
    "sets",
    "points",
  ],
  NHL: ["time on ice", "toi", "shots", "goals", "assists", "saves", "fantasy score"],
  Esports: ["kills", "deaths", "maps", "headshots", "rounds", "fantasy score", "assists"],
};

export function normalizeMarketKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "");
}

export function isEsportsText(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  return ESPORTS_KEYWORDS.test(blob);
}

export function isTennisText(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  return TENNIS_KEYWORDS.test(blob);
}

export function isEsportsProp(prop = {}) {
  if (prop.sport === APP_SPORTS.Esports) return true;
  return isEsportsText(
    prop.sport,
    prop.league,
    prop.statType,
    prop.description,
    prop.playerName,
    prop.opponent,
    prop.team
  );
}

export function isTennisSportLabel(sport = "") {
  return sport === APP_SPORTS.Tennis || sport === APP_SPORTS.ATP || sport === APP_SPORTS.WTA;
}

export function tennisDisplaySport(sport = "") {
  if (sport === APP_SPORTS.WTA) return APP_SPORTS.Tennis;
  if (sport === APP_SPORTS.ATP) return APP_SPORTS.Tennis;
  return sport;
}

export function classifyPropSport(prop = {}, context = {}) {
  const league = prop.league || context.league || "";
  const sport = prop.sport || "";
  const statType = prop.statType || context.statType || "";
  const description = prop.description || context.description || "";
  const playerName = prop.playerName || context.playerName || "";
  const opponent = prop.opponent || context.opponent || "";
  const team = prop.team || context.team || "";
  const blob = [league, sport, statType, description, playerName, opponent, team].filter(Boolean).join(" ");

  if (isEsportsText(blob)) return APP_SPORTS.Esports;

  const fromInfer = inferSportFromText(blob, { description, playerName, opponent });
  if (fromInfer) {
    if (fromInfer === APP_SPORTS.ATP || fromInfer === APP_SPORTS.WTA) return fromInfer;
    return fromInfer;
  }

  if (isTennisText(blob) || looksLikeTennisMatchup(playerName, opponent, description)) {
    return classifyTennisFromNames(playerName, opponent);
  }

  const leagueKey = String(league).toLowerCase();
  const sportKey = String(sport).toLowerCase();
  if (leagueKey.includes("mlb") || sportKey.includes("mlb") || sportKey.includes("baseball")) return APP_SPORTS.MLB;
  if (leagueKey.includes("wnba") || sportKey.includes("wnba")) return APP_SPORTS.WNBA;
  if (leagueKey.includes("nba") || sportKey.includes("nba")) return APP_SPORTS.NBA;
  if (leagueKey.includes("soccer") || leagueKey.includes("epl") || leagueKey.includes("mls") || sportKey.includes("soccer")) {
    return APP_SPORTS.Soccer;
  }
  if (leagueKey.includes("nhl") || sportKey.includes("nhl") || sportKey.includes("hockey")) return APP_SPORTS.NHL;

  if (MLB_TEAM_ABBREVS.test(description) && !isTennisText(blob) && !isEsportsText(blob)) {
    const hasBaseballMarket = normalizeMarketKey(statType).match(/strikeout|pitch|hit|rbi|run|base|inning/);
    if (hasBaseballMarket) return APP_SPORTS.MLB;
  }

  return APP_SPORTS.Unsupported;
}

function looksLikeTennisMatchup(playerName = "", opponent = "", description = "") {
  const text = `${playerName} ${opponent} ${description}`;
  if (/\bvs\.?\b/i.test(text) && !MLB_TEAM_ABBREVS.test(text)) return true;
  if (/ v /i.test(text) && playerName.includes(" ") && opponent.includes(" ")) return true;
  return false;
}

function classifyTennisFromNames(playerName = "", opponent = "") {
  const combined = `${playerName} ${opponent}`.toLowerCase();
  const wtaHints = ["swiatek", "sabalenka", "gauff", "rybakina", "pegula", "jabeur"];
  if (wtaHints.some((h) => combined.includes(h))) return APP_SPORTS.WTA;
  return APP_SPORTS.ATP;
}

export function isUnsupportedMarket(statType = "", sport = "") {
  if (!statType) return true;
  if (sport === APP_SPORTS.Unsupported) return true;
  if (sport === APP_SPORTS.Esports) {
    const key = normalizeMarketKey(statType);
    return !SPORT_ALLOWED_MARKETS.Esports.some((allowed) => key.includes(normalizeMarketKey(allowed)));
  }

  const supportTier = getMarketSupportTier(statType, sport);
  if (supportTier >= 1) {
    if (CROSS_SPORT_JUNK_PATTERNS.some((pattern) => pattern.test(statType))) return true;
    if (isComboMarket(statType)) return false;
    if (sport === APP_SPORTS.MLB && /disposal|tackle|foul|rebound|assist|map|kill|death|round/i.test(statType)) return true;
    if ((sport === APP_SPORTS.NBA || sport === APP_SPORTS.WNBA) && /disposal|tackle|pitch|inning|map|kill|death/i.test(statType)) {
      return true;
    }
    if (isTennisSportLabel(sport) && /disposal|tackle|pitch|rebound|foul/i.test(statType)) return true;
    if (sport === APP_SPORTS.Soccer && /rebound|assist|pitch|strikeout|map|kill/i.test(statType)) return true;
    if (sport === APP_SPORTS.NHL && /disposal|rebound|pitch|strikeout|hit|rbi|inning|map|kill/i.test(statType)) return true;
    return false;
  }

  if (isNoveltyMarket(statType, sport)) return false;

  if (!isRegisteredMarket(statType, sport)) return true;

  if (CROSS_SPORT_JUNK_PATTERNS.some((pattern) => pattern.test(statType))) return true;

  if (isComboMarket(statType)) return false;

  if (sport === APP_SPORTS.MLB && /disposal|tackle|foul|rebound|assist|map|kill|death|round/i.test(statType)) return true;
  if ((sport === APP_SPORTS.NBA || sport === APP_SPORTS.WNBA) && /disposal|tackle|pitch|inning|map|kill|death/i.test(statType)) {
    return true;
  }
  if (isTennisSportLabel(sport) && /disposal|tackle|pitch|rebound|foul/i.test(statType)) return true;
  if (sport === APP_SPORTS.Soccer && /rebound|assist|pitch|strikeout|map|kill/i.test(statType)) return true;
  if (sport === APP_SPORTS.NHL && /disposal|rebound|pitch|strikeout|hit|rbi|inning|map|kill/i.test(statType)) return true;

  return false;
}

export { getMarketSupportTier, isResearchOnlyMarket, isNoveltyMarket };

export function applySportClassification(prop = {}) {
  const sport = classifyPropSport(prop, {
    league: prop.league,
    statType: prop.statType,
    description: prop.description,
    playerName: prop.playerName,
    opponent: prop.opponent,
    team: prop.team,
  });
  const enriched = enrichPropMarketFields({ ...prop, sport });
  const noveltyMarket = isNoveltyMarket(enriched.statType, sport);
  const marketSupportTier = noveltyMarket ? 0 : getMarketSupportTier(enriched.statType, sport);
  const marketResearchOnly = isResearchOnlyMarket(enriched.statType, sport) || noveltyMarket;
  const marketUnsupported = isUnsupportedMarket(enriched.statType, sport);
  const esports = sport === APP_SPORTS.Esports || isEsportsProp({ ...enriched, sport });
  return {
    ...enriched,
    sport,
    classifiedSport: sport,
    marketSupportTier,
    marketResearchOnly,
    marketUnsupported,
    noveltyMarket,
    esports,
    unsupportedSport: sport === APP_SPORTS.Unsupported,
  };
}

export function matchesSelectedSportFilter(prop, selectedSport = "all") {
  if (selectedSport === "all") return true;
  if (selectedSport === APP_SPORTS.Tennis) {
    return isTennisSportLabel(prop.sport) || prop.sport === APP_SPORTS.Tennis || sportLabelsMatch(prop.sport, selectedSport, prop.league);
  }
  if (selectedSport === APP_SPORTS.Esports) return prop.sport === APP_SPORTS.Esports || prop.esports;
  return sportLabelsMatch(prop.sport, selectedSport, prop.league) || prop.sport === selectedSport;
}
