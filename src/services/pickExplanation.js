import { formatNumber, formatSignedNumber } from "../utils/formatters.js";
import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";

function volatilityLabel(prop = {}) {
  const value = Number(prop.volatility ?? prop.volatilityScore);
  if (!Number.isFinite(value)) return "Volatility unknown";
  if (value <= 2) return "Low volatility";
  if (value <= 3) return "Moderate volatility";
  return "High volatility";
}

/** Compact, explainable summary for elite Top 2 picks. */
export function buildElitePickExplanation(prop = {}) {
  const lines = [];
  const projection = prop.projectedValue ?? prop.projection;
  const line = prop.line;
  const edge = prop.edge;
  const pick = prop.bestPick || prop.modelSide;

  if (Number.isFinite(Number(projection)) && Number.isFinite(Number(line))) {
    lines.push(
      `Projection ${formatNumber(projection)} vs line ${formatNumber(line)} (${pick || "—"} ${formatSignedNumber(edge)} edge)`
    );
  }

  const l5 = prop.last5HitRate;
  const l10 = prop.last10HitRate ?? prop.recentHitRate;
  if (Number.isFinite(l5) || Number.isFinite(l10)) {
    const trendParts = [];
    if (Number.isFinite(l5)) trendParts.push(`L5 ${Math.round(l5 * 100)}%`);
    if (Number.isFinite(l10)) trendParts.push(`L10 ${Math.round(l10 * 100)}%`);
    lines.push(`Recent trend: ${trendParts.join(" · ")}`);
  } else if (prop.strikeoutTrend) {
    lines.push(`Recent trend: ${prop.strikeoutTrend}`);
  } else if (Number.isFinite(prop.last5Average)) {
    lines.push(`Recent form: L5 avg ${formatNumber(prop.last5Average)}`);
  }

  if (prop.matchupNote) lines.push(`Matchup: ${prop.matchupNote}`);
  else if (prop.handednessMatchup) lines.push(`Matchup: ${prop.handednessMatchup}`);
  else if (prop.matchupRating) lines.push(`Matchup: ${prop.matchupRating}`);

  const factors = (prop.confidenceBreakdown || prop.explanation || [])
    .filter((row) => Number(row.score) > 0)
    .slice(0, 4)
    .map((row) => row.label);
  if (factors.length) {
    lines.push(`Confidence factors: ${factors.join(", ")}`);
  } else if (Number(prop.confidenceScore) >= CONFIDENCE_THRESHOLDS.ELITE) {
    const calibrated =
      prop.calibratedConfidence && prop.calibratedConfidence !== prop.confidenceScore
        ? ` · ${prop.calibratedConfidence}% calibrated`
        : "";
    lines.push(`Confidence: ${prop.confidenceScore}%${calibrated}`);
  }

  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (movementTag) {
    lines.push(`Line movement: ${movementTag}${prop.lineMovement?.supportsPick ? " (supports)" : prop.lineMovement?.againstPick ? " (against)" : ""}`);
  }

  lines.push(volatilityLabel(prop));

  return {
    headline: "WHY THIS PICK QUALIFIES",
    lines,
    compact: lines.join(" · "),
  };
}

export function attachElitePickExplanation(prop = {}) {
  const explanation = buildElitePickExplanation(prop);
  return {
    ...prop,
    elitePickExplanation: explanation,
    topTwoReason: explanation.compact,
  };
}
