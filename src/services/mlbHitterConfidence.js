import { canonicalMarketKey, getMarketSupportTier } from "../utils/marketNormalization.js";

/** Canonical keys for MLB batter props (not pitcher). */
export const MLB_HITTER_MARKET_KEYS = new Set([
  "singles",
  "doubles",
  "triples",
  "homeRuns",
  "stolenBases",
  "batterWalks",
  "hits",
  "runs",
  "rbis",
  "totalBases",
  "hrr",
  "fantasyScore",
]);

/** Low-frequency hitter props that stay research-tier when data is thin. */
export const MLB_HITTER_TIER2_KEYS = new Set(["triples", "batterWalks"]);

export function isMlbHitterMarket(statType = "", sport = "") {
  if (sport !== "MLB") return false;
  return MLB_HITTER_MARKET_KEYS.has(canonicalMarketKey(statType));
}

export function isMlbHitterTier2Market(statType = "", sport = "") {
  if (sport !== "MLB") return false;
  return MLB_HITTER_TIER2_KEYS.has(canonicalMarketKey(statType));
}

export function shouldRouteMlbHitterToResearch(prop = {}, profile = {}, options = {}) {
  if (!isMlbHitterMarket(prop.statType, prop.sport)) return false;
  if (prop.marketResearchOnly || prop.marketSupportTier === 2) return true;
  if (getMarketSupportTier(prop.statType, prop.sport) === 2) return true;

  const sampleSize = Number(profile?.sampleSize || prop.sampleSize || 0);
  const sparse = Boolean(profile?.sparse || profile?.fallback || prop.sparseProfile || prop.fallbackProfile);
  const lineOnly = Boolean(options.lineOnly || prop.lineOnlyData);
  const missingLogs = sampleSize < 3 && !profile?.manualEnriched;

  return sparse || lineOnly || missingLogs;
}

function leanSupportsValue(value, line, side) {
  const val = Number(value);
  const ln = Number(line);
  if (!Number.isFinite(val) || !Number.isFinite(ln)) return false;
  const pick = String(side || "").toLowerCase();
  if (pick === "more") return val > ln;
  if (pick === "less") return val < ln;
  return false;
}

function scoreSinglesMarket({ profile, line, side, formBoost, seasonBoost, matchupBoost }) {
  let form = formBoost;
  let season = seasonBoost;
  let matchup = matchupBoost;

  const avg = Number(profile.battingAverage);
  if (Number.isFinite(avg)) {
    if (side.toLowerCase() === "more" && avg >= 0.28) form += 4;
    else if (side.toLowerCase() === "more" && avg >= 0.25) form += 2;
    else if (side.toLowerCase() === "less" && avg <= 0.22) form += 3;
  }

  const recentHits = Number(profile.recentHitsAverage);
  if (leanSupportsValue(recentHits, line, side)) form += 5;
  else if (Number.isFinite(recentHits) && side.toLowerCase() === "more" && recentHits >= line * 0.85) form += 2;

  const whip = Number(profile.opponentPitcherWhip);
  if (Number.isFinite(whip)) {
    if (side.toLowerCase() === "more" && whip >= 1.35) matchup += 5;
    else if (side.toLowerCase() === "more" && whip >= 1.2) matchup += 2;
    else if (side.toLowerCase() === "less" && whip <= 1.05) matchup += 4;
  }

  return { formBoost: form, seasonBoost: season, matchupBoost: matchup };
}

function scoreDoublesMarket({ profile, line, side, formBoost, seasonBoost, matchupBoost }) {
  let form = formBoost;
  let season = seasonBoost;
  let matchup = matchupBoost;

  const gapPower = Number(profile.gapPowerRate);
  if (Number.isFinite(gapPower)) {
    if (side.toLowerCase() === "more" && gapPower >= 0.2) form += 5;
    else if (side.toLowerCase() === "more" && gapPower >= 0.12) form += 2;
  }

  const xbhRate = Number(profile.extraBaseHitRate);
  if (Number.isFinite(xbhRate)) {
    if (leanSupportsValue(xbhRate, line, side)) season += 4;
    else if (side.toLowerCase() === "more" && xbhRate >= 0.35) season += 2;
  }

  if (profile.parkFactorNote) {
    if (/hitter-friendly|offense|gap|double/i.test(String(profile.parkFactorNote))) {
      if (side.toLowerCase() === "more") matchup += 4;
    } else if (/pitcher-friendly|suppress/i.test(String(profile.parkFactorNote)) && side.toLowerCase() === "less") {
      matchup += 2;
    }
  }

  return { formBoost: form, seasonBoost: season, matchupBoost: matchup };
}

function scoreHomeRunsMarket({ profile, line, side, formBoost, seasonBoost, matchupBoost }) {
  let form = formBoost;
  let season = seasonBoost;
  let matchup = matchupBoost;

  const iso = Number(profile.isolatedPower);
  if (Number.isFinite(iso)) {
    if (side.toLowerCase() === "more" && iso >= 0.22) form += 6;
    else if (side.toLowerCase() === "more" && iso >= 0.18) form += 3;
    else if (side.toLowerCase() === "less" && iso <= 0.12) form += 3;
  }

  const barrel = Number(profile.barrelRateEstimate);
  if (Number.isFinite(barrel)) {
    if (side.toLowerCase() === "more" && barrel >= 0.1) form += 5;
    else if (side.toLowerCase() === "more" && barrel >= 0.07) form += 2;
  }

  const hrFb = Number(profile.hrPerFlyBallEstimate);
  if (Number.isFinite(hrFb)) {
    if (side.toLowerCase() === "more" && hrFb >= 0.18) season += 4;
    else if (side.toLowerCase() === "more" && hrFb >= 0.12) season += 2;
  }

  const hrAllowed = Number(profile.opponentPitcherHrAllowed);
  if (leanSupportsValue(hrAllowed, line, side)) matchup += 6;
  else if (Number.isFinite(hrAllowed) && side.toLowerCase() === "more" && hrAllowed >= line) matchup += 3;

  if (profile.parkFactorNote && /hitter-friendly|short porch|wind out|offense/i.test(String(profile.parkFactorNote))) {
    if (side.toLowerCase() === "more") matchup += 4;
  }

  return { formBoost: form, seasonBoost: season, matchupBoost: matchup };
}

function scoreStolenBasesMarket({ profile, line, side, formBoost, seasonBoost, matchupBoost, roleBoost }) {
  let form = formBoost;
  let season = seasonBoost;
  let matchup = matchupBoost;
  let role = roleBoost;

  const sprint = Number(profile.sprintSpeedProxy);
  if (Number.isFinite(sprint)) {
    if (side.toLowerCase() === "more" && sprint >= 28) role += 5;
    else if (side.toLowerCase() === "more" && sprint >= 27) role += 3;
  }

  const sbAllowed = Number(profile.opponentPitcherSbAllowed);
  if (Number.isFinite(sbAllowed)) {
    if (side.toLowerCase() === "more" && sbAllowed >= 0.8) matchup += 5;
    else if (side.toLowerCase() === "more" && sbAllowed >= 0.5) matchup += 2;
    else if (side.toLowerCase() === "less" && sbAllowed <= 0.25) matchup += 3;
  }

  const popTime = Number(profile.catcherPopTimeProxy);
  if (Number.isFinite(popTime)) {
    if (side.toLowerCase() === "more" && popTime >= 2.05) matchup += 4;
    else if (side.toLowerCase() === "less" && popTime <= 1.95) matchup += 3;
  }

  if (Number(profile.recentStolenBaseRate || 0) >= 0.15) role += 4;
  if (/speed|sb|steal/i.test(String(profile.matchupNote || profile.stolenBaseMatchupNote || ""))) matchup += 3;

  return { formBoost: form, seasonBoost: season, matchupBoost: matchup, roleBoost: role };
}

export function computeMlbHitterConfidenceAdjustments({ profile = {}, prop = {}, bestPick = "", injury = null }) {
  if (!isMlbHitterMarket(prop.statType, prop.sport)) {
    return { formBoost: 0, seasonBoost: 0, matchupBoost: 0, roleBoost: 0, injuryBoost: 0, cap: null, capReason: "" };
  }

  const line = Number(prop.line);
  const side = bestPick || prop.bestPick || "";
  let formBoost = 0;
  let seasonBoost = 0;
  let matchupBoost = 0;
  let roleBoost = 0;
  let injuryBoost = 0;
  let cap = null;
  let capReason = "";

  if (leanSupportsValue(profile.last5Average, line, side)) formBoost += 8;
  else if (Number.isFinite(profile.last5Average)) formBoost -= 3;

  if (leanSupportsValue(profile.seasonAverage, line, side)) seasonBoost += 5;

  if (Number(profile.hitStreak || 0) >= 3) formBoost += 3;
  if (Number(profile.hitStreak || 0) >= 5) formBoost += 2;

  if (profile.handednessMatchup) {
    if (/favorable|lean/i.test(String(profile.handednessMatchup))) matchupBoost += 4;
    else if (/lean vs/i.test(String(profile.handednessMatchup))) matchupBoost += 2;
  }

  if (Number.isFinite(profile.opponentAllowed) && leanSupportsValue(profile.opponentAllowed, line, side)) {
    matchupBoost += 5;
  } else if (Number.isFinite(profile.opponentRank)) {
    const rank = Number(profile.opponentRank);
    if (side.toLowerCase() === "more" && rank >= 20) matchupBoost += 3;
    if (side.toLowerCase() === "less" && rank <= 12) matchupBoost += 3;
  }

  if (profile.battingOrderNote) {
    if (/leadoff|top.?3|cleanup|heart/i.test(String(profile.battingOrderNote))) roleBoost += 3;
    else if (/regular lineup|everyday/i.test(String(profile.battingOrderNote))) roleBoost += 2;
  } else if (/Regular batter|plate appearances/i.test(String(profile.roleContext || ""))) {
    roleBoost += 2;
  }

  const key = canonicalMarketKey(prop.statType);
  const marketContext = { profile, line, side, formBoost, seasonBoost, matchupBoost, roleBoost };

  if (key === "singles") {
    Object.assign(marketContext, scoreSinglesMarket(marketContext));
  } else if (key === "doubles") {
    Object.assign(marketContext, scoreDoublesMarket(marketContext));
  } else if (key === "homeRuns") {
    Object.assign(marketContext, scoreHomeRunsMarket(marketContext));
  } else if (key === "stolenBases") {
    Object.assign(marketContext, scoreStolenBasesMarket(marketContext));
  } else if (key === "totalBases" || key === "hits" || key === "rbis" || key === "runs") {
    if (profile.parkFactorNote && /hitter-friendly|offense/i.test(String(profile.parkFactorNote))) {
      if (side.toLowerCase() === "more") marketContext.matchupBoost += 2;
    }
  }

  formBoost = marketContext.formBoost;
  seasonBoost = marketContext.seasonBoost;
  matchupBoost = marketContext.matchupBoost;
  roleBoost = marketContext.roleBoost;

  const injRisk = injury?.risk || prop.injuryRisk;
  if (injRisk === "Low") injuryBoost += 2;
  if (injRisk === "High") injuryBoost -= 8;
  if (injRisk === "Medium") injuryBoost -= 3;

  if (shouldRouteMlbHitterToResearch(prop, profile, { lineOnly: prop.lineOnlyData })) {
    cap = 55;
    capReason = "MLB hitter prop flagged for research — limited logs or line-only context.";
  } else if (isMlbHitterTier2Market(prop.statType, prop.sport)) {
    cap = 55;
    capReason = "Low-frequency MLB hitter market — research tier.";
  }

  return { formBoost, seasonBoost, matchupBoost, roleBoost, injuryBoost, cap, capReason };
}
