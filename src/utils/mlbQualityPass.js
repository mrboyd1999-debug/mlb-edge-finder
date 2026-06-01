/**
 * Phase 8 — MLB display quality: matchup intelligence, reasoning, integrity, recommendation.
 */

import { attachLineSourceFields } from "./normalizeProp.js";
import { resolveHistoricalDataPresent } from "./tierHistoricalValidation.js";
import { hasAggressiveProjectionWarning } from "./projectionSanity.js";
import { resolvePropConfidence, resolvePropProbability } from "./tierClassification.js";
import { formatNumber, formatPercent } from "./formatters.js";
import { formatPitcherLabel } from "./pitcherDisplay.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatRate(value) {
  if (value == null || value === "") return null;
  const num = finite(value);
  if (num == null) return String(value);
  if (num <= 1 && num >= 0) return formatPercent(num * 100);
  if (num <= 1) return formatPercent(num);
  return `${Math.round(num)}%`;
}

function resolvePitcherHand(pitcherRow = {}, game = {}) {
  const throws = pitcherRow.Throws || pitcherRow.PitchingHand || pitcherRow.Hand;
  if (throws) return String(throws).trim().toUpperCase().charAt(0);
  return null;
}

function resolveBallparkLabel(prop = {}, game = {}) {
  return (
    prop.ballpark ||
    prop.venue ||
    prop.stadium ||
    game.Stadium ||
    game.StadiumDetails?.Name ||
    game.Channel ||
    (game.HomeTeam ? `${game.HomeTeam} park` : null) ||
    prop.parkFactorNote ||
    null
  );
}

function resolveWeatherLabel(prop = {}, game = {}) {
  const forecast = [
    game.ForecastDescription,
    game.ForecastTempLow != null || game.ForecastTempHigh != null
      ? `${game.ForecastTempLow ?? game.ForecastTempHigh}°F`
      : null,
    game.ForecastWindSpeed != null ? `wind ${game.ForecastWindSpeed} mph` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return prop.weatherNote || forecast || prop.weatherData?.note || null;
}

function resolveBattingOrderSpot(prop = {}) {
  return (
    prop.battingOrderSpot ||
    prop.lineupSlot ||
    prop.battingOrder ||
    prop.battingOrderNote ||
    null
  );
}

/** Enrich prop with SDIO pitcher stats + matchup context for cards/modal. */
export function attachMlbMatchupIntelligence(prop = {}) {
  const game = prop.sportsDataGame || null;
  const stats = prop.opposingPitcherStats || {};
  const era = finite(stats.era ?? stats.ERA ?? prop.pitcherERA ?? prop.opponentPitcherEra);
  const whip = finite(stats.whip ?? stats.WHIP ?? prop.pitcherWHIP ?? prop.opponentPitcherWhip);
  const hand = prop.pitcherHand || resolvePitcherHand(prop.opposingPitcherSeasonRow || {}, game);
  const pitcherName =
    prop.pitcherName ||
    prop.opposingPitcherName ||
    prop.probablePitcherName ||
    prop.sportsDataProbablePitcher ||
    "";

  return {
    ...prop,
    pitcherName: pitcherName || "",
    pitcherHand: hand || prop.pitcherHand || "",
    pitcherERA: era,
    pitcherWHIP: whip,
    opposingPitcherEra: era,
    opposingPitcherWhip: whip,
    ballpark: resolveBallparkLabel(prop, game),
    venue: resolveBallparkLabel(prop, game),
    weatherNote: resolveWeatherLabel(prop, game),
    weatherLabel: resolveWeatherLabel(prop, game),
    battingOrderSpot: resolveBattingOrderSpot(prop),
    matchupIntelligence: {
      ballpark: resolveBallparkLabel(prop, game),
      weather: resolveWeatherLabel(prop, game),
      opponentStarter: pitcherName || null,
      pitcherHand: hand,
      pitcherERA: era,
      pitcherWHIP: whip,
      battingOrderSpot: resolveBattingOrderSpot(prop),
      pitcherStatus: prop.pitcherStatus || "pending",
    },
    pitcherCardLabel: formatPitcherLabel({
      ...prop,
      opposingPitcherName: pitcherName,
      pitcherStatus: prop.pitcherStatus,
    }),
  };
}

export function buildMlbReasoningRows(prop = {}) {
  const rows = [];
  const last10 = prop.last10HitRate ?? prop.recentHitRate ?? prop.hitRateSnapshot?.last10Label;
  const last20 = prop.last20HitRate ?? prop.recent20HitRate ?? prop.last20Average;
  const season = prop.seasonHitRate ?? prop.seasonAverage ?? prop.hitRateSnapshot?.seasonLabel;
  const opponentSplit =
    prop.opponentSplitLabel ||
    prop.vsOpponentHitRate ||
    prop.opponentHitRate ||
    prop.matchupSplitLabel;
  const homeAway =
    prop.homeAwaySplitLabel ||
    prop.homeSplitLabel ||
    prop.awaySplitLabel ||
    (prop.isHomeGame != null ? (prop.isHomeGame ? "Home split" : "Away split") : null);

  if (last10 != null) rows.push({ label: "Last 10 hit rate", value: formatRate(last10) });
  if (last20 != null) rows.push({ label: "Last 20 hit rate", value: formatRate(last20) });
  if (season != null) rows.push({ label: "Season average", value: formatRate(season) });
  if (opponentSplit != null) rows.push({ label: "Opponent split", value: String(opponentSplit) });
  if (homeAway != null) rows.push({ label: "Home/Away split", value: String(homeAway) });

  if (!rows.length && prop.cardDescription) {
    rows.push({ label: "Summary", value: prop.cardDescription });
  }
  return rows;
}

export function attachMlbReasoningFields(prop = {}) {
  return {
    ...prop,
    reasoningRows: buildMlbReasoningRows(prop),
  };
}

function resolveProjectionConfidenceLevel(prop = {}) {
  const level = String(prop.projectionConfidenceLevel || prop.projectionConfidence || "").toUpperCase();
  if (level === "HIGH" || level === "MEDIUM" || level === "LOW") return level;
  if (prop.projectionSanityStatus === "ok" && !hasAggressiveProjectionWarning(prop)) return "HIGH";
  if (hasAggressiveProjectionWarning(prop)) return "LOW";
  return "MEDIUM";
}

/** User-facing 0–100 integrity from historical, pitcher, lines, sample, projection confidence. */
export function computeMlbDisplayIntegrityScore(prop = {}) {
  const historical = resolveHistoricalDataPresent(prop);
  let historicalScore = 35;
  if (historical.present) historicalScore += 25;
  if (historical.last5Present) historicalScore += 10;
  if (historical.last10Present) historicalScore += 15;
  if (historical.seasonPresent) historicalScore += 15;

  let pitcherScore = 30;
  if (prop.pitcherStatus === "confirmed" && prop.pitcherName) pitcherScore = 95;
  else if (prop.pitcherStatus === "pending") pitcherScore = 55;
  else if (prop.opposingPitcherName) pitcherScore = 70;

  const withLines = attachLineSourceFields(prop);
  const providers = Array.isArray(withLines.providers) ? withLines.providers.length : 0;
  let lineScore = 45;
  if (providers >= 3) lineScore = 95;
  else if (providers === 2) lineScore = 85;
  else if (providers === 1) lineScore = 65;
  if (withLines.consensusLine != null) lineScore = Math.min(100, lineScore + 5);

  const sampleSize = finite(prop.sampleSize ?? prop.seasonGamesPlayed ?? prop.games);
  let sampleScore = 40;
  if (sampleSize != null && sampleSize >= 20) sampleScore = 90;
  else if (sampleSize != null && sampleSize >= 10) sampleScore = 75;
  else if (sampleSize != null && sampleSize >= 5) sampleScore = 60;

  const projectionLevel = resolveProjectionConfidenceLevel(prop);
  let projectionScore = 55;
  if (projectionLevel === "HIGH") projectionScore = 90;
  else if (projectionLevel === "MEDIUM") projectionScore = 72;
  if (hasAggressiveProjectionWarning(prop)) projectionScore = Math.max(40, projectionScore - 15);

  const weighted = Math.round(
    historicalScore * 0.25 +
      pitcherScore * 0.2 +
      lineScore * 0.2 +
      sampleScore * 0.15 +
      projectionScore * 0.2
  );

  return {
    mlbDisplayIntegrityScore: Math.max(0, Math.min(100, weighted)),
    mlbIntegrityBreakdown: {
      historicalCoverage: historicalScore,
      pitcherData: pitcherScore,
      lineVerification: lineScore,
      sampleSize: sampleScore,
      projectionConfidence: projectionScore,
    },
  };
}

export function attachMlbDisplayIntegrityFields(prop = {}) {
  const integrity = computeMlbDisplayIntegrityScore(prop);
  return {
    ...prop,
    ...integrity,
    displayIntegrityScore: integrity.mlbDisplayIntegrityScore,
  };
}

export function resolveRecommendationBadge(prop = {}) {
  const confidence = resolvePropConfidence(prop);
  const probability = resolvePropProbability(prop);
  const stable = !hasAggressiveProjectionWarning(prop);
  const risk = String(prop.riskLevel || "").toUpperCase();

  if (
    stable &&
    confidence != null &&
    confidence >= 75 &&
    probability != null &&
    probability >= 70 &&
    (risk === "LOW" || risk === "MEDIUM")
  ) {
    return "SAFE";
  }

  if (
    hasAggressiveProjectionWarning(prop) ||
    risk === "HIGH" ||
    (confidence != null && confidence < 62) ||
    (probability != null && probability < 58)
  ) {
    return "AGGRESSIVE";
  }

  return "STANDARD";
}

export function resolveRecommendationBadgeLabel(prop = {}) {
  const badge = resolveRecommendationBadge(prop);
  if (badge === "SAFE") return "Safe";
  if (badge === "AGGRESSIVE") return "Aggressive";
  return "Standard";
}

export function attachMlbQualityPassFields(prop = {}) {
  let next = attachMlbMatchupIntelligence(prop);
  next = attachMlbReasoningFields(next);
  next = attachMlbDisplayIntegrityFields(next);
  const recommendationBadge = resolveRecommendationBadge(next);
  return {
    ...next,
    recommendationBadge,
    recommendationBadgeLabel: resolveRecommendationBadgeLabel(next),
  };
}

export function countMlbQualityMetrics(props = []) {
  const pool = props || [];
  let tierA = 0;
  let tierB = 0;
  let tierC = 0;
  let verified = 0;
  let pitchersAttached = 0;

  for (const prop of pool) {
    const tier = String(prop.finalTier || prop.tier || "").toUpperCase();
    if (tier === "A") tierA += 1;
    else if (tier === "B") tierB += 1;
    else if (tier === "C") tierC += 1;

    const status = String(prop.verificationStatus || "").toUpperCase();
    if (status === "FULL" || status === "PARTIAL" || prop.verifiedPlay) verified += 1;

    if (
      prop.pitcherStatus === "confirmed" &&
      (prop.pitcherName || prop.opposingPitcherName)
    ) {
      pitchersAttached += 1;
    }
  }

  return {
    projectedProps: pool.filter((p) => finite(p.projection ?? p.projectedValue) > 0).length,
    verifiedProps: verified,
    tierA,
    tierB,
    tierC,
    pitchersAttached,
  };
}
