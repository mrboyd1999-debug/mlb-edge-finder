import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";
import { getMlbMinEdgeForTier, getMlbQualityTier } from "../utils/mlbOnlyMode.js";

export const NEAR_MISS_CONFIDENCE_GAP = 5;
export const NEAR_MISS_DQ_GAP = 5;

const DEFAULT_READY = {
  confidence: CONFIDENCE_THRESHOLDS.READY + 5,
  dataQuality: 48,
  minEdge: 0.5,
};

/** Dynamic ready thresholds by MLB market — stable markets slightly softer edge, volatile markets stricter. */
const MARKET_READY_THRESHOLDS = {
  strikeouts: { confidence: 65, dataQuality: 45, minEdge: 0.55 },
  outs: { confidence: 66, dataQuality: 46, minEdge: 0.6 },
  pitchesThrown: { confidence: 66, dataQuality: 46, minEdge: 0.6 },
  hrr: { confidence: 64, dataQuality: 44, minEdge: 0.5 },
  hits: { confidence: 63, dataQuality: 44, minEdge: 0.5 },
  rbis: { confidence: 63, dataQuality: 44, minEdge: 0.5 },
  runs: { confidence: 63, dataQuality: 44, minEdge: 0.5 },
  totalBases: { confidence: 64, dataQuality: 44, minEdge: 0.55 },
  hitsAllowed: { confidence: 65, dataQuality: 45, minEdge: 0.6 },
  earnedRuns: { confidence: 65, dataQuality: 44, minEdge: 0.5 },
  fantasyScore: { confidence: 68, dataQuality: 46, minEdge: 0.85 },
  singles: { confidence: 66, dataQuality: 45, minEdge: 0.75 },
  doubles: { confidence: 66, dataQuality: 45, minEdge: 0.8 },
  homeRuns: { confidence: 70, dataQuality: 48, minEdge: 1.1 },
  stolenBases: { confidence: 70, dataQuality: 48, minEdge: 1.2 },
  batterWalks: { confidence: 68, dataQuality: 46, minEdge: 0.9 },
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
  if (edge >= 1.5) return 3;
  if (Number.isFinite(vol) && vol <= 2.0 && edge >= 1.15) return 2;
  if (Number.isFinite(vol) && vol <= 2.5 && edge >= 1.0) return 2;
  return 1;
}
