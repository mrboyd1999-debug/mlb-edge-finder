/** Normalize DFS player names for cross-source stat matching. */
export function normalizePlayerName(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[''.`-]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function playerNameTokens(name = "") {
  const parts = normalizePlayerName(name).split(" ").filter(Boolean);
  return parts.filter((token, index, arr) => token.length > 1 || (token.length === 1 && index < arr.length - 1));
}

/**
 * Strict cross-source player match — avoids merging unrelated athletes who share a last name.
 */
export function playerNamesMatch(a, b) {
  const left = normalizePlayerName(a);
  const right = normalizePlayerName(b);
  if (!left || !right) return false;
  if (left === right) return true;

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

  return false;
}

export function statProfileKey(prop) {
  const stat = String(prop?.statType || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return [prop?.sport || "", normalizePlayerName(prop?.playerName), stat].filter(Boolean).join("|");
}

/**
 * Resolve a stat profile from a Map keyed by statProfileKey or legacy keys.
 */
export function findStatProfile(statsMap, prop) {
  if (!(statsMap instanceof Map) || !prop) return null;

  const primary = statProfileKey(prop);
  const direct = statsMap.get(primary);
  if (direct && !direct.fallback && !direct.sparse) return direct;

  let best = null;
  let bestScore = 0;
  const propSport = String(prop.sport || "").toLowerCase();
  const propStat = String(prop.statType || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  statsMap.forEach((profile) => {
    if (!profile || profile.fallback || profile.sparse) return;
    const profileSport = String(profile.sport || "").toLowerCase();
    if (propSport && profileSport && profileSport !== propSport) return;
    if (!playerNamesMatch(prop.playerName, profile.playerName)) return;

    const profileStat = String(profile.statType || profile.market || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const statMatch =
      !propStat ||
      !profileStat ||
      profileStat === propStat ||
      (profileStat.includes(propStat) && propStat.length >= 4) ||
      (propStat.includes(profileStat) && profileStat.length >= 4);
    if (!statMatch) return;

    const score =
      playerNameTokens(prop.playerName).length +
      (normalizePlayerName(prop.playerName) === normalizePlayerName(profile.playerName) ? 4 : 0) +
      (profile.projectionSource === "player-stats" ? 2 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = profile;
    }
  });

  return best || (direct && !direct.fallback ? direct : null);
}
