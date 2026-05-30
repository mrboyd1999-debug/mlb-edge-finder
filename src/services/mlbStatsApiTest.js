/**
 * Dedicated MLB Stats API connectivity probe — search + game logs canary.
 */

import { buildMlbStatsApiUrl, logMlbStatsApiCall, mlbStatsApiPathLabel } from "./mlbStatsApiUrl.js";
import { getMlbStatsFetchTimeoutMs } from "../utils/apiTimeout.js";
import { recordMlbStatsFetch } from "./mlbPipelineStatus.js";

const DEFAULT_CANARY_PLAYER = "Shohei Ohtani";

async function probeUrl(url, { timeoutMs, label = "MLB Stats API" } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = mlbStatsApiPathLabel(url);

  logMlbStatsApiCall({
    stage: "test-request",
    url,
    timeoutMs,
    endpoint,
  });

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const responseBody = await response.text();
    const durationMs = Date.now() - startedAt;
    const preview = responseBody.slice(0, 500);
    let payload = null;
    try {
      payload = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      payload = null;
    }

    logMlbStatsApiCall({
      stage: "test-response",
      url,
      status: response.status,
      preview,
      responseBody: preview,
      durationMs,
      timeoutMs,
      endpoint,
    });

    return {
      ok: response.ok && payload && !payload.error,
      status: response.status,
      durationMs,
      endpoint,
      responseBody: preview,
      payload,
      timedOut: false,
      error: response.ok ? payload?.error || "" : payload?.error || `HTTP ${response.status}`,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const timedOut = error?.name === "AbortError";
    const message = timedOut ? `Timed out after ${timeoutMs}ms` : error?.message || "Request failed";

    logMlbStatsApiCall({
      stage: "test-error",
      url,
      status: timedOut ? "timeout" : null,
      error: message,
      durationMs,
      timeoutMs,
      endpoint,
    });

    return {
      ok: false,
      status: timedOut ? "timeout" : "?",
      durationMs,
      endpoint,
      responseBody: "",
      payload: null,
      timedOut,
      error: message,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function testMlbStatsApiConnection({ playerName = DEFAULT_CANARY_PLAYER } = {}) {
  const timeoutMs = getMlbStatsFetchTimeoutMs();
  const testedAt = new Date().toISOString();
  const startedAt = Date.now();

  const searchUrl = buildMlbStatsApiUrl("/v1/people/search", { names: playerName });
  const search = await probeUrl(searchUrl, { timeoutMs, label: "search" });

  const people = search.payload?.people || [];
  const playerCount = people.length;
  const matchedPlayer = people[0]?.fullName || null;
  const playerId = people[0]?.id || null;

  let gameLogCount = 0;
  let logsProbe = null;

  if (search.ok && playerId) {
    const season = new Date().getFullYear();
    const logsUrl = buildMlbStatsApiUrl(`/v1/people/${playerId}/stats`, {
      stats: "gameLog",
      group: "pitching,hitting",
      season,
    });
    logsProbe = await probeUrl(logsUrl, { timeoutMs, label: "gameLog" });
    if (logsProbe.ok && logsProbe.payload) {
      gameLogCount = (logsProbe.payload.stats || []).reduce(
        (sum, bucket) => sum + (bucket.splits?.length || 0),
        0
      );
    }
  }

  const connected = search.ok && playerCount > 0;
  const responseTimeMs = Date.now() - startedAt;

  recordMlbStatsFetch({
    ok: connected,
    url: search.endpoint,
    statusCode: Number(search.status) || null,
    playersReturned: playerCount,
    matchedPlayer,
    playerId,
    error: connected ? "" : search.error || logsProbe?.error || "MLB Stats API test failed",
  });

  const result = {
    provider: "MLB Stats API",
    status: connected ? "Connected" : search.timedOut || logsProbe?.timedOut ? "Warning" : "Failed",
    connected,
    responseTimeMs,
    playerCount,
    gameLogCount,
    matchedPlayer,
    playerId,
    canaryPlayer: playerName,
    searchEndpoint: search.endpoint,
    searchStatus: search.status,
    searchDurationMs: search.durationMs,
    searchResponseBody: search.responseBody,
    logsEndpoint: logsProbe?.endpoint || "",
    logsStatus: logsProbe?.status ?? null,
    logsDurationMs: logsProbe?.durationMs ?? 0,
    logsResponseBody: logsProbe?.responseBody || "",
    timeoutMs,
    testedAt,
    detail: connected
      ? `${playerCount} players · ${gameLogCount} game logs · ${responseTimeMs}ms`
      : search.error || logsProbe?.error || "MLB Stats API unavailable",
  };

  console.info("[MLB Stats API Test]", result);
  return result;
}
