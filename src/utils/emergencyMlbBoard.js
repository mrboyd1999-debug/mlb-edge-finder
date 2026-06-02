/**
 * Emergency playable MLB board — verification/historical gaps must not empty the UI.
 */

import { buildNormalizedProjectionFallback } from "./pipelineProjectionAttach.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { isGoblinProp, isDemonProp } from "./propLabels.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { normalizeSource } from "./normalizeSource.js";
import { computeDataCompletenessComponent } from "./playabilityScoring.js";
import { hasRenderableRankingMetrics } from "./propDisplayFields.js";

export const EMERGENCY_FALLBACK_NOTICE =
  "Fallback mode: showing highest projected MLB props because verification data is missing.";

export const EMERGENCY_TIER_ELITE = { id: "elite", min: 75, label: "Elite" };
export const EMERGENCY_TIER_STRONG = { id: "strong", min: 68, label: "Strong" };
export const EMERGENCY_TIER_LEAN = { id: "lean", min: 60, label: "Lean" };
export const EMERGENCY_TIER_FALLBACK = { id: "fallback", min: 0, label: "Fallback" };

const DEFAULT_PROBABILITY = 50;
const DEFAULT_EDGE_PERCENT = 0;
const DEFAULT_CONFIDENCE = 25;
const DEFAULT_IMPLIED_PROBABILITY = 0.5;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Standard normal CDF Φ(z). */
export function normalCDF(z) {
  const x = Number(z);
  if (!Number.isFinite(x)) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const poly =
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302745))));
  const cdf = 1 - d * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/** P(stat > line) assuming N(mean=projection, σ derived from line). */
export function projectionLineOverProbability(projection, line) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null || ln <= 0) return null;
  const sigma = Math.max(ln * 0.35, 0.75);
  return normalCDF((proj - ln) / sigma);
}

function resolveImpliedProbability(prop = {}) {
  const raw = finite(prop.impliedProbability);
  if (raw == null) return DEFAULT_IMPLIED_PROBABILITY;
  return raw > 1 ? raw / 100 : raw;
}

function resolveDataCompletenessConfidence(prop = {}) {
  const existing = finite(prop.dataCompleteness ?? prop.dataQualityScore);
  if (existing != null && existing > 0) {
    return Math.round(clamp(existing, DEFAULT_CONFIDENCE, 95));
  }
  const component = computeDataCompletenessComponent(prop);
  if (component != null && component > 0) {
    return Math.round(clamp(component, DEFAULT_CONFIDENCE, 95));
  }
  return DEFAULT_CONFIDENCE;
}

function formatSignedEdgePercent(edgePercent) {
  const pct = Math.round(Number(edgePercent) || 0);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `${pct}%`;
  return "0%";
}

function resolveSideProbability(overProbability, prop = {}) {
  const overPct = Math.round(clamp((overProbability ?? 0.5) * 100, 1, 99));
  const side = resolvePickSide(prop);
  if (side === "UNDER") return 100 - overPct;
  return overPct;
}

export function enrichEmergencyRankingFields(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  if (projection == null || projection <= 0 || line == null || line <= 0) {
    return { ...prop, isEmergencyPlay: true };
  }

  const existingProbability = finite(
    prop.finalProbability ??
      prop.probabilityScore ??
      prop.verifiedProbability ??
      prop.probability ??
      prop.displayProbability
  );

  let probability = existingProbability;
  if (probability == null) {
    const overProbability = projectionLineOverProbability(projection, line);
    probability = resolveSideProbability(overProbability, prop);
  }
  if (probability == null) probability = DEFAULT_PROBABILITY;

  const impliedProbability = resolveImpliedProbability(prop);
  const probabilityDecimal = probability / 100;
  const edgeDecimal = probabilityDecimal - impliedProbability;
  const edgePercent = Math.round(edgeDecimal * 100);
  const confidence = resolveDataCompletenessConfidence(prop);

  return {
    ...prop,
    isEmergencyPlay: true,
    projection,
    projectedValue: projection,
    probability,
    probabilityScore: probability,
    finalProbability: probability,
    displayProbability: probability,
    verifiedProbability: probability,
    modelProbability: probabilityDecimal,
    impliedProbability,
    edge: edgeDecimal,
    edgePercent,
    displayEdgeLabel: formatSignedEdgePercent(edgePercent),
    rawEdgeLabel: formatSignedEdgePercent(edgePercent),
    relativeEdgeLabel: formatSignedEdgePercent(edgePercent),
    confidence,
    confidenceScore: confidence,
    finalConfidence: confidence,
    displayConfidenceScore: confidence,
    dataCompleteness: confidence,
  };
}

function resolveProbability(prop = {}) {
  return Number(
    prop.probability ??
      prop.probabilityScore ??
      prop.verifiedProbability ??
      prop.displayProbability ??
      DEFAULT_PROBABILITY
  );
}

function resolveConfidence(prop = {}) {
  return Number(
    prop.confidenceScore ?? prop.confidence ?? prop.finalConfidence ?? DEFAULT_CONFIDENCE
  );
}

function resolveEdge(prop = {}) {
  const edgePct = finite(prop.edgePercent);
  if (edgePct != null) return Math.abs(edgePct);
  const edge = finite(prop.edge);
  if (edge != null) return Math.abs(edge <= 1 ? edge * 100 : edge);
  return Math.abs(DEFAULT_EDGE_PERCENT);
}

export function resolveEmergencyTier(prop = {}) {
  const probability = resolveProbability(prop);
  if (probability >= EMERGENCY_TIER_ELITE.min) return EMERGENCY_TIER_ELITE;
  if (probability >= EMERGENCY_TIER_STRONG.min) return EMERGENCY_TIER_STRONG;
  if (probability >= EMERGENCY_TIER_LEAN.min) return EMERGENCY_TIER_LEAN;
  return EMERGENCY_TIER_FALLBACK;
}

export function isEmergencyPlayableProp(prop = {}) {
  if (!prop || isFakeOrFallbackProp(prop)) return false;
  const player = String(prop.playerName || prop.player || "").trim();
  const market = String(prop.statType || prop.market || prop.propType || "").trim();
  const line = Number(prop.line);
  const sport = resolvePropSport(prop);
  if (sport && sport !== "MLB") return false;
  const src = normalizeSource(prop);
  if (src !== "prizepicks" && src !== "underdog") return false;
  return player.length >= 2 && market.length > 0 && Number.isFinite(line) && line > 0;
}

function ensureEmergencyProjection(prop = {}) {
  const projection = Number(prop.projection ?? prop.projectedValue);
  if (Number.isFinite(projection) && projection > 0) return prop;
  return buildNormalizedProjectionFallback(prop);
}

export function compareEmergencyPlayRank(a = {}, b = {}) {
  const verifiedDiff = Number(isVerifiedSportsbookProp(b)) - Number(isVerifiedSportsbookProp(a));
  if (verifiedDiff !== 0) return verifiedDiff;

  const probDiff = resolveProbability(b) - resolveProbability(a);
  if (probDiff !== 0) return probDiff;

  const edgeDiff = resolveEdge(b) - resolveEdge(a);
  if (edgeDiff !== 0) return edgeDiff;

  return resolveConfidence(b) - resolveConfidence(a);
}

function buildPlayerMarketKey(prop = {}) {
  const player = String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
  const market = String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase();
  const line = Number(prop.line);
  return `${player}|${market}|${line}`;
}

function buildPlayerKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
}

function keepBetterRanked(existing, candidate) {
  if (!existing) return candidate;
  return compareEmergencyPlayRank(candidate, existing) < 0 ? candidate : existing;
}

function dedupeByPlayerMarket(props = []) {
  const map = new Map();
  for (const prop of props) {
    const key = buildPlayerMarketKey(prop);
    if (!key || key.startsWith("|")) continue;
    map.set(key, keepBetterRanked(map.get(key), prop));
  }
  return [...map.values()];
}

function dedupeOnePerPlayer(props = []) {
  const map = new Map();
  for (const prop of props) {
    const key = buildPlayerKey(prop);
    if (!key) continue;
    map.set(key, keepBetterRanked(map.get(key), prop));
  }
  return [...map.values()];
}

function annotateEmergencyPlay(prop = {}, rank = 0) {
  const tier = resolveEmergencyTier(prop);
  const side = resolvePickSide(prop);
  const recommendedSide =
    side === "OVER" ? "OVER" : side === "UNDER" ? "UNDER" : prop.recommendedSide || "OVER";
  return withPlayerImageUrl({
    ...prop,
    emergencyTier: tier.id,
    emergencyTierLabel: tier.label,
    bestPlayRankLabel: tier.label,
    topMlbPlayRank: rank,
    isEmergencyPlay: true,
    recommendedSide,
    reason:
      prop.analyticsReason ||
      prop.premiumWhySummary ||
      buildAnalyticsReason(prop) ||
      `Projected ${prop.projection ?? prop.projectedValue} vs line ${prop.line}`,
  });
}

export function buildEmergencyMlbBoard(displayProps = []) {
  const prepared = dedupeOnePerPlayer(
    dedupeByPlayerMarket(
      (displayProps || [])
        .filter(isEmergencyPlayableProp)
        .map(ensureEmergencyProjection)
        .map(enrichEmergencyRankingFields)
        .filter(hasRenderableRankingMetrics)
    )
  ).sort(compareEmergencyPlayRank);

  const verifiedCount = prepared.filter(isVerifiedSportsbookProp).length;
  const fallbackNotice = verifiedCount === 0 && prepared.length ? EMERGENCY_FALLBACK_NOTICE : "";

  const top10 = prepared.slice(0, 10).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const goblins = prepared
    .filter(isGoblinProp)
    .slice(0, 6)
    .map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const demons = prepared
    .filter(isDemonProp)
    .slice(0, 6)
    .map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const builder = prepared.slice(0, 4).map((prop, index) =>
    annotateEmergencyPlay(
      {
        ...prop,
        categorySource: "parlayBuilder",
        recommendationType: "4-Man Builder",
      },
      index + 1
    )
  );

  return {
    sections: [
      {
        id: "top-10-best-plays",
        title: "Top 10 MLB Plays",
        eyebrow: "Verified first · then probability · edge · confidence",
        picks: top10,
        emptyMessage: prepared.length ? "" : "No MLB props loaded from PrizePicks or Underdog.",
        fallbackNotice,
      },
      {
        id: "top-goblins",
        title: "Top 6 Goblins",
        eyebrow: "Safer payout lines · PrizePicks & Underdog",
        picks: goblins,
        emptyMessage: goblins.length ? "" : "No goblin lines available right now.",
      },
      {
        id: "top-demons",
        title: "Top 6 Demons",
        eyebrow: "Higher payout lines · PrizePicks & Underdog",
        picks: demons,
        emptyMessage: demons.length ? "" : "No demon lines available right now.",
      },
      {
        id: "four-man-builder",
        title: "Best 4-Man Builder",
        eyebrow: "One prop per player · highest projected edge",
        picks: builder,
        emptyMessage: builder.length ? "" : "Not enough unique players for a 4-man card.",
      },
    ],
    filterDiagnostics: {
      emergencyMode: true,
      poolCount: prepared.length,
      verifiedCount,
      tierCounts: {
        elite: prepared.filter((p) => resolveEmergencyTier(p).id === "elite").length,
        strong: prepared.filter((p) => resolveEmergencyTier(p).id === "strong").length,
        lean: prepared.filter((p) => resolveEmergencyTier(p).id === "lean").length,
        fallback: prepared.filter((p) => resolveEmergencyTier(p).id === "fallback").length,
      },
    },
    usedFallback: verifiedCount === 0 && prepared.length > 0,
    fallbackNotice,
    loadedPropCount: prepared.length,
  };
}
