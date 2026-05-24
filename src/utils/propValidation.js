import { normalizePlayerName } from "./playerNames.js";
import { isParserMergeComboBug } from "./comboMarkets.js";
import { isOverseasOrPlaceholderProp, OVERSEAS_BLOCKED_PATTERN, getIngestionPropRejectReason } from "./ingestionFilter.js";
import { isUsableParsedProp, normalizePropShape } from "./propShape.js";
import { lockSportFromStatType, sportStatMismatchReason } from "./propStatSportLock.js";
import { resolvePropSportLabel } from "./underdogSportDetection.js";
import { computeAbsoluteProjectionEdge } from "./projectionQuality.js";
import { recommendSideFromProjection } from "./propSanity.js";

export const VERIFIED_SPORTSBOOK_PLATFORMS = new Set(["PrizePicks", "Underdog"]);
export const VERIFIED_LINE_BADGES = new Set(["LIVE", "CACHED", "EMPTY"]);
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

function isSupportedSportsbookSource(prop = {}) {
  const platform = normalizePlatform(prop.platform);
  if (VERIFIED_SPORTSBOOK_PLATFORMS.has(platform)) return true;
  const source = String(prop.source || prop.feedSource || "").toLowerCase();
  return /prizepicks|underdog/.test(source);
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
  if (!isSupportedSportsbookSource(prop)) return false;
  const shaped = normalizePropShape(prop);
  const market = shaped.market || shaped.statType || shaped.propType;
  const sportOrLeague = shaped.sport || shaped.league;
  const line = Number(shaped.line);
  return (
    !isMalformedPlayerName(shaped.playerName) &&
    Boolean(market) &&
    Number.isFinite(line) &&
    line > 0 &&
    Boolean(sportOrLeague) &&
    Boolean(String(shaped.source || shaped.platform || "").trim())
  );
}

/** True for props with core sportsbook metadata — scoring fields are optional. */
export function isVerifiedSportsbookProp(prop) {
  if (!prop) return false;
  if (prop.isDemoData || prop.manualEntry || prop.categoryFallback) return false;
  if (prop.fallbackProfile || prop.isFallback) return false;
  if (normalizeBadge(prop.lineSourceBadge) === "FALLBACK") return false;
  if (prop.projectionSource === "fallback-player-stats") return false;
  if (isOverseasOrPlaceholderProp(prop)) return false;
  if (!isSupportedSportsbookSource(prop)) return false;
  return isUsableParsedProp(prop);
}

/** @deprecated use isVerifiedSportsbookProp */
export function isRealLiveProp(prop) {
  return isVerifiedSportsbookProp(prop);
}

export function propDedupeKey(prop = {}) {
  const stat = String(prop.statType || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const startKey = prop.startTime ? new Date(prop.startTime).toISOString().slice(0, 16) : "na";
  return [
    normalizePlatform(prop.platform),
    prop.sport || prop.league || "",
    normalizePlayerName(prop.playerName),
    stat,
    Number(prop.line),
    String(prop.bestPick || prop.side || "").toLowerCase(),
    startKey,
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

export function hasValidProjection(prop = {}) {
  const projection = Number(prop.projection ?? prop.projectedValue);
  return Number.isFinite(projection) && projection > 0;
}

function resolvePickSideKey(prop = {}) {
  const side = String(prop.side || prop.bestPick || prop.pick || prop.overUnder || "").toLowerCase();
  if (side.includes("under") || side.includes("less") || side.includes("lower")) return "under";
  if (side.includes("over") || side.includes("more") || side.includes("higher")) return "over";
  return "";
}

export function computeCuratedPropEdge(prop = {}) {
  const rec = recommendSideFromProjection(prop);
  if (rec.side === "PASS" || rec.edge <= 0) {
    return computeAbsoluteProjectionEdge(prop) || null;
  }
  return rec.edge;
}

/** Hard reject — only impossible/invalid props. Used for ranked pick candidates. */
export function validateRankableCandidateRejectReason(prop = {}) {
  if (!prop) return "Rejected: missing prop";
  if (prop.isDemoData || prop.manualEntry || prop.isFallback || prop.displayFallback) {
    return "Rejected: fallback/non-live prop";
  }
  if (isMalformedPlayerName(prop.playerName || prop.player)) {
    return "Rejected: player missing";
  }
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) {
    return "Rejected: line invalid";
  }
  const statType = prop.statType || prop.market || prop.propType || "";
  if (!statType) return "Rejected: missing stat type";

  const sport = resolvePropSportLabel(prop) || prop.inferredSport || prop.sport || prop.league || "";
  const statLock = lockSportFromStatType(statType);
  const effectiveSport = sport && sport !== "Unknown" && sport !== "Unsupported" ? sport : statLock || "";

  if (statLock && effectiveSport && statLock !== effectiveSport) {
    return "Rejected: invalid sport/stat combo";
  }
  if (effectiveSport) {
    const mismatch = sportStatMismatchReason(effectiveSport, statType);
    if (mismatch) return mismatch;
  }

  return "";
}

export function isRankableCandidateProp(prop = {}) {
  return !validateRankableCandidateRejectReason(prop);
}

/** @deprecated alias — curated boards use the same loose gate as rankable candidates */
export function validateCuratedPropRejectReason(prop = {}) {
  return validateRankableCandidateRejectReason(prop);
}

export function isCuratedDisplayProp(prop = {}) {
  return isRankableCandidateProp(prop);
}

export function validatePropRejectReason(prop = {}) {
  if (!prop) return "missing prop";
  if (prop.isDemoData || prop.manualEntry) return "non-sportsbook/manual prop";
  if (prop.fallbackProfile || prop.isFallback) return "fallback profile";
  if (normalizeBadge(prop.lineSourceBadge) === "FALLBACK") return "fallback line badge";
  if (!isSupportedSportsbookSource(prop)) return "unsupported platform";
  if (isMalformedPlayerName(prop.playerName)) return "malformed player name";
  if (isParserMergeComboBug(prop)) return "merged multi-player name (parser bug)";
  if (isOverseasOrPlaceholderProp(prop)) return getIngestionPropRejectReason(prop) || "overseas/placeholder player";
  const shaped = normalizePropShape(prop);
  const line = Number(shaped.line);
  if (!Number.isFinite(line) || line <= 0) return "invalid line";
  if (!(shaped.market || shaped.statType)) return "missing market/stat";
  if (!(shaped.sport || shaped.league)) return "missing sport/league";
  if (!String(shaped.source || shaped.platform || "").trim()) return "missing source";
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
  const shaped = normalizePropShape(prop, { platform, source: platform });
  const normalizedPlatform = normalizePlatform(platform || shaped.platform);
  const allowedBadge = VERIFIED_LINE_BADGES.has(badge) ? badge : "LIVE";
  return {
    ...shaped,
    platform: normalizedPlatform,
    market: shaped.market || shaped.statType || shaped.propType || "",
    lineSourceBadge: allowedBadge,
    sportsbookVerified: isSupportedSportsbookSource({ ...shaped, platform: normalizedPlatform }),
    feedSource: normalizedPlatform,
    verifiedBadge: isSupportedSportsbookSource({ ...shaped, platform: normalizedPlatform }) ? "VERIFIED" : null,
  };
}
