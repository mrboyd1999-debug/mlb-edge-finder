import { compactMarketKey, canonicalMarketKey } from "./marketNormalization.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { estimateModelProbability } from "../services/projectionEngine.js";
import { isUnderdogProp, isPrizePicksProp } from "./underdogStreakPool.js";
import { resolvePropSportLabel, isNbaUnderdogProp } from "./underdogSportDetection.js";
import { isCuratedDisplayProp } from "./propValidation.js";

/** Underdog MLB stat category keys — normalized from any spacing/casing/plus variants. */
export const UNDERDOG_CATEGORIES = {
  HITS_RUNS_RBIS: "HITS_RUNS_RBIS",
  TOTAL_BASES: "TOTAL_BASES",
  HOME_RUNS: "HOME_RUNS",
  FANTASY_POINTS: "FANTASY_POINTS",
};

export const UNDERDOG_STAT_TABS = [
  { id: "all", label: "All" },
  { id: UNDERDOG_CATEGORIES.HITS_RUNS_RBIS, label: "Hits + Runs + RBIs" },
  { id: UNDERDOG_CATEGORIES.HOME_RUNS, label: "Home Runs" },
  { id: UNDERDOG_CATEGORIES.TOTAL_BASES, label: "Total Bases" },
  { id: UNDERDOG_CATEGORIES.FANTASY_POINTS, label: "Fantasy" },
];

const MARKET_KEY_TO_CATEGORY = {
  hrr: UNDERDOG_CATEGORIES.HITS_RUNS_RBIS,
  totalbases: UNDERDOG_CATEGORIES.TOTAL_BASES,
  homeruns: UNDERDOG_CATEGORIES.HOME_RUNS,
  hr: UNDERDOG_CATEGORIES.HOME_RUNS,
  fantasyscore: UNDERDOG_CATEGORIES.FANTASY_POINTS,
};

const CATEGORY_PATTERNS = [
  { category: UNDERDOG_CATEGORIES.HITS_RUNS_RBIS, pattern: /hits?\s*(\+|and)?\s*runs?\s*(\+|and)?\s*rbis?|hrr\b/i },
  { category: UNDERDOG_CATEGORIES.TOTAL_BASES, pattern: /total\s*bases?|\btb\b/i },
  { category: UNDERDOG_CATEGORIES.HOME_RUNS, pattern: /home\s*runs?|\bhr\b/i },
  { category: UNDERDOG_CATEGORIES.FANTASY_POINTS, pattern: /fantasy(?:\s*score|\s*points)?/i },
];

function sideKey(value = "") {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key.includes("higher") || key.includes("over") || key.includes("more")) return "higher";
  if (key.includes("lower") || key.includes("under") || key.includes("less")) return "lower";
  return "";
}

/** Normalize stat text to Underdog category — spaces, plus signs, casing ignored. */
export function resolveUnderdogCategory(prop = {}) {
  if (prop.underdogCategory) return prop.underdogCategory;

  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  if (!statType) return "";

  const compact = compactMarketKey(statType);
  if (MARKET_KEY_TO_CATEGORY[compact]) return MARKET_KEY_TO_CATEGORY[compact];

  const canonical = canonicalMarketKey(statType);
  if (MARKET_KEY_TO_CATEGORY[compactMarketKey(canonical)]) {
    return MARKET_KEY_TO_CATEGORY[compactMarketKey(canonical)];
  }
  if (canonical === "hrr") return UNDERDOG_CATEGORIES.HITS_RUNS_RBIS;
  if (canonical === "totalBases") return UNDERDOG_CATEGORIES.TOTAL_BASES;
  if (canonical === "homeRuns") return UNDERDOG_CATEGORIES.HOME_RUNS;
  if (canonical === "fantasyScore") return UNDERDOG_CATEGORIES.FANTASY_POINTS;

  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(statType)) return category;
  }

  if (compact.includes("hitsrunsrbis") || compact.includes("hitsrunsandrbis")) {
    return UNDERDOG_CATEGORIES.HITS_RUNS_RBIS;
  }
  if (compact.includes("totalbases")) return UNDERDOG_CATEGORIES.TOTAL_BASES;
  if (compact.includes("homerun") || compact === "hr") return UNDERDOG_CATEGORIES.HOME_RUNS;
  if (compact.includes("fantasy")) return UNDERDOG_CATEGORIES.FANTASY_POINTS;

  return "";
}

export function propMatchesStatTab(prop = {}, tabId = "all") {
  if (!tabId || tabId === "all") return true;
  return resolveUnderdogCategory(prop) === tabId;
}

export function isMlbUnderdogStreakRow(prop = {}) {
  return (
    isUnderdogProp(prop) &&
    !isPrizePicksProp(prop) &&
    resolvePropSportLabel(prop) === "MLB" &&
    !isNbaUnderdogProp(prop) &&
    isCuratedDisplayProp(prop)
  );
}

export function filterUnderdogRowProps(props = [], { tabId = "all", sport = "MLB", limit = null } = {}) {
  const rows = (props || [])
    .filter((prop) => isMlbUnderdogStreakRow(prop))
    .filter((prop) => !sport || sport === "all" || resolvePropSportLabel(prop) === sport)
    .filter((prop) => propMatchesStatTab(prop, tabId))
    .sort(
      (a, b) =>
        Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0) ||
        Number(b.edge ?? 0) - Number(a.edge ?? 0)
    );

  return limit != null ? rows.slice(0, limit) : rows;
}

function collectStreakOptions(prop = {}) {
  if (Array.isArray(prop.streakOptions) && prop.streakOptions.length) return prop.streakOptions;

  const raw = prop.raw || {};
  const attrs = raw.attributes || raw.over_under || raw;
  const options = raw.options || raw.choices || attrs.options || attrs.choices || [];
  if (!Array.isArray(options) || !options.length) return [];

  return options.map((option) => ({
    side: option.choice_display || option.choice || option.side || "",
    multiplier: Number(
      option.payout_multiplier ??
        option.multiplier ??
        option.boosted_multiplier ??
        option.payoutMultiplier ??
        option.payout
    ),
    rawProbability: Number(option.raw_probability ?? option.rawProbability),
  }));
}

function isValidPayoutMultiplier(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 && num !== 1;
}

function findSideOption(prop = {}, side = "Higher") {
  const want = sideKey(side);
  return collectStreakOptions(prop).find((option) => sideKey(option.side) === want) || null;
}

function readSideMultiplier(prop = {}, side = "Higher") {
  const option = findSideOption(prop, side);
  if (isValidPayoutMultiplier(option?.multiplier)) return option.multiplier;

  const isHigher = sideKey(side) === "higher";
  const flat = Number(
    isHigher
      ? prop.higherMultiplier ?? prop.higher_multiplier ?? prop.higherPayout ?? prop.higher_payout
      : prop.lowerMultiplier ?? prop.lower_multiplier ?? prop.lowerPayout ?? prop.lower_payout
  );
  if (Number.isFinite(flat) && flat > 0 && flat !== 1) return flat;

  const generic = Number(prop.multiplier ?? prop.payout ?? prop.payoutMultiplier ?? prop.odds);
  if (Number.isFinite(generic) && generic > 0 && generic !== 1) {
    const propSide = sideKey(prop.side || prop.bestPick || prop.overUnder || "");
    if (propSide && propSide === sideKey(side)) return generic;
  }

  return null;
}

export function formatUnderdogMultiplier(value) {
  if (!isValidPayoutMultiplier(value)) return "—";
  return `${Number(value).toFixed(2)}x`;
}

export function formatGameTimeShort(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .toLowerCase()
    .replace(/\s/g, "");
}

export function shortPlayerName(name = "") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Unknown";
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export function formatUnderdogMatchup(prop = {}) {
  const direct = String(prop.matchup || "").trim();
  if (direct) return direct.replace(/\s+vs\.?\s+/i, " @ ");
  const team = String(prop.team || "").trim();
  const opponent = String(prop.opponent || "").trim().replace(/^vs\.?\s+/i, "");
  if (team && opponent) return `${team} @ ${opponent}`;
  return team || opponent || "—";
}

function modelHigherProbability(prop = {}) {
  const projection = Number(prop.projection ?? prop.projectedValue);
  const line = Number(prop.line);
  if (!Number.isFinite(projection) || projection <= 0 || !Number.isFinite(line)) {
    return null;
  }

  const edge = projection - line;
  const confidenceScore = Number(prop.confidenceScore ?? prop.confidence);
  const dataQualityScore = Number(prop.dataQualityScore ?? prop.modelSignal?.dataQualityScore ?? 50);
  const volatility = Number(prop.volatility ?? prop.marketVolatility);

  if (edge !== 0) {
    const modelProb = estimateModelProbability({
      edge: Math.abs(edge),
      line,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 55,
      dataQualityScore,
      volatility,
    });
    if (Number.isFinite(modelProb)) {
      return edge > 0 ? Math.round(modelProb * 100) : Math.round((1 - modelProb) * 100);
    }
  }

  if (Number.isFinite(confidenceScore) && confidenceScore !== 50) {
    const side = resolvePickSide(prop);
    if (side === "OVER") return Math.min(85, Math.max(52, Math.round(confidenceScore)));
    if (side === "UNDER") return Math.max(15, Math.min(48, 100 - Math.round(confidenceScore)));
  }

  return null;
}

export function resolveUnderdogSideProbabilities(prop = {}) {
  const higherOpt = findSideOption(prop, "Higher");
  const lowerOpt = findSideOption(prop, "Lower");

  if (Number.isFinite(higherOpt?.rawProbability) && Number.isFinite(lowerOpt?.rawProbability)) {
    const total = higherOpt.rawProbability + lowerOpt.rawProbability;
    if (total > 0) {
      const higherProb = Math.round((higherOpt.rawProbability / total) * 100);
      return { higherProb, lowerProb: 100 - higherProb, hasModel: true };
    }
  }

  if (Number.isFinite(higherOpt?.rawProbability) && !Number.isFinite(lowerOpt?.rawProbability)) {
    const higherProb = Math.round(higherOpt.rawProbability * 100);
    if (higherProb > 0 && higherProb < 100) {
      return { higherProb, lowerProb: 100 - higherProb, hasModel: true };
    }
  }

  const higherProb = modelHigherProbability(prop);
  if (higherProb == null) {
    return { higherProb: null, lowerProb: null, hasModel: false };
  }

  const clamped = Math.max(1, Math.min(99, higherProb));
  return { higherProb: clamped, lowerProb: 100 - clamped, hasModel: true };
}

export function resolveRecommendedUnderdogSide(prop = {}) {
  const side = resolvePickSide(prop);
  if (side === "OVER") return "Higher";
  if (side === "UNDER") return "Lower";
  const { higherProb } = resolveUnderdogSideProbabilities(prop);
  if (higherProb != null && higherProb !== 50) return higherProb >= 50 ? "Higher" : "Lower";
  return null;
}

export function buildUnderdogRowViewModel(prop = {}) {
  const { higherProb, lowerProb, hasModel } = resolveUnderdogSideProbabilities(prop);
  const recommendedSide = resolveRecommendedUnderdogSide(prop);

  return {
    playerName: shortPlayerName(prop.playerName || prop.player),
    fullName: prop.playerName || prop.player || "Unknown",
    line: prop.line,
    matchup: formatUnderdogMatchup(prop),
    gameTime: formatGameTimeShort(prop.startTime || prop.gameTime),
    higherMultiplier: readSideMultiplier(prop, "Higher"),
    lowerMultiplier: readSideMultiplier(prop, "Lower"),
    higherProb,
    lowerProb,
    hasModel,
    recommendedSide,
    statType: prop.statType || prop.market || prop.propType || "",
    category: resolveUnderdogCategory(prop),
  };
}
