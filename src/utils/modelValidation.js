/**
 * Model validation — probability audit, edge formula verification, matchup context.
 */

import {
  computeStandardEdge,
  computeStandardEdgePercent,
} from "./standardPropMetrics.js";
import { hasMissingOpponentData, resolveProjectionValue } from "./conservativeProjection.js";
import { computeCalibratedProbability } from "./probabilityCalibration.js";
import { computeFormConfidenceScore } from "./matchupEnrichment.js";
import { formatHitRatePercent } from "./pickDirectionAudit.js";
import {
  HISTORICAL_DATA_UNAVAILABLE_WARNING,
  resolveHistoricalDataPresent,
  resolveHitRateValidationPresent,
} from "./tierHistoricalValidation.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value))}%`;
}

function signedPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Math.round(Number(value));
  return n > 0 ? `+${n}%` : `${n}%`;
}

function resolveHitRatePercent(prop = {}, key) {
  const direct = finite(prop[key]);
  if (direct != null && direct <= 1) return Math.round(direct * 100);
  if (direct != null) return Math.round(direct);
  return null;
}

function estimateHitRateFromAverage(avg, line) {
  const baseline = finite(avg);
  const ln = finite(line);
  if (baseline == null || ln == null || ln <= 0) return null;
  const gap = (baseline - ln) / ln;
  return clamp(Math.round(50 + gap * 35), 15, 90);
}

export function buildHitRateSnapshot(prop = {}) {
  const line = finite(prop.line);
  const last5 =
    resolveHitRatePercent(prop, "last5HitRate") ??
    estimateHitRateFromAverage(prop.last5Average ?? prop.recentForm, line);
  const last10 =
    resolveHitRatePercent(prop, "last10HitRate") ??
    resolveHitRatePercent(prop, "recentHitRate") ??
    estimateHitRateFromAverage(prop.last10Average, line);
  const season =
    resolveHitRatePercent(prop, "seasonHitRate") ??
    estimateHitRateFromAverage(prop.seasonAverage, line);

  return {
    last5: last5 ?? null,
    last10: last10 ?? null,
    season: season ?? null,
    last5Label: last5 != null ? `${last5}%` : "—",
    last10Label: last10 != null ? `${last10}%` : "—",
    seasonLabel: season != null ? `${season}%` : "—",
  };
}

function resolveOpponentAdjustment(prop = {}) {
  const rank = finite(prop.opponentRank);
  if (rank != null) {
    if (rank >= 24) return { points: 8, label: `Opponent rank #${rank} (weak defense)` };
    if (rank >= 20) return { points: 4, label: `Opponent rank #${rank}` };
    if (rank <= 8) return { points: -4, label: `Opponent rank #${rank} (strong defense)` };
    return { points: 0, label: `Opponent rank #${rank}` };
  }
  if (hasMissingOpponentData(prop)) return { points: -5, label: "Opponent data missing" };
  if (String(prop.opponent || "").trim()) return { points: 2, label: `vs ${String(prop.opponent).trim()}` };
  return { points: 0, label: "Neutral opponent context" };
}

function resolveParkAdjustment(prop = {}) {
  const note = String(prop.parkFactorNote || prop.venueNote || prop.parkNote || "").trim();
  if (!note) return { points: 0, label: "No park factor" };
  if (/hitter-friendly|bandbox|coors|offense|short porch|wind out/i.test(note)) {
    return { points: 3, label: note };
  }
  if (/pitcher-friendly|suppress|petco|marlins|oakland/i.test(note)) {
    return { points: -3, label: note };
  }
  return { points: 0, label: note };
}

export function buildProbabilityAudit(prop = {}, metrics = {}) {
  try {
    return buildProbabilityAuditUnsafe(prop, metrics);
  } catch (error) {
    console.error("[ProbabilityAudit] build failed", prop?.playerName || prop?.player, error);
    return buildProbabilityAuditFallback(prop);
  }
}

function buildProbabilityAuditFallback(prop = {}) {
  const hitRateSnapshot = buildHitRateSnapshot(prop || {});
  return {
    last10HitRate: hitRateSnapshot.last10Label,
    seasonHitRate: hitRateSnapshot.seasonLabel,
    last5HitRate: hitRateSnapshot.last5Label,
    projectionVsLine: "—",
    opponentAdjustment: "—",
    parkAdjustment: "—",
    matchupAdjustment: "—",
    edgeContribution: "—",
    last5Contribution: "—",
    last10Contribution: "—",
    seasonContribution: "—",
    projection: null,
    line: null,
    edge: null,
    edgePercent: null,
    base: 43,
    projectionEdgePoints: 0,
    opponentLabel: "—",
    parkLabel: "—",
    rollingBoost: 0,
    finalProbability: null,
    explanationLines: [],
    summary: "",
    hitRates: hitRateSnapshot,
    calibration: null,
    historicalDataPresent: false,
    historicalMissing: ["Last5", "Last10", "Season"],
    hitRateValidated: false,
    hitRateMissing: ["Last5", "Last10", "Season"],
    historicalDataWarning: HISTORICAL_DATA_UNAVAILABLE_WARNING,
  };
}

function buildProbabilityAuditUnsafe(prop = {}, metrics = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  const edge = finite(metrics.edge ?? computeStandardEdge(projection, line));
  const edgePercent = finite(metrics.edgePercent ?? computeStandardEdgePercent(edge, line));
  const hitRateSnapshot = buildHitRateSnapshot(prop);
  const historical = resolveHistoricalDataPresent(prop);
  const hitRateValidation = resolveHitRateValidationPresent(prop);
  const opponent = resolveOpponentAdjustment(prop);
  const park = resolveParkAdjustment(prop);

  const calibrated = computeCalibratedProbability(prop, { edge, edgePercent, projection }, { verified: true });
  const breakdown = calibrated?.breakdown || {};
  const finalProbability =
    finite(prop.probabilityScore ?? prop.verifiedProbability) ?? calibrated?.probability ?? null;

  const inputs = {
    last10HitRate: hitRateSnapshot.last10Label,
    seasonHitRate: hitRateSnapshot.seasonLabel,
    last5HitRate: hitRateSnapshot.last5Label,
    projectionVsLine: edgePercent != null ? signedPct(edgePercent) : "—",
    opponentAdjustment: signedPct(opponent.points),
    parkAdjustment: signedPct(park.points),
    matchupAdjustment: calibrated?.inputs?.matchupAdjustment ?? signedPct(breakdown.matchupAdjustment ?? 0),
    edgeContribution: signedPct(breakdown.edgeContribution ?? 0),
    last5Contribution: signedPct(breakdown.last5Contribution ?? 0),
    last10Contribution: signedPct(breakdown.last10Contribution ?? 0),
    seasonContribution: signedPct(breakdown.seasonContribution ?? 0),
  };

  const explanationLines = [
    `Last 5 hit rate: ${hitRateSnapshot.last5Label} (${signedPct(breakdown.last5Contribution ?? 0)})`,
    `Last 10 hit rate: ${hitRateSnapshot.last10Label} (${signedPct(breakdown.last10Contribution ?? 0)})`,
    `Season hit rate: ${hitRateSnapshot.seasonLabel} (${signedPct(breakdown.seasonContribution ?? 0)})`,
    `Projection edge: ${edgePercent != null ? signedPct(edgePercent) : "—"} (${signedPct(breakdown.edgeContribution ?? 0)})`,
    `Matchup adjustment: ${calibrated?.inputs?.matchupAdjustment ?? signedPct(breakdown.matchupAdjustment ?? 0)}`,
    `Final Probability: ${pct(finalProbability)}`,
  ];

  return {
    ...inputs,
    projection,
    line,
    edge,
    edgePercent,
    base: breakdown.base ?? 43,
    projectionEdgePoints: breakdown.edgeContribution ?? 0,
    opponentAdjustment: opponent.points,
    opponentLabel: opponent.label,
    parkAdjustment: park.points,
    parkLabel: park.label,
    rollingBoost: breakdown.last5Contribution ?? 0,
    finalProbability: finalProbability != null ? round1(finalProbability) : null,
    explanationLines,
    summary: explanationLines.join(" · "),
    hitRates: hitRateSnapshot,
    calibration: calibrated,
    historicalDataPresent: historical.present,
    historicalMissing: historical.missingLabels,
    hitRateValidated: hitRateValidation.present,
    hitRateMissing: hitRateValidation.missingLabels,
    historicalDataWarning:
      historical.present && hitRateValidation.present
        ? ""
        : HISTORICAL_DATA_UNAVAILABLE_WARNING,
  };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function buildEdgeValidation(prop = {}, metrics = {}) {
  const projection = finite(metrics.projection ?? resolveProjectionValue(prop));
  const line = finite(prop.line);
  const edge = finite(metrics.edge ?? computeStandardEdge(projection, line));
  const computedPercent = computeStandardEdgePercent(edge, line);
  const storedPercent = finite(prop.edgePercent ?? metrics.edgePercent);
  const formula = "Edge = ((Projection - Line) / Line) × 100";
  const substitution =
    projection != null && line != null && line > 0
      ? `((${projection} - ${line}) / ${line}) × 100 = ${signedPct(computedPercent)}`
      : "Missing projection or line";

  const delta =
    storedPercent != null && computedPercent != null
      ? Math.abs(storedPercent - computedPercent)
      : null;

  return {
    formula,
    substitution,
    projection,
    line,
    rawEdge: edge,
    computedPercent,
    storedPercent,
    displayPercent: storedPercent ?? computedPercent,
    verified: delta == null || delta <= 1,
    delta,
    unusuallyLarge: computedPercent != null && Math.abs(computedPercent) >= 60,
    note:
      computedPercent != null && Math.abs(computedPercent) >= 60
        ? "Large edge — verify projection source and line scale for this market."
        : "",
  };
}

export function buildMatchupAudit(prop = {}) {
  const team = String(prop.team || "").trim().toUpperCase() || "—";
  const opponent = String(prop.opponent || "").trim().toUpperCase() || "—";
  const pitcher =
    String(prop.opposingPitcher || prop.pitcherName || prop.startingPitcher || "").trim() || "—";
  const venue = String(prop.venue || prop.ballpark || prop.stadium || prop.homeBallpark || "").trim() || "—";
  const matchupScore =
    finite(prop.matchupScore) ??
    finite(prop.formConfidenceScore) ??
    computeFormConfidenceScore(prop);

  const hasRichMatchup = Boolean(
    prop.matchupNote ||
      prop.handednessMatchup ||
      opponent !== "—" ||
      pitcher !== "—" ||
      prop.formBaseline != null
  );

  return {
    team,
    opponent,
    pitcher,
    venue,
    matchupScore: matchupScore != null ? Math.round(matchupScore) : null,
    matchupConfidence: prop.matchupConfidence || "—",
    matchupNote: prop.matchupNote || "",
    complete: hasRichMatchup && prop.matchupConfidence !== "LOW",
    formBaseline: prop.formBaseline ?? null,
  };
}

export function attachModelValidationFields(prop = {}, metrics = {}) {
  try {
    const probabilityAudit = buildProbabilityAudit(prop, metrics);
    const edgeValidation = buildEdgeValidation(prop, metrics);
    const matchupAudit = buildMatchupAudit(prop);
    const hitRates = probabilityAudit?.hitRates || buildHitRateSnapshot(prop);

    return {
      ...prop,
      probabilityAudit,
      probabilityCalibration: probabilityAudit?.calibration || prop.probabilityCalibration || null,
      edgeValidation,
      matchupAudit,
      hitRateSnapshot: hitRates,
      probabilityExplanation: probabilityAudit?.summary || "",
      hitRateLine: `L5 ${hitRates?.last5Label ?? "—"} · L10 ${hitRates?.last10Label ?? "—"} · Season ${hitRates?.seasonLabel ?? "—"}`,
    };
  } catch (error) {
    console.error("[ModelValidation] attach failed", prop?.playerName || prop?.player, error);
    return {
      ...prop,
      probabilityAudit: buildProbabilityAuditFallback(prop),
      hitRateSnapshot: buildHitRateSnapshot(prop),
    };
  }
}

export function formatProbabilityExplanation(audit = {}) {
  if (!audit?.explanationLines?.length) return "";
  return audit.explanationLines.join("\n");
}

export { formatHitRatePercent };
