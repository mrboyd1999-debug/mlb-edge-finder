import { normalizeProp, isMinimalRenderableProp } from "./normalizeProp.js";
import { filterResolvedSportProps } from "./underdogSportDetection.js";
import { normalizeSource } from "./normalizeSource.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";

export function isFakeOrFallbackProp(prop = {}) {
  if (!prop || typeof prop !== "object") return true;
  if (prop.isDemoData) return true;
  if (prop.isSportsDataFallback || prop.isFallbackMlbPick || prop.displayFallback) return true;
  if (String(prop.lineSourceBadge || "").toUpperCase() === "FALLBACK") return true;
  const src = normalizeSource(prop);
  if (src === "sportsdataio" && (prop.isSportsDataFallback || prop.generatedFromSportsData)) return true;
  if (/demo|synthetic|generated-props|sportsdata-immediate|sportsdata-generated/i.test(String(prop.ingestionSource || ""))) {
    return true;
  }
  return false;
}

export function preparePropForRender(prop = {}) {
  const normalized = normalizeProp(prop);
  const hasProjection = Number.isFinite(Number(normalized.projection)) && Number(normalized.projection) > 0;
  return {
    ...prop,
    ...normalized,
    projection: hasProjection ? normalized.projection : null,
    projectedValue: hasProjection ? normalized.projection : null,
    projectionLabel: hasProjection ? prop.projectionLabel || "" : "Projection unavailable",
    projectionUnavailable: !hasProjection,
    confidence: normalized.confidence ?? null,
    confidenceScore: normalized.confidence ?? null,
    edge: normalized.edge ?? null,
    isLiveRenderProp: true,
  };
}

export function buildLiveRenderBoard(allDisplayProps = [], options = {}) {
  const allowFallback = Boolean(options.allowFallbackProps);
  const fetched = Array.isArray(allDisplayProps) ? allDisplayProps.length : 0;
  const real = (allDisplayProps || []).filter((prop) => allowFallback || !isFakeOrFallbackProp(prop));
  const mlb = filterResolvedSportProps(real, "MLB", { selectedSportTab: "MLB" });
  const prepared = mlb.map(preparePropForRender);
  const rendered = prepared.filter(isMinimalRenderableProp);
  const normalized = prepared.length;
  const filteredOut = Math.max(0, fetched - rendered.length);

  return {
    props: rendered,
    counts: {
      fetched,
      normalized,
      rendered: rendered.length,
      filteredOut,
    },
  };
}

export function filterPlatformProps(props = [], platform = "") {
  const key = String(platform || "").toLowerCase();
  if (!key) return props || [];
  return (props || []).filter((prop) => normalizeSource(prop) === key);
}

/** When tier filters empty the board, show top projected props instead of a blank UI. */
export function buildProjectedDisplayFallback(props = [], limit = 25) {
  return (props || [])
    .filter((prop) => {
      if (isFakeOrFallbackProp(prop)) return false;
      const projection = Number(prop?.projection ?? prop?.projectedValue);
      const line = Number(prop?.line);
      const player = String(prop?.playerName || prop?.player || "").trim();
      return player && Number.isFinite(line) && line > 0 && Number.isFinite(projection) && projection > 0;
    })
    .sort((a, b) => {
      const confA = Number(a.confidenceScore ?? a.confidence ?? 0);
      const confB = Number(b.confidenceScore ?? b.confidence ?? 0);
      if (confB !== confA) return confB - confA;
      const probA = Number(a.probabilityScore ?? a.verifiedProbability ?? 0);
      const probB = Number(b.probabilityScore ?? b.verifiedProbability ?? 0);
      if (probB !== probA) return probB - probA;
      return Number(b.edge ?? b.evScore ?? 0) - Number(a.edge ?? a.evScore ?? 0);
    })
    .slice(0, limit)
    .map(preparePropForRender);
}

function isLiveProviderProp(prop = {}) {
  const src = normalizeSource(prop);
  if (src !== "prizepicks" && src !== "underdog") return false;
  if (prop.fromCache || prop.cacheLayer) return false;
  if (String(prop.lineSourceBadge || "").toUpperCase() === "CACHED") return false;
  return true;
}

function hasPositiveProjection(prop = {}) {
  const projection = Number(prop?.projection ?? prop?.projectedValue);
  return Number.isFinite(projection) && projection > 0;
}

/** Best Plays priority: verified → projected → normalized fallback → cache only when live = 0. */
export function buildLiveBestPlaysPriorityPools(props = []) {
  const live = (props || []).filter((prop) => isLiveProviderProp(prop) && !isFakeOrFallbackProp(prop));
  const liveVerifiedProps = live.filter((prop) => isVerifiedSportsbookProp(prop));
  const liveProjectedProps = live.filter(
    (prop) =>
      hasPositiveProjection(prop) &&
      !isVerifiedSportsbookProp(prop) &&
      !prop.isNormalizedFallbackProjection
  );
  const liveNormalizedFallbackProps = live.filter((prop) => prop.isNormalizedFallbackProjection);
  const pool = [...liveVerifiedProps, ...liveProjectedProps, ...liveNormalizedFallbackProps];
  return {
    liveVerifiedProps,
    liveProjectedProps,
    liveNormalizedFallbackProps,
    liveTotal: pool.length,
    pool,
  };
}

/** Prefer live pools; fall back to cache-backed props only when live count is zero. */
export function resolveLiveBestPlaysInputPool(props = []) {
  const livePools = buildLiveBestPlaysPriorityPools(props);
  if (livePools.liveTotal > 0) return livePools.pool;
  return props || [];
}
