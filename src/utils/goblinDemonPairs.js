/**
 * Pair Goblin (safer/easier) and Demon (harder/higher-payout) lines for the same player + prop + source.
 * Only classifies when source tags or line comparison clearly supports it — never fakes pairs.
 */

import { buildPropDedupeKey } from "./displayPropScoring.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { calibrateRealisticConfidence } from "./mlbConfidenceEngine.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isDemonProp, isGoblinProp } from "./propLabels.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { filterAllDisplayPropsBySport } from "./allDisplayProps.js";
import { filterActiveSportProps } from "./mlbOnlyMode.js";
import { isLooseDisplayProp, dedupeLooseProps } from "./safeModePipeline.js";
import { filterByDisplayConfidenceFloor } from "./mlbConfidenceEngine.js";

const MIN_LINE_GAP = 0.5;
const GOBLIN_CONFIDENCE_BOOST = 10;
const DEMON_CONFIDENCE_PENALTY = 10;
const DISPLAY_CONF_MIN = 52;
const DISPLAY_CONF_MAX = 82;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePlayer(prop = {}) {
  return String(prop.player || prop.playerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function normalizeStat(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function normalizeSource(prop = {}) {
  const raw = String(prop.source || prop.platform || "").trim().toLowerCase();
  if (/prizepicks|pp/.test(raw)) return "prizepicks";
  if (/underdog|ud/.test(raw)) return "underdog";
  return raw.replace(/[^a-z0-9]+/g, "-") || "unknown";
}

/** player + prop type + source */
export function buildGoblinDemonGroupKey(prop = {}) {
  return `${normalizePlayer(prop)}|${normalizeStat(prop)}|${normalizeSource(prop)}`;
}

function sideBucket(prop = {}) {
  const side = resolvePickSide(prop);
  if (side === "UNDER") return "under";
  if (side === "OVER") return "over";
  return "unknown";
}

function pairSubGroupKey(prop = {}) {
  return `${buildGoblinDemonGroupKey(prop)}|${sideBucket(prop)}`;
}

function lineKey(prop = {}) {
  return buildPropDedupeKey(prop);
}

/** For OVER: lower line is easier (Goblin). For UNDER: higher line is easier. */
export function isEasierLine(easierProp = {}, harderProp = {}) {
  const lineA = finiteOr(easierProp.line, NaN);
  const lineB = finiteOr(harderProp.line, NaN);
  if (!Number.isFinite(lineA) || !Number.isFinite(lineB)) return false;
  if (Math.abs(lineA - lineB) < MIN_LINE_GAP) return false;

  const side = sideBucket(easierProp);
  if (side === "over") return lineA < lineB;
  if (side === "under") return lineA > lineB;
  return lineA !== lineB;
}

function baseConfidence(prop = {}) {
  return clamp(
    Math.round(finiteOr(prop.confidenceScore ?? prop.confidence, 58)),
    DISPLAY_CONF_MIN,
    DISPLAY_CONF_MAX
  );
}

function adjustRoleConfidence(confidence, role, prop = {}) {
  const delta = role === "goblin" ? GOBLIN_CONFIDENCE_BOOST : -DEMON_CONFIDENCE_PENALTY;
  return calibrateRealisticConfidence(confidence + delta, prop);
}

function annotatePayoutProp(prop = {}, role, { pairedLine = null, pairedWith = null, verified = false } = {}) {
  const isGoblin = role === "goblin";
  const conf = adjustRoleConfidence(baseConfidence(prop), role, prop);
  const analyticsReason = buildAnalyticsReason(prop);
  return withPlayerImageUrl({
    ...prop,
    confidence: conf,
    confidenceScore: conf,
    analyticsReason: analyticsReason || prop.analyticsReason,
    confidenceExplanation: analyticsReason || prop.confidenceExplanation,
    payoutRole: role,
    payoutLabel: isGoblin ? "Goblin" : "Demon",
    payoutBadge: isGoblin ? "GOBLIN / SAFER LINE" : "DEMON / HIGHER PAYOUT",
    isGoblinPick: isGoblin,
    isDemonPick: !isGoblin,
    goblinDemonVerified: verified,
    pairedLine,
    pairedWith,
    displayFallback: false,
    isFallbackMlbPick: false,
    fallbackLabel: "",
  });
}

function sourceSupportsRole(prop, role) {
  if (role === "goblin") return isGoblinProp(prop);
  if (role === "demon") return isDemonProp(prop);
  return false;
}

function pairQualifies(easier, harder) {
  if (!isEasierLine(easier, harder)) return false;

  const easierIsGoblin = isGoblinProp(easier);
  const easierIsDemon = isDemonProp(easier);
  const harderIsGoblin = isGoblinProp(harder);
  const harderIsDemon = isDemonProp(harder);

  if (easierIsDemon || harderIsGoblin) return false;
  if (easierIsGoblin && harderIsDemon) return true;
  if (easierIsGoblin && !harderIsGoblin && !harderIsDemon) return true;
  if (harderIsDemon && !easierIsGoblin && !easierIsDemon) return true;

  return !easierIsGoblin && !easierIsDemon && !harderIsGoblin && !harderIsDemon;
}

function sortByEasierFirst(props = [], side = "over") {
  return [...props].sort((a, b) => {
    const la = finiteOr(a.line, 0);
    const lb = finiteOr(b.line, 0);
    if (side === "under") return lb - la;
    return la - lb;
  });
}

function pickBestPair(group = []) {
  if (group.length < 2) return null;

  const side = sideBucket(group[0]);
  const sorted = sortByEasierFirst(group, side);

  let best = null;
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = sorted.length - 1; j > i; j -= 1) {
      const easier = sorted[i];
      const harder = sorted[j];
      if (!pairQualifies(easier, harder)) continue;

      const gap = Math.abs(finiteOr(easier.line, 0) - finiteOr(harder.line, 0));
      const verified =
        (sourceSupportsRole(easier, "goblin") && sourceSupportsRole(harder, "demon")) ||
        sourceSupportsRole(easier, "goblin") ||
        sourceSupportsRole(harder, "demon");
      const score =
        gap * 10 +
        (verified ? 50 : 20) +
        baseConfidence(easier) +
        baseConfidence(harder);

      if (!best || score > best.score) {
        best = { easier, harder, verified, score, gap };
      }
    }
  }

  return best;
}

function buildPropPool(displayProps = [], rawProps = []) {
  const mlbDisplay = filterAllDisplayPropsBySport(displayProps, "MLB", "all");
  const mlbRaw = filterActiveSportProps(rawProps || []);
  return filterByDisplayConfidenceFloor(
    dedupeLooseProps([...mlbDisplay, ...mlbRaw].filter(isLooseDisplayProp))
  );
}

/**
 * Resolve verified Goblin/Demon boards from line pairs and source tags.
 * @returns {{ goblins: object[], demons: object[], pairedKeys: Set<string> }}
 */
export function resolveGoblinDemonBoards(
  props = [],
  { goblinLimit = 6, demonLimit = 6 } = {}
) {
  const grouped = new Map();
  for (const prop of props || []) {
    if (!isLooseDisplayProp(prop)) continue;
    const key = pairSubGroupKey(prop);
    const bucket = grouped.get(key) || [];
    bucket.push(prop);
    grouped.set(key, bucket);
  }

  const goblins = [];
  const demons = [];
  const usedLineKeys = new Set();
  const candidates = [];

  grouped.forEach((group) => {
    const pair = pickBestPair(group);
    if (!pair) return;
    candidates.push(pair);
  });

  candidates.sort((a, b) => b.score - a.score);

  for (const { easier, harder, verified } of candidates) {
    if (goblins.length >= goblinLimit && demons.length >= demonLimit) break;

    const easierKey = lineKey(easier);
    const harderKey = lineKey(harder);
    if (usedLineKeys.has(easierKey) || usedLineKeys.has(harderKey)) continue;

    if (goblins.length < goblinLimit) {
      goblins.push(
        annotatePayoutProp(easier, "goblin", {
          pairedLine: harder.line,
          pairedWith: harderKey,
          verified,
        })
      );
      usedLineKeys.add(easierKey);
    }

    if (demons.length < demonLimit) {
      demons.push(
        annotatePayoutProp(harder, "demon", {
          pairedLine: easier.line,
          pairedWith: easierKey,
          verified,
        })
      );
      usedLineKeys.add(harderKey);
    }
  }

  return { goblins, demons, pairedKeys: usedLineKeys };
}

export function resolveCuratedGoblinDemonBoards(
  displayProps = [],
  rawProps = [],
  { goblinBoardPicks = [], demonBoardPicks = [], goblinLimit = 6, demonLimit = 6 } = {}
) {
  const pool = buildPropPool(displayProps, rawProps);
  const paired = resolveGoblinDemonBoards(pool, { goblinLimit, demonLimit });

  let goblins = paired.goblins;
  let demons = paired.demons;

  if (!goblins.length) {
    const verified = (goblinBoardPicks || []).filter(isGoblinProp).slice(0, goblinLimit);
    goblins = verified.map((prop) =>
      annotatePayoutProp(prop, "goblin", { verified: true, pairedLine: null })
    );
  }

  if (!demons.length) {
    const verified = (demonBoardPicks || []).filter(isDemonProp).slice(0, demonLimit);
    demons = verified.map((prop) =>
      annotatePayoutProp(prop, "demon", { verified: true, pairedLine: null })
    );
  }

  return { goblins: goblins.slice(0, goblinLimit), demons: demons.slice(0, demonLimit) };
}

export function resolveCuratedGoblinPicks(displayProps = [], rawProps = [], boardPicks = [], limit = 6) {
  return resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    goblinBoardPicks: boardPicks,
    goblinLimit: limit,
    demonLimit: 0,
  }).goblins;
}

export function resolveCuratedDemonPicks(displayProps = [], rawProps = [], boardPicks = [], limit = 6) {
  return resolveCuratedGoblinDemonBoards(displayProps, rawProps, {
    demonBoardPicks: boardPicks,
    goblinLimit: 0,
    demonLimit: limit,
  }).demons;
}

export const GOBLIN_EMPTY_MESSAGE = "No verified Goblin lines found";
export const DEMON_EMPTY_MESSAGE = "No verified Demon lines found";
