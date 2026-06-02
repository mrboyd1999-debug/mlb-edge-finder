/**
 * Projection generation rejection audit — pinpoints why candidates fail to project.
 */

import { findStatProfile } from "../services/playerStats.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";
import { applyProjectionProviderChain } from "./projectionProviderChain.js";

export const PROJECTION_REJECTION_LABELS = {
  missingPlayer: "Missing player",
  missingMarket: "Missing market",
  missingMatchup: "Missing matchup",
  missingStats: "Missing stats",
  projectionNull: "Projection null",
};

function hasSeasonRowForPlayer(seasonStats = [], playerName = "") {
  const needle = String(playerName || "").trim().toLowerCase();
  if (!needle) return false;
  return (seasonStats || []).some((row) =>
    String(row?.Name || row?.name || "")
      .trim()
      .toLowerCase() === needle
  );
}

function hasStatsForProp(prop = {}, statsMap = null, seasonStats = []) {
  if (statsMap instanceof Map) {
    const profile = findStatProfile(statsMap, prop);
    if (profile && !profile.fallback) return true;
  }
  return hasSeasonRowForPlayer(seasonStats, prop.playerName || prop.player);
}

function hasMatchupContext(prop = {}) {
  return Boolean(
    String(prop.opponent || prop.opponentAbbr || "").trim() ||
      String(prop.matchup || "").trim() ||
      String(prop.opponentTeam || "").trim()
  );
}

function categorizeProjectionFailure(prop = {}, context = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  if (!player) return "missingPlayer";

  const market = String(prop.statType || prop.market || prop.propType || "").trim();
  if (!market) return "missingMarket";

  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "projectionNull";

  const projection = Number(prop.projection ?? prop.projectedValue);
  if (Number.isFinite(projection) && projection > 0) return null;

  const reasons = ["projectionNull"];
  if (!hasMatchupContext(prop)) reasons.push("missingMatchup");
  if (!hasStatsForProp(prop, context.statsMap, context.seasonStats)) reasons.push("missingStats");
  return reasons;
}

/**
 * Audit candidate → projected drop-off. Runs provider chain when context supplied.
 */
export function auditProjectionGenerationRejections(candidates = [], context = {}) {
  const candidateCount = Array.isArray(candidates) ? candidates.length : 0;
  const rejectionReasons = {
    missingPlayer: 0,
    missingMarket: 0,
    missingMatchup: 0,
    missingStats: 0,
    projectionNull: 0,
  };

  let evaluated = context.runProviderChain
    ? applyProjectionProviderChain(candidates, context).props
    : candidates;

  let projectedCount = countMergedProjections(evaluated);
  if (context.runProviderChain && projectedCount === 0 && candidateCount > 0) {
    evaluated = applyProjectionProviderChain(candidates, {
      ...context,
      maxFallbackRatio: 1,
    }).props;
    projectedCount = countMergedProjections(evaluated);
  }

  const filteredCount = Math.max(0, candidateCount - projectedCount);

  for (const prop of candidates) {
    const match =
      evaluated.find(
        (row) =>
          String(row.playerName || row.player || "").trim() === String(prop.playerName || prop.player || "").trim() &&
          String(row.statType || row.market || row.propType || "").trim() ===
            String(prop.statType || prop.market || prop.propType || "").trim() &&
          Number(row.line) === Number(prop.line)
      ) || prop;

    const categories = categorizeProjectionFailure(match, context);
    if (!categories) continue;

    const keys = Array.isArray(categories) ? categories : [categories];
    keys.forEach((key) => {
      if (rejectionReasons[key] != null) rejectionReasons[key] += 1;
    });
  }

  const rejectionRows = Object.entries(rejectionReasons)
    .map(([key, count]) => ({
      key,
      label: PROJECTION_REJECTION_LABELS[key] || key,
      count,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    candidateCount,
    filteredCount,
    projectedCount,
    rejectionReasons,
    rejectionRows,
    props: evaluated,
  };
}

export function logProjectionGenerationAudit(audit = {}) {
  console.log("[Projection Generation] candidate count:", audit.candidateCount ?? 0);
  console.log("[Projection Generation] filtered count:", audit.filteredCount ?? 0);
  console.log("[Projection Generation] projected count:", audit.projectedCount ?? 0);
  console.log("[Projection Generation] rejection reason count:", audit.rejectionReasons || {});
  if (audit.rejectionRows?.length) {
    console.table(audit.rejectionRows.map((row) => ({ Reason: row.label, Count: row.count })));
  }
  return audit;
}
