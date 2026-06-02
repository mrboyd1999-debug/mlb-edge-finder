import { canonicalMarketKey } from "./marketNormalization.js";

/** Legitimate single-player combo stat markets offered by sportsbooks (PRA, HRR, etc.). */
const LEGITIMATE_COMBO_STAT_KEYS = new Set([
  "pointsreboundsassists",
  "pra",
  "pointsrebounds",
  "pr",
  "pointsassists",
  "pa",
  "reboundsassists",
  "rebsasts",
  "ra",
  "ptsasts",
  "ptsrebsasts",
  "hitsrunsrbis",
  "hrr",
  "hitsrunsandrbis",
  "passingrushingyards",
  "rushingreceivingyards",
  "passrushrec",
  "fantasyscore",
]);

export const COMBO_MARKET_TYPE = "combo";
export const SINGLE_MARKET_TYPE = "single";

const MULTI_PLAYER_NAME_PART =
  /^[A-Za-z][A-Za-z.'-]*(?:\s+(?:[A-Za-z]\.)?\s*[A-Za-z][A-Za-z.'-]*)+$/;

function normalizeStatKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "");
}

function normalizeMarketToken(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function collectRawValues(raw = {}, keys = []) {
  const values = [];
  keys.forEach((key) => {
    const parts = key.split(".");
    let current = raw;
    for (const part of parts) {
      current = current?.[part];
      if (current == null) break;
    }
    if (current == null) return;
    if (Array.isArray(current)) values.push(...current);
    else values.push(current);
  });
  return values;
}

export function isLegitimateComboStat(statType = "") {
  const key = normalizeStatKey(statType);
  const canonical = canonicalMarketKey(statType);
  if (LEGITIMATE_COMBO_STAT_KEYS.has(key) || LEGITIMATE_COMBO_STAT_KEYS.has(canonical)) return true;
  if (["pr", "pa", "ra", "pra", "hrr"].includes(canonical)) return true;
  if (!key.includes("+")) return false;
  if (/\b(vs|versus|h2h|headtohead)\b/i.test(String(statType))) return false;
  return /^(points|rebounds|assists|hits|runs|rbis|strikeouts|bases|yards|receptions|passing|rushing|receiving)/.test(
    key
  );
}

/** Detect parser merge bugs like "Aaron Judge + Mike Trout", not PRA combo stats. */
export function isMergedMultiPlayerName(playerName = "") {
  const text = String(playerName || "").trim();
  if (!text) return false;
  const separator = text.includes(" + ") ? " + " : text.includes(" & ") ? " & " : null;
  if (!separator) return false;
  const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => MULTI_PLAYER_NAME_PART.test(part));
}

/** Split malformed merged player strings into individual names. */
export function splitMergedPlayerNames(playerName = "") {
  const text = String(playerName || "").trim();
  if (!text || !isMergedMultiPlayerName(text)) return text ? [text] : [];
  const separator = text.includes(" + ") ? " + " : " & ";
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True when the sportsbook explicitly marks a multi-player combo market. */
export function isExplicitComboMarket(raw = {}, prop = {}) {
  if (prop.marketType === COMBO_MARKET_TYPE || prop.isExplicitCombo) return true;

  const typedValues = collectRawValues(raw, [
    "marketType",
    "market_type",
    "pick_type",
    "pickType",
    "type",
    "market_kind",
    "marketKind",
    "attributes.market_type",
    "attributes.pick_type",
    "attributes.type",
    "attributes.marketType",
    "over_under.market_type",
    "over_under.pick_type",
    "over_under.type",
    "overUnder.market_type",
    "overUnder.pick_type",
    "overUnder.type",
  ]).map(normalizeMarketToken);

  if (typedValues.some((value) => /combo|multileg|multiplayer|multiplayer|samegame|correlated|combinedpick/.test(value))) {
    return true;
  }

  const idGroups = collectRawValues(raw, [
    "player_ids",
    "playerIds",
    "appearance_ids",
    "appearanceIds",
    "appearances",
    "legs",
    "selections",
    "over_under.player_ids",
    "over_under.appearance_ids",
    "attributes.player_ids",
    "attributes.appearance_ids",
  ]).filter(Boolean);

  const multiIdGroup = idGroups.find((value) => Array.isArray(value) && value.length > 1);
  if (multiIdGroup) return true;

  const titleBlob = [
    raw.title,
    raw.name,
    raw.display_name,
    raw.description,
    raw.over_under?.title,
    raw.overUnder?.title,
    raw.attributes?.description,
    raw.attributes?.display_name,
    prop.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(combo|combined|multi[-\s]?player|same[-\s]?game parlay|sgp)\b/.test(titleBlob)) {
    return true;
  }

  return false;
}

/**
 * Resolve a parsed player name to a single athlete unless the sportsbook marks a combo market.
 * Prefers trusted single-player sources over description/title fallbacks that produced merges.
 */
export function resolveParsedPlayerName({
  playerName = "",
  statType = "",
  raw = {},
  explicitSources = [],
} = {}) {
  const trimmed = String(playerName || "").trim();
  const explicitCombo = isExplicitComboMarket(raw, { statType, playerName: trimmed, marketType: raw.marketType });

  if (!trimmed) {
    return { valid: false, reason: "missing player name" };
  }

  if (!isMergedMultiPlayerName(trimmed)) {
    return {
      valid: true,
      playerName: trimmed,
      marketType: explicitCombo ? COMBO_MARKET_TYPE : SINGLE_MARKET_TYPE,
      isExplicitCombo: explicitCombo,
    };
  }

  if (explicitCombo) {
    return {
      valid: true,
      playerName: trimmed,
      marketType: COMBO_MARKET_TYPE,
      isExplicitCombo: true,
    };
  }

  const trustedSources = explicitSources
    .map((source) => String(source || "").trim())
    .filter((source) => source && !isMergedMultiPlayerName(source));

  for (const candidate of trustedSources) {
    return {
      valid: true,
      playerName: candidate,
      marketType: SINGLE_MARKET_TYPE,
      recoveredFromMerged: true,
    };
  }

  return {
    valid: false,
    reason: "merged multi-player name (parser bug)",
    splitPlayerNames: splitMergedPlayerNames(trimmed),
  };
}

/** Apply player-name resolution during sportsbook parsing. Returns null when prop should be rejected. */
export function applyParsedPlayerResolution(prop = {}, { raw = {}, explicitSources = [] } = {}) {
  const resolution = resolveParsedPlayerName({
    playerName: prop.playerName,
    statType: prop.statType,
    raw,
    explicitSources,
  });

  if (!resolution.valid) return null;

  const resolvedProp = {
    ...prop,
    playerName: resolution.playerName,
    marketType: resolution.marketType,
    isExplicitCombo: Boolean(resolution.isExplicitCombo),
    recoveredFromMerged: Boolean(resolution.recoveredFromMerged),
  };

  const validation = validateParsedPropBeforeRender(resolvedProp);
  if (!validation.valid) return null;

  return resolvedProp;
}

/** Parser validation gate — run before props are rendered or scored. */
export function validateParsedPropBeforeRender(prop = {}) {
  if (!prop?.playerName) return { valid: false, reason: "missing player name" };
  if (isParserMergeComboBug(prop)) {
    return { valid: false, reason: "merged multi-player name (parser bug)" };
  }
  return { valid: true, reason: "" };
}

export function isParserMergeComboBug(prop = {}) {
  if (prop.marketType === COMBO_MARKET_TYPE || prop.isExplicitCombo) return false;
  if (!isMergedMultiPlayerName(prop.playerName)) return false;
  return !isLegitimateComboStat(prop.statType);
}

/** @deprecated prefer isParserMergeComboBug — blocks merge bugs only, not legit combo stats. */
export function isMultiPlayerComboProp(prop = {}) {
  return isParserMergeComboBug(prop);
}
