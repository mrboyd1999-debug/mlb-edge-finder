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

export const EMERGENCY_FALLBACK_NOTICE =
  "Fallback mode: showing highest projected MLB props because verification data is missing.";

export const EMERGENCY_TIER_ELITE = { id: "elite", min: 74, label: "Elite" };
export const EMERGENCY_TIER_STRONG = { id: "strong", min: 64, label: "Strong" };
export const EMERGENCY_TIER_LEAN = { id: "lean", min: 55, label: "Lean" };
export const EMERGENCY_TIER_FALLBACK = { id: "fallback", min: 0, label: "Fallback" };

const BASELINE_IMPLIED = 50;
const MIN_CONFIDENCE = 25;
const MAX_CONFIDENCE = 90;

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

function hasVerifiedProjection(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  if (projection == null || projection <= 0) return false;
  return normalizeProjectionSourceBucket(prop.projectionSource, prop) === "sportsdataio";
}

function isFallbackProjectionSource(prop = {}) {
  return normalizeProjectionSourceBucket(prop.projectionSource, prop) === "fallback";
}

function isStatsVerified(prop = {}) {
  return Boolean(
    prop.hasVerifiedStats ||
      prop.verificationStatus === "FULL" ||
      prop.dataStatus === "FULL_MLB_DATA" ||
      hasVerifiedProjection(prop)
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
  if (proj == null || ln == null) return "OVER";
  if (proj > ln) return "OVER";
  if (proj < ln) return "UNDER";
  return "OVER";
}

function resolveDiffStrength(projection, line) {
  const diff = projection - line;
  const absDiff = Math.abs(diff);
  const relative = line > 0 ? absDiff / line : absDiff;
  if (relative < 0.05) return 2 + relative * 80;
  if (relative < 0.12) return 7 + (relative - 0.05) * 85;
  if (relative < 0.22) return 14 + (relative - 0.12) * 60;
  return 21 + Math.min(Math.max(relative - 0.22, 0), 0.2) * 35;
}

/** Probability from projection-line gap — never hardcoded. */
export function calculateDiffProbability(projection, line, recommendedSide = "OVER", { verified = false } = {}) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null || ln <= 0) return 50;

  const diff = proj - ln;
  const strength = resolveDiffStrength(proj, ln);
  let probability = 50;

  if (recommendedSide === "UNDER") {
    probability = diff < 0 ? 50 + strength : 50;
  } else {
    probability = diff > 0 ? 50 + strength : 50;
  }

  if (!verified) probability = clamp(probability, 51, 79);
  else probability = clamp(probability, 45, 92);
  return Math.round(probability);
}

export function calculateEmergencyConfidence(prop = {}, { hasProjection = false, isVerified = false } = {}) {
  let score = 0;
  const provider = normalizeSource(prop);
  if (provider === "prizepicks" || provider === "underdog") score += 20;
  if (hasProjection) score += 25;
  if (resolveMarket(prop)) score += 20;
  if (String(prop.playerName || prop.player || "").trim() && String(prop.team || prop.playerTeam || "").trim()) {
    score += 10;
  }
  if (String(prop.opponent || prop.opponentTeam || "").trim()) score += 5;
  if (String(prop.gameTime || prop.startTime || prop.eventTime || "").trim()) score += 5;
  if (isVerified || prop.hasVerifiedStats || prop.verificationStatus === "FULL") score += 20;

  const projectionBucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
  if (projectionBucket === "sportsdataio") score += 12;
  else if (projectionBucket === "mlbstats") score += 8;
  else if (projectionBucket === "generated") score += 5;
  else if (projectionBucket === "fallback") score -= 8;

  return Math.round(clamp(score, MIN_CONFIDENCE, MAX_CONFIDENCE));
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
  const line = finite(prop.line);
  const recommendedSide =
    prop.recommendedSide ||
    resolveRecommendedSideFromProjection(projection, line);
  const isVerified = isStatsVerified(prop);
  const useVerifiedProbability =
    isVerified &&
    finite(prop.verifiedProbability ?? prop.finalProbability ?? prop.probabilityScore) != null;

  let probability = useVerifiedProbability
    ? Math.round(
        finite(prop.verifiedProbability ?? prop.finalProbability ?? prop.probabilityScore)
      )
    : calculateDiffProbability(projection, line, recommendedSide, { verified: isVerified });

  const edgePercent = probability - BASELINE_IMPLIED;
  const confidence = calculateEmergencyConfidence(prop, {
    hasProjection: projection != null && projection > 0,
    isVerified,
  });
  const tier = resolveEmergencyTier({ probability, confidenceScore: confidence });

  return {
    id: prop.id || `${provider}|${prop.playerName || prop.player}|${market}|${line}`,
    provider,
    playerName: String(prop.playerName || prop.player || "").trim(),
    team: prop.team || prop.playerTeam || "",
    opponent: prop.opponent || prop.opponentTeam || "",
    gameTime: prop.gameTime || prop.startTime || prop.eventTime || "",
    market,
    line,
    side: recommendedSide === "UNDER" ? "Lower" : "Higher",
    projection,
    recommendedSide: recommendedSide === "UNDER" ? "UNDER" : "OVER",
    probability,
    edge: edgePercent / 100,
    edgePercent,
    confidence,
    isVerified,
    tier: tier.id,
    reason:
      prop.analyticsReason ||
      prop.premiumWhySummary ||
      `Projected ${projection} vs line ${line} · ${recommendedSide === "UNDER" ? "Lower" : "Higher"}`,
  };
}

export function enrichEmergencyRankingFields(prop = {}) {
  let projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  const projectionBucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
  const usedFallbackProjection = isFallbackProjectionSource(prop);

  if ((projection == null || projection <= 0) && projectionBucket !== "generated") {
    projection = buildMarketFallbackProjection(prop);
  }

  if (projection == null || projection <= 0 || line == null || line <= 0) {
    return { ...prop, isEmergencyPlay: true };
  }

  const recommendedSide = resolveRecommendedSideFromProjection(projection, line);
  const isVerified = isStatsVerified(prop) || projectionBucket === "sportsdataio";
  const normalized = normalizeEmergencyProp({
    ...prop,
    projection,
    projectedValue: projection,
    recommendedSide,
    isFallbackProjection: usedFallbackProjection,
    isNormalizedFallbackProjection: usedFallbackProjection,
    projectionSource: prop.projectionSource || projectionBucket,
    projectionStatus: prop.projectionStatus || projectionBucket,
  });

  const sourceLabel = formatProjectionSourceLabel(normalized.projectionSource || projectionBucket, prop);

  return {
    ...prop,
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
    emergencyTierLabel: resolveEmergencyTier({
      probability: normalized.probability,
      confidenceScore: normalized.confidence,
    }).label,
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
  if (probability >= EMERGENCY_TIER_ELITE.min && confidence >= 60) return EMERGENCY_TIER_ELITE;
  if (probability >= EMERGENCY_TIER_STRONG.min && confidence >= 45) return EMERGENCY_TIER_STRONG;
  if (probability >= EMERGENCY_TIER_LEAN.min) return EMERGENCY_TIER_LEAN;
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
  const line = Number(prop.line);
  return `${player}|${market}|${line}`;
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
  return Boolean(
    String(prop.playerName || prop.player || "").trim() &&
      resolveMarket(prop) &&
      finite(prop.line) > 0 &&
      finite(prop.projection ?? prop.projectedValue) > 0 &&
      prop.recommendedSide &&
      finite(prop.probability ?? prop.probabilityScore) != null
  );
}

function selectGoblinPicks(pool = []) {
  const payout = pool.filter(isGoblinProp).sort(compareEmergencyPlayRank);
  if (payout.length >= 6) return payout.slice(0, 6);
  const fallback = pool
    .filter((prop) => resolveProbability(prop) >= 65 && resolveConfidence(prop) >= 45)
    .sort(compareEmergencyPlayRank);
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

function selectDemonPicks(pool = []) {
  const payout = pool.filter(isDemonProp).sort(compareEmergencyPlayRank);
  if (payout.length >= 6) return payout.slice(0, 6);
  const fallback = pool
    .filter((prop) => resolveEdge(prop) >= 18 && resolveProbability(prop) >= 60)
    .sort(compareEmergencyPlayRank);
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
  const candidates = [...pool].sort(compareEmergencyPlayRank);
  const picks = [];
  const usedPlayers = new Set();
  const gameCounts = new Map();
  const marketCounts = new Map();

  function add(prop) {
    picks.push(prop);
    usedPlayers.add(buildPlayerKey(prop));
    const gameKey = String(prop.gameTime || prop.matchup || prop.team || "unknown").toLowerCase();
    gameCounts.set(gameKey, (gameCounts.get(gameKey) || 0) + 1);
    const market = resolveMarketKey(prop);
    marketCounts.set(market, (marketCounts.get(market) || 0) + 1);
  }

  function scoreCandidate(prop, { strict = true } = {}) {
    const player = buildPlayerKey(prop);
    if (!player || usedPlayers.has(player)) return null;
    const gameKey = String(prop.gameTime || prop.matchup || prop.team || "unknown").toLowerCase();
    if (strict && (gameCounts.get(gameKey) || 0) >= 2) return null;
    const market = resolveMarketKey(prop);
    if (strict && (marketCounts.get(market) || 0) >= 2) return null;

    let score = resolveProbability(prop) * 2 + resolveConfidence(prop) + resolveEdge(prop);
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
  const counts = new Map();
  for (const prop of props) {
    const value = resolveProbability(prop);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values(), 0);
  if (maxCount / props.length > 0.5) {
    console.warn("Probability model stuck on fallback values.");
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
  const verifiedProjectionCount = providerResult.counts?.sportsdataio ?? prepared.filter(hasVerifiedProjection).length;
  const generatedProjectionCount = providerResult.counts?.generated ?? 0;
  const mlbStatsProjectionCount = providerResult.counts?.mlbstats ?? 0;

  const top10 = prepared.slice(0, 10).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  warnIfProbabilityStuck(top10);

  const goblins = selectGoblinPicks(prepared).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
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
  const fallbackNotice =
    options.boardStatusNotice ||
    (verifiedCount === 0 && prepared.length ? EMERGENCY_FALLBACK_NOTICE : "");

  return {
    sections: [
      {
        id: "top-10-best-plays",
        title: "Top 10 MLB Plays",
        eyebrow: "Verified first · probability · edge · confidence · game time",
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
      duplicateCountRemoved: duplicatesRemoved,
      fallbackProjectionCount,
      verifiedProjectionCount,
      generatedProjectionCount,
      mlbStatsProjectionCount,
      projectionSourceCounts: providerResult.counts,
      tierCounts: {
        elite: prepared.filter((p) => resolveEmergencyTier(p).id === "elite").length,
        strong: prepared.filter((p) => resolveEmergencyTier(p).id === "strong").length,
        lean: prepared.filter((p) => resolveEmergencyTier(p).id === "lean").length,
        fallback: prepared.filter((p) => resolveEmergencyTier(p).id === "fallback").length,
      },
    },
    usedFallback: verifiedCount === 0 && prepared.length > 0,
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
