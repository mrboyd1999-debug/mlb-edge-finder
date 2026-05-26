/**
 * MLB projection pipeline logging, stage counters, and verified-prop collection.
 */

import { isDevEnvironment } from "./fetchUtil.js";

export const MLB_PROJECTION_TEST_MODE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_MLB_PROJECTION_TEST_MODE === "1") ||
  isDevEnvironment();

export const PIPELINE_STAGES = {
  FETCHED_PROPS_COUNT: "FETCHED_PROPS_COUNT",
  NORMALIZED_PROPS_COUNT: "NORMALIZED_PROPS_COUNT",
  MATCHED_PLAYERS_COUNT: "MATCHED_PLAYERS_COUNT",
  GAME_LOGS_FOUND_COUNT: "GAME_LOGS_FOUND_COUNT",
  PROJECTIONS_GENERATED_COUNT: "PROJECTIONS_GENERATED_COUNT",
  VERIFIED_PROPS_COUNT: "VERIFIED_PROPS_COUNT",
};

const pipelineStages = {
  FETCHED_PROPS_COUNT: 0,
  NORMALIZED_PROPS_COUNT: 0,
  MATCHED_PLAYERS_COUNT: 0,
  GAME_LOGS_FOUND_COUNT: 0,
  PROJECTIONS_GENERATED_COUNT: 0,
  VERIFIED_PROPS_COUNT: 0,
};

const filterCounters = {
  filteredMissingProjection: 0,
  filteredLowConfidence: 0,
  filteredBadMatch: 0,
  filteredLowEdge: 0,
  filteredOther: 0,
  verifiedProjections: 0,
  attempted: 0,
};

let projectionsComplete = true;
let statsFetchTimedOut = false;
let projectionErrors = [];
let lastEmergencyDiagnostic = null;

export function resetProjectionPipelineErrors() {
  projectionErrors = [];
  lastEmergencyDiagnostic = null;
}

export function recordProjectionPipelineError(stage = "", reason = "", detail = {}) {
  const entry = {
    stage: String(stage || "unknown"),
    reason: String(reason || "unknown error"),
    detail,
    at: new Date().toISOString(),
  };
  projectionErrors.push(entry);
  console.error("[MLB Projection Pipeline ERROR]", entry);
  return entry;
}

export function getProjectionPipelineErrors() {
  return [...projectionErrors];
}

export function setLastEmergencyDiagnostic(result = null) {
  lastEmergencyDiagnostic = result;
}

export function getLastEmergencyDiagnostic() {
  return lastEmergencyDiagnostic;
}

export function resetPipelineExecutionCounters() {
  Object.keys(pipelineStages).forEach((key) => {
    pipelineStages[key] = 0;
  });
  projectionsComplete = true;
  statsFetchTimedOut = false;
  projectionErrors = [];
  lastEmergencyDiagnostic = null;
}

export function setPipelineStageCount(stage, value) {
  if (stage in pipelineStages) pipelineStages[stage] = Number(value) || 0;
}

export function incrementPipelineStage(stage, amount = 1) {
  if (stage in pipelineStages) pipelineStages[stage] += amount;
}

export function getPipelineStageCounts() {
  return { ...pipelineStages };
}

export function markStatsFetchTimedOut(timedOut = true) {
  statsFetchTimedOut = Boolean(timedOut);
  if (timedOut) projectionsComplete = false;
}

export function markProjectionsComplete(complete = true) {
  projectionsComplete = Boolean(complete);
}

export function areProjectionsComplete() {
  return projectionsComplete && !statsFetchTimedOut;
}

export function resetProjectionFilterCounters() {
  Object.keys(filterCounters).forEach((key) => {
    filterCounters[key] = 0;
  });
}

export function getProjectionFilterCounters() {
  return { ...filterCounters };
}

function bumpFilterCounter(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (/projection|missing|unavailable|insufficient stats|game log/.test(text)) {
    filterCounters.filteredMissingProjection += 1;
  } else if (/confidence/.test(text)) {
    filterCounters.filteredLowConfidence += 1;
  } else if (/match|player|team|role/.test(text)) {
    filterCounters.filteredBadMatch += 1;
  } else if (/edge/.test(text)) {
    filterCounters.filteredLowEdge += 1;
  } else if (reason) {
    filterCounters.filteredOther += 1;
  }
}

export function recordProjectionFilterRejection(reason = "") {
  bumpFilterCounter(reason);
}

export function recordVerifiedProjectionGenerated() {
  filterCounters.verifiedProjections += 1;
}

export function summarizeStatsMap(statsMap = new Map()) {
  let matchedPlayers = 0;
  let gameLogsFound = 0;
  if (!(statsMap instanceof Map)) return { matchedPlayers, gameLogsFound };
  statsMap.forEach((profile) => {
    if (!profile || profile.fallback) return;
    if (profile.playerName) matchedPlayers += 1;
    const sample = Number(profile.sampleSize || profile.splits?.length || 0);
    if (profile.hasGameLogs || sample >= 3) gameLogsFound += 1;
  });
  return { matchedPlayers, gameLogsFound };
}

export function logPropProjectionPipeline(prop = {}, details = {}) {
  filterCounters.attempted += 1;
  if (details.rejectionReason) {
    bumpFilterCounter(details.rejectionReason);
  } else if (details.projectionValue != null && Number(details.projectionValue) > 0) {
    filterCounters.verifiedProjections += 1;
  }

  console.info("[MLB Projection Pipeline]", {
    playerName: prop.playerName || prop.player || "",
    team: prop.team || "",
    propType: prop.statType || prop.market || prop.propType || "",
    sportsbookLine: prop.line ?? null,
    matchedMLBPlayer: details.matchedMLBPlayer ?? prop.matchedPlayer ?? null,
    recentGamesFound: details.recentGamesFound ?? prop.sampleSize ?? null,
    last5Average: details.last5Average ?? prop.last5Average ?? null,
    seasonAverage: details.seasonAverage ?? prop.seasonAverage ?? null,
    projectionValue: details.projectionValue ?? prop.projection ?? prop.projectedValue ?? null,
    confidenceValue: details.confidenceValue ?? prop.confidenceScore ?? prop.confidence ?? null,
    edgeValue: details.edgeValue ?? prop.edge ?? null,
    rejectionReason: details.rejectionReason || null,
  });
}

export function logProjectionFunctionOutput(prop = {}, result = {}, failureReason = "") {
  const output = {
    playerName: prop.playerName || "",
    propType: prop.statType || prop.market || "",
    line: prop.line ?? null,
    projection: result?.projection ?? null,
    confidence: result?.confidence ?? null,
    edge: result?.edge ?? null,
    verified: Boolean(result?.isVerifiedProjection && !result?.projectionUnavailable && Number(result?.projection) > 0),
    reasoning: result?.reasoning || result?.reasons || null,
  };

  if (!output.verified) {
    const reason =
      failureReason ||
      result?.statusMessage ||
      result?.projectionDebugReason ||
      "Projection unavailable — insufficient MLB logs or unsupported market";
    console.warn("[MLB Projection] build returned unavailable", { ...output, failureReason: reason });
    return { ...output, verified: false, failureReason: reason };
  }

  console.info("[MLB Projection] build succeeded", output);
  return output;
}

export function logPipelineExecutionSummary(label = "Pipeline execution summary") {
  const payload = {
    ...getPipelineStageCounts(),
    filterCounters: getProjectionFilterCounters(),
    projectionsComplete: areProjectionsComplete(),
    statsFetchTimedOut,
    testMode: MLB_PROJECTION_TEST_MODE,
  };
  console.info(`[MLB Projection Pipeline] ${label}`, payload);
  return payload;
}

export function logProjectionFilterSummary(label = "Highest Probability filter summary") {
  const counters = getProjectionFilterCounters();
  console.info(`[MLB Projection Pipeline] ${label}`, counters);
  return counters;
}

export function collectVerifiedScoredProps(scoredProps = [], options = {}) {
  const testMode = options.testMode ?? MLB_PROJECTION_TEST_MODE;
  const minConf = testMode ? 55 : 65;
  const minEdge = testMode ? 0.2 : 0.5;
  const minSample = 3;
  const verified = [];
  const rejectionCounts = {
    missingProjection: 0,
    missingLogs: 0,
    lowConfidence: 0,
    lowEdge: 0,
    badPlayerMatch: 0,
    other: 0,
  };

  for (const prop of scoredProps || []) {
    if (String(prop?.sport || "").toUpperCase() !== "MLB") continue;

    const projection = Number(prop.projection ?? prop.projectedValue);
    if (!Number.isFinite(projection) || projection <= 0 || prop.projectionUnavailable || prop.unverifiedGradeBlocked) {
      rejectionCounts.missingProjection += 1;
      continue;
    }

    if (!prop.isVerifiedProjection) {
      rejectionCounts.missingProjection += 1;
      continue;
    }

    const sample = Number(prop.sampleSize || 0);
    const hasLogs = Boolean(prop.hasGameLogs || sample >= minSample || prop.last5Average != null);
    if (!hasLogs) {
      rejectionCounts.missingLogs += 1;
      continue;
    }

    if (prop.sparseProfile || prop.fallbackProfile) {
      rejectionCounts.badPlayerMatch += 1;
      continue;
    }

    const conf = Number(prop.confidenceScore ?? prop.confidence);
    if (!Number.isFinite(conf) || conf < minConf) {
      rejectionCounts.lowConfidence += 1;
      continue;
    }

    const edge = Number(prop.edge);
    if (!Number.isFinite(edge) || edge < minEdge) {
      rejectionCounts.lowEdge += 1;
      continue;
    }

    if (prop.passPlay || prop.noEdge) {
      rejectionCounts.other += 1;
      continue;
    }

    verified.push(prop);
  }

  setPipelineStageCount(PIPELINE_STAGES.VERIFIED_PROPS_COUNT, verified.length);

  return {
    verified,
    verifiedProps: verified,
    rejectionCounts,
    testMode,
    thresholds: { minConf, minEdge, minSample },
  };
}

export function buildMlbProjectionDiagnostics({
  scoredProps = [],
  statsMap = new Map(),
  testMode = MLB_PROJECTION_TEST_MODE,
  emergencyDiagnostic = null,
} = {}) {
  const { verified, rejectionCounts, thresholds } = collectVerifiedScoredProps(scoredProps, { testMode });
  const stageCounts = getPipelineStageCounts();
  const emergency = emergencyDiagnostic || getLastEmergencyDiagnostic();
  const projectionErrors = getProjectionPipelineErrors();
  return {
    stages: stageCounts,
    liveDebug: {
      propsFetched: stageCounts.FETCHED_PROPS_COUNT,
      propsNormalized: stageCounts.NORMALIZED_PROPS_COUNT,
      playerMatches: stageCounts.MATCHED_PLAYERS_COUNT,
      gameLogsFetched: stageCounts.GAME_LOGS_FOUND_COUNT,
      projectionsCreated: stageCounts.PROJECTIONS_GENERATED_COUNT,
      verifiedProps: stageCounts.VERIFIED_PROPS_COUNT,
    },
    verifiedPropsCount: verified.length,
    verifiedProps: verified.slice(0, 15).map((prop) => ({
      playerName: prop.playerName,
      statType: prop.statType,
      line: prop.line,
      projection: prop.projection,
      confidence: prop.confidenceScore ?? prop.confidence,
      edge: prop.edge,
      sampleSize: prop.sampleSize,
      isEmergencyCanary: Boolean(prop.isEmergencyCanary),
    })),
    rejectionCounts,
    thresholds,
    testMode,
    projectionsComplete: areProjectionsComplete(),
    statsFetchTimedOut,
    statsProfilesLoaded: statsMap instanceof Map ? statsMap.size : 0,
    emergencyCanary: emergency
      ? {
          success: Boolean(emergency.success),
          player: emergency.prop?.playerName || EMERGENCY_CANARY_LABEL,
          projection: emergency.model?.projection ?? emergency.forcedVerifiedProp?.projection ?? null,
          stages: emergency.stages || [],
          errors: emergency.errors || [],
          forcedInjected: Boolean(emergency.forcedVerifiedProp),
        }
      : null,
    projectionErrors,
    lastProjectionFailure:
      projectionErrors.length > 0
        ? projectionErrors[projectionErrors.length - 1]
        : emergency?.success === false && emergency.errors?.length
          ? emergency.errors[emergency.errors.length - 1]
          : null,
  };
}

const EMERGENCY_CANARY_LABEL = "Spencer Strider";
