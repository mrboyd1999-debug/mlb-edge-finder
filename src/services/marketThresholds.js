import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { CONFIDENCE_THRESHOLDS } from "./confidenceEngine.js";
import { getMlbMinEdgeForTier, getMlbQualityTier } from "../utils/mlbOnlyMode.js";

export const NEAR_MISS_CONFIDENCE_GAP = 5;
export const NEAR_MISS_DQ_GAP = 5;

const DEFAULT_READY = {
  confidence: CONFIDENCE_THRESHOLDS.READY,
  dataQuality: 40,
  minEdge: 0.3,
};

/** Dynamic ready thresholds by MLB market — relaxed to align with VALUE/PLAYABLE/SAFE tiers. */
const MARKET_READY_THRESHOLDS = {
  strikeouts: { confidence: 58, dataQuality: 40, minEdge: 0.35 },
  outs: { confidence: 58, dataQuality: 40, minEdge: 0.4 },
  pitchesThrown: { confidence: 58, dataQuality: 40, minEdge: 0.4 },
  hrr: { confidence: 56, dataQuality: 38, minEdge: 0.3 },
  hits: { confidence: 56, dataQuality: 38, minEdge: 0.3 },
  rbis: { confidence: 56, dataQuality: 38, minEdge: 0.3 },
  runs: { confidence: 56, dataQuality: 38, minEdge: 0.3 },
  totalBases: { confidence: 56, dataQuality: 38, minEdge: 0.35 },
  hitsAllowed: { confidence: 58, dataQuality: 40, minEdge: 0.4 },
  earnedRuns: { confidence: 58, dataQuality: 40, minEdge: 0.35 },
  // Fantasy score relaxed — strong projection edge can carry it even if volatility exists.
  fantasyScore: { confidence: 58, dataQuality: 40, minEdge: 0.5 },
  singles: { confidence: 58, dataQuality: 40, minEdge: 0.5 },
  doubles: { confidence: 58, dataQuality: 40, minEdge: 0.55 },
  homeRuns: { confidence: 62, dataQuality: 42, minEdge: 0.75 },
  stolenBases: { confidence: 62, dataQuality: 42, minEdge: 0.8 },
  batterWalks: { confidence: 60, dataQuality: 40, minEdge: 0.6 },
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
