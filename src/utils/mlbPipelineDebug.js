/** Pipeline stage logging + debug snapshot for MLB props flow. */

import { isVerifiedSportsbookProp } from "./propValidation.js";

export function logPipelineStage(stage = "", payload = {}) {
  if (typeof console === "undefined") return;
  console.info(`[MLB Pipeline] ${stage}`, payload);
}

export function buildPipelineDebugSnapshot({
  rawProps = [],
  parsedProps = [],
  pool = [],
  ranked = [],
  rejectedAudit = null,
  sourceStatus = {},
  lastUpdated = "",
  usedFallback = false,
  fallbackLabel = "",
  livePropCount = 0,
  fetchFailureReasons = [],
  isLive = false,
} = {}) {
  const verified = (parsedProps || []).filter(isVerifiedSportsbookProp);
  return {
    rawPropsFetched: rawProps.length,
    parsedPropsCount: parsedProps.length,
    verifiedPropsCount: verified.length,
    poolCount: pool.length,
    rankedCount: ranked.length,
    livePropCount: livePropCount || ranked.filter((p) => !p.isDemoData).length,
    rejectedPropsCount: rejectedAudit?.rejected ?? Math.max(0, pool.length - ranked.length),
    rejectionReasons: rejectedAudit?.reasons || {},
    sourceStatus: summarizeSourceStatus(sourceStatus),
    lastSuccessfulRefresh: lastUpdated || "",
    usedFallback,
    fallbackLabel,
    fetchFailureReasons,
    isLive,
    activeSources: Object.keys(summarizeSourceStatus(sourceStatus)).filter(
      (k) => !/failed|offline|empty/i.test(String(summarizeSourceStatus(sourceStatus)[k]))
    ),
  };
}

function summarizeSourceStatus(sourceStatus = {}) {
  const out = {};
  ["PrizePicks", "Underdog", "OddsAPI", "SportsDataIO", "Odds API"].forEach((key) => {
    const row = sourceStatus[key] || sourceStatus[key.replace(/\s/g, "")] || {};
    const status = String(row.status || row.apiStatus || row.badge || sourceStatus[key] || "Unknown");
    out[key] = statusIndicator(status, row);
  });
  return out;
}

export function statusIndicator(status = "", row = {}) {
  const text = String(status || row.lineSourceBadge || "").toUpperCase();
  if (/FAIL|ERROR|OFFLINE|EMPTY/.test(text) && !row.usableCount) return "🔴 API Failed";
  if (/CACHED|STALE|PARTIAL|DEGRADED|TIMEOUT/.test(text)) return "🟡 Partial Data";
  if (/LIVE|OK|SUCCESS|CONNECTED|READY/.test(text) || Number(row.usableCount || row.parsedCount || 0) > 0) {
    return "🟢 Connected";
  }
  return "🟡 Partial Data";
}
