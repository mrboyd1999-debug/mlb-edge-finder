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
  if (/parser mismatch|parser failed|parse error|malformed json|invalid json/.test(msg)) return "Parser failed";
  if (/rate limit|429|cooldown/.test(msg)) return "Rate limited";
  if (/timed?\s*out|timeout|abort/.test(msg)) return "Request timeout";
  if (/none matched mlb|0 mlb props|no mlb props/.test(msg)) return "No MLB props in feed";
  if (/empty|no props|0 props/.test(msg)) return "Empty response";
  if (sourceMeta.status === "Failed" || sourceMeta.apiStatus === "Failed") return "API failed";
  return "";
}

export function buildLiveFetchFailureSummary(sources = {}, { suppressWhenPrimaryLoaded = false } = {}) {
  const reasons = [];
  const ppUsable = Number(sources?.PrizePicks?.usablePropsCount ?? sources?.PrizePicks?.propsAfterParsing ?? 0);
  const udUsable = Number(sources?.Underdog?.usablePropsCount ?? sources?.Underdog?.propsAfterParsing ?? 0);
  const primaryLoaded = ppUsable + udUsable > 0;
  Object.entries(sources || {}).forEach(([name, meta]) => {
    const reason = resolveLiveFetchFailureReason(meta);
    if (!reason) return;
    if (suppressWhenPrimaryLoaded || primaryLoaded) {
      if (/no mlb props|none matched mlb|0 mlb props|empty response|parser returned 0 props/i.test(reason)) {
        if (name !== "PrizePicks" && name !== "Underdog") return;
        const usable = Number(meta?.usablePropsCount ?? meta?.propsAfterParsing ?? 0);
        if (usable > 0) return;
      }
      if ((name === "The Odds API" || name === "SportsDataIO") && /invalid|timeout|failed|empty|no props/i.test(reason)) {
        return;
      }
    }
    reasons.push(`${name}: ${reason}`);
  });
  return reasons;
}
