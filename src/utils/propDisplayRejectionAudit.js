/**
 * Display / verification rejection audit — debug-only filtering diagnostics.
 * Does not change projection math or provider fetchers.
 */

import { explainVerificationRejection, passesVerifiedTierFilter } from "./verifiedTierSystem.js";
import { passesMinimalBestPlaysFilter, resolveBestPlayEdgePercent, VERIFIED_MIN_EDGE } from "./bestPlaysPipelineDebug.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";
import { isFakeOrFallbackProp, preparePropForRender } from "./livePropRender.js";
import { filterResolvedSportProps } from "./underdogSportDetection.js";
import { isMinimalRenderableProp } from "./normalizeProp.js";

/** Temporary emergency thresholds when projections exist but verified count is zero. */
export const EMERGENCY_DEBUG_THRESHOLDS = {
  MIN_PROBABILITY: 55,
  MIN_CONFIDENCE: 55,
  MIN_EDGE: 0.01,
};

let verificationEmergencyDebugActive = false;

export function isVerificationEmergencyDebugActive() {
  return verificationEmergencyDebugActive;
}

export function setVerificationEmergencyDebugActive(active = false) {
  verificationEmergencyDebugActive = Boolean(active);
}

export function isVerificationEmergencyMode(projectedCount = 0, verifiedCount = 0) {
  return Number(projectedCount) > 0 && Number(verifiedCount) === 0;
}

export function resolveEffectiveVerificationThresholds() {
  if (!verificationEmergencyDebugActive) {
    return null;
  }
  return { ...EMERGENCY_DEBUG_THRESHOLDS };
}

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolvePropProbability(prop = {}) {
  return finiteOr(prop.probabilityScore ?? prop.verifiedProbability ?? prop.modelProbability, NaN);
}

function resolvePropConfidence(prop = {}) {
  return finiteOr(prop.finalConfidence ?? prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence, NaN);
}

function resolvePropEdgeRatio(prop = {}) {
  const edgePct = resolveBestPlayEdgePercent(prop);
  if (Number.isFinite(edgePct) && edgePct > 0) return edgePct;
  const edge = finiteOr(prop.edge, NaN);
  const line = finiteOr(prop.line, NaN);
  if (Number.isFinite(edge) && Number.isFinite(line) && line > 0) return Math.abs(edge) / line;
  return NaN;
}

function resolvePropProjection(prop = {}) {
  return finiteOr(prop.projection ?? prop.projectedValue, NaN);
}

export function resolvePropDisplayRejectionReason(prop = {}, options = {}) {
  const emergency = Boolean(options.emergencyMode);
  const player = String(prop.playerName || prop.player || "").trim();
  if (!player) return "missing player";
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "missing or invalid line";
  const stat = String(prop.statType || prop.market || prop.propType || "").trim();
  if (!stat) return "missing stat type";

  const projection = resolvePropProjection(prop);
  if (!Number.isFinite(projection) || projection <= 0) return "missing projection";

  if (isFakeOrFallbackProp(prop) && !emergency) return "fallback or synthetic prop excluded from live board";

  const mlb = filterResolvedSportProps([prop], "MLB", { selectedSportTab: "MLB" });
  if (!mlb.length && !emergency) return "filtered by MLB sport resolution";

  const prepared = preparePropForRender(prop);
  if (!isMinimalRenderableProp(prepared) && !emergency) return "failed minimal render shape";

  if (passesVerifiedTierFilter(prop)) return null;

  const probability = resolvePropProbability(prop);
  const confidence = resolvePropConfidence(prop);
  const edgeRatio = resolvePropEdgeRatio(prop);
  const minProb = emergency ? EMERGENCY_DEBUG_THRESHOLDS.MIN_PROBABILITY : 60;
  const minConf = emergency ? EMERGENCY_DEBUG_THRESHOLDS.MIN_CONFIDENCE : 62;
  const minEdge = emergency ? EMERGENCY_DEBUG_THRESHOLDS.MIN_EDGE : VERIFIED_MIN_EDGE;

  if (!Number.isFinite(probability)) return "probability missing";
  if (probability < minProb) return `probability ${Math.round(probability)}% below minimum ${minProb}%`;
  if (!Number.isFinite(confidence)) return "confidence missing";
  if (confidence < minConf) return `confidence ${Math.round(confidence)}% below minimum ${minConf}%`;
  if (!Number.isFinite(edgeRatio) || edgeRatio < minEdge) {
    const edgePct = Number.isFinite(edgeRatio) ? Math.round(edgeRatio * 1000) / 10 : "—";
    return `edge ${edgePct}% below minimum ${Math.round(minEdge * 100)}%`;
  }

  if (emergency && passesEmergencyDisplayFilter(prop)) return null;

  return explainVerificationRejection(prop) || "failed verified tier filter";
}

export function passesEmergencyDisplayFilter(prop = {}) {
  if (!passesMinimalBestPlaysFilter(prop)) return false;
  const projection = resolvePropProjection(prop);
  if (!Number.isFinite(projection) || projection <= 0) return false;
  const probability = resolvePropProbability(prop);
  const confidence = resolvePropConfidence(prop);
  const edgeRatio = resolvePropEdgeRatio(prop);
  if (!Number.isFinite(probability) || probability < EMERGENCY_DEBUG_THRESHOLDS.MIN_PROBABILITY) return false;
  if (!Number.isFinite(confidence) || confidence < EMERGENCY_DEBUG_THRESHOLDS.MIN_CONFIDENCE) return false;
  if (!Number.isFinite(edgeRatio) || edgeRatio < EMERGENCY_DEBUG_THRESHOLDS.MIN_EDGE) return false;
  return true;
}

function bucketRejectionReason(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (!text) return "other";
  if (text.includes("missing player")) return "rejectedMissingPlayer";
  if (text.includes("missing projection") || text.includes("invalid stat-specific projection")) {
    return "rejectedMissingProjection";
  }
  if (text.includes("probability")) return "rejectedLowProbability";
  if (text.includes("confidence")) return "rejectedLowConfidence";
  if (text.includes("edge")) return "rejectedLowEdge";
  return "other";
}

export function logPropRejection(prop = {}, reason = "") {
  if (!reason) return;
  console.log("[PROP REJECTED]", {
    player: prop.playerName || prop.player,
    stat: prop.statType || prop.market || prop.propType,
    projection: prop.projection ?? prop.projectedValue,
    line: prop.line,
    probability: resolvePropProbability(prop),
    confidence: resolvePropConfidence(prop),
    edge: prop.edge,
    reason,
  });
}

export function attachDisplayRejectionFields(props = [], options = {}) {
  return (props || []).map((prop) => {
    const reason = resolvePropDisplayRejectionReason(prop, options);
    return {
      ...prop,
      displayRejectionReason: reason || "",
      verificationRejectionReason: reason || prop.verificationRejectionReason || "",
      isEmergencyDebugDisplay: Boolean(options.emergencyMode && !reason),
    };
  });
}

export function createEmptyPropDisplayRejectionSummary() {
  return {
    totalProps: 0,
    rejectedMissingProjection: 0,
    rejectedLowProbability: 0,
    rejectedLowConfidence: 0,
    rejectedLowEdge: 0,
    rejectedMissingPlayer: 0,
    accepted: 0,
    other: 0,
    emergencyMode: false,
  };
}

/**
 * Audit projected pool for verification/display rejection buckets.
 */
export function auditPropDisplayRejections(props = [], options = {}) {
  const projectedCount = Number(options.projectedCount ?? countMergedProjections(props));
  const verifiedCount = Number(options.verifiedCount ?? 0);
  const emergencyMode = options.emergencyMode ?? isVerificationEmergencyMode(projectedCount, verifiedCount);
  const summary = createEmptyPropDisplayRejectionSummary();
  summary.emergencyMode = emergencyMode;
  const projectedPool = (props || []).filter((prop) => {
    const projection = resolvePropProjection(prop);
    return Number.isFinite(projection) && projection > 0;
  });
  summary.totalProps = projectedPool.length;

  const reasonCounts = {};
  const samples = [];

  for (const prop of projectedPool) {

    const reason = resolvePropDisplayRejectionReason(prop, { emergencyMode });
    if (!reason) {
      summary.accepted += 1;
      continue;
    }

    logPropRejection(prop, reason);
    const bucket = bucketRejectionReason(reason);
    if (bucket === "other") summary.other += 1;
    else summary[bucket] += 1;

    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    if (samples.length < 30) {
      samples.push({
        player: prop.playerName || prop.player,
        stat: prop.statType || prop.market,
        reason,
        probability: resolvePropProbability(prop),
        confidence: resolvePropConfidence(prop),
      });
    }
  }

  const topRejectionReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([reason, count]) => ({ reason, count }));

  return {
    summary,
    topRejectionReasons,
    samples,
    emergencyMode,
  };
}

function compareEmergencyProjectedRank(a = {}, b = {}) {
  const confA = resolvePropConfidence(a);
  const confB = resolvePropConfidence(b);
  if (confB !== confA) return confB - confA;
  const probA = resolvePropProbability(a);
  const probB = resolvePropProbability(b);
  if (probB !== probA) return probB - probA;
  const edgeA = finiteOr(a.edge, resolvePropEdgeRatio(a) * (Number(a.line) || 1));
  const edgeB = finiteOr(b.edge, resolvePropEdgeRatio(b) * (Number(b.line) || 1));
  return edgeB - edgeA;
}

/** Top projected props for emergency board when verified=0. */
export function buildEmergencyProjectedDisplayFallback(props = [], limit = 25) {
  return (props || [])
    .filter((prop) => {
      if (prop?.isDemoData) return false;
      const projection = resolvePropProjection(prop);
      const line = Number(prop?.line);
      const player = String(prop?.playerName || prop?.player || "").trim();
      return player && Number.isFinite(line) && line > 0 && Number.isFinite(projection) && projection > 0;
    })
    .sort(compareEmergencyProjectedRank)
    .slice(0, limit)
    .map((prop) => {
      const prepared = preparePropForRender({
        ...prop,
        isEmergencyDebugDisplay: true,
        displayRejectionReason: resolvePropDisplayRejectionReason(prop, { emergencyMode: true }) || "",
        cardPlayLabel: prop.cardPlayLabel || "Emergency debug display",
      });
      return prepared;
    });
}

export function applyEmergencyDisplayPipeline({
  allDisplayProps = [],
  acceptedPropsForRender = [],
  projectedCount = 0,
  verifiedCount = 0,
} = {}) {
  const projected = Number(projectedCount) || countMergedProjections(allDisplayProps);
  const verified = Number(verifiedCount) || 0;
  const displayed = acceptedPropsForRender.length;
  const emergency = isVerificationEmergencyMode(projected, verified);
  setVerificationEmergencyDebugActive(emergency);
  if (!emergency) {
    return {
      acceptedPropsForRender,
      rejectionAudit: auditPropDisplayRejections(allDisplayProps, { projectedCount: projected, verifiedCount: verified }),
      emergencyApplied: false,
    };
  }
  if (displayed > 0) {
    return {
      acceptedPropsForRender,
      rejectionAudit: auditPropDisplayRejections(allDisplayProps, {
        projectedCount: projected,
        verifiedCount: verified,
        emergencyMode: true,
      }),
      emergencyApplied: false,
    };
  }

  const rejectionAudit = auditPropDisplayRejections(allDisplayProps, {
    projectedCount: projected,
    verifiedCount: verified,
    emergencyMode: true,
  });
  const fallback = buildEmergencyProjectedDisplayFallback(allDisplayProps, 25);
  return {
    acceptedPropsForRender: fallback.length ? fallback : acceptedPropsForRender,
    rejectionAudit,
    emergencyApplied: Boolean(fallback.length),
  };
}
