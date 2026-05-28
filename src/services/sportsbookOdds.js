import { fetchJsonSafe, getCacheTtlMs } from "./fetchUtil.js";
import { ENRICHMENT_MAX_RETRIES, getApiTimeoutMs } from "../utils/apiTimeout.js";
import { canonicalStatType } from "../utils/marketNormalization.js";
import {
  buildOddsApiProxyUrl,
  getTrimmedOddsApiKey,
  isOddsApiKeyUsable,
  logOddsApiExchange,
  ODDS_API_INVALID_KEY_MESSAGE,
  parseOddsApiAuthFailure,
} from "./oddsApiClient.js";
import {
  SOURCE_IDS,
  cachedLinesMessage,
  isSourceAuthBlocked,
  isSourceInCooldown,
  recordSource429,
  recordSourceAuthFailure,
  recordSourceSuccess,
  recordSourceFailure,
  markSourceCached,
  withSourceRequestLock,
} from "./sourceRateLimit.js";

const ODDS_CACHE_KEY = "dfs-odds-last-good-comparisons";
const ODDS_CACHE_MAX_MS = 60 * 60 * 1000;

const SPORT_KEYS = {
  MLB: "baseball_mlb",
  NBA: "basketball_nba",
  WNBA: "basketball_wnba",
  "ATP Tennis": "tennis_atp",
  "WTA Tennis": "tennis_wta",
  Soccer: "soccer_epl",
};

const COMPARISON_BOOKS = new Set([
  "fanduel",
  "draftkings",
  "betmgm",
  "caesars",
  "williamhill_us",
]);

const MAX_EVENTS_PER_SPORT = 10;

export async function fetchSportsbookComparison({ props = [] } = {}) {
  return withSourceRequestLock(SOURCE_IDS.ODDS_API, () => fetchSportsbookComparisonInternal({ props }));
}

async function fetchSportsbookComparisonInternal({ props = [] } = {}) {
  const apiKey = getTrimmedOddsApiKey();
  if (!props.length) {
    return {
      source: "Sportsbook comparison",
      comparisons: [],
      warnings: [],
    };
  }
  if (!isOddsApiKeyUsable()) {
    return {
      source: "Sportsbook comparison",
      comparisons: [],
      warnings: apiKey ? [ODDS_API_INVALID_KEY_MESSAGE] : ["Missing API key."],
      authFailed: Boolean(apiKey),
      authDisabled: true,
    };
  }

  if (isSourceAuthBlocked(SOURCE_IDS.ODDS_API)) {
    return {
      source: "Sportsbook comparison",
      comparisons: [],
      warnings: [ODDS_API_INVALID_KEY_MESSAGE],
      authFailed: true,
    };
  }

  if (isSourceInCooldown(SOURCE_IDS.ODDS_API)) {
    const cached = readOddsCache();
    if (cached?.comparisons?.length) {
      return {
        source: "Sportsbook comparison",
        comparisons: cached.comparisons,
        warnings: [cachedLinesMessage(cached.savedAt) || "Odds API rate limited — using cached comparisons."],
        cached: true,
        lastSuccessfulFetchAt: cached.savedAt,
      };
    }
    return {
      source: "Sportsbook comparison",
      comparisons: [],
      warnings: ["Odds API rate limited. No cached comparisons available."],
      rateLimited: true,
    };
  }

  const sports = Array.from(new Set(props.map((prop) => prop.sport).filter(Boolean)));
  const settled = await Promise.allSettled(
    sports.map((sport) => fetchSportMarkets(apiKey, sport, props.filter((prop) => prop.sport === sport)))
  );

  const comparisons = settled
    .filter((item) => item.status === "fulfilled")
    .flatMap((item) => item.value);
  const warnings = settled
    .filter((item) => item.status === "rejected")
    .map((item) => friendlyOddsError(item.reason));

  const rateLimited = warnings.some((warning) => /rate limit|429|API limit/i.test(warning));
  if (rateLimited) {
    recordSource429(SOURCE_IDS.ODDS_API);
    const cached = readOddsCache();
    if (cached?.comparisons?.length) {
      return {
        source: "Sportsbook comparison",
        comparisons: cached.comparisons,
        warnings: [cachedLinesMessage(cached.savedAt), ...warnings],
        cached: true,
        lastSuccessfulFetchAt: cached.savedAt,
        rateLimited: true,
      };
    }
  }

  if (comparisons.length) {
    writeOddsCache(comparisons);
    recordSourceSuccess(SOURCE_IDS.ODDS_API);
    return {
      source: "Sportsbook comparison",
      comparisons,
      warnings,
      lastSuccessfulFetchAt: new Date().toISOString(),
    };
  }

  if (warnings.length) {
    recordSourceFailure(SOURCE_IDS.ODDS_API, warnings[0]);
    const cached = readOddsCache();
    if (cached?.comparisons?.length) {
      markSourceCached(SOURCE_IDS.ODDS_API, cached.savedAt);
      return {
        source: "Sportsbook comparison",
        comparisons: cached.comparisons,
        warnings: [cachedLinesMessage(cached.savedAt), ...warnings],
        cached: true,
        lastSuccessfulFetchAt: cached.savedAt,
      };
    }
  }

  return {
    source: "Sportsbook comparison",
    comparisons,
    warnings,
  };
}

function writeOddsCache(comparisons = []) {
  try {
    window.localStorage.setItem(
      ODDS_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), comparisons: comparisons.slice(0, 500) })
    );
  } catch {
    // ignore storage errors
  }
}

function readOddsCache() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(ODDS_CACHE_KEY) || "null");
    if (!cached?.comparisons || !Array.isArray(cached.comparisons)) return null;
    if (Date.now() - new Date(cached.savedAt).getTime() > ODDS_CACHE_MAX_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

async function fetchSportMarkets(apiKey, sport, propsForSport) {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return [];
  const markets = unique(propsForSport.map(marketForProp).filter(Boolean));
  if (!markets.length) return [];

  const eventsUrl = buildOddsApiProxyUrl(`/v4/sports/${sportKey}/events`);

  const result = await fetchJsonSafe(eventsUrl.toString(), {}, {
    source: "Sportsbook odds events",
    ttlMs: getCacheTtlMs(),
    maxRetries: ENRICHMENT_MAX_RETRIES,
    skip429Retry: true,
    enrichment: true,
    timeoutMs: getApiTimeoutMs({ enrichment: true }),
  });
  logOddsApiExchange({
    url: eventsUrl.toString(),
    status: result.response?.status,
    text: result.text,
    data: result.data,
    label: "Sportsbook odds events",
  });
  const authFailure = parseOddsApiAuthFailure({
    data: result.data,
    status: result.response?.status,
    text: result.text,
  });
  if (authFailure) {
    recordSourceAuthFailure(SOURCE_IDS.ODDS_API, authFailure);
    throw new Error(authFailure);
  }
  if (!result.ok) {
    if (result.rateLimited) throw new Error(oddsApiErrorMessage(429));
    throw new Error(result.error || "Could not load sportsbook comparison data.");
  }
  const events = result.data;
  if (events?.error) throw new Error(events.message || "Could not load sportsbook comparison data.");
  const now = Date.now();
  const upcomingEvents = (events || [])
    .filter((event) => new Date(event.commence_time).getTime() > now)
    .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
    .slice(0, MAX_EVENTS_PER_SPORT);

  const settled = await Promise.allSettled(
    upcomingEvents.map((event) => fetchEventPlayerProps(sportKey, sport, event.id, markets))
  );

  return aggregateSportsbookLines(
    settled.filter((item) => item.status === "fulfilled").flatMap((item) => item.value)
  );
}

async function fetchEventPlayerProps(sportKey, sport, eventId, markets) {
  const url = buildOddsApiProxyUrl(`/v4/sports/${sportKey}/events/${eventId}/odds`, {
    regions: "us",
    markets: markets.join(","),
    oddsFormat: "american",
  });

  const result = await fetchJsonSafe(url.toString(), {}, {
    source: "Sportsbook odds props",
    ttlMs: getCacheTtlMs(),
    maxRetries: ENRICHMENT_MAX_RETRIES,
    skip429Retry: true,
    enrichment: true,
    timeoutMs: getApiTimeoutMs({ enrichment: true }),
  });
  logOddsApiExchange({
    url: url.toString(),
    status: result.response?.status,
    text: result.text,
    data: result.data,
    label: "Sportsbook odds props",
  });
  const authFailure = parseOddsApiAuthFailure({
    data: result.data,
    status: result.response?.status,
    text: result.text,
  });
  if (authFailure) {
    recordSourceAuthFailure(SOURCE_IDS.ODDS_API, authFailure);
    throw new Error(authFailure);
  }
  if (!result.ok) {
    if (result.rateLimited) throw new Error(oddsApiErrorMessage(429));
    throw new Error(result.error || "Could not load sportsbook comparison data.");
  }
  const event = result.data;
  if (event?.error) throw new Error(event.message || "Could not load sportsbook comparison data.");

  return (event.bookmakers || [])
    .filter((book) => COMPARISON_BOOKS.has(book.key))
    .flatMap((book) =>
      (book.markets || []).flatMap((market) =>
        (market.outcomes || []).map((outcome) => normalizeOutcome({ sport, book, market, outcome })).filter(Boolean)
      )
    );
}

function normalizeOutcome({ sport, book, market, outcome }) {
  const point = Number(outcome.point);
  if (!Number.isFinite(point)) return null;
  const outcomeName = String(outcome.name || "");
  const playerName = outcome.description || outcome.participant || outcome.player || "";
  if (!playerName || !/over|under/i.test(outcomeName)) return null;

  return {
    sport,
    bookmaker: book.title || book.key,
    bookmakerKey: book.key,
    playerName,
    statType: statTypeFromMarket(market.key),
    point,
    price: outcome.price,
    side: outcomeName,
  };
}

function aggregateSportsbookLines(outcomes) {
  const grouped = new Map();
  outcomes.forEach((outcome) => {
    const key = [outcome.sport, outcome.playerName, canonicalStatType(outcome.statType)].map(normalize).join("|");
    const group = grouped.get(key) || [];
    group.push(outcome);
    grouped.set(key, group);
  });

  return Array.from(grouped.values()).map((group) => {
    const lines = group.map((item) => item.point).filter(Number.isFinite);
    const books = Array.from(new Set(group.map((item) => item.bookmaker)));
    const over = sideSummary(group, "over");
    const under = sideSummary(group, "under");
    const first = group[0];
    return {
      sport: first.sport,
      playerName: first.playerName,
      statType: first.statType,
      marketAverageLine: average(lines),
      books: books.length,
      over,
      under,
      lines: group,
    };
  });
}

function sideSummary(group, side) {
  const sideOutcomes = group.filter((item) => String(item.side || "").toLowerCase().includes(side));
  const prices = sideOutcomes.map((item) => Number(item.price)).filter(Number.isFinite);
  if (!sideOutcomes.length) return null;
  return {
    books: Array.from(new Set(sideOutcomes.map((item) => item.bookmaker))).length,
    averagePrice: average(prices),
    averageImpliedProbability: average(prices.map(americanToImpliedProbability).filter(Number.isFinite)),
  };
}

function americanToImpliedProbability(odds) {
  const price = Number(odds);
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
}

function marketForProp(prop) {
  const key = canonicalStatType(prop.statType);
  if (prop.sport === "MLB" && key === "strikeouts") return "player_strikeouts";
  if (prop.sport === "MLB" && key === "totalBases") return "batter_total_bases";
  if (prop.sport === "MLB" && key === "hits") return "batter_hits";
  if (prop.sport === "MLB" && key === "homeRuns") return "batter_home_runs";
  if (prop.sport === "MLB" && key === "stolenBases") return "batter_stolen_bases";
  if (prop.sport === "MLB" && key === "rbis") return "batter_rbis";
  if (prop.sport === "MLB" && key === "runs") return "batter_runs_scored";
  if (isBasketballSport(prop.sport) && key === "points") return "player_points";
  if (isBasketballSport(prop.sport) && key === "rebounds") return "player_rebounds";
  if (isBasketballSport(prop.sport) && key === "assists") return "player_assists";
  if (isBasketballSport(prop.sport) && key === "pra") return "player_points_rebounds_assists";
  if (isBasketballSport(prop.sport) && key === "threes") return "player_threes";
  if (prop.sport === "Soccer" && key === "shots") return "player_shots";
  if (prop.sport === "Soccer" && key === "shotsOnTarget") return "player_shots_on_target";
  if (prop.sport === "Soccer" && key === "passesAttempted") return "player_passes";
  if (prop.sport === "Soccer" && key === "goalieSaves") return "player_saves";
  return "";
}

function isBasketballSport(sport) {
  return sport === "NBA" || sport === "WNBA";
}

function statTypeFromMarket(market) {
  const map = {
    player_strikeouts: "Strikeouts",
    batter_total_bases: "Total Bases",
    batter_hits: "Hits",
    batter_home_runs: "Home Runs",
    batter_stolen_bases: "Stolen Bases",
    batter_rbis: "RBIs",
    batter_runs_scored: "Runs",
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_points_rebounds: "Points + Rebounds",
    player_points_assists: "Points + Assists",
    player_points_rebounds_assists: "Points + Rebounds + Assists",
    player_threes: "3-Pointers Made",
    player_shots: "Shots",
    player_shots_on_target: "Shots On Target",
    player_passes: "Passes Attempted",
    player_saves: "Goalie Saves",
  };
  return map[market] || market;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function oddsApiErrorMessage(status) {
  if (status === 401 || status === 403) return ODDS_API_INVALID_KEY_MESSAGE;
  if (status === 429) return "API limit reached. Try again later or upgrade plan.";
  if (status === 422) return "Unsupported sportsbook market skipped.";
  return "Could not load sportsbook comparison data.";
}

function friendlyOddsError(error) {
  const message = error?.message || "Could not load sportsbook comparison data.";
  if (message.includes(ODDS_API_INVALID_KEY_MESSAGE)) return message;
  if (/401|403|unauthorized|invalid api key|subscription/i.test(message)) return ODDS_API_INVALID_KEY_MESSAGE;
  if (message.includes("Unsupported sportsbook market")) return message;
  if (message.includes("API limit reached")) return message;
  if (message.includes("Missing API key")) return message;
  return "Could not load sportsbook comparison data.";
}
