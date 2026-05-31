import { getReadyToBetRejectReason, isPositiveEdge } from "./pickScoring.js";
import { getMarketReadyThreshold, NEAR_MISS_CONFIDENCE_GAP } from "./marketThresholds.js";
import { meetsVolatilityTierRequirements, getPropVolatilityTier } from "./marketConfidenceModels.js";
import { isVerifiedSportsbookProp } from "../utils/propValidation.js";

const CATEGORY_ORDER = ["confidence", "edge", "volatility", "verification", "dataQuality", "market", "timing", "other"];

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function primaryCategory(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (/confidence|conf /.test(text)) return "confidence";
  if (/edge|projection/.test(text)) return "edge";
  if (/volatil|agreement|tier/.test(text)) return "volatility";
  if (/verified|stats|research-only|line-only|sparse|missing verified/.test(text)) return "verification";
  if (/data quality|dq /.test(text)) return "dataQuality";
  if (/market|unsupported|research/.test(text)) return "market";
  if (/started|live|locked|expired|status/.test(text)) return "timing";
  return "other";
}

function parseCapPenalties(capReason = "") {
  const text = String(capReason || "");
  const deductions = {
    staleData: /stale|cach/i.test(text) ? 8 : 0,
    missingProjection: /missing projection|sparse stat/i.test(text) ? 12 : 0,
    volatileMovement: /volatile|steamed/i.test(text) ? 8 : 0,
    lowSample: /low sample/i.test(text) ? 6 : 0,
    tierEdge: /tier needs stronger edge/i.test(text) ? 6 : 0,
    unverified: /unverified stats/i.test(text) ? 0 : 0,
  };
  if (/unverified stats/i.test(text)) deductions.unverified = 58 - 0;
  return deductions;
}

function buildPenaltyStack(prop = {}, capReason = "") {
  const stack = [];
  const capDeductions = parseCapPenalties(capReason);
  Object.entries(capDeductions).forEach(([key, penalty]) => {
    if (penalty > 0) {
      stack.push({
        key,
        label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
        penalty,
      });
    }
  });

  if (prop.penaltyStack?.length) {
    prop.penaltyStack.forEach((row) => {
      if (row.penalty > 0) stack.push(row);
    });
  }

  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (prop.lineMovement?.againstPick) {
    stack.push({ key: "lineMovement", label: "Line movement penalty", penalty: 6 });
  } else if (movementTag === "volatile" || movementTag === "steamed") {
    stack.push({ key: "lineMovement", label: "Line movement penalty", penalty: 4 });
  }

  const vol = finiteNumber(prop.volatility);
  if (Number.isFinite(vol) && vol >= 3.25) {
    stack.push({ key: "volatility", label: "Volatility penalty", penalty: vol >= 3.75 ? 8 : 5 });
  }

  const edge = Number(prop.edge ?? 0);
  const minEdge = getMarketReadyThreshold(prop).minEdge;
  if (edge > 0 && edge < minEdge * 0.85) {
    stack.push({ key: "weakEdge", label: "Weak edge penalty", penalty: 5 });
  }

  return stack;
}

export function analyzePropRejection(prop = {}, thresholds = null) {
  const marketThresholds = thresholds || getMarketReadyThreshold(prop);
  const finalConfidence = Number(prop.confidenceScore ?? prop.confidence ?? 0);
  const dq = Number(prop.dataQualityScore ?? 0);
  const edge = Number(prop.edge ?? 0);
  const vol = finiteNumber(prop.volatility);
  const rawTotal = finiteNumber(prop.rawTotal ?? prop.confidenceBreakdown?.rawTotal);
  const capReason = String(prop.confidenceCapReason || prop.capReason || "");
  const rejectReason = getReadyToBetRejectReason(prop, {
    minConfidence: marketThresholds.confidence,
    minDataQuality: marketThresholds.dataQuality,
    minEdge: marketThresholds.minEdge,
  });

  const categoryLosses = {
    confidence: Math.max(0, marketThresholds.confidence - finalConfidence),
    edge: edge >= marketThresholds.minEdge ? 0 : Math.max(0, marketThresholds.minEdge - Math.max(0, edge)),
    volatility: prop.meetsVolatilityRequirements === false ? Math.min(8, marketThresholds.confidence - finalConfidence) : 0,
    verification: !prop.hasVerifiedStats && !prop.manualEnriched ? 12 : 0,
    dataQuality: Math.max(0, marketThresholds.dataQuality - dq),
    market: prop.marketResearchOnly ? 10 : 0,
    timing: /started|live|locked|expired/i.test(rejectReason) ? 10 : 0,
    other: 0,
  };

  const capDeductions = parseCapPenalties(capReason);
  const penaltyStack = buildPenaltyStack(prop, capReason);
  const historicalPenalty = Number(
    prop.historicalPenalty?.penalty ?? prop.confidenceBreakdown?.historicalVolatilityPenalty ?? 0
  );
  const historicalBoost = Number(prop.historicalBoost?.boost ?? 0);

  let thresholdFailed = "";
  if (finalConfidence < marketThresholds.confidence) {
    thresholdFailed = `confidence ≥ ${marketThresholds.confidence}`;
  } else if (dq < marketThresholds.dataQuality) {
    thresholdFailed = `data quality ≥ ${marketThresholds.dataQuality}`;
  } else if (edge < marketThresholds.minEdge) {
    thresholdFailed = `edge ≥ ${marketThresholds.minEdge}`;
  } else if (prop.meetsVolatilityRequirements === false) {
    thresholdFailed = "volatility tier requirements";
  } else if (rejectReason) {
    thresholdFailed = rejectReason;
  }

  const primaryReason = rejectReason || thresholdFailed || "below acceptance threshold";
  const category = primaryCategory(primaryReason);
  const confGap = marketThresholds.confidence - finalConfidence;
  const nearMiss =
    rejectReason !== "" &&
    isPositiveEdge(prop) &&
    (prop.hasVerifiedStats || prop.manualEnriched) &&
    confGap > 0 &&
    confGap <= NEAR_MISS_CONFIDENCE_GAP;

  return {
    finalConfidence,
    primaryReason,
    primaryCategory: category,
    thresholdFailed,
    marketThresholds,
    categoryLosses,
    deductions: {
      capPenalties: capDeductions,
      volatilityDeduction: categoryLosses.volatility,
      edgeDeduction: categoryLosses.edge,
      verificationDeduction: categoryLosses.verification,
      historicalPenalty,
      historicalBoost,
      rawConfidence: rawTotal,
      confidenceLostByCategory: categoryLosses,
    },
    penaltyStack,
    softPenaltyTotal: penaltyStack.reduce((sum, row) => sum + Number(row.penalty || 0), 0),
    nearMiss,
    confidenceGap: confGap,
    volatilityTier: prop.volatilityTier || getPropVolatilityTier(prop),
    meetsVolatility: prop.meetsVolatilityRequirements ?? meetsVolatilityTierRequirements(prop, finalConfidence),
  };
}

export function summarizeRejections(analyzed = []) {
  const byCategory = {};
  const byReason = {};
  CATEGORY_ORDER.forEach((key) => {
    byCategory[key] = 0;
  });

  analyzed.forEach((row) => {
    const cat = row.primaryCategory || "other";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const reasonKey = row.primaryReason || "unknown";
    byReason[reasonKey] = (byReason[reasonKey] || 0) + 1;
  });

  const nearMissCount = analyzed.filter((row) => row.nearMiss).length;
  const acceptedCount = analyzed.filter((row) => row.accepted).length;

  return {
    total: analyzed.length,
    accepted: acceptedCount,
    rejected: analyzed.length - acceptedCount,
    nearMiss: nearMissCount,
    byCategory,
    byReason: Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([reason, count]) => ({ reason, count })),
    topCategories: CATEGORY_ORDER.map((key) => ({ category: key, count: byCategory[key] || 0 })).filter(
      (row) => row.count > 0
    ),
  };
}

export function buildRejectionAnalytics(scoredProps = [], { readyProps = [], nearProps = [] } = {}) {
  const readyIds = new Set(readyProps.map((prop) => prop.id));
  const nearIds = new Set(nearProps.map((prop) => prop.id));

  const analyzed = scoredProps.map((prop) => {
    const analytics = analyzePropRejection(prop);
    const accepted = readyIds.has(prop.id);
    return {
      id: prop.id,
      playerName: prop.playerName,
      statType: prop.statType,
      sport: prop.sport,
      platform: prop.platform,
      line: prop.line,
      edge: prop.edge,
      accepted,
      nearTier: nearIds.has(prop.id) || analytics.nearMiss,
      ...analytics,
    };
  });

  const rejectedRows = analyzed.filter((row) => !row.accepted);
  return {
    summary: summarizeRejections(analyzed),
    rejected: rejectedRows.slice(0, 120),
    nearMiss: analyzed.filter((row) => row.nearTier && !row.accepted).slice(0, 40),
    accepted: analyzed.filter((row) => row.accepted).slice(0, 40),
  };
}
