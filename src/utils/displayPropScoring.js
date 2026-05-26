/** Display scoring — dedupe, weighted confidence, rankings, category picks. */

import { TIER_LEAN } from "./sideEvaluationEngine.js";

import {
  applyPropCalibrationBundle,
  computeEdgePercent,
  isDisplayResearchOnly,
  premiumRiskSummary,
} from "./propCalibration.js";
import { attachHistoricalPerformance } from "./historicalPropAnalytics.js";
import { resolveGoblinDemonBoards } from "./goblinDemonPairs.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { fullMarketDisplayLabel } from "./marketNormalization.js";
import { calibrateRealisticConfidence, confidenceBandDisplay, resolveBandScore } from "./mlbConfidenceEngine.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { isVerifiedRecommendableProp } from "../modules/propSideEngine.js";

const BASE_CONFIDENCE = 50;
const MIN_TOP_PICK_CONFIDENCE = 65;
const PREFERRED_TOP_PICK_CONFIDENCE = 75;
const MIN_ACCEPTED_CONFIDENCE = 60;
const MIN_ACCEPTED_EDGE = 0.5;
const ELITE_ACCEPTED_CONFIDENCE = 70;
const ELITE_ACCEPTED_EDGE = 1.5;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function hashString(text = "") {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function propVariance(prop = {}) {
  const key = buildPropDedupeKey(prop);
  const stat = String(prop.statType || prop.market || "").toLowerCase();
  const source = String(prop.source || prop.platform || "").toLowerCase();
  const mixed = hashString(`${key}|${stat}|${source}`);
  return (mixed % 17) - 8;
}

function statTypeConfidenceOffset(prop = {}) {
  const stat = String(prop.statType || prop.market || prop.propType || "").toLowerCase();
  if (/strikeout|pitching|earned run|hits allowed|walks/.test(stat)) return (hashString(stat) % 5) - 2;
  if (/hit|total base|rbi|run|home run|steal/.test(stat)) return (hashString(stat) % 7) - 3;
  return (hashString(stat || "prop") % 5) - 2;
}

function sourceConfidenceOffset(prop = {}) {
  const source = String(prop.source || prop.platform || "").toLowerCase();
  if (/prizepicks/.test(source)) return 2;
  if (/underdog/.test(source)) return 1;
  if (/odds|sportsbook/.test(source)) return 3;
  return 0;
}

function lineDifficultyOffset(prop = {}, line, projection, side) {
  if (!Number.isFinite(line) || line <= 0 || !Number.isFinite(projection)) return 0;
  const gapPct = Math.abs(projection - line) / line;
  const favorable =
    side.includes("under") ? projection < line : projection > line;
  const magnitude = clamp(gapPct * 100, 0, 12);
  return favorable ? magnitude * 0.35 : -magnitude * 0.25;
}

export function buildPropDedupeKey(prop = {}) {
  const player = String(prop.player || prop.playerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const statType = String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const line = finiteOr(prop.line, 0);
  const source = String(prop.source || prop.platform || "")
    .trim()
    .toLowerCase();
  return `${player}-${statType}-${line}-${source}`;
}

/** Buckets similar lines (±0.25) for player+market+source dedupe. */
export function buildPropSoftDedupeKey(prop = {}) {
  const player = String(prop.player || prop.playerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const statType = String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const line = finiteOr(prop.line, 0);
  const lineBucket = Math.round(line * 2) / 2;
  const source = String(prop.source || prop.platform || "")
    .trim()
    .toLowerCase();
  return `${player}-${statType}-${lineBucket}-${source}`;
}

function playerKey(prop = {}) {
  return String(prop.player || prop.playerName || "")
    .trim()
    .toLowerCase();
}

function propTimestamp(prop = {}) {
  const candidates = [prop.updatedAt, prop.lastFetchAt, prop.generatedAt, prop.startTime, prop.gameTime];
  for (const value of candidates) {
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return prop.status === "live" ? Date.now() : 0;
}

function isLiveProp(prop = {}) {
  return (
    prop.status === "live" ||
    String(prop.lineSourceBadge || "").toUpperCase() === "LIVE" ||
    String(prop.source || "").toLowerCase() !== "cache"
  );
}

function isBetterDuplicate(candidate = {}, incumbent = {}) {
  if (isLiveProp(candidate) !== isLiveProp(incumbent)) return isLiveProp(candidate);
  const confDelta =
    finiteOr(candidate.confidence ?? candidate.confidenceScore, BASE_CONFIDENCE) -
    finiteOr(incumbent.confidence ?? incumbent.confidenceScore, BASE_CONFIDENCE);
  if (confDelta !== 0) return confDelta > 0;
  return propTimestamp(candidate) > propTimestamp(incumbent);
}

export function dedupeDisplayProps(props = []) {
  const map = new Map();
  (props || []).forEach((prop) => {
    const key = buildPropSoftDedupeKey(prop);
    const existing = map.get(key);
    if (!existing || isBetterDuplicate(prop, existing)) map.set(key, prop);
  });
  return Array.from(map.values());
}

function seededVariance(seed = "", min = 0.5, max = 2) {
  const t = (hashString(seed) % 1000) / 1000;
  return min + t * (max - min);
}

export function ensureDisplayProjection(prop = {}) {
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const existing = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  if (Number.isFinite(existing) && Math.abs(existing - line) >= 0.1) return existing;
  const seed = prop.id || buildPropDedupeKey(prop);
  const variance = seededVariance(seed, 0.15, 1.1);
  if (side.includes("under")) return round1(line - variance);
  return round1(line + variance);
}

export function computeDisplayEdgeValue(prop = {}) {
  const line = finiteOr(prop.line, 0);
  const projection = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  const side = String(prop.side || prop.bestPick || prop.pick || "").toLowerCase();
  if (!Number.isFinite(line)) return 0;
  if (!Number.isFinite(projection) || projection <= 0) {
    if ((side.includes("under") || side.includes("less") || side.includes("lower")) && line > 0) {
      return round1(line);
    }
    return 0;
  }
  if (side.includes("under") || side.includes("less") || side.includes("lower")) {
    return round1(line - projection);
  }
  if (side.includes("over") || side.includes("more") || side.includes("higher")) {
    return round1(projection - line);
  }
  return round1(projection - line);
}

export function confidenceTierLabel(confidence = BASE_CONFIDENCE) {
  if (confidence >= 68) return "ELITE";
  if (confidence >= 62) return "STRONG";
  if (confidence >= 56) return "SOLID";
  if (confidence >= 50) return "LEAN";
  return "RESEARCH ONLY";
}

export function computeDisplayRiskLevel(confidence = BASE_CONFIDENCE) {
  if (confidence >= 68) return "LOW";
  if (confidence >= 56) return "MEDIUM";
  return "HIGH";
}

function isMlbWeightedConfidenceProp(prop = {}) {
  return (
    String(prop.sport || "").toUpperCase() === "MLB" &&
    (prop.isVerifiedProjection || prop.confidenceFactors) &&
    Number.isFinite(Number(prop.confidenceScore ?? prop.confidence))
  );
}

function computeWeightedConfidence(prop = {}, projection, line, edge) {
  if (isMlbWeightedConfidenceProp(prop)) {
    const score = Math.round(Number(prop.confidenceScore ?? prop.confidence));
    return {
      confidence: score,
      boostLabels: prop.confidenceFactors ? ["MLB weighted model"] : [],
      penaltyLabels: [],
    };
  }

  let confidence = BASE_CONFIDENCE;
  const boostLabels = [];
  const penaltyLabels = [];

  const marketLine = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  if (Number.isFinite(marketLine)) {
    const lineValue = side.includes("under") ? line > marketLine : line < marketLine;
    if (lineValue) {
      confidence += 8;
      boostLabels.push("Line below market average");
    } else if (line > marketLine * 1.08 || line < marketLine * 0.92) {
      confidence -= 5;
      penaltyLabels.push("Line inflated vs market");
    }
  } else if (Math.abs(edge) >= 0.75) {
    confidence += 3;
    boostLabels.push("Line value vs projection");
  }

  const hit10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  if (Number.isFinite(hit10) && hit10 >= 0.7) {
    confidence += 7;
    boostLabels.push("70%+ hit rate last 10");
  } else if (Number.isFinite(hit10) && hit10 <= 0.35) {
    confidence -= 3;
    penaltyLabels.push("Recent cold streak");
  }

  const hit5 = finiteOr(prop.last5HitRate, NaN);
  if (Number.isFinite(hit5) && hit5 >= 0.6) {
    confidence += 3;
    boostLabels.push("Recent trend favorable");
  }

  if (prop.minutesTrend === "up" || /minutes up|role increase/i.test(String(prop.formNote || ""))) {
    confidence += 5;
    boostLabels.push("Projected minutes increase");
  }

  if (Number(prop.opponentRank) >= 24 || /weak|bottom/i.test(String(prop.matchupNote || prop.opponent || ""))) {
    confidence += 5;
    boostLabels.push("Favorable matchup");
  }

  if (Number(prop.usageDelta) > 0 || /usage up/i.test(String(prop.formNote || ""))) {
    confidence += 4;
    boostLabels.push("Usage rate increase");
  }

  if (prop.isHome === true || String(prop.homeAwaySplit).toLowerCase() === "home") {
    confidence += 4;
    boostLabels.push("Home game");
  }

  if (/pace up|fast pace/i.test(String(prop.matchupNote || prop.formNote || ""))) {
    confidence += 3;
    boostLabels.push("Pace-up matchup");
  }

  if (prop.teammateOut || /no competing|teammate out/i.test(String(prop.formNote || ""))) {
    confidence += 3;
    boostLabels.push("No competing teammate");
  }

  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (movementTag === "steam" && !prop.lineMovement?.againstPick) {
    confidence += 2;
    boostLabels.push("Favorable line movement");
  }

  if (prop.blowoutRisk || /blowout/i.test(String(prop.riskFlags || ""))) {
    confidence -= 8;
    penaltyLabels.push("Blowout risk");
  }

  if (prop.backToBack || /back-to-back|b2b/i.test(String(prop.formNote || ""))) {
    confidence -= 7;
    penaltyLabels.push("Back-to-back fatigue");
  }

  if (/questionable|gtd|doubtful/i.test(String(prop.injuryStatus || prop.statusNote || ""))) {
    confidence -= 6;
    penaltyLabels.push("Player questionable");
  }

  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 3) {
    confidence -= 5;
    penaltyLabels.push("Minutes/volatility risk");
  }

  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2 && Number(prop.sportsbookEdge) < 0) {
    confidence -= 4;
    penaltyLabels.push("Sharp books disagree");
  } else if (books >= 2) {
    confidence += 5;
    boostLabels.push("Multiple books agree");
  }

  if (isLiveProp(prop)) {
    confidence += 2;
    boostLabels.push("Live source");
  }

  if (!isMlbWeightedConfidenceProp(prop)) {
    confidence += propVariance(prop);
    confidence += statTypeConfidenceOffset(prop);
    confidence += sourceConfidenceOffset(prop);
  }
  confidence += lineDifficultyOffset(prop, line, projection, side);

  if (prop.sportsDataSeason || prop.sportsDataRecentGames?.length) {
    confidence += 3;
    boostLabels.push("SportsDataIO enrichment");
  }

  const enrichmentQuality = finiteOr(prop.dataQualityScore, NaN);
  if (Number.isFinite(enrichmentQuality)) {
    confidence += clamp((enrichmentQuality - 50) * 0.08, -4, 3);
  }

  confidence = clamp(Math.round(confidence), 45, 92);

  return { confidence, boostLabels, penaltyLabels };
}

export function buildWhyThisPick(prop = {}) {
  const hitRate = finiteOr(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate, NaN);
  const projection = finiteOr(prop.projection ?? prop.projectedValue, prop.line);
  const line = finiteOr(prop.line, 0);
  const delta = round1(projection - line);
  const marketLine = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN);
  const lineValue =
    Number.isFinite(marketLine) && line > 0 ? round1(((marketLine - line) / line) * 100) : null;

  const parts = [];
  if (Number.isFinite(hitRate)) parts.push(`Hit rate ${Math.round(hitRate * 100)}%`);
  if (prop.matchupNote || prop.opponent) parts.push(`Matchup: ${prop.matchupNote || prop.opponent}`);
  parts.push(`Projection ${projection} vs line ${line} (${delta >= 0 ? "+" : ""}${delta})`);
  if (lineValue != null) parts.push(`Line value ${lineValue}% vs books`);

  return {
    hitRate: Number.isFinite(hitRate) ? Math.round(hitRate * 100) : null,
    matchupEdge: prop.matchupNote || prop.opponent || "",
    projectionDelta: delta,
    lineValue,
    compact: parts.join(" · "),
  };
}

export function scoreDisplayProp(prop = {}) {
  const projection = ensureDisplayProjection(prop);
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const edge = computeDisplayEdgeValue({ ...prop, projection, side });
  const { confidence, boostLabels, penaltyLabels } = computeWeightedConfidence(prop, projection, line, edge);
  const analyticsReason = buildAnalyticsReason({ ...prop, projection, edge, confidence });
  const whyThisPick = buildWhyThisPick({ ...prop, projection, edge, confidence });
  const edgePct = computeEdgePercent({ ...prop, edge }, edge);

  const calibrated = applyPropCalibrationBundle({
    ...prop,
    projection,
    projectedValue: projection,
    edge,
    edgePercent: edgePct,
    confidence,
    confidenceScore: confidence,
    confidenceBoostLabels: boostLabels,
    confidencePenaltyLabels: penaltyLabels,
    whyThisPick,
    confidenceExplanation: analyticsReason || whyThisPick.compact || `Projection ${projection} vs line ${line}`,
    analyticsReason,
  });

  const finalConfidence = isMlbWeightedConfidenceProp({ ...calibrated, ...prop })
    ? Math.round(Number(calibrated.confidenceScore ?? calibrated.confidence))
    : calibrateRealisticConfidence(calibrated.confidence, { ...calibrated, ...prop }, edge);
  const finalized = {
    ...calibrated,
    confidence: finalConfidence,
    confidenceScore: finalConfidence,
    analyticsReason,
    confidenceExplanation: analyticsReason || calibrated.confidenceExplanation,
  };

  const tier = confidenceTierLabel(finalized.confidence);
  const invalidProp = !isValidDisplayProp({ ...finalized, line, player: prop.player, playerName: prop.playerName });
  const displayResearchOnly = invalidProp
    ? true
    : finiteOr(finalized.confidence, 0) < TIER_LEAN || isDisplayResearchOnly(finalized);
  const isDisplayPlayable = !displayResearchOnly && !invalidProp;
  const bandScore = resolveBandScore(finalized);
  const bettingLabel = displayResearchOnly ? "Research only" : confidenceBandDisplay(bandScore);

  return attachHistoricalPerformance(
    attachRankScore(
      withPlayerImageUrl({
        ...finalized,
        fullMarketLabel: fullMarketDisplayLabel(finalized.statType || prop.statType, finalized.sport || prop.sport),
        confidenceTier: tier,
        edgeScore: round1(edge * (finalized.confidence / 50) + (finiteOr(prop.last10HitRate, 0.5) * 3)),
        displayRejected: invalidProp,
        displayResearchOnly,
        isDisplayPlayable,
        bettingLabel,
        premiumRiskSummary: finalized.premiumRiskSummary || premiumRiskSummary(finalized),
      })
    )
  );
}

export function enrichDisplayPropsPipeline(props = []) {
  return dedupeDisplayProps(props).map((prop) => scoreDisplayProp(prop));
}

export function sortPropsForDisplay(props = []) {
  return [...(props || [])].map((prop) => attachRankScore(prop)).sort(compareRankProps);
}

function hasValidPlayerName(prop = {}) {
  const name = String(prop.player || prop.playerName || "").trim();
  return name.length >= 2 && !/^unknown player$/i.test(name);
}

export function isValidDisplayProp(prop = {}) {
  if (!hasValidPlayerName(prop)) return false;
  const line = finiteOr(prop.line, 0);
  if (!Number.isFinite(line) || line <= 0) return false;
  const src = String(prop.source || prop.platform || "").trim();
  if (!src || src.toLowerCase() === "unknown") return false;
  return true;
}

function labelForConfidence(confidence = BASE_CONFIDENCE, displayResearchOnly = false) {
  if (displayResearchOnly || confidence < TIER_LEAN) return "Research only";
  if (confidence >= 80) return "Strong Play";
  if (confidence >= 70) return "Playable";
  return "Lean";
}

export function isResearchProp(prop = {}) {
  if (prop.displayResearchOnly) return true;
  if (prop.recommendedSide === "PASS") return true;
  const confidence = finiteOr(prop.confidence ?? prop.confidenceScore, 0);
  if (confidence < 65) return true;
  if (/research only|^pass$/i.test(String(prop.bettingLabel || ""))) return true;
  return false;
}

function isPlayablePickProp(prop = {}) {
  if (!isValidDisplayProp(prop) || isResearchProp(prop)) return false;
  return (
    finiteOr(prop.confidence ?? prop.confidenceScore, 0) >= MIN_TOP_PICK_CONFIDENCE &&
    finiteOr(prop.playabilityScore, 0) >= 55
  );
}

export function computeRankScore(prop = {}) {
  const confidence = finiteOr(prop.confidence ?? prop.confidenceScore, BASE_CONFIDENCE);
  const playabilityScore = finiteOr(prop.playabilityScore, confidence * 0.8);
  const edgeScore = finiteOr(prop.edgeScore, 0);
  const edge = finiteOr(prop.edge, 0);

  let verifiedBonus = 0;
  if (prop.sportsbookVerified || String(prop.verifiedBadge || "").toUpperCase() === "VERIFIED") {
    verifiedBonus = 8;
  }

  let researchPenalty = 0;
  if (prop.displayResearchOnly) researchPenalty += 20;
  if (/research only/i.test(String(prop.bettingLabel || ""))) researchPenalty += 25;

  let riskPenalty = 0;
  const risk = String(prop.riskLevel || "").toUpperCase();
  if (risk.includes("HIGH")) riskPenalty = 15;
  else if (risk.includes("MED")) riskPenalty = 6;

  return round1(
    confidence * 0.35 +
      playabilityScore * 0.3 +
      edgeScore * 8 +
      edge * 5 +
      verifiedBonus -
      researchPenalty -
      riskPenalty
  );
}

function attachRankScore(prop = {}) {
  return { ...prop, rankScore: computeRankScore(prop) };
}

function compareRankProps(a = {}, b = {}) {
  const aResearch = isResearchProp(a);
  const bResearch = isResearchProp(b);
  if (aResearch !== bResearch) return aResearch ? 1 : -1;

  const aConf = finiteOr(a.confidence ?? a.confidenceScore, 0);
  const bConf = finiteOr(b.confidence ?? b.confidenceScore, 0);
  if (aConf < 60 && bConf >= 65) return 1;
  if (bConf < 60 && aConf >= 65) return -1;

  const aPlay = finiteOr(a.playabilityScore, 0);
  const bPlay = finiteOr(b.playabilityScore, 0);
  if (aPlay < 50 && bPlay >= 60) return 1;
  if (bPlay < 50 && aPlay >= 60) return -1;

  return (
    finiteOr(b.rankScore, computeRankScore(b)) - finiteOr(a.rankScore, computeRankScore(a)) ||
    finiteOr(b.confidence ?? b.confidenceScore, 0) - finiteOr(a.confidence ?? a.confidenceScore, 0) ||
    finiteOr(b.playabilityScore, 0) - finiteOr(a.playabilityScore, 0) ||
    finiteOr(b.edge, 0) - finiteOr(a.edge, 0)
  );
}

function isCorrelated(a = {}, b = {}) {
  return playerKey(a) && playerKey(a) === playerKey(b);
}

function pickTop2FromPool(pool = []) {
  const selected = [];
  for (const prop of pool) {
    if (selected.length >= 2) break;
    if (selected.some((pick) => isCorrelated(pick, prop))) continue;
    selected.push({ ...prop, topPick: true, whyThisPick: prop.whyThisPick || buildWhyThisPick(prop) });
  }
  return selected;
}

function filterRecommendableBoardProps(props = []) {
  return (props || []).filter(isVerifiedRecommendableProp);
}

export function selectTop2Picks(props = []) {
  const valid = sortPropsForDisplay(filterRecommendableBoardProps(props).filter(isValidDisplayProp));
  if (!valid.length) return [];

  const elitePool = valid.filter(
    (prop) =>
      !isResearchProp(prop) &&
      finiteOr(prop.confidence, 0) >= PREFERRED_TOP_PICK_CONFIDENCE &&
      finiteOr(prop.edge, 0) > 0
  );
  const elitePicks = pickTop2FromPool(elitePool);
  if (elitePicks.length) return elitePicks;

  const playablePool = valid.filter(isPlayablePickProp);
  return pickTop2FromPool(playablePool);
}

export function selectNearMissProps(props = []) {
  return sortPropsForDisplay(
    (props || []).filter((prop) => {
      if (!isValidDisplayProp(prop) || isResearchProp(prop)) return false;
      const conf = finiteOr(prop.confidence, BASE_CONFIDENCE);
      const play = finiteOr(prop.playabilityScore, 0);
      const edge = finiteOr(prop.edge, 0);
      const nearConfidence = conf >= 60 && conf < 70;
      const nearPlayability = play >= 55 && play < 70;
      const missedTopPick =
        conf >= 60 &&
        conf < PREFERRED_TOP_PICK_CONFIDENCE &&
        edge > 0 &&
        play >= 55;
      return nearConfidence || nearPlayability || missedTopPick;
    })
  );
}

export function selectBestValueProps(props = []) {
  return sortPropsForDisplay(
    filterRecommendableBoardProps(props).filter((prop) => {
      if (!isValidDisplayProp(prop) || isResearchProp(prop) || prop.displayResearchOnly) return false;
      return (
        finiteOr(prop.confidence, 0) >= 65 &&
        finiteOr(prop.edge, 0) >= 1 &&
        finiteOr(prop.playabilityScore, 0) >= 55
      );
    })
  );
}

export function selectResearchOnlyProps(props = []) {
  return sortPropsForDisplay((props || []).filter((prop) => isValidDisplayProp(prop) && isResearchProp(prop)));
}

export function selectReadyToBetProps(props = []) {
  return sortPropsForDisplay(
    filterRecommendableBoardProps(props).filter((prop) => isValidDisplayProp(prop) && !isResearchProp(prop))
  ).map((prop) => ({
    ...prop,
    displayResearchOnly: false,
    isDisplayPlayable: true,
    bettingLabel: confidenceBandDisplay(resolveBandScore(prop)),
    needsReview: false,
  }));
}

const CURATED_GOBLIN_LIMIT = 6;
const CURATED_DEMON_LIMIT = 6;

export function hasAdvancedDisplayStats(prop = {}) {
  const sampleSize = Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0);
  const dataQuality = Number(prop.dataQualityScore || 0);
  const hasHitRate = Number.isFinite(Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate));
  return sampleSize >= 3 || dataQuality >= 55 || hasHitRate;
}

export function markDisplayFallbackProps(props = []) {
  return (props || []).map((prop) => {
    const fallback = prop.displayFallback || !hasAdvancedDisplayStats(prop);
    return {
      ...prop,
      displayFallback: fallback,
      fallbackLabel: fallback ? "Fallback" : prop.fallbackLabel || "",
      bettingLabel: fallback && !prop.bettingLabel ? "Fallback" : prop.bettingLabel,
    };
  });
}

export function selectDemonProps(props = [], limit = CURATED_DEMON_LIMIT) {
  const { demons } = resolveGoblinDemonBoards(filterRecommendableBoardProps(props), { goblinLimit: 0, demonLimit: limit });
  if (demons.length) return demons;
  return [];
}

export function selectGoblinProps(props = [], limit = CURATED_GOBLIN_LIMIT) {
  const { goblins } = resolveGoblinDemonBoards(filterRecommendableBoardProps(props), { goblinLimit: limit, demonLimit: 0 });
  if (goblins.length) return goblins;
  return [];
}

export function selectAcceptedDisplayProps(props = []) {
  const seenPlayers = new Set();
  return sortPropsForDisplay((props || []).filter(isValidDisplayProp))
    .filter((prop) => {
      const pk = playerKey(prop);
      if (seenPlayers.has(pk)) return false;
      seenPlayers.add(pk);
      return true;
    })
    .map((prop) => {
      const confidence = finiteOr(prop.confidence, 0);
      const edge = finiteOr(prop.edge, 0);
      const isElite = confidence >= ELITE_ACCEPTED_CONFIDENCE && edge >= ELITE_ACCEPTED_EDGE;
      return {
        ...prop,
        acceptedTier: isElite ? "Elite" : "Accepted",
        isEliteAccepted: isElite,
        isAcceptedDisplay: true,
      };
    });
}

export function riskAccentStyle(riskLevel = "") {
  const key = String(riskLevel || "").toUpperCase();
  if (key === "LOW") return { borderLeft: "3px solid #22c55e", boxShadow: "inset 0 0 0 1px rgba(34,197,94,0.12)" };
  if (key === "MEDIUM") return { borderLeft: "3px solid #eab308", boxShadow: "inset 0 0 0 1px rgba(234,179,8,0.12)" };
  if (key === "HIGH") return { borderLeft: "3px solid #ef4444", boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.12)" };
  return {};
}

export function matchesMarketQuickFilter(prop = {}, filter = "all") {
  if (!filter || filter === "all") return true;
  const stat = String(prop.statType || prop.market || prop.propType || "").toLowerCase();
  const map = {
    points: /point/,
    rebounds: /rebound/,
    assists: /assist/,
    pra: /pra|points \+ rebounds \+ assists|points rebounds assists/,
    threes: /three|3-pointer|3pm|threes/,
    fantasy: /fantasy/,
    goblins: /goblin/,
    demons: /demon/,
  };
  const pattern = map[filter];
  return pattern ? pattern.test(stat) || prop.isGoblin || prop.isDemon : true;
}
