import { normalize } from "./formatters.js";
import { canonicalMarketKey } from "./marketNormalization.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { estimateModelProbability } from "../services/projectionEngine.js";
import { isUnderdogProp } from "./underdogStreakPool.js";

export const UNDERDOG_STAT_TABS = [
  { id: "all", label: "All" },
  { id: "hrr", label: "Hits + Runs + RBIs" },
  { id: "homeRuns", label: "Home Runs" },
  { id: "totalBases", label: "Total Bases" },
  { id: "fantasyScore", label: "Fantasy" },
];

function sideKey(value = "") {
  const key = normalize(value);
  if (key.includes("higher") || key.includes("over") || key.includes("more")) return "higher";
  if (key.includes("lower") || key.includes("under") || key.includes("less")) return "lower";
  return "";
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

function findSideOption(prop = {}, side = "Higher") {
  const want = sideKey(side);
  return collectStreakOptions(prop).find((option) => sideKey(option.side) === want) || null;
}

function readSideMultiplier(prop = {}, side = "Higher") {
  const option = findSideOption(prop, side);
  if (Number.isFinite(option?.multiplier) && option.multiplier > 0) return option.multiplier;

  const isHigher = sideKey(side) === "higher";
  const flat = Number(
    isHigher
      ? prop.higherMultiplier ?? prop.higher_multiplier ?? prop.higherPayout ?? prop.higher_payout
      : prop.lowerMultiplier ?? prop.lower_multiplier ?? prop.lowerPayout ?? prop.lower_payout
  );
  if (Number.isFinite(flat) && flat > 0) return flat;

  const generic = Number(prop.multiplier ?? prop.payout ?? prop.payoutMultiplier ?? prop.odds);
  if (Number.isFinite(generic) && generic > 0) {
    const propSide = sideKey(prop.side || prop.bestPick || prop.overUnder || "");
    if (propSide && propSide === sideKey(side)) return generic;
  }

  return null;
}

export function formatUnderdogMultiplier(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
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
  const edge = Number(prop.edge ?? prop.projectionEdge);
  const line = Number(prop.line);
  const confidenceScore = Number(prop.confidenceScore ?? prop.confidence);
  const dataQualityScore = Number(prop.dataQualityScore ?? prop.modelSignal?.dataQualityScore ?? 50);
  const volatility = Number(prop.volatility ?? prop.marketVolatility);

  if (Number.isFinite(edge) && edge !== 0) {
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

  const projection = Number(prop.projection ?? prop.projectedValue);
  if (Number.isFinite(projection) && Number.isFinite(line) && projection !== line) {
    const base = Number.isFinite(confidenceScore) ? confidenceScore : 58;
    return projection > line ? Math.min(85, Math.max(52, Math.round(base))) : Math.max(15, Math.min(48, 100 - Math.round(base)));
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
  };
}

export function propMatchesStatTab(prop = {}, tabId = "all") {
  if (!tabId || tabId === "all") return true;
  const key = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  return key === tabId;
}

export function filterUnderdogRowProps(props = [], { tabId = "all", sport = "MLB", limit = null } = {}) {
  const rows = (props || [])
    .filter((prop) => isUnderdogProp(prop))
    .filter((prop) => !sport || String(prop.sport || prop.league || "MLB") === sport || sport === "all")
    .filter((prop) => propMatchesStatTab(prop, tabId))
    .sort(
      (a, b) =>
        Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0) ||
        Number(b.edge ?? 0) - Number(a.edge ?? 0)
    );

  return limit != null ? rows.slice(0, limit) : rows;
}
