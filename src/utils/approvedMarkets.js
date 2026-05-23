import { canonicalMarketKey } from "./marketNormalization.js";
import {
  MLB_ACTIVE_MARKET_KEYS,
  MLB_ONLY_MODE,
  MLB_PRIMARY_MARKET_LABELS,
  MLB_TIER2_MARKET_LABELS,
  MLB_RESEARCH_MARKET_LABELS,
  getSportDisabledReason,
  isSportActiveInApp,
} from "./mlbOnlyMode.js";

/** Human-readable approved markets (reference). Keys are canonical marketKey values. */
export const APPROVED_MARKETS = MLB_ONLY_MODE
  ? {
      MLB: [...MLB_PRIMARY_MARKET_LABELS, ...MLB_TIER2_MARKET_LABELS, ...MLB_RESEARCH_MARKET_LABELS],
    }
  : {
      MLB: ["Pitcher Strikeouts", "Fantasy Score", "Hits+Runs+RBIs", "Total Bases", "Pitching Outs"],
      NBA: ["Points", "Rebounds", "Assists", "Pts+Rebs+Asts", "Fantasy Score", "3-PT Made"],
      WNBA: ["Points", "Rebounds", "Assists", "Pts+Rebs+Asts", "Fantasy Score", "3-PT Made"],
      TENNIS: ["Fantasy Score", "Total Games Won", "Aces", "Double Faults"],
    };

const FULL_APPROVED_MARKET_KEYS = {
  MLB: new Set(["strikeouts", "fantasyScore", "hrr", "totalBases", "outs"]),
  NBA: new Set(["points", "rebounds", "assists", "pra", "fantasyScore", "threes"]),
  WNBA: new Set(["points", "rebounds", "assists", "pra", "fantasyScore", "threes"]),
  Tennis: new Set(["fantasyScore", "gamesWon", "aces", "doubleFaults"]),
  "ATP Tennis": new Set(["fantasyScore", "gamesWon", "aces", "doubleFaults"]),
  "WTA Tennis": new Set(["fantasyScore", "gamesWon", "aces", "doubleFaults"]),
};

const APPROVED_MARKET_KEYS = MLB_ONLY_MODE
  ? {
      MLB: MLB_ACTIVE_MARKET_KEYS,
    }
  : FULL_APPROVED_MARKET_KEYS;

export const SPORT_PROCESSING_LIMITS = MLB_ONLY_MODE
  ? { MLB: 150 }
  : {
      MLB: 80,
      NBA: 80,
      WNBA: 60,
      Tennis: 40,
      "ATP Tennis": 40,
      "WTA Tennis": 40,
    };

export const RENDER_LIMITS = {
  topPicks: 2,
  readyToBet: 30,
  goblins: 6,
  demons: 6,
};

export const MAX_ANALYSIS_PROPS = Object.values(SPORT_PROCESSING_LIMITS).reduce((sum, value) => sum + value, 0);

function resolveSportBucket(sport = "") {
  const key = String(sport || "").trim();
  if (APPROVED_MARKET_KEYS[key]) return key;
  if (/tennis/i.test(key)) return "Tennis";
  return key;
}

export function marketKeyForProp(prop = {}) {
  return prop.marketKey || canonicalMarketKey(prop.statType || prop.propType || prop.market);
}

export function isApprovedMarket(prop = {}) {
  if (MLB_ONLY_MODE && !isSportActiveInApp(prop.sport)) return false;
  const sport = resolveSportBucket(prop.sport);
  const registry = APPROVED_MARKET_KEYS[sport];
  if (!registry) return false;
  return registry.has(marketKeyForProp(prop));
}

export function getApprovedMarketRejectReason(prop = {}) {
  const disabledReason = getSportDisabledReason(prop.sport);
  if (disabledReason) return disabledReason;
  if (isApprovedMarket(prop)) return "";
  const label = prop.marketLabel || prop.statType || marketKeyForProp(prop);
  return `unapproved market: ${label} (${prop.sport || "Unknown"})`;
}

export function filterApprovedMarkets(props = [], audit = null, recordFilterReason = null) {
  return props.filter((prop) => {
    const reason = getApprovedMarketRejectReason(prop);
    if (!reason) return true;
    if (audit && recordFilterReason) {
      recordFilterReason(audit, reason, prop, "approvedMarkets");
    }
    return false;
  });
}

/** Source-parse path: no audit writes. */
export function filterApprovedMarketsOnly(props = []) {
  return props.filter(isApprovedMarket);
}

export function applySportProcessingLimits(props = []) {
  const buckets = new Map();
  props.forEach((prop) => {
    const sport = String(prop.sport || "Other");
    if (MLB_ONLY_MODE && sport !== "MLB") return;
    if (!buckets.has(sport)) buckets.set(sport, []);
    buckets.get(sport).push(prop);
  });

  const limited = [];
  buckets.forEach((rows, sport) => {
    const cap = SPORT_PROCESSING_LIMITS[sport] ?? (MLB_ONLY_MODE ? 100 : 80);
    limited.push(...rows.slice(0, cap));
  });
  return limited;
}

/** Full registry lookup — ignores MLB-only sport scope (tests / future re-enable). */
export function isApprovedMarketInRegistry(prop = {}) {
  const sport = resolveSportBucket(prop.sport);
  const registry = FULL_APPROVED_MARKET_KEYS[sport];
  if (!registry) return false;
  return registry.has(marketKeyForProp(prop));
}
