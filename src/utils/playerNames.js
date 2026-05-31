import { canonicalMarketKey } from "./marketNormalization.js";
import { marketsMatchForHistoricalAttach } from "./mlbHistoricalStatMapping.js";
import { resolvePropSport } from "./mlbOnlyMode.js";

/** Common MLB broadcast / DFS aliases → canonical normalized name fragment. */
const MLB_PLAYER_ALIASES = new Map([
  ["tatis", "fernando tatis"],
  ["fernando tatis jr", "fernando tatis"],
  ["fernando tatis", "fernando tatis"],
  ["juan soto", "juan soto"],
  ["ronald acuna", "ronald acuna"],
  ["ronald acuna jr", "ronald acuna"],
  ["ronald acuna", "ronald acuna"],
  ["mookie betts", "mookie betts"],
  ["shohei ohtani", "shohei ohtani"],
  ["aaron judge", "aaron judge"],
  ["vladimir guerrero", "vladimir guerrero"],
  ["vladimir guerrero jr", "vladimir guerrero"],
  ["bo bichette", "bo bichette"],
  ["fernando tatis jr", "fernando tatis"],
]);

function stripDiacritics(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Normalize DFS player names for cross-source stat matching. */
export function normalizePlayerName(name = "") {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|junior|senior)\b\.?/gi, " ")
    .replace(/\b([a-z])\./gi, "$1")
    .replace(/[''.`-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePropPlayerName(prop = {}) {
  return String(
    prop?.playerName || prop?.player || prop?.athleteName || prop?.name || ""
  ).trim();
}

/** Drop middle initials / particles — "jonathan a aranda" → "jonathan aranda". */
export function collapseMiddleInitials(normalizedName = "") {
  const tokens = String(normalizedName || "")
    .split(" ")
    .filter(Boolean);
  if (tokens.length <= 2) return tokens.join(" ");
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const core = tokens.filter((token, index) => {
    if (index === 0 || index === tokens.length - 1) return true;
    return token.length > 1;
  });
  if (core.length >= 2) return core.join(" ");
  return `${first} ${last}`.trim();
}

export function buildPlayerMatchKeys(name = "") {
  const normalized = normalizePlayerName(name);
  if (!normalized) return [];

  const keys = new Set([normalized, collapseMiddleInitials(normalized)]);
  const tokens = normalized.split(" ").filter(Boolean);

  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    keys.add(`${first} ${last}`);
    keys.add(last);
    if (first.length === 1) keys.add(`${first} ${last}`);
    if (first.length > 1) keys.add(`${first[0]} ${last}`);
    if (first.length > 1) keys.add(`${first[0]}.${last}`);
  }

  const alias = MLB_PLAYER_ALIASES.get(normalized);
  if (alias) keys.add(alias);

  return [...keys].filter(Boolean);
}

export function playerNameTokens(name = "") {
  const parts = normalizePlayerName(name).split(" ").filter(Boolean);
  return parts.filter((token, index, arr) => token.length > 1 || (token.length === 1 && index < arr.length - 1));
}

/**
 * Strict cross-source player match — avoids merging unrelated athletes who share a last name.
 */
export function playerNamesMatch(a, b) {
  const leftKeys = buildPlayerMatchKeys(a);
  const rightKeys = buildPlayerMatchKeys(b);
  if (!leftKeys.length || !rightKeys.length) return false;

  for (const left of leftKeys) {
    for (const right of rightKeys) {
      if (left === right) return true;
    }
  }

  const left = normalizePlayerName(a);
  const right = normalizePlayerName(b);
  if (!left || !right) return false;

  const leftTokens = playerNameTokens(left);
  const rightTokens = playerNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;

  if (leftTokens.length === 1 || rightTokens.length === 1) {
    return leftTokens.length === 1 && rightTokens.length === 1 && leftTokens[0] === rightTokens[0];
  }

  const lastLeft = leftTokens[leftTokens.length - 1];
  const lastRight = rightTokens[rightTokens.length - 1];
  if (lastLeft !== lastRight) return false;

  const firstLeft = leftTokens[0];
  const firstRight = rightTokens[0];
  if (firstLeft === firstRight) {
    const shared = leftTokens.filter((token) => rightTokens.includes(token)).length;
    const minLen = Math.min(leftTokens.length, rightTokens.length);
    const maxLen = Math.max(leftTokens.length, rightTokens.length);
    if (maxLen - minLen > 1) return false;
    return shared >= minLen;
  }

  if (firstLeft.length === 1 && firstRight.length > 1 && firstRight.startsWith(firstLeft)) return true;
  if (firstRight.length === 1 && firstLeft.length > 1 && firstLeft.startsWith(firstRight)) return true;

  const collapsedLeft = collapseMiddleInitials(left);
  const collapsedRight = collapseMiddleInitials(right);
  if (collapsedLeft === collapsedRight) return true;

  return false;
}

export function statProfileKey(prop) {
  const stat = canonicalMarketKey(prop?.statType || prop?.market || prop?.propType || "");
  const player = normalizePlayerName(resolvePropPlayerName(prop));
  const sport = String(prop?.sport || resolvePropSport(prop) || "").toLowerCase();
  return [sport, player, stat].filter(Boolean).join("|");
}

export function playerProfileKey(prop = {}) {
  const player = normalizePlayerName(resolvePropPlayerName(prop));
  const sport = String(prop?.sport || resolvePropSport(prop) || "").toLowerCase();
  return [sport, player].filter(Boolean).join("|");
}

function propStatCanonical(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
}

function profileStatCanonical(profile = {}) {
  return canonicalMarketKey(profile.statType || profile.market || "");
}

function resolvePropPlayerId(prop = {}) {
  const id = prop?.playerId ?? prop?.sportsDataPlayerId ?? prop?.mlbPlayerId ?? null;
  if (id == null || id === "") return null;
  return String(id);
}

function profilePlayerId(profile = {}) {
  const id = profile?.playerId ?? profile?.sportsDataPlayerId ?? profile?.mlbPlayerId ?? null;
  if (id == null || id === "") return null;
  return String(id);
}

function isUsableProfile(profile = {}) {
  return Boolean(profile && !profile.fallback && !profile.sparse);
}

function isHistoricalAttachProfile(profile = {}) {
  if (!profile || profile.fallback) return false;
  if (isUsableProfile(profile)) return true;
  const hasAverages =
    Number.isFinite(Number(profile.last5Average)) ||
    Number.isFinite(Number(profile.last10Average)) ||
    Number.isFinite(Number(profile.seasonAverage));
  const hasSplits = Array.isArray(profile.splits) && profile.splits.length >= 3;
  return Boolean(hasAverages || hasSplits || profile.hasGameLogs);
}

function scoreProfileMatch(prop = {}, profile = {}, { exactStat = true } = {}) {
  const propStatKey = propStatCanonical(prop);
  const profileStatKey = profileStatCanonical(profile);
  if (exactStat && propStatKey && profileStatKey && !marketsMatchForHistoricalAttach(propStatKey, profileStatKey)) {
    return 0;
  }

  const propSport = String(prop.sport || resolvePropSport(prop) || "").toLowerCase();
  const profileSport = String(profile.sport || "").toLowerCase();
  if (propSport && profileSport && profileSport !== propSport) return 0;

  if (!playerNamesMatch(resolvePropPlayerName(prop), profile.playerName)) return 0;

  let score = playerNameTokens(resolvePropPlayerName(prop)).length;
  if (normalizePlayerName(resolvePropPlayerName(prop)) === normalizePlayerName(profile.playerName)) score += 4;
  if (resolvePropPlayerId(prop) && resolvePropPlayerId(prop) === profilePlayerId(profile)) score += 8;
  if (propStatKey && profileStatKey && propStatKey === profileStatKey) score += 6;
  if (profile.projectionSource === "player-stats") score += 2;
  if (profile.hasGameLogs || Number(profile.sampleSize) >= 3) score += 2;
  if (!exactStat) score -= 1;
  return score;
}

function findBestProfileMatch(statsMap, prop, { exactStat = true } = {}) {
  let best = null;
  let bestScore = 0;
  statsMap.forEach((profile) => {
    if (!profile || profile.fallback) return;
    if (exactStat && profile.sparse) return;
    const score = scoreProfileMatch(prop, profile, { exactStat });
    if (score > bestScore) {
      bestScore = score;
      best = profile;
    }
  });
  return bestScore > 0 ? best : null;
}

/**
 * Resolve a stat profile from a Map keyed by statProfileKey or legacy keys.
 */
export function findStatProfile(statsMap, prop) {
  if (!(statsMap instanceof Map) || !prop) return null;

  const propStatKey = propStatCanonical(prop);
  if (!propStatKey) return null;

  const playerName = resolvePropPlayerName(prop);
  if (!playerName) return null;

  const primary = statProfileKey({ ...prop, playerName, sport: prop.sport || resolvePropSport(prop) || "MLB" });
  const direct = statsMap.get(primary);
  if (direct && isHistoricalAttachProfile(direct) && marketsMatchForHistoricalAttach(direct.statType || propStatKey, prop.statType)) {
    return direct;
  }

  const playerId = resolvePropPlayerId(prop);
  if (playerId) {
    for (const profile of statsMap.values()) {
      if (!isHistoricalAttachProfile(profile)) continue;
      if (profilePlayerId(profile) !== playerId) continue;
      if (!marketsMatchForHistoricalAttach(profile.statType || profileStatCanonical(profile), prop.statType)) continue;
      return profile;
    }
  }

  for (const key of buildPlayerMatchKeys(playerName)) {
    const byPlayerStat = statsMap.get(
      [String(prop.sport || resolvePropSport(prop) || "mlb").toLowerCase(), key, propStatKey]
        .filter(Boolean)
        .join("|")
    );
    if (
      byPlayerStat &&
      isHistoricalAttachProfile(byPlayerStat) &&
      marketsMatchForHistoricalAttach(byPlayerStat.statType || propStatKey, prop.statType)
    ) {
      return byPlayerStat;
    }
  }

  return findBestProfileMatch(statsMap, { ...prop, playerName, sport: prop.sport || resolvePropSport(prop) || "MLB" }, {
    exactStat: true,
  });
}

/** Same-player profile fallback when exact market profile is missing (season / recent averages). */
export function findPlayerHistoricalProfile(statsMap, prop) {
  const exact = findStatProfile(statsMap, prop);
  if (exact) return exact;

  const playerName = resolvePropPlayerName(prop);
  let bestSplitProfile = null;
  let bestSplitCount = 0;
  for (const profile of statsMap.values()) {
    if (!profile || profile.fallback) continue;
    if (!playerNamesMatch(playerName, profile.playerName)) continue;
    const splitCount = Array.isArray(profile.splits)
      ? profile.splits.length
      : Number(profile.sampleSize) || 0;
    if (splitCount > bestSplitCount) {
      bestSplitCount = splitCount;
      bestSplitProfile = profile;
    }
  }
  if (bestSplitProfile?.splits?.length >= 3) return bestSplitProfile;

  const playerId = resolvePropPlayerId(prop);
  if (playerId) {
    let best = null;
    let bestScore = 0;
    for (const profile of statsMap.values()) {
      if (!profile || profile.fallback) continue;
      if (profilePlayerId(profile) !== playerId) continue;
      const score = scoreProfileMatch(prop, profile, { exactStat: false });
      if (score > bestScore) {
        bestScore = score;
        best = profile;
      }
    }
    if (best) return best;
  }

  return findBestProfileMatch(
    statsMap,
    { ...prop, playerName: resolvePropPlayerName(prop), sport: prop.sport || resolvePropSport(prop) || "MLB" },
    { exactStat: false }
  );
}
