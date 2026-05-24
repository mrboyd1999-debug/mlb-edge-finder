/**
 * Phase 1 — Manual Prop Analyzer module facade.
 * Consolidates form validation, analyze orchestration, and ranking exports.
 */
export {
  DEFAULT_MANUAL_FORM,
  MANUAL_OFFLINE_REASON,
  MANUAL_PAYOUT_TYPES,
  MANUAL_SIDE_OPTIONS,
  MANUAL_SOURCES,
  MLB_STAT_SUGGESTIONS,
  analyzeManualProp,
  buildManualPropFromInput,
  buildOfflineManualAnalyzedProp,
  fetchManualPropProfile,
  isManualAnalyzerProp,
  normalizeManualFormInput,
  normalizeSide,
  selectManualTopPicks,
  sortManualPropsByConfidence,
  validateManualPropFields,
} from "../utils/manualPropBuilder.js";

export {
  computeDirectionalEdge,
  computeImpliedHitChance,
  getManualStatVolatility,
  manualScoringModeLabel,
  mergeManualPropScoring,
  rankManualPropScore,
  scoreManualPropInput,
  selectManualTopPicksByRank,
  sortManualPropsByRank,
} from "../utils/manualPropScoring.js";
