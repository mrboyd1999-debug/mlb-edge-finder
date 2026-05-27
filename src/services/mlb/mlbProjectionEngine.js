/**
 * MLB-only projection engine facade.
 * Wraps verified modules/mlbProjectionEngine + SportsDataIO season rates.
 */

import { applyMlbProjectionToProp, isMlbVerifiedEngineMarket } from "../../modules/mlbProjectionService.js";
import {
  computeProjectionForProp,
  resolveSportsDataPropLabel,
} from "../../../api/lib/sportsDataMlbStatProjection.js";
import { findStatProfile } from "../playerStats.js";
import { buildMlbPlayerLookup, resolveMlbPlayerRow } from "./playerNormalization.js";
import { createMlbProjection } from "../../models/mlb/projectionModel.js";
import { computeTrueMlbConfidence } from "./trueConfidenceEngine.js";
import { simulatePropOutcome } from "./simulationEngine.js";

let debugCount = 0;

export function resetMlbProjectionDebugCount() {
  debugCount = 0;
}

export function projectMlbProp(prop = {}, context = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  const statType = String(prop.statType || prop.prop || prop.market || "").trim();
  const line = Number(prop.line);
  const seasonStats = context.seasonStats || [];
  const lookup = context.playerLookup || buildMlbPlayerLookup(seasonStats);

  if (!player || !Number.isFinite(line) || line <= 0) {
    return {
      ...createMlbProjection({ player, statType, line }),
      invalidReason: !player ? "missing player" : "missing line",
      projectionSource: "invalid",
    };
  }

  let projection = null;
  let projectionSource = "missing";
  let invalidReason = "";
  let statRow = resolveMlbPlayerRow(player, lookup, { playerId: prop.playerId });

  if (isMlbVerifiedEngineMarket(statType) && context.statsMap instanceof Map) {
    const profile = findStatProfile(context.statsMap, prop);
    if (profile) {
      const verified = applyMlbProjectionToProp(prop, profile, context.options || {});
      if (verified?.isVerifiedProjection && Number.isFinite(Number(verified.projection))) {
        projection = Number(verified.projection);
        projectionSource = "mlb-verified-engine";
      } else {
        invalidReason = verified?.projectionUnavailableReason || verified?.statusMessage || "verified engine unavailable";
      }
    }
  }

  if (projection == null && seasonStats.length) {
    const sdio = computeProjectionForProp(prop, seasonStats, { logDebug: false });
    if (sdio.projection != null) {
      projection = sdio.projection;
      projectionSource = sdio.projectionSource || "sportsdataio-season";
      statRow = statRow || resolveMlbPlayerRow(player, lookup, { playerId: prop.playerId });
    } else {
      invalidReason = invalidReason || sdio.matchReason || "no season stat match";
    }
  }

  const edge = projection != null ? Number((projection - line).toFixed(3)) : null;
  const side = edge == null ? null : edge >= 0 ? "over" : "under";
  const confidenceResult = computeTrueMlbConfidence({
    projection,
    line,
    edge,
    dataQuality: statRow ? 0.85 : 0.35,
    side,
  });
  const simulation = projection != null ? simulatePropOutcome({ projection, line }) : null;

  if (debugCount < 20) {
    debugCount += 1;
    console.log({
      player,
      prop: statType,
      statExists: Boolean(statRow),
      rawStat: statRow || null,
      projection,
      line,
      projectionSource,
      invalidReason,
    });
  }

  return createMlbProjection({
    player,
    team: prop.team || statRow?.Team || "",
    opponent: prop.opponent || "",
    statType,
    line,
    projection,
    edge,
    confidence: confidenceResult.confidence,
    hitRate: confidenceResult.simulatedOverProbability,
    odds: prop.odds || null,
    matchupScore: prop.matchupScore ?? null,
    dataQuality: statRow ? "verified-stats" : "unmatched",
    meta: {
      side,
      projectionSource,
      invalidReason,
      propLabel: resolveSportsDataPropLabel(prop),
      simulation,
      confidenceDetail: confidenceResult,
    },
  });
}

export function projectMlbPropBatch(props = [], context = {}) {
  const seasonStats = context.seasonStats || [];
  const playerLookup = context.playerLookup || buildMlbPlayerLookup(seasonStats);
  resetMlbProjectionDebugCount();
  return (props || []).map((prop) =>
    projectMlbProp(prop, {
      ...context,
      seasonStats,
      playerLookup,
    })
  );
}
