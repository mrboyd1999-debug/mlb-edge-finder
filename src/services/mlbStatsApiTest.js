/**
 * Dedicated MLB Stats API connectivity probe — uses server-side /api/mlb/search proxy.
 */

import { buildMlbStatsSearchTestUrl, logMlbStatsApiCall, mlbStatsApiPathLabel } from "./mlbStatsApiUrl.js";
import { getMlbStatsFetchTimeoutMs } from "../utils/apiTimeout.js";
import { recordMlbStatsFetch } from "./mlbPipelineStatus.js";

const DEFAULT_CANARY_PLAYER = "Shohei Ohtani";

function extractPeopleFromPayload(payload) {
  if (Array.isArray(payload?.people)) return payload.people;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function probeSearchUrl(url, { timeoutMs, label = "MLB Stats API" } = {}) {
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

    const people = extractPeopleFromPayload(payload);
    const connected = response.status === 200 && people.length > 0;

    logMlbStatsApiCall({
      stage: "test-response",
      url,
      status: response.status,
      preview,
      responseBody: preview,
      durationMs,
      timeoutMs,
      endpoint,
      playersReturned: people.length,
      matchedPlayer: people[0]?.fullName || null,
    });

    return {
      ok: connected,
      connected,
      status: response.status,
      durationMs,
      endpoint,
      responseBody: preview,
      payload,
      people,
      playerCount: people.length,
      matchedPlayer: people[0]?.fullName || null,
      playerId: people[0]?.id || null,
      timedOut: false,
      error: connected ? "" : payload?.error || `HTTP ${response.status}`,
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
      connected: false,
      status: timedOut ? "timeout" : "?",
      durationMs,
      endpoint,
      responseBody: "",
      payload: null,
      people: [],
      playerCount: 0,
      timedOut,
      error: message,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function testMlbStatsApiConnection({ playerName = DEFAULT_CANARY_PLAYER, retries = 1 } = {}) {
  const timeoutMs = getMlbStatsFetchTimeoutMs();
  const testedAt = new Date().toISOString();
  const startedAt = Date.now();
  const searchUrl = buildMlbStatsSearchTestUrl(playerName);

  let search = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    search = await probeSearchUrl(searchUrl, { timeoutMs, label: attempt ? `search-retry-${attempt}` : "search" });
    if (search.connected) break;
    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  }

  const playerCount = search?.playerCount || 0;
  const connected = search?.connected === true;
  const responseTimeMs = Date.now() - startedAt;

  recordMlbStatsFetch({
    ok: connected,
    url: search?.endpoint || "/api/mlb/search",
    statusCode: Number(search?.status) || null,
    playersReturned: playerCount,
    matchedPlayer: search?.matchedPlayer || null,
    playerId: search?.playerId || null,
    error: connected ? "" : search?.error || "MLB Stats API test failed",
  });

  const result = {
    provider: "MLB Stats API",
    status: connected ? "Connected" : search?.timedOut ? "Warning" : "Failed",
    connected,
    responseTimeMs,
    playerCount,
    gameLogCount: 0,
    matchedPlayer: search?.matchedPlayer || null,
    playerId: search?.playerId || null,
    canaryPlayer: playerName,
    searchEndpoint: search?.endpoint || "/api/mlb/search",
    searchStatus: search?.status,
    searchDurationMs: search?.durationMs ?? 0,
    searchResponseBody: search?.responseBody || "",
    timeoutMs,
    testedAt,
    detail: connected
      ? `HTTP 200 — ${playerCount} players matched · ${responseTimeMs}ms`
      : search?.error || "Stats API unavailable",
  };

  console.info("[MLB Stats API Test]", result);
  return result;
}
