import {
  canonicalMarketKey,
  getMarketSupportTier,
  isComboMarketKey,
  isResearchOnlyMarket,
} from "../utils/marketNormalization.js";
import { isTennisSportLabel } from "../utils/marketClassification.js";
import { shouldRouteMlbHitterToResearch } from "./mlbHitterConfidence.js";

const TENNIS_RESEARCH_KEYS = new Set(["totalSets", "totalTieBreaks"]);

const SPORT_CONFIDENCE_CAPS = {
  NHL: { max: 52, reason: "NHL props are research-only initially." },
  Tennis: { max: 58, reason: "Tennis novelty markets use a lower confidence ceiling." },
  "ATP Tennis": { max: 58, reason: "Tennis novelty markets use a lower confidence ceiling." },
  "WTA Tennis": { max: 58, reason: "Tennis novelty markets use a lower confidence ceiling." },
};

export function applySportMarketConfidenceCaps(prop = {}, confidenceScore = 0, profile = {}) {
  let score = Number(confidenceScore) || 0;
  let capReason = "";
  const sport = String(prop.sport || "");
  const key = canonicalMarketKey(prop.statType);
  const tier = prop.marketSupportTier ?? getMarketSupportTier(prop.statType, sport);

  if (prop.marketResearchOnly || tier === 2 || isResearchOnlyMarket(prop.statType, sport)) {
    score = Math.min(score, 55);
    capReason = capReason || "Research-only market tier.";
  }

  if (shouldRouteMlbHitterToResearch(prop, profile, { lineOnly: prop.lineOnlyData })) {
    score = Math.min(score, 55);
    capReason = capReason || "MLB hitter prop flagged for research.";
  }

  if (isTennisSportLabel(sport) && TENNIS_RESEARCH_KEYS.has(key)) {
    score = Math.min(score, 54);
    capReason = capReason || "Lower-confidence tennis market.";
  }

  if (sport === "NHL") {
    score = Math.min(score, SPORT_CONFIDENCE_CAPS.NHL.max);
    capReason = capReason || SPORT_CONFIDENCE_CAPS.NHL.reason;
  }

  const sportCap = SPORT_CONFIDENCE_CAPS[sport];
  if (sportCap && tier === 2) {
    score = Math.min(score, sportCap.max);
    capReason = capReason || sportCap.reason;
  }

  if (isComboMarketKey(key) && tier === 1 && (sport === "NBA" || sport === "WNBA")) {
    score = Math.min(score, 72);
    capReason = capReason || "Combo stat markets use moderated confidence.";
  }

  return { score: Math.round(score), capReason };
}

export function sportConfidenceAdjustments(prop = {}, profile = {}) {
  const sport = String(prop.sport || "");
  const key = canonicalMarketKey(prop.statType);
  const adjustments = { formBoost: 0, seasonBoost: 0, matchupBoost: 0, roleBoost: 0 };

  if (sport === "NHL" && key === "timeOnIce") {
    adjustments.roleBoost = profile?.projectedMinutes ? 2 : 0;
  }

  if (isTennisSportLabel(sport) && key === "breakPoints") {
    adjustments.formBoost = Number(profile?.breakPointTrend) > 0 ? 2 : 0;
  }

  if ((sport === "NBA" || sport === "WNBA") && isComboMarketKey(key)) {
    adjustments.formBoost = Number(profile?.last5Average) > Number(prop.line) ? 2 : 0;
  }

  return adjustments;
}
