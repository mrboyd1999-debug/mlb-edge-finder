import { normalizeProp, isMinimalRenderableProp } from "./normalizeProp.js";
import { filterResolvedSportProps } from "./underdogSportDetection.js";
import { normalizeSource } from "./normalizeSource.js";

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
