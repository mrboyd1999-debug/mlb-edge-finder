/**
 * Live prop source audit — raw HTTP + parse counts, not UI badges.
 * Usage: node scripts/live-prop-source-audit.mjs
 */

import {
  buildPrizePicksProjectionUrls,
  prizePicksRequestHeaders,
  PRIZEPICKS_MLB_LEAGUE_ID,
} from "../api/lib/prizepicksFetch.js";
import {
  countPrizePicksRawRecords,
  normalizePrizePicksResponse,
  parsePrizePicksProjections,
} from "../src/utils/prizepicksParse.js";
import {
  extractRawUnderdogRecords,
  parseUnderdogPayloadDedicated,
} from "../src/utils/parseUnderdogProp.js";

const UNDERDOG_DIRECT = "https://api.underdogfantasy.com/beta/v5/over_under_lines";
const DEV_BASE = process.env.AUDIT_DEV_BASE || "http://localhost:5173";
const FETCH_TIMEOUT_MS = 15_000;

function nowIso() {
  return new Date().toISOString();
}

function formatHours(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 3_600_000).toFixed(2)} hr`;
}

async function fetchWithAudit(url, { headers = {}, label = "" } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const result = {
    label,
    endpoint: url,
    responseCode: null,
    responseTimeMs: 0,
    timestamp: nowIso(),
    cacheAge: "live fetch",
    cacheAgeHours: null,
    bodyBytes: 0,
    error: "",
    timedOut: false,
    emptyPayload: false,
    payload: null,
  };

  try {
    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    result.responseCode = response.status;
    const text = await response.text();
    result.bodyBytes = text.length;
    result.responseTimeMs = Date.now() - startedAt;

    if (!text.trim()) {
      result.emptyPayload = true;
      result.error = "Empty response body";
      return result;
    }

    if (text.trim().startsWith("<")) {
      result.error = "HTML response (not JSON)";
      return result;
    }

    try {
      result.payload = JSON.parse(text);
    } catch (parseError) {
      result.error = `JSON parse failure: ${parseError.message}`;
      return result;
    }

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
    }
    return result;
  } catch (error) {
    result.responseTimeMs = Date.now() - startedAt;
    result.timedOut = error?.name === "AbortError";
    result.error = result.timedOut ? "Timeout" : error?.message || String(error);
    result.responseCode = result.timedOut ? "timeout" : result.responseCode;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function classifySource(audit, { propsCount = 0 } = {}) {
  const code = Number(audit.responseCode);
  if (audit.timedOut) return "FAILED (timeout)";
  if (code === 403) return "FAILED (403)";
  if (code === 404) return "FAILED (404)";
  if (audit.emptyPayload) return "FAILED (empty payload)";
  if (propsCount === 0) return "FAILED (0 props)";
  if (code >= 200 && code < 300 && propsCount > 0) return "LIVE OK";
  if (audit.error) return `FAILED (${audit.error})`;
  return "FAILED";
}

function samplePrizePicksRaw(payload, limit = 20) {
  const normalized = normalizePrizePicksResponse(payload);
  const parsed = parsePrizePicksProjections(normalized);
  const rawRecords = Array.isArray(normalized.data) ? normalized.data : [];
  return {
    rawCount: countPrizePicksRawRecords(payload),
    parsedCount: parsed.length,
    rawSample: rawRecords.slice(0, limit).map((row) => ({
      id: row?.id,
      type: row?.type,
      stat: row?.attributes?.stat_type || row?.attributes?.stat_display_name,
      line: row?.attributes?.line_score ?? row?.attributes?.line,
      description: row?.attributes?.description,
      playerRel: row?.relationships?.new_player?.data?.id || row?.relationships?.player?.data?.id,
    })),
    parsedSample: parsed.slice(0, limit).map((row) => ({
      playerName: row.playerName || row.player,
      statType: row.statType,
      line: row.line,
      sport: row.sport,
    })),
  };
}

function sampleUnderdogRaw(payload, limit = 20) {
  const rawRecords = extractRawUnderdogRecords(payload);
  let parsed = [];
  try {
    parsed = parseUnderdogPayloadDedicated(payload, "LIVE", "MLB").props || [];
  } catch {
    parsed = [];
  }
  return {
    rawCount: rawRecords.length,
    parsedCount: parsed.length,
    rawSample: rawRecords.slice(0, limit).map((row) => ({
      id: row?.id,
      stat: row?.stat || row?.stat_type || row?.over_under?.stat,
      line: row?.stat_value ?? row?.line ?? row?.over_under?.line,
      playerId: row?.player_id || row?.appearance_id,
    })),
    parsedSample: parsed.slice(0, limit).map((row) => ({
      playerName: row.playerName || row.player,
      statType: row.statType,
      line: row.line,
      sport: row.sport,
    })),
  };
}

async function auditPrizePicks() {
  const urls = buildPrizePicksProjectionUrls({ leagueId: PRIZEPICKS_MLB_LEAGUE_ID });
  const attempts = [];

  for (const url of urls) {
    attempts.push(
      await fetchWithAudit(url, {
        headers: prizePicksRequestHeaders(),
        label: "PrizePicks direct",
      })
    );
    const last = attempts[attempts.length - 1];
    if (last.payload && !last.error && Number(last.responseCode) >= 200 && Number(last.responseCode) < 300) {
      const counts = samplePrizePicksRaw(last.payload);
      if (counts.rawCount > 0) break;
    }
  }

  const proxyAttempt = await fetchWithAudit(`${DEV_BASE}/api/prizepicks?league_id=${PRIZEPICKS_MLB_LEAGUE_ID}`, {
    headers: prizePicksRequestHeaders(),
    label: "PrizePicks dev proxy",
  });

  const best =
    [...attempts, proxyAttempt].find(
      (row) =>
        row.payload &&
        Number(row.responseCode) >= 200 &&
        Number(row.responseCode) < 300 &&
        samplePrizePicksRaw(row.payload).rawCount > 0
    ) ||
    proxyAttempt ||
    attempts[attempts.length - 1];

  const counts = best?.payload ? samplePrizePicksRaw(best.payload) : { rawCount: 0, parsedCount: 0, rawSample: [], parsedSample: [] };
  const sourceStatus = classifySource(best || {}, { propsCount: counts.rawCount });

  return {
    sourceStatus,
    endpoint: best?.endpoint || urls[0],
    responseCode: best?.responseCode ?? "—",
    propsFetched: counts.rawCount,
    parsedProps: counts.parsedCount,
    timestamp: best?.timestamp || nowIso(),
    cacheAge: best?.cacheAge || "live fetch",
    cacheAgeHours: null,
    attempts: attempts.map((a) => ({
      endpoint: a.endpoint,
      responseCode: a.responseCode,
      props: a.payload ? samplePrizePicksRaw(a.payload).rawCount : 0,
      error: a.error,
    })),
    proxyAttempt: {
      endpoint: proxyAttempt.endpoint,
      responseCode: proxyAttempt.responseCode,
      props: proxyAttempt.payload ? samplePrizePicksRaw(proxyAttempt.payload).rawCount : 0,
      fallback: Boolean(proxyAttempt.payload?.fallback),
      cached: Boolean(proxyAttempt.payload?.cached),
      error: proxyAttempt.error,
    },
    rawSample20: counts.rawSample,
    parsedSample20: counts.parsedSample,
  };
}

async function auditUnderdog() {
  const routes = [
    UNDERDOG_DIRECT,
    `${DEV_BASE}/api/underdog`,
    `${DEV_BASE}/api/underdog/beta/v5/over_under_lines`,
  ];
  const headers = {
    accept: "application/json, text/plain, */*",
    origin: "https://underdogfantasy.com",
    referer: "https://underdogfantasy.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  };

  const attempts = [];
  for (const url of routes) {
    const attempt = await fetchWithAudit(url, { headers, label: "Underdog" });
    attempts.push(attempt);
    if (attempt.payload) {
      const counts = sampleUnderdogRaw(attempt.payload);
      if (counts.parsedCount > 0 && Number(attempt.responseCode) >= 200 && Number(attempt.responseCode) < 300) {
        break;
      }
    }
  }

  const best =
    attempts.find(
      (row) =>
        row.payload &&
        Number(row.responseCode) >= 200 &&
        Number(row.responseCode) < 300 &&
        sampleUnderdogRaw(row.payload).parsedCount > 0
    ) || attempts[attempts.length - 1];

  const counts = best?.payload
    ? sampleUnderdogRaw(best.payload)
    : { rawCount: 0, parsedCount: 0, rawSample: [], parsedSample: [] };

  const usedCache = Boolean(best?.payload?.fallback || best?.payload?.cached);
  const savedAt = best?.payload?.savedAt || best?.payload?.cacheSavedAt;
  const cacheAgeMs = savedAt ? Date.now() - new Date(savedAt).getTime() : null;

  return {
    sourceStatus: classifySource(best || {}, { propsCount: counts.parsedCount }),
    endpoint: best?.endpoint || routes[0],
    responseCode: best?.responseCode ?? "—",
    propsFetched: counts.rawCount,
    parsedProps: counts.parsedCount,
    timestamp: best?.timestamp || nowIso(),
    cacheAge: usedCache ? formatHours(cacheAgeMs) : "live fetch (not cache-only)",
    cacheAgeHours: usedCache ? cacheAgeMs / 3_600_000 : null,
    liveOnly: !usedCache && counts.parsedCount > 0,
    cacheOnly: usedCache && counts.parsedCount > 0,
    attempts: attempts.map((a) => ({
      endpoint: a.endpoint,
      responseCode: a.responseCode,
      raw: a.payload ? sampleUnderdogRaw(a.payload).rawCount : 0,
      parsed: a.payload ? sampleUnderdogRaw(a.payload).parsedCount : 0,
      fallback: Boolean(a.payload?.fallback),
      error: a.error,
    })),
    rawSample20: counts.rawSample,
    parsedSample20: counts.parsedSample,
  };
}

async function auditMlbPipeline() {
  let board = null;
  try {
    const response = await fetch(`${DEV_BASE}/api/prizepicks?league_id=${PRIZEPICKS_MLB_LEAGUE_ID}`, {
      signal: AbortSignal.timeout(10_000),
    });
    // Pipeline counts come from in-app debug — approximate via direct fetches
  } catch {
    // ignore
  }

  const pp = await auditPrizePicks();
  const ud = await auditUnderdog();

  const rawPropsFetched = pp.propsFetched + ud.propsFetched;
  const normalizedProps = pp.parsedProps + ud.parsedProps;

  return {
    note: "Pipeline stage counts derived from live source fetches (app board cache not accessible from Node).",
    rawPropsFetched,
    normalizedProps,
    projectedProps: "requires in-app projection run",
    verifiedProps: "requires in-app verification run",
    displayedProps: "requires in-app board render",
    prizepicksContribution: { raw: pp.propsFetched, parsed: pp.parsedProps },
    underdogContribution: { raw: ud.propsFetched, parsed: ud.parsedProps },
  };
}

console.log("=== LIVE PROP SOURCE AUDIT ===");
console.log("Audit time:", nowIso());
console.log("Dev base:", DEV_BASE);
console.log("");

const prizePicks = await auditPrizePicks();
console.log("--- 1. PRIZEPICKS ---");
console.log(JSON.stringify(prizePicks, null, 2));

const underdog = await auditUnderdog();
console.log("\n--- 2. UNDERDOG ---");
console.log(JSON.stringify(underdog, null, 2));

const pipeline = await auditMlbPipeline();
console.log("\n--- 3. MLB PIPELINE (source-level) ---");
console.log(JSON.stringify(pipeline, null, 2));

console.log("\n=== SUMMARY ===");
console.log("PrizePicks:", prizePicks.sourceStatus, "| props:", prizePicks.propsFetched, "| HTTP:", prizePicks.responseCode);
console.log("Underdog:", underdog.sourceStatus, "| parsed:", underdog.parsedProps, "| HTTP:", underdog.responseCode, "| cache:", underdog.cacheAge);
console.log("Combined raw:", pipeline.rawPropsFetched, "| normalized:", pipeline.normalizedProps);
