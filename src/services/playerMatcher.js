import { cachedFetch } from "./fetchUtil.js";
import { readSmartCacheIfFresh, writeSmartCache, CACHE_TTL } from "./smartCache.js";
import { normalizePlayerName, playerNameTokens, playerNamesMatch } from "../utils/playerNames.js";
import { logMatchedPlayer, logNormalizedName } from "./mlbPipelineDebug.js";
import { buildMlbStatsApiUrl, logMlbStatsApiCall, mlbStatsApiPathLabel } from "./mlbStatsApiUrl.js";

function logMatcher(stage, payload = {}) {
  if (typeof console !== "undefined") console.info(`[MLB Data] ${stage}`, payload);
}

/** Prevent re-resolving the same sportsbook name to different MLB players in one session. */
const matchRegistry = new Map();

const ABBREVIATION_EXPANSIONS = {
  aj: "a j",
  jd: "j d",
  dj: "d j",
  cj: "c j",
  jj: "j j",
  tj: "t j",
  mj: "m j",
  rj: "r j",
  bj: "b j",
  kj: "k j",
};

export function normalizeSportsbookName(name = "") {
  let text = String(name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(vs\.?|@|at)\b.*$/i, " ")
    .trim();
  return normalizePlayerName(text);
}

export function resolveAbbreviations(name = "") {
  const normalized = normalizeSportsbookName(name);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2) return normalized;

  const first = tokens[0];
  const expanded = ABBREVIATION_EXPANSIONS[first];
  if (expanded) {
    return `${expanded} ${tokens.slice(1).join(" ")}`.trim();
  }
  return normalized;
}

function tokenOverlapScore(leftTokens = [], rightTokens = []) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const shared = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const lastLeft = leftTokens[leftTokens.length - 1];
  const lastRight = rightTokens[rightTokens.length - 1];
  let score = shared / Math.max(leftTokens.length, rightTokens.length);
  if (lastLeft === lastRight) score += 0.35;
  if (leftTokens[0] === rightTokens[0]) score += 0.2;
  if (playerNamesMatch(leftTokens.join(" "), rightTokens.join(" "))) score += 0.4;
  return Math.min(1, score);
}

export function scoreMlbPlayerMatch(sportsbookName = "", candidate = {}) {
  const query = resolveAbbreviations(sportsbookName);
  const fullName = candidate.fullName || `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim();
  const normalizedQuery = normalizePlayerName(query);
  const normalizedCandidate = normalizePlayerName(fullName);

  if (!normalizedQuery || !normalizedCandidate) {
    return { confidence: 0, reason: "empty name" };
  }
  if (normalizedQuery === normalizedCandidate) {
    return { confidence: 100, reason: "exact match" };
  }
  if (playerNamesMatch(query, fullName)) {
    return { confidence: 92, reason: "strict token match" };
  }

  const queryTokens = playerNameTokens(query);
  const candidateTokens = playerNameTokens(fullName);
  const overlap = tokenOverlapScore(queryTokens, candidateTokens);
  if (overlap >= 0.85) return { confidence: 88, reason: "high token overlap" };
  if (overlap >= 0.65) return { confidence: 74, reason: "partial token overlap" };
  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
    return { confidence: 68, reason: "substring match" };
  }
  if (overlap >= 0.45) return { confidence: 55, reason: "weak overlap" };
  return { confidence: Math.round(overlap * 40), reason: "low overlap" };
}

export function pickBestMlbMatch(sportsbookName = "", people = []) {
  if (!people.length) return null;

  const normalizedQuery = normalizeSportsbookName(sportsbookName);
  const exact = people
    .map((person) => {
      const fullName = person.fullName || `${person.firstName || ""} ${person.lastName || ""}`.trim();
      return { person, fullName };
    })
    .find(({ fullName }) => normalizePlayerName(fullName) === normalizedQuery);

  if (exact) {
    return {
      person: exact.person,
      fullName: exact.fullName,
      confidence: 100,
      reason: "exact normalized match",
    };
  }

  const scored = people
    .map((person) => {
      const fullName = person.fullName || `${person.firstName || ""} ${person.lastName || ""}`.trim();
      const { confidence, reason } = scoreMlbPlayerMatch(sportsbookName, person);
      return { person, fullName, confidence, reason };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.confidence < 55) return null;

  if (runnerUp && best.confidence - runnerUp.confidence < 8 && runnerUp.confidence >= 55) {
    logMatcher("match.ambiguous", {
      incoming: sportsbookName,
      top: best.fullName,
      topConfidence: best.confidence,
      runnerUp: runnerUp.fullName,
      runnerUpConfidence: runnerUp.confidence,
    });
    return null;
  }

  return best;
}

export function logPlayerMatch({ incomingName, matchedName, confidence, reason, mlbId = null }) {
  logMatcher("match.result", {
    incoming: incomingName,
    matched: matchedName,
    confidence,
    reason,
    mlbId,
  });
}

export async function searchMlbPlayers(query = "") {
  const text = String(query || "").trim();
  if (!text) return [];

  const cacheKey = normalizePlayerName(text);
  const cached = readSmartCacheIfFresh("mlb-player-search-list", cacheKey, CACHE_TTL.STATS_MS);
  if (cached?.payload?.people) {
    console.info("[Manual Prop Matcher] cache hit", { query: text, count: cached.payload.people.length });
    return cached.payload.people;
  }

  const searchUrl = buildMlbStatsApiUrl("/v1/people/search", { names: text });
  const urlLabel = mlbStatsApiPathLabel(searchUrl);
  logMlbStatsApiCall({ stage: "request", url: searchUrl, status: null });
  console.info("[Manual Prop Matcher] API URL:", urlLabel);

  let response;
  let preview = "";
  try {
    response = await cachedFetch(searchUrl, {}, { source: "MLB Stats", ttlMs: CACHE_TTL.STATS_MS });
    preview = (await response.clone().text()).slice(0, 300);
  } catch (error) {
    logMlbStatsApiCall({
      stage: "error",
      url: searchUrl,
      status: null,
      error: error?.message || String(error),
    });
    console.warn("[Manual Prop Matcher] fetch error", {
      url: urlLabel,
      message: error?.message || String(error),
    });
    throw error;
  }

  logMlbStatsApiCall({
    stage: "response",
    url: searchUrl,
    status: response.status,
    preview,
  });
  console.info("[Manual Prop Matcher] response status:", response.status);
  if (!response.ok) {
    console.warn("[Manual Prop Matcher] failed response body:", preview.slice(0, 500));
    throw new Error(`MLB player search failed (${response.status})`);
  }

  const payload = await response.json();
  const people = payload.people || [];
  logMlbStatsApiCall({
    stage: "parsed",
    url: searchUrl,
    status: response.status,
    preview,
    playersReturned: people.length,
    matchedPlayer: people[0]?.fullName || null,
    playerId: people[0]?.id || null,
  });
  writeSmartCache("mlb-player-search-list", cacheKey, { people }, { source: "mlb-stats-api" });
  return people;
}

/**
 * Resolve a PrizePicks/Underdog player name to a verified MLB StatsAPI player.
 */
export async function matchSportsbookPlayerToMlb(sportsbookName = "", { minConfidence = 55, team = "" } = {}) {
  const incoming = String(sportsbookName || "").trim();
  const normalizedName = normalizeSportsbookName(incoming);
  logNormalizedName(incoming, normalizedName);
  console.info("[Manual Prop Matcher] normalized player name:", normalizedName);

  if (!incoming) {
    logMatchedPlayer(null, 0, "empty incoming name");
    logPlayerMatch({ incomingName: incoming, matchedName: null, confidence: 0, reason: "empty incoming name" });
    console.info("[Manual Prop Matcher] matched player result:", null);
    return { player: null, confidence: 0, reason: "empty incoming name" };
  }

  const registryKey = normalizeSportsbookName(incoming);
  if (matchRegistry.has(registryKey)) {
    const cached = matchRegistry.get(registryKey);
    logPlayerMatch({
      incomingName: incoming,
      matchedName: cached.player?.fullName || null,
      confidence: cached.confidence,
      reason: "registry cache",
      mlbId: cached.player?.id,
    });
    return cached;
  }

  const queries = [...new Set([incoming, resolveAbbreviations(incoming)].filter(Boolean))];
  let best = null;
  let lastCandidatesCount = 0;

  for (const query of queries) {
    const people = await searchMlbPlayers(query);
    lastCandidatesCount = Math.max(lastCandidatesCount, people.length);
    console.info("[Manual Prop Matcher] players returned:", people.length, { query });
    const candidate = pickBestMlbMatch(incoming, people);
    if (candidate && (!best || candidate.confidence > best.confidence)) {
      best = candidate;
    }
    if (best?.confidence >= 92) break;
  }

  if (!best || best.confidence < minConfidence) {
    const result = {
      player: null,
      confidence: best?.confidence || 0,
      reason: best?.reason || "no confident MLB match",
      candidatesCount: lastCandidatesCount,
    };
    logMatchedPlayer(null, result.confidence, result.reason);
    logPlayerMatch({ incomingName: incoming, matchedName: null, confidence: result.confidence, reason: result.reason });
    console.info("[Manual Prop Matcher] matched player result:", {
      matchedPlayer: null,
      playerId: null,
      confidence: result.confidence,
      reason: result.reason,
    });
    return result;
  }

  const result = {
    player: {
      id: best.person.id,
      fullName: best.fullName,
      primaryPosition: best.person.primaryPosition?.abbreviation || best.person.primaryPosition?.name || "",
      currentTeam: best.person.currentTeam?.name || best.person.team?.name || "",
    },
    confidence: best.confidence,
    reason: best.reason,
    candidatesCount: lastCandidatesCount,
    apiStatusCode: 200,
  };

  matchRegistry.set(registryKey, result);
  logMatchedPlayer(result.player.fullName, result.confidence, result.reason);
  logPlayerMatch({
    incomingName: incoming,
    matchedName: result.player.fullName,
    confidence: result.confidence,
    reason: result.reason,
    mlbId: result.player.id,
  });
  logMlbStatsApiCall({
    stage: "matched",
    url: buildMlbStatsApiUrl("/v1/people/search", { names: incoming }),
    status: 200,
    matchedPlayer: result.player.fullName,
    playerId: result.player.id,
    playersReturned: lastCandidatesCount,
  });
  console.info("[Manual Prop Matcher] matched player result:", {
    matchedPlayer: result.player.fullName,
    playerId: result.player.id,
    confidence: result.confidence,
    reason: result.reason,
  });
  return result;
}
