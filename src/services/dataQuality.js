import { computeDataQualityFromEnrichment, hasVerifiedStats } from "./statEnrichment.js";
import { isManualAnalyzerProp } from "../utils/manualPropBuilder.js";

export function dataQualityBadge(prop = {}) {
  if (isManualAnalyzerProp(prop)) {
    return {
      label: prop.scoringModeLabel || "Projection unavailable",
      tone: "info",
    };
  }
  const signal = prop.modelSignal || {};
  const projectionSource = prop.projectionSource || signal.projectionSource || "";
  const fallback = Boolean(prop.fallbackProfile || signal.fallbackProfile || prop.isDemoData);
  const sampleSize = Number(prop.sampleSize ?? signal.sampleSize ?? 0);
  const projection = prop.projection ?? signal.projection;
  const hasProjection = Number.isFinite(Number(projection));
  const dataQualityScore = Number(prop.dataQualityScore ?? signal.dataQualityScore ?? 0);
  const statsMissing = prop.statsMissingExplanation || prop.statsMissingBadge?.label;

  if (!prop.sportsbookVerified && (fallback || prop.isDemoData || signal.isDemoData || prop.manualEntry)) {
    return { label: "Unverified source", tone: "weak" };
  }
  if (prop.sportsbookVerified || prop.verifiedBadge === "VERIFIED") {
    if (dataQualityScore >= 85 && hasVerifiedStats(prop)) {
      return { label: "Verified · full context", tone: "full" };
    }
    if (dataQualityScore >= 72 && sampleSize >= 5) {
      return { label: "Verified · full data", tone: "full" };
    }
    if (dataQualityScore >= 50 || sampleSize >= 3) {
      return { label: "Verified · partial data", tone: "partial" };
    }
    return { label: "Verified line", tone: "partial" };
  }
  if (fallback || prop.isDemoData || signal.isDemoData) {
    return { label: "Fallback / demo data - not bettable", tone: "fallback" };
  }
  if (statsMissing || projectionSource === "missing" || !hasProjection) {
    return { label: "Stats Missing", tone: "weak" };
  }
  if (dataQualityScore >= 85 && hasVerifiedStats(prop)) {
    return { label: "Full context", tone: "full" };
  }
  if (dataQualityScore >= 72 && sampleSize >= 5) {
    return { label: "Full data", tone: "full" };
  }
  if (dataQualityScore >= 50 || sampleSize >= 3) {
    return { label: "Partial data", tone: "partial" };
  }
  return { label: "Weak data", tone: "weak" };
}

/** Legacy signal-based DQ — prefer enrichment tier when available. */
export function dataQualityFromSignals({
  profile,
  injury,
  lineComparison,
  sportsbookComparison,
  projection,
  projectionSource,
  prop,
  edge,
  lineMovement,
}) {
  if (prop || profile?.hasGameLogs != null) {
    const enrichment = {
      ...profile,
      line: prop?.line,
      hasGameLogs: profile?.hasGameLogs,
      hasSeasonAverage: profile?.hasSeasonAverage,
      hasPlayerAverage: profile?.hasPlayerAverage,
      hasMatchup: profile?.hasMatchup,
      hasRoleContext: profile?.hasRoleContext,
      hasLineComparison: Boolean(lineComparison),
      injuryFetched: Boolean(injury),
      injuryRisk: injury?.risk || prop?.injuryRisk,
      hasSportsbookComparison: Boolean(lineComparison || sportsbookComparison),
      sportsbookBooks: sportsbookComparison?.books,
      historicalHitRate: prop?.historicalHitRate,
      projectionSource: projectionSource || prop?.projectionSource || profile?.projectionSource,
      lineMovement: lineMovement || prop?.lineMovement,
      verified: hasVerifiedStats(profile),
    };
    return computeDataQualityFromEnrichment(enrichment, {
      ...(prop || {}),
      projectionSource: enrichment.projectionSource,
      edge: edge ?? prop?.edge,
      sportsbookComparison,
      lineComparison,
      lineMovement: enrichment.lineMovement,
      injuryRisk: enrichment.injuryRisk,
    }).score;
  }

  let score = projectionSource === "missing" ? 20 : 42;
  if (Number.isFinite(projection)) score += 18;
  if (Number(profile?.sampleSize || 0) >= 10) score += 14;
  else if (Number(profile?.sampleSize || 0) >= 5) score += 8;
  if (Number.isFinite(profile?.recentHitRate)) score += 8;
  if (Number.isFinite(profile?.volatility)) score += 6;
  if (profile?.fallback || profile?.sparse) score = 20;
  if (lineComparison) score += 6;
  if (sportsbookComparison) score += 8;
  if (injury?.risk === "Medium") score -= 8;
  if (injury?.risk === "High") score -= 18;
  return clamp(score, 0, 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
