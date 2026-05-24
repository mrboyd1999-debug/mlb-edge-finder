import { APP_SPORTS } from "./marketClassification.js";
import { canonicalMarketKey } from "./marketNormalization.js";

/**
 * Multi-sport decision engine (MLB primary, NBA/WNBA/Tennis/Soccer enabled).
 *
 * Verified-line + provider-data guards still apply — sports without any live
 * verified props simply render no cards. This avoids placeholders or mock
 * data when a sport is out of season.
 *
 * To revert to MLB-only mode, flip this constant back to `true` — every
 * downstream consumer reads the same flag and will narrow ingestion, fetch,
 * and rendering automatically.
 */
export const MLB_ONLY_MODE = true;

export const MLB_SPORT = APP_SPORTS.MLB;

/** S-tier — elite projection markets. */
export const MLB_QUALITY_S_KEYS = new Set(["hrr", "totalBases", "strikeouts"]);

/** A-tier — strong secondary markets. */
export const MLB_QUALITY_A_KEYS = new Set(["hitsAllowed", "earnedRuns"]);

/** B-tier — supported but lower signal. */
export const MLB_QUALITY_B_KEYS = new Set(["singles", "doubles"]);

/** C-tier — volatile / requires stronger edge. */
export const MLB_QUALITY_C_KEYS = new Set(["homeRuns", "stolenBases", "fantasyScore", "batterWalks"]);

/** @deprecated — use MLB_QUALITY_S_KEYS for elite picks */
export const MLB_TIER1_MARKET_KEYS = MLB_QUALITY_S_KEYS;

export const MLB_TIER2_MARKET_KEYS = MLB_QUALITY_A_KEYS;

export const MLB_TIER3_MARKET_KEYS = MLB_QUALITY_C_KEYS;

export const MLB_QUALITY_TIER_WEIGHT = {
  S: 1,
  A: 0.93,
  B: 0.84,
  C: 0.72,
  UNKNOWN: 0.6,
};

export const MLB_PRIMARY_MARKET_KEYS = MLB_TIER1_MARKET_KEYS;

export const MLB_RESEARCH_MARKET_KEYS = MLB_QUALITY_C_KEYS;

export const MLB_ACTIVE_MARKET_KEYS = new Set([
  ...MLB_QUALITY_S_KEYS,
  ...MLB_QUALITY_A_KEYS,
  ...MLB_QUALITY_B_KEYS,
  ...MLB_QUALITY_C_KEYS,
]);

export const MLB_PRIMARY_MARKET_LABELS = [
  "Hits+Runs+RBIs",
  "Total Bases",
  "Pitcher Strikeouts",
];

export const MLB_TIER2_MARKET_LABELS = ["Hits Allowed", "Earned Runs Allowed", "Fantasy Score", "Singles"];

export const MLB_RESEARCH_MARKET_LABELS = ["Doubles", "Home Runs", "Stolen Bases"];

const DISABLED_SPORTS = new Set([
  APP_SPORTS.NBA,
  APP_SPORTS.WNBA,
  APP_SPORTS.Tennis,
  APP_SPORTS.ATP,
  APP_SPORTS.WTA,
  APP_SPORTS.Soccer,
  APP_SPORTS.NHL,
]);

function normalizeSportLabel(value = "") {
  return String(value || "").trim();
}

export function resolvePropSport(prop = {}) {
  return normalizeSportLabel(prop.sport || prop.classifiedSport || prop.league || "");
}

export function isSportActiveInApp(sport = "") {
  if (!MLB_ONLY_MODE) return true;
  return normalizeSportLabel(sport) === MLB_SPORT;
}

export function isDisabledSport(sport = "") {
  if (!MLB_ONLY_MODE) return false;
  const key = normalizeSportLabel(sport);
  if (key === MLB_SPORT) return false;
  if (DISABLED_SPORTS.has(key)) return true;
  if (/tennis|nba|wnba|soccer|nhl|hockey|football|atp|wta/i.test(key)) return true;
  return key !== "" && key !== MLB_SPORT;
}

/** Hard guard — return null when prop is outside MLB scope. */
export function guardMlbOnlyProp(prop = null) {
  if (!MLB_ONLY_MODE) return prop;
  if (!prop || typeof prop !== "object") return null;
  return isSportActiveInApp(resolvePropSport(prop)) ? prop : null;
}

/** Hard guard for sport string inputs. */
export function guardMlbOnlySport(sport = "") {
  if (!MLB_ONLY_MODE) return sport;
  return isSportActiveInApp(sport) ? sport : null;
}

export function shouldRecordPipelineDebug(prop = {}) {
  if (!MLB_ONLY_MODE) return true;
  return isSportActiveInApp(resolvePropSport(prop));
}

export function shouldSilenceIngestionReject(reason = "", context = {}) {
  if (!MLB_ONLY_MODE) return false;
  const text = String(reason || "");
  if (text.startsWith("unsupported sport blocked at ingestion:")) return true;
  if (text.startsWith("sport disabled:")) return true;
  if (text.startsWith("non-priority sport blocked at ingestion:")) return true;
  const sport = resolvePropSport(context);
  if (sport && isDisabledSport(sport)) return true;
  return false;
}

export function getActiveSports() {
  return MLB_ONLY_MODE ? [MLB_SPORT] : null;
}

export function getActiveFetchSport(requestedSport = "all") {
  if (!MLB_ONLY_MODE) return requestedSport || "all";
  return MLB_SPORT;
}

export function filterActiveSportProps(props = []) {
  if (!MLB_ONLY_MODE) return props;
  return props.filter((prop) => isSportActiveInApp(resolvePropSport(prop)));
}

export function getActiveSportFilterOptions(baseOptions = []) {
  if (!MLB_ONLY_MODE) return baseOptions;
  return baseOptions.filter((option) => option.value === "all" || option.value === MLB_SPORT);
}

export function getActivePriorityPropTypes(baseTypes = []) {
  if (!MLB_ONLY_MODE) return baseTypes;
  return ["all", ...MLB_PRIMARY_MARKET_LABELS, ...MLB_TIER2_MARKET_LABELS, ...MLB_RESEARCH_MARKET_LABELS];
}

export function getMlbQualityTier(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.marketKey || prop.market);
  if (MLB_QUALITY_S_KEYS.has(key)) return "S";
  if (MLB_QUALITY_A_KEYS.has(key)) return "A";
  if (MLB_QUALITY_B_KEYS.has(key)) return "B";
  if (MLB_QUALITY_C_KEYS.has(key)) return "C";
  return null;
}

export function getMlbQualityTierWeight(prop = {}) {
  const tier = getMlbQualityTier(prop);
  return MLB_QUALITY_TIER_WEIGHT[tier || "UNKNOWN"];
}

/** Minimum positive edge required by quality tier — low tiers need stronger edge. */
export const MLB_TIER_MIN_EDGE = {
  S: 0.5,
  A: 0.75,
  B: 1.0,
  C: 1.25,
  UNKNOWN: 2,
};

export function getMlbMinEdgeForTier(prop = {}) {
  const tier = getMlbQualityTier(prop) || "UNKNOWN";
  return MLB_TIER_MIN_EDGE[tier] ?? MLB_TIER_MIN_EDGE.UNKNOWN;
}

export function isMlbQualityTierS(prop = {}) {
  return getMlbQualityTier(prop) === "S";
}

export function isMlbQualityTierAtLeast(prop = {}, minTier = "A") {
  const order = { S: 4, A: 3, B: 2, C: 1 };
  const tier = getMlbQualityTier(prop);
  if (!tier) return false;
  return (order[tier] || 0) >= (order[minTier] || 0);
}

export function getMlbMarketTier(prop = {}) {
  const quality = getMlbQualityTier(prop);
  if (quality === "S") return 1;
  if (quality === "A") return 2;
  if (quality === "B") return 2;
  if (quality === "C") return 3;
  return 0;
}

export function isMlbTier1Market(prop = {}) {
  return isMlbQualityTierS(prop);
}

export function getActiveStreakTabOptions(baseOptions = []) {
  if (!MLB_ONLY_MODE) return baseOptions;
  return baseOptions.filter((option) => option.value === MLB_SPORT);
}

export function isMlbActiveMarket(prop = {}) {
  if (resolvePropSport(prop) !== MLB_SPORT) return false;
  return MLB_ACTIVE_MARKET_KEYS.has(canonicalMarketKey(prop.statType || prop.marketKey || prop.market));
}

export function isMlbResearchMarket(prop = {}) {
  if (resolvePropSport(prop) !== MLB_SPORT) return false;
  return MLB_RESEARCH_MARKET_KEYS.has(canonicalMarketKey(prop.statType || prop.marketKey || prop.market));
}

export function isMlbTier3Market(prop = {}) {
  if (resolvePropSport(prop) !== MLB_SPORT) return false;
  return MLB_TIER3_MARKET_KEYS.has(canonicalMarketKey(prop.statType || prop.marketKey || prop.market));
}

export function isMlbLowPriorityMarket(prop = {}) {
  if (resolvePropSport(prop) !== MLB_SPORT) return false;
  const tier = getMlbMarketTier(prop);
  return tier === 0 || tier >= 3;
}

export function getSportDisabledReason(sport = "") {
  if (!isDisabledSport(sport)) return "";
  return `sport disabled: ${sport || "Unknown"} (MLB-only mode)`;
}

export function shouldRunNonMlbStatFetch(sport = "") {
  if (!MLB_ONLY_MODE) return true;
  return normalizeSportLabel(sport) === MLB_SPORT;
}

export function shouldRunNonMlbConfidenceModel(sport = "") {
  if (!MLB_ONLY_MODE) return true;
  return normalizeSportLabel(sport) === MLB_SPORT;
}

export function emptySourcePipelineAudit() {
  return {
    fetched: 0,
    normalized: 0,
    groupedRejections: [],
    filterReasons: {},
    rejectionByStage: {},
  };
}

export function sanitizePipelineAuditForMlbOnly(audit = null) {
  if (!MLB_ONLY_MODE || !audit || typeof audit !== "object") return audit;
  const groupedRejections = (audit.groupedRejections || []).filter((row) => isSportActiveInApp(row?.sport));
  const filterReasons = {};
  Object.entries(audit.filterReasons || {}).forEach(([reason, count]) => {
    if (/(\(NBA\)|\(WNBA\)|\(Tennis\)|\(ATP Tennis\)|\(WTA Tennis\)|\(Soccer\)|\(NHL\))/i.test(reason)) return;
    if (/unsupported sport|sport disabled|non-priority sport/i.test(reason)) return;
    filterReasons[reason] = count;
  });
  const rejectionByStage = {};
  Object.entries(audit.rejectionByStage || {}).forEach(([stage, reasons]) => {
    rejectionByStage[stage] = {};
    Object.entries(reasons || {}).forEach(([reason, count]) => {
      if (/(\(NBA\)|\(WNBA\)|\(Tennis\)|\(ATP Tennis\)|\(WTA Tennis\)|\(Soccer\)|\(NHL\))/i.test(reason)) return;
      if (/unsupported sport|sport disabled|non-priority sport/i.test(reason)) return;
      rejectionByStage[stage][reason] = count;
    });
  });
  return {
    ...audit,
    groupedRejections,
    filterReasons,
    rejectionByStage,
    scoringDebug: (audit.scoringDebug || []).filter((row) => isSportActiveInApp(row?.sport)),
    projectionDebug: (audit.projectionDebug || []).filter((row) => isSportActiveInApp(row?.sport)),
    lineMovementDebug: (audit.lineMovementDebug || []).filter((row) => isSportActiveInApp(row?.sport)),
  };
}

export function sanitizeDebugInfoForMlbOnly(debugInfo = null) {
  if (!MLB_ONLY_MODE || !debugInfo || typeof debugInfo !== "object") return debugInfo;
  const pipelineAudit = sanitizePipelineAuditForMlbOnly(debugInfo.pipelineAudit);
  const rejectedProps = (debugInfo.rejectedProps || pipelineAudit?.groupedRejections || []).filter((row) =>
    isSportActiveInApp(row?.sport)
  );
  return {
    ...debugInfo,
    pipelineAudit,
    rejectedProps,
    generatedBySport: (debugInfo.generatedBySport || []).filter((row) => isSportActiveInApp(row?.sport)),
  };
}

export function sanitizeBoardForMlbOnly(board = {}) {
  if (!MLB_ONLY_MODE) return board;
  return {
    ...board,
    props: filterActiveSportProps(board.allDisplayProps?.length ? board.allDisplayProps : board.props || []),
    allDisplayProps: filterActiveSportProps(board.allDisplayProps || board.usableProps || board.props || []),
    usableProps: filterActiveSportProps(board.usableProps || board.allDisplayProps || board.props || []),
    watchlist: filterActiveSportProps(board.watchlist || []),
    nearQualification: filterActiveSportProps(board.nearQualification || []),
    qualifiedReadyProps: filterActiveSportProps(board.qualifiedReadyProps || board.readyProps || []),
    readyProps: filterActiveSportProps(board.readyProps || board.qualifiedReadyProps || []),
    acceptedPropsForRender: filterActiveSportProps(
      board.acceptedPropsForRender || board.qualifiedReadyProps || board.readyProps || []
    ),
    streakProps: filterActiveSportProps(board.streakProps || []),
    cacheNotice: board.cacheNotice || "",
    cacheAnalytics: board.cacheAnalytics || board.cacheMetadata?.cacheAnalytics || null,
    verifiedAt: board.verifiedAt || board.updatedAt || "",
    debugInfo: sanitizeDebugInfoForMlbOnly(board.debugInfo),
  };
}
