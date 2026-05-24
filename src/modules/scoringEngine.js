/**
 * Scoring engine facade — manual analyzer + live board scoring entry points.
 */
export {
  scoreManualPropInput,
  rankManualPropScore,
  sortManualPropsByRank,
  selectManualTopPicksByRank,
  computeDirectionalEdge,
  computeImpliedHitChance,
  getManualStatVolatility,
  mergeManualPropScoring,
  manualScoringModeLabel,
} from "../utils/manualPropScoring.js";

export {
  scoreConfidenceFromSignals,
  getReadyToBetRejectReason,
} from "../services/pickScoring.js";

export {
  selectTop2Picks,
} from "../utils/displayPropScoring.js";
