import { DFS_CACHE_TTL_MS } from "../services/pickStore.js";
import {
  formatDateTime,
  formatLeanSide,
  formatMaybeLine,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatSignedNumber,
  formatSignedPercent,
  unique,
} from "./formatters.js";
import { displaySport } from "./propLabels.js";

export function edgePercentForProp(prop) {
  if (prop.edgePercent != null && Number.isFinite(Number(prop.edgePercent))) {
    return Number(prop.edgePercent);
  }
  const edge = Number(prop.edge ?? prop.projectionEdge);
  const projection = Number(prop.projection ?? prop.projectedValue);
  if (!Number.isFinite(edge) || !Number.isFinite(projection) || projection <= 0) return null;
  return Math.round((edge / projection) * 100);
}

export function dataSourcesUsed(prop) {
  const enrichment = prop.statEnrichmentSources || prop.modelSignal?.statEnrichmentSources || [];
  return unique([
    prop.platform,
    ...(Array.isArray(enrichment) ? enrichment : []),
    prop.lineComparison ? "PrizePicks/Underdog line comparison" : "",
    prop.sportsbookComparison || prop.modelSignal?.sportsbookDiscrepancy ? "Sportsbook comparison" : "",
    Number.isFinite(Number(prop.historicalHitRate || prop.modelSignal?.historicalHitRate)) ? "Historical hit rate" : "",
    prop.statProfileSource || prop.modelSignal?.statProfileSource || (prop.sampleSize || prop.modelSignal?.sampleSize ? "Player stats" : ""),
    prop.manualStats ? "manual input" : "",
    prop.injuryRisk || prop.modelSignal?.injuryRisk ? "Injury/news" : "",
    prop.lineMovement || prop.modelSignal?.lineMovement ? "Line movement" : "",
  ]);
}

export function keyStatsSummary(prop) {
  const parts = [];
  const probability = prop.modelProbability || prop.modelSignal?.modelProbability;
  const l5 = prop.last5HitRate || prop.modelSignal?.last5HitRate;
  const l10 = prop.last10HitRate || prop.modelSignal?.last10HitRate || prop.recentHitRate || prop.modelSignal?.recentHitRate;
  if (Number.isFinite(Number(probability))) parts.push(`model probability ${formatPercent(probability)}`);
  if (Number.isFinite(Number(l5)) || Number.isFinite(Number(l10))) parts.push(`L5/L10 ${formatPercent(l5)} / ${formatPercent(l10)}`);
  if (Number.isFinite(Number(prop.historicalHitRate || prop.modelSignal?.historicalHitRate))) {
    parts.push(`history ${formatPercent(prop.historicalHitRate || prop.modelSignal?.historicalHitRate)}`);
  }
  if (Number.isFinite(Number(prop.expectedValue))) parts.push(`EV ${formatSignedPercent(prop.expectedValue)}`);
  if (Number.isFinite(Number(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy))) {
    parts.push(`book edge ${formatSignedNumber(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy)}`);
  }
  if (Number.isFinite(Number(prop.multiplier))) parts.push(`multiplier ${formatMultiplier(prop.multiplier)}`);
  return parts.length ? parts.join("; ") : "limited stat sample";
}

export function usageContextForProp(prop) {
  const usage = prop.usageAdjustment || prop.modelSignal?.usageAdjustment;
  const pitchCount = prop.pitchCountTrend || prop.modelSignal?.pitchCountTrend;
  const minutes = prop.projectedMinutes || prop.modelSignal?.projectedMinutes;
  const parts = [];
  if (usage) parts.push(String(usage));
  if (pitchCount) parts.push(`Pitch count: ${pitchCount}`);
  if (minutes) parts.push(`Minutes: ${minutes}`);
  return parts.length ? parts.join(" | ") : "No minutes/usage/pitch-count flag";
}

export function lineMovementStatusText(prop) {
  const movement = prop.lineMovement || prop.modelSignal?.lineMovement;
  if (!movement) return "No movement yet";
  const lastSeen = new Date(movement.lastSeenAt || "").getTime();
  const stale = Number.isFinite(lastSeen) && Date.now() - lastSeen > DFS_CACHE_TTL_MS;
  const direction = movement.supportsPick
    ? "Moving toward value"
    : movement.againstPick
      ? "Moving against value"
      : "Stable";
  return `${direction}${stale ? " - stale line warning" : ""}`;
}

export function warningFlags(prop) {
  const flags = [];
  if (prop.riskLevel === "Risky" || prop.riskLevel === "High Risk") flags.push("high risk");
  if (prop.riskLevel === "Low Data Confidence") flags.push("low data confidence");
  if (prop.injuryRisk === "High" || prop.modelSignal?.injuryRisk === "High") flags.push("injury/news concern");
  if (Number(prop.volatility || prop.modelSignal?.volatility) > 4) flags.push("high volatility");
  if (Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) < 5) flags.push("small sample");
  if (Number(prop.multiplier) > 1) flags.push("demon/aggressive line");
  if (prop.categoryFallback) flags.push("category fallback");
  if (prop.lineMovement?.againstPick || prop.modelSignal?.lineMovement?.againstPick) flags.push("market moved against pick");
  if (!Number.isFinite(Number(prop.modelProbability))) flags.push("missing probability");
  return unique(flags);
}

export function riskExplanation(prop) {
  if (prop.premiumRiskSummary) return prop.premiumRiskSummary;
  const flags = warningFlags(prop);
  if (flags.length) return flags.join(", ");
  if (prop.riskLevel === "LOW") return "Stable role and matchup support this projection.";
  if (prop.riskLevel === "MEDIUM") return "Playable edge with normal variance — monitor late news.";
  if (prop.riskLevel === "HIGH") return "Higher variance profile — size accordingly.";
  return "Standard variance for this market.";
}

export { displaySport, formatLeanSide, formatNumber, formatMaybeLine, formatSignedNumber, formatSignedPercent, formatPercent, formatDateTime };
