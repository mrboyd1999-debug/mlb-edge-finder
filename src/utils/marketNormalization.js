/** PrizePicks / Underdog compact aliases -> canonical market keys. */
const COMPACT_ALIASES = {
  rebsasts: "ra",
  reboundsassists: "ra",
  ra: "ra",
  ptsrebs: "pr",
  ptsreb: "pr",
  pointsrebounds: "pr",
  ptsasts: "pa",
  pointsassists: "pa",
  ptsrebsasts: "pra",
  ptsrebasts: "pra",
  pointsreboundsassists: "pra",
  pra: "pra",
  pr: "pr",
  pa: "pa",
  hitsrunsrbis: "hrr",
  hitsrunsandrbis: "hrr",
  hrr: "hrr",
  pitchesthrown: "pitchesThrown",
  pitchcount: "pitchesThrown",
  strikeouts: "strikeouts",
  pitcherstrikeouts: "strikeouts",
  totalbases: "totalBases",
  tb: "totalBases",
  h: "hits",
  hits: "hits",
  singles: "singles",
  single: "singles",
  "1b": "singles",
  doubles: "doubles",
  double: "doubles",
  "2b": "doubles",
  triples: "triples",
  triple: "triples",
  homeruns: "homeRuns",
  homerun: "homeRuns",
  hr: "homeRuns",
  stolenbases: "stolenBases",
  stolenbase: "stolenBases",
  sb: "stolenBases",
  bb: "batterWalks",
  batterwalks: "batterWalks",
  rbis: "rbis",
  rbi: "rbis",
  runs: "runs",
  outs: "outs",
  pitchingouts: "outs",
  pitchingout: "outs",
  hitsallowed: "hitsAllowed",
  earnedrunsallowed: "earnedRuns",
  earnedrun: "earnedRuns",
  earnedruns: "earnedRuns",
  walksallowed: "walks",
  "3ptmade": "threes",
  "3pt": "threes",
  "3pm": "threes",
  doubledouble: "doubleDouble",
  points1st3minutes: "pointsFirst3Min",
  pointsfirst3minutes: "pointsFirst3Min",
  pts1st3min: "pointsFirst3Min",
  quarterswith3points: "quarterPoints",
  quarterwith3points: "quarterPoints",
  quarters3points: "quarterPoints",
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
  threepointersmade: "threes",
  threepointers: "threes",
  "3pointersmade": "threes",
  steals: "steals",
  blocks: "blocks",
  turnovers: "turnovers",
  fantasyscore: "fantasyScore",
  totalgames: "totalGames",
  gameswon: "gamesWon",
  playergameswon: "gamesWon",
  aces: "aces",
  doublefaults: "doubleFaults",
  breakpoint: "breakPoints",
  breakpoints: "breakPoints",
  totalsets: "totalSets",
  totaltiebreaks: "totalTieBreaks",
  totaltiebreak: "totalTieBreaks",
  tiebreaks: "totalTieBreaks",
  timeonice: "timeOnIce",
  toi: "timeOnIce",
  shots: "shots",
  shotsontarget: "shotsOnTarget",
  passesattempted: "passesAttempted",
  passes: "passesAttempted",
  crosses: "crosses",
  goalsallowed: "goalsAllowed",
  goaliesaves: "goalieSaves",
  goals: "goals",
  goal: "goals",
  saves: "goalieSaves",
  tackles: "tackles",
};

/** Canonical storage labels for normalized stat types. */
const CANONICAL_STAT_TYPES = {
  pr: "Points + Rebounds",
  pa: "Points + Assists",
  ra: "Rebounds + Assists",
  pra: "Points + Rebounds + Assists",
  hrr: "Hits+Runs+RBIs",
  pitchesThrown: "Pitches Thrown",
  strikeouts: "Pitcher Strikeouts",
  totalBases: "Total Bases",
  singles: "Singles",
  doubles: "Doubles",
  triples: "Triples",
  homeRuns: "Home Runs",
  stolenBases: "Stolen Bases",
  batterWalks: "Walks",
  hits: "Hits",
  rbis: "RBIs",
  runs: "Runs",
  outs: "Pitching Outs",
  hitsAllowed: "Hits Allowed",
  earnedRuns: "Earned Runs Allowed",
  walks: "Walks Allowed",
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  threes: "3-Pointers Made",
  doubleDouble: "Double-Double",
  pointsFirst3Min: "Points 1st 3 Minutes",
  quarterPoints: "Quarters with 3+ Points",
  steals: "Steals",
  blocks: "Blocks",
  turnovers: "Turnovers",
  fantasyScore: "Fantasy Score",
  totalGames: "Total Games",
  totalSets: "Total Sets",
  totalTieBreaks: "Total Tie Breaks",
  gamesWon: "Player Games Won",
  aces: "Aces",
  doubleFaults: "Double Faults",
  breakPoints: "Break Points",
  shots: "Shots",
  goals: "Goals",
  timeOnIce: "Time On Ice",
  shotsOnTarget: "Shots On Target",
  passesAttempted: "Passes Attempted",
  crosses: "Crosses",
  goalsAllowed: "Goals Allowed",
  goalieSaves: "Goalie Saves",
  tackles: "Tackles",
};

/** Short UI labels for combo and single markets. */
export const MARKET_DISPLAY_LABELS = {
  pr: "PR",
  pa: "PA",
  ra: "RA",
  pra: "PRA",
  hrr: "HRR",
  pitchesThrown: "Pitches",
  strikeouts: "K",
  totalBases: "TB",
  singles: "1B",
  doubles: "2B",
  triples: "3B",
  homeRuns: "HR",
  stolenBases: "SB",
  batterWalks: "BB",
  hits: "H",
  rbis: "RBI",
  runs: "R",
  outs: "Outs",
  hitsAllowed: "HA",
  earnedRuns: "ER",
  walks: "BB",
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  threes: "3PM",
  doubleDouble: "DD",
  pointsFirst3Min: "1Q3",
  quarterPoints: "Q3+",
  steals: "STL",
  blocks: "BLK",
  turnovers: "TO",
  fantasyScore: "Fantasy",
  totalGames: "Games",
  totalSets: "Sets",
  totalTieBreaks: "TB",
  gamesWon: "Games Won",
  aces: "Aces",
  doubleFaults: "DF",
  breakPoints: "BP",
  goals: "G",
  timeOnIce: "TOI",
  shots: "Shots",
  shotsOnTarget: "SOT",
  passesAttempted: "Passes",
  crosses: "Crosses",
  goalsAllowed: "GA",
  goalieSaves: "Saves",
  tackles: "Tackles",
};

/** Supported market keys by sport — alias for validator/scoring allowlists. */
export const SUPPORTED_MARKETS = {
  MLB: new Set([
    "pitchesThrown",
    "strikeouts",
    "hrr",
    "totalBases",
    "singles",
    "doubles",
    "triples",
    "homeRuns",
    "stolenBases",
    "batterWalks",
    "hits",
    "rbis",
    "runs",
    "outs",
    "hitsAllowed",
    "fantasyScore",
    "walks",
    "earnedRuns",
  ]),
  NBA: new Set([
    "points",
    "rebounds",
    "assists",
    "pr",
    "pa",
    "ra",
    "pra",
    "threes",
    "steals",
    "blocks",
    "fantasyScore",
    "turnovers",
    "doubleDouble",
    "pointsFirst3Min",
    "quarterPoints",
  ]),
  WNBA: new Set([
    "points",
    "rebounds",
    "assists",
    "pr",
    "pa",
    "ra",
    "pra",
    "threes",
    "steals",
    "blocks",
    "fantasyScore",
    "turnovers",
    "doubleDouble",
    "pointsFirst3Min",
    "quarterPoints",
  ]),
  Tennis: new Set([
    "totalGames",
    "totalSets",
    "totalTieBreaks",
    "gamesWon",
    "aces",
    "doubleFaults",
    "breakPoints",
    "fantasyScore",
    "sets",
    "points",
  ]),
  NHL: new Set([
    "timeOnIce",
    "shots",
    "goals",
    "assists",
    "points",
    "goalieSaves",
    "fantasyScore",
  ]),
};

/** @deprecated alias — use SUPPORTED_MARKETS */
export const SPORT_MARKET_REGISTRY = SUPPORTED_MARKETS;

const COMBO_MARKET_KEYS = new Set(["pr", "pa", "ra", "pra", "hrr"]);
const TENNIS_SPORTS = new Set(["Tennis", "ATP Tennis", "WTA Tennis"]);

/** Tier 1 = fully supported and scored; Tier 2 = research-only / lower confidence. */
export const MARKET_SUPPORT_TIER_2 = {
  MLB: new Set(["doubles", "homeRuns", "stolenBases", "triples", "batterWalks", "outs"]),
  NBA: new Set(["doubleDouble", "pointsFirst3Min", "quarterPoints"]),
  WNBA: new Set(["doubleDouble", "pointsFirst3Min", "quarterPoints"]),
  Tennis: new Set(["totalSets", "totalTieBreaks", "breakPoints"]),
  NHL: new Set(["timeOnIce"]),
};

function tier2RegistryForSport(sport = "") {
  if (TENNIS_SPORTS.has(sport)) return MARKET_SUPPORT_TIER_2.Tennis;
  return MARKET_SUPPORT_TIER_2[sport];
}

export function isMlbHitterMarketKey(key = "") {
  return [
    "singles",
    "doubles",
    "triples",
    "homeRuns",
    "stolenBases",
    "batterWalks",
    "hits",
    "runs",
    "rbis",
    "totalBases",
    "hrr",
    "fantasyScore",
  ].includes(String(key || ""));
}

export function getMarketSupportTier(statType = "", sport = "") {
  const key = canonicalMarketKey(statType);
  if (!key) return 0;
  const registry = registryForSport(sport);
  if (!registry?.has(key)) return 0;
  if (tier2RegistryForSport(sport)?.has(key)) return 2;
  return 1;
}

export function isNoveltyMarket(statType = "", sport = "") {
  if (!statType || !sport || sport === "Unsupported") return false;
  if (getMarketSupportTier(statType, sport) >= 1) return false;
  if (!registryForSport(sport)) return false;
  const text = String(statType || "");
  if (/disposal|first blood|wicket|cricket|map \d|headshot|baron|dragon|round won|kill|death/i.test(text)) return false;
  return true;
}

export function isResearchOnlyMarket(statType = "", sport = "") {
  return getMarketSupportTier(statType, sport) === 2;
}

export function compactMarketKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function canonicalMarketKey(statType = "") {
  const compact = compactMarketKey(statType);
  if (!compact) return "";

  if (COMPACT_ALIASES[compact]) return COMPACT_ALIASES[compact];

  if (compact.includes("pointsreboundsassists") || compact.includes("ptsrebsasts") || compact.includes("ptsrebasts")) {
    return "pra";
  }
  if (compact.includes("reboundsassists") || compact.includes("rebsasts")) return "ra";
  if (compact.includes("pointsrebounds") || compact.includes("ptsrebs")) return "pr";
  if (compact.includes("pointsassists") || compact.includes("ptsasts")) return "pa";
  if (compact.includes("hitsrunsrbis") || compact.includes("hitsrunsandrbis")) return "hrr";
  if (compact.includes("pitchesthrown") || compact.includes("pitchcount")) return "pitchesThrown";
  if (compact.includes("pitchingout")) return "outs";
  if (compact.includes("hitsallowed")) return "hitsAllowed";
  if (compact.includes("earnedrun")) return "earnedRuns";
  if (compact.includes("walksallowed")) return "walks";
  if (compact.includes("doubledouble")) return "doubleDouble";
  if (compact.includes("1st3min") || compact.includes("first3min")) return "pointsFirst3Min";
  if (compact.includes("quarter") && (compact.includes("3point") || compact.includes("3pt") || compact.includes("3plus"))) {
    return "quarterPoints";
  }
  if (compact.includes("stolenbase") || compact === "sb") return "stolenBases";
  if (compact.includes("homerun") || compact === "hr") return "homeRuns";
  if (compact === "1b") return "singles";
  if (compact.includes("single") && !compact.includes("singlegame")) return "singles";
  if (compact === "2b") return "doubles";
  if (compact === "doubles" || compact === "double") return "doubles";
  if (compact.includes("triple") && !compact.includes("play")) return "triples";
  if (compact.includes("strikeout")) return "strikeouts";
  if (compact.includes("totalbases") || compact === "tb") return "totalBases";
  if (compact.includes("3ptmade") || compact.includes("3pointers") || compact.includes("threepointers") || compact === "3pm" || compact === "3pt") {
    return "threes";
  }
  if (compact.includes("shotsontarget")) return "shotsOnTarget";
  if (compact === "shots" || compact.includes("shotsattempted")) return "shots";
  if (compact.includes("passesattempted") || compact === "passes") return "passesAttempted";
  if (compact.includes("crosses") || compact === "cross") return "crosses";
  if (compact.includes("goalsallowed")) return "goalsAllowed";
  if (compact.includes("goaliesaves") || compact.includes("keepersaves") || compact === "saves") return "goalieSaves";
  if (compact.includes("fantasyscore")) return "fantasyScore";
  if (compact.includes("gameswon") || compact.includes("playergames")) return "gamesWon";
  if (compact.includes("totalgames")) return "totalGames";
  if (compact.includes("totalsets")) return "totalSets";
  if (compact.includes("totaltiebreak") || compact.includes("tiebreak")) return "totalTieBreaks";
  if (compact.includes("timeonice") || compact === "toi") return "timeOnIce";
  if (compact.includes("doublefault")) return "doubleFaults";
  if (compact.includes("breakpoint")) return "breakPoints";
  if (compact.includes("ace")) return "aces";
  if (compact.includes("tackles")) return "tackles";
  if (compact === "walks" || compact === "bb" || compact.includes("batterwalk")) return "batterWalks";
  if (compact === "h") return "hits";
  if (compact === "hits") return "hits";
  if (compact === "rbis" || compact === "rbi") return "rbis";
  if (compact === "runs") return "runs";
  if (compact === "points") return "points";
  if (compact === "rebounds") return "rebounds";
  if (compact === "assists") return "assists";

  return compact;
}

/** Resolve canonical market key from prop fields — never throws. */
export function resolvePropMarketKey(prop = {}) {
  const raw =
    prop?.canonicalMarketKey ||
    prop?.marketKey ||
    prop?.market ||
    prop?.statType ||
    prop?.propType ||
    prop?.stat ||
    prop?.type ||
    "";

  if (typeof raw === "string" && COMPACT_ALIASES[compactMarketKey(raw)]) {
    return COMPACT_ALIASES[compactMarketKey(raw)];
  }

  const key = canonicalMarketKey(String(raw || ""));
  return key || "";
}

/** @deprecated alias kept for existing imports */
export function canonicalStatType(statType = "") {
  return canonicalMarketKey(statType);
}

export function normalizeMarketStatType(statType = "") {
  const key = canonicalMarketKey(statType);
  if (key && CANONICAL_STAT_TYPES[key]) return CANONICAL_STAT_TYPES[key];
  return String(statType || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function marketDisplayLabel(statType = "", sport = "") {
  const key = canonicalMarketKey(statType);
  if (key && MARKET_DISPLAY_LABELS[key]) return MARKET_DISPLAY_LABELS[key];
  const text = String(statType || "").trim();
  if (!text) return "Prop";
  if (text.length <= 16) return text;
  return key ? key.toUpperCase() : text;
}

/** Full readable market name for research cards (no abbreviations). */
export function fullMarketDisplayLabel(statType = "", sport = "") {
  const key = canonicalMarketKey(statType);
  if (key && CANONICAL_STAT_TYPES[key]) return CANONICAL_STAT_TYPES[key];
  const normalized = normalizeMarketStatType(statType);
  if (normalized) return normalized;
  const text = String(statType || "").trim();
  return text || "Prop";
}

export function isComboMarketKey(key = "") {
  return COMBO_MARKET_KEYS.has(String(key || ""));
}

export function isComboMarket(statType = "") {
  return isComboMarketKey(canonicalMarketKey(statType));
}

function registryForSport(sport = "") {
  if (TENNIS_SPORTS.has(sport)) return SPORT_MARKET_REGISTRY.Tennis;
  return SPORT_MARKET_REGISTRY[sport] || null;
}

export function isRegisteredMarket(statType = "", sport = "") {
  const key = canonicalMarketKey(statType);
  if (!key) return false;
  const registry = registryForSport(sport);
  if (!registry) return false;
  return registry.has(key);
}

export function enrichPropMarketFields(prop = {}) {
  const marketKey = canonicalMarketKey(prop.statType);
  const statType = normalizeMarketStatType(prop.statType);
  const marketLabel = marketDisplayLabel(prop.statType, prop.sport);
  return {
    ...prop,
    statType,
    marketKey,
    marketLabel,
    isComboMarket: isComboMarketKey(marketKey),
  };
}
