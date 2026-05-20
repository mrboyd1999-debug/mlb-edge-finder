import { cachedFetch } from "./fetchUtil.js";

const SPORT_KEYS = {
  MLB: "baseball_mlb",
  NBA: "basketball_nba",
  WNBA: "basketball_wnba",
  "ATP Tennis": "tennis_atp",
  "WTA Tennis": "tennis_wta",
  Soccer: "soccer_epl",
};

const API_KEY = import.meta.env.VITE_ODDS_API_KEY;

const COMPARISON_BOOKS = new Set([
  "fanduel",
  "draftkings",
  "betmgm",
  "caesars",
  "williamhill_us",
]);

const MAX_EVENTS_PER_SPORT = 10;

export async function fetchSportsbookComparison({ props = [] } = {}) {
  const apiKey = getOddsApiKey();
  if (!props.length) {
    return {
      source: "Sportsbook comparison",
      comparisons: [],
      warnings: [],
    };
  }
  if (!apiKey) {
    return {
      source: "Sportsbook comparison",
      comparisons: [],
      warnings: ["Missing API key."],
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

  return {
    source: "Sportsbook comparison",
    comparisons,
    warnings,
  };
}

async function fetchSportMarkets(apiKey, sport, propsForSport) {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return [];
  const markets = unique(propsForSport.map(marketForProp).filter(Boolean));
  if (!markets.length) return [];

  const eventsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/events`);
  eventsUrl.searchParams.set("apiKey", apiKey);

  const eventsResponse = await cachedFetch(eventsUrl.toString());
  if (!eventsResponse.ok) throw new Error(oddsApiErrorMessage(eventsResponse.status));
  const events = await eventsResponse.json();
  const now = Date.now();
  const upcomingEvents = (events || [])
    .filter((event) => new Date(event.commence_time).getTime() > now)
    .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
    .slice(0, MAX_EVENTS_PER_SPORT);

  const settled = await Promise.allSettled(
    upcomingEvents.map((event) => fetchEventPlayerProps(apiKey, sportKey, sport, event.id, markets))
  );

  return aggregateSportsbookLines(
    settled.filter((item) => item.status === "fulfilled").flatMap((item) => item.value)
  );
}

async function fetchEventPlayerProps(apiKey, sportKey, sport, eventId, markets) {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", markets.join(","));
  url.searchParams.set("oddsFormat", "american");

  const response = await cachedFetch(url.toString());
  if (!response.ok) throw new Error(oddsApiErrorMessage(response.status));
  const event = await response.json();

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
    batter_rbis: "RBIs",
    batter_runs_scored: "Runs",
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_points_rebounds_assists: "Points + Rebounds + Assists",
    player_threes: "3-Pointers Made",
    player_shots: "Shots",
    player_shots_on_target: "Shots On Target",
    player_passes: "Passes Attempted",
    player_saves: "Goalie Saves",
  };
  return map[market] || market;
}

function canonicalStatType(statType) {
  const key = normalize(statType);
  if (key.includes("pitchesthrown") || key.includes("pitchcount")) return "pitchesThrown";
  if (key.includes("strikeout")) return "strikeouts";
  if (key.includes("hitsrunsrbis") || key.includes("hrr")) return "hitsRunsRbis";
  if (key.includes("totalbases")) return "totalBases";
  if (key === "hits") return "hits";
  if (key === "rbis" || key === "rbi") return "rbis";
  if (key === "runs") return "runs";
  if (key.includes("pointsreboundsassists") || key === "pra") return "pra";
  if (key === "points") return "points";
  if (key === "rebounds") return "rebounds";
  if (key === "assists") return "assists";
  if (key.includes("3pointers") || key.includes("threepointers")) return "threes";
  if (key.includes("shotsontarget")) return "shotsOnTarget";
  if (key === "shots" || key.includes("shotsattempted")) return "shots";
  if (key.includes("passesattempted") || key === "passes") return "passesAttempted";
  if (key.includes("goalsallowed")) return "goalsAllowed";
  if (key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves") return "goalieSaves";
  return key;
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

function getOddsApiKey() {
  try {
    return (
      API_KEY ||
      window.localStorage.getItem("odds-api-key") ||
      window.localStorage.getItem("the-odds-api-key") ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function oddsApiErrorMessage(status) {
  if (status === 401 || status === 403) return "Missing API key.";
  if (status === 429) return "API limit reached. Try again later or upgrade plan.";
  if (status === 422) return "Unsupported sportsbook market skipped.";
  return "Could not load sportsbook comparison data.";
}

function friendlyOddsError(error) {
  const message = error?.message || "Could not load sportsbook comparison data.";
  if (message.includes("Unsupported sportsbook market")) return message;
  if (message.includes("API limit reached")) return message;
  if (message.includes("Missing API key")) return message;
  return "Could not load sportsbook comparison data.";
}
