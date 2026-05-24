import { normalizeSportLabel, sportLabelsMatch } from "./sportMappings.js";
import {
  dedupeDisplayProps,
  enrichDisplayPropsPipeline,
  selectBestValueProps,
  selectNearMissProps,
  selectReadyToBetProps,
  selectTop2Picks,
} from "./displayPropScoring.js";

const SOURCE_CACHE_PREFIX = "dfs_props_cache_";
const MAX_CACHE_PROPS = 500;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSourceLabel(value = "") {
  const text = String(value || "").trim();
  if (/prizepicks/i.test(text)) return "PrizePicks";
  if (/underdog/i.test(text)) return "Underdog";
  if (/odds/i.test(text)) return "OddsAPI";
  if (/cache/i.test(text)) return "Cache";
  return text || "PrizePicks";
}

export function computeDisplayEdge(prop = {}) {
  const line = finiteOr(prop.line, 0);
  const projection = finiteOr(prop.projection, line);
  const side = String(prop.side || "over").toLowerCase();
  if (side.includes("under")) return line - projection;
  return projection - line;
}

/** Normalize any parsed prop — never reject for missing optional fields. */
export function normalizeDisplayProp(prop = {}, { selectedSport = "MLB", source = "PrizePicks", status = "live" } = {}) {
  const raw = prop?.raw && typeof prop.raw === "object" ? prop.raw : prop;
  const line = finiteOr(raw.line ?? prop.line, 0);
  const projection = finiteOr(raw.projection ?? raw.projectedValue ?? prop.projection ?? prop.projectedValue, line);
  const sideRaw = String(raw.side || raw.pick || raw.bestPick || prop.side || prop.bestPick || "over").toLowerCase();
  const side = sideRaw.includes("under") ? "under" : "over";
  const sportNorm =
    normalizeSportLabel(raw.sport || prop.sport, raw.league || prop.league) ||
    String(raw.sport || prop.sport || selectedSport || "MLB").trim() ||
    "MLB";
  const league = String(raw.league || prop.league || sportNorm).trim() || sportNorm;
  const statType = String(raw.statType || raw.market || prop.statType || prop.market || prop.propType || "").trim() || "Unknown Prop";
  const player = String(raw.playerName || raw.player || prop.playerName || prop.player || "").trim() || "Unknown Player";
  const src = normalizeSourceLabel(source || raw.source || raw.platform || prop.source || prop.platform);
  const cached =
    status === "cached" ||
    String(raw.lineSourceBadge || prop.lineSourceBadge || "").toUpperCase() === "CACHED" ||
    String(raw.status || prop.status || "").toLowerCase() === "cached";
  const confidence = finiteOr(raw.confidence ?? raw.confidenceScore ?? prop.confidence ?? prop.confidenceScore, 50);
  const edge = finiteOr(raw.edge ?? prop.edge, computeDisplayEdge({ line, projection, side }));

  const id =
    raw.id ||
    prop.id ||
    [src, player, statType, line, side, sportNorm].join("|").toLowerCase().replace(/\s+/g, "-");

  return {
    id,
    player,
    playerName: player,
    sport: sportNorm,
    league,
    team: String(raw.team || prop.team || "").trim(),
    opponent: String(raw.opponent || prop.opponent || "").trim(),
    statType,
    market: statType,
    propType: statType,
    line,
    projection,
    projectedValue: projection,
    side,
    pick: side,
    bestPick: side,
    source: src,
    platform: src,
    confidence,
    confidenceScore: confidence,
    edge,
    status: cached ? "cached" : "live",
    lineSourceBadge: cached ? "CACHED" : "LIVE",
    startTime: raw.startTime || prop.startTime || null,
    raw,
    displayFallback: Boolean(prop.displayFallback),
    needsReview: Boolean(prop.needsReview),
    sportsbookVerified: true,
    verifiedBadge: "VERIFIED",
  };
}

export function propSourceCacheKey(sport = "all", source = "PrizePicks") {
  const sportKey = String(sport || "all").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const sourceKey = normalizeSourceLabel(source).toLowerCase();
  return `${SOURCE_CACHE_PREFIX}${sportKey}_${sourceKey}`;
}

export function readPropSourceCache(sport = "all", source = "PrizePicks") {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(propSourceCacheKey(sport, source)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePropSourceCache(sport = "all", source = "PrizePicks", props = []) {
  if (!Array.isArray(props) || !props.length) return;
  try {
    window.localStorage.setItem(
      propSourceCacheKey(sport, source),
      JSON.stringify(props.slice(0, MAX_CACHE_PROPS).map((prop) => ({ ...prop, raw: undefined })))
    );
  } catch {
    // ignore quota errors
  }
}

function splitLiveCached(result = {}) {
  const props = Array.isArray(result?.props) ? result.props : [];
  if (!props.length) return { live: [], cached: [] };
  const isCached =
    Boolean(result.cached) ||
    result.status === "Cached" ||
    String(result.lineSourceBadge || "").toUpperCase() === "CACHED";
  return {
    live: isCached ? [] : props,
    cached: isCached ? props : [],
  };
}

/**
 * Master display array — merge sources in priority order, dedupe by id.
 */
export function buildAllDisplayProps(
  {
    liveUnderdog = [],
    livePrizePicks = [],
    cachedUnderdog = [],
    cachedPrizePicks = [],
    oddsApi = [],
    selectedSport = "all",
    prizePicksResult = null,
    underdogResult = null,
    sport = "all",
  } = {}
) {
  const pp = splitLiveCached(prizePicksResult);
  const ud = splitLiveCached(underdogResult);

  const layers = [
    { rows: liveUnderdog.length ? liveUnderdog : ud.live, source: "Underdog", status: "live" },
    { rows: livePrizePicks.length ? livePrizePicks : pp.live, source: "PrizePicks", status: "live" },
    {
      rows: cachedUnderdog.length ? cachedUnderdog : ud.cached.length ? ud.cached : readPropSourceCache(sport, "Underdog"),
      source: "Underdog",
      status: "cached",
    },
    {
      rows: cachedPrizePicks.length ? cachedPrizePicks : pp.cached.length ? pp.cached : readPropSourceCache(sport, "PrizePicks"),
      source: "PrizePicks",
      status: "cached",
    },
    { rows: oddsApi, source: "OddsAPI", status: "live" },
  ];

  const seen = new Set();
  const allDisplayProps = [];

  layers.forEach(({ rows, source, status }) => {
    (rows || []).forEach((prop) => {
      const normalized = normalizeDisplayProp(prop, { selectedSport, source, status });
      if (seen.has(normalized.id)) return;
      seen.add(normalized.id);
      allDisplayProps.push(normalized);
    });
  });

  if (pp.live.length) writePropSourceCache(sport, "PrizePicks", pp.live.map((p) => normalizeDisplayProp(p, { selectedSport, source: "PrizePicks", status: "live" })));
  if (pp.cached.length) writePropSourceCache(sport, "PrizePicks", pp.cached.map((p) => normalizeDisplayProp(p, { selectedSport, source: "PrizePicks", status: "cached" })));
  if (ud.live.length) writePropSourceCache(sport, "Underdog", ud.live.map((p) => normalizeDisplayProp(p, { selectedSport, source: "Underdog", status: "live" })));
  if (ud.cached.length) writePropSourceCache(sport, "Underdog", ud.cached.map((p) => normalizeDisplayProp(p, { selectedSport, source: "Underdog", status: "cached" })));

  return enrichDisplayPropsPipeline(allDisplayProps);
}

export function filterAllDisplayPropsBySport(props = [], selectedSport = "all", platform = "all") {
  let rows = Array.isArray(props) ? props : [];
  if (platform && platform !== "all" && platform !== "both") {
    const want = normalizeSourceLabel(platform);
    rows = rows.filter((prop) => normalizeSourceLabel(prop.source || prop.platform) === want);
  }
  if (!selectedSport || selectedSport === "all") return rows;
  if (selectedSport === "Tennis") {
    return rows.filter(
      (prop) =>
        sportLabelsMatch(prop.sport, "ATP Tennis", prop.league) ||
        sportLabelsMatch(prop.sport, "WTA Tennis", prop.league) ||
        sportLabelsMatch(prop.sport, "Tennis", prop.league)
    );
  }
  return rows.filter((prop) => sportLabelsMatch(prop.sport, selectedSport, prop.league) || prop.sport === selectedSport);
}

export function applyEmergencyDisplayFallback(allDisplayProps = [], limit = 10) {
  return (allDisplayProps || []).slice(0, limit).map((prop) => ({
    ...prop,
    displayFallback: true,
    displayFallbackLabel: "Unfiltered fallback props",
  }));
}

export function selectTop2FromDisplayProps(props = []) {
  return selectTop2Picks(props);
}

export function selectReadyFromDisplayProps(props = []) {
  return selectReadyToBetProps(props);
}

export function selectBestValueFromDisplayProps(props = []) {
  return selectBestValueProps(props);
}

export function selectNearMissFromDisplayProps(props = []) {
  return selectNearMissProps(props);
}

export { dedupeDisplayProps, enrichDisplayPropsPipeline } from "./displayPropScoring.js";

export function buildDisplayDebugCounts({
  raw = 0,
  parsed = 0,
  normalized = 0,
  display = 0,
  selectedSport = "all",
  top2 = 0,
  ready = 0,
  rejected = 0,
} = {}) {
  return { raw, parsed, normalized, display, selectedSport, top2, ready, rejected };
}

export function logAllDisplayPropsSample(allDisplayProps = []) {
  if (!allDisplayProps.length) return;
  console.table(
    allDisplayProps.slice(0, 10).map((prop) => ({
      player: prop.player,
      sport: prop.sport,
      statType: prop.statType,
      line: prop.line,
      source: prop.source,
      confidence: prop.confidence,
      edge: prop.edge,
      status: prop.status,
    }))
  );
}
