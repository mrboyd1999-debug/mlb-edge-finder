/**
 * Staged MLB prop enrichment — team resolution, stats attachment, projection, verification.
 */

import { buildPlayerMapFromSeasonStats } from "./mlbPlayerDatabase.js";
import { projectMlbProp } from "./mlbProjectionEngine.js";
import { mergeProjectionsOntoProps } from "./projectionMergePipeline.js";
import { enrichPropWithTeamLookup } from "../../utils/teamEnrichment.js";
import { resolveBestPlayProjection } from "../../utils/bestPlaysPipelineDebug.js";
import { resolveMlbPlayerRow, buildMlbPlayerLookup } from "./playerNormalization.js";
import { findSeasonStatRow, resolveSportsDataPropLabel } from "../../../api/lib/sportsDataMlbStatProjection.js";
import { resolveMlbTeamAbbr } from "../../utils/mlbTeamLogos.js";
import { attachHistoricalStatsFromProfile } from "../../utils/historicalStatsLoader.js";

export const ENRICHMENT_STAGES = {
  VALIDATE_PLAYER: "validate_player",
  RESOLVE_TEAM: "resolve_team",
  VALIDATE_OPPONENT: "validate_opponent",
  ATTACH_STATS: "attach_stats",
  GENERATE_PROJECTION: "generate_projection",
  SIMULATE: "simulate",
  CALCULATE_CONFIDENCE: "calculate_confidence",
  MARK_VERIFIED: "mark_verified",
};

const pipelineDebug = {
  missingTeamPlayers: [],
  missingProjectionPlayers: [],
  stageFailures: {},
  enriched: 0,
  projected: 0,
  verified: 0,
};

export function resetEnrichmentPipelineDebug() {
  pipelineDebug.missingTeamPlayers = [];
  pipelineDebug.missingProjectionPlayers = [];
  pipelineDebug.stageFailures = {};
  pipelineDebug.enriched = 0;
  pipelineDebug.projected = 0;
  pipelineDebug.verified = 0;
}

export function getEnrichmentPipelineDebug() {
  return {
    missingTeamPlayers: [...pipelineDebug.missingTeamPlayers],
    missingProjectionPlayers: [...pipelineDebug.missingProjectionPlayers],
    stageFailures: { ...pipelineDebug.stageFailures },
    enriched: pipelineDebug.enriched,
    projected: pipelineDebug.projected,
    verified: pipelineDebug.verified,
  };
}

function recordStageFailure(stage, prop, reason) {
  pipelineDebug.stageFailures[stage] = (pipelineDebug.stageFailures[stage] || 0) + 1;
  const row = {
    player: prop.playerName || prop.player || "",
    statType: prop.statType || prop.market || "",
    source: prop.platform || prop.source || "",
    stage,
    reason,
  };
  if (stage === ENRICHMENT_STAGES.RESOLVE_TEAM) {
    pipelineDebug.missingTeamPlayers.push(row);
  }
  if (stage === ENRICHMENT_STAGES.GENERATE_PROJECTION) {
    pipelineDebug.missingProjectionPlayers.push(row);
  }
}

function resolveNumericConfidence(prop = {}) {
  const score = Number(prop.confidenceScore);
  if (Number.isFinite(score)) return score;
  const verified = Number(prop.verifiedProbability);
  if (Number.isFinite(verified)) return verified;
  const raw = Number(prop.confidence);
  if (Number.isFinite(raw)) return raw;
  return NaN;
}

function validatePlayer(prop = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  if (!player) return { ok: false, reason: "missing player" };
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return { ok: false, reason: "missing line" };
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  if (!statType) return { ok: false, reason: "missing stat type" };
  return { ok: true };
}

function resolveTeamForProp(prop = {}, context = {}) {
  const enriched = enrichPropWithTeamLookup(prop, context);
  if (enriched.team) {
    return {
      ...enriched,
      teamSource: enriched.teamSource || "lookup",
      playerId: enriched.playerId ?? prop.playerId ?? prop.sportsDataPlayerId,
    };
  }
  if (enriched.teamConfidence === "LOW") {
    recordStageFailure(ENRICHMENT_STAGES.RESOLVE_TEAM, prop, "team unresolved — marked LOW confidence");
    return enriched;
  }
  recordStageFailure(ENRICHMENT_STAGES.RESOLVE_TEAM, prop, "team unresolved after all lookups");
  return enriched;
}

function attachStatsToProp(prop = {}, context = {}) {
  const statsMap = context.statsMap;
  if (statsMap instanceof Map) {
    const withHistorical = attachHistoricalStatsFromProfile(prop, context);
    if (withHistorical.historicalStatsAttached) {
      return {
        ...withHistorical,
        enrichmentStage: ENRICHMENT_STAGES.ATTACH_STATS,
      };
    }
  }

  const lookup = context.playerLookup || buildMlbPlayerLookup(context.seasonStats || []);
  const statRow =
    resolveMlbPlayerRow(prop.playerName || prop.player, lookup, { playerId: prop.playerId }) ||
    findSeasonStatRow(context.seasonStats || [], {
      playerName: prop.playerName || prop.player,
      playerId: prop.playerId,
    });

  if (!statRow) {
    recordStageFailure(ENRICHMENT_STAGES.ATTACH_STATS, prop, "no season stat row");
    return prop;
  }

  const propLabel = resolveSportsDataPropLabel(prop);
  const games = Number(statRow.Games ?? statRow.GamesPlayed) || 0;

  return attachHistoricalStatsFromProfile(
    {
      ...prop,
      team: prop.team || resolveMlbTeamAbbr(statRow.Team)?.toUpperCase() || "",
      playerId: prop.playerId ?? statRow.PlayerID,
      sportsDataPlayerId: prop.sportsDataPlayerId ?? statRow.PlayerID,
      position: prop.position || statRow.Position || "",
      games: prop.games ?? games,
      sportsDataSeason: prop.sportsDataSeason ?? statRow,
      sportsDataStatRow: statRow,
      sportsDataPropLabel: propLabel,
      enrichmentStage: ENRICHMENT_STAGES.ATTACH_STATS,
    },
    context
  );
}

function mergeProjectionOntoProp(prop = {}, row = {}) {
  const projection = row.projection ?? row.projectedValue;
  const confidence = row.confidence ?? row.confidenceScore ?? row.meta?.confidenceDetail?.confidence;
  const projectionSource = row.projectionSource || row.meta?.projectionSource || prop.projectionSource;
  return {
    ...prop,
    team: prop.team || row.team || "",
    opponent: prop.opponent || row.opponent || "",
    playerId: prop.playerId ?? row.playerId ?? prop.sportsDataPlayerId,
    sportsDataPlayerId: prop.sportsDataPlayerId ?? row.playerId,
    projection: projection ?? prop.projection,
    projectedValue: projection ?? prop.projectedValue,
    edge: row.edge ?? prop.edge,
    confidenceScore: confidence ?? prop.confidenceScore,
    confidence: typeof confidence === "number" ? confidence : prop.confidence,
    verifiedProbability: prop.verifiedProbability ?? (typeof confidence === "number" ? confidence : undefined),
    projectionSource,
    projectionMissingReason: row.meta?.invalidReason || row.invalidReason || prop.projectionMissingReason || "",
    isVerifiedProjection: Boolean(
      projection > 0 && (projectionSource === "mlb-verified-engine" || prop.isVerifiedProjection)
    ),
    simulation: row.meta?.simulation || row.simulation || prop.simulation,
    enrichmentStage: ENRICHMENT_STAGES.GENERATE_PROJECTION,
  };
}

export function enrichMlbProp(prop = {}, context = {}) {
  const validation = validatePlayer(prop);
  if (!validation.ok) {
    recordStageFailure(ENRICHMENT_STAGES.VALIDATE_PLAYER, prop, validation.reason);
    return { prop, failedStage: ENRICHMENT_STAGES.VALIDATE_PLAYER, reason: validation.reason };
  }

  let working = { ...prop };
  working = resolveTeamForProp(working, context);

  working = attachStatsToProp(working, context);
  pipelineDebug.enriched += 1;

  if (!String(working.team || "").trim() && working.teamConfidence !== "LOW") {
    recordStageFailure(ENRICHMENT_STAGES.RESOLVE_TEAM, working, "team unresolved after all lookups");
  }

  if (!String(working.opponent || "").trim()) {
    recordStageFailure(ENRICHMENT_STAGES.VALIDATE_OPPONENT, working, "missing opponent");
  }

  const projected = projectMlbProp(working, context);
  working = mergeProjectionOntoProp(working, projected);

  const proj = resolveBestPlayProjection(working);
  if (proj == null || proj <= 0) {
    recordStageFailure(ENRICHMENT_STAGES.GENERATE_PROJECTION, working, projected.meta?.invalidReason || "missing projection");
    return { prop: working, failedStage: ENRICHMENT_STAGES.GENERATE_PROJECTION, reason: "missing projection" };
  }

  pipelineDebug.projected += 1;

  const confidence = resolveNumericConfidence(working);
  if (!Number.isFinite(confidence)) {
    recordStageFailure(ENRICHMENT_STAGES.CALCULATE_CONFIDENCE, working, "missing confidence");
  }

  if (working.isVerifiedProjection && confidence >= 65) {
    working.verified = true;
    working.enrichmentStage = ENRICHMENT_STAGES.MARK_VERIFIED;
    pipelineDebug.verified += 1;
  }

  return { prop: working, failedStage: null, reason: "" };
}

export function enrichMlbPropsBatch(props = [], context = {}) {
  resetEnrichmentPipelineDebug();

  const seasonStats = context.seasonStats || [];
  if (seasonStats.length) {
    const mapResult = buildPlayerMapFromSeasonStats(seasonStats);
    console.info("[MLB Enrichment] player map hydrated", mapResult);
  }

  const playerLookup = context.playerLookup || buildMlbPlayerLookup(seasonStats);
  const sharedContext = { ...context, seasonStats, playerLookup };

  const preMerged = context.skipInitialMerge
    ? { props, debug: context.initialMergeDebug || {} }
    : mergeProjectionsOntoProps(props, sharedContext);
  const mergeDebug = preMerged.debug;

  const enriched = (preMerged.props || []).map((prop) => {
    const existing = resolveBestPlayProjection(prop);
    if (existing != null && existing > 0) {
      return prop;
    }
    const result = enrichMlbProp(prop, sharedContext);
    return result.prop;
  });

  pipelineDebug.projected = enriched.filter((prop) => {
    const proj = resolveBestPlayProjection(prop);
    return proj != null && proj > 0;
  }).length;

  const debug = {
    ...getEnrichmentPipelineDebug(),
    merge: mergeDebug,
  };
  console.info("[MLB Enrichment] pipeline summary", {
    input: props.length,
    mergeMatchCount: mergeDebug?.matchCount ?? 0,
    mergeLookupCount: mergeDebug?.projectionLookupCount ?? 0,
    enriched: debug.enriched,
    projected: debug.projected,
    verified: debug.verified,
    missingTeam: debug.missingTeamPlayers.length,
    missingProjection: debug.missingProjectionPlayers.length,
    stageFailures: debug.stageFailures,
  });

  if (debug.missingTeamPlayers.length) {
    console.info("[MLB Enrichment] missingTeamPlayers sample", debug.missingTeamPlayers.slice(0, 8));
  }
  if (debug.missingProjectionPlayers.length) {
    console.info("[MLB Enrichment] missingProjectionPlayers sample", debug.missingProjectionPlayers.slice(0, 8));
  }

  return { props: enriched, debug };
}
