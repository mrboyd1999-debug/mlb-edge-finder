/** Confidence floors, consensus, risk, playability, flags, and premium copy. */

import { computeConservativeProbability } from "./conservativeProjection.js";
import { computeRelativeEdgePercent, computeStandardPropMetrics } from "./standardPropMetrics.js";
import { computePlayabilityScoreFromBreakdown } from "./playabilityScoring.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function normalizeSport(prop = {}) {
  return String(prop.sport || prop.league || "").toUpperCase();
}

export function computeEdgePercent(prop = {}, edge = null) {
  const e = finiteOr(edge ?? prop.edge, NaN);
  const line = finiteOr(prop.line, NaN);
  return computeRelativeEdgePercent(e, line);
}

export function hasMajorRiskFlags(prop = {}) {
  if (prop.blowoutRisk || /blowout/i.test(String(prop.riskFlags || ""))) return true;
  if (/questionable|gtd|doubtful|out/i.test(String(prop.injuryStatus || prop.statusNote || prop.injuryRisk || ""))) return true;
  if (prop.backToBack || /back-to-back|b2b/i.test(String(prop.formNote || ""))) return true;
  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 4) return true;
  const movement = prop.lineMovement || prop.lineMovementTag;
  if (movement?.againstPick || prop.lineMovementTag === "fade") return true;
  return false;
}

export function hasBookConfirmation(prop = {}) {
  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2) return true;
  if (prop.lineComparison?.prizePicksLine != null || prop.lineComparison?.underdogLine != null) return true;
  if (String(prop.platform || prop.source || "").match(/prizepicks|underdog/i)) return true;
  return false;
}

export function booksAlign(prop = {}) {
  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  const sbEdge = finiteOr(prop.sportsbookEdge, 0);
  return books >= 2 && sbEdge >= 0;
}

export function applyConfidenceFloors(confidence, prop = {}, edge = null) {
  let score = clamp(Math.round(confidence), 48, 88);
  const edgeVal = finiteOr(edge ?? prop.edge, 0);
  const edgePct = computeEdgePercent(prop, edgeVal) ?? 0;
  const hitRate = finiteOr(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate, NaN);
  const majorRisk = hasMajorRiskFlags(prop);

  if (edgeVal >= 2 && edgePct >= 18 && !majorRisk) score += 2;
  if (edgeVal >= 2.5 && Number.isFinite(hitRate) && hitRate >= 0.65) score += 2;

  return clamp(score, 48, 88);
}

export function applyConsensusAdjustments(confidence, prop = {}) {
  let delta = 0;
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const marketLine = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN);
  const ppLine = finiteOr(prop.lineComparison?.prizePicksLine, NaN);
  const udLine = finiteOr(prop.lineComparison?.underdogLine, NaN);
  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);

  if (Number.isFinite(marketLine) && line > 0) {
    const pctGap = ((marketLine - line) / line) * 100;
    const favorable = side.includes("under") ? pctGap < -4 : pctGap > 4;
    const unfavorable = side.includes("under") ? pctGap > 6 : pctGap < -6;
    if (favorable) delta += 6;
    if (unfavorable) delta -= 7;
  }

  const peerLines = [ppLine, udLine].filter(Number.isFinite);
  if (peerLines.length && line > 0) {
    const avgPeer = peerLines.reduce((a, b) => a + b, 0) / peerLines.length;
    const peerGap = ((avgPeer - line) / line) * 100;
    if (Math.abs(peerGap) >= 5) {
      const soft = side.includes("under") ? peerGap < 0 : peerGap > 0;
      delta += soft ? 4 : -5;
    }
  }

  if (books >= 3 && finiteOr(prop.sportsbookEdge, 0) >= 0.5) delta += 5;
  if (books >= 2 && finiteOr(prop.sportsbookEdge, 0) < -0.5) delta -= 6;

  return clamp(Math.round(confidence + delta), 50, 82);
}

export function applySportSpecificConfidence(confidence, prop = {}) {
  let delta = 0;
  const sport = normalizeSport(prop);

  if (/NBA|WNBA/.test(sport)) {
    if (Number(prop.opponentRank) >= 24) delta += 3;
    if (prop.minutesTrend === "up" || /minutes up/i.test(String(prop.formNote || ""))) delta += 3;
    if (Number(prop.usageDelta) > 0) delta += 2;
    if (/pace up|fast pace/i.test(String(prop.matchupNote || ""))) delta += 2;
  }

  if (sport === "MLB") {
    if (/wind out|tailwind|hitter friendly/i.test(String(prop.weatherNote || prop.formNote || ""))) delta += 2;
    if (/left|right|handedness|LHP|RHP/i.test(String(prop.matchupNote || ""))) delta += 2;
    if (/bullpen fatigue|tired pen/i.test(String(prop.formNote || ""))) delta += 2;
    if (Number(prop.strikeoutRate) >= 0.25 || /high k/i.test(String(prop.formNote || ""))) delta += 1;
  }

  if (/TENNIS|ATP|WTA/.test(sport)) {
    if (/surface|clay|hard|grass/i.test(String(prop.matchupNote || prop.formNote || ""))) delta += 2;
    if (/serve hold|break %|recent form/i.test(String(prop.formNote || ""))) delta += 2;
  }

  if (/SOCCER|MLS/.test(sport)) {
    if (Number(prop.projectedMinutes) >= 70) delta += 2;
    if (/shots|corners|possession/i.test(String(prop.statType || ""))) delta += 1;
  }

  return clamp(Math.round(confidence + delta), 50, 82);
}

export function computeTrueRiskLevel(prop = {}) {
  let riskPoints = 0;

  const vol = finiteOr(prop.volatility, NaN);
  const sample = finiteOr(prop.sampleSize ?? prop.gamesSample, NaN);
  const minutesStable = prop.minutesTrend !== "down" && !/volatile minutes|role change/i.test(String(prop.formNote || ""));

  if (Number.isFinite(vol)) {
    if (vol >= 3.5) riskPoints += 3;
    else if (vol >= 2.5) riskPoints += 1;
    else if (vol <= 1.8) riskPoints -= 2;
  }

  if (minutesStable && /stable role|consistent/i.test(String(prop.formNote || prop.usageAdjustment || ""))) {
    riskPoints -= 2;
  }

  if (prop.blowoutRisk || /blowout/i.test(String(prop.riskFlags || ""))) riskPoints += 3;
  if (/questionable|gtd|doubtful/i.test(String(prop.injuryStatus || prop.injuryRisk || ""))) riskPoints += 2;
  if (Number.isFinite(sample) && sample < 5) riskPoints += 2;
  if (prop.lineMovement?.againstPick || prop.lineMovementTag === "fade") riskPoints += 2;
  if (Number(prop.opponentRank) <= 8 && /NBA|WNBA/.test(normalizeSport(prop))) riskPoints += 1;

  if (riskPoints <= -1) return "LOW";
  if (riskPoints >= 3) return "HIGH";
  return "MEDIUM";
}

export function buildSmartFlags(prop = {}, edge = null) {
  const positive = [];
  const negative = [];
  const edgeVal = finiteOr(edge ?? prop.edge, 0);
  const edgePct = computeEdgePercent(prop, edgeVal) ?? 0;
  const hit10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);

  if (edgePct >= 12 || finiteOr(prop.sportsbookEdge, 0) > 0.5) positive.push("LINE VALUE");
  if (Number.isFinite(hit10) && hit10 >= 0.65) positive.push("HOT STREAK");
  if (Number(prop.opponentRank) >= 22 || /favorable|weak/i.test(String(prop.matchupNote || ""))) positive.push("FAVORABLE MATCHUP");
  if (prop.minutesTrend === "up" || /minutes up|role increase/i.test(String(prop.formNote || ""))) positive.push("MINUTES BOOST");
  if (booksAlign(prop) || finiteOr(prop.sportsbookEdge, 0) > 0) positive.push("MARKET EDGE");

  if (booksAlign(prop) === false && Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0) >= 2) {
    negative.push("SHARP WARNING");
  }
  if (finiteOr(prop.sampleSize, 10) < 5) negative.push("SMALL SAMPLE");
  if (prop.blowoutRisk || /blowout/i.test(String(prop.riskFlags || ""))) negative.push("BLOWOUT RISK");
  if (/questionable|gtd|doubtful/i.test(String(prop.injuryStatus || prop.injuryRisk || ""))) negative.push("INJURY WATCH");
  if (Number.isFinite(finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN))) {
    const line = finiteOr(prop.line, 0);
    const market = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, line);
    const side = String(prop.side || prop.bestPick || "over").toLowerCase();
    const inflated = side.includes("under") ? line < market * 0.92 : line > market * 1.08;
    if (inflated) negative.push("LINE INFLATION");
  }

  return { positive: [...new Set(positive)], negative: [...new Set(negative)] };
}

export function computePlayabilityScore(prop = {}, confidence = 50) {
  return computePlayabilityScoreFromBreakdown(
    { ...prop, displayConfidenceScore: confidence, confidenceScore: confidence, confidence },
    { confidence, metrics: prop }
  );
}

export function isDisplayResearchOnly(prop = {}) {
  if (prop.marketResearchOnly && prop.marketSupportTier === 2 && prop.noveltyMarket) return true;

  const confidence = finiteOr(prop.confidence ?? prop.confidenceScore, 0);
  const insufficientData =
    !prop.hasVerifiedStats &&
    !prop.manualEnriched &&
    finiteOr(prop.sampleSize, 0) < 3 &&
    !hasBookConfirmation(prop);
  const inactive = /inactive|out|dnp|suspended/i.test(String(prop.injuryStatus || prop.statusNote || prop.injuryRisk || ""));
  const questionable = /questionable|gtd|doubtful/i.test(String(prop.injuryStatus || prop.statusNote || prop.injuryRisk || ""));
  const unstableLine =
    prop.lineMovement?.againstPick ||
    prop.lineMovementTag === "fade" ||
    /unstable|steam against/i.test(String(prop.lineMovementTrustLabel || ""));

  if (confidence >= 65 && !insufficientData && !inactive && !questionable && !unstableLine) return false;
  if (confidence < 65) return true;
  if (insufficientData && !hasBookConfirmation(prop)) return true;
  if (inactive || questionable) return true;
  if (unstableLine && confidence < 72) return true;
  return false;
}

export function premiumRiskSummary(prop = {}) {
  const risk = computeTrueRiskLevel(prop);
  if (risk === "LOW") return "Stable role and matchup support this projection.";
  if (risk === "MEDIUM") return "Playable edge with normal variance — monitor late news.";
  return "Higher variance profile — size accordingly.";
}

export function premiumSampleNote(sampleSize = 0) {
  if (sampleSize >= 8) return "";
  if (sampleSize >= 3) return "Projection based on a moderate recent sample size.";
  return "Projection based on a smaller recent sample size.";
}

export function premiumWhySummary(prop = {}) {
  const parts = [];
  const edge = finiteOr(prop.edge, 0);
  const edgePct = computeEdgePercent(prop, edge);
  if (edge >= 1.5 && edgePct != null) parts.push(`Model projects ${edgePct}% edge vs the posted line`);
  if (prop.matchupNote || prop.opponent) parts.push(`Matchup context favors ${prop.playerName || "this spot"}`);
  const hit = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  if (Number.isFinite(hit)) parts.push(`Recent hit rate ${Math.round(hit * 100)}%`);
  if (booksAlign(prop)) parts.push("Multiple books align with the number");
  if (!parts.length) return premiumRiskSummary(prop);
  return parts.join(". ") + ".";
}

export function applyPropCalibrationBundle(prop = {}) {
  const projectionRaw = prop.projection ?? prop.projectedValue;
  const projection =
    Number.isFinite(Number(projectionRaw)) && Number(projectionRaw) > 0 ? Number(projectionRaw) : null;
  const edge = projection != null ? finiteOr(prop.edge, computeStandardPropMetrics({ projection, line: prop.line }).edge ?? 0) : null;
  let confidence = finiteOr(prop.confidence ?? prop.confidenceScore, 50);

  confidence = applyConsensusAdjustments(confidence, prop);
  confidence = applySportSpecificConfidence(confidence, prop);
  confidence = applyConfidenceFloors(confidence, prop, edge);

  const riskLevel = computeTrueRiskLevel(prop);
  const smartFlags = buildSmartFlags(prop, edge);
  const playabilityScore = computePlayabilityScore({ ...prop, riskLevel }, confidence);
  const displayResearchOnly = isDisplayResearchOnly({ ...prop, confidence, confidenceScore: confidence });
  const edgePct = edge != null ? computeEdgePercent(prop, edge) : null;
  const standardMetrics =
    projection != null
      ? computeStandardPropMetrics({ projection, line: finiteOr(prop.line, NaN), edge })
      : { edge: null, edgePercent: null, probabilityScore: null };
  const probabilityScore =
    projection != null
      ? computeConservativeProbability({ ...prop, projection, line: finiteOr(prop.line, NaN) }, standardMetrics)
      : null;

  return {
    ...prop,
    projection,
    projectedValue: projection,
    edge,
    edgePercent: edgePct,
    probabilityScore,
    confidence,
    confidenceScore: confidence,
    riskLevel,
    playabilityScore,
    smartFlags,
    positiveFlags: smartFlags.positive,
    negativeFlags: smartFlags.negative,
    displayResearchOnly,
    isDisplayPlayable: !displayResearchOnly,
    premiumRiskSummary: premiumRiskSummary({ ...prop, riskLevel }),
    premiumWhySummary: prop.whyThisPick?.compact || premiumWhySummary({ ...prop, edge, confidence }),
    scoringEngine: "calibrated-v3",
  };
}
