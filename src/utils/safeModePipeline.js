import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { buildPropSoftDedupeKey } from "./displayPropScoring.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { isSafeModeEnabled } from "./safeMode.js";

export function isLooseDisplayProp(prop = {}) {
  const name = String(prop.player || prop.playerName || "").trim();
  if (name.length < 2 || /^unknown player$/i.test(name)) return false;
  const line = Number(prop.line);
  if (Number.isFinite(line) && line <= 0) return false;
  return true;
}

export function dedupeLooseProps(props = []) {
  const seen = new Set();
  const merged = [];
  for (const prop of props || []) {
    if (!prop) continue;
    const key = buildPropSoftDedupeKey(prop) || `${prop.player || prop.playerName}-${prop.line}-${prop.platform || prop.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(prop);
  }
  return merged;
}

export function sortLoosePropsByConfidence(props = []) {
  return [...(props || [])].sort((a, b) => {
    const ca = Number(a.confidenceScore ?? a.confidence ?? 50);
    const cb = Number(b.confidenceScore ?? b.confidence ?? 50);
    return cb - ca;
  });
}

export function buildSafeMlbPropPool(displayProps = [], rawProps = []) {
  const fromDisplay = filterAllDisplayPropsBySport(displayProps, "MLB", "all");
  const fromRaw = filterActiveSportProps(rawProps || []);
  const pool = dedupeLooseProps([...fromDisplay, ...fromRaw].filter(isLooseDisplayProp));
  return sortLoosePropsByConfidence(pool);
}

function annotateSafePick(prop = {}) {
  const side = resolvePickSide(prop);
  return {
    ...prop,
    confidenceScore: prop.confidenceScore ?? prop.confidence ?? 50,
    confidence: prop.confidence ?? prop.confidenceScore ?? 50,
    bestPick: prop.bestPick || prop.side || (side === "UNDER" ? "under" : side === "OVER" ? "over" : ""),
    side: prop.side || prop.bestPick || (side === "UNDER" ? "under" : side === "OVER" ? "over" : ""),
    isFallbackMlbPick: true,
    fallbackLabel: "Fallback MLB pick",
    displayFallback: true,
  };
}

export function resolveSafeMlbStreakPicks(displayProps = [], rawProps = [], limit = 2) {
  return buildSafeMlbPropPool(displayProps, rawProps)
    .slice(0, limit)
    .map(annotateSafePick);
}

export function resolveSafeMlbBoardPicks(displayProps = [], rawProps = [], limit = 6) {
  return buildSafeMlbPropPool(displayProps, rawProps)
    .slice(0, limit)
    .map(annotateSafePick);
}

export function logSafeModePipelineCounts({
  rawCount = 0,
  mlbCount = 0,
  acceptedCount = 0,
  rejectedCount = 0,
  renderErrors = [],
  failedEndpoints = [],
} = {}) {
  if (!isSafeModeEnabled()) return;
  console.info("[SAFE_MODE] Pipeline counts", {
    rawProps: rawCount,
    mlbProps: mlbCount,
    acceptedProps: acceptedCount,
    rejectedProps: rejectedCount,
    renderErrors: renderErrors.length ? renderErrors : "none",
    failedEndpoints: failedEndpoints.length ? failedEndpoints : "none",
  });
}
