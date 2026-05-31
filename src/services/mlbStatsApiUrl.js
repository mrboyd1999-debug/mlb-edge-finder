const MLB_STATS_DIRECT_ORIGIN = "https://statsapi.mlb.com/api";

/**
 * Build a StatsAPI URL that works in browser (same-origin proxy) and Node (direct).
 * @param {string} pathWithLeadingSlash e.g. "/v1/people/search"
 * @param {Record<string, string|number|boolean|null|undefined>} [searchParams]
 */
export function buildMlbStatsSearchUrl(playerName = "Shohei Ohtani") {
  if (canUseMlbStatsProxy()) {
    const url = new URL(`${getAppOrigin()}/api/mlb/search`);
    url.searchParams.set("names", playerName);
    return url;
  }
  return buildMlbStatsApiUrl("/v1/people/search", { names: playerName });
}

export function buildMlbStatsApiUrl(pathWithLeadingSlash = "", searchParams = {}) {
  const normalizedPath = String(pathWithLeadingSlash || "").startsWith("/")
    ? String(pathWithLeadingSlash)
    : `/${pathWithLeadingSlash || ""}`;

  const useProxy = canUseMlbStatsProxy();
  const base = useProxy ? `${getAppOrigin()}/api/mlb` : MLB_STATS_DIRECT_ORIGIN;
  const url = new URL(`${base}${normalizedPath}`);

  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url;
}

function canUseMlbStatsProxy() {
  try {
    return typeof window !== "undefined" && Boolean(window.location?.origin);
  } catch {
    return false;
  }
}

function getAppOrigin() {
  try {
    return window.location.origin;
  } catch {
    return "http://localhost:5173";
  }
}

export function buildMlbStatsSearchTestUrl(playerName = "Shohei Ohtani") {
  return buildMlbStatsSearchUrl(playerName);
}

export function mlbStatsApiPathLabel(url) {
  try {
    const parsed = url instanceof URL ? url : new URL(String(url));
    if (parsed.pathname.startsWith("/api/mlb")) {
      return `/api/mlb${parsed.pathname.replace(/^\/api\/mlb/, "")}${parsed.search}`;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return String(url);
  }
}

/** Standard console log for every MLB Stats API request/response. */
export function logMlbStatsApiCall({
  stage = "response",
  url = "",
  endpoint = "",
  status = null,
  preview = "",
  responseBody = "",
  durationMs = null,
  timeoutMs = null,
  playersReturned = null,
  matchedPlayer = null,
  playerId = null,
  projection = null,
  error = "",
} = {}) {
  const label = endpoint || mlbStatsApiPathLabel(url);
  const body = responseBody || preview;
  console.info("[MLB Stats API]", {
    stage,
    endpoint: label,
    url: label,
    status,
    responseCode: status,
    durationMs: durationMs ?? undefined,
    timeoutMs: timeoutMs ?? undefined,
    responseBody: body ? String(body).slice(0, 500) : "",
    bodyPreview: body ? String(body).slice(0, 300) : "",
    playersReturned,
    matchedPlayer,
    playerId,
    projection,
    error: error || undefined,
  });
}
