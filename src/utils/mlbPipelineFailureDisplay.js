import { normalizeSportsbookName } from "../services/playerMatcher.js";
import {
  MLB_CARD_CODE,
  toCardPipelineCode,
} from "../services/mlbPropPipelineTrace.js";

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "null";
  return String(value);
}

function hasUsableProjection(prop = {}) {
  const projection = Number(prop.projectedValue ?? prop.projection);
  return Number.isFinite(projection) && projection > 0 && !prop.projectionUnavailable;
}

export function isMlbProp(prop = {}) {
  return String(prop.sport || "").toUpperCase() === "MLB";
}

export function resolveMlbPipelineFailureView(prop = {}) {
  if (!isMlbProp(prop)) return { show: false };
  if (prop.unverifiedGradeBlocked || prop.projectionUnavailable) return { show: false };

  const trace = prop.mlbPipelineTrace || {};
  let failureReason =
    prop.pipelineFailureCode ||
    (trace.failureCode
      ? toCardPipelineCode(trace.failureCode, { failureReason: trace.failureReason })
      : null);

  if (hasUsableProjection(prop) && failureReason === MLB_CARD_CODE.PROJECTION_SUCCESS) {
    return { show: false };
  }

  const shouldShow =
    Boolean(prop.projectionUnavailable) ||
    (Boolean(failureReason) && failureReason !== MLB_CARD_CODE.PROJECTION_SUCCESS);

  if (!shouldShow) return { show: false };

  if (!failureReason) {
    failureReason = MLB_CARD_CODE.EMPTY_GAME_LOGS;
  }

  return {
    show: true,
    failureReason,
    lastSuccessfulStage: trace.lastSuccessfulStage || "null",
    normalizedName: trace.normalizedName || normalizeSportsbookName(prop.playerName) || "null",
    matchedPlayer: trace.matchedPlayer ?? null,
    playerId: trace.playerId ?? prop.mlbId ?? prop.playerId ?? null,
    logsCount: trace.logsCount ?? prop.sampleSize ?? 0,
    apiStatusCode: trace.apiStatusCode ?? null,
    detailReason: trace.failureReason || prop.dataFetchReason || null,
  };
}

export function shouldShowMlbPipelineFailure(prop = {}) {
  return resolveMlbPipelineFailureView(prop).show;
}

export function formatPipelineDisplayValue(key, value) {
  if (key === "matchedPlayer" || key === "playerId") return displayValue(value);
  if (key === "logsCount") return Number.isFinite(Number(value)) ? String(value) : "0";
  if (key === "apiStatusCode") return value == null ? "null" : String(value);
  return displayValue(value);
}
