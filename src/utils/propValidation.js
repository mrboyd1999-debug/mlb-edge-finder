import { normalizePlayerName } from "./playerNames.js";
import { isParserMergeComboBug } from "./comboMarkets.js";
import { isOverseasOrPlaceholderProp, OVERSEAS_BLOCKED_PATTERN, getIngestionPropRejectReason } from "./ingestionFilter.js";

export const VERIFIED_SPORTSBOOK_PLATFORMS = new Set(["PrizePicks", "Underdog"]);
export const VERIFIED_LINE_BADGES = new Set(["LIVE", "CACHED"]);
export const NO_VERIFIED_PROPS_MESSAGE = "No verified sportsbook props available";

const PLACEHOLDER_NAME_PATTERNS = [
  /^unknown\s+player$/i,
  /^manual\s+player$/i,
  /^demo\b/i,
  /^test\b/i,
  /^sample\b/i,
  /^placeholder\b/i,
  /^fake\b/i,
  /^generated\b/i,
  /^player\s+\d+$/i,
  /^athlete\s+\d+$/i,
  /^prop\s+\d+$/i,
  /^tbd\b/i,
  /^n\/a$/i,
  /^undefined$/i,
  /^null$/i,
];

function normalizePlatform(value = "") {
  return String(value || "").trim();
}

function normalizeBadge(value = "") {
  return String(value || "").toUpperCase().trim();
}

export function isMalformedPlayerName(name = "") {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (trimmed.length > 48) return true;
  if (!/[a-zA-Z]/.test(trimmed)) return true;
  if (PLACEHOLDER_NAME_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (OVERSEAS_BLOCKED_PATTERN.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && tokens[0].length <= 2) return true;
  return false;
}

export { isOverseasOrPlaceholderProp } from "./ingestionFilter.js";

export function hasRequiredSportsbookMetadata(prop = {}) {
  const platform = normalizePlatform(prop.platform);
  if (!VERIFIED_SPORTSBOOK_PLATFORMS.has(platform)) return false;

  const badge = normalizeBadge(prop.lineSourceBadge || prop.feedLineBadge);
  if (!VERIFIED_LINE_BADGES.has(badge)) return false;

  const line = Number(prop.line);
  const start = new Date(prop.startTime).getTime();
  const sourceId = String(prop.sourceId || prop.id || "").trim();

  return (
    !isMalformedPlayerName(prop.playerName) &&
    Boolean(prop.statType) &&
    Number.isFinite(line) &&
    line > 0 &&
    Number.isFinite(start) &&
    Boolean(sourceId) &&
    prop.sportsbookVerified === true
  );
}

/** True only for props parsed directly from PrizePicks / Underdog live or cached feeds. */
export function isVerifiedSportsbookProp(prop) {
  if (!prop) return false;
  if (prop.isDemoData || prop.manualEntry || prop.categoryFallback) return false;
  if (prop.fallbackProfile || prop.isFallback) return false;
  if (normalizeBadge(prop.lineSourceBadge) === "FALLBACK") return false;
  if (prop.projectionSource === "fallback-player-stats") return false;
  if (isOverseasOrPlaceholderProp(prop)) return false;
  return hasRequiredSportsbookMetadata(prop);
}

/** @deprecated use isVerifiedSportsbookProp */
export function isRealLiveProp(prop) {
  return isVerifiedSportsbookProp(prop);
}

export function propDedupeKey(prop = {}) {
  const stat = String(prop.statType || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return [
    normalizePlatform(prop.platform),
    prop.sport || "",
    normalizePlayerName(prop.playerName),
    stat,
    Number(prop.line),
    String(prop.bestPick || prop.side || "").toLowerCase(),
    new Date(prop.startTime).toISOString().slice(0, 16),
  ].join("|");
}

export function dedupeVerifiedProps(props = []) {
  const seen = new Map();
  props.forEach((prop) => {
    if (!isVerifiedSportsbookProp(prop)) return;
    const key = propDedupeKey(prop);
    const existing = seen.get(key);
    if (!existing || Number(prop.confidenceScore || 0) > Number(existing.confidenceScore || 0)) {
      seen.set(key, prop);
    }
  });
  return Array.from(seen.values());
}

export function validatePropRejectReason(prop = {}) {
  if (!prop) return "missing prop";
  if (prop.isDemoData || prop.manualEntry) return "non-sportsbook/manual prop";
  if (prop.fallbackProfile || prop.isFallback) return "fallback profile";
  if (normalizeBadge(prop.lineSourceBadge) === "FALLBACK") return "fallback line badge";
  if (!VERIFIED_SPORTSBOOK_PLATFORMS.has(normalizePlatform(prop.platform))) return "unsupported platform";
  if (!VERIFIED_LINE_BADGES.has(normalizeBadge(prop.lineSourceBadge))) return "missing verified line badge";
  if (prop.sportsbookVerified !== true) return "missing sportsbook verification";
  if (isMalformedPlayerName(prop.playerName)) return "malformed player name";
  if (isParserMergeComboBug(prop)) return "merged multi-player name (parser bug)";
  if (isOverseasOrPlaceholderProp(prop)) return getIngestionPropRejectReason(prop) || "overseas/placeholder player";
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "invalid line";
  if (!prop.statType) return "missing stat type";
  if (!String(prop.sourceId || prop.id || "").trim()) return "missing source id";
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start)) return "missing start time";
  return "";
}

export function validateProp(prop = {}, rejectReasonFn) {
  const validator =
    typeof rejectReasonFn === "function"
      ? rejectReasonFn
      : typeof validatePropRejectReason === "function"
        ? validatePropRejectReason
        : null;
  if (!validator) return { valid: true, reason: "" };
  const reason = validator(prop);
  return { valid: !reason, reason: reason || "" };
}

export function validateAndFilterProps(props = [], onReject) {
  const accepted = [];
  props.forEach((prop) => {
    const validation = validateProp(prop);
    if (!validation.valid) {
      onReject?.(validation.reason, prop, validation);
      return;
    }
    accepted.push(prop);
  });
  return dedupeVerifiedProps(accepted);
}

export function filterVerifiedSportsbookProps(props = []) {
  return props.filter(isVerifiedSportsbookProp);
}

export function attachSportsbookVerifiedFields(prop = {}, platform = prop.platform) {
  const badge = normalizeBadge(prop.lineSourceBadge || "LIVE");
  return {
    ...prop,
    platform: normalizePlatform(platform || prop.platform),
    lineSourceBadge: VERIFIED_LINE_BADGES.has(badge) ? badge : "LIVE",
    sportsbookVerified: VERIFIED_SPORTSBOOK_PLATFORMS.has(normalizePlatform(platform || prop.platform)),
    feedSource: normalizePlatform(platform || prop.platform),
    verifiedBadge: VERIFIED_SPORTSBOOK_PLATFORMS.has(normalizePlatform(platform || prop.platform)) ? "VERIFIED" : null,
  };
}
