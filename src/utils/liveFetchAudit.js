/** Live fetch audit logging for all sportsbook/API sources. */

import { logPipelineStage } from "./mlbPipelineDebug.js";

export function logLiveFetchResult(label = "", result = {}) {
  const debug = result.debug || {};
  const payload = {
    url: debug.apiUrl || result.apiUrl || "",
    status: result.status || debug.apiStatus || "Unknown",
    httpStatus: debug.httpStatus || result.httpStatus || null,
    rawCount: Number(debug.rawPropsLoaded ?? result.pipelineAudit?.fetched ?? 0),
    parsedCount: Number(debug.propsAfterParsing ?? result.parsedProps?.length ?? result.props?.length ?? 0),
    failedCount: result.status === "Failed" ? 1 : 0,
    rateLimited: Boolean(result.rateLimited || result.cached),
    timedOut: /timed?\s*out/i.test(String(debug.message || result.warnings?.join(" ") || "")),
    message: debug.message || result.warnings?.[0] || "",
  };

  logPipelineStage(`fetch.${label}`, payload);
  console.info(`[Live Fetch] ${label}`, payload);
  return payload;
}

export function resolveLiveFetchFailureReason(sourceMeta = {}) {
  const msg = String(sourceMeta.message || sourceMeta.lastError || "").toLowerCase();
  if (/invalid.*key|401|403|unauthorized/.test(msg)) return "API key invalid";
  if (/cors|blocked|cross-origin/.test(msg)) return "CORS blocked";
  if (/parser|parse|malformed/.test(msg)) return "Parser failed";
  if (/rate limit|429|cooldown/.test(msg)) return "Rate limited";
  if (/timed?\s*out|timeout|abort/.test(msg)) return "Request timeout";
  if (/empty|no props|0 props/.test(msg)) return "Empty response";
  if (sourceMeta.status === "Failed" || sourceMeta.apiStatus === "Failed") return "API failed";
  return "";
}

export function buildLiveFetchFailureSummary(sources = {}) {
  const reasons = [];
  Object.entries(sources || {}).forEach(([name, meta]) => {
    const reason = resolveLiveFetchFailureReason(meta);
    if (reason) reasons.push(`${name}: ${reason}`);
  });
  return reasons;
}
