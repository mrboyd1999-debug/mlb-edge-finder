/**
 * Emergency hard-debug: run ONE known MLB prop through every pipeline stage with loud failures.
 */

import { isDevEnvironment } from "./fetchUtil.js";
import { cachedFetch } from "./fetchUtil.js";
import { matchSportsbookPlayerToMlb, normalizeSportsbookName } from "./playerMatcher.js";
import { fetchMlbGameLogs } from "./mlbDataService.js";
import { buildMlbPropProjection } from "../modules/mlbProjectionService.js";
import { buildMlbStatsApiUrl } from "./mlbStatsApiUrl.js";
import { recordMlbProjectionResult } from "./mlbPipelineStatus.js";
import {
  recordProjectionPipelineError,
  setLastEmergencyDiagnostic,
  PIPELINE_STAGES,
  setPipelineStageCount,
} from "./mlbProjectionPipelineLog.js";
import { MLB_ONLY_MODE } from "../utils/mlbOnlyMode.js";

export const EMERGENCY_CANARY_PROP = {
  playerName: "Spencer Strider",
  statType: "Pitcher Strikeouts",
  line: 6.5,
  sport: "MLB",
  platform: "prizepicks",
  source: "PrizePicks",
  team: "ATL",
  sportsbookVerified: true,
};

export function isEmergencyProjectionDiagnosticEnabled() {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_MLB_EMERGENCY_DIAGNOSTIC === "1") {
    return true;
  }
  return false;
}

function canaryPropId(prop = {}) {
  return ["emergency-canary", prop.platform, prop.sport, prop.playerName, prop.statType, prop.line]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("-");
}

function pushStage(stages, name, ok, detail = {}) {
  const row = { stage: name, ok: Boolean(ok), ...detail, at: new Date().toISOString() };
  stages.push(row);
  console.info(`[MLB Emergency Diagnostic] ${name}`, row);
  return row;
}

function pushError(errors, stage, reason, detail = {}) {
  const row = { stage, reason: String(reason || "unknown error"), ...detail, at: new Date().toISOString() };
  errors.push(row);
  recordProjectionPipelineError(stage, row.reason, detail);
  console.error(`[MLB Emergency Diagnostic] FAILED — ${stage}: ${row.reason}`, detail);
  return row;
}

async function logRawPlayerSearchResponse(playerName = "") {
  const url = buildMlbStatsApiUrl("/v1/people/search", { names: playerName });
  try {
    const response = await cachedFetch(url, {}, { source: "MLB Stats", ttlMs: 0 });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const people = payload?.people || [];
    console.info("[MLB Emergency Diagnostic] RAW player search response", {
      status: response.status,
      url: String(url),
      peopleReturned: people.length,
      firstPlayer: people[0]
        ? {
            id: people[0].id,
            fullName: people[0].fullName,
            currentTeam: people[0].currentTeam?.name || people[0].currentTeam,
            primaryPosition: people[0].primaryPosition?.abbreviation,
          }
        : null,
      preview: text.slice(0, 600),
    });
    return { status: response.status, peopleCount: people.length, payload };
  } catch (error) {
    console.error("[MLB Emergency Diagnostic] RAW player search failed", { message: error.message });
    return { status: null, peopleCount: 0, error: error.message };
  }
}

async function logRawGameLogResponse(playerId) {
  const season = new Date().getFullYear();
  const url = buildMlbStatsApiUrl(`/v1/people/${playerId}/stats`, {
    stats: "gameLog",
    group: "pitching",
    season,
  });
  try {
    const response = await cachedFetch(url, {}, { source: "MLB Stats", ttlMs: 0 });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const firstSplit = payload?.stats?.[0]?.splits?.[0];
    const stat = firstSplit?.stat || null;
    console.info("[MLB Emergency Diagnostic] RAW gameLog API response", {
      status: response.status,
      url: String(url),
      season,
      statsBuckets: payload?.stats?.length ?? 0,
      splitsInFirstBucket: payload?.stats?.[0]?.splits?.length ?? 0,
      statKeys: stat ? Object.keys(stat) : [],
      strikeOuts: stat?.strikeOuts ?? stat?.strikeouts ?? null,
      inningsPitched: stat?.inningsPitched ?? null,
      hits: stat?.hits ?? null,
      firstSplitSample: stat,
      preview: text.slice(0, 800),
    });
    return { status: response.status, payload, statKeys: stat ? Object.keys(stat) : [] };
  } catch (error) {
    console.error("[MLB Emergency Diagnostic] RAW gameLog fetch failed", { message: error.message });
    return { status: null, error: error.message, statKeys: [] };
  }
}

function buildForcedVerifiedProp(prop, model, profile, match, scoreDFSPropResult = null) {
  const base = scoreDFSPropResult || {
    ...prop,
    id: canaryPropId(prop),
    mlbId: match?.player?.id ?? profile?.mlbId ?? null,
    projectedValue: model.projection,
    projection: model.projection,
    rawEdge: model.rawEdge,
    edge: model.edge,
    edgePercent: model.edgePercent,
    bestPick: model.recommendedSide,
    side: model.recommendedSide,
    pick: model.recommendedSide,
    recommendedSide: model.modelSide,
    modelPick: model.modelPickLabel,
    confidence: model.confidence,
    confidenceScore: model.confidence,
    isVerifiedProjection: model.isVerifiedProjection,
    projectionUnavailable: false,
    unverifiedGradeBlocked: false,
    hasGameLogs: Boolean(profile?.hasGameLogs || (profile?.sampleSize ?? 0) >= 3),
    hasVerifiedStats: true,
    sampleSize: profile?.sampleSize ?? null,
    last5Average: profile?.last5Average ?? null,
    seasonAverage: profile?.seasonAverage ?? null,
    whyThisPick: model.whyThisPick,
    analyticsReason: model.reasons?.join(" · ") || model.whyThisPick,
    modelReasons: model.reasons,
    projectionSource: model.projectionSource,
    dataStatus: model.dataStatus,
    isEmergencyCanary: true,
    emergencyDiagnostic: true,
  };
  return {
    ...base,
    id: canaryPropId(prop),
    isEmergencyCanary: true,
    emergencyDiagnostic: true,
  };
}

/**
 * Run Spencer Strider (or EMERGENCY_CANARY_PROP) through the full projection path with per-stage logging.
 */
export async function runEmergencyProjectionDiagnostic(options = {}) {
  const prop = { ...EMERGENCY_CANARY_PROP, ...(options.prop || {}) };
  const stages = [];
  const errors = [];
  const buildProfile = options.buildProfile;
  const scoreDFSProp = options.scoreDFSProp;
  const scoringContext = options.scoringContext;

  pushStage(stages, "prop_received", true, { prop });

  let normalized = "";
  try {
    normalized = normalizeSportsbookName(prop.playerName);
    pushStage(stages, "player_normalized", Boolean(normalized), { normalized });
  } catch (error) {
    pushError(errors, "player_normalized", error.message);
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  let rawSearch = null;
  try {
    rawSearch = await logRawPlayerSearchResponse(prop.playerName);
  } catch (error) {
    pushError(errors, "raw_player_search", error.message);
  }

  let match = null;
  try {
    match = await matchSportsbookPlayerToMlb(prop.playerName, { team: prop.team || "" });
  } catch (error) {
    pushError(errors, "player_matched", error.message);
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  if (!match?.player?.id) {
    pushError(errors, "player_matched", match?.reason || "No confident MLB Stats API player match", {
      confidence: match?.confidence ?? 0,
      candidatesCount: match?.candidatesCount ?? 0,
    });
    pushStage(stages, "player_matched", false, { reason: match?.reason });
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  pushStage(stages, "player_matched", true, {
    playerId: match.player.id,
    matchedName: match.player.fullName,
    confidence: match.confidence,
    team: match.player.currentTeam,
  });
  setPipelineStageCount(PIPELINE_STAGES.MATCHED_PLAYERS_COUNT, 1);

  let rawLogs = null;
  try {
    rawLogs = await logRawGameLogResponse(match.player.id);
  } catch (error) {
    pushError(errors, "raw_game_logs", error.message);
  }

  let splits = [];
  try {
    splits = await fetchMlbGameLogs(match.player.id, { group: "pitching" });
  } catch (error) {
    pushError(errors, "game_logs_fetched", error.message);
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  const pitchingSplits = splits.filter((split) => split._statGroup === "pitching" || split.stat?.inningsPitched != null);
  const usableSplits = pitchingSplits.length ? pitchingSplits : splits;

  pushStage(stages, "game_logs_fetched", usableSplits.length > 0, {
    totalSplits: splits.length,
    pitchingSplits: pitchingSplits.length,
    statKeys: usableSplits[0]?.stat ? Object.keys(usableSplits[0].stat) : rawLogs?.statKeys || [],
    sampleStrikeouts: usableSplits[0]?.stat?.strikeOuts ?? usableSplits[0]?.stat?.strikeouts ?? null,
  });

  if (!usableSplits.length) {
    pushError(errors, "game_logs_fetched", "game logs undefined or empty after MLB Stats API fetch", {
      rawLogsStatus: rawLogs?.status ?? null,
    });
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  setPipelineStageCount(PIPELINE_STAGES.GAME_LOGS_FOUND_COUNT, usableSplits.length);

  let profile = null;
  try {
    if (!buildProfile) {
      throw new Error("buildProfile function not provided to emergency diagnostic");
    }
    const bundle = {
      splits: usableSplits,
      playerName: match.player.fullName,
      mlbId: match.player.id,
      verifiedSource: true,
      hasGameLogs: true,
    };
    profile = buildProfile(bundle, prop.statType, prop.line);
  } catch (error) {
    pushError(errors, "stats_averaged", error.message);
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  if (!profile || (profile.last5Average == null && profile.seasonAverage == null)) {
    pushError(errors, "stats_averaged", "Profile built but last5/season averages missing", {
      sampleSize: profile?.sampleSize ?? 0,
      profileKeys: profile ? Object.keys(profile) : [],
    });
    pushStage(stages, "stats_averaged", false, { profile });
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  pushStage(stages, "stats_averaged", true, {
    last5Average: profile.last5Average,
    seasonAverage: profile.seasonAverage,
    sampleSize: profile.sampleSize,
  });

  let model = null;
  try {
    model = buildMlbPropProjection(prop, profile, {});
  } catch (error) {
    pushError(errors, "projection_calculated", error.message, { stack: error.stack });
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  if (!model || model.projectionUnavailable || !Number.isFinite(model.projection) || model.projection <= 0) {
    const reason =
      model?.statusMessage ||
      model?.projectionDebugReason ||
      "Projection returned null/undefined or unavailable";
    pushError(errors, "projection_calculated", reason, { model });
    pushStage(stages, "projection_calculated", false, { reason });
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs, model };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  pushStage(stages, "projection_calculated", true, { projection: model.projection, source: model.projectionSource });
  setPipelineStageCount(PIPELINE_STAGES.PROJECTIONS_GENERATED_COUNT, 1);

  const confOk = Number.isFinite(Number(model.confidence));
  pushStage(stages, "confidence_calculated", confOk, { confidence: model.confidence });
  if (!confOk) {
    pushError(errors, "confidence_calculated", "confidence is not a finite number", { confidence: model.confidence });
  }

  const edgeOk = Number.isFinite(Number(model.edge));
  pushStage(stages, "edge_calculated", edgeOk, {
    edge: model.edge,
    rawEdge: model.rawEdge,
    side: model.recommendedSide,
  });
  if (!edgeOk) {
    pushError(errors, "edge_calculated", "edge is not a finite number", { edge: model.edge });
  }

  const verified = Boolean(model.isVerifiedProjection && model.projection > 0 && confOk);
  pushStage(stages, "prop_verified", verified, {
    verified,
    projection: model.projection,
    confidence: model.confidence,
    edge: model.edge,
  });

  if (!verified) {
    pushError(errors, "prop_verified", "Prop failed verified projection gate", {
      isVerifiedProjection: model.isVerifiedProjection,
    });
    const result = { success: false, prop, stages, errors, forcedVerifiedProp: null, rawSearch, rawLogs, model };
    setLastEmergencyDiagnostic(result);
    return result;
  }

  recordMlbProjectionResult({
    ok: true,
    player: prop.playerName,
    statType: prop.statType,
    projection: model.projection,
    engineOperational: true,
  });

  setPipelineStageCount(PIPELINE_STAGES.VERIFIED_PROPS_COUNT, 1);

  let scoreDFSPropResult = null;
  if (typeof scoreDFSProp === "function" && scoringContext) {
    try {
      scoreDFSPropResult = scoreDFSProp({ ...prop, id: canaryPropId(prop) }, scoringContext);
      pushStage(stages, "score_dfs_prop", Boolean(scoreDFSPropResult?.projection), {
        projection: scoreDFSPropResult?.projection,
        verified: scoreDFSPropResult?.isVerifiedProjection,
        edge: scoreDFSPropResult?.edge,
        confidence: scoreDFSPropResult?.confidenceScore,
      });
      if (!scoreDFSPropResult?.isVerifiedProjection || !scoreDFSPropResult?.projection) {
        pushError(
          errors,
          "score_dfs_prop",
          scoreDFSPropResult?.projectionDebugReason ||
            scoreDFSPropResult?.statusMessage ||
            "scoreDFSProp did not produce verified projection",
          { scoreDFSPropResult }
        );
      }
    } catch (error) {
      pushError(errors, "score_dfs_prop", error.message);
    }
  }

  const forcedVerifiedProp = buildForcedVerifiedProp(prop, model, profile, match, scoreDFSPropResult);
  console.info("[MLB Emergency Diagnostic] CANARY SUCCESS — forcing verified prop", {
    player: forcedVerifiedProp.playerName,
    projection: forcedVerifiedProp.projection,
    confidence: forcedVerifiedProp.confidenceScore,
    edge: forcedVerifiedProp.edge,
    id: forcedVerifiedProp.id,
  });

  const result = {
    success: true,
    prop,
    stages,
    errors,
    model,
    profile,
    match,
    rawSearch,
    rawLogs,
    forcedVerifiedProp,
    canaryPassed: true,
  };
  setLastEmergencyDiagnostic(result);
  return result;
}
