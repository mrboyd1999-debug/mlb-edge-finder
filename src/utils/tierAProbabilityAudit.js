/**
 * Tier A probability audit — detect inflated probabilities from recent/season conflation.
 */

import { classifyPropTier } from "./boardQuality.js";
import { MIN_SDIO_SEASON_GAMES } from "./seasonHitRate.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function auditTierAProbabilityPlay(prop = {}) {
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability);
  const calibration = prop.probabilityCalibration || prop.probabilityAudit?.calibration;
  const breakdown = calibration?.breakdown || prop.probabilityAudit || prop.probabilityCalibration?.breakdown || {};
  const seasonValid = Boolean(breakdown.seasonRateValid);
  const seasonGames = finite(breakdown.seasonGamesPlayed ?? prop.seasonGamesPlayed ?? prop.seasonGames);
  const confidence = finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
  const edgePercent = finite(breakdown.edgePercent ?? prop.edgePercent ?? prop.relativeEdgePercent);
  const inflated =
    probability != null &&
    probability >= 80 &&
    (!seasonValid || (seasonGames != null && seasonGames < MIN_SDIO_SEASON_GAMES));
  const eliteUnlock = Boolean(breakdown.eliteProbabilityUnlock);

  return {
    playerName: prop.playerName || prop.player || "—",
    statType: prop.statType || prop.market || prop.propType || "—",
    tier: classifyPropTier(prop),
    probability,
    rawProbability: finite(breakdown.rawProbability ?? calibration?.rawProbability),
    seasonValid,
    seasonGames,
    confidence,
    edgePercent,
    inflated,
    eliteUnlock,
    recentFormRate: finite(breakdown.recentFormRate ?? breakdown.recentHitRate),
    seasonHitRate: finite(breakdown.seasonHitRate),
    note: inflated
      ? "Probability ≥80% without verified season sample"
      : eliteUnlock
        ? "Elite unlock applied"
        : "",
  };
}

export function auditTierAProbabilityPool(pool = []) {
  const tierA = (pool || []).filter((prop) => classifyPropTier(prop) === "A");
  const rows = tierA.map(auditTierAProbabilityPlay);
  const inflated = rows.filter((row) => row.inflated);
  return {
    tierACount: rows.length,
    inflatedCount: inflated.length,
    inflatedRate: rows.length ? Math.round((inflated.length / rows.length) * 1000) / 10 : 0,
    rows,
    inflated,
    summary:
      inflated.length > 0
        ? `${inflated.length}/${rows.length} Tier A plays flagged for inflated probability`
        : rows.length
          ? `${rows.length} Tier A plays passed probability audit`
          : "No Tier A plays to audit",
  };
}
