/**
 * Tier and confidence audit — structured logging and panel payloads.
 */

import {
  classifyPropTier,
  explainTierClassification,
  resolvePropConfidence,
  resolvePropPlayability,
  resolvePropEdge,
} from "./boardQuality.js";
import { computeMlbConfidenceBreakdown, qualifiesEliteRecentFormCap } from "./mlbPlayConfidence.js";

export { qualifiesEliteRecentFormCap };

export function buildConfidenceAuditLog(prop = {}, projection = null, options = {}) {
  const breakdown = options.breakdown || computeMlbConfidenceBreakdown(prop, projection);
  const seasonPenalty =
    breakdown.penalties?.find((row) => row.key === "missingSeason")?.amount ?? breakdown.seasonPenalty ?? 0;
  const pitcherPenalty =
    breakdown.penalties?.find((row) => row.key === "missingPitcher")?.amount ?? breakdown.pitcherPenalty ?? 0;
  const matchupPenalty =
    breakdown.penalties?.find((row) => row.key === "partialMatchup")?.amount ?? breakdown.matchupPenalty ?? 0;
  const integrityPenalty = breakdown.integrityPenalty ?? 0;
  const sanityPenalty = options.sanityPenalty ?? prop.confidenceSanityPenalty ?? 0;
  const tier = options.tier || classifyPropTier({ ...prop, displayConfidenceScore: options.finalConfidence ?? breakdown.final });

  return {
    player: prop.playerName || prop.player || "Unknown",
    tier,
    confidence_before_penalties: breakdown.weightedBase ?? breakdown.rawScore,
    confidence_after_penalties: breakdown.afterPenalties ?? breakdown.weightedBase,
    projection_score: breakdown.projectionQuality ?? breakdown.components?.projectionQuality,
    recent_form_score: breakdown.recentForm ?? breakdown.components?.recentForm,
    edge_score: breakdown.edgeScore ?? breakdown.components?.edgeScore,
    hit_rate_score: breakdown.hitRate ?? breakdown.components?.hitRate,
    matchup_score: breakdown.matchupQuality ?? breakdown.components?.matchup,
    season_penalty: seasonPenalty,
    pitcher_penalty: pitcherPenalty,
    matchup_penalty: matchupPenalty,
    integrity_penalty: integrityPenalty,
    sanity_penalty: sanityPenalty,
    floor_applied: Boolean(breakdown.floorApplied || options.floorApplied),
    final_confidence: options.finalConfidence ?? breakdown.final,
  };
}

export function logPropConfidenceAudit(prop = {}, audit = {}) {
  console.info("[Confidence Audit]", audit);
  return audit;
}

export function buildTierAuditEntry(prop = {}, options = {}) {
  const confidenceAudit =
    options.confidenceAudit || buildConfidenceAuditLog(prop, options.projection ?? prop.projection, options);
  const currentTier = classifyPropTier({
    ...prop,
    displayConfidenceScore: confidenceAudit.final_confidence ?? resolvePropConfidence(prop),
    playabilityScore: options.playability ?? prop.playabilityScore,
  });
  const expectedTier = classifyPropTier({
    ...prop,
    displayConfidenceScore: confidenceAudit.confidence_before_penalties,
    playabilityScore: options.playability ?? prop.playabilityScore,
  });
  const tierExplain = explainTierClassification({
    ...prop,
    displayConfidenceScore: confidenceAudit.final_confidence ?? resolvePropConfidence(prop),
    playabilityScore: options.playability ?? prop.playabilityScore,
  });

  const downgradeReasons = [];
  if (confidenceAudit.season_penalty > 0) {
    downgradeReasons.push({
      key: "season",
      label: "Missing season source",
      amount: confidenceAudit.season_penalty,
    });
  }
  if (confidenceAudit.pitcher_penalty > 0) {
    downgradeReasons.push({
      key: "pitcher",
      label: "Pitcher data penalty",
      amount: confidenceAudit.pitcher_penalty,
    });
  }
  if (confidenceAudit.integrity_penalty > 0) {
    downgradeReasons.push({
      key: "integrity",
      label: "Integrity penalty",
      amount: confidenceAudit.integrity_penalty,
    });
  }
  if (confidenceAudit.matchup_penalty > 0) {
    downgradeReasons.push({
      key: "matchup",
      label: "Partial matchup penalty",
      amount: confidenceAudit.matchup_penalty,
    });
  }
  if (confidenceAudit.sanity_penalty > 0) {
    downgradeReasons.push({
      key: "sanity",
      label: "Sanity check penalty",
      amount: confidenceAudit.sanity_penalty,
    });
  }
  if (currentTier !== expectedTier && tierExplain.tierAFailures.length) {
    tierExplain.tierAFailures.forEach((row) => {
      downgradeReasons.push({ key: "tierA", label: row, amount: null });
    });
  }
  if (currentTier === "C" && tierExplain.tierBFailures.length) {
    tierExplain.tierBFailures.forEach((row) => {
      downgradeReasons.push({ key: "tierB", label: row, amount: null });
    });
  }

  return {
    player: prop.playerName || prop.player || "Unknown",
    market: prop.statType || prop.market || prop.propType || "—",
    currentTier,
    expectedTier,
    downgradeReasons,
    reasonForDowngrade:
      downgradeReasons.length > 0
        ? downgradeReasons
            .map((row) => (row.amount != null ? `${row.label} (-${row.amount})` : row.label))
            .join(" · ")
        : currentTier === expectedTier
          ? "Metrics align with assigned tier"
          : tierExplain.reason,
    confidence: Math.round(resolvePropConfidence(prop)),
    playability: Math.round(resolvePropPlayability(prop)),
    edge: resolvePropEdge(prop),
    tierExplain,
    confidenceAudit,
    pitcherMatchupAudit: prop.pitcherMatchupAudit || null,
  };
}

export function buildTierAuditBatch(pool = [], options = {}) {
  return (pool || []).map((prop) => buildTierAuditEntry(prop, options));
}
