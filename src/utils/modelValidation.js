/**
 * Model validation — probability audit, edge formula verification, matchup context.
 */

import {
  computeStandardEdge,
  computeRelativeEdgePercent,
} from "./standardPropMetrics.js";
import { hasMissingOpponentData, resolveProjectionValue } from "./conservativeProjection.js";
import { computeCalibratedProbability } from "./probabilityCalibration.js";
import { computeFormConfidenceScore } from "./matchupEnrichment.js";
import { formatHitRatePercent } from "./pickDirectionAudit.js";
import { resolveSeasonHitRateBundle } from "./seasonHitRate.js";
import { resolveVerifiedHitRateSnapshot } from "./verifiedHitRates.js";
import {
  normalizeLegacyStarterNote,
  STARTER_PENDING_LABEL,
} from "./opponentStarter.js";
import { formatWhip } from "./formatters.js";
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
  return resolveVerifiedHitRateSnapshot(prop);
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
  const edgePercent = finite(metrics.edgePercent ?? metrics.relativeEdgePercent ?? computeRelativeEdgePercent(edge, line));
  const hitRateSnapshot = buildHitRateSnapshot(prop);
  const historical = resolveHistoricalDataPresent(prop);
  const hitRateValidation = resolveHitRateValidationPresent(prop);
  const opponent = resolveOpponentAdjustment(prop);
  const park = resolveParkAdjustment(prop);

  const calibrated = computeCalibratedProbability(
    prop,
    { edge, edgePercent, projection },
    { verified: true, seasonStats: prop.seasonStats || metrics.seasonStats || [] }
  );
  const breakdown = calibrated?.breakdown || {};
  const finalProbability = calibrated?.probability ?? finite(prop.probabilityScore ?? prop.verifiedProbability) ?? null;

  const inputs = {
    last10HitRate: hitRateSnapshot.last10Label,
    seasonHitRate: hitRateSnapshot.seasonLabel,
    last5HitRate: hitRateSnapshot.last5Label,
    projectionVsLine: edgePercent != null ? signedPct(edgePercent) : edge != null ? `${edge > 0 ? "+" : ""}${round1(edge)}` : "—",
    opponentAdjustment: signedPct(opponent.points),
    parkAdjustment: signedPct(park.points),
    matchupAdjustment: "—",
    edgeContribution:
      breakdown.edgeContribution != null ? `${round1(breakdown.edgeContribution)}` : "—",
    projectionEdge: calibrated?.inputs?.projectionEdge ?? "—",
    last5Contribution:
      breakdown.recentContribution != null ? `${round1(breakdown.recentContribution * 0.4)}` : "—",
    last10Contribution: breakdown.recentContribution != null ? `${round1(breakdown.recentContribution)}` : "—",
    seasonContribution: breakdown.seasonContribution != null ? `${round1(breakdown.seasonContribution)}` : "—",
    projectionContribution:
      breakdown.projectionContribution != null ? `${round1(breakdown.projectionContribution)}` : "—",
    matchupContribution: breakdown.matchupContribution != null ? `${round1(breakdown.matchupContribution)}` : "—",
    confidenceContribution: "—",
    playabilityContribution: "—",
    recentHitRate: calibrated?.inputs?.recentHitRate ?? hitRateSnapshot.last10Label,
    playability: calibrated?.inputs?.playability ?? "—",
    confidence: calibrated?.inputs?.confidence ?? "—",
    rawProbability:
      calibrated?.rawProbability != null
        ? round1(calibrated.rawProbability)
        : breakdown.rawProbability != null
          ? round1(breakdown.rawProbability)
          : null,
    calibratedProbability: finalProbability != null ? round1(finalProbability) : null,
    probabilityTier: calibrated?.probabilityTier ?? calibrated?.inputs?.probabilityTier ?? "—",
  };

  const explanationLines = [
    "Probability Breakdown",
    `Projection Quality: ${calibrated?.inputs?.projectionQuality ?? "—"}`,
    `Season: ${calibrated?.inputs?.seasonHitRate ?? "—"}`,
    `Recent Form: ${calibrated?.inputs?.recentHitRate ?? hitRateSnapshot.last10Label}`,
    `Matchup: ${breakdown.matchupContribution != null ? `${round1(breakdown.matchupContribution)} pts` : "—"}`,
    `Market Edge: ${calibrated?.inputs?.projectionEdge ?? "—"}`,
    `Raw Probability: ${inputs.rawProbability != null ? `${inputs.rawProbability}%` : "—"}`,
    `Calibrated Probability: ${pct(finalProbability)}`,
    breakdown.eliteProbabilityUnlock ? "Elite unlock applied" : `Cap: ${breakdown.ceiling ?? 75}%`,
  ];

  return {
    ...inputs,
    projection,
    line,
    edge,
    edgePercent,
    base: breakdown.rawProbability ?? breakdown.base ?? 0,
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
  const computedPercent = computeRelativeEdgePercent(edge, line);
  const storedPercent = finite(prop.relativeEdgePercent ?? prop.edgePercent ?? metrics.edgePercent);
  const formula = "Edge = Projection − Line";
  const substitution =
    projection != null && line != null
      ? `${projection} − ${line} = ${edge != null ? (edge > 0 ? "+" : "") + round1(edge) : "—"}`
      : "Missing projection or line";
  const relativeNote =
    computedPercent != null ? `Relative edge (capped ±100%): ${computedPercent > 0 ? "+" : ""}${computedPercent}%` : "";

  const delta =
    storedPercent != null && computedPercent != null
      ? Math.abs(storedPercent - computedPercent)
      : null;

  return {
    formula,
    substitution,
    relativeNote,
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
        ? "Large relative edge — verify projection source and line scale for this market."
        : "",
  };
}

export function buildMatchupAudit(prop = {}) {
  const team = String(prop.team || "").trim().toUpperCase() || "—";
  const opponent = String(prop.opponent || "").trim().toUpperCase() || "—";
  const pitcherRaw = normalizeLegacyStarterNote(
    prop.opposingPitcher || prop.opponentStarterNote || prop.pitcherName || prop.startingPitcher || "",
    prop.team,
    prop.opponent,
    prop.probablePitchers
  );
  const pitcher = pitcherRaw || STARTER_PENDING_LABEL;
  const venue = String(prop.venue || prop.ballpark || prop.stadium || prop.homeBallpark || "").trim() || "—";
  const whip = finite(prop.opponentPitcherWhip);
  const whipLabel = formatWhip(whip);
  const matchupScore =
    finite(prop.matchupScore) ??
    finite(prop.formConfidenceScore) ??
    computeFormConfidenceScore(prop);

  const hasRichMatchup = Boolean(
    prop.matchupNote ||
      prop.handednessMatchup ||
      opponent !== "—" ||
      (pitcher !== "—" && pitcher !== STARTER_PENDING_LABEL) ||
      prop.formBaseline != null
  );

  return {
    team,
    opponent,
    pitcher,
    whip: whipLabel,
    venue,
    matchupScore: matchupScore != null ? Math.round(matchupScore) : null,
    matchupConfidence: prop.matchupConfidence || "—",
    matchupNote: prop.matchupNote || "",
    complete: hasRichMatchup && prop.matchupConfidence !== "LOW",
    formBaseline: prop.formBaseline ?? null,
  };
}

import { attachDataIntegrityFields } from "./dataIntegrity.js";

export function attachModelValidationFields(prop = {}, metrics = {}) {
  try {
    const probabilityAudit = buildProbabilityAudit(prop, metrics);
    const edgeValidation = buildEdgeValidation(prop, metrics);
    const matchupAudit = buildMatchupAudit(prop);
    const hitRates = probabilityAudit?.hitRates || buildHitRateSnapshot(prop);

    return attachDataIntegrityFields({
      ...prop,
      probabilityAudit,
      probabilityCalibration: probabilityAudit?.calibration || prop.probabilityCalibration || null,
      edgeValidation,
      matchupAudit,
      hitRateSnapshot: hitRates,
      probabilityExplanation: probabilityAudit?.summary || "",
      hitRateLine: `L5 ${hitRates?.last5Label ?? "—"} · L10 ${hitRates?.last10Label ?? "—"} · Season ${hitRates?.seasonLabel ?? "—"}`,
    });
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
