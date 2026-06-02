import axios from "axios";
import {
  EMPTY_PRIZEPICKS_PAYLOAD,
  logPrizePicksRawSample,
  normalizePrizePicksResponse,
  parsePrizePicksProjections,
} from "../../src/utils/prizepicksParse.js";

export const PRIZEPICKS_PROJECTION_BASES = [
  "https://partner-api.prizepicks.com/projections",
  "https://api.prizepicks.com/projections",
];

export const PRIZEPICKS_FETCH_TIMEOUT_MS = 10_000;

export const PRIZEPICKS_MLB_LEAGUE_ID = "2";

export function prizePicksRequestHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    origin: "https://app.prizepicks.com",
    referer: "https://app.prizepicks.com/",
  };
}

export function buildPrizePicksProjectionUrls({ leagueId = "", perPage = 250 } = {}) {
  return PRIZEPICKS_PROJECTION_BASES.map((base) => {
    const url = new URL(base);
    if (leagueId) url.searchParams.set("league_id", String(leagueId));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("single_stat", "true");
    url.searchParams.set("game_mode", "pickem");
    return url.toString();
  });
}

export async function fetchPrizePicks({ leagueId = "", timeoutMs = PRIZEPICKS_FETCH_TIMEOUT_MS } = {}) {
  const urls = buildPrizePicksProjectionUrls({ leagueId });
  let lastError = null;

  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        timeout: timeoutMs,
        headers: prizePicksRequestHeaders(),
        validateStatus: () => true,
        responseType: "json",
        transformResponse: [(body, headers) => body],
      });

      if (typeof res.data === "string") {
        try {
          res.data = JSON.parse(res.data);
        } catch (parseError) {
          lastError = parseError;
          continue;
        }
      }

      logPrizePicksRawSample(res.data);

      if (res.status >= 200 && res.status < 300 && res.data && typeof res.data === "object") {
        const normalized = normalizePrizePicksResponse(res.data);
        const parsedCount = parsePrizePicksProjections(normalized).length;
        console.info("[PrizePicks fetch]", {
          url,
          status: res.status,
          projections: normalized.data?.length || 0,
          included: normalized.included?.length || 0,
          parsedValid: parsedCount,
        });
        return normalized;
      }

      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      console.error("PrizePicks fetch failed:", err?.message || String(err));
    }
  }

  console.error("PrizePicks fetch failed:", lastError?.message || "all endpoints failed");
  return { ...EMPTY_PRIZEPICKS_PAYLOAD };
}
