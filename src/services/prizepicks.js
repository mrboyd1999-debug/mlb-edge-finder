import { cachedFetch } from "./fetchUtil.js";

const PRIZEPICKS_URLS = [
  "/api/prizepicks/projections?per_page=250&single_stat=true&game_mode=pickem",
  "/api/prizepicks/projections?per_page=100&single_stat=true&game_mode=pickem",
  "/api/prizepicks/projections?single_stat=true&game_mode=pickem",
  "/api/prizepicks/projections",
  "/api/prizepicks",
];
const PRIZEPICKS_CACHE_KEY = "dfs-prizepicks-last-good-payload";
const PRIZEPICKS_CACHE_MAX_MS = 5 * 60 * 1000;

const SPORT_ALIASES = {
  mlb: "MLB",
  baseball: "MLB",
  nhl: "NHL",
  hockey: "NHL",
  nfl: "NFL",
  ncaaf: "NCAAF",
  "college football": "NCAAF",
  wnba: "WNBA",
  nba: "NBA",
  basketball: "NBA",
  atp: "ATP Tennis",
  mens_tennis: "ATP Tennis",
  "men's tennis": "ATP Tennis",
  wta: "WTA Tennis",
  womens_tennis: "WTA Tennis",
  "women's tennis": "WTA Tennis",
  tennis: "ATP Tennis",
  soccer: "Soccer",
  football: "Soccer",
};

const WTA_NAME_HINTS = new Set([
  "aliyah",
  "amandine",
  "ashlyn",
  "bianca",
  "daphnee",
  "dominika",
  "eva",
  "julia",
  "karolina",
  "katherine",
  "laura",
  "luisina",
  "maddison",
  "marina",
  "margaux",
  "robin",
  "viktoria",
  "yeon",
]);

export async function fetchPrizePicksProps({ sport = "all", statType = "all" } = {}) {
  let lastError = null;

  for (const url of PRIZEPICKS_URLS) {
    try {
      const response = await cachedFetch(url, {
        cache: "no-store",
        credentials: "omit",
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        lastError = new Error(`PrizePicks returned status ${response.status}.`);
        if (response.status === 429) break;
        continue;
      }

      const payload = await response.json();
      const setupWarning = setupWarningFromPayload(payload, "PrizePicks");
      if (payload?.error && payload?.needsSetup) {
        return {
          source: "PrizePicks",
          status: "Setup Needed",
          props: [],
          warnings: [],
        };
      }
      if (payload?.error) {
        return {
          source: "PrizePicks",
          status: "Failed",
          props: [],
          warnings: setupWarning ? [setupWarning] : ["PrizePicks unavailable."],
        };
      }

      writeCachedPayload(payload);

      return {
        source: "PrizePicks",
        status: "Connected",
        props: normalizePrizePicksPayload(payload, sport, statType),
        warnings: setupWarning ? [setupWarning] : [],
      };
    } catch (error) {
      lastError = error;
    }
  }

  const cachedPayload = readCachedPayload();
  if (cachedPayload) {
    return {
      source: "PrizePicks",
      status: "Connected",
      props: normalizePrizePicksPayload(cachedPayload, sport, statType),
      warnings: ["PrizePicks is rate-limited; showing last cached real lines."],
    };
  }

  throw lastError || new Error("Could not load PrizePicks lines.");
}

function normalizePrizePicksPayload(payload, sport, statType) {
  const normalizedPayload = unwrapProxyPayload(payload);
  if (Array.isArray(normalizedPayload)) {
    return normalizedPayload
      .map((item) => normalizeFlatPrizePicksItem(item))
      .filter(Boolean)
      .filter((prop) => matchesFilter(prop, sport, statType));
  }

  const includedRecords = buildIncludedMap(normalizedPayload.included || []);
  return (normalizedPayload.data || [])
    .map((item) => normalizePrizePicksProjection(item, includedRecords))
    .filter(Boolean)
    .filter((prop) => matchesFilter(prop, sport, statType));
}

function unwrapProxyPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data) && !payload.data.some((item) => item?.type === "projection" || item?.attributes)) return payload.data;
  if (payload?.data && payload?.included) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return payload || {};
}

function setupWarningFromPayload(payload, source) {
  if (!payload?.error && !payload?.needsSetup) return "";
  return payload.message || `${source} proxy needs setup.`;
}

function normalizeFlatPrizePicksItem(item = {}) {
  const line = Number(
    item.line_score ??
      item.line ??
      item.projection ??
      item.stat_value ??
      item.value
  );
  const statType = normalizeStatType(item.stat_type || item.statType || item.market || item.description || item.name);
  const startTime = item.start_time || item.startTime || item.game_time || item.scheduled_at || item.commence_time;
  if (!Number.isFinite(line) || !statType || !startTime) return null;

  const playerName = item.player_name || item.playerName || item.name || item.display_name || item.player || "Unknown Player";
  const playerImage = item.playerImage || item.player_image || item.imageUrl || item.image_url || item.headshot || item.headshot_url || "";
  const oddsType = item.odds_type || item.oddsType || "standard";

  return {
    platform: "PrizePicks",
    sport: normalizeSport(item.league || item.sport || statType, { playerName, opponent: item.opponent || "" }),
    league: item.league || item.sport || "",
    playerName,
    team: item.team || item.team_abbr || item.teamAbbr || "",
    opponent: item.opponent || item.opponent_abbr || item.matchup || "",
    playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    image_url: playerImage,
    player_image: playerImage,
    startTime,
    statType,
    line,
    directionOptions: ["More", "Less"],
    isAdjustedOdds: Boolean(item.adjusted_odds || item.isAdjustedOdds) || oddsType !== "standard",
    oddsType,
    odds_type: oddsType,
    streakOptions: buildPrizePicksStreakOptions(item),
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status: normalizeStatus(item.status || item.state, startTime, item),
    sourceId: item.id || item.projection_id || "",
    raw: item,
  };
}

function normalizePrizePicksProjection(item, included) {
  const attributes = item.attributes || {};

  const relationships = item.relationships || {};
  const player = relatedRecord(included, relationships.new_player || relationships.player);
  const league = relatedRecord(included, relationships.league);
  const game = relatedRecord(included, relationships.game);
  const line = Number(attributes.line_score ?? attributes.line ?? attributes.projection);
  const statType = normalizeStatType(attributes.stat_type || attributes.stat_display_name || attributes.description);
  const startTime = attributes.start_time || attributes.board_time || attributes.game_time || game?.attributes?.start_time;
  const status = normalizeStatus(attributes.status || attributes.state, startTime, attributes);

  if (!Number.isFinite(line) || !statType || !startTime) return null;

  const playerAttributes = player?.attributes || {};
  const gameAttributes = game?.attributes || {};
  const playerName =
    playerAttributes.display_name ||
    playerAttributes.name ||
    playerAttributes.full_name ||
    attributes.name ||
    attributes.player_name ||
    attributes.description ||
    "Unknown Player";
  const playerImage =
    playerAttributes.image_url ||
    playerAttributes.headshot_url ||
    playerAttributes.headshot ||
    playerAttributes.photo_url ||
    playerAttributes.avatar_url ||
    playerAttributes.image ||
    attributes.image_url ||
    attributes.headshot_url ||
    attributes.player_image ||
    "";
  const oddsType = attributes.odds_type || "standard";
  const streakOptions = buildPrizePicksStreakOptions(attributes);
  const team =
    playerAttributes.team_abbr ||
    playerAttributes.team ||
    playerAttributes.team_name ||
    attributes.team_abbr ||
    attributes.team ||
    gameAttributes.home_team ||
    gameAttributes.metadata?.home_team ||
    "";
  const opponent =
    attributes.opponent_abbr ||
    attributes.opponent ||
    attributes.opponent_team ||
    gameAttributes.away_team ||
    gameAttributes.metadata?.away_team ||
    attributes.description ||
    gameAttributes.opponent ||
    "";
  const sport = normalizeSport(league?.attributes?.name || league?.attributes?.display_name || attributes.league || statType, {
    playerName,
    opponent,
  });

  return {
    platform: "PrizePicks",
    sport,
    league: league?.attributes?.name || attributes.league || sport,
    playerName,
    team,
    opponent,
    playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    image_url: playerImage,
    player_image: playerImage,
    startTime,
    statType,
    line,
    directionOptions: ["More", "Less"],
    isAdjustedOdds: Boolean(attributes.adjusted_odds) || oddsType !== "standard",
    oddsType,
    odds_type: oddsType,
    streakOptions,
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status,
    sourceId: item.id,
    raw: item,
  };
}

function buildPrizePicksStreakOptions(attributes = {}) {
  const multiplier = multiplierFromPrizePicks(attributes);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) return [];
  const oddsType = String(attributes.odds_type || attributes.oddsType || "").toLowerCase();
  const verifiedAdjustedOdds = oddsType === "goblin" || oddsType === "demon";
  return [
    {
      side: "Higher",
      multiplier,
      status: normalizeStatus(attributes.status || attributes.state, attributes.start_time || attributes.board_time, attributes),
      multiplierSource: oddsType === "goblin" ? "PrizePicks goblin line" : oddsType === "demon" ? "PrizePicks demon line" : "PrizePicks multiplier field",
      adjustedOddsType: oddsType || "standard",
      verifiedAdjustedOdds,
    },
  ];
}

function multiplierFromPrizePicks(attributes = {}) {
  const direct = [
    attributes.payout_multiplier,
    attributes.multiplier,
    attributes.odds_multiplier,
    attributes.adjusted_payout_multiplier,
    attributes.flash_sale_multiplier,
    attributes.flash_sale_payout_multiplier,
  ]
    .map((value) => Number(value))
    .find(Number.isFinite);
  if (direct != null) return direct;

  const oddsType = String(attributes.odds_type || "").toLowerCase();
  if (oddsType === "goblin") return 0.75;
  if (oddsType === "standard") return 1;
  if (oddsType === "demon") return 1.25;
  return null;
}

function buildIncludedMap(records) {
  const map = new Map();
  records.forEach((record) => {
    map.set(`${record.type}:${record.id}`, record);
  });
  return map;
}

function relatedRecord(included, relationship) {
  const data = relationship?.data;
  if (!data) return null;
  const target = Array.isArray(data) ? data[0] : data;
  if (!target) return null;
  return included.get(`${target.type}:${target.id}`) || null;
}

function normalizeSport(value, context = {}) {
  const key = String(value || "").toLowerCase();
  if (key.includes("wnba") || key.includes("women's basketball") || key.includes("womens basketball")) return "WNBA";
  if (key.includes("nba") && !key.includes("wnba")) return "NBA";
  if (key.includes("wta") || key.includes("women")) return "WTA Tennis";
  if (key.includes("atp") || key.includes("men")) return "ATP Tennis";
  if (key.includes("tennis")) return classifyTennisSport(context);
  const match = Object.entries(SPORT_ALIASES).find(([alias]) => key.includes(alias));
  return match ? match[1] : "Other";
}

function classifyTennisSport({ playerName = "", opponent = "" } = {}) {
  const names = `${playerName} ${opponent}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return names.some((name) => WTA_NAME_HINTS.has(name)) ? "WTA Tennis" : "ATP Tennis";
}

function normalizeStatType(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  const key = normalizeKey(text);
  if (key.includes("pitchesthrown") || key.includes("pitchcount")) return "Pitches Thrown";
  if (key.includes("strikeout")) return "Pitcher Strikeouts";
  if (key.includes("hitsrunsrbis") || key.includes("hrr")) return "Hits+Runs+RBIs";
  if (key.includes("totalbases")) return "Total Bases";
  if (key.includes("pointsreboundsassists") || key === "pra") return "Points + Rebounds + Assists";
  if (key.includes("3pointers") || key.includes("threepointers")) return "3-Pointers Made";
  if (key.includes("shotsontarget")) return "Shots On Target";
  if (key === "shots" || key.includes("shotsattempted")) return "Shots";
  if (key.includes("passesattempted") || key === "passes") return "Passes Attempted";
  if (key.includes("goalsallowed")) return "Goals Allowed";
  if (key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves") return "Goalie Saves";
  if (key.includes("fantasyscore")) return "Fantasy Score";
  if (key.includes("gameswon") || key.includes("playergames")) return "Player Games Won";
  if (key.includes("totalgames")) return "Total Games";
  if (key.includes("doublefault")) return "Double Faults";
  return text;
}

function normalizeStatus(status, startTime, attributes = {}) {
  const lower = String(status || "").toLowerCase();
  const start = new Date(startTime).getTime();
  if (attributes.is_live || attributes.in_game) return "live";
  if (lower.includes("locked")) return "locked";
  if (lower.includes("expired") || lower.includes("closed")) return "expired";
  if (Number.isFinite(start) && start <= Date.now()) return "live";
  return "upcoming";
}

function matchesFilter(prop, sport, statType) {
  const sportOk = sport === "all" || prop.sport === sport;
  const statOk = statType === "all" || normalizeKey(prop.statType) === normalizeKey(statType);
  return sportOk && statOk;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function writeCachedPayload(payload) {
  try {
    window.localStorage.setItem(
      PRIZEPICKS_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), payload })
    );
  } catch {
    // Cache is only an anti-rate-limit convenience.
  }
}

function readCachedPayload() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(PRIZEPICKS_CACHE_KEY) || "null");
    if (!cached?.payload || Date.now() - cached.savedAt > PRIZEPICKS_CACHE_MAX_MS) return null;
    return cached.payload;
  } catch {
    return null;
  }
}
