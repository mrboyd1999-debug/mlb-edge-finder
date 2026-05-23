import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";
import { getMlbMinEdgeForTier, getMlbQualityTier } from "../utils/mlbOnlyMode.js";

export const NEAR_MISS_CONFIDENCE_GAP = 5;
export const NEAR_MISS_DQ_GAP = 5;

const DEFAULT_READY = {
  confidence: CONFIDENCE_THRESHOLDS.READY,
  dataQuality: 45,
  minEdge: 0.5,
};

/** Dynamic ready thresholds by MLB market — strikeouts stricter, HRR/hits slightly softer. */
const MARKET_READY_THRESHOLDS = {
  strikeouts: { confidence: 60, dataQuality: 45, minEdge: 0.65 },
  outs: { confidence: 59, dataQuality: 44, minEdge: 0.6 },
  pitchesThrown: { confidence: 59, dataQuality: 44, minEdge: 0.6 },
  hrr: { confidence: 55, dataQuality: 42, minEdge: 0.5 },
  hits: { confidence: 55, dataQuality: 42, minEdge: 0.5 },
  rbis: { confidence: 55, dataQuality: 42, minEdge: 0.5 },
  runs: { confidence: 55, dataQuality: 42, minEdge: 0.5 },
  totalBases: { confidence: 56, dataQuality: 43, minEdge: 0.55 },
  hitsAllowed: { confidence: 57, dataQuality: 44, minEdge: 0.6 },
  earnedRuns: { confidence: 57, dataQuality: 44, minEdge: 0.65 },
  fantasyScore: { confidence: 56, dataQuality: 43, minEdge: 0.55 },
  singles: { confidence: 58, dataQuality: 44, minEdge: 0.75 },
  doubles: { confidence: 58, dataQuality: 44, minEdge: 0.8 },
  homeRuns: { confidence: 62, dataQuality: 46, minEdge: 1.1 },
  stolenBases: { confidence: 62, dataQuality: 46, minEdge: 1.2 },
};

export function getMarketReadyThreshold(prop = {}) {
  const key = canonicalMarketKey(prop.statType || prop.marketKey || prop.market);
  const tierMinEdge = getMlbMinEdgeForTier(prop);
  const base = MARKET_READY_THRESHOLDS[key] || DEFAULT_READY;
  return {
    confidence: base.confidence,
    dataQuality: base.dataQuality,
    minEdge: Math.max(base.minEdge, tierMinEdge),
    marketKey: key,
    qualityTier: getMlbQualityTier(prop),
  };
}

export function getStrongEdgeBypassGap(prop = {}) {
  const thresholds = getMarketReadyThreshold(prop);
  const vol = Number(prop.volatility);
  const edge = Number(prop.edge || 0);
  if (edge >= 1.5) return 5;
  if (Number.isFinite(vol) && vol <= 2.0 && edge >= 1.15) return 4;
  if (Number.isFinite(vol) && vol <= 2.5 && edge >= 1.0) return 3;
  return 2;
}
