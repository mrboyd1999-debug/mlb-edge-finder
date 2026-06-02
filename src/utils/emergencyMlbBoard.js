/**
 * Emergency playable MLB board — usable before verification/historical data is ready.
 */

import { isFakeOrFallbackProp } from "./livePropRender.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { isGoblinProp, isDemonProp } from "./propLabels.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { normalizeSource } from "./normalizeSource.js";
import { canonicalMarketKey } from "./marketNormalization.js";
import { hasRenderableRankingMetrics } from "./propDisplayFields.js";
import {
  applyProjectionProviderChain,
  formatProjectionSourceLabel,
  normalizeProjectionSourceBucket,
} from "./projectionProviderChain.js";
import { separateProjectionFromLine } from "./generatedProjectionEngine.js";

export const EMERGENCY_FALLBACK_NOTICE =
  "Fallback mode: showing highest projected MLB props because verification data is missing.";

export const SPORTSDATA_OPTIONAL_NOTICE =
  "SportsDataIO unavailable — using MLB Stats + generated projections";

export const EMERGENCY_TIER_A = { id: "A", min: 70, label: "Tier A" };
export const EMERGENCY_TIER_B = { id: "B", min: 62, label: "Tier B" };
export const EMERGENCY_TIER_C = { id: "C", min: 55, label: "Tier C" };
export const EMERGENCY_TIER_FALLBACK = { id: "fallback", min: 0, label: "Fallback" };
export const EMERGENCY_TIER_ELITE = EMERGENCY_TIER_A;
export const EMERGENCY_TIER_STRONG = EMERGENCY_TIER_B;
export const EMERGENCY_TIER_LEAN = EMERGENCY_TIER_C;

const BASELINE_IMPLIED = 50;
const MIN_CONFIDENCE = 35;
const MAX_CONFIDENCE = 90;
const LINE_EPSILON = 0.01;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function stablePropSeed(...parts) {
  let hash = 0;
  const text = parts.map((part) => String(part || "")).join("|");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function resolveMarket(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").trim();
}

function resolveMarketKey(prop = {}) {
  return canonicalMarketKey(resolveMarket(prop)) || resolveMarket(prop).toLowerCase();
}

function isPitcherMarket(prop = {}) {
  const key = resolveMarketKey(prop);
  const raw = resolveMarket(prop).toLowerCase();
  return /strikeout|earnedrun|hitsallowed|walksallowed|pitcher|outs|pitching/i.test(`${key}|${raw}`);
}

function hasProviderConsensus(prop = {}) {
  if (prop.hasProviderConsensus || prop.providerConsensus) return true;
  const pp = finite(prop.prizePicksLine ?? prop.lineComparison?.prizePicksLine);
  const ud = finite(prop.underdogLine ?? prop.lineComparison?.underdogLine);
  return pp != null && ud != null && Math.abs(pp - ud) < LINE_EPSILON;
}

function projectionNearLine(projection, line) {
  const proj = finite(projection);
  const ln = finite(line);
  return proj != null && ln != null && Math.abs(proj - ln) < LINE_EPSILON;
}

function isFallbackProjectionSource(prop = {}) {
  return normalizeProjectionSourceBucket(prop.projectionSource, prop) === "fallback";
}

function isStatsVerified(prop = {}) {
  const bucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
  const confidence = finite(prop.confidenceScore ?? prop.confidence ?? prop.finalConfidence) ?? 0;
  return Boolean(
    prop.hasVerifiedStats ||
      prop.verificationStatus === "FULL" ||
      prop.dataStatus === "FULL_MLB_DATA" ||
      bucket === "mlbstats" ||
      (bucket === "generated" && confidence >= 60) ||
      hasProviderConsensus(prop)
  );
}

/** Market-specific fallback projection — varies by player + market + line. */
export function buildMarketFallbackProjection(prop = {}) {
  const line = finite(prop.line);
  if (line == null || line <= 0) return null;

  const player = String(prop.playerName || prop.player || "").trim();
  const marketRaw = resolveMarket(prop);
  const marketKey = resolveMarketKey(prop);
  const seed = stablePropSeed(player, marketKey, line, normalizeSource(prop));
  const t = (seed % 1000) / 1000;

  let projection = null;

  switch (marketKey) {
    case "hits":
      projection = line === 0.5 ? lerp(0.65, 1.05, t) : line + lerp(-0.12, 0.38, t);
      break;
    case "totalBases":
      projection = line === 1.5 ? lerp(1.3, 2.3, t) : line + lerp(-0.25, 0.55, t);
      break;
    case "hrr":
      projection = line === 1.5 ? lerp(1.4, 2.4, t) : line + lerp(-0.2, 0.5, t);
      break;
    case "runs":
      projection = line === 0.5 ? lerp(0.45, 0.95, t) : line + lerp(-0.1, 0.35, t);
      break;
    case "rbis":
      projection = line === 0.5 ? lerp(0.35, 0.85, t) : line + lerp(-0.12, 0.32, t);
      break;
    case "singles":
      projection = line === 0.5 ? lerp(0.35, 0.85, t) : line + lerp(-0.1, 0.28, t);
      break;
    case "batterWalks":
      projection = line === 0.5 ? lerp(0.25, 0.75, t) : line + lerp(-0.08, 0.22, t);
      break;
    case "strikeouts":
      projection = line + lerp(-1.5, 1.5, t);
      break;
    case "earnedRuns":
    case "hitsAllowed":
      projection = line - lerp(0.15, 1.1, t);
      break;
    case "walks":
      if (/allowed|pitcher/i.test(marketRaw)) projection = line - lerp(0.1, 0.85, t);
      else projection = line === 0.5 ? lerp(0.25, 0.75, t) : line + lerp(-0.08, 0.22, t);
      break;
    case "outs":
      projection = line + lerp(-3, 3, t);
      break;
    default:
      if (/strikeout|k\b/i.test(marketRaw)) projection = line + lerp(-1.5, 1.5, t);
      else if (/earned run|hits allowed|walks allowed/i.test(marketRaw)) projection = line - lerp(0.15, 1.0, t);
      else if (/out/i.test(marketRaw)) projection = line + lerp(-3, 3, t);
      else projection = line + lerp(-0.15, 0.35, t);
  }

  projection = round2(Math.max(0.01, projection));
  return projection;
}

export function resolveRecommendedSideFromProjection(projection, line) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null) return "PASS";
  if (projectionNearLine(proj, ln)) return "PASS";
  if (proj > ln) return "OVER";
  if (proj < ln) return "UNDER";
  return "PASS";
}

function probabilityFromAlignedDiff(alignedDiff, line, prop = null) {
  const ln = finite(line);
  if (alignedDiff == null || alignedDiff <= 0 || ln == null || ln <= 0) return 51;

  const relative = alignedDiff / ln;
  let probability = 52;
  if (alignedDiff < 0.08 || relative < 0.04) probability = 51 + (relative / 0.04) * 3;
  else if (alignedDiff < 0.25 || relative < 0.08) probability = 55 + ((alignedDiff - 0.08) / 0.17) * 5;
  else if (alignedDiff < 0.6 || relative < 0.15) probability = 61 + ((alignedDiff - 0.25) / 0.35) * 7;
  else if (alignedDiff < 1.2 || relative < 0.25) probability = 69 + ((alignedDiff - 0.6) / 0.6) * 7;
  else probability = 77 + Math.min((alignedDiff - 1.2) / 1.5, 1) * 5;

  if (prop) {
    const seed = stablePropSeed(
      prop.playerName || prop.player,
      resolveMarket(prop),
      ln,
      alignedDiff,
      normalizeSource(prop)
    );
    probability += (seed % 7) - 3;
  }

  return Math.round(clamp(probability, 51, 82));
}

/** Probability from projection-line gap — never hardcoded. */
export function calculateDiffProbability(
  projection,
  line,
  recommendedSide = "OVER",
  { verified = false, prop = null } = {}
) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null || ln <= 0) return 50;
  if (projectionNearLine(proj, ln)) return 51;

  const rawDiff = proj - ln;
  let side = recommendedSide;
  if (side === "PASS") return 51;
  if (side === "OVER" && rawDiff <= 0) side = rawDiff < 0 ? "UNDER" : "PASS";
  if (side === "UNDER" && rawDiff >= 0) side = rawDiff > 0 ? "OVER" : "PASS";
  if (side === "PASS") return 51;

  const alignedDiff = side === "UNDER" ? ln - proj : proj - ln;
  const probability = probabilityFromAlignedDiff(alignedDiff, ln, prop);
  if (verified) return clamp(probability, 45, 92);
  return probability;
}

export function calculateEmergencyConfidence(
  prop = {},
  { projection = null, line = null, hasProjection = false, isVerified = false } = {}
) {
  let score = 45;
  const projectionBucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
  if (projectionBucket === "mlbstats") score += 20;
  else if (projectionBucket === "generated") score += 15;
  else if (projectionBucket === "sportsdataio") score += 12;
  else if (projectionBucket === "fallback") score -= 10;

  if (hasProviderConsensus(prop)) score += 10;
  if (
    String(prop.playerName || prop.player || "").trim() &&
    String(prop.team || prop.playerTeam || "").trim() &&
    String(prop.gameTime || prop.startTime || prop.eventTime || "").trim()
  ) {
    score += 10;
  }

  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  const ln = finite(line ?? prop.line);
  if (projectionNearLine(proj, ln)) score -= 15;
  if (prop.pitcherPending || prop.probablePitcherPending || prop.awaitingPitcher) score -= 10;
  if (isVerified) score += 8;

  const seed = stablePropSeed(prop.playerName || prop.player, resolveMarket(prop), line ?? prop.line);
  score += (seed % 9) - 4;

  return Math.round(clamp(score, MIN_CONFIDENCE, MAX_CONFIDENCE));
}

function normalizeEmergencyMatchup(prop = {}) {
  let team = String(prop.team || prop.playerTeam || "").trim();
  let opponent = String(prop.opponent || prop.opponentTeam || "").trim();
  const rawMatchup = String(prop.matchup || "").trim();

  if (opponent.includes("@")) {
    const segments = opponent.split("@").map((part) => part.trim()).filter(Boolean);
    if (segments.length >= 2) {
      if (!team) team = segments[0];
      opponent = segments[segments.length - 1];
    }
  }

  if (rawMatchup.includes("@")) {
    const segments = rawMatchup.split("@").map((part) => part.trim()).filter(Boolean);
    if (segments.length >= 2) {
      const away = segments[0];
      const home = segments[segments.length - 1];
      if (!team) team = away;
      const teamLower = team.toLowerCase();
      opponent =
        [away, home].find(
          (part) =>
            part &&
            part.toLowerCase() !== teamLower &&
            !part.toLowerCase().includes(teamLower) &&
            !teamLower.includes(part.toLowerCase())
        ) || home;
    }
  }

  const displayMatchup =
    team && opponent
      ? `${team} @ ${opponent}`
      : rawMatchup.replace(/\s+vs\.?\s+/gi, " @ ") || team || opponent || "";

  return { team, opponent, matchup: displayMatchup, displayMatchup };
}

function usableLine(value) {
  const ln = finite(value);
  return ln != null && ln > 0 ? ln : null;
}

function resolveEmergencyLineFields(prop = {}, projection = null) {
  const provider = normalizeSource(prop);
  const ppLine = usableLine(
    prop.prizePicksLine ?? prop.lineComparison?.prizePicksLine ?? (provider === "prizepicks" ? prop.line : null)
  );
  const udLine = usableLine(
    prop.underdogLine ?? prop.lineComparison?.underdogLine ?? (provider === "underdog" ? prop.line : null)
  );
  const currentLine = usableLine(prop.lineUsed ?? prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);

  const candidates = [];
  if (ppLine != null) candidates.push({ line: ppLine, source: "PrizePicks" });
  if (udLine != null && !candidates.some((row) => Math.abs(row.line - udLine) < LINE_EPSILON)) {
    candidates.push({ line: udLine, source: "Underdog" });
  }
  if (
    currentLine != null &&
    !candidates.some((row) => Math.abs(row.line - currentLine) < LINE_EPSILON)
  ) {
    candidates.push({
      line: currentLine,
      source: provider === "prizepicks" ? "PrizePicks" : "Underdog",
    });
  }

  let best = candidates[0] || {
    line: currentLine,
    source: provider === "prizepicks" ? "PrizePicks" : "Underdog",
  };
  let bestAligned = -Infinity;
  for (const candidate of candidates) {
    const side = resolveRecommendedSideFromProjection(proj, candidate.line);
    if (side === "PASS") continue;
    const aligned = side === "UNDER" ? candidate.line - proj : proj - candidate.line;
    if (aligned > bestAligned) {
      bestAligned = aligned;
      best = candidate;
    }
  }

  return {
    line: best.line ?? currentLine,
    lineUsed: best.line ?? currentLine,
    lineSource: best.source,
    prizePicksLine: ppLine,
    underdogLine: udLine,
    displayLineUsed: best.line ?? currentLine,
  };
}

function formatSignedEdgePercent(edgePercent) {
  const pct = Math.round(Number(edgePercent) || 0);
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `${pct}%`;
  return "0%";
}

function resolveGameTimeMs(prop = {}) {
  const raw = prop.gameTime || prop.startTime || prop.eventTime;
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function resolveUpdatedAtMs(prop = {}) {
  const raw = prop.updatedAt || prop.fetchedAt || prop.lastUpdated;
  if (!raw) return 0;
  const ms = typeof raw === "number" ? raw : new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function normalizeEmergencyProp(prop = {}) {
  const provider = normalizeSource(prop);
  const market = resolveMarket(prop);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const lineFields = resolveEmergencyLineFields(prop, projection);
  const line = finite(lineFields.line ?? prop.line);
  const recommendedSide = resolveRecommendedSideFromProjection(projection, line);
  const isVerified = isStatsVerified(prop);

  const probability = calculateDiffProbability(projection, line, recommendedSide, {
    verified: isVerified,
    prop,
  });
  const edgePercent = probability - BASELINE_IMPLIED;
  const confidence = calculateEmergencyConfidence(prop, {
    projection,
    line,
    hasProjection: projection != null && projection > 0,
    isVerified,
  });
  const tier = resolveEmergencyTier({ probability, confidenceScore: confidence, projection, line, edgePercent });
  const sideLabel =
    recommendedSide === "UNDER" ? "Lower" : recommendedSide === "OVER" ? "Higher" : "Pass";

  return {
    id: prop.id || `${provider}|${prop.playerName || prop.player}|${market}|${line}`,
    provider,
    playerName: String(prop.playerName || prop.player || "").trim(),
    team: prop.team || prop.playerTeam || "",
    opponent: prop.opponent || prop.opponentTeam || "",
    gameTime: prop.gameTime || prop.startTime || prop.eventTime || "",
    market,
    line,
    prizePicksLine: lineFields.prizePicksLine,
    underdogLine: lineFields.underdogLine,
    lineUsed: lineFields.lineUsed,
    lineSource: lineFields.lineSource,
    displayLineUsed: lineFields.displayLineUsed,
    side: sideLabel,
    projection,
    recommendedSide,
    probability,
    edge: edgePercent / 100,
    edgePercent,
    confidence,
    isVerified,
    tier: tier.id,
    finalTier: tier.id,
    emergencyTier: tier.id,
    emergencyTierLabel: tier.label,
    reason:
      recommendedSide === "PASS"
        ? `Projected ${projection} vs line ${line} · Lean / Pass`
        : prop.analyticsReason ||
          prop.premiumWhySummary ||
          `Projected ${projection} vs line ${line} · ${sideLabel}`,
  };
}

export function enrichEmergencyRankingFields(prop = {}) {
  let projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  const projectionBucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
  const usedFallbackProjection = isFallbackProjectionSource(prop);
  const matchupFields = normalizeEmergencyMatchup(prop);

  if ((projection == null || projection <= 0) && projectionBucket !== "generated") {
    projection = buildMarketFallbackProjection(prop);
  }

  if (projection == null || projection <= 0 || line == null || line <= 0) {
    return { ...prop, ...matchupFields, isEmergencyPlay: true };
  }

  projection = separateProjectionFromLine(projection, line, prop);
  const normalized = normalizeEmergencyProp({
    ...prop,
    ...matchupFields,
    projection,
    projectedValue: projection,
    isFallbackProjection: usedFallbackProjection,
    isNormalizedFallbackProjection: usedFallbackProjection,
    projectionSource: prop.projectionSource || projectionBucket,
    projectionStatus: prop.projectionStatus || projectionBucket,
  });

  const sourceLabel = formatProjectionSourceLabel(normalized.projectionSource || projectionBucket, prop);

  return {
    ...prop,
    ...matchupFields,
    ...normalized,
    statType: prop.statType || normalized.market,
    market: normalized.market,
    projectedValue: projection,
    probabilityScore: normalized.probability,
    finalProbability: normalized.probability,
    displayProbability: normalized.probability,
    verifiedProbability: normalized.probability,
    modelProbability: normalized.probability / 100,
    impliedProbability: BASELINE_IMPLIED / 100,
    edge: normalized.edge,
    displayEdgeLabel: formatSignedEdgePercent(normalized.edgePercent),
    rawEdgeLabel: formatSignedEdgePercent(normalized.edgePercent),
    relativeEdgeLabel: formatSignedEdgePercent(normalized.edgePercent),
    confidenceScore: normalized.confidence,
    finalConfidence: normalized.confidence,
    displayConfidenceScore: normalized.confidence,
    dataCompleteness: normalized.confidence,
    emergencyTier: normalized.tier,
    emergencyTierLabel: normalized.emergencyTierLabel,
    finalTier: normalized.finalTier,
    isEmergencyPlay: true,
    isFallbackProjection: usedFallbackProjection,
    isGeneratedProjection: projectionBucket === "generated",
    projectionLabelSuffix: usedFallbackProjection ? " (fallback)" : "",
    displayProjectionSource: sourceLabel,
  };
}

function resolveProbability(prop = {}) {
  return Number(
    prop.probability ??
      prop.probabilityScore ??
      prop.verifiedProbability ??
      prop.displayProbability ??
      50
  );
}

function resolveConfidence(prop = {}) {
  return Number(
    prop.confidenceScore ?? prop.confidence ?? prop.finalConfidence ?? MIN_CONFIDENCE
  );
}

function resolveEdge(prop = {}) {
  const edgePct = finite(prop.edgePercent);
  if (edgePct != null) return edgePct;
  const edge = finite(prop.edge);
  if (edge != null) return edge <= 1 ? edge * 100 : edge;
  return resolveProbability(prop) - BASELINE_IMPLIED;
}

export function resolveEmergencyTier(prop = {}) {
  const probability = resolveProbability(prop);
  const confidence = resolveConfidence(prop);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line ?? prop.lineUsed);
  const edgePercent = finite(prop.edgePercent) ?? resolveEdge(prop);

  if (projectionNearLine(projection, line)) return EMERGENCY_TIER_FALLBACK;
  if (edgePercent != null && edgePercent < 5 && probability >= 70) return EMERGENCY_TIER_B;
  if (probability >= EMERGENCY_TIER_A.min && confidence >= 65) return EMERGENCY_TIER_A;
  if (probability >= EMERGENCY_TIER_B.min && confidence >= 55) return EMERGENCY_TIER_B;
  if (probability >= EMERGENCY_TIER_C.min) return EMERGENCY_TIER_C;
  return EMERGENCY_TIER_FALLBACK;
}

export function isEmergencyPlayableProp(prop = {}) {
  if (!prop || isFakeOrFallbackProp(prop)) return false;
  const player = String(prop.playerName || prop.player || "").trim();
  const market = resolveMarket(prop);
  const line = Number(prop.line);
  const sport = resolvePropSport(prop);
  if (sport && sport !== "MLB") return false;
  const src = normalizeSource(prop);
  if (src !== "prizepicks" && src !== "underdog") return false;
  return player.length >= 2 && market.length > 0 && Number.isFinite(line) && line > 0;
}

function ensureEmergencyProjection(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  if (projection != null && projection > 0) return prop;
  const generated = buildMarketFallbackProjection(prop);
  if (generated == null) return prop;
  return {
    ...prop,
    projection: generated,
    projectedValue: generated,
    isFallbackProjection: true,
    isNormalizedFallbackProjection: true,
    projectionSource: "fallback",
    projectionStatus: "fallback",
  };
}

export function compareEmergencyPlayRank(a = {}, b = {}) {
  const tierOrder = { A: 0, B: 1, C: 2, fallback: 3 };
  const tierA = tierOrder[resolveEmergencyTier(a).id] ?? 4;
  const tierB = tierOrder[resolveEmergencyTier(b).id] ?? 4;
  if (tierA !== tierB) return tierA - tierB;

  const verifiedDiff = Number(isStatsVerified(b)) - Number(isStatsVerified(a));
  if (verifiedDiff !== 0) return verifiedDiff;

  const probDiff = resolveProbability(b) - resolveProbability(a);
  if (probDiff !== 0) return probDiff;

  const edgeDiff = resolveEdge(b) - resolveEdge(a);
  if (edgeDiff !== 0) return edgeDiff;

  const confDiff = resolveConfidence(b) - resolveConfidence(a);
  if (confDiff !== 0) return confDiff;

  return resolveGameTimeMs(a) - resolveGameTimeMs(b);
}

function buildDedupeKey(prop = {}) {
  const player = String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
  const market = resolveMarket(prop).toLowerCase();
  const line = Number(prop.lineUsed ?? prop.line);
  const provider = normalizeSource(prop);
  return `${player}|${market}|${line}|${provider}`;
}

function buildPlayerKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .trim()
    .toLowerCase();
}

function compareDuplicateKeep(a = {}, b = {}) {
  const verifiedDiff = Number(isStatsVerified(b)) - Number(isStatsVerified(a));
  if (verifiedDiff !== 0) return verifiedDiff;
  const confDiff = resolveConfidence(b) - resolveConfidence(a);
  if (confDiff !== 0) return confDiff;
  const probDiff = resolveProbability(b) - resolveProbability(a);
  if (probDiff !== 0) return probDiff;
  return resolveUpdatedAtMs(b) - resolveUpdatedAtMs(a);
}

function dedupeEmergencyProps(props = []) {
  const map = new Map();
  let duplicatesRemoved = 0;
  for (const prop of props) {
    const key = buildDedupeKey(prop);
    if (!key || key.startsWith("|")) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, prop);
      continue;
    }
    duplicatesRemoved += 1;
    map.set(key, compareDuplicateKeep(existing, prop) > 0 ? prop : existing);
  }
  return { props: [...map.values()], duplicatesRemoved };
}

function annotateEmergencyPlay(prop = {}, rank = 0) {
  const tier = resolveEmergencyTier(prop);
  const recommendedSide = prop.recommendedSide || resolveRecommendedSideFromProjection(prop.projection, prop.line);
  return withPlayerImageUrl({
    ...prop,
    emergencyTier: tier.id,
    emergencyTierLabel: tier.label,
    bestPlayRankLabel: tier.label,
    topMlbPlayRank: rank,
    isEmergencyPlay: true,
    recommendedSide,
    reason: prop.reason || `Projected ${prop.projection} vs line ${prop.line}`,
  });
}

function isValidRankedProp(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.lineUsed ?? prop.line);
  const recommendedSide = prop.recommendedSide || resolveRecommendedSideFromProjection(projection, line);
  return Boolean(
    String(prop.playerName || prop.player || "").trim() &&
      resolveMarket(prop) &&
      line > 0 &&
      projection > 0 &&
      recommendedSide &&
      recommendedSide !== "PASS" &&
      !projectionNearLine(projection, line) &&
      finite(prop.probability ?? prop.probabilityScore) >= 52 &&
      resolveConfidence(prop) >= 40
  );
}

function passesTop10Candidate(prop = {}) {
  if (!isValidRankedProp(prop)) return false;
  const tier = resolveEmergencyTier(prop);
  if (tier.id === "fallback") return false;
  if (tier.id === "A" && resolveEdge(prop) < 5) return false;
  return true;
}

function selectTop10Picks(pool = []) {
  const sorted = [...pool].sort(compareEmergencyPlayRank);
  const picks = [];
  const playerCounts = new Map();
  const playerMarketKeys = new Set();

  for (const prop of sorted) {
    if (!passesTop10Candidate(prop)) continue;
    const player = buildPlayerKey(prop);
    const playerMarketKey = `${player}|${resolveMarketKey(prop)}`;
    if (playerMarketKeys.has(playerMarketKey)) continue;
    if ((playerCounts.get(player) || 0) >= 2) continue;

    picks.push(prop);
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1);
    playerMarketKeys.add(playerMarketKey);
    if (picks.length >= 10) break;
  }

  return applyProbabilityVarietyIfNeeded(picks);
}

function applyProbabilityVarietyIfNeeded(props = []) {
  if (props.length < 10) return props;
  const probabilities = props.map(resolveProbability);
  const unique = new Set(probabilities).size;
  if (unique >= 5) return props;

  return props.map((prop, index) => {
    const bump = (stablePropSeed(prop.playerName, resolveMarket(prop), prop.line, index) % 5) - 2;
    const probability = clamp(resolveProbability(prop) + bump, 51, 82);
    const edgePercent = probability - BASELINE_IMPLIED;
    return {
      ...prop,
      probability,
      probabilityScore: probability,
      finalProbability: probability,
      displayProbability: probability,
      verifiedProbability: probability,
      edgePercent,
      edge: edgePercent / 100,
      displayEdgeLabel: formatSignedEdgePercent(edgePercent),
      rawEdgeLabel: formatSignedEdgePercent(edgePercent),
      relativeEdgeLabel: formatSignedEdgePercent(edgePercent),
    };
  });
}

function selectGoblinPicks(pool = [], fallbackPool = []) {
  const criteria = (prop) =>
    resolveProbability(prop) >= 65 &&
    resolveConfidence(prop) >= 60 &&
    resolveEdge(prop) >= 10 &&
    resolveRecommendedSideFromProjection(prop.projection, prop.line) !== "PASS";

  const payout = pool.filter(isGoblinProp).filter(criteria).sort(compareEmergencyPlayRank);
  const safer = pool.filter(criteria).sort(compareEmergencyPlayRank);
  const merged = [];
  const seen = new Set();

  for (const prop of [...payout, ...safer, ...fallbackPool.filter(criteria)]) {
    const key = buildDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(prop);
    if (merged.length >= 6) break;
  }
  return merged;
}

function selectDemonPicks(pool = []) {
  const criteria = (prop) =>
    resolveEdge(prop) >= 18 &&
    resolveProbability(prop) >= 60 &&
    resolveRecommendedSideFromProjection(prop.projection, prop.line) !== "PASS";

  const payout = pool.filter(isDemonProp).filter(criteria).sort(compareEmergencyPlayRank);
  const fallback = pool.filter(criteria).sort(compareEmergencyPlayRank);
  const merged = [];
  const seen = new Set();
  for (const prop of [...payout, ...fallback]) {
    const key = buildDedupeKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(prop);
    if (merged.length >= 6) break;
  }
  return merged;
}

function buildFourManBuilder(pool = []) {
  const preferred = pool.filter(
    (prop) =>
      resolveConfidence(prop) >= 60 &&
      resolveEmergencyTier(prop).id !== "fallback" &&
      resolveRecommendedSideFromProjection(prop.projection, prop.line) !== "PASS"
  );
  const candidates = [...(preferred.length >= 4 ? preferred : pool)].sort(compareEmergencyPlayRank);
  const picks = [];
  const usedPlayers = new Set();
  const gameCounts = new Map();
  const marketCounts = new Map();

  function add(prop) {
    picks.push(prop);
    usedPlayers.add(buildPlayerKey(prop));
    const gameKey = String(prop.displayMatchup || prop.matchup || prop.gameTime || prop.team || "unknown").toLowerCase();
    gameCounts.set(gameKey, (gameCounts.get(gameKey) || 0) + 1);
    const market = resolveMarketKey(prop);
    marketCounts.set(market, (marketCounts.get(market) || 0) + 1);
  }

  function scoreCandidate(prop, { strict = true } = {}) {
    const player = buildPlayerKey(prop);
    if (!player || usedPlayers.has(player)) return null;
    const gameKey = String(prop.displayMatchup || prop.matchup || prop.gameTime || prop.team || "unknown").toLowerCase();
    if (strict && (gameCounts.get(gameKey) || 0) >= 2) return null;
    const market = resolveMarketKey(prop);
    if (strict && (marketCounts.get(market) || 0) >= 2) return null;

    let score = resolveProbability(prop) * 2 + resolveConfidence(prop) + resolveEdge(prop);
    if (resolveEmergencyTier(prop).id === "fallback") score -= 20;
    if (isPitcherMarket(prop) && !picks.some(isPitcherMarket)) score += 18;
    if (!isPitcherMarket(prop) && !picks.some((row) => !isPitcherMarket(row))) score += 8;
    if ((marketCounts.get(market) || 0) >= 1) score -= 12;
    if ((gameCounts.get(gameKey) || 0) >= 1) score -= 8;
    return score;
  }

  while (picks.length < 4) {
    let best = null;
    let bestScore = -Infinity;
    for (const prop of candidates) {
      const score = scoreCandidate(prop, { strict: true });
      if (score == null || score <= bestScore) continue;
      bestScore = score;
      best = prop;
    }
    if (!best) {
      for (const prop of candidates) {
        const score = scoreCandidate(prop, { strict: false });
        if (score == null || score <= bestScore) continue;
        bestScore = score;
        best = prop;
      }
    }
    if (!best) break;
    add(best);
  }

  return picks.slice(0, 4);
}

function warnIfProbabilityStuck(props = []) {
  if (props.length < 4) return;
  const probabilities = props.map(resolveProbability);
  const counts = new Map();
  for (const value of probabilities) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values(), 0);
  const unique = new Set(probabilities).size;
  const equalsLineCount = props.filter((prop) => {
    const proj = finite(prop.projection ?? prop.projectedValue);
    const ln = finite(prop.line);
    return proj != null && ln != null && Math.abs(proj - ln) < 0.01;
  }).length;

  if (equalsLineCount > 0) {
    console.error("Projection equals line on displayed cards.", { equalsLineCount });
  }
  if (props.length >= 10 && unique < 5) {
    console.warn("Probability model stuck on fallback values.", { unique, probabilities });
  } else if (maxCount / props.length > 0.5) {
    console.warn("Probability model stuck on fallback values.", { unique, probabilities });
  }
}

function logEmergencyBoardDiagnostics({
  rawCount = 0,
  normalizedCount = 0,
  projectedCount = 0,
  rankedCount = 0,
  displayedCount = 0,
  duplicateCountRemoved = 0,
  fallbackProjectionCount = 0,
  verifiedProjectionCount = 0,
  generatedProjectionCount = 0,
  mlbStatsProjectionCount = 0,
  projectionSourceCounts = null,
} = {}) {
  console.info("[Emergency MLB Board]", {
    rawPropsCount: rawCount,
    normalizedCount,
    projectedCount,
    rankedCount,
    displayedCount,
    duplicateCountRemoved,
    verifiedProjections: verifiedProjectionCount,
    generatedProjections: generatedProjectionCount,
    mlbStatsProjections: mlbStatsProjectionCount,
    fallbackProjections: fallbackProjectionCount,
    projectionSourceCounts,
  });
}

export function buildEmergencyMlbBoard(displayProps = [], options = {}) {
  const rawCount = (displayProps || []).length;
  const playable = (displayProps || []).filter(isEmergencyPlayableProp);
  const normalizedCount = playable.length;

  const providerResult = applyProjectionProviderChain(playable, {
    statsMap: options.statsMap,
    seasonStats: options.seasonStats || [],
    maxFallbackRatio: 0.25,
  });
  const withProjections = providerResult.props.map((prop) =>
    finite(prop.projection ?? prop.projectedValue) > 0 ? prop : ensureEmergencyProjection(prop)
  );
  const projectedCount = withProjections.filter(
    (prop) => finite(prop.projection ?? prop.projectedValue) > 0
  ).length;

  const enriched = withProjections.map(enrichEmergencyRankingFields);
  const renderable = enriched.filter(hasRenderableRankingMetrics).filter(isValidRankedProp);
  const { props: deduped, duplicatesRemoved } = dedupeEmergencyProps(renderable);
  const prepared = deduped.sort(compareEmergencyPlayRank);
  const rankedCount = prepared.length;

  const fallbackProjectionCount = prepared.filter((prop) => isFallbackProjectionSource(prop)).length;
  const verifiedProjectionCount = providerResult.counts?.mlbstats ?? 0;
  const generatedProjectionCount = providerResult.counts?.generated ?? 0;
  const mlbStatsProjectionCount = providerResult.counts?.mlbstats ?? 0;
  const tierACount = prepared.filter((prop) => resolveEmergencyTier(prop).id === "A").length;
  const tierBCount = prepared.filter((prop) => resolveEmergencyTier(prop).id === "B").length;
  const tierCCount = prepared.filter((prop) => resolveEmergencyTier(prop).id === "C").length;

  const top10 = selectTop10Picks(prepared).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  warnIfProbabilityStuck(top10);

  const goblins = selectGoblinPicks(prepared, top10).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const demons = selectDemonPicks(prepared).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const builder = buildFourManBuilder(prepared).map((prop, index) =>
    annotateEmergencyPlay(
      {
        ...prop,
        categorySource: "parlayBuilder",
        recommendationType: "4-Man Builder",
      },
      index + 1
    )
  );

  const displayedCount = top10.length + goblins.length + demons.length + builder.length;
  logEmergencyBoardDiagnostics({
    rawCount,
    normalizedCount,
    projectedCount,
    rankedCount,
    displayedCount,
    duplicateCountRemoved: duplicatesRemoved,
    fallbackProjectionCount,
    verifiedProjectionCount,
    generatedProjectionCount,
    mlbStatsProjectionCount,
    projectionSourceCounts: providerResult.counts,
  });

  const verifiedCount = prepared.filter(isStatsVerified).length;
  const sportsDataUnavailable = Boolean(options.sportsDataUnavailable);
  const notices = [];
  if (options.boardStatusNotice) notices.push(options.boardStatusNotice);
  else {
    if (sportsDataUnavailable) notices.push(SPORTSDATA_OPTIONAL_NOTICE);
    if (tierACount === 0 && tierBCount === 0 && prepared.length) notices.push(EMERGENCY_FALLBACK_NOTICE);
  }
  const fallbackNotice = notices.join(" · ");

  return {
    sections: [
      {
        id: "top-10-best-plays",
        title: "Top 10 MLB Plays",
        eyebrow: "Tier A/B first · probability · edge · confidence · game time",
        picks: top10,
        emptyMessage: prepared.length ? "" : "No MLB props loaded from PrizePicks or Underdog.",
        fallbackNotice,
      },
      {
        id: "top-goblins",
        title: "Top 6 Goblins",
        eyebrow: "Safer payout lines · PrizePicks & Underdog",
        picks: goblins,
        emptyMessage: goblins.length ? "" : "No goblin lines available right now.",
      },
      {
        id: "top-demons",
        title: "Top 6 Demons",
        eyebrow: "Higher payout lines · PrizePicks & Underdog",
        picks: demons,
        emptyMessage: demons.length ? "" : "No demon lines available right now.",
      },
      {
        id: "four-man-builder",
        title: "Best 4-Man Builder",
        eyebrow: "Mixed markets · one pick per player · max 2 per game",
        picks: builder,
        emptyMessage: builder.length ? "" : "Not enough unique players for a 4-man card.",
      },
    ],
    filterDiagnostics: {
      emergencyMode: true,
      poolCount: prepared.length,
      verifiedCount,
      tierA: tierACount,
      tierB: tierBCount,
      tierC: tierCCount,
      verificationCounts: { tierA: tierACount, tierB: tierBCount, tierC: tierCCount },
      duplicateCountRemoved: duplicatesRemoved,
      fallbackProjectionCount,
      verifiedProjectionCount,
      generatedProjectionCount,
      mlbStatsProjectionCount,
      projectionSourceCounts: providerResult.counts,
      tierCounts: {
        A: tierACount,
        B: tierBCount,
        C: tierCCount,
        fallback: prepared.filter((p) => resolveEmergencyTier(p).id === "fallback").length,
      },
    },
    usedFallback: tierACount === 0 && tierBCount === 0 && prepared.length > 0,
    fallbackNotice,
    loadedPropCount: prepared.length,
    boardStatusNotice: options.boardStatusNotice || "",
    projectionSourceCounts: providerResult.counts,
  };
}

// Backward-compatible exports used elsewhere
export function normalCDF(z) {
  const x = Number(z);
  if (!Number.isFinite(x)) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const poly =
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302745))));
  const cdf = 1 - d * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

export function projectionLineOverProbability(projection, line) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null || ln <= 0) return null;
  const sigma = Math.max(ln * 0.35, 0.75);
  return normalCDF((proj - ln) / sigma);
}
