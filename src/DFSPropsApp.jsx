import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPrizePicksProps, PRIZEPICKS_RATE_LIMIT_MESSAGE, PRIZEPICKS_TEMPORARY_MESSAGE, resolvePrizePicksCachedProviderResult, logPrizePicksFetchSummary } from "./services/prizepicks";
import { UNDERDOG_TEMPORARY_MESSAGE } from "./services/underdog";
import {
  fetchUnderdogProviderProps,
  applyUnderdogProviderToDebug,
  UNDERDOG_SOFT_MESSAGE,
} from "./services/providers/underdogProvider.js";
import { resolveSourceHealthState, resolveFetchHealthBadge, summarizeSourceCounts, formatProviderStatusLabel, HEALTH_STATES, EMPTY_SOURCE_MESSAGE, resolveProviderConnectionStatus, formatIngestionMetrics, CONNECTION_TIERS, countActivePropsForSource } from "./services/sourceHealth.js";
import { enrichLineMovementWithTags } from "./services/lineMovementTrust.js";
import { fetchSportsbookComparison } from "./services/sportsbookOdds";
import { fetchOddsApiDisplayProps } from "./services/oddsApiPlayerProps.js";
import { isOddsApiKeyUsable, ODDS_API_INVALID_KEY_MESSAGE, sanitizeOddsApiUiMessage } from "./services/oddsApiClient.js";
import { fetchPlayerStats, findStatProfile, statProfileKey, buildMlbStatProfileFromLogs, pickUniquePropsForStatsFetch, readCachedMlbStatsMap } from "./services/playerStats";
import { fetchPlayerSeasonStats } from "./services/sportsDataService.js";
import { playerNamesMatch } from "./utils/playerNames.js";
import { PRIZEPICKS_HTML_BANNER } from "./services/prizepicks";
import { fetchInjuryNews } from "./services/injuryNews";
import { clearApiCache, getRefreshCooldownMs, isDevEnvironment } from "./services/fetchUtil";
import {
  withBoardFetchLock,
  canAutoRefresh,
  getAutoRefreshIntervalMs,
  markAutoRefresh,
  isTabActive,
} from "./services/fetchCoordinator.js";
import {
  isBoardCacheFresh,
  resolveCacheLayer,
  formatCacheLayerLabel,
  CACHE_TTL,
  readSmartCacheIfFresh,
  writeSmartCache,
} from "./services/smartCache.js";
import {
  buildSourceHealthSnapshot,
  formatCooldownRemaining,
  formatCacheAge,
  getMaxCooldownRemainingMs,
  NO_VERIFIED_AFTER_COOLDOWN_MESSAGE,
  RATE_LIMIT_COOLDOWN_MESSAGE,
  VERIFIED_CACHE_FALLBACK_MESSAGE,
  SOURCE_IDS,
  isSourceAuthBlocked,
} from "./services/sourceRateLimit.js";
import {
  buildBoardCacheMetaFromFetch,
  buildCacheAnalytics,
  prepareVerifiedCacheBoard,
  VERIFIED_CACHE_COOLDOWN_MESSAGE,
} from "./services/verifiedCacheFallback.js";
import { normalizeGameStartTime } from "./utils/normalizeGameStartTime.js";
import { safeParseJSON } from "./utils/safeParseJSON.js";
import { inferSportFromText } from "./utils/sportMappings.js";
import { applyDetectedSport, detectPropSport, emitSportDetectionDebug } from "./utils/sportDetection.js";
import {
  buildProjectionProviderSummary,
  resetProjectionFetchDebug,
} from "./utils/projectionFetchDebug.js";
import { traceProjectionExecutionPath } from "./utils/projectionSourceTrace.js";
import { hasMlbStatIndicator } from "./utils/underdogSportDetection.js";
import {
  APP_SPORTS,
  isUnsupportedMarket,
  matchesSelectedSportFilter,
} from "./utils/marketClassification.js";
import {
  attachDebugArtifacts,
  coercePipelineAudit,
  createEmptyPipelineAudit,
  createEmptyPipelineStats,
  createEmptyValidationSummary,
  formatGroupedDebugLine,
  formatRejectionSummary,
  finalizePipelineCounters,
  sortGroupedDebugEntries,
  logPipelineAudit,
  recordFilterReason,
  safeCreateEmptyPipelineAudit,
  safeFormatRejectionSummary,
} from "./utils/propPipelineDebug.js";
import {
  applyQualificationLabels,
  buildHistoryAccuracyWeights,
  buildQualificationBoards,
  isGameNotExpired,
} from "./services/qualification.js";
import { evaluateAdaptiveQualification } from "./services/adaptiveQualification.js";
import { dataQualityBadge, dataQualityFromSignals } from "./services/dataQuality";
import {
  computeEdgeScore,
  computeRankScore,
  computeStreakConfidence,
  estimateModelProbability,
  propPayoutLabel,
} from "./services/projectionEngine";
import {
  DFS_CACHE_TTL_MS,
  clearBoardCache,
  readCachedBoard,
  readVerifiedCacheBoard,
  readHistory,
  readLineMovement,
  readParlayHistory,
  writeCachedBoard,
  writeHistory,
  writeLineMovement,
  writeParlayHistory,
  readManualStatsMap,
  writeManualStatsForProp,
  readManualAnalyzerProps,
  writeManualAnalyzerProps,
} from "./services/pickStore";
import {
  assessResearchGaps,
  buildDataCompletenessScore,
  buildLowConfidenceReasons,
  isLineOnlyData,
  filterReadyToBetProps,
  isReadyToBet,
  isEliteTopPickEligible,
  mergeManualStatsIntoProfile,
  READY_MIN_CONFIDENCE,
  READY_MIN_DATA_QUALITY,
  resolvePickEdge,
} from "./services/pickScoring.js";
import { shouldRouteMlbHitterToResearch } from "./services/mlbHitterConfidence.js";
import { CONFIDENCE_THRESHOLDS } from "./services/confidenceEngine.js";
import {
  calculateProjectionConfidence,
  enrichPropDecision,
  attachDecisionDebug,
  isTopPickEligible,
  isDemonEligible,
  isBestValueEligible,
  sortDecisionBoard,
} from "./services/decisionEngine.js";
import { enrichLineMovementRecord } from "./services/lineMovementTrust.js";
import { projectPlayerProp, resolveProjectionEdge, computeProjectionRiskLevel, buildQualificationReason, PROJECTION_CONFIDENCE_THRESHOLDS } from "./services/propProjection.js";
import {
  persistBoardOutcomes,
  buildOutcomeDashboard,
  gradeCompletedProps,
  gradeOutcome,
  pickStatus,
  scheduleOutcomeGrading,
} from "./services/outcomeTracking.js";
import {
  buildStatsMissingExplanation,
  computeStatConfidenceAdjustments,
  enrichPlayerProfile,
  hasVerifiedStats,
} from "./services/statEnrichment.js";
import { applyMlbProjectionToProp, isMlbVerifiedEngineMarket } from "./modules/mlbProjectionService.js";
import {
  DATA_UNAVAILABLE_CONFIDENCE,
  LIVE_LINE_PROJECTION_UNAVAILABLE,
} from "./modules/projectionBreakdown.js";
import { logMlbData, traceLiveBoardMlbProp, getMlbPipelineStatus, subscribeMlbPipelineStatus } from "./services/mlbDataService.js";
import { mergeDfsSourceStatusFromApiHealth, recordMlbProjectionResult, setMlbPipelineRefreshing, syncMlbStatsStatusFromAttachment } from "./services/mlbPipelineStatus.js";
import { NO_VERIFIED_GRADE_STATUS } from "./utils/manualPropScoring.js";
import {
  computeGradingDataQuality,
  computeVolatilityAdjustedEdge,
  resolveStrongPlayTag,
} from "./utils/mlbConfidenceEngine.js";
import { buildCardPipelineDebug } from "./services/mlbPropPipelineTrace.js";
import { normalizeSportsbookName } from "./services/playerMatcher.js";
import { LIVE_BOARD_LOADING_STAGES, LIVE_BOARD_UNAVAILABLE_MESSAGE } from "./utils/liveBoardLoading.js";
import { applySportMarketConfidenceCaps } from "./services/sportMarketConfidence.js";
import { attachElitePickExplanation } from "./services/pickExplanation.js";
import {
  computePreScorePriority,
  computePropPriorityScore,
  classifyPriorityTier,
  isSharpOnlyCandidate,
  sortBoardProps,
  BOARD_SORT_MODES,
} from "./services/propPriority.js";

import SectionErrorBoundary from "./components/SectionErrorBoundary.jsx";
import { normalizePropsWithSource } from "./utils/normalizeSource.js";
import { DISPLAY_LIMITS, resolveCuratedGoblinDemonBoards, resolveMlbStreakPicks, countMlbDisplayProps, countUnderdogStreakProps, isManuallySavedPick, historyPickToDisplayProp, resolveUnderdogSectionFallbacks, shouldApplyUnderdogSectionFallbacks } from "./utils/curatedPicks.js";
import { isUnderdogProp, filterUnderdogStreakPool } from "./utils/underdogStreakPool.js";
import {
  buildUnderdogDebugSnapshot,
  extractParsedUnderdogProps,
  filterUnderdogPropsForSport,
  mergeUnderdogIntoFinderPool,
  resolveUnderdogStreakEmptyMessage,
} from "./utils/underdogPickPool.js";
import { resolveTopMlbPlaySections, auditTopMlbPlayPool } from "./utils/topMlbPlays.js";
import { mergeScoredIntoDisplayProps } from "./utils/mergeScoredDisplayProps.js";
import {
  resetPipelineExecutionCounters,
  setPipelineStageCount,
  summarizeStatsMap,
  logPipelineExecutionSummary,
  buildMlbProjectionDiagnostics,
  markStatsFetchTimedOut,
  markProjectionsComplete,
  resetProjectionPipelineErrors,
  PIPELINE_STAGES,
} from "./services/mlbProjectionPipelineLog.js";
import {
  isEmergencyProjectionDiagnosticEnabled,
  runEmergencyProjectionDiagnostic,
} from "./services/mlbEmergencyProjectionDiagnostic.js";
import { logPipelineStage } from "./utils/mlbPipelineDebug.js";
import {
  mergeProviderRawProps,
  buildUnderdogParserFailureMessage,
  hasAnyProviderProps,
} from "./services/providerOrchestration.js";
import { enrichPropsWithSportsData, generateMlbPropsFromSportsData } from "./services/propSportsDataEnrichment.js";
import { mergeProjectionsOntoProps } from "./services/mlb/projectionMergePipeline.js";
import { buildLiveRenderBoard, filterPlatformProps, isFakeOrFallbackProp } from "./utils/livePropRender.js";
import { resolvePipelineProjectionStats, countPropsWithProjections, resolveEngineProjectedPool } from "./utils/projectionPipelineStatus.js";
import { buildVerificationDashboard } from "./utils/verificationDashboard.js";
import {
  beginPerformanceTimer,
  endPerformanceTimer,
  limitStartupPropPool,
  PERFORMANCE_TIMERS,
  scheduleBackgroundWork,
  STARTUP_NORMALIZED_PROP_LIMIT,
} from "./utils/startupPerformance.js";
import { persistStartupBoardSlices, readInstantStartupBoard } from "./services/startupBoardCache.js";
import {
  mergeBoardRefreshResult,
  readCacheFirstStartupBundle,
  resolveStableStatsMap,
} from "./services/pipelineStability.js";
import { buildPipelineDiagnostics, logPipelineDiagnostics } from "./utils/propPipelineDiagnostics.js";
import { PICK_TIER_RESEARCH, PICK_TIER_VERIFIED } from "./utils/conservativeProjection.js";
import { resolveIngestionFallback } from "./services/ingestionFallback.js";
import { writeLastGoodBoard, readLastGoodBoard, boardFromLastGood } from "./services/lastGoodBoardCache.js";
import { initRawResponseDebug, dumpDebugGlobals, recordProviderStatus, recordNormalizedProps } from "./utils/rawResponseDebug.js";
import { logLiveFetchResult, buildLiveFetchFailureSummary } from "./utils/liveFetchAudit.js";
import {
  buildProjectionCoverageAudit,
  logProjectionCoverageAudit,
} from "./utils/projectionCoverageAudit.js";
import {
  attachHistoricalStatsToProps,
  buildStatsAttachmentMetrics,
} from "./utils/historicalStatsLoader.js";
import {
  buildPipelinePropCountAudit,
  countVerifiedFilterProps,
  logPipelinePropCountAudit,
  buildMlbProjectionBoardPool,
  countHistoricalAttachment,
} from "./utils/pipelinePropCountAudit.js";
import { buildProviderCoverageAudit, logProviderCoverageSummary } from "./utils/providerCoverageAudit.js";
import { countMergedProjections } from "./utils/projectionCoverageAudit.js";
import {
  buildGuaranteedBaseFeedDisplay,
  ensureMlbSportOnProps,
  logPipelinePropCounts,
  mapRawToDisplayProps,
} from "./utils/baseFeedPipeline.js";
import { isSafeModeEnabled, SAFE_MODE_FALLBACK_MESSAGE, SAFE_MODE_LOADING_MESSAGE } from "./utils/safeMode.js";
import { logSafeModePipelineCounts, resolveSafeMlbBoardPicks, resolveSafeMlbStreakPicks } from "./utils/safeModePipeline.js";
import {
  ENRICHMENT_TIMEOUT_MESSAGE,
  getApiTimeoutMs,
  getLineFeedTimeoutMs,
  getMlbStatsFetchTimeoutMs,
  getSportsDataTimeoutMs,
  isAbortOrTimeoutError,
  withFetchTimeout,
} from "./utils/apiTimeout.js";
import {
  emptyPrizePicksProviderResult,
  emptySeasonStatsProviderResult,
  emptyStatsProviderResult,
  emptyUnderdogProviderResult,
  fetchProviderIsolated,
  logProviderFetchPerformance,
  skippedProviderResult,
  unwrapProviderSettled,
  PRIZEPICKS_PROVIDER_TIMEOUT_MS,
  UNDERDOG_PROVIDER_TIMEOUT_MS,
} from "./utils/providerFetch.js";
import { buildProviderEntryDiagnostics } from "./utils/providerFetchDiagnostics.js";
import {
  hasUsableProjectionSources,
  markProjectionDataUnavailable,
  PROJECTION_DATA_UNAVAILABLE_MESSAGE,
} from "./utils/projectionAvailability.js";
import { auditPropRejections, formatProviderStatusLabel as formatLiveProviderLabel } from "./utils/livePropUsability.js";
import RejectionAnalyticsPanel from "./components/RejectionAnalyticsPanel.jsx";
import QualificationAnalyticsPanel from "./components/QualificationAnalyticsPanel.jsx";
import CacheAnalyticsPanel from "./components/CacheAnalyticsPanel.jsx";
import LazyDebugDetails from "./components/LazyDebugDetails.jsx";
import PlayerPropCard from "./components/PlayerPropCard.jsx";
import PickDetailModal from "./components/PickDetailModal.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import ProviderDebugDrawer from "./components/ProviderDebugDrawer.jsx";
import { buildFeedHealthContext } from "./services/providerHealth.js";
import { getOddsApiKey, getSportsDataApiKey } from "./services/runtimeSettings.js";
import {
  isUpstreamAcceptedProp,
  resolveFinalAcceptedPropsFromHydrated,
  selectTopPicksFromAccepted,
} from "./utils/resolveAcceptedPropsForRender.js";
import { countUsableProps, normalizePropShape } from "./utils/propShape.js";
import {
  buildAllDisplayProps,
  buildDisplayDebugCounts,
  filterAllDisplayPropsBySport,
  logAllDisplayPropsSample,
  normalizeDisplayProp,
  selectBestValueFromDisplayProps,
  selectNearMissFromDisplayProps,
  selectReadyFromDisplayProps,
  selectResearchOnlyFromDisplayProps,
  selectTop2FromDisplayProps,
} from "./utils/allDisplayProps.js";
import { enrichDisplayPropsPipeline, selectAcceptedDisplayProps, selectDemonProps, selectGoblinProps, matchesMarketQuickFilter } from "./utils/displayPropScoring.js";
import { isVerifiedRecommendableProp } from "./modules/propSideEngine.js";
import {
  buildPipelineStageReport,
  buildUsablePropsPool,
  logPipelineStageReport,
  samplePropsAtStage,
} from "./utils/propPipelineStages.js";
import { styles } from "./theme/styles.js";
import {
  formatDateTime, formatLeanSide, formatMultiplier, formatNumber, formatMaybeLine,
  formatPercent, formatSignedNumber, formatSignedPercent, normalize, unique, dateKey, clamp, round, countBy,
} from "./utils/formatters.js";
import { confidenceTier, displaySport, isGoblinProp, isDemonProp } from "./utils/propLabels.js";
import { getStaleFilterReason, labelPartialIfMissingTime } from "./utils/stalePropFilter.js";
import {
  DEFAULT_PREGAME_WINDOW_HOURS,
  filterUpcomingSlate,
  getSlateFilterReason,
  isUpcomingSlateProp,
} from "./utils/slateFilter.js";
import { dataSourcesUsed } from "./utils/pickAnalysis.js";
import {
  computeStandardEdge,
  computeStandardPropMetrics,
  getScoringSportRejectReason,
  getTrustedSportFromProp,
  normalizeScoringSportLabel,
  ALLOWED_SCORING_SPORTS,
} from "./utils/standardPropMetrics.js";
import {
  getLineProviderPreflight,
  inspectPrizePicksProxyConfig,
  isPrizePicksProxyNotConfigured,
  PRIZEPICKS_NOT_CONFIGURED_DETAIL,
} from "./utils/providerProxy.js";
import { getPrizePicksDiagnostics, updatePrizePicksDiagnostics } from "./utils/prizepicksDiagnostics.js";
import { buildContextFromProp, resolveIngestionSport } from "./utils/ingestionFilter.js";
import { isParserMergeComboBug } from "./utils/comboMarkets.js";
import {
  MAX_ANALYSIS_PROPS,
  RENDER_LIMITS,
  isApprovedMarket,
} from "./utils/approvedMarkets.js";
import {
  MLB_ONLY_MODE,
  emptySourcePipelineAudit,
  filterActiveSportProps,
  getActiveFetchSport,
  getActivePriorityPropTypes,
  getActiveSportFilterOptions,
  getActiveStreakTabOptions,
  guardMlbOnlyProp,
  sanitizeBoardForMlbOnly,
  sanitizeDebugInfoForMlbOnly,
} from "./utils/mlbOnlyMode.js";
import { runFilterPipeline, runUiPipeline } from "./utils/pipelineStages.js";
import DfsAnalyzerLayout from "./components/DfsAnalyzerLayout.jsx";
import {
  analyzeManualProp,
  isManualAnalyzerProp,
  manualPropIdentityKey,
  makeManualPropId,
  normalizeManualFormInput,
} from "./utils/manualPropBuilder.js";
import { isHeavyDebugEnabled, isDebugModeEnabled, readShowDebugPanelsPreference, shouldLogVerbose, shouldTrackRejectedProps, writeShowDebugPanelsPreference } from "./utils/devMode.js";
import { canonicalStatType } from "./utils/marketNormalization.js";
import {
  filterVerifiedSportsbookProps,
  isVerifiedSportsbookProp,
  attachSportsbookVerifiedFields,
  NO_VERIFIED_PROPS_MESSAGE,
  validateAndFilterProps,
  validateProp,
} from "./utils/propValidation.js";

const HISTORY_KEY = "props-of-the-day-history";
const PARLAY_HISTORY_KEY = "dfs-pickem-parlay-history";
const LINE_MOVEMENT_KEY = "dfs-pickem-line-movement";
const PROPS_OF_DAY_LIMIT = 9;
const MAX_RANKED_PROPS = RENDER_LIMITS.readyToBet + 20;
const MAX_WATCHLIST_PROPS = 40;
const MAX_STREAK_PROPS = RENDER_LIMITS.goblins + RENDER_LIMITS.demons + 32;
const MAX_PRE_SCORE_PROPS = MAX_ANALYSIS_PROPS;
const INITIAL_VISIBLE_SECTION_LIMIT = 10;
const APP_VIEW_STORAGE_KEY = "dfs-app-view-mode";
const VISIBLE_SECTION_LIMIT = RENDER_LIMITS.readyToBet;
const HISTORY_LIMIT = 100;
const BACKUP_STREAK_LIMIT = 12;
const LADDER_STREAK_LIMIT = 12;
const AVOID_STREAK_LIMIT = 12;
const MIN_RECOMMENDED_EDGE = 0.5;
const MIN_RECOMMENDED_CONFIDENCE = 55;
const MIN_STREAK_CONFIDENCE = 65;
const MIN_GOBLIN_CONFIDENCE = 68;
const MIN_DEMON_CONFIDENCE = CONFIDENCE_THRESHOLDS.DEMON;
const MIN_START_BUFFER_MS = 60 * 1000;
const NO_EDGE_MESSAGE = "No betting edge detected. More data needed before this becomes a confident pick.";
const NEEDS_STATS_MESSAGE = "This prop needs more stats before a confident pick can be made.";
const STREAK_WARNING = "Low multiplier does not guarantee the pick will hit. Verify before adding to streak.";
const NO_ACTIVE_SCHEDULED_PROPS_MESSAGE = NO_VERIFIED_PROPS_MESSAGE;
const EMPTY_PARSED_MESSAGE = "Connected but no usable props parsed. Check API Health raw vs parsed counts.";
const PIPELINE_FALLBACK_MESSAGE = "Fallback mode: displaying usable props without advanced filtering.";
const INCLUDE_UNCERTAIN_KEY = "dfs-include-uncertain-props";
const FILTER_PREFS_KEY = "dfs-filter-prefs";
const COMPACT_MODE_KEY = "dfs-compact-mode";
const QUICK_PICKS_MODE_KEY = "dfs-quick-picks-mode";
const DEBUG_SAMPLE_LIMIT = 10;

const DEFAULT_FILTER_PREFS = {
  hideResearchOnly: false,
  hideUnsupportedMarkets: true,
  hideEsports: true,
  excludeUnsupportedMarkets: true,
  pregameWindowHours: DEFAULT_PREGAME_WINDOW_HOURS,
  boardSortMode: BOARD_SORT_MODES.priority,
  sharpOnly: false,
};

function readFilterPrefs() {
  try {
    const stored = safeParseJSON(window.localStorage.getItem(FILTER_PREFS_KEY), null);
    return { ...DEFAULT_FILTER_PREFS, ...(stored || {}) };
  } catch {
    return { ...DEFAULT_FILTER_PREFS };
  }
}

function writeFilterPrefs(prefs) {
  try {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function readCompactModePreference() {
  try {
    const stored = window.localStorage.getItem(COMPACT_MODE_KEY);
    return stored == null ? true : stored !== "false";
  } catch {
    return true;
  }
}

function writeCompactModePreference(value) {
  try {
    window.localStorage.setItem(COMPACT_MODE_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function readQuickPicksModePreference() {
  try {
    return window.localStorage.getItem(QUICK_PICKS_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeQuickPicksModePreference(value) {
  try {
    window.localStorage.setItem(QUICK_PICKS_MODE_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function yieldToMainThread() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

const DEFAULT_SOURCE_STATUS = {
  PrizePicks: "Pending",
  Underdog: "Pending",
  "The Odds API": "Pending",
};

const UNDERDOG_DEGRADED_MESSAGE = "Underdog temporarily unavailable.";
const UNDERDOG_UNAVAILABLE_MESSAGE = UNDERDOG_DEGRADED_MESSAGE;

/** Underdog failures must never become red critical UI when MLB-only + PrizePicks props are live. */
function isNonCriticalUnderdogFailure(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  return (
    /underdog/i.test(text) ||
    /provider unavailable/i.test(text) ||
    /upstream unavailable/i.test(text) ||
    /underdog unavailable/i.test(text) ||
    /underdog temporarily unavailable/i.test(text) ||
    /underdog provider returned/i.test(text) ||
    /underdog data source/i.test(text) ||
    /data source not connected/i.test(text) ||
    /not connected or unavailable/i.test(text)
  );
}

function isIndirectSourceFailureBanner(message = "") {
  return /some data sources failed/i.test(String(message || ""));
}

function prizePicksHasUsableProps(props = [], sourceStatus = {}) {
  const list = props || [];
  if (!list.length) return false;
  const ppStatus = String(sourceStatus.PrizePicks || "").toLowerCase();
  if (["cached", "full", "partial"].includes(ppStatus)) return true;
  if (MLB_ONLY_MODE) {
    return list.some((prop) => guardMlbOnlyProp(prop)) || list.length > 0;
  }
  if (ppStatus === "failed") {
    return list.some((prop) => normalize(prop.platform) === "prizepicks");
  }
  return list.some((prop) => normalize(prop.platform) === "prizepicks");
}

function shouldSuppressCriticalUiMessage(message = "", props = [], sourceStatus = {}) {
  if (!message) return false;
  if (/proxy url missing|vite_prizepicks_proxy_url|prizepicks proxy url missing|missing vite_prizepicks/i.test(message)) {
    return true;
  }
  if (String(sourceStatus?.PrizePicks || "").toLowerCase() === "not configured") return true;
  if (isPrizePicksProxyNotConfigured() && /prizepicks|could not load prizepicks/i.test(message)) return true;
  if (isNonCriticalUnderdogFailure(message)) return true;
  if (/using verified mlb cache/i.test(message)) return true;
  if (/recently verified cached mlb props/i.test(message)) return true;
  if (/live refresh paused during cooldown/i.test(message)) return true;
  if (/connected but no usable props parsed/i.test(message)) return true;
  if (/no mlb props in feed|none matched mlb|0 mlb props/.test(message)) return true;
  const hasAnyProps = Array.isArray(props) && props.length > 0;
  if (hasAnyProps && /prizepicks live fetch failed|could not load prizepicks|prizepicks temporarily unavailable/i.test(message)) {
    return true;
  }
  if (prizePicksHasUsableProps(props, sourceStatus)) {
    if (/no verified sportsbook props/i.test(message)) return true;
    if (/try again after cooldown/i.test(message)) return true;
    if (/rate limited|showing cached|prizepicks.*failed|could not load prizepicks|429/i.test(message)) return true;
  }
  if (MLB_ONLY_MODE && (prizePicksHasUsableProps(props, sourceStatus) || hasAnyProps) && isIndirectSourceFailureBanner(message)) {
    return true;
  }
  return false;
}

function filterPrizePicksFailuresWhenAlternativesExist(sourceFailures = [], { rawProps = [], oddsApiProps = [] } = {}) {
  void rawProps;
  void oddsApiProps;
  return (sourceFailures || []).filter((message) => {
    const text = String(message || "").toLowerCase();
    if (/proxy url missing|vite_prizepicks_proxy|prizepicks proxy|not configured/.test(text)) return false;
    if (isPrizePicksProxyNotConfigured() && /prizepicks|could not load prizepicks/.test(text)) return false;
    return !/prizepicks live fetch failed|could not load prizepicks lines|prizepicks temporarily unavailable/i.test(
      text
    );
  });
}

function filterCriticalUiMessages(messages = [], props = [], sourceStatus = {}) {
  return unique((messages || []).filter((message) => !shouldSuppressCriticalUiMessage(message, props, sourceStatus)));
}

function resolveUiErrorMessage(message = "", props = [], sourceStatus = {}) {
  if (!message) return "";
  return shouldSuppressCriticalUiMessage(message, props, sourceStatus) ? "" : String(message);
}

function collectBoardWarningMessages(board = {}) {
  return unique([
    ...(board.criticalWarnings || []),
    ...(board.warnings || []),
    ...(board.degradedWarnings || []),
  ]);
}

function sanitizeCriticalWarningsForDisplay(warnings = [], props = [], sourceStatus = {}) {
  return filterCriticalUiMessages(warnings, props, sourceStatus);
}

function sanitizeDegradedWarningsForDisplay(warnings = [], props = [], sourceStatus = {}) {
  if (MLB_ONLY_MODE && prizePicksHasUsableProps(props, sourceStatus)) return [];
  return filterCriticalUiMessages(warnings, props, sourceStatus);
}

function isUnderdogOnlyFailure(...messages) {
  const entries = messages.flat().filter(Boolean).map(String);
  if (!entries.length) return false;
  return entries.every((entry) => isNonCriticalUnderdogFailure(entry) || isIndirectSourceFailureBanner(entry));
}

function normalizeUnderdogStatusForMlb(status = "", fallback = "Unavailable") {
  const text = String(status || "").trim();
  if (!text || text === "Pending") return fallback;
  if (["Connected", "Full", "Cached"].includes(text)) return text;
  return "Unavailable";
}

function getErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sourceFailureMessage(label, error) {
  const detail = getErrorMessage(error);
  return detail && detail !== "Unknown error" && !detail.includes(label) ? `${label} ${detail}` : label;
}

function normalizeSourceState(status, fallback = "Failed") {
  const text = String(status || "").trim();
  if (!text || text === "Pending") return fallback;
  if (/not configured/i.test(text)) return "Not configured";
  if (text === "Connected" || text === "Full") return "Full";
  if (text === "Cached") return "Cached";
  if (text === "Empty") return "Empty";
  if (text === "Unavailable") return "Unavailable";
  if (/setup/i.test(text)) return "Fallback";
  if (/partial/i.test(text)) return "Partial";
  if (/fallback/i.test(text)) return "Fallback";
  if (/failed|not connected|unavailable/i.test(text)) return "Failed";
  return text;
}

function prizePicksSourceFallback(explicit = "") {
  if (explicit) return explicit;
  return isPrizePicksProxyNotConfigured() ? "Not configured" : "Failed";
}

function finalizeSourceStatus(sourceStatus, fallback = {}) {
  const underdogFallback = MLB_ONLY_MODE ? fallback.Underdog || "Unavailable" : fallback.Underdog || "Failed";
  return {
    PrizePicks: normalizeSourceState(sourceStatus.PrizePicks, prizePicksSourceFallback(fallback.PrizePicks)),
    Underdog: MLB_ONLY_MODE
      ? normalizeUnderdogStatusForMlb(sourceStatus.Underdog, underdogFallback)
      : normalizeSourceState(sourceStatus.Underdog, underdogFallback),
    "The Odds API": normalizeSourceState(sourceStatus["The Odds API"], fallback["The Odds API"] || "Partial"),
  };
}

function buildSourceHealth(backgroundWarnings = [], sourceFailures = [], sourceStatus = {}) {
  const health = {
    PrizePicks: normalizeSourceState(sourceStatus.PrizePicks),
    Underdog: normalizeSourceState(sourceStatus.Underdog),
    SportsDataIO: "Full",
    "Soccer stats": "Full",
    "WNBA stats": "Full",
  };
  const text = backgroundWarnings.join(" ").toLowerCase();
  if (/sportsdata|sportsdataio|mlb stat/.test(text)) health.SportsDataIO = "Fallback";
  if (/soccer player stats|soccer stat/.test(text)) health["Soccer stats"] = "Fallback";
  if (/wnba stat/.test(text)) health["WNBA stats"] = "Fallback";
  if (sourceStatus.PrizePicks === "Fallback") health.PrizePicks = "Fallback";
  if (sourceStatus.Underdog === "Fallback") health.Underdog = "Fallback";
  if (/not configured/i.test(String(sourceStatus.PrizePicks || ""))) health.PrizePicks = "Not configured";
  if (sourceFailures.length && sourceStatus.PrizePicks === "Failed") health.PrizePicks = "Failed";
  if (sourceFailures.length && sourceStatus.Underdog === "Failed") {
    health.Underdog = MLB_ONLY_MODE ? "Partial" : "Failed";
  }
  return health;
}

function partitionWarnings(backgroundWarnings, sourceFailures, sourceStatus) {
  const criticalPatterns = [
    /could not load prizepicks/i,
    /no active scheduled props/i,
  ];
  const underdogPattern = /underdog/i;
  const degradedWarnings = unique([
    ...backgroundWarnings.filter((warning) => underdogPattern.test(String(warning))),
    ...sourceFailures.filter((warning) => underdogPattern.test(String(warning))),
  ]);
  const criticalWarnings = unique([
    ...sourceFailures.filter((warning) => !underdogPattern.test(String(warning))),
    ...backgroundWarnings.filter(
      (warning) =>
        criticalPatterns.some((pattern) => pattern.test(warning)) && !underdogPattern.test(String(warning))
    ),
  ]);
  if (MLB_ONLY_MODE) {
    return {
      criticalWarnings: filterCriticalUiMessages(criticalWarnings, [], sourceStatus),
      degradedWarnings: filterCriticalUiMessages(degradedWarnings, [], sourceStatus),
      sourceHealth: {
        PrizePicks: normalizeSourceState(sourceStatus.PrizePicks),
        Underdog: normalizeUnderdogStatusForMlb(sourceStatus.Underdog, "Unavailable"),
        "The Odds API": normalizeSourceState(sourceStatus["The Odds API"], "Partial"),
        injuries: backgroundWarnings.some((w) => /injury|news/i.test(w)) ? "Partial" : "Full",
        ...buildSourceHealth(backgroundWarnings, sourceFailures, sourceStatus),
      },
    };
  }
  const sourceHealth = {
    PrizePicks: normalizeSourceState(sourceStatus.PrizePicks),
    Underdog: normalizeSourceState(sourceStatus.Underdog),
    "The Odds API": normalizeSourceState(sourceStatus["The Odds API"], "Partial"),
    injuries: backgroundWarnings.some((w) => /injury|news/i.test(w)) ? "Partial" : "Full",
    ...buildSourceHealth(backgroundWarnings, sourceFailures, sourceStatus),
  };
  return { criticalWarnings, degradedWarnings, sourceHealth };
}

const PLATFORM_OPTIONS = [
  { id: "all", label: "All Sources" },
  { id: "prizepicks", label: "PrizePicks" },
  { id: "underdog", label: "Underdog" },
  { id: "sportsbookEdge", label: "Sportsbook Edge" },
];

const EDGE_FILTER_OPTIONS = [
  { id: "all", label: "All Edges" },
  { id: "highConfidence", label: "High Confidence" },
  { id: "valuePlays", label: "Value Plays" },
  { id: "safeFloor", label: "Safe Floor" },
  { id: "boomUpside", label: "Boom/Upside" },
  { id: "earlyLines", label: "Early Lines" },
];

const DATE_FILTER_OPTIONS = [
  { id: "allUpcoming", label: "All upcoming" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
];

const BASE_SPORT_OPTIONS = [
  { value: "all", label: "All Sports" },
  { value: "MLB", label: "MLB" },
  { value: "NBA", label: "NBA" },
  { value: "WNBA", label: "WNBA" },
  { value: "Tennis", label: "Tennis" },
];

const ALL_STREAK_TAB_OPTIONS = [
  { value: "MLB", label: "MLB", type: "sport" },
  { value: "WNBA", label: "WNBA", type: "sport" },
  { value: "NBA", label: "NBA", type: "sport" },
  { value: "Tennis", label: "Tennis", type: "sport" },
  { value: "goblins", label: "Goblins", type: "goblin", always: true },
  { value: "demons", label: "Demons", type: "demon", always: true },
];

const STREAK_TAB_OPTIONS = getActiveStreakTabOptions(ALL_STREAK_TAB_OPTIONS);

const SUPPORTED_SPORTS = MLB_ONLY_MODE
  ? new Set(["MLB"])
  : new Set(["MLB", "NBA", "WNBA", "ATP Tennis", "WTA Tennis", "Tennis", "NHL"]);

const PRIORITY_PROP_TYPES = getActivePriorityPropTypes([
  "all",
  "Pitcher Strikeouts",
  "Pitches Thrown",
  "Hits+Runs+RBIs",
  "Total Bases",
  "Singles",
  "Doubles",
  "Triples",
  "Home Runs",
  "Stolen Bases",
  "Walks",
  "Hits",
  "RBIs",
  "Runs",
  "Fantasy Score",
  "Points",
  "Rebounds",
  "Assists",
  "Points + Rebounds + Assists",
  "Rebounds + Assists",
  "3-Pointers Made",
  "Total Games",
  "Total Sets",
  "Total Tie Breaks",
  "Aces",
  "Double Faults",
  "Break Points",
  "Shots",
  "Shots On Target",
  "Goals Allowed",
  "Goalie Saves",
  "Passes Attempted",
  "Crosses",
  "Time On Ice",
]);

const REALISTIC_PROJECTION_RANGES = [
  { sport: "MLB", match: (key) => key.includes("pitchesthrown") || key.includes("pitchcount"), label: "MLB Pitches Thrown", min: 40, max: 130 },
  { sport: "MLB", match: (key) => key.includes("strikeout") && !key.includes("hitter") && !key.includes("batter"), label: "MLB Strikeouts", min: 0, max: 15 },
  { sport: "MLB", match: (key) => key.includes("hitsrunsrbis") || key.includes("hrr"), label: "MLB Hits+Runs+RBIs", min: 0, max: 8 },
  { sport: "MLB", match: (key) => key.includes("totalbases") || key === "tb", label: "MLB Total Bases", min: 0, max: 8 },
  { sport: "MLB", match: (key) => key === "singles" || key.includes("single"), label: "MLB Singles", min: 0, max: 4 },
  { sport: "MLB", match: (key) => key === "doubles" || key === "double", label: "MLB Doubles", min: 0, max: 3 },
  { sport: "MLB", match: (key) => key === "triples" || key.includes("triple"), label: "MLB Triples", min: 0, max: 2 },
  { sport: "MLB", match: (key) => key.includes("homerun") || key === "hr", label: "MLB Home Runs", min: 0, max: 3 },
  { sport: "MLB", match: (key) => key.includes("stolenbase") || key === "sb", label: "MLB Stolen Bases", min: 0, max: 3 },
  { sport: "MLB", match: (key) => key === "batterwalks" || key === "walks" || key === "bb", label: "MLB Walks", min: 0, max: 3 },
  { sport: "MLB", match: (key) => key === "hits", label: "MLB Hits", min: 0, max: 5 },
  { sport: "MLB", match: (key) => key === "rbis" || key === "rbi", label: "MLB RBIs", min: 0, max: 6 },
  { sport: "MLB", match: (key) => key === "runs", label: "MLB Runs", min: 0, max: 5 },
  { sport: "MLB", match: (key) => key === "outs" || key.includes("pitchingout"), label: "MLB Pitching Outs", min: 0, max: 27 },
  { sport: "MLB", match: (key) => key.includes("hitsallowed"), label: "MLB Hits Allowed", min: 0, max: 12 },
  { sport: "MLB", match: (key) => key.includes("earnedrun"), label: "MLB Earned Runs Allowed", min: 0, max: 8 },
  { sport: "MLB", match: (key) => key.includes("fantasyscore"), label: "MLB Fantasy Score", min: 0, max: 70 },
  { sport: "NBA", match: (key) => key === "points", label: "NBA Points", min: 0, max: 60 },
  { sport: "NBA", match: (key) => key === "rebounds", label: "NBA Rebounds", min: 0, max: 25 },
  { sport: "NBA", match: (key) => key === "assists", label: "NBA Assists", min: 0, max: 20 },
  { sport: "NBA", match: (key) => key === "pr" || key.includes("pointsrebounds"), label: "NBA PR", min: 0, max: 80 },
  { sport: "NBA", match: (key) => key === "pa" || key.includes("pointsassists"), label: "NBA PA", min: 0, max: 80 },
  { sport: "NBA", match: (key) => key === "ra" || key.includes("reboundsassists") || key.includes("rebsasts"), label: "NBA RA", min: 0, max: 35 },
  { sport: "NBA", match: (key) => key.includes("pointsreboundsassists") || key === "pra", label: "NBA PRA", min: 0, max: 100 },
  { sport: "NBA", match: (key) => key.includes("3pointers") || key.includes("threepointers") || key.includes("3ptmade") || key === "3pm" || key === "3pt", label: "NBA 3-Pointers Made", min: 0, max: 12 },
  { sport: "NBA", match: (key) => key.includes("doubledouble"), label: "NBA Double-Double", min: 0, max: 1, step: 1 },
  { sport: "NBA", match: (key) => key.includes("1st3min") || key.includes("first3min"), label: "NBA Points 1st 3 Minutes", min: 0, max: 20 },
  { sport: "NBA", match: (key) => key.includes("quarter") && key.includes("3"), label: "NBA Quarter Props", min: 0, max: 4 },
  { sport: "WNBA", match: (key) => key === "points", label: "WNBA Points", min: 0, max: 60 },
  { sport: "WNBA", match: (key) => key === "rebounds", label: "WNBA Rebounds", min: 0, max: 25 },
  { sport: "WNBA", match: (key) => key === "assists", label: "WNBA Assists", min: 0, max: 20 },
  { sport: "WNBA", match: (key) => key === "pr" || key.includes("pointsrebounds"), label: "WNBA PR", min: 0, max: 80 },
  { sport: "WNBA", match: (key) => key === "pa" || key.includes("pointsassists"), label: "WNBA PA", min: 0, max: 80 },
  { sport: "WNBA", match: (key) => key === "ra" || key.includes("reboundsassists") || key.includes("rebsasts"), label: "WNBA RA", min: 0, max: 35 },
  { sport: "WNBA", match: (key) => key.includes("pointsreboundsassists") || key === "pra", label: "WNBA PRA", min: 0, max: 100 },
  { sport: "WNBA", match: (key) => key.includes("3pointers") || key.includes("threepointers") || key.includes("3ptmade") || key === "3pm" || key === "3pt", label: "WNBA 3-Pointers Made", min: 0, max: 12 },
  { sport: "WNBA", match: (key) => key.includes("doubledouble"), label: "WNBA Double-Double", min: 0, max: 1, step: 1 },
  { sport: "WNBA", match: (key) => key.includes("1st3min") || key.includes("first3min"), label: "WNBA Points 1st 3 Minutes", min: 0, max: 20 },
  { sport: "WNBA", match: (key) => key.includes("quarter") && key.includes("3"), label: "WNBA Quarter Props", min: 0, max: 4 },
  { sport: "Tennis", match: (key) => key.includes("gameswon") || key.includes("playergames"), label: "Tennis Games Won", min: 0, max: 30 },
  { sport: "Tennis", match: (key) => key.includes("totalgames"), label: "Tennis Total Games", min: 12, max: 65 },
  { sport: "Tennis", match: (key) => key.includes("fantasyscore"), label: "Tennis Fantasy Score", min: 0, max: 90 },
  { sport: "Tennis", match: (key) => key.includes("aces"), label: "Tennis Aces", min: 0, max: 40 },
  { sport: "Tennis", match: (key) => key.includes("doublefault"), label: "Tennis Double Faults", min: 0, max: 20 },
  { sport: "Tennis", match: (key) => key.includes("totalsets"), label: "Tennis Total Sets", min: 2, max: 5 },
  { sport: "Tennis", match: (key) => key.includes("totaltiebreak") || key.includes("tiebreak"), label: "Tennis Total Tie Breaks", min: 0, max: 4 },
  { sport: "Tennis", match: (key) => key.includes("breakpoint"), label: "Tennis Break Points", min: 0, max: 20 },
  { sport: "NHL", match: (key) => key.includes("timeonice") || key === "toi", label: "NHL Time On Ice", min: 8, max: 30 },
  { sport: "Soccer", match: (key) => key === "shots" || key.includes("shotsattempted"), label: "Soccer Shots", min: 0, max: 10 },
  { sport: "Soccer", match: (key) => key.includes("shotsontarget"), label: "Soccer Shots On Target", min: 0, max: 7 },
  { sport: "Soccer", match: (key) => key.includes("passesattempted") || key === "passes", label: "Soccer Passes Attempted", min: 0, max: 140 },
  { sport: "Soccer", match: (key) => key.includes("crosses") || key === "cross", label: "Soccer Crosses", min: 0, max: 25 },
  { sport: "Soccer", match: (key) => key.includes("goalsallowed"), label: "Soccer Goals Allowed", min: 0, max: 8 },
  { sport: "Soccer", match: (key) => key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves", label: "Soccer Goalie Saves", min: 0, max: 15 },
];

function prizePicksSucceeded(result) {
  const status = String(result?.status || "");
  return Boolean(result?.props?.length) && !["Failed"].includes(status);
}

function countPropCacheLayers(props = []) {
  const analytics = buildCacheAnalytics(props, { verifiedAt: new Date().toISOString(), boardUpdatedAt: new Date().toISOString() });
  return {
    cached: analytics.cached,
    live: analytics.live,
    stale: analytics.stale + analytics.expired,
  };
}

function applyLastGoodBoardFallback(applyBoardState, { notice = "Restored last working board from local storage." } = {}) {
  const lastGood = readLastGoodBoard();
  if (!lastGood) return false;
  const board = boardFromLastGood(lastGood, DEFAULT_SOURCE_STATUS);
  applyBoardState(
    {
      ...board,
      cacheNotice: notice,
      warnings: [],
      degradedWarnings: [],
      criticalWarnings: [],
      debugInfo: { ingestionFallback: "last-good-board", parserPreview: typeof window !== "undefined" ? window.__DEBUG_PARSER_PREVIEW__ || [] : [] },
    },
    "cached"
  );
  return true;
}

function applyVerifiedCacheFallbackBoard(applyBoardState, fallbackBoard, { notice = VERIFIED_CACHE_FALLBACK_MESSAGE, rateLimited = false } = {}) {
  const prepared = prepareVerifiedCacheBoard(fallbackBoard) || fallbackBoard;
  if (!prepared?.props?.length && !prepared?.qualifiedReadyProps?.length) return false;
  const layer = String(prepared.cacheMetadata?.freshnessTier || "VERIFIED_CACHE").toLowerCase();
  applyBoardState(
    {
      ...prepared,
      cacheNotice: prepared.cacheNotice || notice,
      warnings: unique(
        filterCriticalUiMessages(
          [rateLimited ? RATE_LIMIT_COOLDOWN_MESSAGE : "", ...(prepared.warnings || [])].filter(Boolean),
          prepared.props || prepared.qualifiedReadyProps || [],
          prepared.sourceStatus || {}
        )
      ),
    },
    layer
  );
  return true;
}

function buildApiHealthFromBoard(board, cacheLayer = "") {
  const pp = board?.debugInfo?.sources?.PrizePicks || {};
  const ud = board?.debugInfo?.sources?.Underdog || {};
  const odds = board?.debugInfo?.sources?.["The Odds API"] || {};
  const sourceSnapshot = buildSourceHealthSnapshot();
  const boardTs = board?.updatedAt ? new Date(board.updatedAt).getTime() : 0;
  const boardPropCount = (board?.props || []).length;
  const boardProps = board?.props || [];
  const buildRow = (row, status, providerKey = "") => {
    const counts = summarizeSourceCounts(row);
    const activeUsableCount = countActivePropsForSource(boardProps, providerKey);
    const effectiveUsable = Math.max(counts.usableCount, activeUsableCount);
    const isPrizePicks = String(providerKey || "").includes("prize");
    const ppNotConfigured =
      isPrizePicks &&
      (isPrizePicksProxyNotConfigured() ||
        /not configured/i.test(String(status || row.status || row.apiStatus || "")) ||
        row.diagnostics?.httpExecuted === false ||
        row.diagnostics?.failureClass === "MISSING_PROXY" ||
        /MISSING_PROXY|NO_HTTP_REQUEST/i.test(String(row.diagnostics?.failureClass || "")));
    const fetchFailed =
      !ppNotConfigured && /failed|unavailable|offline/i.test(String(status || row.status || ""));
    const timedOut =
      !ppNotConfigured && /timed?\s*out/i.test(String(row.message || row.lastError || status || ""));
    const cached = /cached/i.test(String(status || row.status || row.lineSourceBadge || "")) || activeUsableCount > counts.usableCount;
    if (ppNotConfigured) {
      const detail = PRIZEPICKS_NOT_CONFIGURED_DETAIL;
      const ncMetrics = formatIngestionMetrics({ ...counts, lineSourceBadge: HEALTH_STATES.NOT_CONFIGURED });
      const ncDiag = row.diagnostics || {
        ...getPrizePicksDiagnostics(),
        httpExecuted: false,
        proxyConfigured: false,
        missingConfiguration: inspectPrizePicksProxyConfig().missingConfiguration,
      };
      return {
        ...counts,
        usableCount: effectiveUsable,
        activeUsableCount,
        filteredCount: ncMetrics.filteredCount,
        cachedCount: ncMetrics.cachedCount,
        lineSourceBadge: HEALTH_STATES.NOT_CONFIGURED,
        statusLabel: detail,
        status: "Not configured",
        connectionTier: CONNECTION_TIERS.DEGRADED,
        httpExecuted: false,
        diagnostics: ncDiag,
      };
    }
    const health = resolveFetchHealthBadge({
      ok: !fetchFailed,
      failed: fetchFailed,
      timedOut,
      rateLimited: cached,
      cached,
      rawCount: counts.rawCount,
      parsedCount: counts.parsedCount,
      usableCount: effectiveUsable,
      lastError: row.message || row.lastError || "",
      fallback: Boolean(row.fallback),
      partial: counts.rawCount > 0 && effectiveUsable === 0 && counts.parsedCount > 0,
    });
    const connection = resolveProviderConnectionStatus({
      usableCount: counts.usableCount,
      activeUsableCount,
      parsedCount: counts.parsedCount,
      rawCount: counts.rawCount,
      cachedCount: counts.cachedCount,
      cached,
      fallback: Boolean(row.fallback),
      fetchFailed,
      timedOut,
    });
    const metrics = formatIngestionMetrics({ ...counts, lineSourceBadge: health.badge });
    const statusLabel = formatLiveProviderLabel({
      badge: health.badge,
      status: connection.tier,
      usableCount: effectiveUsable,
      rawCount: counts.rawCount,
      parsedCount: counts.parsedCount,
      failed: connection.tier === CONNECTION_TIERS.FAILED,
      timedOut: timedOut && effectiveUsable === 0,
      cached,
      lastError: row.message || row.lastError || "",
      connectionTier: connection.tier,
    });
    return {
      ...counts,
      usableCount: effectiveUsable,
      activeUsableCount,
      filteredCount: metrics.filteredCount,
      cachedCount: metrics.cachedCount,
      lineSourceBadge: health.badge,
      statusLabel,
      connectionTier: connection.tier,
    };
  };
  const ppRow = buildRow(pp, board?.sourceStatus?.PrizePicks, "prizepicks");
  const udRow = buildRow(ud, board?.sourceStatus?.Underdog, "underdog");
  const oddsRow = buildRow(odds, board?.sourceStatus?.["The Odds API"]);
  const cacheUsableCount = boardPropCount;
  const cacheLayerLabel =
    cacheUsableCount === 0
      ? "EMPTY"
      : cacheLayer === "fresh"
        ? "LIVE"
        : boardTs
          ? formatCacheLayerLabel(resolveCacheLayer(boardTs, CACHE_TTL.BOARD_MS))
          : formatCacheLayerLabel(String(cacheLayer || "EMPTY").toUpperCase());
  const oddsKeyConfigured = Boolean(getOddsApiKey());
  const sportsDataConfigured = Boolean(getSportsDataApiKey());
  const statsWarnings = board?.debugInfo?.statsWarnings || [];
  const statsLoadedCount = Number(board?.debugInfo?.statsLoadedCount || 0);
  return {
    PrizePicks: {
      status: ppRow.status || ppRow.connectionTier || CONNECTION_TIERS.PENDING,
      connectionTier: ppRow.connectionTier || CONNECTION_TIERS.PENDING,
      lastFetchAt: pp.lastSuccessfulFetchAt || sourceSnapshot.PrizePicks?.lastSuccessfulFetchAt || board?.updatedAt || "",
      lineSourceBadge: ppRow.lineSourceBadge,
      statusLabel: ppRow.statusLabel,
      httpExecuted: ppRow.httpExecuted ?? pp.httpExecuted ?? pp.diagnostics?.httpExecuted,
      diagnostics: ppRow.diagnostics || pp.diagnostics,
      rawCount: ppRow.rawCount,
      parsedCount: ppRow.parsedCount,
      usableCount: ppRow.usableCount,
      activeUsableCount: ppRow.activeUsableCount,
      filteredCount: ppRow.filteredCount,
      cachedCount: ppRow.cachedCount,
      ingestionSummary: formatIngestionMetrics(ppRow).summary,
      cooldownRemainingMs: sourceSnapshot.PrizePicks?.cooldownRemainingMs || 0,
      cacheAge: sourceSnapshot.PrizePicks?.cacheAge || "",
      requestCount: sourceSnapshot.PrizePicks?.requestCount || 0,
      sessionRequestCount: sourceSnapshot.PrizePicks?.sessionRequestCount || 0,
      lastError: sourceSnapshot.PrizePicks?.lastError || pp.message || "",
    },
    Underdog: {
      status: udRow.connectionTier || CONNECTION_TIERS.PENDING,
      connectionTier: udRow.connectionTier || CONNECTION_TIERS.PENDING,
      lastFetchAt: ud.lastSuccessfulFetchAt || sourceSnapshot.Underdog?.lastSuccessfulFetchAt || board?.updatedAt || "",
      lineSourceBadge: udRow.lineSourceBadge,
      statusLabel: udRow.statusLabel,
      rawCount: udRow.rawCount,
      parsedCount: udRow.parsedCount,
      usableCount: udRow.usableCount,
      activeUsableCount: udRow.activeUsableCount,
      filteredCount: udRow.filteredCount,
      cachedCount: udRow.cachedCount,
      ingestionSummary: formatIngestionMetrics(udRow).summary,
      cooldownRemainingMs: sourceSnapshot.Underdog?.cooldownRemainingMs || 0,
      cacheAge: sourceSnapshot.Underdog?.cacheAge || "",
      requestCount: sourceSnapshot.Underdog?.requestCount || 0,
      sessionRequestCount: sourceSnapshot.Underdog?.sessionRequestCount || 0,
      lastError:
        MLB_ONLY_MODE && boardPropCount > 0
          ? ""
          : filterCriticalUiMessages(
              [sourceSnapshot.Underdog?.lastError, ud.message].filter(Boolean),
              board?.props || [],
              board?.sourceStatus || {}
            ).join(" | "),
    },
    OddsAPI: {
      status: sourceSnapshot[SOURCE_IDS.ODDS_API]?.status || odds.status || board?.sourceStatus?.["The Odds API"] || "Pending",
      lastFetchAt: odds.lastSuccessfulFetchAt || sourceSnapshot[SOURCE_IDS.ODDS_API]?.lastSuccessfulFetchAt || "",
      lineSourceBadge: oddsKeyConfigured ? oddsRow.lineSourceBadge : "NOT CONFIGURED",
      statusLabel: oddsKeyConfigured ? oddsRow.statusLabel : "Not configured",
      rawCount: Number(odds.rawPropsLoaded || 0),
      parsedCount: Number(odds.propsAfterParsing || 0),
      usableCount: Number(odds.propsAfterParsing || 0),
      cooldownRemainingMs: sourceSnapshot[SOURCE_IDS.ODDS_API]?.cooldownRemainingMs || 0,
      cacheAge: sourceSnapshot[SOURCE_IDS.ODDS_API]?.cacheAge || "",
      requestCount: sourceSnapshot[SOURCE_IDS.ODDS_API]?.requestCount || 0,
      sessionRequestCount: sourceSnapshot[SOURCE_IDS.ODDS_API]?.sessionRequestCount || 0,
      lastError: oddsKeyConfigured
        ? sourceSnapshot[SOURCE_IDS.ODDS_API]?.lastError || odds.message || ""
        : "Not configured",
    },
    SportsData: {
      status: sportsDataConfigured ? (statsLoadedCount > 0 ? "active" : "empty") : "not_configured",
      lastFetchAt: board?.updatedAt || "",
      lineSourceBadge: sportsDataConfigured ? (statsLoadedCount > 0 ? "LIVE" : "EMPTY") : "NOT CONFIGURED",
      statusLabel: sportsDataConfigured
        ? statsLoadedCount > 0
          ? `Live — ${statsLoadedCount} stats loaded`
          : "Empty — no stats loaded"
        : "Not configured",
      rawCount: statsLoadedCount,
      parsedCount: statsLoadedCount,
      usableCount: statsLoadedCount,
      cacheAge: "",
      requestCount: 0,
      sessionRequestCount: 0,
      lastError: statsWarnings.find((w) => /stat|mlb|sportsdata/i.test(String(w))) || "",
    },
    cache: {
      status: cacheLayerLabel,
      statusLabel: cacheUsableCount > 0 ? `Cached — ${cacheUsableCount} board props` : "Empty — no board props",
      lastFetchAt: board?.updatedAt || "",
      cacheAge: boardTs ? formatCacheAge(board?.updatedAt) : "",
      rawCount: boardPropCount,
      parsedCount: boardPropCount,
      usableCount: cacheUsableCount,
      lastError: cacheLayerLabel === "EXPIRED" ? "Expired cache not used for Top Picks" : "",
    },
  };
}

function applySourceResult({
  label,
  result,
  sourceWarnings,
  sourceFailures,
  rawProps,
  sourceStatus,
  debugInfo,
}) {
  const platform = label === "PrizePicks" ? "PrizePicks" : label === "Underdog" ? "Underdog" : label;

  if (label === "PrizePicks" && (result.notConfigured || result.status === "Not configured")) {
    const detail = PRIZEPICKS_NOT_CONFIGURED_DETAIL;
    sourceStatus.PrizePicks = "Not configured";
    const ppDiag = result.diagnostics || getPrizePicksDiagnostics();
    debugInfo.sources.PrizePicks = {
      ...debugInfo.sources.PrizePicks,
      status: "Not configured",
      connectionTier: CONNECTION_TIERS.DEGRADED,
      apiStatus: "Not configured",
      message: detail,
      lineSourceBadge: HEALTH_STATES.NOT_CONFIGURED,
      timedOut: false,
      diagnostics: ppDiag,
      failureClass: ppDiag.failureClass || "MISSING_PROXY",
    };
    return false;
  }

  const incoming = result.parsedProps?.length ? result.parsedProps : result.props;
  const props = (incoming || []).map((prop) =>
    normalizePropShape(
      { ...prop, playerName: prop.playerName || prop.player || "" },
      { platform, source: platform }
    )
  );
  const rawCount = Number(result.debug?.rawPropsLoaded ?? result.pipelineAudit?.fetched ?? 0);
  const parsedCount = Number(
    result.debug?.propsAfterParsing ?? result.parsedProps?.length ?? props.length
  );
  const usableCount = countUsableProps(props);
  logLiveFetchResult(label, result);
  const rateLimited = Boolean(result.rateLimited || result.cached);
  const cached = result.status === "Cached" || rateLimited || Boolean(result.fallback);
  const timedOut = /timed?\s*out/i.test(String(result.debug?.message || result.warnings?.join(" ") || ""));
  const fetchFailed =
    (result.status === "Failed" || result.status === "Unavailable") &&
    usableCount === 0 &&
    parsedCount === 0 &&
    props.length === 0 &&
    !cached;
  const failed = fetchFailed;
  const health = resolveFetchHealthBadge({
    ok: !failed,
    failed,
    timedOut,
    rateLimited,
    cached,
    rawCount,
    parsedCount,
    usableCount,
    lastError: result.debug?.message || result.warnings?.join(" | ") || "",
    fallback: Boolean(result.fallback),
    partial: rawCount > 0 && usableCount === 0 && parsedCount > 0,
  });
  const connectionTier = health.connectionTier || CONNECTION_TIERS.PENDING;

  if (label === "Underdog" && failed) {
    const detailWarnings = result.warnings?.length ? result.warnings : [UNDERDOG_UNAVAILABLE_MESSAGE];
    if (result.debug?.underdogParser?.parserMismatch) {
      detailWarnings.unshift(buildUnderdogParserFailureMessage(result.debug));
    }
    sourceStatus.Underdog = props.length ? "Degraded" : "Unavailable";
    detailWarnings.forEach((warning) => {
      if (!sourceWarnings.includes(warning)) sourceWarnings.push(warning);
    });
    if (props.length) {
      rawProps.push(...props);
    }
    debugInfo.sources[label] = {
      ...debugInfo.sources[label],
      status: connectionTier,
      connectionTier,
      apiStatus: connectionTier,
      apiUrl: result.debug?.apiUrl || "",
      endpointsTried: result.debug?.endpointsTried || [],
      rawPropsLoaded: rawCount,
      propsAfterParsing: parsedCount,
      usablePropsCount: usableCount,
      message: result.debug?.message || detailWarnings.join(" | "),
      lastSuccessfulFetchAt: result.lastSuccessfulFetchAt || "",
      lineSourceBadge:
        connectionTier === CONNECTION_TIERS.FAILED ? HEALTH_STATES.FAILED : health.badge,
      underdogParser: result.debug?.underdogParser || null,
      rawUnderdogSamples: result.debug?.rawUnderdogSamples || [],
      responseShape: result.debug?.responseShape || null,
    };
    return usableCount > 0 || props.length > 0;
  }

  if (failed) {
    const detailWarnings = result.warnings || [];
    if (props.length) rawProps.push(...props);
    if (label === "PrizePicks" && rateLimited) {
      sourceStatus[label] = props.length ? "Cached" : "Rate Limited";
      if (!sourceWarnings.includes(PRIZEPICKS_RATE_LIMIT_MESSAGE)) {
        sourceWarnings.push(PRIZEPICKS_RATE_LIMIT_MESSAGE);
      }
    } else {
      sourceWarnings.push(...detailWarnings);
      if (label === "PrizePicks") {
        const softFailure = detailWarnings.some((warning) =>
          /temporarily unavailable|non-json|html instead of json|showing cached|rate limited/i.test(String(warning))
        );
        if (!softFailure) {
          sourceFailures.push(...(detailWarnings.length ? detailWarnings : [PRIZEPICKS_TEMPORARY_MESSAGE]));
        } else if (!sourceWarnings.includes(PRIZEPICKS_TEMPORARY_MESSAGE)) {
          sourceWarnings.push(PRIZEPICKS_TEMPORARY_MESSAGE);
        }
      }
      sourceStatus[label] = props.length ? "Degraded" : "Failed";
    }
    const failPpDiag =
      label === "PrizePicks"
        ? {
            ...getPrizePicksDiagnostics(),
            ...(result.diagnostics || {}),
            uiConnectionTier: connectionTier,
            lastError: health.message || result.debug?.message || detailWarnings.join(" | "),
            validationCount: usableCount,
          }
        : null;
    if (label === "PrizePicks") updatePrizePicksDiagnostics(failPpDiag);
    debugInfo.sources[label] = {
      ...debugInfo.sources[label],
      status: connectionTier,
      connectionTier,
      apiStatus: connectionTier,
      apiUrl: result.debug?.apiUrl || "",
      endpointsTried: result.debug?.endpointsTried || [],
      rawPropsLoaded: rawCount,
      propsAfterParsing: parsedCount,
      usablePropsCount: usableCount,
      message: health.message || result.debug?.message || detailWarnings.join(" | "),
      lastSuccessfulFetchAt: result.lastSuccessfulFetchAt || "",
      lineSourceBadge:
        connectionTier === CONNECTION_TIERS.FAILED ? HEALTH_STATES.FAILED : health.badge,
      statusLabel: health.message,
      ...(failPpDiag ? { diagnostics: failPpDiag, failureClass: failPpDiag.failureClass } : {}),
    };
    return usableCount > 0 || props.length > 0;
  }

  const pipelineStatus =
    connectionTier === CONNECTION_TIERS.CONNECTED || connectionTier === CONNECTION_TIERS.WARNING
      ? label === "Underdog"
        ? "Connected"
        : connectionTier === CONNECTION_TIERS.WARNING
          ? "Cached"
          : "Full"
      : health.pipelineStatus;
  sourceStatus[label] = pipelineStatus;

  if (health.message && !sourceWarnings.includes(health.message)) {
    sourceWarnings.push(health.message);
  }

  if (props.length) rawProps.push(...props);

  const ppDiagnostics =
    label === "PrizePicks"
      ? {
          ...(result.diagnostics || getPrizePicksDiagnostics()),
          uiConnectionTier: connectionTier,
          validationCount: usableCount,
          rawPropCount: rawCount,
        }
      : null;
  if (label === "PrizePicks") {
    updatePrizePicksDiagnostics(ppDiagnostics);
  }

  debugInfo.sources[label] = {
    ...debugInfo.sources[label],
    status: connectionTier,
    connectionTier,
    apiStatus: connectionTier,
    apiUrl: result.debug?.apiUrl || "",
    endpointsTried: result.debug?.endpointsTried || [],
    rawPropsLoaded: rawCount,
    propsAfterParsing: parsedCount,
    usablePropsCount: usableCount,
    message: health.message || result.debug?.message || "",
    lastSuccessfulFetchAt: result.lastSuccessfulFetchAt || "",
    lineSourceBadge: health.badge,
    statusLabel: health.message,
    underdogParser: result.debug?.underdogParser || null,
    rawUnderdogSamples: result.debug?.rawUnderdogSamples || [],
    ...(ppDiagnostics ? { diagnostics: ppDiagnostics, failureClass: ppDiagnostics.failureClass } : {}),
  };
  return usableCount > 0;
}

function emptyOddsApiResult({ timedOut = false, warnings = [], authDisabled = false } = {}) {
  return {
    props: [],
    warnings: timedOut ? [ENRICHMENT_TIMEOUT_MESSAGE, ...warnings].filter(Boolean) : warnings,
    parsedCount: 0,
    timedOut,
    authDisabled,
  };
}

function applyOddsApiSourceState(oddsApiPlayerResult, sourceStatus, debugInfo) {
  if (oddsApiPlayerResult?.authDisabled || isSourceAuthBlocked(SOURCE_IDS.ODDS_API)) {
    sourceStatus["The Odds API"] = "Disabled";
    debugInfo.sources["The Odds API"] = {
      ...debugInfo.sources["The Odds API"],
      status: "Disabled",
      apiStatus: "Disabled",
      message: "Odds API disabled (invalid key)",
      lineSourceBadge: "DISABLED",
    };
    return;
  }
  logLiveFetchResult("OddsAPI", {
    status: oddsApiPlayerResult?.timedOut ? "Failed" : oddsApiPlayerResult?.props?.length ? "OK" : "Empty",
    debug: {
      apiUrl: oddsApiPlayerResult?.apiUrl || "odds-api/player-props",
      apiStatus: oddsApiPlayerResult?.timedOut ? "Timeout" : "Connected",
      rawPropsLoaded: Number(oddsApiPlayerResult?.parsedCount || 0),
      propsAfterParsing: Number(oddsApiPlayerResult?.props?.length || 0),
      message: (oddsApiPlayerResult?.warnings || []).join(" "),
    },
    warnings: oddsApiPlayerResult?.warnings || [],
  });
  const timedOut = Boolean(oddsApiPlayerResult?.timedOut);
  const hasProps = Number(oddsApiPlayerResult?.props?.length || 0) > 0;
  if (timedOut) {
    sourceStatus["The Odds API"] = ENRICHMENT_TIMEOUT_MESSAGE;
  } else if (hasProps) {
    sourceStatus["The Odds API"] = oddsApiPlayerResult.cached ? "Cached" : "Partial";
  }
  debugInfo.sources["The Odds API"] = {
    ...debugInfo.sources["The Odds API"],
    status: timedOut
      ? ENRICHMENT_TIMEOUT_MESSAGE
      : hasProps
        ? oddsApiPlayerResult.cached
          ? "Cached"
          : "Partial"
        : debugInfo.sources["The Odds API"]?.status || "Pending",
    apiStatus: timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : hasProps ? "Connected" : "Pending",
    rawPropsLoaded: Number(oddsApiPlayerResult?.parsedCount || oddsApiPlayerResult?.props?.length || 0),
    propsAfterParsing: Number(oddsApiPlayerResult?.parsedCount || oddsApiPlayerResult?.props?.length || 0),
    usablePropsCount: Number(oddsApiPlayerResult?.props?.length || 0),
    message: timedOut
      ? ENRICHMENT_TIMEOUT_MESSAGE
      : (oddsApiPlayerResult?.warnings || []).join(" ") || (hasProps ? "Player props parsed" : EMPTY_SOURCE_MESSAGE),
    lastSuccessfulFetchAt: oddsApiPlayerResult?.lastSuccessfulFetchAt || "",
    lineSourceBadge: hasProps
      ? oddsApiPlayerResult.cached || oddsApiPlayerResult.rateLimited
        ? "CACHED"
        : "LIVE"
      : timedOut
        ? "TIMED OUT"
        : "EMPTY",
  };
}

function buildCoreBoardPreview({ rawProps = [], allDisplayProps = [], sourceStatus, debugInfo }) {
  const boardProps = allDisplayProps.length ? allDisplayProps : [];
  const status = finalizeSourceStatus({ ...sourceStatus });
  return {
    props: boardProps,
    allDisplayProps: boardProps,
    usableProps: boardProps,
    streakProps: [],
    sourceStatus: status,
    sourceHealth: buildSourceHealth([], [], status),
    debugInfo: sanitizeDebugInfoForMlbOnly(debugInfo),
    pipelineFallback: false,
    partial: true,
  };
}

async function injectSportsDataIfProvidersEmpty({ mergedCount = 0, sourceStatus, debugInfo } = {}) {
  if (mergedCount > 0) return null;
  const generated = await generateMlbPropsFromSportsData({ limit: 48 });
  debugInfo.providerFetchCounts = {
    ...(debugInfo.providerFetchCounts || {}),
    sportsdataGenerated: generated.generatedCount || 0,
  };
  if (!generated.props?.length) {
    debugInfo.sportsDataFallbackAttempt = {
      count: 0,
      warnings: generated.warnings || ["SportsDataIO returned no MLB props"],
    };
    return null;
  }
  sourceStatus.SportsDataIO = sourceStatus.SportsDataIO || "Connected";
  debugInfo.ingestionFallback = "sportsdata-immediate";
  debugInfo.sportsDataFallbackAttempt = {
    count: generated.generatedCount,
    warnings: generated.warnings || [],
  };
  return { rawProps: generated.props, source: "sportsdata-immediate" };
}

const MLB_STATS_ENRICHMENT_FAILED = "MLB projection stats failed to load";

function beginParallelProviderFetches({ fetchSport, wantsPrizePicks, wantsUnderdog, fetchUnderdogFlag }) {
  const ppFetch = wantsPrizePicks
    ? fetchProviderIsolated({
        label: "PrizePicks",
        sourceId: "PrizePicks",
        timeoutMs: PRIZEPICKS_PROVIDER_TIMEOUT_MS,
        preflight: () => getLineProviderPreflight("PrizePicks"),
        fetchFn: ({ signal }) => fetchPrizePicksProps({ sport: fetchSport, statType: "all", signal }),
        emptyResult: ({ timedOut, message, notConfigured }) => {
          if (!notConfigured) {
            const cached = resolvePrizePicksCachedProviderResult({
              sport: fetchSport,
              statType: "all",
              reason: timedOut ? "timeout" : "fetch-failed",
              message:
                message ||
                (timedOut
                  ? `PrizePicks timed out after ${PRIZEPICKS_PROVIDER_TIMEOUT_MS / 1000}s`
                  : "PrizePicks fetch failed"),
            });
            if (cached?.props?.length) {
              logPrizePicksFetchSummary({
                liveCount: 0,
                cacheCount: cached.props.length,
                finalCount: cached.props.length,
                status: "Warning",
              });
              return cached;
            }
          }
          logPrizePicksFetchSummary({
            liveCount: 0,
            cacheCount: 0,
            finalCount: 0,
            status: notConfigured ? "Not configured" : "Failed",
          });
          return emptyPrizePicksProviderResult({
            timedOut,
            notConfigured,
            message:
              message ||
              (notConfigured
                ? "PrizePicks proxy URL missing"
                : timedOut
                  ? `PrizePicks timed out after ${PRIZEPICKS_PROVIDER_TIMEOUT_MS / 1000}s`
                  : "PrizePicks fetch failed"),
          });
        },
      })
    : skippedProviderResult("PrizePicks");

  const udFetch = fetchUnderdogFlag
    ? fetchProviderIsolated({
        label: "Underdog",
        sourceId: "Underdog",
        timeoutMs: UNDERDOG_PROVIDER_TIMEOUT_MS,
        preflight: () => getLineProviderPreflight("Underdog"),
        fetchFn: ({ signal }) => fetchUnderdogProviderProps({ sport: fetchSport, statType: "all", signal }),
        emptyResult: ({ timedOut, message, notConfigured }) =>
          emptyUnderdogProviderResult({
            timedOut,
            notConfigured,
            message:
              message ||
              (notConfigured
                ? "Underdog proxy URL missing or invalid."
                : timedOut
                  ? `Underdog timed out after ${UNDERDOG_PROVIDER_TIMEOUT_MS / 1000}s`
                  : "Underdog fetch failed"),
          }),
      })
    : skippedProviderResult("Underdog");

  const oddsFetch = isOddsApiKeyUsable()
    ? fetchProviderIsolated({
        label: "Odds API",
        timeoutMs: getLineFeedTimeoutMs(),
        fetchFn: () =>
          fetchOddsApiDisplayProps({ sport: fetchSport }).catch((error) =>
            emptyOddsApiResult({
              timedOut: isAbortOrTimeoutError(error),
              authDisabled: /invalid odds api key|unauthorized|401|403/i.test(String(error?.message || "")),
              warnings: [
                isAbortOrTimeoutError(error)
                  ? ENRICHMENT_TIMEOUT_MESSAGE
                  : sanitizeOddsApiUiMessage(error?.message) || "Odds API player props failed",
              ],
            })
          ),
        emptyResult: ({ timedOut }) => emptyOddsApiResult({ timedOut: true, warnings: [ENRICHMENT_TIMEOUT_MESSAGE] }),
      })
    : skippedProviderResult("Odds API");

  const seasonFetch = fetchProviderIsolated({
    label: "SeasonStats",
    timeoutMs: getSportsDataTimeoutMs(),
    fetchFn: () => fetchPlayerSeasonStats(),
    emptyResult: ({ timedOut, message }) =>
      emptySeasonStatsProviderResult({
        timedOut,
        message: message || (timedOut ? "Season stats timed out" : "Season stats fetch failed"),
      }),
  });

  return {
    ppFetch,
    udFetch,
    oddsFetch,
    seasonFetch,
    awaitLineProviders: () => Promise.allSettled([ppFetch, udFetch]),
    awaitCoreFeeds: () => Promise.allSettled([ppFetch, udFetch, oddsFetch]),
    awaitCoreFeedsLineOnly: () => Promise.allSettled([ppFetch, udFetch]),
    awaitEnrichmentFeeds: () => Promise.allSettled([seasonFetch]),
    awaitAllForPerf: () => Promise.allSettled([ppFetch, udFetch, oddsFetch, seasonFetch]),
  };
}

function applyMlbStatsProviderResult(statsEntry, debugInfo) {
  const hardFailed = Boolean(statsEntry?.error && !statsEntry?.timedOut);
  const timedOut = Boolean(statsEntry?.timedOut || statsEntry?.result?.timedOut);
  const statsResult = statsEntry?.result;
  let statsMap = statsResult?.stats instanceof Map ? statsResult.stats : null;
  let usedCache = false;

  const cached = readCachedMlbStatsMap();
  if ((!statsMap || statsMap.size === 0) && cached?.size) {
    statsMap = cached;
    usedCache = true;
  }

  const statsMapSize = statsMap?.size ?? 0;
  const enrichmentFailed = statsMapSize === 0 && (hardFailed || timedOut);
  const enrichmentDegraded = usedCache || (timedOut && statsMapSize > 0) || (hardFailed && statsMapSize > 0);

  if (enrichmentFailed) {
    debugInfo.statsEnrichmentFailed = true;
    debugInfo.statsEnrichmentDegraded = false;
    debugInfo.statsEnrichmentError =
      statsResult?.warnings?.[0] ||
      statsEntry?.result?.message ||
      PROJECTION_DATA_UNAVAILABLE_MESSAGE;
    debugInfo.statsMap = null;
    debugInfo.statsLoadedCount = 0;
  } else {
    debugInfo.statsEnrichmentFailed = false;
    debugInfo.statsEnrichmentDegraded = enrichmentDegraded;
    debugInfo.statsEnrichmentError = enrichmentDegraded
      ? usedCache
        ? "MLB stats refresh failed — using cached player profiles"
        : timedOut
          ? "MLB stats timed out — using available profiles and season merge"
          : statsResult?.warnings?.[0] || ""
      : statsMapSize === 0
        ? statsResult?.warnings?.[0] || ""
        : "";
    debugInfo.statsMap = statsMap;
    debugInfo.statsLoadedCount = statsMapSize;
    debugInfo.statsFromCache = usedCache;
  }

  return {
    stats: statsMap || new Map(),
    warnings: statsResult?.warnings || [],
    timedOut,
    failed: enrichmentFailed,
    usedCache,
    degraded: enrichmentDegraded,
    durationMs: statsEntry?.durationMs ?? 0,
  };
}

function applySeasonStatsProviderResult(seasonEntry, debugInfo) {
  const seasonResult = seasonEntry?.result || emptySeasonStatsProviderResult();
  const seasonStatsData = Array.isArray(seasonResult.data) ? seasonResult.data : [];
  const seasonFailed = Boolean(seasonEntry?.error || seasonResult.error || seasonStatsData.length === 0);

  debugInfo.sportsDataSeasonStats = seasonStatsData;
  debugInfo.sportsDataSeasonStatsCount = seasonStatsData.length;
  debugInfo.seasonStatsEnrichmentFailed = seasonFailed;
  debugInfo.seasonStatsEnrichmentError = seasonFailed
    ? seasonResult.warnings?.[0] ||
      (seasonEntry?.timedOut ? "Season stats timed out" : "SportsDataIO season stats unavailable")
    : "";

  if (seasonFailed) {
    console.warn("[MLB Projection] season stats unavailable", {
      timedOut: seasonEntry?.timedOut,
      warnings: seasonResult.warnings,
    });
  }
  return seasonStatsData;
}

async function fetchMlbProjectionStatsBlocking(props, debugInfo) {
  debugInfo.statsFetchPropCount = Array.isArray(props) ? props.length : 0;

  if (!props?.length) {
    return applyMlbStatsProviderResult(
      {
        label: "Stats",
        error: true,
        timedOut: false,
        durationMs: 0,
        result: emptyStatsProviderResult({
          message: `${PROJECTION_DATA_UNAVAILABLE_MESSAGE}: no props available for stats enrichment`,
        }),
      },
      debugInfo
    );
  }

  const statsEntry = await fetchProviderIsolated({
    label: "Stats",
    timeoutMs: getMlbStatsFetchTimeoutMs(),
    fetchFn: () => fetchPlayerStats({ props }),
    emptyResult: ({ timedOut, message }) =>
      emptyStatsProviderResult({
        timedOut,
        message: message || (timedOut ? `${MLB_STATS_ENRICHMENT_FAILED}: timed out` : PROJECTION_DATA_UNAVAILABLE_MESSAGE),
      }),
  });
  return applyMlbStatsProviderResult(statsEntry, debugInfo);
}

function enrichmentBackgroundFallback(label) {
  const warnings = [ENRICHMENT_TIMEOUT_MESSAGE];
  if (label === "stats") {
    throw new Error(`${MLB_STATS_ENRICHMENT_FAILED}: enrichment timed out`);
  }
  if (label === "sportsbook") {
    return { comparisons: [], warnings, timedOut: true };
  }
  return { news: new Map(), warnings, timedOut: true };
}

async function fetchDFSProps({ platform = "both", sport = "all", statType = "all", onCoreReady, onProgress } = {}) {
  const reportProgress = (stage) => {
    if (typeof onProgress === "function") onProgress(stage);
  };
  beginPerformanceTimer(PERFORMANCE_TIMERS.fetchFeeds);
  reportProgress("FETCH");
  initRawResponseDebug();
  const fetchSport = getActiveFetchSport(sport);
  console.info("[DFS Source Audit] fetchDFSProps requested", {
    platform,
    sport: fetchSport,
    statType,
    mlbOnlyMode: MLB_ONLY_MODE,
    devMode: isDevEnvironment(),
  });
  const sourceWarnings = [];
  const sourceFailures = [];
  const rawProps = [];
  const sourceStatus = { ...DEFAULT_SOURCE_STATUS };
  const debugInfo = createDebugInfo(platform);
  const wantsPrizePicks = platform === "both" || platform === "all" || platform === "prizepicks";
  const wantsUnderdog = platform === "both" || platform === "all" || platform === "underdog";
  const enrichmentTimeoutMs = getApiTimeoutMs({ enrichment: true });

  let prizePicksResult = null;
  let underdogResult = null;
  let oddsApiPlayerResult = emptyOddsApiResult();
  let pipelineFallback = false;

  const needsUnderdogBackup = wantsUnderdog;
  const fetchUnderdogFlag = needsUnderdogBackup || (wantsUnderdog && !wantsPrizePicks);
  const providerWave = beginParallelProviderFetches({
    fetchSport,
    wantsPrizePicks,
    wantsUnderdog,
    fetchUnderdogFlag,
  });

  const coreFeedSettled = await providerWave.awaitCoreFeeds();
  endPerformanceTimer(PERFORMANCE_TIMERS.fetchFeeds);
  beginPerformanceTimer(PERFORMANCE_TIMERS.normalizeProps);
  const ppEntry = unwrapProviderSettled(coreFeedSettled[0]);
  const udEntry = unwrapProviderSettled(coreFeedSettled[1]);
  const oddsEntry = unwrapProviderSettled(coreFeedSettled[2]);

  if (fetchUnderdogFlag && !udEntry.skipped) {
    underdogResult = udEntry.result?.error ? udEntry.result : udEntry.result;
    if (underdogResult && !underdogResult.error) {
      console.info("[DFS Source Audit] Underdog result", {
        status: underdogResult.status,
        props: underdogResult.props?.length || 0,
        lineSourceBadge: underdogResult.lineSourceBadge,
        durationMs: udEntry.durationMs,
        timedOut: udEntry.timedOut,
      });
      applySourceResult({
        label: "Underdog",
        result: underdogResult,
        sourceWarnings,
        sourceFailures,
        rawProps,
        sourceStatus,
        debugInfo,
      });
      applyUnderdogProviderToDebug(debugInfo, underdogResult);
      if (underdogResult?.props?.length || underdogResult?.parsedProps?.length) {
        const udSource = underdogResult.parsedProps || underdogResult.props || [];
        debugInfo.parsedUnderdogProps = normalizePropsWithSource(
          udSource.map((prop) =>
            normalizePropShape(
              { ...prop, playerName: prop.playerName || prop.player || "" },
              { platform: "Underdog", source: "Underdog" }
            )
          )
        );
        debugInfo.underdogParser = underdogResult.debug?.underdogParser || underdogResult.pipelineAudit?.underdogParser || null;
        debugInfo.rawUnderdogSamples = underdogResult.debug?.rawUnderdogSamples || [];
        debugInfo.underdogResponseShape = underdogResult.debug?.responseShape || null;
      } else if (underdogResult.debug?.underdogParser?.parserMismatch && !(underdogResult.parsedProps?.length || underdogResult.props?.length)) {
        sourceWarnings.push(buildUnderdogParserFailureMessage(underdogResult.debug));
      }
    } else {
      sourceStatus.Underdog = udEntry.timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Unavailable";
      console.warn("[DFS Source Audit] Underdog load failed or timed out", {
        timedOut: udEntry.timedOut,
        durationMs: udEntry.durationMs,
      });
      sourceWarnings.push(underdogResult?.warnings?.[0] || UNDERDOG_UNAVAILABLE_MESSAGE);
      if (underdogResult?.props?.length || underdogResult?.parsedProps?.length) {
        applySourceResult({
          label: "Underdog",
          result: underdogResult,
          sourceWarnings,
          sourceFailures,
          rawProps,
          sourceStatus,
          debugInfo,
        });
        applyUnderdogProviderToDebug(debugInfo, underdogResult);
      }
      debugInfo.sources.Underdog = {
        ...debugInfo.sources.Underdog,
        status: "Unavailable",
        apiStatus: "Unavailable",
        message: underdogResult?.warnings?.[0] || UNDERDOG_UNAVAILABLE_MESSAGE,
        lineSourceBadge: "STALE",
      };
    }
  }

  if (wantsPrizePicks) {
    prizePicksResult = ppEntry.result;
    if (
      (!prizePicksResult?.props?.length || prizePicksResult?.error) &&
      (ppEntry.timedOut || ppEntry.error) &&
      !ppEntry.notConfigured &&
      !prizePicksResult?.notConfigured
    ) {
      const cached = resolvePrizePicksCachedProviderResult({
        sport: fetchSport,
        statType: "all",
        reason: ppEntry.timedOut ? "timeout" : "fetch-failed",
        message: ppEntry.statusReason || prizePicksResult?.warnings?.[0] || "",
      });
      if (cached?.props?.length) {
        prizePicksResult = cached;
      }
    }
    if (ppEntry.skipped && ppEntry.notConfigured) {
      const detail = PRIZEPICKS_NOT_CONFIGURED_DETAIL;
      const ppDiag = getPrizePicksDiagnostics();
      sourceStatus.PrizePicks = "Not configured";
      debugInfo.sources.PrizePicks = {
        ...debugInfo.sources.PrizePicks,
        status: "Not configured",
        connectionTier: CONNECTION_TIERS.DEGRADED,
        apiStatus: "Not configured",
        message: detail,
        lineSourceBadge: HEALTH_STATES.NOT_CONFIGURED,
        statusLabel: detail,
        timedOut: false,
        httpExecuted: false,
        diagnostics: ppDiag,
        failureClass: ppDiag.failureClass || "MISSING_PROXY",
      };
    } else if (prizePicksResult && !prizePicksResult.error && !prizePicksResult.notConfigured) {
      console.info("[DFS Source Audit] PrizePicks result", {
        status: prizePicksResult.status,
        props: prizePicksResult.props?.length || 0,
        lineSourceBadge: prizePicksResult.lineSourceBadge,
        rateLimited: prizePicksResult.rateLimited,
        durationMs: ppEntry.durationMs,
        timedOut: ppEntry.timedOut,
      });
      applySourceResult({
        label: "PrizePicks",
        result: prizePicksResult,
        sourceWarnings,
        sourceFailures,
        rawProps,
        sourceStatus,
        debugInfo,
      });
    } else {
      const notConfigured = Boolean(prizePicksResult?.notConfigured || prizePicksResult?.status === "Not configured");
      const detail =
        prizePicksResult?.warnings?.[0] ||
        ppEntry.statusReason ||
        (ppEntry.timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Could not load PrizePicks lines.");
      sourceStatus.PrizePicks = notConfigured ? "Not configured" : ppEntry.timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Failed";
      console.warn("[DFS Source Audit] PrizePicks load issue", {
        notConfigured,
        timedOut: ppEntry.timedOut,
        durationMs: ppEntry.durationMs,
        detail,
      });
      if (!rawProps.length && !notConfigured) {
        sourceFailures.push(sourceFailureMessage(detail, new Error(detail)));
      }
      if (notConfigured && !sourceWarnings.includes(detail)) sourceWarnings.push(detail);
      const failDiag = {
        ...getPrizePicksDiagnostics(),
        uiConnectionTier: notConfigured ? CONNECTION_TIERS.DEGRADED : CONNECTION_TIERS.FAILED,
        lastError: detail,
        httpExecuted: ppEntry.durationMs > 0,
        timedOut: Boolean(ppEntry.timedOut),
      };
      updatePrizePicksDiagnostics(failDiag);
      if (prizePicksResult?.props?.length) {
        applySourceResult({
          label: "PrizePicks",
          result: prizePicksResult,
          sourceWarnings,
          sourceFailures,
          rawProps,
          sourceStatus,
          debugInfo,
        });
      }
      debugInfo.sources.PrizePicks = {
        ...debugInfo.sources.PrizePicks,
        status: notConfigured ? "Not configured" : "Failed",
        connectionTier: notConfigured ? CONNECTION_TIERS.DEGRADED : CONNECTION_TIERS.FAILED,
        apiStatus: notConfigured ? "Not configured" : "Failed",
        message: detail,
        lineSourceBadge: notConfigured ? HEALTH_STATES.NOT_CONFIGURED : "",
        timedOut: Boolean(ppEntry.timedOut),
        diagnostics: failDiag,
      };
    }
  }

  oddsApiPlayerResult = oddsEntry.result?.error ? oddsEntry.result : oddsEntry.result || emptyOddsApiResult();
  if (oddsEntry.skipped && !isOddsApiKeyUsable()) {
    oddsApiPlayerResult = emptyOddsApiResult({
      authDisabled: Boolean(getOddsApiKey()),
      warnings: getOddsApiKey() ? [sanitizeOddsApiUiMessage(ODDS_API_INVALID_KEY_MESSAGE)] : [],
    });
  }
  if (!oddsApiPlayerResult?.props) {
    oddsApiPlayerResult = emptyOddsApiResult({
      timedOut: oddsEntry.timedOut,
      warnings: oddsApiPlayerResult?.warnings || [ENRICHMENT_TIMEOUT_MESSAGE],
    });
  }
  applyOddsApiSourceState(oddsApiPlayerResult, sourceStatus, debugInfo);

  if (!rawProps.length && oddsApiPlayerResult?.props?.length && !oddsApiPlayerResult.authDisabled) {
    rawProps.push(
      ...normalizePropsWithSource(
        oddsApiPlayerResult.props.map((prop) =>
          normalizePropShape(
            { ...prop, playerName: prop.playerName || prop.player || "" },
            { platform: prop.platform || "Odds API", source: prop.source || "Odds API" }
          )
        )
      )
    );
    pipelineFallback = true;
    debugInfo.ingestionFallback = debugInfo.ingestionFallback || "odds-api-priority-fallback";
  }

  sourceFailures.splice(
    0,
    sourceFailures.length,
    ...filterPrizePicksFailuresWhenAlternativesExist(sourceFailures, {
      rawProps,
      oddsApiProps: oddsApiPlayerResult?.props || [],
    })
  );

  const prizePicksProps = prizePicksResult?.props || [];
  const underdogProps = underdogResult?.parsedProps || underdogResult?.props || [];
  console.log("PrizePicks count", prizePicksProps.length);
  console.log("Underdog count", underdogProps.length);

  const mergedProviderProps = mergeProviderRawProps({
    underdogProps,
    prizePicksProps,
  });
  console.log("Merged count", mergedProviderProps.length);

  debugInfo.providerFetchCounts = {
    prizepicks: prizePicksProps.length,
    underdog: underdogProps.length,
    merged: mergedProviderProps.length,
  };
  debugInfo.pipelineProviderRaw = {
    rawPrizePicks: prizePicksProps.length,
    rawUnderdog: underdogProps.length,
    combinedRaw: mergedProviderProps.length,
    afterCacheMerge: 0,
  };
  debugInfo.providerFetchDiagnostics = {
    prizepicks: buildProviderEntryDiagnostics(ppEntry, prizePicksResult || ppEntry.result),
    underdog: buildProviderEntryDiagnostics(udEntry, underdogResult || udEntry.result),
  };
  if (mergedProviderProps.length) {
    rawProps.length = 0;
    rawProps.push(...ensureMlbSportOnProps(mergedProviderProps));
  } else if (rawProps.length) {
    pipelineFallback = true;
    debugInfo.ingestionFallback = debugInfo.ingestionFallback || "partial-provider-raw";
  } else {
    const sdioImmediate = await injectSportsDataIfProvidersEmpty({
      mergedCount: 0,
      fetchSport,
      sourceStatus,
      debugInfo,
    });
    if (sdioImmediate) {
      rawProps.length = 0;
      rawProps.push(...normalizePropsWithSource(sdioImmediate.rawProps));
      pipelineFallback = true;
    }
  }

  if (!rawProps.length && prizePicksResult?.rateLimited) {
    sourceWarnings.unshift(PRIZEPICKS_RATE_LIMIT_MESSAGE);
  }

  const scopedCoreRawProps = filterActiveSportProps(ensureMlbSportOnProps([...rawProps]));
  let coreDisplayProps = buildAllDisplayProps({
    prizePicksResult,
    underdogResult,
    sport: fetchSport,
    selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
    oddsApi: [],
  });
  if (!coreDisplayProps.length && scopedCoreRawProps.length) {
    coreDisplayProps = normalizePropsWithSource(
      enrichDisplayPropsPipeline(
        normalizePropsWithSource(scopedCoreRawProps).map((prop) =>
          normalizeDisplayProp(prop, {
            selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
            source: prop.platform || prop.source || "PrizePicks",
            status: String(prop.lineSourceBadge || "").toUpperCase() === "CACHED" ? "cached" : "live",
          })
        )
      )
    );
  } else if (coreDisplayProps.length) {
    coreDisplayProps = normalizePropsWithSource(coreDisplayProps);
  }

  logPipelinePropCounts("post-merge", {
    raw: rawProps.length,
    normalized: coreDisplayProps.length,
    filteredMlb: scopedCoreRawProps.length,
  });

  if (
    typeof onCoreReady === "function" &&
    !MLB_ONLY_MODE &&
    (coreDisplayProps.length || scopedCoreRawProps.length)
  ) {
    try {
      onCoreReady(
        buildCoreBoardPreview({
          rawProps: scopedCoreRawProps,
          allDisplayProps: coreDisplayProps,
          sourceStatus,
          debugInfo,
        })
      );
    } catch (error) {
      console.warn("[DFS Pipeline] onCoreReady failed", error);
    }
  }

  const scopedRawProps = filterActiveSportProps(ensureMlbSportOnProps(rawProps));
  if (MLB_ONLY_MODE && scopedRawProps.length !== rawProps.length) {
    console.info("[DFS Pipeline] MLB-only scope removed non-MLB props", {
      before: rawProps.length,
      after: scopedRawProps.length,
    });
  }
  rawProps.length = 0;
  rawProps.push(...normalizePropsWithSource(scopedRawProps));
  if (debugInfo.pipelineProviderRaw) {
    debugInfo.pipelineProviderRaw.afterCacheMerge = rawProps.length;
  }
  if (!debugInfo.parsedUnderdogProps?.length) {
    debugInfo.parsedUnderdogProps = filterUnderdogStreakPool(rawProps);
  }

  const parsedCount = Math.max(
    Number(prizePicksResult?.props?.length || 0),
    Number(underdogResult?.props?.length || 0),
    rawProps.length
  );
  let allDisplayProps = buildGuaranteedBaseFeedDisplay({
    rawProps,
    underdogResult,
    prizePicksResult,
    fetchSport,
    selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
    oddsApi: [],
  });

  if (!allDisplayProps.length && oddsApiPlayerResult?.props?.length) {
    allDisplayProps = normalizePropsWithSource(
      buildAllDisplayProps({
        prizePicksResult,
        underdogResult,
        sport: fetchSport,
        selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
        oddsApi: oddsApiPlayerResult.authDisabled ? [] : oddsApiPlayerResult.props || [],
      })
    );
  }

  if (!allDisplayProps.length && rawProps.length) {
    allDisplayProps = mapRawToDisplayProps(rawProps, {
      fetchSport,
      selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
    });
  }

  logPipelinePropCounts("display-built", {
    raw: rawProps.length,
    normalized: allDisplayProps.length,
    filteredMlb: scopedRawProps.length,
    display: allDisplayProps.length,
  });

  if (!allDisplayProps.length && rawProps.length) {
    void withFetchTimeout(
      () => enrichPropsWithSportsData(rawProps),
      getSportsDataTimeoutMs(),
      {
        label: "SportsDataIO optional enrich",
        fallback: () => ({ props: rawProps, warnings: [ENRICHMENT_TIMEOUT_MESSAGE], enrichedCount: 0 }),
      }
    );
  } else if (allDisplayProps.length) {
    allDisplayProps = normalizePropsWithSource(allDisplayProps);
  }

  if (!allDisplayProps.length && rawProps.length) {
    const earlyFallback = await resolveIngestionFallback({
      rawProps,
      allDisplayProps,
      underdogResult,
      prizePicksResult,
      sourceStatus,
      fetchSport,
    });
    if (earlyFallback.allDisplayProps?.length) {
      rawProps.length = 0;
      rawProps.push(...earlyFallback.rawProps);
      allDisplayProps = earlyFallback.allDisplayProps;
      pipelineFallback = true;
      debugInfo.ingestionFallback = earlyFallback.source;
    }
  }

  logAllDisplayPropsSample(allDisplayProps);
  logPipelineStage("fetch.allDisplayProps", { count: allDisplayProps.length, raw: rawProps.length, parsed: parsedCount });
  reportProgress("NORMALIZE");

  let deferredDisplayProps = [];
  const normalizedBeforeStartupCap = allDisplayProps.length;
  const startupLimited = limitStartupPropPool(workingNormalProps.length ? workingNormalProps : allDisplayProps);
  deferredDisplayProps = startupLimited.deferredProps;
  if (startupLimited.startupProps.length && workingNormalProps.length) {
    workingNormalProps = startupLimited.startupProps;
    workingActiveProps = workingActiveProps.slice(0, startupLimited.startupProps.length);
  } else if (allDisplayProps.length > STARTUP_NORMALIZED_PROP_LIMIT) {
    deferredDisplayProps = allDisplayProps.slice(STARTUP_NORMALIZED_PROP_LIMIT);
  }
  debugInfo.startupPropLimit = {
    processed: allDisplayProps.length,
    scoringBatch: workingNormalProps.length,
    deferred: deferredDisplayProps.length,
    eligible: startupLimited.totalEligible || normalizedBeforeStartupCap,
  };
  endPerformanceTimer(PERFORMANCE_TIMERS.normalizeProps);

  debugInfo.allDisplayPropsCount = allDisplayProps.length;
  debugInfo.displayDebugCounts = buildDisplayDebugCounts({
    raw: rawProps.length,
    parsed: parsedCount,
    normalized: allDisplayProps.length,
    display: allDisplayProps.length,
    selectedSport: fetchSport,
    rejected: Math.max(0, rawProps.length - allDisplayProps.length),
  });

  let pipelineAudit = safeCreateEmptyPipelineAudit();
  try {
    pipelineAudit = createEmptyPipelineAudit();
  } catch (error) {
    console.warn("[DFS Pipeline] audit initialization failed; using safe fallback", error);
  }

  pipelineAudit.fetched = rawProps.length;
  // Source parser audits include non-MLB rejections — keep app audit MLB-only.
  if (!MLB_ONLY_MODE) {
    if (prizePicksResult?.pipelineAudit) {
      const ppAudit = coercePipelineAudit(prizePicksResult.pipelineAudit);
      pipelineAudit.normalized += ppAudit.normalized || 0;
      Object.assign(pipelineAudit.filterReasons, ppAudit.filterReasons || {});
    }
    if (underdogResult?.pipelineAudit) {
      const udAudit = coercePipelineAudit(underdogResult.pipelineAudit);
      pipelineAudit.normalized += udAudit.normalized || 0;
      Object.assign(pipelineAudit.filterReasons, udAudit.filterReasons || {});
    }
  }

  const filterOptions = { includeUncertain: readIncludeUncertainPreference(), ...readFilterPrefs() };
  const filtered = isSafeModeEnabled()
    ? {
        slateProps: filterActiveSportProps(rawProps),
        canonicalProps: filterActiveSportProps(rawProps),
        activeProps: filterActiveSportProps(rawProps),
        normalProps: filterActiveSportProps(rawProps),
      }
    : runFilterPipeline({
    rawProps,
    pipelineAudit,
    recordFilterReason,
    filterOptions,
    filterUpcomingSlate,
    validateAndFilterProps,
    canonicalizeSportProp,
    labelPartialIfMissingTime,
    ensurePropStartTime,
    getBaseActiveFilterReason,
    getPreScoringFilterReason,
    matchesStatTypeFilter,
    prioritizePreScoringProps,
    maxPreScoreProps: MAX_PRE_SCORE_PROPS,
    statType,
    logFilteredProp,
  });
  const { slateProps, canonicalProps, activeProps, normalProps } = filtered;
  let usablePropsPool = buildUsablePropsPool(rawProps);
  let workingActiveProps = activeProps;
  let workingNormalProps = normalProps;

  const verifiedFromUsable = filterVerifiedSportsbookProps(usablePropsPool);

  let pipelineStageCounts = buildPipelineStageReport({
    totalFetched: rawProps.length,
    normalized: Math.max(pipelineAudit.normalized, canonicalProps.length, usablePropsPool.length),
    verified: Math.max(canonicalProps.length, verifiedFromUsable.length),
    sportFiltered: slateProps.length,
    scoreFiltered: 0,
    finalDisplayed: 0,
    samples: {
      totalFetched: samplePropsAtStage(rawProps),
      normalized: samplePropsAtStage(usablePropsPool.length ? usablePropsPool : canonicalProps),
      verified: samplePropsAtStage(verifiedFromUsable.length ? verifiedFromUsable : canonicalProps),
      sportFiltered: samplePropsAtStage(slateProps),
    },
  });
  logPipelineStageReport(pipelineStageCounts, "Prop Pipeline");

  pipelineAudit.normalized = Math.max(pipelineAudit.normalized, canonicalProps.length);
  pipelineAudit.active = workingActiveProps.length;
  pipelineAudit.preScoring = workingNormalProps.length;
  pipelineAudit.preScoringTotal = workingNormalProps.length;
  attachSourceFilterCounts(debugInfo, {
    rawProps: canonicalProps.length ? canonicalProps : usablePropsPool,
    activeProps: workingActiveProps,
    normalProps: workingNormalProps,
    slateProps,
  });
  debugInfo.pipelineAudit = pipelineAudit;
  debugInfo.usablePropsCount = usablePropsPool.length;
  debugInfo.upcomingSlateCount = pipelineAudit.upcomingSlate;
  debugInfo.slateExcludedCount = pipelineAudit.slateExcluded;
  debugInfo.pregameWindowHours = filterOptions.pregameWindowHours ?? DEFAULT_PREGAME_WINDOW_HOURS;
  if (shouldLogVerbose()) logPipelineAudit("board", pipelineAudit);

  logPipelinePropCounts("post-filter", {
    raw: rawProps.length,
    normalized: allDisplayProps.length,
    filteredMlb: workingNormalProps.length,
    display: allDisplayProps.length,
  });

  if (allDisplayProps.length) {
    const startupKeys = new Set(
      allDisplayProps.map(
        (prop) =>
          `${String(prop.playerName || prop.player || "").trim()}|${String(prop.statType || prop.market || "").trim()}|${Number(prop.line)}`
      )
    );
    workingNormalProps = workingNormalProps
      .filter((prop) =>
        startupKeys.has(
          `${String(prop.playerName || prop.player || "").trim()}|${String(prop.statType || prop.market || "").trim()}|${Number(prop.line)}`
        )
      )
      .slice(0, STARTUP_NORMALIZED_PROP_LIMIT);
    workingActiveProps = workingActiveProps
      .filter((prop) =>
        startupKeys.has(
          `${String(prop.playerName || prop.player || "").trim()}|${String(prop.statType || prop.market || "").trim()}|${Number(prop.line)}`
        )
      )
      .slice(0, STARTUP_NORMALIZED_PROP_LIMIT);
  }

  beginPerformanceTimer(PERFORMANCE_TIMERS.generateProjections);
  reportProgress("PROJECT");

  if (!allDisplayProps.length && (usablePropsPool.length || canonicalProps.length || rawProps.length)) {
    allDisplayProps = mapRawToDisplayProps(
      usablePropsPool.length ? usablePropsPool : canonicalProps.length ? canonicalProps : rawProps,
      {
        fetchSport,
        selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
      }
    );
    if (allDisplayProps.length) {
      pipelineFallback = true;
      debugInfo.ingestionFallback = debugInfo.ingestionFallback || "filter-pipeline-recovery";
    }
  }

  if (!allDisplayProps.length) {
    const fallback = await resolveIngestionFallback({
      rawProps,
      allDisplayProps,
      underdogResult,
      prizePicksResult,
      sourceStatus,
      fetchSport,
    });
    if (fallback.allDisplayProps?.length) {
      allDisplayProps = fallback.allDisplayProps;
      rawProps.length = 0;
      rawProps.push(...fallback.rawProps);
      pipelineFallback = true;
      workingActiveProps = filterActiveSportProps(allDisplayProps);
      workingNormalProps = workingActiveProps;
      usablePropsPool = buildUsablePropsPool(rawProps);
      debugInfo.ingestionFallback = fallback.source;
      debugInfo.parserPreview =
        typeof window !== "undefined" ? window.__DEBUG_PARSER_PREVIEW__ || [] : [];
    } else {
      const lastGood = readLastGoodBoard();
      if (lastGood) {
        const restored = boardFromLastGood(lastGood, sourceStatus);
        allDisplayProps = restored.allDisplayProps;
        rawProps.length = 0;
        rawProps.push(...restored.props);
        pipelineFallback = true;
        workingActiveProps = filterActiveSportProps(allDisplayProps);
        workingNormalProps = workingActiveProps;
        usablePropsPool = buildUsablePropsPool(rawProps);
        debugInfo.ingestionFallback = restored.ingestionSource || "last-good-board";
        sourceStatus.SportsDataIO = sourceStatus.SportsDataIO || lastGood.sourceStatus?.SportsDataIO || "Connected";
      } else {
        const baseFeed = buildGuaranteedBaseFeedDisplay({
          rawProps,
          underdogResult,
          prizePicksResult,
          fetchSport,
          selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
        });
        if (baseFeed.length) {
          allDisplayProps = baseFeed;
          rawProps.length = 0;
          rawProps.push(...baseFeed);
          pipelineFallback = true;
          workingActiveProps = filterActiveSportProps(allDisplayProps);
          workingNormalProps = workingActiveProps.length ? workingActiveProps : allDisplayProps;
          usablePropsPool = buildUsablePropsPool(allDisplayProps);
          debugInfo.ingestionFallback = "base-feed-recovery";
        } else {
    debugInfo.totals = {
      rawPropsLoaded: canonicalProps.length,
      upcomingSlateCount: pipelineAudit.upcomingSlate,
      slateExcludedCount: pipelineAudit.slateExcluded,
      activeProps: activeProps.length,
      propsAfterFilters: normalProps.length,
      recommendedProps: 0,
      watchlistProps: 0,
      streakProps: 0,
    };
    const finalStatus = finalizeSourceStatus(sourceStatus, { "The Odds API": "Partial" });
    const emptyPartition = partitionWarnings([], [...sourceFailures, NO_ACTIVE_SCHEDULED_PROPS_MESSAGE], finalStatus);
    const emptyHealth = {
      ...buildSourceHealth([], sourceFailures, finalStatus),
      PrizePicks: finalStatus.PrizePicks,
      Underdog: finalStatus.Underdog,
      "The Odds API": finalStatus["The Odds API"],
      injuries: "Partial",
    };
    pipelineAudit = coercePipelineAudit(pipelineAudit);
    finalizePipelineCounters(pipelineAudit, {
      displayed: [],
      rejected: pipelineAudit.fetched || 0,
      stale: 0,
      cached: 0,
      live: 0,
    });
    return {
      props: [],
      usableProps: [],
      allDisplayProps: [],
      pipelineFallback: false,
      pipelineStageCounts,
      watchlist: [],
      streakProps: [],
      sourceStatus: finalStatus,
      sourceHealth: emptyHealth,
      criticalWarnings: emptyPartition.criticalWarnings,
      degradedWarnings: emptyPartition.degradedWarnings,
      warnings: unique([...emptyPartition.degradedWarnings, ...emptyPartition.criticalWarnings]),
      debugInfo: attachDebugArtifacts(sanitizeDebugInfoForMlbOnly(debugInfo), pipelineAudit),
      pipelineAudit: coercePipelineAudit(pipelineAudit),
    };
        }
      }
    }
  }

  if (!workingNormalProps.length && allDisplayProps.length) {
    workingNormalProps = allDisplayProps;
    workingActiveProps = allDisplayProps;
  }

  reportProgress("MATCH");
  resetPipelineExecutionCounters();
  setPipelineStageCount(PIPELINE_STAGES.FETCHED_PROPS_COUNT, rawProps.length);
  setPipelineStageCount(PIPELINE_STAGES.NORMALIZED_PROPS_COUNT, allDisplayProps.length);

  const background = {
    comparisons: [],
    stats: resolveStableStatsMap(null).statsMap,
    news: new Map(),
    manualStatsMap: readManualStatsMap(),
  };
  const backgroundWarnings = [];
  let statsTimedOut = false;
  let pipelinePropCountSnapshot = {
    normalizedProps: allDisplayProps.length,
    afterSportFilter: 0,
    afterMlbOnlyFilter: 0,
    afterDuplicateRemoval: 0,
    afterMarketFilter: 0,
    afterPlayerNormalization: 0,
    afterLineValidation: 0,
    afterProjectionFilter: 0,
    afterProjectionMerge: 0,
    projectedProps: 0,
    afterHistoricalAttachment: 0,
    rejections: {},
  };

  if (MLB_ONLY_MODE) {
    resetProjectionFetchDebug();

    const normalizedPool = [...allDisplayProps];
    const normalizedPropsSnapshot = normalizedPool.length;
    const boardPool = buildMlbProjectionBoardPool(normalizedPool);
    const sportFilteredProps = boardPool.afterSportFilter;
    const marketFilteredProps = boardPool.afterMarketFilter;
    const projectionCandidates = boardPool.projectionCandidates;
    allDisplayProps = boardPool.boardProps;
    const workingNormalPool = buildMlbProjectionBoardPool(workingNormalProps);
    const workingActivePool = buildMlbProjectionBoardPool(workingActiveProps);
    workingNormalProps = workingNormalPool.boardProps;
    workingActiveProps = workingActivePool.boardProps;
    pipelinePropCountSnapshot = {
      normalizedProps: normalizedPropsSnapshot,
      afterSportFilter: sportFilteredProps.length,
      afterMlbOnlyFilter: boardPool.afterMlbOnlyFilter.length,
      afterDuplicateRemoval: boardPool.afterDuplicateRemoval.length,
      afterMarketFilter: marketFilteredProps.length,
      afterPlayerNormalization: boardPool.afterPlayerNormalization.length,
      afterLineValidation: boardPool.afterLineValidation.length,
      afterProjectionFilter: projectionCandidates.length,
      afterProjectionMerge: allDisplayProps.length,
      projectedProps: 0,
      afterHistoricalAttachment: 0,
      rejections: { ...boardPool.rejections },
    };
    setPipelineStageCount(PIPELINE_STAGES.NORMALIZED_PROPS_COUNT, allDisplayProps.length);

    const enrichmentSettled = await providerWave.awaitEnrichmentFeeds();
    const seasonEntry = unwrapProviderSettled(enrichmentSettled[0]);
    let seasonStatsData = applySeasonStatsProviderResult(seasonEntry, debugInfo);
    background.sportsDataSeasonStats = seasonStatsData;

    const statsFetchProps = pickUniquePropsForStatsFetch(
      projectionCandidates.length ? projectionCandidates : allDisplayProps.length ? allDisplayProps : workingNormalProps
    );
    traceProjectionExecutionPath("fetchDFSProps:stats-fetch-start", {
      statsFetchPropCount: statsFetchProps.length,
      displayPropCount: allDisplayProps.length,
      statsCapMs: getMlbStatsFetchTimeoutMs(),
      enrichmentTimeoutMs,
      mlbOnlyMode: MLB_ONLY_MODE,
    });

    const statsApplied = await fetchMlbProjectionStatsBlocking(statsFetchProps, debugInfo);
    const stableStats = resolveStableStatsMap(statsApplied.stats);
    background.stats = stableStats.statsMap;
    statsTimedOut = statsApplied.timedOut;
    markStatsFetchTimedOut(statsTimedOut);
    backgroundWarnings.push(...(statsApplied.warnings || []));
    debugInfo.statsMap = stableStats.statsMap.size ? stableStats.statsMap : null;
    debugInfo.statsLoadedCount = stableStats.statsMap.size;
    debugInfo.statsFromCache = stableStats.usedCache || statsApplied.usedCache;
    traceProjectionExecutionPath("fetchDFSProps:stats-fetch-done", {
      statsMapSize: stableStats.statsMap.size,
      statsTimedOut,
      statsFailed: statsApplied.failed,
      statsFromCache: stableStats.usedCache,
      statsMapIsMap: stableStats.statsMap instanceof Map,
    });
    if (stableStats.statsMap.size > 0) {
      const { matchedPlayers, gameLogsFound } = summarizeStatsMap(stableStats.statsMap);
      setPipelineStageCount(PIPELINE_STAGES.MATCHED_PLAYERS_COUNT, matchedPlayers);
      setPipelineStageCount(PIPELINE_STAGES.GAME_LOGS_FOUND_COUNT, gameLogsFound);
    } else {
      console.warn("[MLB Projection Pipeline] stats fetch produced no profiles", {
        statsFetchPropCount: statsFetchProps.length,
        displayPropCount: allDisplayProps.length,
        timedOut: statsTimedOut,
      });
    }

    const perfSettled = await providerWave.awaitAllForPerf();
    logProviderFetchPerformance([
      ...perfSettled.map((row) => unwrapProviderSettled(row)),
      {
        label: "Stats",
        durationMs: statsApplied.durationMs,
        timedOut: statsApplied.timedOut,
        skipped: false,
        error: statsApplied.failed,
      },
    ]);

    debugInfo.statsMap = stableStats.statsMap.size ? stableStats.statsMap : null;

    const canMergeProjections = allDisplayProps.length > 0;
    if (canMergeProjections) {
      const mergeContext = {
        seasonStats: seasonStatsData,
        statsMap: stableStats.statsMap,
      };
      const merged = mergeProjectionsOntoProps(allDisplayProps, mergeContext);
      allDisplayProps = merged.props;
      workingNormalProps = mergeProjectionsOntoProps(workingNormalProps, mergeContext).props;
      workingActiveProps = mergeProjectionsOntoProps(workingActiveProps, mergeContext).props;
      pipelinePropCountSnapshot.afterProjectionMerge = allDisplayProps.length;
      pipelinePropCountSnapshot.projectedProps = countMergedProjections(allDisplayProps);
      pipelinePropCountSnapshot.rejections = {
        ...pipelinePropCountSnapshot.rejections,
        noProjectionFormula: Math.max(
          0,
          allDisplayProps.length - pipelinePropCountSnapshot.projectedProps
        ),
      };
      debugInfo.projectionMerge = merged.debug;

      const matchedPlayers = stableStats.statsMap.size
        ? summarizeStatsMap(stableStats.statsMap).matchedPlayers
        : 0;
      const gameLogsFound = stableStats.statsMap.size
        ? summarizeStatsMap(stableStats.statsMap).gameLogsFound
        : 0;
      debugInfo.projectionCoverageAudit = buildProjectionCoverageAudit({
        rawPropCount: rawProps.length,
        normalizedProps: normalizedPropsSnapshot,
        sportFilteredProps,
        marketFilteredProps,
        projectedProps: allDisplayProps,
        statsMap: stableStats.statsMap.size ? stableStats.statsMap : null,
        matchedPlayers,
        gameLogsFound,
      });
      logProjectionCoverageAudit(debugInfo.projectionCoverageAudit);

      const historicalContext = {
        statsMap: stableStats.statsMap.size ? stableStats.statsMap : null,
        seasonStats: seasonStatsData,
        logAttach: import.meta.env.DEV,
      };
      allDisplayProps = attachHistoricalStatsToProps(allDisplayProps, historicalContext);
      workingNormalProps = attachHistoricalStatsToProps(workingNormalProps, historicalContext);
      workingActiveProps = attachHistoricalStatsToProps(workingActiveProps, historicalContext);
      debugInfo.statsAttachmentAudit = buildStatsAttachmentMetrics(allDisplayProps, historicalContext);
      const historicalCounts = countHistoricalAttachment(allDisplayProps, stableStats.statsMap);
      pipelinePropCountSnapshot.afterHistoricalAttachment = historicalCounts.attached;
      pipelinePropCountSnapshot.rejections = {
        ...pipelinePropCountSnapshot.rejections,
        noHistoricalData: historicalCounts.missing,
      };
      syncMlbStatsStatusFromAttachment(debugInfo.statsAttachmentAudit, allDisplayProps, {
        statsFromCache: debugInfo.statsFromCache,
        usedCache: debugInfo.statsFromCache,
      });
      if (import.meta.env.DEV && allDisplayProps[0]) {
        emitSportDetectionDebug(allDisplayProps[0]);
      }
      debugInfo.projectionProvider = buildProjectionProviderSummary({
        statsMap: background.stats,
        seasonStats: seasonStatsData,
        mergeDebug: merged.debug,
        mergedProps: merged.props,
        statsTimedOut,
        statsEnrichmentFailed: Boolean(debugInfo.statsEnrichmentFailed) && merged.debug?.projectionCandidateCount === 0,
        statsEnrichmentError: debugInfo.statsEnrichmentError || "",
      });
      if (typeof onCoreReady === "function" && allDisplayProps.length) {
        try {
          onCoreReady(
            buildCoreBoardPreview({
              rawProps: scopedRawProps,
              allDisplayProps,
              sourceStatus,
              debugInfo,
            })
          );
        } catch (error) {
          console.warn("[DFS Pipeline] onCoreReady failed after stats merge", error);
        }
      }
    } else {
      debugInfo.projectionProvider = buildProjectionProviderSummary({
        statsMap: background.stats,
        seasonStats: seasonStatsData,
        mergeDebug: null,
        mergedProps: [],
        statsTimedOut: false,
        statsEnrichmentFailed: Boolean(debugInfo.statsEnrichmentFailed),
        statsEnrichmentError: debugInfo.statsEnrichmentError || "",
      });
    }

    const secondaryCapMs = Math.min(enrichmentTimeoutMs, 8000);
    const secondaryJobs = [
      { label: "sportsbook", run: () => fetchSportsbookComparison({ props: workingNormalProps }) },
      { label: "news", run: () => fetchInjuryNews({ props: workingNormalProps }) },
    ];
    const secondaryResults = await Promise.allSettled(
      secondaryJobs.map((job) =>
        withFetchTimeout(job.run, secondaryCapMs, {
          label: job.label,
          fallback: () => enrichmentBackgroundFallback(job.label),
        })
      )
    );
    secondaryResults.forEach((result, index) => {
      const label = secondaryJobs[index].label;
      if (result.status !== "fulfilled") {
        if (label === "sportsbook") backgroundWarnings.push("Sportsbook comparison unavailable.");
        if (label === "news") backgroundWarnings.push("Could not load injury/news data.");
        return;
      }
      backgroundWarnings.push(...(result.value.warnings || []));
      if (label === "sportsbook") {
        background.comparisons = result.value.comparisons || [];
        sourceStatus["The Odds API"] = result.value.cached
          ? "Cached"
          : result.value.rateLimited
            ? "Cached"
            : sportsbookSourceStatus(result.value);
        const playerPropsCount = Number(debugInfo.sources["The Odds API"]?.propsAfterParsing || 0);
        debugInfo.sources["The Odds API"] = {
          ...debugInfo.sources["The Odds API"],
          status: sourceStatus["The Odds API"],
          apiStatus: sourceStatus["The Odds API"],
          rawPropsLoaded: Math.max(playerPropsCount, normalProps.length),
          propsAfterParsing: Math.max(playerPropsCount, background.comparisons.length),
          propsAfterFilters: background.comparisons.length,
          usablePropsCount: Math.max(playerPropsCount, background.comparisons.length),
          message:
            playerPropsCount > 0
              ? `${playerPropsCount} player props · ${background.comparisons.length} line comparisons`
              : background.comparisons.length > 0
                ? (result.value.warnings || []).join(" ")
                : EMPTY_SOURCE_MESSAGE,
          lastSuccessfulFetchAt: result.value.lastSuccessfulFetchAt || debugInfo.sources["The Odds API"]?.lastSuccessfulFetchAt || "",
          lineSourceBadge:
            playerPropsCount > 0 || background.comparisons.length > 0
              ? result.value.cached || result.value.rateLimited
                ? "CACHED"
                : "LIVE"
              : debugInfo.sources["The Odds API"]?.lineSourceBadge || "EMPTY",
        };
      }
      if (label === "news") background.news = result.value.news || new Map();
    });
  } else {
  const statsFetchProps = pickUniquePropsForStatsFetch(workingNormalProps);
  const statsApplied = await fetchMlbProjectionStatsBlocking(statsFetchProps, debugInfo);
  const stableStats = resolveStableStatsMap(statsApplied.stats);
  background.stats = stableStats.statsMap;
  debugInfo.statsLoadedCount = stableStats.statsMap.size;
  debugInfo.statsMap = stableStats.statsMap.size ? stableStats.statsMap : null;
  debugInfo.statsFromCache = stableStats.usedCache || statsApplied.usedCache;
  backgroundWarnings.push(...(statsApplied.warnings || []));
  statsTimedOut = statsApplied.timedOut;
  markStatsFetchTimedOut(statsTimedOut);

  const backgroundJobs = [
    { label: "sportsbook", run: () => fetchSportsbookComparison({ props: workingNormalProps }) },
    { label: "news", run: () => fetchInjuryNews({ props: workingNormalProps }) },
  ];
  const backgroundCapMs = Math.min(enrichmentTimeoutMs, 6000);
  const settledBackground = await Promise.race([
    Promise.allSettled(
      backgroundJobs.map((job) =>
        withFetchTimeout(job.run, backgroundCapMs, {
          label: job.label,
          fallback: () => enrichmentBackgroundFallback(job.label),
        })
      )
    ),
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve(
            backgroundJobs.map((job) => ({
              status: "fulfilled",
              value: enrichmentBackgroundFallback(job.label),
            }))
          ),
        backgroundCapMs
      )
    ),
  ]);

  settledBackground.forEach((result, index) => {
    const label = backgroundJobs[index].label;
    if (result.status === "fulfilled") {
      backgroundWarnings.push(...(result.value.warnings || []));
      if (label === "sportsbook") {
        background.comparisons = result.value.comparisons || [];
        sourceStatus["The Odds API"] = result.value.cached
          ? "Cached"
          : result.value.rateLimited
            ? "Cached"
            : sportsbookSourceStatus(result.value);
        const playerPropsCount = Number(debugInfo.sources["The Odds API"]?.propsAfterParsing || 0);
        debugInfo.sources["The Odds API"] = {
          ...debugInfo.sources["The Odds API"],
          status: sourceStatus["The Odds API"],
          apiStatus: sourceStatus["The Odds API"],
          rawPropsLoaded: Math.max(playerPropsCount, normalProps.length),
          propsAfterParsing: Math.max(playerPropsCount, background.comparisons.length),
          propsAfterFilters: background.comparisons.length,
          usablePropsCount: Math.max(playerPropsCount, background.comparisons.length),
          message:
            playerPropsCount > 0
              ? `${playerPropsCount} player props · ${background.comparisons.length} line comparisons`
              : background.comparisons.length > 0
                ? (result.value.warnings || []).join(" ")
                : EMPTY_SOURCE_MESSAGE,
          lastSuccessfulFetchAt: result.value.lastSuccessfulFetchAt || debugInfo.sources["The Odds API"]?.lastSuccessfulFetchAt || "",
          lineSourceBadge:
            playerPropsCount > 0 || background.comparisons.length > 0
              ? result.value.cached || result.value.rateLimited
                ? "CACHED"
                : "LIVE"
              : debugInfo.sources["The Odds API"]?.lineSourceBadge || "EMPTY",
        };
      }
      if (label === "news") background.news = result.value.news || new Map();
      return;
    }

    if (label === "sportsbook") {
      const timedOut = Boolean(result.value?.timedOut);
      sourceStatus["The Odds API"] = timedOut
        ? ENRICHMENT_TIMEOUT_MESSAGE
        : "Failed";
      backgroundWarnings.push(timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Sportsbook comparison unavailable.");
      debugInfo.sources["The Odds API"] = {
        ...debugInfo.sources["The Odds API"],
        status: timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Failed",
        apiStatus: timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Failed",
        message: timedOut ? ENRICHMENT_TIMEOUT_MESSAGE : "Sportsbook comparison unavailable.",
      };
    }
    if (label === "news") backgroundWarnings.push("Could not load injury/news data.");
  });
  }

  if (background.stats instanceof Map) {
    const { matchedPlayers, gameLogsFound } = summarizeStatsMap(background.stats);
    setPipelineStageCount(PIPELINE_STAGES.MATCHED_PLAYERS_COUNT, matchedPlayers);
    setPipelineStageCount(PIPELINE_STAGES.GAME_LOGS_FOUND_COUNT, gameLogsFound);
  }

  if (statsTimedOut) {
    backgroundWarnings.push("MLB stats fetch timed out before projections could complete.");
  }

  const lineComparisonMap = buildLineComparisonMap(workingNormalProps);
  const sportsbookComparisonMap = buildSportsbookComparisonMap(background.comparisons);
  const lineMovementMap = updateLineMovementMap(workingActiveProps, sportsbookComparisonMap);
  const scoringContext = {
    stats: background.stats,
    news: background.news,
    lineComparisonMap,
    sportsbookComparisonMap,
    lineMovementMap,
    manualStatsMap: background.manualStatsMap,
  };
  const historyRows = readHistory();
  scoringContext.historyRows = historyRows;
  const historyWeights = buildHistoryAccuracyWeights(historyRows);
  reportProgress("PROJECT");
  resetProjectionPipelineErrors();
  let emergencyDiagnostic = null;
  if (MLB_ONLY_MODE && isEmergencyProjectionDiagnosticEnabled()) {
    try {
      emergencyDiagnostic = await runEmergencyProjectionDiagnostic({
        buildProfile: buildMlbStatProfileFromLogs,
        scoreDFSProp,
        scoringContext: {
          ...background,
          lineComparisonMap,
          sportsbookComparisonMap,
          lineMovementMap,
          historyWeights,
          historyRows,
        },
      });
      console.info("[MLB Emergency Diagnostic] canary finished", {
        success: emergencyDiagnostic?.success,
        errors: emergencyDiagnostic?.errors?.length ?? 0,
        projection: emergencyDiagnostic?.forcedVerifiedProp?.projection ?? null,
      });
    } catch (error) {
      emergencyDiagnostic = {
        success: false,
        errors: [{ stage: "emergency_diagnostic", reason: error.message }],
        stages: [],
      };
      console.error("[MLB Emergency Diagnostic] unexpected failure", error);
    }
  }

  const scoredProps = [];
  if (emergencyDiagnostic?.success && emergencyDiagnostic.forcedVerifiedProp) {
    scoredProps.push(emergencyDiagnostic.forcedVerifiedProp);
  }
  const scoreCache = new Map();
  for (let index = 0; index < workingNormalProps.length; index += 75) {
    const batch = workingNormalProps.slice(index, index + 75);
    batch.forEach((prop) => {
      const cacheKey = `${prop.id}|${prop.line}|${prop.statType}|${prop.platform}|mlb-proj-v2`;
      let scored = scoreCache.get(cacheKey);
      if (!scored) {
        const persisted = readSmartCacheIfFresh("projection-score", cacheKey, CACHE_TTL.PROJECTIONS_MS);
        if (persisted?.payload) {
          scored = persisted.payload;
        } else {
          scored = scoreDFSProp(prop, {
            ...background,
            lineComparisonMap,
            sportsbookComparisonMap,
            lineMovementMap,
            historyWeights,
            historyRows,
          });
          if (scored) writeSmartCache("projection-score", cacheKey, scored, { savedAt: Date.now() });
        }
        scoreCache.set(cacheKey, scored);
      }
      if (!scored) return;
      const invalidReason = getScoringRejectReason(scored);
      if (invalidReason) {
        recordFilterReason(pipelineAudit, invalidReason, prop, "scoring");
        logFilteredProp(prop, invalidReason);
        return;
      }
      scoredProps.push(scored);
    });
    if (index + 75 < workingNormalProps.length) await yieldToMainThread();
  }
  pipelineAudit.scored = scoredProps.length;
  pipelineAudit = attachDecisionDebug(pipelineAudit, scoredProps);

  const projectionsGenerated = allDisplayProps.filter(
    (prop) => Number.isFinite(Number(prop.projection ?? prop.projectedValue)) && Number(prop.projection ?? prop.projectedValue) > 0
  ).length;
  setPipelineStageCount(PIPELINE_STAGES.PROJECTIONS_GENERATED_COUNT, projectionsGenerated);

  const mlbProjectionDiagnostics = buildMlbProjectionDiagnostics({
    scoredProps,
    statsMap: background.stats,
    emergencyDiagnostic,
  });
  markProjectionsComplete((background.stats instanceof Map && background.stats.size > 0) || !statsTimedOut);
  logPipelineExecutionSummary("Post-scoring pipeline summary");
  debugInfo.mlbProjectionDiagnostics = mlbProjectionDiagnostics;
  debugInfo.verifiedProps = mlbProjectionDiagnostics.verifiedProps;
  debugInfo.verifiedPropsCount = mlbProjectionDiagnostics.verifiedPropsCount;
  debugInfo.emergencyProjectionDiagnostic = emergencyDiagnostic;
  debugInfo.projectionErrors = mlbProjectionDiagnostics.projectionErrors;

  allDisplayProps = mergeScoredIntoDisplayProps(allDisplayProps, scoredProps);
  if (emergencyDiagnostic?.success && emergencyDiagnostic.forcedVerifiedProp) {
    const canary = emergencyDiagnostic.forcedVerifiedProp;
    const hasCanary = allDisplayProps.some(
      (row) => row.id === canary.id || row.isEmergencyCanary
    );
    if (!hasCanary) {
      allDisplayProps = [canary, ...allDisplayProps];
    }
  }
  workingNormalProps = mergeScoredIntoDisplayProps(workingNormalProps, scoredProps);
  workingActiveProps = mergeScoredIntoDisplayProps(workingActiveProps, scoredProps);

  pipelineStageCounts = buildPipelineStageReport({
    ...pipelineStageCounts,
    scoreFiltered: scoredProps.length,
    samples: {
      ...pipelineStageCounts.samples,
      scoreFiltered: samplePropsAtStage(scoredProps),
    },
  });

  let qualBoards = buildQualificationBoards(
    scoredProps.length ? scoredProps.filter(isVerifiedSportsbookProp) : filterVerifiedSportsbookProps(workingNormalProps),
    pipelineAudit,
    historyRows
  );

  let displayProps = filterVerifiedSportsbookProps(
    [...qualBoards.ready, ...qualBoards.allDisplayable.filter((prop) => !qualBoards.ready.some((ready) => ready.id === prop.id))]
  ).slice(0, MAX_RANKED_PROPS);
  if (!displayProps.length && allDisplayProps.length) {
    displayProps = allDisplayProps.slice(0, MAX_RANKED_PROPS);
  }

  pipelineStageCounts = buildPipelineStageReport({
    ...pipelineStageCounts,
    finalDisplayed: displayProps.length,
    samples: {
      ...pipelineStageCounts.samples,
      finalDisplayed: samplePropsAtStage(displayProps),
    },
  });
  logPipelineStageReport(pipelineStageCounts, "Prop Pipeline Final");
  debugInfo.pipelineStageCounts = pipelineStageCounts;
  debugInfo.pipelineFallback = pipelineFallback;
  const watchlistProps = [];
  const nearQualification = qualBoards.near.slice(0, 15);
  let qualifiedReadyProps = qualBoards.ready.slice(0, RENDER_LIMITS.readyToBet);
  if (!qualifiedReadyProps.length && displayProps.length) {
    qualifiedReadyProps = sortDecisionBoard(displayProps).slice(0, RENDER_LIMITS.readyToBet);
  }
  if (!qualifiedReadyProps.length && allDisplayProps.length) {
    qualifiedReadyProps = allDisplayProps.slice(0, RENDER_LIMITS.readyToBet);
  }
  const allowFallbackRender = Boolean(
    pipelineFallback && /sportsdata/i.test(String(debugInfo.ingestionFallback || ""))
  );
  const liveRenderResult = buildLiveRenderBoard(allDisplayProps, { allowFallbackProps: allowFallbackRender });
  const acceptedPropsForRender = liveRenderResult.props;
  debugInfo.pipelineRenderCounts = liveRenderResult.counts;
  const modelSignalMap = buildModelSignalMap(filterVerifiedSportsbookProps(qualBoards.allDisplayable));
  let streakProps = [];

  attachScoredSourceCounts(debugInfo, {
    recommendedProps: displayProps,
    watchlistProps,
    streakProps,
  });
  debugInfo.totals = {
    rawPropsLoaded: canonicalProps.length,
    upcomingSlateCount: pipelineAudit.upcomingSlate,
    slateExcludedCount: pipelineAudit.slateExcluded,
    activeProps: workingActiveProps.length,
    propsAfterFilters: workingNormalProps.length,
    recommendedProps: displayProps.length,
    watchlistProps: watchlistProps.length,
    nearQualification: nearQualification.length,
    readyProps: qualBoards.ready.length,
    streakProps: streakProps.length,
  };
  debugInfo.qualificationSummary = safeFormatRejectionSummary(pipelineAudit);
  debugInfo.rejectionAnalytics = qualBoards.rejectionAnalytics?.summary || pipelineAudit.rejectionAnalytics || null;
  debugInfo.rejectionSamples = qualBoards.rejectionAnalytics?.rejected?.slice(0, 40) || pipelineAudit.rejectionSamples || [];
  debugInfo.qualificationAnalytics = qualBoards.qualificationAnalytics || pipelineAudit.qualificationAnalytics || null;

  debugInfo.rejectionAudit = auditPropRejections(
    [...(qualBoards.allDisplayable || []), ...(allDisplayProps || [])]
  );
  if (debugInfo.mlbProjectionDiagnostics) {
    const diag = debugInfo.mlbProjectionDiagnostics;
    debugInfo.rejectionAudit = {
      ...debugInfo.rejectionAudit,
      mlbProjection: {
        stages: diag.stages,
        liveDebug: diag.liveDebug,
        verifiedPropsCount: diag.verifiedPropsCount,
        rejections: diag.rejectionCounts,
        testMode: diag.testMode,
        projectionsComplete: diag.projectionsComplete,
        statsFetchTimedOut: diag.statsFetchTimedOut,
        emergencyCanary: diag.emergencyCanary,
        projectionErrors: diag.projectionErrors,
        lastProjectionFailure: diag.lastProjectionFailure,
      },
      reasons: {
        ...(debugInfo.rejectionAudit?.reasons || {}),
        ...(diag.rejectionCounts || {}),
      },
    };
  }
  const propSanityAudit = auditTopMlbPlayPool(
    displayProps,
    canonicalProps,
    debugInfo.parsedUnderdogProps || []
  );
  debugInfo.propSanityAudit = propSanityAudit;
  if (propSanityAudit?.reasons) {
    debugInfo.rejectionAudit = {
      ...debugInfo.rejectionAudit,
      reasons: {
        ...(debugInfo.rejectionAudit?.reasons || {}),
        ...Object.fromEntries(
          Object.entries(propSanityAudit.reasons).map(([key, count]) => [`[sanity] ${key}`, count])
        ),
      },
    };
  }

  const finalStatus = finalizeSourceStatus(sourceStatus);
  const { criticalWarnings, degradedWarnings, sourceHealth } = partitionWarnings(
    unique([...sourceWarnings, ...backgroundWarnings]),
    sourceFailures,
    finalStatus
  );

  pipelineAudit = coercePipelineAudit(pipelineAudit);
  const cacheCounts = countPropCacheLayers(displayProps);
  finalizePipelineCounters(pipelineAudit, {
    displayed: acceptedPropsForRender.length ? acceptedPropsForRender : qualBoards.ready.length ? qualBoards.ready : displayProps,
    rejected: Math.max(0, (pipelineAudit.fetched || 0) - (pipelineAudit.scored || 0)),
    stale: cacheCounts.stale,
    cached: cacheCounts.cached,
    live: cacheCounts.live,
  });
  debugInfo.pipelineCounters = pipelineAudit.pipelineCounters;
  debugInfo.acceptedPropsForRender = pipelineAudit.acceptedPropsForRender || acceptedPropsForRender;
  if (isHeavyDebugEnabled()) {
    Object.assign(debugInfo, attachDebugArtifacts(sanitizeDebugInfoForMlbOnly(debugInfo), pipelineAudit));
    if (shouldLogVerbose()) logPipelineAudit("qualified", pipelineAudit);
  } else {
    debugInfo.pipelineAudit = {
      scored: pipelineAudit.scored,
      preScoring: pipelineAudit.preScoring,
      active: pipelineAudit.active,
      displayed: pipelineAudit.displayed,
      acceptedPropsForRender: debugInfo.acceptedPropsForRender,
      pipelineCounters: pipelineAudit.pipelineCounters,
    };
  }

  debugInfo.displayDebugCounts = buildDisplayDebugCounts({
    raw: rawProps.length,
    parsed: parsedCount,
    normalized: allDisplayProps.length,
    display: displayProps.length || allDisplayProps.length,
    selectedSport: fetchSport,
    top2: Math.min(2, allDisplayProps.length),
    ready: selectReadyFromDisplayProps(allDisplayProps).length,
    rejected: Math.max(0, rawProps.length - allDisplayProps.length),
  });

  const uiPayload = runUiPipeline({
    displayProps: allDisplayProps.length ? allDisplayProps : displayProps,
    streakProps,
    watchlist: watchlistProps,
  });

  if (uiPayload.props?.length || allDisplayProps.length) {
    writeLastGoodBoard({
      props: uiPayload.props,
      allDisplayProps,
      usableProps: allDisplayProps.length ? allDisplayProps : usablePropsPool,
      sourceStatus: finalStatus,
      pipelineFallback,
      ingestionSource: debugInfo.ingestionFallback || "live",
      updatedAt: new Date().toISOString(),
    });
    persistStartupBoardSlices({
      allDisplayProps,
      props: uiPayload.props,
      qualifiedReadyProps,
      acceptedPropsForRender,
    });
  }

  recordProviderStatus({
    underdog: {
      status: finalStatus.Underdog,
      url: debugInfo.sources.Underdog?.apiUrl || "/api/underdog",
      message: debugInfo.sources.Underdog?.message || "",
      normalizedCount: Number(debugInfo.sources.Underdog?.propsAfterParsing || 0),
    },
    prizepicks: {
      status: finalStatus.PrizePicks,
      url: debugInfo.sources.PrizePicks?.apiUrl || "/api/prizepicks",
      message: debugInfo.sources.PrizePicks?.message || "",
      normalizedCount: Number(debugInfo.sources.PrizePicks?.propsAfterParsing || 0),
    },
    oddsapi: {
      status: finalStatus["The Odds API"],
      url: "/api/sportsbookOdds",
      message: debugInfo.sources["The Odds API"]?.message || "",
      normalizedCount: Number(debugInfo.sources["The Odds API"]?.propsAfterParsing || 0),
    },
    sportsdataio: {
      status: finalStatus.SportsDataIO,
      url: "/api/sportsdataio/slate-snapshot",
      message: debugInfo.sources.SportsDataIO?.message || "",
      normalizedCount: Number(debugInfo.sources.SportsDataIO?.usablePropsCount || allDisplayProps.filter((p) => p.isSportsDataFallback).length || 0),
    },
  });
  recordNormalizedProps(allDisplayProps.length ? allDisplayProps : uiPayload.props, {
    total: allDisplayProps.length || uiPayload.props.length,
    ingestionSource: debugInfo.ingestionFallback || "live",
  });
  dumpDebugGlobals("fetchDFSProps");

  const pipelineDiagnostics = buildPipelineDiagnostics({
    rawProps,
    allDisplayProps,
    scoredProps: displayProps,
    acceptedPropsForRender,
    liveRenderCounts: liveRenderResult.counts,
    pipelineAudit,
    debugInfo,
    prizePicksResult,
    underdogResult,
    pipelineFallback,
  });
  debugInfo.pipelineDiagnostics = pipelineDiagnostics;
  logPipelineDiagnostics(pipelineDiagnostics);

  const verificationPool = acceptedPropsForRender.length
    ? acceptedPropsForRender
    : allDisplayProps.length
      ? allDisplayProps
      : displayProps;
  debugInfo.pipelinePropCountAudit = buildPipelinePropCountAudit({
    rawPrizePicks: Number(
      debugInfo.pipelineProviderRaw?.rawPrizePicks ?? prizePicksProps?.length ?? debugInfo.providerFetchCounts?.prizepicks ?? 0
    ),
    rawUnderdog: Number(
      debugInfo.pipelineProviderRaw?.rawUnderdog ?? underdogProps?.length ?? debugInfo.providerFetchCounts?.underdog ?? 0
    ),
    combinedRaw: Number(debugInfo.pipelineProviderRaw?.combinedRaw ?? mergedProviderProps?.length ?? rawProps.length),
    afterCacheMerge: Number(debugInfo.pipelineProviderRaw?.afterCacheMerge ?? rawProps.length),
    normalizedProps: pipelinePropCountSnapshot.normalizedProps || parsedCount || allDisplayProps.length,
    afterSportFilter: pipelinePropCountSnapshot.afterSportFilter || allDisplayProps.length,
    afterMlbOnlyFilter: pipelinePropCountSnapshot.afterMlbOnlyFilter || pipelinePropCountSnapshot.afterSportFilter || 0,
    afterDuplicateRemoval:
      pipelinePropCountSnapshot.afterDuplicateRemoval || pipelinePropCountSnapshot.normalizedProps || 0,
    afterMarketFilter: pipelinePropCountSnapshot.afterMarketFilter || 0,
    afterPlayerNormalization: pipelinePropCountSnapshot.afterPlayerNormalization || allDisplayProps.length,
    afterLineValidation: pipelinePropCountSnapshot.afterLineValidation || allDisplayProps.length,
    projectionCandidates:
      pipelinePropCountSnapshot.afterProjectionFilter || pipelinePropCountSnapshot.projectedProps || allDisplayProps.length,
    projectedProps:
      pipelinePropCountSnapshot.projectedProps ||
      countMergedProjections(allDisplayProps) ||
      pipelinePropCountSnapshot.afterProjectionMerge ||
      0,
    afterHistoricalAttachment:
      pipelinePropCountSnapshot.afterHistoricalAttachment || countHistoricalAttachment(allDisplayProps).attached,
    verifiedProps: countVerifiedFilterProps(verificationPool),
    displayedProps: acceptedPropsForRender.length || liveRenderResult.counts?.rendered || displayProps.length || 0,
    rejections: pipelinePropCountSnapshot.rejections || {},
  });
  logPipelinePropCountAudit(debugInfo.pipelinePropCountAudit);

  debugInfo.providerCoverageAudit = buildProviderCoverageAudit({
    debugInfo,
    pipelinePropCountAudit: debugInfo.pipelinePropCountAudit,
    prizePicksResult,
    underdogResult,
    prizePicksProps,
    underdogProps,
    providerFetchDiagnostics: debugInfo.providerFetchDiagnostics,
  });
  logProviderCoverageSummary(debugInfo.providerCoverageAudit);

  if (!MLB_ONLY_MODE) {
    const perfSettled = await providerWave.awaitAllForPerf();
    logProviderFetchPerformance(perfSettled.map((row) => unwrapProviderSettled(row)));
  }

  reportProgress("RANK");
  beginPerformanceTimer(PERFORMANCE_TIMERS.generateProjections);
  beginPerformanceTimer(PERFORMANCE_TIMERS.verifyPlays);
  reportProgress("VERIFY");
  endPerformanceTimer(PERFORMANCE_TIMERS.generateProjections);
  endPerformanceTimer(PERFORMANCE_TIMERS.verifyPlays);
  reportProgress("DONE");
  return {
    props: uiPayload.props,
    allDisplayProps,
    deferredDisplayProps,
    usableProps: allDisplayProps.length ? allDisplayProps : usablePropsPool,
    pipelineFallback,
    pipelineStageCounts,
    watchlist: uiPayload.watchlist,
    nearQualification,
    qualifiedReadyProps,
    acceptedPropsForRender,
    displayPool: qualBoards.allDisplayable.length ? qualBoards.allDisplayable : displayProps,
    readyProps: qualifiedReadyProps,
    streakProps: uiPayload.streakProps,
    sourceStatus: finalStatus,
    sourceHealth,
    criticalWarnings,
    degradedWarnings,
    warnings: unique([...degradedWarnings, ...sourceWarnings.filter((w) => !/underdog/i.test(String(w)))]),
    debugInfo,
    pipelineAudit: isHeavyDebugEnabled() ? pipelineAudit : debugInfo.pipelineAudit,
    scoringContext,
  };
}

export default function DFSPropsApp() {
  const [platform, setPlatform] = useState("all");
  const [sport, setSport] = useState(MLB_ONLY_MODE ? "MLB" : "all");
  const [streakCategoryTab, setStreakCategoryTab] = useState("all");
  const [statType, setStatType] = useState("all");
  const [edgeFilter, setEdgeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("allUpcoming");
  const [readyOnly, setReadyOnly] = useState(false);
  const [compactMode, setCompactMode] = useState(() => readCompactModePreference());
  const [quickPicksMode, setQuickPicksMode] = useState(() => readQuickPicksModePreference());
  const [showDebugPanels, setShowDebugPanels] = useState(() => readShowDebugPanelsPreference());
  const [appView, setAppView] = useState(() => {
    try {
      const stored = window.localStorage.getItem(APP_VIEW_STORAGE_KEY);
      const validViews = new Set(["bestPlays", "prizepicks", "manual", "saved"]);
      if (stored && validViews.has(stored)) return stored;
      if (stored === "goblins" || stored === "demons" || stored === "underdog" || stored === "live") {
        return "bestPlays";
      }
      return "bestPlays";
    } catch {
      return "bestPlays";
    }
  });
  const [manualAnalyzerProps, setManualAnalyzerProps] = useState(() => readManualAnalyzerProps());
  const [marketQuickFilter, setMarketQuickFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleLimits, setVisibleLimits] = useState(() => ({
    ready: INITIAL_VISIBLE_SECTION_LIMIT,
    value: INITIAL_VISIBLE_SECTION_LIMIT,
  }));
  const [props, setProps] = useState([]);
  const [allDisplayProps, setAllDisplayProps] = useState([]);
  const [displayDebugCounts, setDisplayDebugCounts] = useState({});
  const [usableProps, setUsableProps] = useState([]);
  const [pipelineFallback, setPipelineFallback] = useState(false);
  const [renderErrors, setRenderErrors] = useState([]);
  const handleSectionRenderError = useCallback((error, name) => {
    setRenderErrors((current) => [...current, { name, message: error?.message || String(error) }].slice(-12));
  }, []);
  const [pipelineStageCounts, setPipelineStageCounts] = useState({});
  const [watchlist, setWatchlist] = useState([]);
  const [nearQualification, setNearQualification] = useState([]);
  const [qualifiedReadyProps, setQualifiedReadyProps] = useState([]);
  const [acceptedPropsForRender, setAcceptedPropsForRender] = useState([]);
  const [streakProps, setStreakProps] = useState([]);
  const [streakSport, setStreakSport] = useState("MLB");
  const [parlayRiskMode, setParlayRiskMode] = useState("balanced");
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [learningSaveNotice, setLearningSaveNotice] = useState("");
  const [criticalWarnings, setCriticalWarnings] = useState([]);
  const [degradedWarnings, setDegradedWarnings] = useState([]);
  const [sourceHealth, setSourceHealth] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState("CACHED");
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(() => trimHistoryToLimit(readHistory()));
  const [parlayHistory, setParlayHistory] = useState(() => trimHistoryToLimit(readParlayHistory()));
  const [lastUpdated, setLastUpdated] = useState("");
  const [cacheStatus, setCacheStatus] = useState("");
  const [cacheNotice, setCacheNotice] = useState("");
  const [sourceStatus, setSourceStatus] = useState(DEFAULT_SOURCE_STATUS);
  const [debugInfo, setDebugInfo] = useState(() => createDebugInfo("all"));
  const [apiHealth, setApiHealth] = useState({
    PrizePicks: { status: "Pending", lastFetchAt: "", lineSourceBadge: "" },
    Underdog: { status: "Pending", lastFetchAt: "", lineSourceBadge: "" },
    cache: { status: "empty", lastFetchAt: "" },
  });
  const [refreshCooldownSec, setRefreshCooldownSec] = useState(0);
  const [sourceCooldownSec, setSourceCooldownSec] = useState(0);
  const [includeUncertainProps, setIncludeUncertainProps] = useState(() => readIncludeUncertainPreference());
  const [filterPrefs, setFilterPrefs] = useState(() => readFilterPrefs());
  const [pipelineAudit, setPipelineAudit] = useState(() => safeCreateEmptyPipelineAudit());
  const loadInFlightRef = useRef(false);
  const initialLoadRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const lastAutoRefreshRef = useRef(0);
  const scoringContextRef = useRef(null);
  const [mlbPipelineStatusTick, setMlbPipelineStatusTick] = useState(0);

  useEffect(() => subscribeMlbPipelineStatus(() => setMlbPipelineStatusTick((tick) => tick + 1)), []);

  const mlbPipelineStatus = useMemo(() => {
    mergeDfsSourceStatusFromApiHealth(apiHealth);
    return getMlbPipelineStatus();
  }, [apiHealth, manualAnalyzerProps, lastUpdated, mlbPipelineStatusTick]);

  useEffect(() => {
    const trimmedHistory = trimHistoryToLimit(readHistory());
    const trimmedParlays = trimHistoryToLimit(readParlayHistory());
    writeHistory(trimmedHistory);
    writeParlayHistory(trimmedParlays);
  }, []);

  useEffect(() => {
    if (refreshCooldownSec <= 0 && sourceCooldownSec <= 0) return undefined;
    const timer = window.setInterval(() => {
      const refreshRemaining = Math.max(0, Math.ceil((getRefreshCooldownMs() - (Date.now() - lastRefreshAtRef.current)) / 1000));
      const sourceRemaining = Math.ceil(getMaxCooldownRemainingMs() / 1000);
      setRefreshCooldownSec(refreshRemaining);
      setSourceCooldownSec(sourceRemaining);
    }, 500);
    return () => window.clearInterval(timer);
  }, [refreshCooldownSec, sourceCooldownSec]);

  const applyBoardState = useCallback((board, cacheLayer = "fresh") => {
    const scopedBoard = sanitizeBoardForMlbOnly(board || {});
    const sourceRows =
      scopedBoard.allDisplayProps?.length
        ? scopedBoard.allDisplayProps
        : scopedBoard.usableProps?.length
          ? scopedBoard.usableProps
          : scopedBoard.props || [];
    let masterProps = [];
    try {
      masterProps = isSafeModeEnabled()
        ? filterActiveSportProps(sourceRows)
        : enrichDisplayPropsPipeline(sourceRows);
    } catch (error) {
      console.error("[SAFE_MODE] enrichDisplayPropsPipeline failed — using parsed props", error);
      masterProps = filterActiveSportProps(sourceRows);
    }
    if (!masterProps.length && sourceRows.length) {
      masterProps = filterActiveSportProps(sourceRows);
    }
    const boardProps = masterProps.length ? masterProps : scopedBoard.props || [];
    const boardSourceStatus = finalizeSourceStatus(scopedBoard.sourceStatus || DEFAULT_SOURCE_STATUS);
    setAllDisplayProps(masterProps);
    setDisplayDebugCounts(scopedBoard.displayDebugCounts || scopedBoard.debugInfo?.displayDebugCounts || {});
    setProps(boardProps);
    setUsableProps(scopedBoard.usableProps || boardProps);
    setPipelineFallback(Boolean(scopedBoard.pipelineFallback || scopedBoard.debugInfo?.pipelineFallback));
    setPipelineStageCounts(scopedBoard.pipelineStageCounts || scopedBoard.debugInfo?.pipelineStageCounts || {});
    setWatchlist(scopedBoard.watchlist || []);
    setNearQualification(scopedBoard.nearQualification || []);
    let renderAccepted = buildLiveRenderBoard(masterProps.length ? masterProps : boardProps, {
      allowFallbackProps: Boolean(
        scopedBoard.pipelineFallback && /sportsdata/i.test(String(scopedBoard.debugInfo?.ingestionFallback || ""))
      ),
    }).props;
    if (!renderAccepted.length && boardProps.length) {
      renderAccepted = boardProps.filter((prop) => !isFakeOrFallbackProp(prop)).slice(0, RENDER_LIMITS.readyToBet);
    }
    setQualifiedReadyProps(scopedBoard.qualifiedReadyProps || scopedBoard.readyProps || renderAccepted);
    setAcceptedPropsForRender(Array.isArray(renderAccepted) ? renderAccepted : []);
    setStreakProps(scopedBoard.streakProps || []);
    setCriticalWarnings(
      sanitizeCriticalWarningsForDisplay(collectBoardWarningMessages(scopedBoard), boardProps, boardSourceStatus)
    );
    setDegradedWarnings(
      sanitizeDegradedWarningsForDisplay(collectBoardWarningMessages(scopedBoard), boardProps, boardSourceStatus)
    );
    setSourceStatus(boardSourceStatus);
    setSourceHealth(scopedBoard.sourceHealth || {});
    setDebugInfo(
      sanitizeDebugInfoForMlbOnly({
        ...(scopedBoard.debugInfo || createDebugInfo(platform)),
        acceptedPropsForRender: renderAccepted,
        cacheAnalytics: scopedBoard.cacheAnalytics || scopedBoard.cacheMetadata?.cacheAnalytics || scopedBoard.debugInfo?.cacheAnalytics || null,
      })
    );
    setLastUpdated(scopedBoard.updatedAt || "");
    setCacheStatus(cacheLayer);
    setCacheNotice(scopedBoard.cacheNotice || "");
    setPipelineAudit(
      coercePipelineAudit({
        ...(scopedBoard.debugInfo?.pipelineAudit || {}),
        acceptedPropsForRender: renderAccepted,
        pipelineCounters:
          scopedBoard.debugInfo?.pipelineCounters ||
          scopedBoard.debugInfo?.pipelineAudit?.pipelineCounters ||
          {},
      })
    );
    setApiHealth(buildApiHealthFromBoard(scopedBoard, cacheLayer));
  }, [platform]);

  const loadProps = useCallback(async ({ force = false, autoRefresh = false } = {}) => {
    if (!force && !autoRefresh && !isTabActive()) {
      console.info("[DFS Refresh] skipped — tab inactive");
      return;
    }
    if (autoRefresh && !canAutoRefresh(Date.now(), lastAutoRefreshRef.current || lastRefreshAtRef.current)) {
      console.info("[DFS Refresh] auto refresh skipped — cooldown active");
      return;
    }

    return withBoardFetchLock(async () => {
      const sourceCooldownRemaining = getMaxCooldownRemainingMs();
      const refreshCooldownRemaining = getRefreshCooldownMs() - (Date.now() - lastRefreshAtRef.current);
      if (force && (sourceCooldownRemaining > 0 || refreshCooldownRemaining > 0)) {
        const cooldownFallback =
          readVerifiedCacheBoard(DEFAULT_SOURCE_STATUS) || readCachedBoard(DEFAULT_SOURCE_STATUS, { allowExpired: true });
        if (
          applyVerifiedCacheFallbackBoard(applyBoardState, cooldownFallback, {
            notice: VERIFIED_CACHE_COOLDOWN_MESSAGE,
            rateLimited: true,
          })
        ) {
          setError("");
          setSourceCooldownSec(Math.ceil(sourceCooldownRemaining / 1000));
          setRefreshCooldownSec(Math.ceil(Math.max(0, refreshCooldownRemaining) / 1000));
          console.info("[DFS Refresh] served verified cache during cooldown", {
            sourceRemainingMs: sourceCooldownRemaining,
            refreshRemainingMs: refreshCooldownRemaining,
          });
          return;
        }
        console.info("[DFS Refresh] blocked by cooldown with no verified cache fallback", {
          sourceRemainingMs: sourceCooldownRemaining,
          refreshRemainingMs: refreshCooldownRemaining,
        });
        setSourceCooldownSec(Math.ceil(sourceCooldownRemaining / 1000));
        setRefreshCooldownSec(Math.ceil(Math.max(0, refreshCooldownRemaining) / 1000));
        return;
      }

      loadInFlightRef.current = true;
      setMlbPipelineRefreshing(true);
      setRefreshingFeeds(true);
      setLoadingStage("REFRESH");
      setCacheNotice("Refreshing feeds...");
      beginPerformanceTimer(PERFORMANCE_TIMERS.refreshProviders);
      const cachedForPaint =
        !force && !autoRefresh
          ? readCachedBoard(DEFAULT_SOURCE_STATUS) ||
            readVerifiedCacheBoard(DEFAULT_SOURCE_STATUS) ||
            readCacheFirstStartupBundle(DEFAULT_SOURCE_STATUS).instant?.board
          : null;
      const hasCachedPaint = Boolean(
        cachedForPaint?.allDisplayProps?.length ||
          cachedForPaint?.props?.length ||
          cachedForPaint?.usableProps?.length ||
          cachedForPaint?.qualifiedReadyProps?.length
      );
      if (!autoRefresh && !hasCachedPaint) {
        setLoading(true);
        setLoadingStage("FETCH");
      }
      setError("");
      setLearningSaveNotice("");
      const fetchStartedAt = Date.now();
      const previousBoard =
        readVerifiedCacheBoard(DEFAULT_SOURCE_STATUS, { allowExpired: true }) ||
        readCachedBoard(DEFAULT_SOURCE_STATUS, { allowExpired: true });
      try {
        if (force) {
          clearApiCache({ preserveLastGood: true });
        }

        if (hasCachedPaint) {
          const layer =
            cachedForPaint.cacheMetadata?.freshnessTier ||
            resolveCacheLayer(new Date(cachedForPaint.updatedAt).getTime(), DFS_CACHE_TTL_MS);
          applyBoardState(cachedForPaint, formatCacheLayerLabel(layer).toLowerCase());
          if (cachedForPaint.statsMap instanceof Map && cachedForPaint.statsMap.size) {
            scoringContextRef.current = {
              ...(scoringContextRef.current || {}),
              stats: cachedForPaint.statsMap,
            };
          } else {
            const cachedStats = resolveStableStatsMap(null);
            if (cachedStats.statsMap.size) {
              scoringContextRef.current = {
                ...(scoringContextRef.current || {}),
                stats: cachedStats.statsMap,
              };
            }
          }
          setLoading(false);
          console.info("[DFS Refresh] board cache served — continuing background refresh", {
            updatedAt: cachedForPaint.updatedAt,
            durationMs: Date.now() - fetchStartedAt,
          });
        } else if (!force && !autoRefresh) {
          const cached = readCachedBoard(DEFAULT_SOURCE_STATUS) || readVerifiedCacheBoard(DEFAULT_SOURCE_STATUS);
          if (cached?.allDisplayProps?.length || cached?.props?.length || cached?.usableProps?.length || cached?.qualifiedReadyProps?.length) {
            const layer = cached.cacheMetadata?.freshnessTier || resolveCacheLayer(new Date(cached.updatedAt).getTime(), DFS_CACHE_TTL_MS);
            applyBoardState(cached, formatCacheLayerLabel(layer).toLowerCase());
            setLoading(false);
            console.info("[DFS Refresh] board cache served — continuing background refresh", {
              updatedAt: cached.updatedAt,
              durationMs: Date.now() - fetchStartedAt,
            });
          }
        }

        const result = await fetchDFSProps({
          platform: "both",
          sport: MLB_ONLY_MODE ? "MLB" : "all",
          statType: "all",
          onProgress: (stage) => setLoadingStage(stage),
          onCoreReady: (coreBoard) => {
            const hasProps =
              coreBoard.allDisplayProps?.length || coreBoard.props?.length || coreBoard.usableProps?.length;
            if (!hasProps) return;
            applyBoardState({ ...coreBoard, updatedAt: new Date().toISOString() }, "live");
            if (!autoRefresh) setLoading(false);
          },
        });
        if (!result) {
          throw new Error("Board fetch returned no result");
        }
        const stableStats = resolveStableStatsMap(result.scoringContext?.stats);
        scoringContextRef.current = {
          ...(scoringContextRef.current || {}),
          ...(result.scoringContext || {}),
          stats: stableStats.statsMap,
        };
        const boardSourceStatus = finalizeSourceStatus(result.sourceStatus || DEFAULT_SOURCE_STATUS);
        const boardProps = result.allDisplayProps?.length
          ? result.allDisplayProps
          : result.props?.length
            ? result.props
            : result.usableProps || [];
        const routedCritical = sanitizeCriticalWarningsForDisplay(
          unique([...(result.criticalWarnings || []), ...(result.warnings || []), ...(result.degradedWarnings || [])]),
          boardProps,
          boardSourceStatus
        );
        let board = {
          props: boardProps,
          allDisplayProps: result.allDisplayProps || boardProps,
          displayDebugCounts: result.debugInfo?.displayDebugCounts || {},
          usableProps: result.allDisplayProps || result.usableProps || boardProps,
          pipelineFallback: Boolean(result.pipelineFallback),
          pipelineStageCounts: result.pipelineStageCounts || {},
          watchlist: result.watchlist || [],
          nearQualification: result.nearQualification || [],
          qualifiedReadyProps: result.qualifiedReadyProps || result.readyProps || [],
          acceptedPropsForRender: result.acceptedPropsForRender || result.qualifiedReadyProps || result.readyProps || [],
          streakProps: result.streakProps || [],
          warnings: routedCritical,
          degradedWarnings: sanitizeDegradedWarningsForDisplay(
            result.degradedWarnings || [],
            boardProps,
            boardSourceStatus
          ),
          criticalWarnings: routedCritical,
          sourceStatus: boardSourceStatus,
          sourceHealth: result.sourceHealth || {},
          debugInfo: result.debugInfo || createDebugInfo(platform),
          updatedAt: new Date().toISOString(),
        };
        board.debugInfo = { ...(board.debugInfo || {}), pipelineAudit: result.pipelineAudit || board.debugInfo?.pipelineAudit };
        if (boardProps.length) {
          const cacheMeta = buildBoardCacheMetaFromFetch(board);
          board.verifiedAt = cacheMeta.verifiedAt;
          board.cacheMetadata = cacheMeta;
          board.cacheAnalytics = cacheMeta.cacheAnalytics;
          board.debugInfo = { ...board.debugInfo, cacheAnalytics: cacheMeta.cacheAnalytics };
        }

        const mergeResult = mergeBoardRefreshResult(previousBoard || {}, board);
        board = mergeResult.board;
        const mergedBoardProps = board.allDisplayProps?.length
          ? board.allDisplayProps
          : board.props?.length
            ? board.props
            : board.usableProps || [];
        board.props = mergedBoardProps;
        board.allDisplayProps = board.allDisplayProps?.length ? board.allDisplayProps : mergedBoardProps;
        board.usableProps = board.usableProps?.length ? board.usableProps : mergedBoardProps;
        if (mergeResult.keptPrevious || mergeResult.merged) {
          board.pipelineFallback = true;
        }

        const rateLimited =
          getMaxCooldownRemainingMs() > 0 ||
          (board.warnings || []).some((warning) => /rate limited|429|cooldown/i.test(String(warning)));

        if (!board.props.length && !board.allDisplayProps?.length && !board.usableProps?.length && (previousBoard?.props?.length || previousBoard?.allDisplayProps?.length || previousBoard?.usableProps?.length || previousBoard?.qualifiedReadyProps?.length)) {
          if (
            applyVerifiedCacheFallbackBoard(applyBoardState, previousBoard, {
              notice: rateLimited ? VERIFIED_CACHE_COOLDOWN_MESSAGE : VERIFIED_CACHE_FALLBACK_MESSAGE,
              rateLimited,
            })
          ) {
            setError("");
          } else if (applyLastGoodBoardFallback(applyBoardState)) {
            setError("");
          }
          console.info("[DFS Refresh] kept verified cached board after empty fetch", {
            durationMs: Date.now() - fetchStartedAt,
            rateLimited,
          });
          return;
        }

        if (board.props.length || board.allDisplayProps?.length || board.usableProps?.length) {
          writeCachedBoard(sanitizeBoardForMlbOnly(board));
          setCacheNotice("");
        }
        applyBoardState(board, board.props.length || board.allDisplayProps?.length || board.usableProps?.length ? "fresh" : "cached");
        persistStartupBoardSlices(board);
        if (result.deferredDisplayProps?.length) {
          scheduleBackgroundWork(() => {
            setAllDisplayProps((current) => {
              const seen = new Set((current || []).map((prop) => prop.id));
              const merged = [...(current || [])];
              for (const prop of result.deferredDisplayProps) {
                if (!prop?.id || seen.has(prop.id)) continue;
                seen.add(prop.id);
                merged.push(prop);
              }
              return merged;
            });
          }, { delayMs: 900 });
        }
        if (board.props.length || board.allDisplayProps?.length || board.usableProps?.length) {
          setError((current) => resolveUiErrorMessage(current, board.allDisplayProps || board.props, board.sourceStatus));
        } else if (
          !applyVerifiedCacheFallbackBoard(applyBoardState, previousBoard, {
            notice: rateLimited ? VERIFIED_CACHE_COOLDOWN_MESSAGE : VERIFIED_CACHE_FALLBACK_MESSAGE,
            rateLimited,
          }) &&
          !applyLastGoodBoardFallback(applyBoardState)
        ) {
          const underdogOnlyEmptyBoard = isUnderdogOnlyFailure(board.criticalWarnings, board.degradedWarnings);
          if (!(MLB_ONLY_MODE && underdogOnlyEmptyBoard)) {
            setError(
              resolveUiErrorMessage(
                rateLimited ? RATE_LIMIT_COOLDOWN_MESSAGE : NO_VERIFIED_AFTER_COOLDOWN_MESSAGE,
                board.props,
                board.sourceStatus
              )
            );
          }
        } else {
          setError("");
        }
        lastRefreshAtRef.current = Date.now();
        if (autoRefresh) {
          lastAutoRefreshRef.current = Date.now();
          markAutoRefresh();
        }
        setRefreshCooldownSec(Math.ceil(getRefreshCooldownMs() / 1000));
        setSourceCooldownSec(Math.ceil(getMaxCooldownRemainingMs() / 1000));
        console.info("[DFS Refresh] live fetch complete", {
          durationMs: Date.now() - fetchStartedAt,
          props: board.props.length,
          sourceStatus: board.sourceStatus,
          autoRefresh,
        });
        setLoadingStage("DONE");
        beginPerformanceTimer(PERFORMANCE_TIMERS.renderDashboard);
        endPerformanceTimer(PERFORMANCE_TIMERS.renderDashboard);
        if (board.props.length) {
          const updatedHistory = savePropsOfDay(board.props);
          setHistory(updatedHistory);
        }
      } catch (loadError) {
        const staleBoard =
          readVerifiedCacheBoard(DEFAULT_SOURCE_STATUS, { allowExpired: true }) ||
          readCachedBoard(DEFAULT_SOURCE_STATUS, { allowExpired: true });
        const errMsg = getErrorMessage(loadError);
        const underdogOnlyFailure = isNonCriticalUnderdogFailure(errMsg) || isUnderdogOnlyFailure(errMsg);
        if (
          applyVerifiedCacheFallbackBoard(applyBoardState, staleBoard, {
            notice: VERIFIED_CACHE_COOLDOWN_MESSAGE,
            rateLimited: getMaxCooldownRemainingMs() > 0,
          })
        ) {
          setError("");
          console.warn("[DFS Refresh] served verified cache after failure", {
            durationMs: Date.now() - fetchStartedAt,
            error: errMsg,
          });
        } else if (applyLastGoodBoardFallback(applyBoardState)) {
          setError("");
          console.warn("[DFS Refresh] served last-good board after failure", {
            durationMs: Date.now() - fetchStartedAt,
            error: errMsg,
          });
        } else if (MLB_ONLY_MODE && underdogOnlyFailure) {
          setError("");
          setCriticalWarnings([]);
          console.warn("[DFS Refresh] ignored Underdog-only failure in MLB-only mode", {
            durationMs: Date.now() - fetchStartedAt,
            error: errMsg,
          });
        } else if (!shouldSuppressCriticalUiMessage(errMsg, [], {})) {
          setError(errMsg || NO_VERIFIED_AFTER_COOLDOWN_MESSAGE);
          setCriticalWarnings(filterCriticalUiMessages([errMsg], [], {}));
          setCacheStatus("");
          setApiHealth((current) => ({
            PrizePicks: {
              ...(current?.PrizePicks || {}),
              connectionTier:
                Number(current?.PrizePicks?.activeUsableCount ?? current?.PrizePicks?.usableCount) > 0
                  ? CONNECTION_TIERS.DEGRADED
                  : CONNECTION_TIERS.FAILED,
              status:
                Number(current?.PrizePicks?.activeUsableCount ?? current?.PrizePicks?.usableCount) > 0
                  ? CONNECTION_TIERS.DEGRADED
                  : CONNECTION_TIERS.FAILED,
            },
            Underdog: {
              ...(current?.Underdog || {}),
              connectionTier:
                Number(current?.Underdog?.activeUsableCount ?? current?.Underdog?.usableCount) > 0
                  ? CONNECTION_TIERS.DEGRADED
                  : CONNECTION_TIERS.FAILED,
              status:
                Number(current?.Underdog?.activeUsableCount ?? current?.Underdog?.usableCount) > 0
                  ? CONNECTION_TIERS.DEGRADED
                  : CONNECTION_TIERS.FAILED,
            },
            OddsAPI: {
              ...(current?.OddsAPI || {}),
              connectionTier: CONNECTION_TIERS.FAILED,
              status: CONNECTION_TIERS.FAILED,
            },
            cache: { status: "error", lastFetchAt: current?.cache?.lastFetchAt || "" },
          }));
          console.warn("[DFS Refresh] failed with no cache fallback", {
            durationMs: Date.now() - fetchStartedAt,
            error: errMsg,
          });
        } else {
          setError("");
          setCriticalWarnings([]);
        }
      } finally {
        loadInFlightRef.current = false;
        setMlbPipelineRefreshing(false);
        setRefreshingFeeds(false);
        endPerformanceTimer(PERFORMANCE_TIMERS.refreshProviders);
        setLoading(false);
        setLoadingStage("DONE");
      }
    });
  }, [applyBoardState, platform]);

  useEffect(() => {
    writeCompactModePreference(compactMode);
  }, [compactMode]);

  useEffect(() => {
    writeQuickPicksModePreference(quickPicksMode);
  }, [quickPicksMode]);

  useEffect(() => {
    writeShowDebugPanelsPreference(showDebugPanels);
  }, [showDebugPanels]);

  useEffect(() => {
    try {
      window.localStorage.setItem(APP_VIEW_STORAGE_KEY, appView);
    } catch {
      // ignore storage errors
    }
  }, [appView]);

  const scoreManualAnalyzerProp = useCallback((prop, profileOverride = null) => {
    const base = scoringContextRef.current || {};
    const asMap = (value) => (value instanceof Map ? value : new Map());
    const stats = asMap(base.stats);
    if (profileOverride && !profileOverride.sparse && !profileOverride.fallback) {
      const key = statProfileKey(prop);
      stats.set(key, { ...profileOverride, sport: prop.sport || "MLB", statType: prop.statType });
    }
    const context = {
      stats,
      news: asMap(base.news),
      lineComparisonMap: asMap(base.lineComparisonMap),
      sportsbookComparisonMap: asMap(base.sportsbookComparisonMap),
      lineMovementMap: asMap(base.lineMovementMap),
      manualStatsMap: { ...(base.manualStatsMap || readManualStatsMap()) },
      historyRows: base.historyRows || readHistory(),
      historyWeights: base.historyWeights || buildHistoryAccuracyWeights(readHistory()),
    };
    try {
      const scored = scoreDFSProp(prop, context);
      if (!scored) return null;
      const evaluation = evaluateAdaptiveQualification(scored);
      return applyQualificationLabels(scored, evaluation);
    } catch (error) {
      console.warn("[Manual Analyzer] scoreDFSProp failed", error);
      return null;
    }
  }, []);

  const persistManualAnalyzerProps = useCallback((next) => {
    setManualAnalyzerProps((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writeManualAnalyzerProps(resolved);
      return resolved;
    });
  }, []);


  const scrollToSection = useCallback((sectionId) => {
    if (sectionId === "section-manual-props") {
      setAppView("manual");
      window.requestAnimationFrame(() => {
        document.getElementById("section-manual-props")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    if (sectionId === "section-top-picks") setAppView("live");
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    beginPerformanceTimer(PERFORMANCE_TIMERS.loadCachedBoard);
    const startupBundle = readCacheFirstStartupBundle(DEFAULT_SOURCE_STATUS);
    const instant = startupBundle.instant;
    if (instant?.board) {
      applyBoardState(
        {
          ...instant.board,
          cacheNotice: instant.board.cacheNotice || "Showing cached board — refreshing in background",
        },
        instant.layer || "cached"
      );
      if (startupBundle.statsMap?.size) {
        scoringContextRef.current = {
          ...(scoringContextRef.current || {}),
          stats: startupBundle.statsMap,
        };
      }
      setLoading(false);
      setLoadingStage("CACHED");
      setCacheNotice("Showing cached board — refreshing in background");
      endPerformanceTimer(PERFORMANCE_TIMERS.loadCachedBoard);
      endPerformanceTimer(PERFORMANCE_TIMERS.renderDashboard);
      console.info("[DFS Startup] cache-first paint", {
        props: instant.board.allDisplayProps?.length || instant.board.props?.length || 0,
        statsProfiles: startupBundle.statsMap?.size || 0,
        statsFromCache: startupBundle.statsFromCache,
        projectionSlice: startupBundle.projections?.length || 0,
      });
    } else {
      endPerformanceTimer(PERFORMANCE_TIMERS.loadCachedBoard);
    }
    loadProps();
  }, [loadProps, applyBoardState]);

  useEffect(() => {
    const intervalMs = getAutoRefreshIntervalMs();
    const timer = window.setInterval(() => {
      if (!isTabActive()) return;
      loadProps({ autoRefresh: true });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [loadProps]);

  useEffect(() => {
    if (platform === "underdog") {
      console.info("[Underdog Audit] Underdog tab/source selected", {
        sourceStatus: sourceStatus.Underdog,
        debug: debugInfo.sources?.Underdog,
      });
    }
  }, [platform, sourceStatus, debugInfo]);

  const devEnvironment = isDevEnvironment();
  const debugModeEnabled = isDebugModeEnabled();
  const debugPanelsVisible = debugModeEnabled && showDebugPanels;

  const scoredDisplayProps = useMemo(() => allDisplayProps, [allDisplayProps]);

  const selectedSportProps = useMemo(() => {
    let rows = filterAllDisplayPropsBySport(scoredDisplayProps, sport, platform);
    if (marketQuickFilter === "goblins") rows = selectGoblinProps(rows);
    else if (marketQuickFilter === "demons") rows = selectDemonProps(rows);
    else if (marketQuickFilter && marketQuickFilter !== "all") {
      rows = rows.filter((prop) => matchesMarketQuickFilter(prop, marketQuickFilter));
    }
    return rows;
  }, [scoredDisplayProps, sport, platform, marketQuickFilter]);
  const liveRenderBoard = useMemo(
    () =>
      buildLiveRenderBoard(allDisplayProps, {
        allowFallbackProps: Boolean(
          pipelineFallback && /sportsdata/i.test(String(debugInfo?.ingestionFallback || ""))
        ),
      }),
    [allDisplayProps, pipelineFallback, debugInfo?.ingestionFallback]
  );
  const boardDisplayProps = useMemo(() => liveRenderBoard.props, [liveRenderBoard]);

  const prizePicksFeedProps = useMemo(() => {
    const research = (boardDisplayProps || []).filter((prop) => {
      const tier = prop.pickTierLabel;
      if (tier === PICK_TIER_VERIFIED) return false;
      if (tier === PICK_TIER_RESEARCH) return true;
      return Boolean(prop.displayResearchOnly) || prop.pickTierRank === 1;
    });
    if (research.length) return research;
    return (boardDisplayProps || []).filter((prop) => prop.pickTierLabel !== PICK_TIER_VERIFIED);
  }, [boardDisplayProps]);
  const underdogFeedProps = useMemo(
    () => filterPlatformProps(boardDisplayProps, "underdog"),
    [boardDisplayProps]
  );
  const displayStatusMessage = useMemo(() => {
    if (!debugModeEnabled || loading) return "";
    if (allDisplayProps.length > 0) return "Showing live/cached props";
    return "";
  }, [debugModeEnabled, loading, allDisplayProps.length]);
  const preFilterDebugProps = useMemo(() => allDisplayProps.slice(0, 20), [allDisplayProps]);
  const parsedUnderdogProps = useMemo(
    () =>
      extractParsedUnderdogProps({
        parsedUnderdogProps: debugInfo.parsedUnderdogProps || [],
        rawProps: props,
        displayProps: scoredDisplayProps,
      }),
    [debugInfo.parsedUnderdogProps, props, scoredDisplayProps]
  );
  const selectedBoardSport = sport === "all" ? "MLB" : sport;
  const selectedSportUdProps = useMemo(
    () => filterUnderdogPropsForSport(parsedUnderdogProps, selectedBoardSport),
    [parsedUnderdogProps, selectedBoardSport]
  );
  const underdogDebugSnapshot = useMemo(
    () =>
      buildUnderdogDebugSnapshot({
        debugInfo,
        parsedUnderdogProps: debugInfo.parsedUnderdogProps || parsedUnderdogProps,
        rawProps: props,
        displayProps: scoredDisplayProps,
        selectedSport: selectedBoardSport,
        selectedCategory: streakCategoryTab,
      }),
    [debugInfo, parsedUnderdogProps, props, scoredDisplayProps, selectedBoardSport, streakCategoryTab]
  );
  const streakFinderProps = useMemo(() => {
    const merged = mergeUnderdogIntoFinderPool(
      allDisplayProps.length ? allDisplayProps : streakProps,
      parsedUnderdogProps,
      selectedBoardSport
    );
    return merged.filter(
      (prop) =>
        isVerifiedRecommendableProp(prop) &&
        matchesPlatformFilter(prop, platform) &&
        matchesStatTypeFilter(prop, statType) &&
        matchesDateFilter(prop, dateFilter) &&
        matchesSearchFilter(prop, debouncedSearch)
    );
  }, [
    allDisplayProps,
    streakProps,
    parsedUnderdogProps,
    selectedBoardSport,
    platform,
    statType,
    dateFilter,
    debouncedSearch,
  ]);
  const readyToBetProps = useMemo(
    () => selectReadyFromDisplayProps(boardDisplayProps).slice(0, RENDER_LIMITS.readyToBet),
    [boardDisplayProps]
  );
  const nearMissProps = useMemo(
    () => selectNearMissFromDisplayProps(boardDisplayProps).slice(0, VISIBLE_SECTION_LIMIT),
    [boardDisplayProps]
  );
  const researchOnlyProps = useMemo(
    () => selectResearchOnlyFromDisplayProps(boardDisplayProps).slice(0, VISIBLE_SECTION_LIMIT),
    [boardDisplayProps]
  );
  const rejectionAnalytics = useMemo(
    () => debugInfo.rejectionAnalytics || pipelineAudit.rejectionAnalytics || null,
    [debugInfo.rejectionAnalytics, pipelineAudit.rejectionAnalytics]
  );
  const rejectionSamples = useMemo(
    () => debugInfo.rejectionSamples || pipelineAudit.rejectionSamples || [],
    [debugInfo.rejectionSamples, pipelineAudit.rejectionSamples]
  );
  const qualificationAnalytics = useMemo(
    () => debugInfo.qualificationAnalytics || pipelineAudit.qualificationAnalytics || null,
    [debugInfo.qualificationAnalytics, pipelineAudit.qualificationAnalytics]
  );
  const cacheAnalytics = useMemo(
    () => debugInfo.cacheAnalytics || pipelineAudit.cacheAnalytics || null,
    [debugInfo.cacheAnalytics, pipelineAudit.cacheAnalytics]
  );
  const bestValueProps = useMemo(
    () => selectBestValueFromDisplayProps(boardDisplayProps).slice(0, VISIBLE_SECTION_LIMIT),
    [boardDisplayProps]
  );
  const visibleHistory = useMemo(() => history.filter(isSupportedHistoryPick), [history]);
  const savedDisplayPicks = useMemo(
    () => visibleHistory.map(historyPickToDisplayProp).slice(0, 60),
    [visibleHistory]
  );
  const streakSportBoards = useMemo(
    () => Object.fromEntries(STREAK_TAB_OPTIONS.map((option) => [option.value, emptyStreakSportBoard(option.value)])),
    []
  );
  const visibleStreakSports = useMemo(() => {
    const sportCounts = new Map();
    allDisplayProps.forEach((prop) => {
      const key = streakSportKey(prop);
      if (key) sportCounts.set(key, (sportCounts.get(key) || 0) + 1);
    });
    return STREAK_TAB_OPTIONS.filter((option) => {
      if (option.always) return true;
      if ((streakSportBoards[option.value]?.candidateCount || 0) > 0) return true;
      return (sportCounts.get(option.value) || 0) > 0;
    });
  }, [streakSportBoards, allDisplayProps]);
  const currentStreakBoard = streakSportBoards[streakSport] || emptyStreakSportBoard(streakSport);
  const currentCategoryPicks = currentStreakBoard.picks || [];
  const currentCategoryLabel = currentStreakBoard.label || STREAK_TAB_OPTIONS.find((option) => option.value === streakSport)?.label || "MLB";
  const isGoblinTab = streakSport === "goblins";
  const isDemonTab = streakSport === "demons";
  const goblinDisplayProps = useMemo(() => selectGoblinProps(boardDisplayProps), [boardDisplayProps]);
  const demonDisplayProps = useMemo(() => selectDemonProps(boardDisplayProps), [boardDisplayProps]);
  const pipelineCounters = useMemo(
    () => pipelineAudit.pipelineCounters || debugInfo.pipelineCounters || {},
    [pipelineAudit.pipelineCounters, debugInfo.pipelineCounters]
  );
  const counterAcceptedSource = useMemo(
    () =>
      pipelineAudit?.acceptedPropsForRender ||
      debugInfo?.acceptedPropsForRender ||
      debugInfo?.pipelineAudit?.acceptedPropsForRender ||
      [],
    [pipelineAudit?.acceptedPropsForRender, debugInfo?.acceptedPropsForRender, debugInfo?.pipelineAudit?.acceptedPropsForRender]
  );
  const hydratedRenderableProps = useMemo(() => boardDisplayProps, [boardDisplayProps]);
  const finalAcceptedProps = useMemo(
    () =>
      visibleHistory
        .filter(isManuallySavedPick)
        .map(historyPickToDisplayProp)
        .slice(0, 40),
    [visibleHistory]
  );
  const topMlbPlayBoard = useMemo(() => {
    try {
      const fetchFailureReasons = buildLiveFetchFailureSummary(debugInfo?.sources || {}, {
        suppressWhenPrimaryLoaded: true,
      });
      const loadedPropCount = Math.max(
        allDisplayProps.length,
        (boardDisplayProps || []).filter((p) => !p.isDemoData).length
      );
      const board = resolveTopMlbPlaySections(boardDisplayProps, props, parsedUnderdogProps, {
        sourceStatus,
        lastUpdated,
        debugInfo,
        sportsDataSeasonStats: debugInfo?.sportsDataSeasonStats || [],
        statsMap: debugInfo?.statsMap || scoringContextRef.current?.stats || null,
        fetchFailureReasons,
        liveFetchFailed: loadedPropCount === 0,
        fetchTimedOut: /timed?\s*out|board fetch timed out/i.test(String(error || "")),
        allSourcesEmpty: loadedPropCount === 0,
        lightweight: !debugPanelsVisible,
      });
      board.loadedPropCount = loadedPropCount;
      if (board.pipelineDebug) {
        board.pipelineDebug.apiKeys = {
          PrizePicks: "configured",
          Underdog: "configured",
          OddsAPI: getOddsApiKey() ? "detected" : "missing",
          SportsDataIO: getSportsDataApiKey() ? "detected" : "missing",
        };
      }
      return board;
    } catch (boardError) {
      console.error("[Best Plays] board render failed", boardError);
      return {
        sections: [],
        filterDiagnostics: { error: boardError?.message || "Best Plays board failed" },
        pipelineDebug: null,
        loadedPropCount: 0,
      };
    }
  }, [boardDisplayProps, props, parsedUnderdogProps, sourceStatus, lastUpdated, debugInfo, error, allDisplayProps.length, debugPanelsVisible]);
  const verificationFilterDiagnostics = useMemo(() => {
    if (!debugPanelsVisible) return topMlbPlayBoard?.filterDiagnostics || null;

    const base = topMlbPlayBoard?.filterDiagnostics || null;
    const projectedFromBoard =
      base?.verificationDashboard?.projectedCount ??
      base?.pipelineCounts?.engineProjectedCount ??
      base?.pipelineCounts?.withProjections ??
      0;
    if (projectedFromBoard > 0) return base;

    const statsMap = debugInfo?.statsMap || scoringContextRef.current?.stats || null;
    const projectedPool = resolveEngineProjectedPool(allDisplayProps);
    if (!projectedPool.length && !allDisplayProps.length) return base;

    const dashboard = buildVerificationDashboard(allDisplayProps, {
      projectedPool,
      statsMap,
      seasonStats: debugInfo?.sportsDataSeasonStats || [],
      totalProps: allDisplayProps.length,
    });

    return {
      ...(base || {}),
      verificationDashboard: dashboard,
      pipelineCounts: {
        ...(base?.pipelineCounts || {}),
        rawProps: allDisplayProps.length,
        normalized: allDisplayProps.length,
        withProjections: projectedPool.length,
        engineProjectedCount: projectedPool.length,
        filtered: dashboard.verifiedPasses,
      },
    };
  }, [topMlbPlayBoard, allDisplayProps, debugInfo?.statsMap, debugInfo?.sportsDataSeasonStats, debugPanelsVisible]);
  const pipelineRenderCounts = useMemo(() => {
    const base = liveRenderBoard.counts;
    const audit = verificationFilterDiagnostics || topMlbPlayBoard?.filterDiagnostics;
    const projectionStats = resolvePipelineProjectionStats({
      allDisplayProps,
      filterDiagnostics: audit,
      debugPipelineCounts: debugInfo?.pipelineRenderCounts,
      liveRenderCounts: base,
    });
    const diagnostics = debugInfo?.pipelineDiagnostics
      ? {
          ...debugInfo.pipelineDiagnostics,
          verified: Number(
            audit?.pipelineCounts?.filtered ??
              debugInfo.pipelineDiagnostics.verified ??
              projectionStats.verifiedCount
          ),
          rendered: Number(base.rendered ?? debugInfo.pipelineDiagnostics.rendered ?? 0),
          projected: Number(
            debugInfo.pipelineDiagnostics.projected ??
              projectionStats.projectionCount ??
              countPropsWithProjections(allDisplayProps)
          ),
        }
      : buildPipelineDiagnostics({
          rawProps: allDisplayProps,
          allDisplayProps,
          scoredProps: allDisplayProps,
          acceptedPropsForRender: liveRenderBoard.props,
          liveRenderCounts: base,
          pipelineAudit,
          debugInfo,
          filterDiagnostics: audit,
          pipelineFallback,
        });
    return {
      ...base,
      ...diagnostics,
      fetched: diagnostics.raw,
      withProjections: diagnostics.projected,
      normalized: diagnostics.normalized || projectionStats.normalizedCount,
      verified: diagnostics.verified,
      projectionStats,
      projectionCoverageAudit: debugInfo?.projectionCoverageAudit || null,
      statsAttachmentAudit: debugInfo?.statsAttachmentAudit || null,
      filteredMissingProjection: audit?.filteredMissingProjection || 0,
      filteredLowConfidence: audit?.filteredLowConfidence || 0,
      filteredWeakEdge: audit?.filteredWeakEdge || 0,
      filteredOut: audit?.filteredOut || base.filteredOut,
    };
  }, [
    liveRenderBoard,
    topMlbPlayBoard,
    verificationFilterDiagnostics,
    allDisplayProps,
    debugInfo?.pipelineRenderCounts,
    debugInfo?.pipelineDiagnostics,
    debugInfo,
    pipelineAudit,
    pipelineFallback,
  ]);
  const curatedSportPicks = useMemo(() => {
    const primary = resolveMlbStreakPicks(
      streakSportBoards,
      scoredDisplayProps,
      DISPLAY_LIMITS.streakPerSport,
      props,
      selectedSportUdProps
    );
    const udCount = countUnderdogStreakProps(scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport);
    if (!shouldApplyUnderdogSectionFallbacks(primary.length, udCount, DISPLAY_LIMITS.streakPerSport)) {
      return primary;
    }
    return resolveUnderdogSectionFallbacks(scoredDisplayProps, props, {
      streakPicks: primary,
      streakLimit: DISPLAY_LIMITS.streakPerSport,
      parsedUnderdogProps: selectedSportUdProps,
      selectedSport: selectedBoardSport,
    }).streakPicks;
  }, [streakSportBoards, scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport]);
  const mlbDisplayPropCount = useMemo(
    () => countMlbDisplayProps(scoredDisplayProps, props),
    [scoredDisplayProps, props]
  );
  const underdogStreakPropCount = useMemo(
    () => countUnderdogStreakProps(scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport),
    [scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport]
  );
  const curatedGoblinDemonBoards = useMemo(() => {
    const primary = resolveCuratedGoblinDemonBoards(boardDisplayProps, props, {
      goblinBoardPicks: streakSportBoards.goblins?.picks,
      demonBoardPicks: streakSportBoards.demons?.picks,
      goblinLimit: DISPLAY_LIMITS.goblins,
      demonLimit: DISPLAY_LIMITS.demons,
      parsedUnderdogProps: selectedSportUdProps,
      selectedSport: selectedBoardSport,
    });
    const udCount = countUnderdogStreakProps(scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport);
    const needsFallback =
      shouldApplyUnderdogSectionFallbacks(primary.goblins.length, udCount, DISPLAY_LIMITS.goblins) ||
      shouldApplyUnderdogSectionFallbacks(primary.demons.length, udCount, DISPLAY_LIMITS.demons);
    if (!needsFallback) return primary;
    const filled = resolveUnderdogSectionFallbacks(scoredDisplayProps, props, {
      goblins: primary.goblins,
      demons: primary.demons,
      goblinLimit: DISPLAY_LIMITS.goblins,
      demonLimit: DISPLAY_LIMITS.demons,
      parsedUnderdogProps: selectedSportUdProps,
      selectedSport: selectedBoardSport,
    });
    return { goblins: filled.goblins, demons: filled.demons };
  }, [streakSportBoards, boardDisplayProps, props, scoredDisplayProps, selectedSportUdProps, selectedBoardSport]);
  const curatedGoblinPicks = useMemo(
    () => (curatedGoblinDemonBoards.goblins || []).filter((prop) => !prop.isFallbackMlbPick && !isFakeOrFallbackProp(prop)),
    [curatedGoblinDemonBoards.goblins]
  );
  const curatedDemonPicks = useMemo(
    () => (curatedGoblinDemonBoards.demons || []).filter((prop) => !prop.isFallbackMlbPick && !isFakeOrFallbackProp(prop)),
    [curatedGoblinDemonBoards.demons]
  );
  const safeModeFallbackActive = useMemo(() => {
    if (!isSafeModeEnabled()) return pipelineFallback || boardDisplayProps.some((prop) => prop.displayFallback);
    return (
      pipelineFallback ||
      curatedSportPicks.some((prop) => prop.isFallbackMlbPick) ||
      boardDisplayProps.some((prop) => prop.displayFallback)
    );
  }, [pipelineFallback, curatedSportPicks, boardDisplayProps]);
  const feedHealthContext = useMemo(
    () =>
      buildFeedHealthContext({
        allDisplayProps: scoredDisplayProps,
        debugInfo,
        sourceStatus,
        lastUpdated,
      }),
    [scoredDisplayProps, debugInfo, sourceStatus, lastUpdated]
  );
  const topPickPool = useMemo(() => boardDisplayProps, [boardDisplayProps]);
  const topPicksDisplay = useMemo(() => selectTop2FromDisplayProps(topPickPool), [topPickPool]);

  useEffect(() => {
    if (!allDisplayProps.length) return;
    logAllDisplayPropsSample(allDisplayProps);
  }, [allDisplayProps]);

  useEffect(() => {
    if (!selectedSportProps.length && allDisplayProps.length > 0) {
      console.warn("[Prop Pipeline] Emergency display fallback active", {
        allDisplay: allDisplayProps.length,
        selectedSport: sport,
        showing: Math.min(10, allDisplayProps.length),
      });
    }
  }, [selectedSportProps.length, allDisplayProps.length, sport]);

  useEffect(() => {
    if (!visibleStreakSports.length) return;
    if (!visibleStreakSports.some((option) => option.value === streakSport)) {
      setStreakSport(visibleStreakSports[0]?.value || "MLB");
    }
  }, [visibleStreakSports, streakSport]);

  const topPicksForTracking = useMemo(() => topPicksDisplay, [topPicksDisplay]);
  const goblinPropsForTracking = useMemo(
    () => streakFinderProps.filter(isVerifiedSportsbookProp).filter(isGoblinProp),
    [streakFinderProps]
  );
  const demonPropsForTracking = useMemo(
    () =>
      streakFinderProps
        .filter(isVerifiedSportsbookProp)
        .filter(isDemonProp)
        .filter((prop) => Number(prop.confidenceScore || 0) >= CONFIDENCE_THRESHOLDS.DEMON && Number(prop.edge || 0) >= 1),
    [streakFinderProps]
  );
  const visibleReadyToBetProps = useMemo(
    () => readyToBetProps.slice(0, Math.min(visibleLimits.ready, VISIBLE_SECTION_LIMIT)),
    [readyToBetProps, visibleLimits.ready]
  );
  const visibleBestValueProps = useMemo(
    () => bestValueProps.slice(0, Math.min(visibleLimits.value, VISIBLE_SECTION_LIMIT)),
    [bestValueProps, visibleLimits.value]
  );

  const liveDisplayDebugCounts = useMemo(
    () =>
      buildDisplayDebugCounts({
        raw: displayDebugCounts.raw ?? pipelineStageCounts.totalFetched ?? 0,
        parsed: displayDebugCounts.parsed ?? pipelineStageCounts.normalized ?? allDisplayProps.length,
        normalized: allDisplayProps.length,
        display: boardDisplayProps.length,
        selectedSport: sport,
        top2: topPicksDisplay.length,
        ready: readyToBetProps.length,
        rejected: displayDebugCounts.rejected ?? Math.max(0, (displayDebugCounts.raw ?? 0) - allDisplayProps.length),
      }),
    [
      displayDebugCounts,
      pipelineStageCounts,
      allDisplayProps.length,
      boardDisplayProps.length,
      sport,
      topPicksDisplay.length,
      readyToBetProps.length,
    ]
  );
  const rejectedPropSamples = useMemo(
    () =>
      sortGroupedDebugEntries(
        (debugInfo.rejectedProps?.length ? debugInfo.rejectedProps : pipelineAudit.groupedRejections || []).filter(
          (sample) => sample?.reason
        ),
        pipelineAudit
      )
        .filter((sample) => !sample.inactive)
        .slice(0, DEBUG_SAMPLE_LIMIT),
    [debugInfo.rejectedProps, pipelineAudit]
  );
  const underdogDegraded = useMemo(
    () => {
      if (loading) return false;
      if (MLB_ONLY_MODE && prizePicksHasUsableProps(props, sourceStatus)) return false;
      return (
        ["Unavailable", "Failed", "Not Connected", "DEGRADED", "OFFLINE"].includes(String(sourceStatus.Underdog)) ||
        degradedWarnings.some(isNonCriticalUnderdogFailure)
      );
    },
    [loading, sourceStatus, degradedWarnings, props]
  );
  const visibleCriticalWarnings = useMemo(
    () => filterCriticalUiMessages(criticalWarnings, allDisplayProps.length ? allDisplayProps : props, sourceStatus),
    [criticalWarnings, allDisplayProps, props, sourceStatus]
  );
  const displaySourceStatus = useMemo(() => {
    if (!MLB_ONLY_MODE) return sourceStatus;
    return {
      ...sourceStatus,
      Underdog: normalizeUnderdogStatusForMlb(sourceStatus.Underdog, "Unavailable"),
    };
  }, [sourceStatus]);
  const readyRenderCard = useCallback(
    (prop, index) => (
      <PlayerPropCard key={`ready-${prop.id}`} prop={prop} rank={index + 1} compact={compactMode} onOpen={setSelectedEvaluation} />
    ),
    [compactMode]
  );
  const valueRenderCard = useCallback(
    (prop) => <PlayerPropCard key={`value-${prop.id}`} prop={prop} compact={compactMode} onOpen={setSelectedEvaluation} />,
    [compactMode]
  );
  const dashboard = useMemo(() => buildOutcomeDashboard(visibleHistory), [visibleHistory]);
  const quickParlayPicks = useMemo(() => {
    let primary = [];
    if (isSafeModeEnabled()) {
      primary = resolveSafeMlbBoardPicks(scoredDisplayProps, props, DISPLAY_LIMITS.parlayLegs);
    } else {
      try {
        primary = buildQuickParlayPicks(streakSportBoards, parlayRiskMode);
      } catch (error) {
        console.error("[SAFE_MODE] buildQuickParlayPicks failed", error);
        primary = resolveSafeMlbBoardPicks(scoredDisplayProps, props, DISPLAY_LIMITS.parlayLegs);
      }
    }
    const udCount = countUnderdogStreakProps(scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport);
    if (!shouldApplyUnderdogSectionFallbacks(primary.length, udCount, DISPLAY_LIMITS.parlayLegs)) {
      return primary;
    }
    return resolveUnderdogSectionFallbacks(scoredDisplayProps, props, {
      parlayPicks: primary,
      parlayLimit: DISPLAY_LIMITS.parlayLegs,
      parsedUnderdogProps: selectedSportUdProps,
      selectedSport: selectedBoardSport,
    }).parlayPicks;
  }, [streakSportBoards, parlayRiskMode, scoredDisplayProps, props, selectedSportUdProps, selectedBoardSport]);
  const parlayDashboard = useMemo(() => buildParlayDashboard(parlayHistory), [parlayHistory]);
  const refreshBlocked = loading || refreshCooldownSec > 0 || sourceCooldownSec > 0;
  const refreshCountdownSec = Math.max(refreshCooldownSec, sourceCooldownSec);
  const rateLimitNotice =
    sourceCooldownSec > 0
      ? `${RATE_LIMIT_COOLDOWN_MESSAGE} (${formatCooldownRemaining(sourceCooldownSec * 1000)} remaining)`
      : visibleCriticalWarnings.find((warning) => /rate limited|cached lines from/i.test(String(warning))) || "";
  const boardEmptyState = useMemo(() => {
    if (loading) return { kind: "loading", text: "Loading sportsbook lines…" };
    if (allDisplayProps.length > 0) return null;
    if (props.length || usableProps.length || topPickPool.length || boardDisplayProps.length) return null;
    if (sourceCooldownSec > 0) {
      return { kind: "rate_limited", text: "Rate limited — showing cached lines when available." };
    }
    const badges = [
      apiHealth?.PrizePicks?.connectionTier,
      apiHealth?.Underdog?.connectionTier,
      apiHealth?.OddsAPI?.connectionTier,
      sourceStatus?.PrizePicks,
      sourceStatus?.Underdog,
    ].map((value) => String(value || "").toUpperCase());
    const hasLiveProps =
      Number(apiHealth?.PrizePicks?.usableCount) > 0 ||
      Number(apiHealth?.Underdog?.usableCount) > 0 ||
      Number(apiHealth?.PrizePicks?.parsedCount) > 0 ||
      Number(apiHealth?.Underdog?.parsedCount) > 0;
    if (hasLiveProps) return null;
    if (badges.some((value) => value === "FAILED" || value === "OFFLINE")) {
      return { kind: "error", text: NO_VERIFIED_PROPS_MESSAGE };
    }
    if (badges.some((value) => value === "EMPTY" || value === "CACHED")) {
      return { kind: "empty", text: EMPTY_PARSED_MESSAGE };
    }
    return { kind: "empty", text: EMPTY_PARSED_MESSAGE };
  }, [loading, allDisplayProps.length, props.length, usableProps.length, topPickPool.length, boardDisplayProps.length, sourceCooldownSec, apiHealth, sourceStatus]);
  const visibleError = useMemo(
    () => (allDisplayProps.length > 0 ? "" : resolveUiErrorMessage(error, allDisplayProps, sourceStatus)),
    [error, allDisplayProps, sourceStatus]
  );
  const compactSourceWarning = useMemo(() => {
    if (refreshingFeeds) {
      return cacheNotice || "Refreshing feeds...";
    }
    if (allDisplayProps.length > 0) return displayStatusMessage || cacheNotice || "";
    if (sourceCooldownSec > 0) {
      return `PrizePicks rate limited. Showing cached lines. Wait ${sourceCooldownSec}s.`;
    }
    if (cacheNotice) return cacheNotice;
    const softNotice = String(rateLimitNotice || "").trim();
    if (softNotice && allDisplayProps.length) return softNotice;
    return "";
  }, [
    allDisplayProps.length,
    displayStatusMessage,
    sourceCooldownSec,
    cacheNotice,
    rateLimitNotice,
    refreshingFeeds,
  ]);
  const lastUpdatedLabel = lastUpdated ? `${formatDateTime(lastUpdated)}${cacheStatus === "cached" ? " (cached)" : ""}` : "Never";
  const lastUpdatedMs = lastUpdated ? new Date(lastUpdated).getTime() : NaN;
  const staleDataWarning =
    Number.isFinite(lastUpdatedMs) && Date.now() - lastUpdatedMs > DFS_CACHE_TTL_MS
      ? "Stale data warning: refresh today's picks before using these lines."
      : "";
  const historyResultByKey = useMemo(() => {
    const map = new Map();
    visibleHistory.forEach((pick) => {
      map.set(pick.uniqueKey || generatedPickIdentity(pick), pickStatus(pick));
    });
    return map;
  }, [visibleHistory]);
  const prizePicksHtmlWarning = useMemo(
    () => visibleCriticalWarnings.find((warning) => warning.includes(PRIZEPICKS_HTML_BANNER)) || "",
    [visibleCriticalWarnings]
  );
  const sportOptions = getActiveSportFilterOptions(BASE_SPORT_OPTIONS);
  const platformOptions = useMemo(() => platformOptionsForStatus(sourceStatus), [sourceStatus]);

  useEffect(() => {
    if (!isSafeModeEnabled()) return;
    const failedEndpoints = Object.entries(sourceStatus || {})
      .filter(([, value]) => /fail|error|offline|invalid/i.test(String(value || "")))
      .map(([key]) => key);
    logSafeModePipelineCounts({
      rawCount: Number(displayDebugCounts.raw ?? props.length ?? 0),
      mlbCount: mlbDisplayPropCount,
      acceptedCount: acceptedPropsForRender.length,
      rejectedCount: Number(displayDebugCounts.rejected ?? Math.max(0, (displayDebugCounts.raw ?? 0) - allDisplayProps.length)),
      renderErrors,
      failedEndpoints,
    });
  }, [
    displayDebugCounts,
    props.length,
    mlbDisplayPropCount,
    acceptedPropsForRender.length,
    allDisplayProps.length,
    sourceStatus,
    renderErrors,
  ]);

  useEffect(() => {
    if (!MLB_ONLY_MODE || loading || !prizePicksHasUsableProps(props, sourceStatus)) return;
    setCriticalWarnings((current) => {
      const next = filterCriticalUiMessages(current, props, sourceStatus);
      return next.length === current.length ? current : next;
    });
    setDegradedWarnings((current) => (current.length ? [] : current));
    setError((current) => {
      const next = resolveUiErrorMessage(current, props, sourceStatus);
      return next === current ? current : next;
    });
  }, [loading, props, sourceStatus]);


  useEffect(() => {
    if (isSafeModeEnabled()) return;
    if (loading || !lastUpdated) return;
    const generatedPicks = [...generatedStreakPicks(streakSportBoards), ...quickParlayPicks];
    const statsMap = scoringContextRef.current?.stats || new Map();
    let cancelled = false;

    scheduleOutcomeGrading(() => {
      if (cancelled) return;
      let updatedHistory = persistBoardOutcomes(
        {
          topPicks: topPicksForTracking,
          readyToBet: readyToBetProps,
          bestValue: bestValueProps,
          streakFinder: streakFinderProps.slice(0, 12),
          goblins: goblinPropsForTracking,
          demons: demonPropsForTracking,
        },
        readHistory()
      );
      if (generatedPicks.length) {
        updatedHistory = saveGeneratedCategoryPicks(generatedPicks, updatedHistory);
      }
      const graded = gradeCompletedProps(updatedHistory, statsMap);
      updatedHistory = graded.history;

      if (graded.settledCount > 0) writeHistory(updatedHistory);
      else if (updatedHistory.length !== history.length) writeHistory(updatedHistory);

      if (JSON.stringify(updatedHistory.slice(0, 40)) !== JSON.stringify(history.slice(0, 40))) {
        setHistory(updatedHistory);
        const added = Math.max(0, updatedHistory.length - history.length);
        const settleNote = graded.settledCount > 0 ? ` Auto-graded ${graded.settledCount} finished games.` : "";
        setLearningSaveNotice(
          added
            ? `${added} board picks saved for outcome tracking.${settleNote}`
            : `Outcome tracker updated.${settleNote}`
        );
      } else if (graded.settledCount > 0) {
        setHistory(updatedHistory);
        setLearningSaveNotice(`Auto-graded ${graded.settledCount} finished game results.`);
      }
      const updatedParlays = saveGeneratedParlay(quickParlayPicks, parlayHistory);
      if (updatedParlays.length !== parlayHistory.length) setParlayHistory(updatedParlays);
    });

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    lastUpdated,
    streakSportBoards,
    quickParlayPicks,
    history.length,
    parlayHistory,
    topPicksForTracking,
    readyToBetProps,
    bestValueProps,
    streakFinderProps,
    goblinPropsForTracking,
    demonPropsForTracking,
  ]);

  function updatePickResult(id, resultStatus, actualStatResult = null) {
    const updated = history.map((pick) => {
      if (pick.id !== id) return pick;
      if (actualStatResult != null && Number.isFinite(Number(actualStatResult))) {
        return { ...pick, ...gradeOutcome(pick, Number(actualStatResult)), resultStatus, finalResult: resultStatus, result: resultStatus };
      }
      return {
        ...pick,
        resultStatus,
        finalResult: resultStatus,
        result: resultStatus,
        status: resultStatus.toLowerCase() === "pending" ? "pending" : resultStatus.toLowerCase(),
        actualStatResult: actualStatResult ?? pick.actualStatResult ?? "",
        settledAt: resultStatus === "Pending" ? "" : new Date().toISOString(),
      };
    });
    writeHistory(updated);
    setHistory(updated);
    const updatedParlays = refreshParlayResults(parlayHistory, updated);
    writeParlayHistory(updatedParlays);
    setParlayHistory(updatedParlays);
  }

  function clearHistory() {
    if (!window.confirm("Clear all saved pick history?")) return;
    writeHistory([]);
    setHistory([]);
    setLearningSaveNotice("Saved picks cleared.");
  }

  function removeSavedPick(pick = {}) {
    const id = pick.id || pick.historyId;
    if (!id) return;
    const updated = history.filter((row) => row.id !== id);
    writeHistory(updated);
    setHistory(updated);
    setLearningSaveNotice("Saved pick removed.");
  }

  function exportHistoryCsv() {
    const csv = historyToCsv(history);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `props-of-the-day-history-${dateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importHistoryJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "[]"));
        const rows = Array.isArray(parsed) ? parsed : parsed?.history || [];
        if (!rows.length) return;
        const merged = mergeHistoryPicks(readHistory(), rows);
        writeHistory(merged);
        setHistory(merged);
        setLearningSaveNotice(`Imported ${rows.length} history rows.`);
      } catch {
        setError("Could not import history JSON.");
      }
    };
    reader.readAsText(file);
  }

  function handleSettingsSaved() {
    clearApiCache({ preserveLastGood: true });
    clearBoardCache();
  }

  function showMoreSection(section) {
    setVisibleLimits((current) => ({
      ...current,
      [section]: Math.min(VISIBLE_SECTION_LIMIT, Number(current[section] || INITIAL_VISIBLE_SECTION_LIMIT) + 8),
    }));
  }

  function saveThisPick(prop) {
    if (!prop) return;
    if (isManualAnalyzerProp(prop)) {
      const updated = saveLearningPicks([prop], "Manual Analyzer Pick", {
        allowResearch: true,
        allowManualAnalyzer: true,
      });
      setHistory(updated);
      setLearningSaveNotice("Manual pick saved for accuracy review.");
      return;
    }
    if (!isVerifiedSportsbookProp(prop)) {
      setLearningSaveNotice("Only verified sportsbook picks can be saved.");
      return;
    }
    const updated = saveLearningPicks([prop], "Manually Saved Pick", { allowResearch: true });
    setHistory(updated);
    setLearningSaveNotice("Pick saved for accuracy review.");
  }

  async function handleAnalyzeManualProp(form) {
    const editingId = form.editingId || null;
    try {
      const analyzed = await analyzeManualProp(form, scoreManualAnalyzerProp);
      const stableId = editingId || makeManualPropId(form);
      const identityKey = manualPropIdentityKey(form);
      const finalAnalyzed = { ...analyzed, id: stableId };
      persistManualAnalyzerProps((current) =>
        [
          finalAnalyzed,
          ...current.filter(
            (row) => row.id !== finalAnalyzed.id && manualPropIdentityKey(row) !== identityKey
          ),
        ].slice(0, 100)
      );
      setLearningSaveNotice(
        finalAnalyzed.projectionUnavailable || finalAnalyzed.unverifiedGradeBlocked
          ? `${finalAnalyzed.playerName}: ${finalAnalyzed.statusMessage || NO_VERIFIED_GRADE_STATUS}`
          : `Analyzed ${finalAnalyzed.playerName} — confidence ${Math.round(Number(finalAnalyzed.confidenceScore ?? finalAnalyzed.confidence ?? 0))}.`
      );
      return finalAnalyzed;
    } catch (error) {
      console.error("[Manual Analyzer] handleAnalyzeManualProp failed", error);
      throw error;
    }
  }

  function handleRemoveManualProp(propId) {
    persistManualAnalyzerProps((current) => current.filter((row) => row.id !== propId));
  }

  function handleClearManualProps() {
    persistManualAnalyzerProps([]);
    setLearningSaveNotice("Manual prop list cleared.");
  }

  async function handleReanalyzeManualProps() {
    if (!manualAnalyzerProps.length) return;
    try {
      const rescored = await Promise.all(
        manualAnalyzerProps.map((prop) =>
          analyzeManualProp(
            {
              playerName: prop.playerName,
              sport: prop.sport,
              team: prop.team,
              opponent: prop.opponent,
              statType: prop.statType,
              line: prop.line,
              side: prop.side || prop.bestPick || prop.pick,
              source: prop.source || prop.platform,
              payoutType: prop.oddsType || prop.payoutRole || "standard",
              id: prop.id,
            },
            scoreManualAnalyzerProp
          ).then((analyzed) => ({ ...analyzed, id: prop.id }))
        )
      );
      persistManualAnalyzerProps(rescored);
      setLearningSaveNotice(`Re-analyzed ${rescored.length} manual props.`);
    } catch (error) {
      setLearningSaveNotice(error?.message || "Re-analyze failed.");
    }
  }

  function clearOldResearchPicks() {
    const updated = trimHistoryToLimit(
      history.filter((pick) => {
        const status = pick.resultStatus || pick.finalResult || "Pending";
        const confidence = Number(pick.confidenceScore ?? pick.confidence ?? 0);
        const dq = Number(pick.dataQualityScore ?? 0);
        const sourceText = normalize(`${pick.categorySource || ""} ${pick.recommendationType || ""}`);
        const researchLike =
          sourceText.includes("research") ||
          sourceText.includes("model") ||
          confidence < READY_MIN_CONFIDENCE ||
          dq < READY_MIN_DATA_QUALITY;
        return status !== "Pending" || !researchLike;
      })
    );
    writeHistory(updated);
    setHistory(updated);
    setLearningSaveNotice("Old pending research picks cleared; saved history capped to the latest 100.");
  }

  function handleManualStatsSave(propId, manualStats) {
    writeManualStatsForProp(propId, manualStats);
    const context = {
      ...(scoringContextRef.current || {}),
      manualStatsMap: { ...(scoringContextRef.current?.manualStatsMap || readManualStatsMap()), [propId]: manualStats },
    };

    const mergedMap = new Map();
    [...props, ...watchlist, ...nearQualification].forEach((item) => {
      if (item?.id) mergedMap.set(item.id, item);
    });
    const target = mergedMap.get(propId);
    if (target) {
      const scored = scoreDFSProp({ ...target, manualStats }, context);
      const evaluation = evaluateAdaptiveQualification(scored);
      mergedMap.set(propId, applyQualificationLabels(scored, evaluation));
    }
    const boards = buildQualificationBoards(Array.from(mergedMap.values()), safeCreateEmptyPipelineAudit(), readHistory());
    setProps(boards.allDisplayable.slice(0, MAX_RANKED_PROPS));
    setWatchlist(boards.research.slice(0, MAX_WATCHLIST_PROPS));
    setNearQualification(boards.near);
    setQualifiedReadyProps(boards.ready);
    setAcceptedPropsForRender(boards.ready);
    setStreakProps((current) =>
      current.map((item) => (item.id === propId ? mergedMap.get(propId) || item : item))
    );
    setSelectedEvaluation((current) => {
      if (!current || current.id !== propId) return current;
      const scored = scoreDFSProp({ ...current, manualStats }, context);
      const evaluation = evaluateAdaptiveQualification(scored);
      return applyQualificationLabels(scored, evaluation);
    });
    setManualAnalyzerProps((current) => {
      const index = current.findIndex((row) => row.id === propId);
      if (index < 0) return current;
      const scored = scoreDFSProp({ ...current[index], manualStats }, context);
      if (!scored) return current;
      const evaluation = evaluateAdaptiveQualification(scored);
      const next = [...current];
      next[index] = applyQualificationLabels(scored, evaluation);
      writeManualAnalyzerProps(next);
      return next;
    });
    setLearningSaveNotice("Manual stats saved — confidence recalculated.");
  }

  const mobileRefreshLabel = loading
    ? "Loading…"
    : refreshCountdownSec > 0
      ? `Wait ${refreshCountdownSec}s`
      : "Refresh";

  return (
    <>
    <DfsAnalyzerLayout
      appView={appView}
      setAppView={setAppView}
      apiHealth={apiHealth}
      loading={loading}
      loadingStage={loadingStage}
      pipelineDiagnostics={debugInfo?.pipelineDiagnostics || pipelineRenderCounts}
      loadError={error}
      refreshBlocked={refreshBlocked}
      refreshCountdownSec={refreshCountdownSec}
      onRefresh={() => loadProps({ force: true })}
      lastUpdatedLabel={lastUpdatedLabel}
      learningSaveNotice={learningSaveNotice}
      manualAnalyzerProps={manualAnalyzerProps}
      onAnalyzeManualProp={handleAnalyzeManualProp}
      onRemoveManualProp={handleRemoveManualProp}
      onClearManualProps={handleClearManualProps}
      onOpenProp={setSelectedEvaluation}
      onSavePick={saveThisPick}
      topMlbPlayBoard={topMlbPlayBoard}
      verificationFilterDiagnostics={verificationFilterDiagnostics}
      debugPanelsVisible={debugPanelsVisible}
      savedDisplayPicks={savedDisplayPicks}
      onRemoveSavedPick={removeSavedPick}
      onClearSavedPicks={clearHistory}
      onSectionError={handleSectionRenderError}
      showDebugPanels={showDebugPanels}
      onShowDebugPanelsChange={setShowDebugPanels}
      onSettingsSaved={handleSettingsSaved}
      feedHealthContext={feedHealthContext}
      underdogDebugSnapshot={underdogDebugSnapshot}
      debugInfo={debugInfo}
      mlbPipelineStatus={mlbPipelineStatus}
      pipelineRenderCounts={pipelineRenderCounts}
      prizePicksFeedProps={prizePicksFeedProps}
      statsAttachmentAudit={debugInfo?.statsAttachmentAudit || null}
    />

      {selectedEvaluation && (
        <SectionErrorBoundary name="Pick Detail">
          <PickDetailModal
            prop={selectedEvaluation}
            onClose={() => setSelectedEvaluation(null)}
            onSaveManualStats={handleManualStatsSave}
            onSavePick={saveThisPick}
            variant={isManualAnalyzerProp(selectedEvaluation) ? "manual" : "breakdown"}
          />
        </SectionErrorBoundary>
      )}
    </>
  );
}

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function LoadMoreButton({ visible, total, onClick }) {
  if (visible >= total || visible >= VISIBLE_SECTION_LIMIT) return null;
  return (
    <button type="button" style={{ ...styles.secondaryButton, marginTop: "8px" }} onClick={onClick}>
      Load more ({visible}/{Math.min(total, VISIBLE_SECTION_LIMIT)})
    </button>
  );
}

function ParlayLegCard({ prop, onOpen, compactMode = true }) {
  const reason = parlayLegReason(prop);
  return (
    <div>
      <PlayerPropCard prop={prop} onOpen={onOpen} compact={compactMode} cardStyle={styles.parlayCard} />
      {reason ? <p style={{ ...styles.compactFlags, margin: "4px 0 0", paddingLeft: "2px" }}>{reason}</p> : null}
    </div>
  );
}

function boardEmptyMessage({ loading, sport = "all", sourceStatus = {}, platform = "all", criticalWarnings = [] }) {
  if (loading) return LIVE_BOARD_LOADING_STAGES.FETCH;
  const sportLabel = sport === "all" ? "any sport" : sport;
  const htmlIssue = criticalWarnings.some((warning) => /html|non-json|javascript/i.test(warning));
  const ppFailed = sourceStatus.PrizePicks === "Failed";
  const udFailed = sourceStatus.Underdog === "Failed";

  if (htmlIssue) return LIVE_BOARD_UNAVAILABLE_MESSAGE;
  if (ppFailed && udFailed) return LIVE_BOARD_UNAVAILABLE_MESSAGE;
  if (sport !== "all") return `No active ${sport} props scheduled today for ${platform === "all" ? "these platforms" : platform}.`;
  return "No active scheduled props found.";
}

function scoreDFSProp(prop, context) {
  const scopedProp = guardMlbOnlyProp(prop);
  if (!scopedProp) return null;
  prop = scopedProp;
  if (getScoringSportRejectReason(prop)) return null;
  const manualStats = context.manualStatsMap?.[prop.id] || prop.manualStats || null;
  let baseProfile = findStatProfile(context.stats, prop) || context.stats.get(statLookupKey(prop));
  if ((!baseProfile || baseProfile.sparse || baseProfile.fallback) && context.stats instanceof Map) {
    let bestFallback = null;
    context.stats.forEach((profile) => {
      if (!profile || profile.fallback) return;
      if (String(profile.sport || "MLB").toUpperCase() !== "MLB") return;
      if (!playerNamesMatch(profile.playerName, prop.playerName)) return;
      const sampleSize = Number(profile.sampleSize || profile.splits?.length || 0);
      if (sampleSize < 3 && profile.sparse) return;
      if (!bestFallback || sampleSize > Number(bestFallback.sampleSize || bestFallback.splits?.length || 0)) {
        bestFallback = profile;
      }
    });
    if (bestFallback) baseProfile = bestFallback;
  }
  const profile = mergeManualStatsIntoProfile(baseProfile || {}, manualStats);
  const injury = context.news.get(statLookupKey(prop));
  const lineComparison = context.lineComparisonMap.get(sharedLineKey(prop));
  const sportsbookComparison = context.sportsbookComparisonMap.get(sportsbookComparisonKey(prop));
  const lineMovement = context.lineMovementMap?.get(lineMovementKey(prop));
  const enriched = enrichPlayerProfile(profile, prop, { injuryClean: !injury || injury.risk === "Low" });
  const verifiedStats = hasVerifiedStats(enriched);
  const line = Number(prop.line);
  const statModel = projectPlayerProp(
    { ...prop, line },
    { profile: enriched, injury, lineComparison, sportsbookComparison }
  );
  const projectionResult = resolveProjection(prop, enriched, lineComparison, sportsbookComparison);
  let projection = Number.isFinite(statModel.projectedValue) ? statModel.projectedValue : projectionResult.value;
  let projectionSource = Number.isFinite(statModel.projectedValue)
    ? statModel.projectionSource
    : projectionResult.source;
  const projectionReasoning = statModel.projectionReasoning || [];
  let projectionBreakdown = statModel.projectionBreakdown || [];
  let projectionLabel = statModel.projectionLabel || (statModel.isFallbackProjection ? "Projection unavailable" : "Stat-based projection");
  let isFallbackProjection = Boolean(statModel.isFallbackProjection);
  let dataStatus = statModel.dataStatus || null;
  let projectionConfidence = statModel.projectionConfidence ?? null;
  let isVerifiedProjection = Boolean(statModel.isVerifiedProjection);
  let projectionMissingReason = prop.projectionMissingReason || "";

  let mlbVerifiedModel = null;
  let mlbPipelineTrace = null;
  const isMlbProp = String(prop.sport || "").toUpperCase() === "MLB";
  const mlbVerifiedMarket = isMlbVerifiedEngineMarket(prop.statType);
  if (isMlbProp && mlbVerifiedMarket) {
    mlbVerifiedModel = applyMlbProjectionToProp(
      { ...prop, line },
      enriched,
      {
        opponentContext: enriched?.opponentContext,
        impliedGameTotal: enriched?.impliedGameTotal,
        weatherNote: enriched?.weatherNote,
        opponentStarterNote: enriched?.opponentStarterNote,
      }
    );
    projection = mlbVerifiedModel.projection;
    projectionSource = mlbVerifiedModel.projectionSource;
    projectionBreakdown = mlbVerifiedModel.projectionBreakdown || projectionBreakdown;
    projectionLabel = mlbVerifiedModel.projectionLabel || projectionLabel;
    isFallbackProjection = mlbVerifiedModel.isFallbackProjection;
    isVerifiedProjection = mlbVerifiedModel.isVerifiedProjection;
    dataStatus = mlbVerifiedModel.dataStatus || dataStatus;
    projectionConfidence = mlbVerifiedModel.confidence ?? projectionConfidence;
    mlbPipelineTrace = traceLiveBoardMlbProp(
      { ...prop, line },
      enriched,
      mlbVerifiedModel,
      {
        opponentContext: enriched?.opponentContext,
        impliedGameTotal: enriched?.impliedGameTotal,
        weatherNote: enriched?.weatherNote,
        opponentStarterNote: enriched?.opponentStarterNote,
      }
    );
    logMlbData("live.analyze", {
      player: prop.playerName,
      stat: prop.statType,
      line,
      matchedLogs: enriched?.sampleSize ?? enriched?.splits?.length ?? 0,
      projection: mlbVerifiedModel.projection,
      rawEdge: mlbVerifiedModel.rawEdge,
      edge: mlbVerifiedModel.edge,
      recommendation: mlbVerifiedModel.modelPick,
      confidence: mlbVerifiedModel.confidence,
      verified: mlbVerifiedModel.isVerifiedProjection,
      reason: mlbVerifiedModel.projectionUnavailable ? mlbVerifiedModel.statusMessage : null,
      pipelineCode: mlbPipelineTrace?.failureCode,
    });
  } else if (isMlbProp) {
    mlbPipelineTrace = {
      failureCode: null,
      failureReason: mlbVerifiedMarket ? null : `Market "${prop.statType}" not in verified MLB engine`,
      normalizedName: null,
      lastSuccessfulStage: null,
    };
  }

  const mlbPipelineDebug = isMlbProp
    ? buildCardPipelineDebug(mlbPipelineTrace || {}, {
        projectionNotCalled: !mlbVerifiedMarket,
        normalizedName: mlbPipelineTrace?.normalizedName || normalizeSportsbookName(prop.playerName),
        failureReason:
          mlbPipelineTrace?.failureReason ||
          (!mlbVerifiedMarket ? `Market "${prop.statType}" not in verified MLB engine` : null),
      })
    : null;

  const profileIsSparse = Boolean(enriched?.sparse || enriched?.fallback);
  let mlbGradeBlocked = false;
  let mlbGradeBlockReason = "";
  if (isMlbProp) {
    if (!mlbVerifiedMarket) {
      mlbGradeBlocked = true;
      mlbGradeBlockReason = `Market "${prop.statType}" not in verified MLB projection engine.`;
    } else if (
      !mlbVerifiedModel?.isVerifiedProjection ||
      mlbVerifiedModel?.projectionUnavailable ||
      projectionSource === "missing" ||
      isFallbackProjection
    ) {
      mlbGradeBlocked = true;
      mlbGradeBlockReason =
        mlbVerifiedModel?.projectionDebugReason ||
        mlbVerifiedModel?.statusMessage ||
        mlbPipelineTrace?.failureReason ||
        LIVE_LINE_PROJECTION_UNAVAILABLE;
      console.error("[MLB Projection] live board grading blocked", {
        player: prop.playerName,
        statType: prop.statType,
        line,
        reason: mlbGradeBlockReason,
        failureCode: mlbPipelineTrace?.failureCode,
      });
    } else if ((!verifiedStats || profileIsSparse) && !mlbVerifiedModel?.isVerifiedProjection) {
      mlbGradeBlocked = true;
      mlbGradeBlockReason = NO_VERIFIED_GRADE_STATUS;
    }
  }

  if (isMlbProp && mlbVerifiedMarket) {
    recordMlbProjectionResult({
      ok: Boolean(
        mlbVerifiedModel?.isVerifiedProjection &&
          !mlbVerifiedModel?.projectionUnavailable &&
          Number.isFinite(mlbVerifiedModel?.projection) &&
          mlbVerifiedModel.projection > 0 &&
          !mlbGradeBlocked
      ),
      player: prop.playerName,
      statType: prop.statType,
      projection: mlbVerifiedModel?.projection,
      error: mlbGradeBlocked
        ? mlbGradeBlockReason
        : mlbVerifiedModel?.projectionUnavailable
          ? mlbVerifiedModel?.statusMessage || mlbVerifiedModel?.projectionDebugReason
          : "",
      engineOperational: true,
    });
  }

  if (mlbGradeBlocked) {
    projection = null;
    projectionSource = "missing";
    isVerifiedProjection = false;
    isFallbackProjection = false;
    projectionMissingReason =
      prop.projectionMissingReason || "Stat-specific projection unavailable";
  }

  if (!Number.isFinite(projection) || projection <= 0) {
    projection = null;
    projectionSource = "missing";
  }
  if (!verifiedStats && !manualStats && !mlbVerifiedModel?.isVerifiedProjection) {
    projection = Number.isFinite(projection) && projectionSource !== "line-neutral" ? projection : null;
    if (!Number.isFinite(projection)) projectionSource = "missing";
  }

  const sportsbookLine = Number(sportsbookComparison?.marketAverageLine);
  let projectedValue = Number.isFinite(projection) ? round(projection) : null;
  let edgeResult = resolveProjectionEdge(projectedValue, {
    dfsLine: line,
    sportsbookLine: Number.isFinite(sportsbookLine) && sportsbookLine > 0 ? sportsbookLine : null,
  });

  if (mlbVerifiedModel?.isVerifiedProjection && !mlbVerifiedModel.passPlay && mlbVerifiedModel.recommendedSide) {
    edgeResult = {
      edge: mlbVerifiedModel.edge || 0,
      bestPick: mlbVerifiedModel.recommendedSide,
      rawEdge: mlbVerifiedModel.rawEdge || 0,
      sportsbookEdge: null,
      dfsEdge: mlbVerifiedModel.edge || 0,
      edgeLine: line,
    };
  } else if (mlbVerifiedModel?.projectionUnavailable || mlbVerifiedModel?.passPlay) {
    edgeResult = { edge: null, bestPick: "", rawEdge: null, sportsbookEdge: null, dfsEdge: null, edgeLine: line };
  }

  if (!mlbGradeBlocked && !edgeResult.bestPick && !edgeResult.edge) {
    const edgeResolved = resolvePickEdge({
      prop,
      projection: projectedValue,
      line,
      projectionSource,
      sportsbookComparison,
      lineComparison,
    });
    projection = edgeResolved.projection;
    projectionSource = edgeResolved.projectionSource;
    edgeResult = {
      edge: edgeResolved.edge || 0,
      bestPick: edgeResolved.bestPick || "",
      rawEdge: edgeResolved.edge || 0,
      sportsbookEdge: null,
      dfsEdge: null,
      edgeLine: Number.isFinite(sportsbookLine) ? sportsbookLine : line,
    };
  }

  projection = projectedValue ?? projection;
  if (!Number.isFinite(projection) || projection <= 0) {
    projection = null;
    projectedValue = null;
    projectionSource = "missing";
  }
  const hasProjection = Number.isFinite(projection) && projection > 0;
  const bestPick = mlbGradeBlocked ? "" : mlbVerifiedModel?.recommendedSide || edgeResult.bestPick || "";
  let edge = mlbVerifiedModel?.edge ?? edgeResult.edge ?? 0;
  if (!mlbGradeBlocked && !mlbVerifiedModel && edge <= 0 && hasProjection && Number.isFinite(line)) {
    const fallbackDiff = Math.abs(projection - line);
    if (fallbackDiff >= 0.01) {
      edge = round(fallbackDiff);
    }
  }
  if (mlbGradeBlocked) {
    edge = null;
  }
  if (!hasProjection) {
    edge = null;
  }
  const absoluteEdge = edge == null ? 0 : Math.abs(edge);
  const lineValueBoost = lineComparison ? Math.min(10, Math.abs(lineComparison.difference) * 4) : 0;
  const sportsbookBoost = sportsbookValueBoost(prop, bestPick, sportsbookComparison);
  const recentHitRate = Number.isFinite(enriched?.recentHitRate) ? enriched.recentHitRate : null;
  const volatility = Number.isFinite(enriched?.volatility) ? enriched.volatility : null;
  const sampleSize = Number(mlbVerifiedModel?.sampleSize ?? enriched?.sampleSize ?? 0);
  const hasMlbGameLogs = Boolean(
    mlbVerifiedModel?.hasGameLogs ||
      enriched?.hasGameLogs ||
      sampleSize >= 3 ||
      (enriched?.splits?.length ?? 0) >= 3
  );
  const hasVerifiedMlbStats = verifiedStats || Boolean(mlbVerifiedModel?.isVerifiedProjection && hasMlbGameLogs);
  const profileIsFallback = Boolean(enriched?.fallback || enriched?.sparse);
  const historicalHitRateSignal = historicalHitRateForProp(prop, context.historyRows || []);
  const sportsbookDiscrepancyEarly = sportsbookDiscrepancyForPick(prop, bestPick, sportsbookComparison);
  const movementEarly = lineMovementForPick(lineMovement, bestPick);
  const movementBoost = movementEarly?.supportsPick ? 7 : movementEarly?.againstPick ? -8 : 0;
  const dataQualityScore = Math.max(
    22,
    dataQualityFromSignals({
      profile: enriched,
      injury,
      lineComparison,
      sportsbookComparison,
      projection,
      projectionSource,
      edge: absoluteEdge,
      lineMovement: movementEarly,
      prop: { ...prop, manualStats, historicalHitRate: historicalHitRateSignal.hitRate, bestPick },
    })
  );
  const research = assessResearchGaps({ prop, profile: enriched, injury, lineComparison, sportsbookComparison });
  const dataCompleteness = buildDataCompletenessScore({
    profile: enriched,
    injury,
    lineComparison,
    sportsbookComparison,
    prop: { ...prop, manualStats },
    research,
  });
  const lineOnly = isLineOnlyData(prop, {
    profile: enriched,
    lineComparison,
    sportsbookComparison,
    injury,
    projectionSource,
  });
  const statAdj = computeStatConfidenceAdjustments({
    profile: enriched,
    prop: { ...prop, projectionSource, sportsbookComparison, lineComparison },
    bestPick,
    injury,
  });
  const sportsbookDiscrepancy = sportsbookDiscrepancyEarly;
  const movement = movementEarly;
  const sharpMoneyIndicator = sharpMoneyForProp({ sportsbookDiscrepancy, sportsbookComparison, movement, bestPick });
  const matchupRating = matchupRatingFromSignals({ profile: enriched, injury, sportsbookDiscrepancy, lineComparison });
  const hitterResearchOnly = shouldRouteMlbHitterToResearch(
    {
      ...prop,
      sampleSize,
      sparseProfile: profileIsFallback,
      fallbackProfile: profileIsFallback,
      lineOnlyData: lineOnly,
      manualEnriched: Boolean(enriched?.manualEnriched || manualStats),
    },
    enriched,
    { lineOnly }
  );
  const marketResearchOnly = Boolean(
    prop.marketResearchOnly || prop.marketSupportTier === 2 || prop.noveltyMarket || hitterResearchOnly
  );
  const volatilityForEdge = {
    tier:
      enriched?.volatilityLabel ||
      (Number.isFinite(volatility) && volatility >= 3 ? "HIGH" : Number.isFinite(volatility) && volatility <= 1.5 ? "LOW" : "MEDIUM"),
    score: Number.isFinite(enriched?.manualVolatilityScore)
      ? enriched.manualVolatilityScore
      : Number.isFinite(volatility)
        ? clamp(volatility / 4, 0.2, 0.9)
        : 0.5,
  };
  const volatilityAdjustedEdge = computeVolatilityAdjustedEdge(absoluteEdge, volatilityForEdge);
  const gradingDataQuality = computeGradingDataQuality(
    {
      ...prop,
      sampleSize,
      isVerifiedProjection,
      hasVerifiedStats: verifiedStats,
      matchupRating,
      matchupNote: enriched?.matchupNote,
      hasMatchup: Boolean(enriched?.matchupNote || enriched?.handednessMatchup),
      weatherNote: enriched?.weatherNote || prop.weatherNote,
      roleContext: enriched?.roleContext,
      pitchCountTrend: enriched?.pitchCountTrend,
      last5Average: enriched?.last5Average,
      seasonAverage: enriched?.seasonAverage,
      strikeoutTrend: enriched?.strikeoutTrend,
      sportsbookComparison,
      lineComparison,
    },
    enriched
  );
  const confidenceResult = calculateProjectionConfidence(
    {
      ...prop,
      sport: prop.sport,
      statType: prop.statType,
      projectedValue,
      projection,
      projectionSource,
      line,
      edge: round(volatilityAdjustedEdge),
      volatilityAdjustedEdge: round(volatilityAdjustedEdge),
      rawEdge: round(absoluteEdge),
      bestPick,
      last5Average: enriched?.last5Average,
      last10Average: enriched?.last10Average,
      seasonAverage: enriched?.seasonAverage,
      last5HitRate: enriched?.last5HitRate,
      last10HitRate: enriched?.last10HitRate,
      recentHitRate,
      volatility,
      sampleSize,
      opponentAllowed: enriched?.opponentAllowed,
      opponentRank: enriched?.opponentRank,
      handednessMatchup: enriched?.handednessMatchup,
      strikeoutTrend: enriched?.strikeoutTrend,
      matchupNote: enriched?.matchupNote,
      pitchCountTrend: enriched?.pitchCountTrend,
      roleContext: enriched?.roleContext,
      projectedMinutes: enriched?.projectedMinutes,
      usageAdjustment: enriched?.usageAdjustment,
      minutesTrend: enriched?.minutesTrend,
      usageTrend: enriched?.usageTrend,
      parkFactorNote: enriched?.parkFactorNote,
      battingOrderNote: enriched?.battingOrderNote,
      barrelRateEstimate: enriched?.barrelRateEstimate,
      gapPowerRate: enriched?.gapPowerRate,
      extraBaseHitRate: enriched?.extraBaseHitRate,
      recentStolenBaseRate: enriched?.recentStolenBaseRate,
      last5FantasyScores: enriched?.last5FantasyScores,
      holdPct: enriched?.holdPct,
      breakPct: enriched?.breakPct,
      aceRate: enriched?.aceRate,
      h2hEdge: enriched?.h2hEdge,
      firstServePct: enriched?.firstServePct,
      expectedSets: enriched?.expectedSets,
      opponentReturnPct: enriched?.opponentReturnPct,
      pace: enriched?.pace,
      paceRating: enriched?.paceRating,
      impliedRuns: enriched?.impliedRuns ?? enriched?.totalImpliedRuns,
      dataQualityScore,
      gradingDataQuality,
      dataCompleteness,
      hasVerifiedStats: verifiedStats,
      lineComparison,
      sportsbookComparison,
      sportsbookDiscrepancy,
      lineMovement: movement,
      sharpMoneyIndicator,
      matchupRating,
      injuryRisk: injury?.risk,
      fallbackProfile: profileIsFallback,
      marketResearchOnly,
      marketSupportTier: prop.marketSupportTier,
      noveltyMarket: prop.noveltyMarket,
      historicalHitRate: historicalHitRateSignal.hitRate,
      historicalSampleSize: historicalHitRateSignal.sampleSize,
      profile: enriched,
    },
    {
      lineOnly,
      statCap: statAdj.cap,
      statCapReason: statAdj.capReason,
      historyRows: context.historyRows || [],
    }
  );
  let confidenceScore =
    isMlbProp && mlbVerifiedModel?.isVerifiedProjection && Number.isFinite(Number(mlbVerifiedModel.confidence))
      ? Math.round(Number(mlbVerifiedModel.confidence))
      : Math.max(confidenceResult.score, Number.isFinite(line) && line > 0 ? 28 : 0);
  const confidenceBreakdown = confidenceResult.explanation;
  const manualConfidenceAdjustment = clamp(Number(manualStats?.confidenceAdjustment || 0), -15, 15);
  if (Number.isFinite(manualConfidenceAdjustment) && manualConfidenceAdjustment !== 0) {
    confidenceScore = Math.round(clamp(confidenceScore + manualConfidenceAdjustment, 25, 70));
  }
  if (marketResearchOnly && absoluteEdge < 1.5) {
    confidenceScore = Math.min(confidenceScore, 55);
  }
  const sportCapResult = applySportMarketConfidenceCaps(
    { ...prop, marketResearchOnly, marketSupportTier: prop.marketSupportTier },
    confidenceScore,
    enriched
  );
  confidenceScore = sportCapResult.score;
  const sportCapReason = sportCapResult.capReason || "";
  if (mlbGradeBlocked) {
    confidenceScore = DATA_UNAVAILABLE_CONFIDENCE;
  }
  const strongData = confidenceResult.strongData;
  const verifiedHistory = confidenceResult.verifiedHistory;
  const statsMissingExplanation = buildStatsMissingExplanation(research, enriched);
  const statsMissingBadge =
    !verifiedStats || research.showBadge || dataQualityScore < READY_MIN_DATA_QUALITY
      ? { label: "Stats Missing", tone: "weak" }
      : null;
  const { edgeScore, edgeRating } = computeEdgeScore({
    ...prop,
    projection,
    edge: absoluteEdge,
    volatilityAdjustedEdge,
    lineComparison,
    sportsbookComparison,
    sportsbookDiscrepancy,
    lineMovement: movement,
    injuryRisk: injury?.risk,
    dataQualityScore,
    fallbackProfile: profileIsFallback,
    projectionSource,
    recentHitRate,
    volatility,
    last5Average: enriched?.last5Average,
    seasonAverage: enriched?.seasonAverage,
    multiplier: Number(prop.multiplier) || 1,
  });
  const projectionScore = Number.isFinite(projection)
    ? Math.min(26, (absoluteEdge / Math.max(1, Math.abs(line))) * 70)
    : 0;
  const projectionEdge = hasProjection ? projection - line : 0;
  const consistencyScore = recentHitRate == null ? 0 : clamp((recentHitRate - 0.45) * 38, 0, 13);
  const edgeRatingFinal = edgeRating ?? Math.round(clamp(projectionScore * 2.1 + lineValueBoost * 2.2 + sportsbookBoost * 2 + consistencyScore, 0, 100));
  const sportsbookImpliedProbability = sportsbookImpliedForPick(bestPick, sportsbookComparison);
  const sportsbookAveragePrice = sportsbookPriceForPick(bestPick, sportsbookComparison);
  const impliedProbability = Number.isFinite(sportsbookImpliedProbability) ? sportsbookImpliedProbability : 0.5;
  const standardMetrics = hasProjection
    ? computeStandardPropMetrics({ projection, line, edge: computeStandardEdge(projection, line) })
    : { edge: null, edgePercent: null, probabilityScore: null };
  const modelProbability = estimateModelProbability({
    projection,
    line,
    edge: standardMetrics.edge,
    confidenceScore,
    dataQualityScore,
    volatility,
  });
  const probabilityEdge = Number.isFinite(modelProbability) ? round(modelProbability - impliedProbability) : null;
  const riskLevel = computeProjectionRiskLevel({
    confidenceScore,
    calibratedConfidence: confidenceResult.calibratedConfidence,
    volatility,
    injury,
    projectedValue,
    edge: absoluteEdge,
    hasVerifiedStats: verifiedStats,
    sampleSize,
    lineMovement: movement,
    lineMovementTrustScore: confidenceResult.lineMovementTrustScore,
    dataQualityScore,
  });
  const qualityBadge = dataQualityBadge({
    sportsbookVerified: prop.sportsbookVerified,
    verifiedBadge: prop.verifiedBadge,
    projection,
    projectionSource,
    fallbackProfile: profileIsFallback,
    sampleSize,
    dataQualityScore,
    recentHitRate,
    last5HitRate: enriched?.last5HitRate,
    last10HitRate: enriched?.last10HitRate,
    statsMissingExplanation,
  });
  const expectedValue = expectedValueFromProbability(modelProbability, sportsbookAveragePrice);
  const priorityScore = computePropPriorityScore({
    ...prop,
    marketResearchOnly,
    confidenceScore,
    dataQualityScore,
    edge: round(edge),
    expectedValue,
    sharpMoneyIndicator,
    lineMovement: movement,
    matchupRating,
    volatility,
    sampleSize,
    recentHitRate,
    last10HitRate: enriched?.last10HitRate,
    sportsbookDiscrepancy,
    sportsbookComparison,
  });
  const priorityTier = classifyPriorityTier({
    ...prop,
    marketResearchOnly,
    priorityScore,
    sampleSize,
    confidenceScore,
  });
  const researchMissingBadge = statsMissingBadge;
  const lowConfidenceReasons = buildLowConfidenceReasons(
    {
      ...prop,
      confidenceScore,
      dataQualityScore,
      edge: round(edge),
      lineOnlyData: lineOnly,
      fallbackProfile: profileIsFallback,
      projectionSource,
      confidenceCapReason: confidenceResult.capReason || statAdj.capReason || sportCapReason,
      statsMissingExplanation,
    },
    research
  );
  const bettingLabel = isReadyToBet({
    ...prop,
    marketResearchOnly,
    sampleSize,
    confidenceScore,
    dataQualityScore,
    edge: round(edge),
    bestPick,
    fallbackProfile: profileIsFallback,
    projectionSource,
    lineOnlyData: lineOnly,
  })
    ? "Ready to Bet"
    : "Research only";
  const usageAdjustment = usageAdjustmentFromSignals({ prop, profile: enriched });
  const valueTags = valueTagsForProp({
    prop,
    confidenceScore,
    sportsbookDiscrepancy,
    lineComparison,
    movement,
    sharpMoneyIndicator,
    expectedValue,
    recentHitRate,
  });
  const marketAgreementLabel = sportsbookBoost > 0 ? "Sportsbook value" : sportsbookBoost < 0 ? "Market disagreement" : sportsbookComparison ? "No sportsbook edge" : "No sportsbook comp";
  const reasoningSummary = buildReason({
    prop,
    projection,
    bestPick,
    lineComparison,
    sportsbookComparison,
    sportsbookDiscrepancy,
    profile: enriched,
    injury,
    confidenceScore,
    edge,
    projectionSource,
    modelProbability,
    impliedProbability,
    expectedValue,
    sharpMoneyIndicator,
    movement,
    matchupRating,
    usageAdjustment,
  });

  const timeBadge =
    prop.timeUncertainty && prop.timeUncertainty !== "ok"
      ? { label: "Time uncertain", tone: "partial" }
      : null;

  const qualificationReason = mlbGradeBlocked
    ? mlbGradeBlockReason || LIVE_LINE_PROJECTION_UNAVAILABLE
    : buildQualificationReason({
        ...prop,
        projectedValue,
        projection,
        edge: edge == null ? null : round(edge),
        bestPick,
        confidenceScore,
        volatility,
        riskLevel,
      });

  const playTag =
    mlbGradeBlocked || !isVerifiedProjection
      ? null
      : resolveStrongPlayTag({
          ...prop,
          projection,
          projectedValue,
          isVerifiedProjection,
          hasVerifiedStats: verifiedStats,
          sampleSize,
          edge,
          volatilityAdjustedEdge,
          confidenceScore,
          confidence: confidenceScore,
          volatility,
          volatilityTier: volatilityForEdge.tier,
          gradingDataQuality,
          matchupRating,
          matchupNote: enriched?.matchupNote,
          hasMatchup: Boolean(enriched?.matchupNote || enriched?.handednessMatchup),
          weatherNote: enriched?.weatherNote || prop.weatherNote,
          roleContext: enriched?.roleContext,
          pitchCountTrend: enriched?.pitchCountTrend,
          last5Average: enriched?.last5Average,
          seasonAverage: enriched?.seasonAverage,
        });

  return (() => {
    const decision = enrichPropDecision(
    {
    ...prop,
    marketResearchOnly,
    lineSourceBadge: prop.lineSourceBadge || "LIVE",
    verifiedBadge: prop.sportsbookVerified ? "VERIFIED" : prop.verifiedBadge || null,
    timeBadge: prop.timeBadge || timeBadge,
    propType: prop.propType || prop.statType,
    id: makePropId(prop),
    playerImage: prop.playerImage || enriched?.playerImage || enriched?.headshot || enriched?.imageUrl || "",
    headshot: prop.headshot || enriched?.headshot || enriched?.playerImage || "",
    imageUrl: prop.imageUrl || enriched?.imageUrl || enriched?.playerImage || "",
    mlbId: prop.mlbId || enriched?.mlbId || enriched?.profile?.mlbId || null,
    playerId: prop.playerId || enriched?.playerId || enriched?.profile?.playerId || null,
    projection,
    projectedValue: Number.isFinite(projection) ? round(projection) : null,
    projectionForStatType: prop.statType || prop.market || prop.propType || null,
    projectionSource,
    projectionMissingReason: mlbGradeBlocked
      ? projectionMissingReason || mlbGradeBlockReason || LIVE_LINE_PROJECTION_UNAVAILABLE
      : prop.projectionMissingReason || "",
    projectionReasoning,
    projectionBreakdown,
    projectionLabel,
    isFallbackProjection,
    dataStatus: dataStatus || statModel.dataStatus || null,
    projectionConfidence: projectionConfidence ?? statModel.projectionConfidence ?? null,
    isVerifiedProjection,
    modelPick: mlbGradeBlocked ? null : mlbVerifiedModel?.modelPick || (bestPick ? String(bestPick).toUpperCase() : null),
    passPlay: Boolean(mlbVerifiedModel?.passPlay || mlbGradeBlocked),
    projectionUnavailable: Boolean(mlbVerifiedModel?.projectionUnavailable || mlbGradeBlocked),
    unverifiedGradeBlocked: mlbGradeBlocked,
    modelReasons: mlbVerifiedModel?.modelReasons || null,
    displayStatus: mlbGradeBlocked ? "NO VERIFIED PLAY" : mlbVerifiedModel?.displayStatus || null,
    statusMessage: mlbGradeBlocked
      ? mlbGradeBlockReason || LIVE_LINE_PROJECTION_UNAVAILABLE
      : mlbVerifiedModel?.statusMessage || null,
    projectionDebugReason: mlbGradeBlocked
      ? mlbGradeBlockReason || mlbPipelineTrace?.failureReason || LIVE_LINE_PROJECTION_UNAVAILABLE
      : mlbVerifiedModel?.projectionDebugReason || null,
    whyThisPick: mlbVerifiedModel?.whyThisPick || qualificationReason,
    analyticsReason: mlbVerifiedModel?.analyticsReason || reasoningSummary,
    edgePercent: mlbGradeBlocked ? null : standardMetrics.edgePercent,
    probabilityScore: mlbGradeBlocked ? null : standardMetrics.probabilityScore,
    manualVolatilityScore: mlbVerifiedModel?.volatility?.score ?? null,
    volatilityLabel: mlbVerifiedModel?.volatilityLabel || null,
    riskLevel: mlbVerifiedModel?.risk || riskLevel,
    statProfileSource: enriched?.source || "",
    statEnrichmentSources: enriched?.statSources || [],
    fallbackProfile: profileIsFallback,
    hasVerifiedStats: hasVerifiedMlbStats,
    hasGameLogs: hasMlbGameLogs,
    recentForm: mlbVerifiedModel?.recentForm ?? enriched?.last5Average ?? null,
    sparseProfile: Boolean(enriched?.sparse),
    manualEnriched: Boolean(enriched?.manualEnriched || manualStats),
    confidenceScore,
    confidence: confidenceScore,
    confidenceFactors: mlbVerifiedModel?.confidenceFactors || prop.confidenceFactors || null,
    gradingDataQuality,
    playTag,
    volatilityAdjustedEdge: round(volatilityAdjustedEdge),
    rawEdge: round(absoluteEdge),
    calibratedConfidence: confidenceResult.calibratedConfidence,
    calibrationAdjustment: confidenceResult.calibrationAdjustment,
    calibrationNote: confidenceResult.calibrationNote,
    tierActualHitRate: confidenceResult.tierActualHitRate,
    marketHistoricalHitRate: confidenceResult.marketHistoricalHitRate,
    marketHistoricalSample: confidenceResult.marketHistoricalSample,
    lineMovementTrustScore: confidenceResult.lineMovementTrustScore,
    lineMovementTrustLabel: confidenceResult.lineMovementTrustLabel,
    confidenceBreakdown,
    confidenceCapReason: confidenceResult.capReason || statAdj.capReason || sportCapReason || "",
    marketModel: confidenceResult.marketModel || null,
    marketModelLabel: confidenceResult.marketModelLabel || null,
    volatilityTier: confidenceResult.volatilityTier || null,
    projectionAgreement: confidenceResult.projectionAgreement ?? null,
    meetsVolatilityRequirements: confidenceResult.meetsVolatilityRequirements ?? true,
    strongData,
    verifiedHistory,
    historicalHitRate: historicalHitRateSignal.hitRate,
    historicalSampleSize: historicalHitRateSignal.sampleSize,
    historicalHitRateNote: historicalHitRateSignal.note,
    edgeScore,
    edgeRating: edgeRatingFinal,
    edge: mlbGradeBlocked || standardMetrics.edge == null ? null : round(standardMetrics.edge),
    sport: getTrustedSportFromProp(prop) || prop.sport,
    sportsbookEdge: edgeResult.sportsbookEdge,
    dfsEdge: edgeResult.dfsEdge,
    dataQualityScore: Math.round(dataQualityScore),
    riskLevel,
    qualificationReason,
    bestPick,
    lineComparison,
    sportsbookComparison,
    sportsbookDiscrepancy,
    marketAgreementLabel,
    modelSide: bestPick,
    projectionEdge: Number.isFinite(projectionEdge) ? round(projectionEdge) : 0,
    recentHitRate,
    volatility,
    sampleSize,
    last5HitRate: Number.isFinite(enriched?.last5HitRate) ? enriched.last5HitRate : null,
    last10HitRate: Number.isFinite(enriched?.last10HitRate) ? enriched.last10HitRate : null,
    last5Average: Number.isFinite(enriched?.last5Average) ? enriched.last5Average : null,
    last10Average: Number.isFinite(enriched?.last10Average) ? enriched.last10Average : null,
    seasonAverage: Number.isFinite(enriched?.seasonAverage) ? enriched.seasonAverage : null,
    injuryRisk: injury?.risk || "Low",
    modelProbability,
    impliedProbability,
    probabilityEdge,
    expectedValue,
    sportsbookAveragePrice,
    lineMovement: movement,
    lineMovementTag: movement?.tag || confidenceResult.lineMovementTrustLabel || null,
    sharpMoneyIndicator,
    matchupRating,
    usageAdjustment,
    valueTags,
    status: "upcoming",
    generatedAt: new Date().toISOString(),
    reasoningSummary,
    dataQualityBadge: qualityBadge,
    manualStats,
    dataCompleteness,
    lineOnlyData: lineOnly,
    researchGaps: research.gaps,
    researchMissingBadge,
    statsMissingExplanation,
    statsMissingBadge,
    lowConfidenceReasons,
    priorityScore,
    priorityTier,
    deprioritized: priorityTier === "deprioritized",
    bettingLabel,
    minutesTrend: enriched?.minutesTrend?.label || null,
    usageTrend: enriched?.usageTrend?.label || null,
    pitchCountTrend: enriched?.pitchCountTrend || enriched?.roleContext || null,
    matchupNote: enriched?.matchupNote || null,
    manualConfidenceAdjustment,
    last5FantasyScores: enriched?.last5FantasyScores || null,
    strikeoutTrend: enriched?.strikeoutTrend || null,
    handednessMatchup: enriched?.handednessMatchup || null,
    crossesAverage: enriched?.crossesAverage ?? null,
    dataSources: dataSourcesUsed({
      ...prop,
      lineComparison,
      sportsbookComparison,
      statProfileSource: profile?.source || "",
      statEnrichmentSources: enriched?.statSources || [],
      historicalHitRate: historicalHitRateSignal.hitRate,
      injuryRisk: injury?.risk,
      lineMovement: movement,
    }),
    payoutLabel: propPayoutLabel(prop),
    pipelineFailureCode: mlbPipelineDebug?.pipelineFailureCode || null,
    pipelineDebugLine: mlbPipelineDebug?.pipelineDebugLine || null,
    mlbPipelineTrace: mlbPipelineDebug?.mlbPipelineTrace || mlbPipelineTrace || null,
  }, { historyRows: context.historyRows || [] });
    return isEliteTopPickEligible(decision) ? attachElitePickExplanation(decision) : decision;
  })();
}

function resolveProjection(prop, profile, lineComparison, sportsbookComparison) {
  if (prop.projection != null && prop.projection !== "") {
    const direct = Number(prop.projection);
    if (Number.isFinite(direct) && direct >= 0) return { value: round(direct), source: "model" };
  }
  if (profile?.projection != null && profile.projection !== "") {
    const profiled = Number(profile.projection);
    if (Number.isFinite(profiled) && profiled >= 0) return { value: round(profiled), source: profile.projectionSource || "player-stats" };
  }

  const sportsbookMarketLine = Number(sportsbookComparison?.marketAverageLine);
  if (Number.isFinite(sportsbookMarketLine) && sportsbookMarketLine > 0) {
    return { value: round(sportsbookMarketLine), source: "sportsbook-market" };
  }

  const peerMarketLine = Number(lineComparison?.marketAverageLine);
  if (Number.isFinite(peerMarketLine) && peerMarketLine > 0) {
    return { value: round(peerMarketLine), source: "platform-line-comparison" };
  }

  return { value: null, source: "missing" };
}

function buildReason({
  prop,
  projection,
  bestPick,
  lineComparison,
  sportsbookComparison,
  sportsbookDiscrepancy,
  profile,
  injury,
  confidenceScore,
  edge,
  projectionSource,
  modelProbability,
  impliedProbability,
  expectedValue,
  sharpMoneyIndicator,
  movement,
  matchupRating,
  usageAdjustment,
}) {
  const parts = [];
  if (!bestPick) {
    parts.push(`${NO_EDGE_MESSAGE} ${projectionSource === "missing" ? NEEDS_STATS_MESSAGE : ""}`.trim());
  } else if (Number.isFinite(projection)) {
    const projectionLabel =
      projectionSource === "player-stats"
        ? "player-stat projection"
        : projectionSource === "fallback-player-stats"
          ? "fallback stat projection"
          : "model projection";
    parts.push(`${bestPick} ${formatNumber(prop.line)} because the ${projectionLabel} is ${formatNumber(projection)} with a ${formatSignedNumber(edge)} edge.`);
  } else {
    parts.push(`${NO_EDGE_MESSAGE} ${NEEDS_STATS_MESSAGE}`);
  }

  if (lineComparison) {
    parts.push(
      `PrizePicks ${formatMaybeLine(lineComparison.prizePicksLine)} vs Underdog ${formatMaybeLine(lineComparison.underdogLine)} creates a ${formatNumber(lineComparison.difference)} line gap.`
    );
  }

  if (Number.isFinite(profile?.recentHitRate)) {
    parts.push(`Recent stability signal is ${Math.round(profile.recentHitRate * 100)}%.`);
  }

  if (Number.isFinite(profile?.last5HitRate) || Number.isFinite(profile?.last10HitRate)) {
    parts.push(`Hit rates: L5 ${formatPercent(profile?.last5HitRate)} / L10 ${formatPercent(profile?.last10HitRate)}.`);
  }

  if (sportsbookComparison) {
    parts.push(`Sportsbook market average is ${formatNumber(sportsbookComparison.marketAverageLine)}, creating a ${formatSignedNumber(sportsbookDiscrepancy)} DFS discrepancy.`);
  }

  if (Number.isFinite(modelProbability) && Number.isFinite(impliedProbability)) {
    parts.push(`Model probability ${formatPercent(modelProbability)} vs implied ${formatPercent(impliedProbability)} with EV ${formatSignedPercent(expectedValue)}.`);
  }

  if (sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal") {
    parts.push(`Sharp money: ${sharpMoneyIndicator}.`);
  }

  if (movement?.label) {
    parts.push(`Line movement: ${movement.label}.`);
  }

  if (matchupRating) {
    parts.push(`Matchup rating: ${matchupRating}.`);
  }

  if (profile?.matchupNote) {
    parts.push(`Manual matchup context: ${profile.matchupNote}.`);
  }

  if (Number.isFinite(Number(profile?.confidenceAdjustment))) {
    parts.push(`Manual confidence override: ${formatSignedNumber(profile.confidenceAdjustment)} points.`);
  }

  if (usageAdjustment) {
    parts.push(`Usage adjustment: ${usageAdjustment}.`);
  }

  if (injury?.risk && injury.risk !== "Low") {
    parts.push(`${injury.risk} injury/news concern lowers trust.`);
  }

  parts.push(`Confidence score is ${confidenceScore}/100.`);
  return parts.join(" ");
}

function buildSportsbookComparisonMap(comparisons = []) {
  const map = new Map();
  comparisons.forEach((comparison) => {
    if (!comparison?.playerName || !comparison?.statType) return;
    map.set(sportsbookComparisonKey(comparison), comparison);
  });
  return map;
}

function createDebugInfo(selectedSource = "all") {
  const pipelineAudit = safeCreateEmptyPipelineAudit();
  return {
    selectedSource,
    sources: {
      PrizePicks: emptySourceDebug("PrizePicks"),
      Underdog: emptySourceDebug("Underdog"),
      "The Odds API": emptySourceDebug("The Odds API"),
    },
    totals: {
      rawPropsLoaded: 0,
      upcomingSlateCount: 0,
      slateExcludedCount: 0,
      activeProps: 0,
      propsAfterFilters: 0,
      recommendedProps: 0,
      watchlistProps: 0,
      streakProps: 0,
    },
    upcomingSlateCount: 0,
    slateExcludedCount: 0,
    pregameWindowHours: DEFAULT_PREGAME_WINDOW_HOURS,
    pipelineAudit,
    rejectedProps: [],
    pipelineStats: createEmptyPipelineStats(pipelineAudit),
    validationSummary: createEmptyValidationSummary(),
    qualificationSummary: createEmptyValidationSummary(),
  };
}

function emptySourceDebug(source) {
  return {
    source,
    status: "Pending",
    apiStatus: "Pending",
    apiUrl: "",
    endpointsTried: [],
    rawPropsLoaded: 0,
    propsAfterParsing: 0,
    propsAfterFilters: 0,
    visibleAfterCurrentFilters: null,
    message: "",
  };
}

function attachSourceFilterCounts(debugInfo, { rawProps, activeProps, normalProps, slateProps = rawProps }) {
  Object.keys(debugInfo.sources).forEach((source) => {
    if (source === "The Odds API") return;
    const platform = source;
    const rawCount = rawProps.filter((prop) => prop.platform === platform).length;
    const slateCount = slateProps.filter((prop) => prop.platform === platform).length;
    const activeCount = activeProps.filter((prop) => prop.platform === platform).length;
    const filteredCount = normalProps.filter((prop) => prop.platform === platform).length;
    debugInfo.sources[source] = {
      ...debugInfo.sources[source],
      rawPropsLoaded: Math.max(Number(debugInfo.sources[source].rawPropsLoaded || 0), rawCount),
      propsAfterParsing: Math.max(Number(debugInfo.sources[source].propsAfterParsing || 0), rawCount),
      upcomingSlateCount: slateCount,
      activeProps: activeCount,
      propsAfterFilters: filteredCount,
    };
  });
  debugInfo.upcomingSlateCount = slateProps.length;
}

function attachScoredSourceCounts(debugInfo, { recommendedProps, watchlistProps, streakProps }) {
  Object.keys(debugInfo.sources).forEach((source) => {
    if (source === "The Odds API") return;
    const platform = source;
    const recommendedCount = recommendedProps.filter((prop) => prop.platform === platform).length;
    const watchlistCount = watchlistProps.filter((prop) => prop.platform === platform).length;
    const streakCount = streakProps.filter((prop) => prop.platform === platform).length;
    debugInfo.sources[source] = {
      ...debugInfo.sources[source],
      recommendedProps: recommendedCount,
      watchlistProps: watchlistCount,
      streakProps: streakCount,
      propsAfterFilters: recommendedCount + watchlistCount + streakCount,
    };
  });
}

function buildVisibleDebugPanel(debugInfo, { platform, props, watchlist, streakProps, filteredProps, filteredWatchlist, filteredStreakProps, streakSportBoards, history, lastUpdated, sourceStatus }) {
  const panel = debugInfo || createDebugInfo(platform);
  const next = {
    ...panel,
    selectedSource: platform,
    sources: { ...panel.sources },
  };
  Object.keys(DEFAULT_SOURCE_STATUS).forEach((source) => {
    const row = next.sources[source] || emptySourceDebug(source);
    const status = row.status && row.status !== "Pending" ? row.status : sourceStatus?.[source] || row.status || "Pending";
    next.sources[source] = {
      ...row,
      status,
      apiStatus: row.apiStatus && row.apiStatus !== "Pending" ? row.apiStatus : status,
      message:
        source === "Underdog" && status !== "Connected" && status !== "Pending"
          ? row.message || UNDERDOG_UNAVAILABLE_MESSAGE
          : row.message,
    };
  });
  Object.keys(next.sources).forEach((source) => {
    if (source === "The Odds API") return;
    const platformName = source;
    const allCount = [...props, ...watchlist, ...streakProps].filter((prop) => prop.platform === platformName).length;
    const visibleCount = [...filteredProps, ...filteredWatchlist, ...filteredStreakProps].filter(
      (prop) => prop.platform === platformName
    ).length;
    next.sources[source] = {
      ...next.sources[source],
      rawPropsLoaded: Number(next.sources[source].rawPropsLoaded || 0) || allCount,
      propsAfterParsing: Number(next.sources[source].propsAfterParsing || 0) || allCount,
      propsAfterFilters: Math.max(Number(next.sources[source].propsAfterFilters || 0), allCount),
      visibleAfterCurrentFilters: platform === "all" || normalize(platform) === normalize(source) ? visibleCount : 0,
    };
  });
  const generated = generatedStreakPicks(streakSportBoards);
  const sourceCounts = countBy(generated, (pick) => pick.platform || "Unknown");
  next.generatedBySport = STREAK_TAB_OPTIONS
    .map((option) => ({
      sport: option.label,
      count: generated.filter((pick) => (pick.streakTab || pick.streakSport) === option.value).length,
    }))
    .filter((row) => row.count > 0 || STREAK_TAB_OPTIONS.find((option) => option.label === row.sport)?.always);
  next.savedPicks = Array.isArray(history) ? history.length : 0;
  next.lastRefresh = lastUpdated || "";
  next.sourceMix = Object.entries(sourceCounts).map(([source, count]) => `${source}: ${count}`).join(" | ");
  return next;
}

function platformOptionsForStatus(sourceStatus = {}) {
  return PLATFORM_OPTIONS.map((option) => {
    if (option.id !== "underdog") return option;
    const status = sourceStatus.Underdog || "Pending";
    if (status === "Connected" || status === "Full") return option;
    return {
      ...option,
      label: `Underdog (${status === "Pending" ? "Checking" : "Not Connected"})`,
      statusMessage: UNDERDOG_UNAVAILABLE_MESSAGE,
    };
  });
}

function sourceLabel(source) {
  if (source === "all") return "All Sources";
  if (source === "sportsbookEdge") return "Sportsbook Edge";
  if (source === "prizepicks") return "PrizePicks";
  if (source === "underdog") return "Underdog";
  return source;
}

function sportsbookSourceStatus(result = {}) {
  if (result.cached || result.rateLimited) return "Cached";
  const warnings = result.warnings || [];
  if (
    warnings.some((warning) =>
      /missing api key|api limit reached|could not load sportsbook|sportsbook comparison unavailable/i.test(warning)
    )
  ) {
    return "Failed";
  }
  return "Connected";
}

function buildModelSignalMap(props = []) {
  const map = new Map();
  props.forEach((prop) => {
    const key = streakModelSignalKey(prop);
    const existing = map.get(key);
    if (!existing || modelSignalStrength(prop) > modelSignalStrength(existing)) {
      map.set(key, {
        confidenceScore: prop.confidenceScore,
        edge: prop.edge,
        edgeRating: prop.edgeRating,
        dataQualityScore: prop.dataQualityScore,
        projection: prop.projection,
        projectionSource: prop.projectionSource,
        modelSide: prop.modelSide || prop.bestPick,
        recentHitRate: prop.recentHitRate,
        last5HitRate: prop.last5HitRate,
        last10HitRate: prop.last10HitRate,
        volatility: prop.volatility,
        sampleSize: prop.sampleSize,
        historicalHitRate: prop.historicalHitRate,
        historicalSampleSize: prop.historicalSampleSize,
        injuryRisk: prop.injuryRisk,
        sportsbookDiscrepancy: prop.sportsbookDiscrepancy,
        sportsbookAveragePrice: prop.sportsbookAveragePrice,
        marketAgreementLabel: prop.marketAgreementLabel,
        modelProbability: prop.modelProbability,
        impliedProbability: prop.impliedProbability,
        probabilityEdge: prop.probabilityEdge,
        expectedValue: prop.expectedValue,
        lineMovement: prop.lineMovement,
        sharpMoneyIndicator: prop.sharpMoneyIndicator,
        matchupRating: prop.matchupRating,
        usageAdjustment: prop.usageAdjustment,
        statProfileSource: prop.statProfileSource,
        fallbackProfile: prop.fallbackProfile,
        valueTags: prop.valueTags,
        playerImage: prop.playerImage || prop.headshot || prop.imageUrl || "",
      });
    }
  });
  return map;
}

function modelSignalStrength(signal) {
  return Number(signal.dataQualityScore || 0) + Number(signal.confidenceScore || 0) * 0.35 + Number(signal.edgeRating || 0) * 0.2;
}

function buildLineComparisonMap(props) {
  const grouped = new Map();
  props.forEach((prop) => {
    const key = sharedLineKey(prop);
    const existing = grouped.get(key) || [];
    existing.push(prop);
    grouped.set(key, existing);
  });

  const comparisons = new Map();
  grouped.forEach((group, key) => {
    const prizePicks = group.find((prop) => prop.platform === "PrizePicks");
    const underdog = group.find((prop) => prop.platform === "Underdog");
    if (!prizePicks || !underdog) return;

    const prizePicksLine = Number(prizePicks.line);
    const underdogLine = Number(underdog.line);
    const marketAverageLine = (prizePicksLine + underdogLine) / 2;
    const difference = Math.abs(prizePicksLine - underdogLine);
    const lower = prizePicksLine <= underdogLine ? prizePicks : underdog;
    const higher = prizePicksLine > underdogLine ? prizePicks : underdog;

    comparisons.set(key, {
      prizePicksLine,
      underdogLine,
      marketAverageLine,
      difference,
      betterPlatform: difference === 0 ? "Even" : `${lower.platform} More / ${higher.platform} Less`,
      betterDirection: difference === 0 ? "More" : "More",
    });
  });

  return comparisons;
}

function isActiveUpcomingProp(prop, options = {}) {
  return isUpcomingSlateProp(prop, options);
}

function isSupportedAppSport(prop) {
  if (prop.sport === APP_SPORTS.Unsupported || prop.unsupportedSport) return false;
  return SUPPORTED_SPORTS.has(prop.sport);
}

function isAllowedAppMarket(prop) {
  return isApprovedMarket(prop);
}

function getBaseActiveFilterReason(prop, options = {}) {
  const sport = canonicalSportFromProp(prop);
  if (options.excludeUnsupportedMarkets !== false) {
    if (prop.unsupportedSport || sport === APP_SPORTS.Unsupported) {
      return `unsupported sport: ${sport || prop.sport || "Unknown"}`;
    }
    if (!isApprovedMarket({ ...prop, sport })) {
      return `unapproved market: ${prop.marketLabel || prop.statType || "Unknown"}`;
    }
    if (options.hideEsports && (prop.esports || sport === APP_SPORTS.Esports)) {
      return "esports excluded by filter";
    }
  }
  if (!isSupportedAppSport({ ...prop, sport })) return `unsupported sport: ${sport || prop.sport || "Unknown"}`;
  if (!options.includeUncertain) {
    const stale = getStaleFilterReason(prop, options);
    if (stale) return stale;
  } else if (prop.status === "locked" || prop.status === "expired") {
    return "locked or expired";
  }
  return "";
}

function getPreScoringFilterReason(prop, options = {}) {
  const sportReject = getScoringSportRejectReason(prop);
  if (sportReject) return sportReject;
  const sport = getTrustedSportFromProp(prop) || canonicalSportFromProp(prop);
  if (!isSupportedAppSport({ ...prop, sport })) return `unsupported sport: ${sport || prop.sport || "Unknown"}`;
  if (!isApprovedMarket({ ...prop, sport })) return `unapproved market: ${prop.marketLabel || prop.statType || "Unknown"}`;
  if (!options.includeUncertain && isAdjustedOddsProp(prop)) return "adjusted odds prop handled by Streak Finder";
  if (!isUpcomingSlateProp(prop, options)) return getSlateFilterReason(prop, options) || "not an upcoming slate prop";
  return "";
}

function prioritizePreScoringProps(props = []) {
  return [...props].sort((a, b) => {
    const aPriority = computePreScorePriority(a);
    const bPriority = computePreScorePriority(b);
    if (aPriority !== bPriority) return bPriority - aPriority;
    const aStart = new Date(a.startTime).getTime();
    const bStart = new Date(b.startTime).getTime();
    const safeA = Number.isFinite(aStart) ? aStart : Number.MAX_SAFE_INTEGER;
    const safeB = Number.isFinite(bStart) ? bStart : Number.MAX_SAFE_INTEGER;
    return safeA - safeB;
  });
}

function preScoringPriority(prop) {
  return computePreScorePriority(prop);
}

function matchesStatTypeFilter(prop, statType) {
  return statType === "all" || normalize(prop.statType) === normalize(statType);
}

function matchesUiFiltersRelaxed(prop, filters) {
  return (
    matchesPlatformFilter(prop, filters.platform) &&
    matchesSportFilter(prop, filters.sport) &&
    matchesStatTypeFilter(prop, filters.statType) &&
    matchesSearchFilter(prop, filters.searchTerm)
  );
}

function matchesUiFilters(prop, filters) {
  if (filters.sharpOnly && !isSharpOnlyCandidate(prop)) return false;
  if (filters.hideResearchOnly && !isReadyToBet(prop)) return false;
  if (filters.hideUnsupportedMarkets && (prop.marketUnsupported || prop.unsupportedSport)) return false;
  if (filters.hideEsports && (prop.esports || prop.sport === APP_SPORTS.Esports)) return false;
  return (
    matchesPlatformFilter(prop, filters.platform) &&
    matchesSportFilter(prop, filters.sport) &&
    matchesStatTypeFilter(prop, filters.statType) &&
    matchesEdgeFilter(prop, filters.edgeFilter) &&
    matchesDateFilter(prop, filters.dateFilter) &&
    matchesSearchFilter(prop, filters.searchTerm) &&
    (!filters.readyOnly || isReadyToBet(prop))
  );
}

function matchesSearchFilter(prop, searchTerm = "") {
  const term = String(searchTerm || "").trim().toLowerCase();
  if (!term) return true;
  const haystack = [
    prop.playerName,
    prop.player,
    prop.team,
    prop.opponent,
    prop.platform,
    prop.sport,
    prop.league,
    prop.statType,
    prop.propType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function matchesDateFilter(prop, dateFilter = "allUpcoming") {
  if (!dateFilter || dateFilter === "allUpcoming") return true;
  const start = new Date(prop.startTime).getTime();
  if (!Number.isFinite(start)) return true;
  const propDay = dateKey(new Date(start));
  const now = new Date();
  const today = dateKey(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = dateKey(tomorrowDate);
  if (dateFilter === "today") return propDay === today;
  if (dateFilter === "tomorrow") return propDay === tomorrow;
  return true;
}

// isReadyToBet imported from pickScoring.js

function matchesPlatformFilter(prop, platform) {
  if (platform === "both" || platform === "all") return true;
  if (platform === "sportsbookEdge") return hasSportsbookEdge(prop);
  return normalize(prop.platform) === normalize(platform);
}

function matchesSportFilter(prop, sport) {
  return matchesSelectedSportFilter(prop, sport);
}

function hasSportsbookEdge(prop) {
  const direct = Number(prop.sportsbookDiscrepancy);
  const signal = Number(prop.modelSignal?.sportsbookDiscrepancy);
  return (Number.isFinite(direct) && direct > 0) || (Number.isFinite(signal) && signal > 0);
}

function matchesEdgeFilter(prop, edgeFilter) {
  if (!edgeFilter || edgeFilter === "all") return true;
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const expectedValue = Number(prop.expectedValue || prop.modelSignal?.expectedValue);
  const multiplier = Number(prop.multiplier);
  const start = new Date(prop.startTime).getTime();
  const hoursUntilStart = Number.isFinite(start) ? (start - Date.now()) / (60 * 60 * 1000) : 0;
  if (edgeFilter === "highConfidence") return confidence >= 68;
  if (edgeFilter === "valuePlays") return hasSportsbookEdge(prop) || (Number.isFinite(expectedValue) && expectedValue > 0.02) || Number(prop.edge || prop.modelSignal?.edge || 0) >= 1;
  if (edgeFilter === "safeFloor") return isSafeFloorProp(prop);
  if (edgeFilter === "boomUpside") return isBoomUpsideProp(prop);
  if (edgeFilter === "earlyLines") return hoursUntilStart >= 2;
  if (edgeFilter === "streakSafe") return confidence >= 65 && !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) && (!Number.isFinite(multiplier) || multiplier <= 1);
  return true;
}

function isBestValueCandidate(prop) {
  if (!isVerifiedSportsbookProp(prop)) return false;
  if (!isGameNotExpired(prop) || prop.status === "live" || prop.status === "locked" || prop.status === "expired") return false;
  const edge = Number(prop.edge || prop.modelSignal?.edge || 0);
  if (!Number.isFinite(edge) || edge <= 0) return false;
  if (!Boolean(prop.bestPick || prop.modelSignal?.modelSide)) return false;
  const dq = Number(prop.dataQualityScore || prop.modelSignal?.dataQualityScore || 0);
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  return dq >= 40 && confidence >= 50;
}

function isSafeFloorProp(prop) {
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const dq = Number(prop.dataQualityScore || prop.modelSignal?.dataQualityScore || 0);
  const volatility = Number(prop.volatility || prop.modelSignal?.volatility);
  const hitRate = Number(prop.last10HitRate || prop.recentHitRate || prop.modelSignal?.recentHitRate);
  const multiplier = Number(prop.multiplier);
  const risk = String(prop.riskLevel || "").toLowerCase();
  return (
    confidence >= 62 &&
    dq >= 45 &&
    !risk.includes("risk") &&
    (!Number.isFinite(volatility) || volatility <= 2.75) &&
    (!Number.isFinite(hitRate) || hitRate >= 0.58) &&
    (!Number.isFinite(multiplier) || multiplier <= 1)
  );
}

function isBoomUpsideProp(prop) {
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const edge = Number(prop.edge || prop.modelSignal?.edge || 0);
  const volatility = Number(prop.volatility || prop.modelSignal?.volatility);
  const multiplier = Number(prop.multiplier);
  const projectionEdge = Math.abs(Number(prop.projectionEdge || 0));
  const line = Math.max(1, Math.abs(Number(prop.line || 1)));
  return (
    confidence >= 55 &&
    (edge >= 1 || projectionEdge / line >= 0.15 || isDemonProp(prop) || (Number.isFinite(multiplier) && multiplier > 1)) &&
    (Number.isFinite(volatility) ? volatility >= 1.8 : true)
  );
}

function isMultiPlayerComboProp(prop) {
  return isParserMergeComboBug(prop);
}

function isAdjustedOddsProp(prop) {
  const oddsType = normalize(prop.oddsType || prop.odds_type);
  return Boolean(prop.isAdjustedOdds) || (oddsType && oddsType !== "standard");
}

function isVerifiedAdjustedOddsProp(prop) {
  return Boolean(prop.verifiedAdjustedOdds);
}



function adjustedDescriptor(prop) {
  return [
    prop.adjustedOddsType,
    prop.oddsType,
    prop.odds_type,
    prop.multiplierSource,
    prop.optionLabel,
  ]
    .map(normalize)
    .join(" ");
}

function applyRecommendationStatus(prop) {
  const ready = isReadyToBet(prop);
  if (ready) {
    return {
      ...prop,
      recommendationStatus: "ready",
      bettingLabel: "Ready to Bet",
      watchlistMessage: "",
    };
  }

  if (isRecommendedPick(prop)) {
    return {
      ...prop,
      recommendationStatus: "recommended",
      bettingLabel: "Research only",
      watchlistMessage: prop.lowConfidenceReasons?.[0] || watchlistMessageForProp(prop),
    };
  }

  const watchlistMessage = watchlistMessageForProp(prop);
  return {
    ...prop,
    bestPick: prop.bestPick || "",
    recommendationStatus: "research",
    bettingLabel: "Research only",
    watchlistMessage,
    reasoningSummary: watchlistReasonSummary(prop, watchlistMessage),
  };
}

function isRecommendedPick(prop) {
  if (isReadyToBet(prop)) return true;
  return (
    !prop.fallbackProfile &&
    !prop.isDemoData &&
    prop.projectionSource !== "missing" &&
    Number.isFinite(prop.projection) &&
    Number.isFinite(prop.edge) &&
    prop.edge >= MIN_RECOMMENDED_EDGE &&
    prop.confidenceScore >= MIN_RECOMMENDED_CONFIDENCE &&
    Boolean(prop.bestPick) &&
    isActiveUpcomingProp(prop)
  );
}

function watchlistMessageForProp(prop) {
  if (prop.projectionSource === "missing" || !Number.isFinite(prop.projection)) {
    return `${NO_EDGE_MESSAGE} ${NEEDS_STATS_MESSAGE}`;
  }

  if (!prop.bestPick || prop.edge === 0) {
    return NO_EDGE_MESSAGE;
  }

  if (prop.edge < MIN_RECOMMENDED_EDGE) {
    return `${NO_EDGE_MESSAGE} Edge is below ${formatNumber(MIN_RECOMMENDED_EDGE)}.`;
  }

  if (prop.confidenceScore < MIN_RECOMMENDED_CONFIDENCE) {
    return `${NO_EDGE_MESSAGE} Confidence is below ${MIN_RECOMMENDED_CONFIDENCE}/100.`;
  }

  return NO_EDGE_MESSAGE;
}

function watchlistReasonSummary(prop, message) {
  const details = [];
  if (prop.projectionSource === "missing" || !Number.isFinite(prop.projection)) {
    details.push(NEEDS_STATS_MESSAGE);
  } else {
    details.push(
      `Model projection is ${formatNumber(prop.projection)} against a ${formatNumber(prop.line)} line with only ${formatSignedNumber(prop.edge)} of edge.`
    );
  }
  details.push(message);
  details.push(`Confidence score is ${prop.confidenceScore}/100.`);
  return unique(details).join(" ");
}

function sortRecommendedProps(a, b) {
  return (
    computeRankScore(b) - computeRankScore(a) ||
    b.confidenceScore - a.confidenceScore ||
    Number(b.expectedValue || 0) - Number(a.expectedValue || 0) ||
    b.edge - a.edge ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function sortWatchlistProps(a, b) {
  return (
    b.confidenceScore - a.confidenceScore ||
    b.edge - a.edge ||
    b.dataQualityScore - a.dataQualityScore ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function buildStreakFinderProps(props, modelSignalMap = new Map(), lineMovementMap = new Map()) {
  const scopedProps = filterActiveSportProps(props);
  const rawCandidates = scopedProps.filter((prop) => !isMultiPlayerComboProp(prop)).flatMap((prop) => {
    const options = Array.isArray(prop.streakOptions) && prop.streakOptions.length ? prop.streakOptions : defaultStreakOptions(prop);
    const modelSignal = modelSignalMap.get(streakModelSignalKey(prop)) || null;
    const rawMovement = lineMovementMap.get(lineMovementKey(prop)) || null;
    return options
      .filter((option) => Number.isFinite(Number(option.multiplier)) && Number(option.multiplier) > 0)
      .filter((option) => !option.status || normalize(option.status) === "active" || normalize(option.status) === "upcoming")
      .map((option) => {
        const side = normalizeStreakSide(option.side);
        return {
          ...prop,
          id: `${makePropId(prop)}-${normalize(side)}-${normalize(option.optionId || option.multiplier)}`,
          side,
          multiplier: round(Number(option.multiplier)),
          rawProbability: Number(option.rawProbability),
          multiplierSource: option.multiplierSource || prop.multiplierSource || "",
          adjustedOddsType: option.adjustedOddsType || prop.adjustedOddsType || prop.oddsType || prop.odds_type || "",
          verifiedAdjustedOdds: Boolean(option.verifiedAdjustedOdds || prop.verifiedAdjustedOdds),
          optionLabel: option.label || "",
          modelSignal,
          rawLineMovement: rawMovement,
          playerImage: prop.playerImage || modelSignal?.playerImage || "",
          recommendationStatus: "streak",
        };
      });
  });

  return strongestSideOnly(rawCandidates);
}

function defaultStreakOptions(prop) {
  return ["Higher", "Lower"].map((side) => ({
    side,
    multiplier: 1,
    rawProbability: null,
    status: prop.status || "upcoming",
    optionId: side,
    label: `${side} ${formatNumber(prop.line)}`,
    multiplierSource: `${prop.platform} standard line`,
    adjustedOddsType: "standard",
    verifiedAdjustedOdds: false,
  }));
}

function buildStreakSportCategoryBoards(props, history) {
  const scopedProps = filterActiveSportProps(props).filter(isVerifiedRecommendableProp);
  const enriched = strongestSideOnly(scopedProps)
    .map((prop) => enrichStreakCandidate(prop, history))
    .sort((a, b) => streakLifeScore(b, "safest", history) - streakLifeScore(a, "safest", history));
  const { mainCandidates, ladderPlays } = splitLadderCandidates(enriched);
  const boards = Object.fromEntries(STREAK_TAB_OPTIONS.map((option) => [option.value, emptyStreakSportBoard(option.value)]));

  STREAK_TAB_OPTIONS.forEach((tabOption) => {
    const tabCandidates = streakTabCandidates(tabOption, mainCandidates, ladderPlays);
    const tabLadders =
      tabOption.type === "demon"
        ? ladderPlays.filter(isDemonProp)
        : tabOption.type === "goblin"
          ? ladderPlays.filter(isGoblinProp)
        : ladderPlays.filter(
            (prop) =>
              streakSportKey(prop) === tabOption.value &&
              (tabOption.type !== "sport" || isUnderdogProp(prop))
          );
    const sorted = [...tabCandidates].sort((a, b) => streakLifeScore(b, tabOption.value, history) - streakLifeScore(a, tabOption.value, history));
    const picks = selectTopStreakPicks(sorted, tabOption, history);

    boards[tabOption.value] = {
      sport: tabOption.value,
      label: tabOption.label,
      picks,
      categories: { top: picks },
      ladders: tabLadders,
      generatedCount: picks.length,
      candidateCount: tabCandidates.length,
      verifiedOnly: tabOption.type === "adjusted",
    };
  });

  return boards;
}

function emptyStreakSportBoard(sport) {
  const tab = STREAK_TAB_OPTIONS.find((option) => option.value === sport);
  return {
    sport,
    label: tab?.label || sport,
    picks: [],
    categories: { top: [] },
    ladders: [],
    generatedCount: 0,
    candidateCount: 0,
  };
}

function visibleStreakSportOptions(boards) {
  return STREAK_TAB_OPTIONS.filter((option) => option.always || (boards?.[option.value]?.candidateCount || 0) > 0);
}

function streakTabCandidates(tabOption, mainCandidates, ladderPlays) {
  if (tabOption.type === "goblin") {
    const strict = mainCandidates.filter(isGoblinCandidate);
    return strict.length ? strict : mainCandidates.filter(isGoblinProp).slice(0, 12);
  }
  if (tabOption.type === "demon") {
    const strict = [...mainCandidates, ...ladderPlays].filter(isDemonCandidate);
    return strict.length ? strict : [...mainCandidates, ...ladderPlays].filter(isDemonProp).slice(0, 12);
  }
  const sportMatches = mainCandidates.filter(
    (prop) => streakSportKey(prop) === tabOption.value && isUnderdogProp(prop)
  );
  const strict = sportMatches.filter(meetsStandardStreakRules);
  return strict.length >= 2 ? strict : sportMatches.slice(0, 24);
}

function meetsStandardStreakRules(prop) {
  return (
    Number(prop.confidenceScore) >= MIN_STREAK_CONFIDENCE &&
    hasPositiveStreakEdge(prop, 0) &&
    hasEnoughStreakData(prop) &&
    !isStaleOrStarted(prop) &&
    !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel)
  );
}

function isGoblinCandidate(prop) {
  return (
    isGoblinProp(prop) &&
    Number(prop.confidenceScore) >= MIN_GOBLIN_CONFIDENCE &&
    hasPositiveStreakEdge(prop, 0) &&
    hasEnoughStreakData(prop) &&
    !isStaleOrStarted(prop) &&
    !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel)
  );
}

function isDemonCandidate(prop) {
  return (
    isDemonProp(prop) &&
    Number(prop.confidenceScore) >= MIN_DEMON_CONFIDENCE &&
    Number(prop.edge || prop.modelSignal?.edge || 0) >= 1 &&
    hasPositiveStreakEdge(prop, 0.25) &&
    hasEnoughStreakData(prop) &&
    !isStaleOrStarted(prop) &&
    prop.riskLevel !== "Low Data Confidence"
  );
}

function hasEnoughStreakData(prop) {
  const signal = prop.modelSignal || {};
  if (prop.fallbackProfile || signal.fallbackProfile) return false;
  const dataQuality = Number(prop.dataQualityScore || signal.dataQualityScore);
  const sampleSize = Number(prop.sampleSize || signal.sampleSize || 0);
  const projection = Number(prop.projection ?? signal.projection);
  const probability = Number(prop.modelProbability || signal.modelProbability);
  return (
    Number.isFinite(Number(signal.confidenceScore)) &&
    Number.isFinite(projection) &&
    Number.isFinite(probability) &&
    (sampleSize >= 3 || dataQuality >= 55)
  );
}

function hasPositiveStreakEdge(prop, minEdge = 0) {
  const edge = streakStatEdge(prop);
  const probabilityEdge = Number(prop.probabilityEdge || prop.modelSignal?.probabilityEdge);
  const expectedValue = Number(prop.expectedValue || prop.modelSignal?.expectedValue);
  return (
    (Number.isFinite(edge) && edge > minEdge) ||
    (Number.isFinite(probabilityEdge) && probabilityEdge > 0.01 && Number.isFinite(expectedValue) && expectedValue > 0)
  );
}

function streakStatEdge(prop) {
  const projection = Number(prop.projection ?? prop.modelSignal?.projection);
  return statEdgeForSide(projection, prop.line, prop.side || prop.bestPick || prop.modelSignal?.modelSide);
}

function statEdgeForSide(projection, line, side) {
  const projected = Number(projection);
  const propLine = Number(line);
  if (!Number.isFinite(projected) || !Number.isFinite(propLine)) return null;
  const normalizedSide = normalizeStreakSide(side);
  return normalizedSide === "Lower" ? round(propLine - projected) : round(projected - propLine);
}

function edgePercentFromValues(edge, line) {
  const numericEdge = Number(edge);
  const numericLine = Number(line);
  if (!Number.isFinite(numericEdge) || !Number.isFinite(numericLine) || numericLine <= 0) return null;
  return Math.round(Math.max(-50, Math.min(50, (numericEdge / numericLine) * 100)));
}

function edgePercentForProp(prop) {
  if (prop.edgePercent != null && Number.isFinite(Number(prop.edgePercent))) {
    return Number(prop.edgePercent);
  }
  if (prop.edgePercentage != null && Number.isFinite(Number(prop.edgePercentage))) {
    return Number(prop.edgePercentage);
  }
  const projection = prop.projection ?? prop.projectedValue;
  const line = prop.line;
  const edge = streakStatEdge(prop) ?? prop.edge ?? (Number.isFinite(Number(projection)) && Number.isFinite(Number(line)) ? Number(projection) - Number(line) : null);
  return edgePercentFromValues(edge, line);
}

function isStaleOrStarted(prop) {
  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start) && start <= Date.now()) return true;
  const movement = prop.lineMovement || prop.modelSignal?.lineMovement;
  const lastSeen = new Date(movement?.lastSeenAt || prop.generatedAt || Date.now()).getTime();
  return Number.isFinite(lastSeen) && Date.now() - lastSeen > DFS_CACHE_TTL_MS * 2;
}

function buildQuickParlayPicks(boards, riskMode = "balanced") {
  const allowedTabs = MLB_ONLY_MODE ? new Set(["MLB"]) : new Set(["MLB", "WNBA", "NBA", "Soccer", "goblins"]);
  if (riskMode === "aggressive") allowedTabs.add("demons");

  const candidates = uniqueByGeneratedPick(
    Object.values(boards || {})
      .filter((board) => allowedTabs.has(board.sport))
      .flatMap((board) => board.picks || [])
      .filter((prop) => parlayQualified(prop, riskMode))
      .sort((a, b) => parlayScore(b) - parlayScore(a))
  );

  const selected = [];
  const playerKeys = new Set();
  const statKeys = new Set();
  const gameCounts = new Map();

  for (const candidate of candidates) {
    if (selected.length >= 4) break;
    const playerKey = playerCorrelationKey(candidate);
    const statKey = playerStatCorrelationKey(candidate);
    const gameKey = gameCorrelationKey(candidate);
    if (playerKeys.has(playerKey) || statKeys.has(statKey)) continue;
    if (gameKey && Number(gameCounts.get(gameKey) || 0) >= 1) continue;

    selected.push({
      ...candidate,
      categorySource: "parlayBuilder",
      recommendationType: "Quick 4-Man Builder",
      topTwoReason: `${candidate.playerName} is included for confidence, positive edge, low correlation, and ${candidate.riskLevel || "medium"} risk profile.`,
    });
    playerKeys.add(playerKey);
    statKeys.add(statKey);
    if (gameKey) gameCounts.set(gameKey, Number(gameCounts.get(gameKey) || 0) + 1);
  }

  return selected.length === 4 ? selected : [];
}

function parlayQualified(prop, riskMode) {
  if (!hasEnoughStreakData(prop) || !hasPositiveStreakEdge(prop, 0) || isStaleOrStarted(prop)) return false;
  if (prop.riskLevel === "Low Data Confidence") return false;
  if (isDemonProp(prop) && riskMode !== "aggressive") return false;
  if (isDemonProp(prop)) return Number(prop.confidenceScore) >= MIN_DEMON_CONFIDENCE;
  return Number(prop.confidenceScore) >= MIN_STREAK_CONFIDENCE && prop.riskLevel !== "Risky";
}

function parlayScore(prop) {
  return (
    Number(prop.confidenceScore || 0) +
    Math.max(0, Number(streakStatEdge(prop) || 0)) * 6 +
    Number(prop.dataQualityScore || 0) * 0.12 +
    Number(prop.expectedValue || 0) * 16 -
    Number(prop.volatility || prop.modelSignal?.volatility || 0) * 3 -
    (isDemonProp(prop) ? 12 : 0)
  );
}

function uniqueByGeneratedPick(props) {
  const seen = new Set();
  return props.filter((prop) => {
    const key = generatedPickIdentity(prop);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parlayIncludeReason(prop) {
  return `${prop.confidenceScore}% confidence, ${formatSignedNumber(streakStatEdge(prop))} edge, ${prop.riskLevel || "Medium"} risk`;
}

function parlayLegWarning(prop) {
  if (isDemonProp(prop)) return "Aggressive demon leg.";
  if (isGoblinProp(prop)) return "Low payout does not guarantee hit.";
  return "";
}

function parlayCorrelationRisk(picks) {
  if (!Array.isArray(picks) || picks.length < 4) return "Not enough legs";
  const games = picks.map(gameCorrelationKey).filter(Boolean);
  const repeatedGames = games.length - new Set(games).size;
  if (repeatedGames > 0) return "Medium correlation risk";
  return "Low correlation risk";
}

function selectTopStreakPicks(candidates, category, history) {
  const limit = category.type === "goblin" || category.type === "demon" ? 6 : 2;
  const primary = selectUncorrelatedPicks(candidates, limit, [], { avoidSameGame: category.type === "sport" });
  let selected = primary.length >= limit ? primary : selectUncorrelatedPicks(candidates, limit, [], { avoidSameGame: false });
  if (selected.length < limit && candidates.length) {
    const relaxed = [...candidates]
      .sort((a, b) => Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
      .slice(0, limit);
    selected = relaxed;
  }
  return selected.slice(0, limit).map((prop, index) => annotateTopTwoPick(prop, category.value, category, index, history));
}

function annotateTopTwoPick(prop, sport, category, index, history) {
  const categoryLabel = category.label;
  const reason = topTwoReason(prop, categoryLabel, index, history);
  return {
    ...prop,
    streakTab: sport,
    streakSport: category.type === "sport" ? sport : streakSportKey(prop),
    streakCategory: category.value,
    streakCategoryLabel: categoryLabel,
    recommendationType: `Streak Finder - ${categoryLabel}`,
    topTwoReason: reason,
    notes: reason,
  };
}

function topTwoReason(prop, categoryLabel, index, history) {
  const categoryKey = normalize(categoryLabel);
  const categoryPurpose = categoryKey.includes("goblin")
    ? "safe streak profile, verified lower-payout pricing, positive projection edge, and low volatility"
    : categoryKey.includes("demon")
      ? "aggressive payout profile, verified demon pricing, and a larger projection edge"
      : "probability, confidence, positive edge, and data quality";
  const pieces = [
    `Top ${index + 1} ${categoryLabel.toLowerCase()} because it grades highest on ${categoryPurpose}.`,
    isVerifiedAdjustedOddsProp(prop) ? `${prop.multiplierSource || "Adjusted payout label"} is verified from the source feed.` : "",
    `Confidence ${prop.confidenceScore}% with model probability ${formatPercent(prop.modelProbability)} and EV ${formatSignedPercent(prop.expectedValue)}.`,
    keyStatsSummary(prop),
  ];
  const flags = warningFlags(prop);
  if (flags.length) pieces.push(`Warning flags: ${flags.join(", ")}.`);
  const historySignal = historicalDimensionAdjustment(prop, history);
  if (historySignal.note) pieces.push(historySignal.note);
  return pieces.filter(Boolean).join(" ");
}

function streakLifeScore(prop, categoryId, history) {
  const probability = Number(prop.modelProbability);
  const confidence = Number(prop.confidenceScore || 0);
  const recentHitRate = Number(prop.recentHitRate || prop.modelSignal?.recentHitRate);
  const dataQuality = Number(prop.dataQualityScore || 0);
  const volatility = Number(prop.volatility || prop.modelSignal?.volatility);
  const expectedValue = Number(prop.expectedValue);
  const sportsbookEdge = Number(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy);
  const multiplier = Number(prop.multiplier);
  const projectionEdge = Number(streakStatEdge(prop));
  const matchupBonus = /favorable|soft|plus/i.test(String(prop.matchupRating || prop.modelSignal?.matchupRating || "")) ? 7 : 0;
  const stalePenalty = isStaleOrStarted(prop) ? 100 : 0;
  const historyAdjustment = historicalDimensionAdjustment(prop, history).adjustment;
  const riskPenalty = prop.riskLevel === "Elite" ? 0 : prop.riskLevel === "Medium" ? 5 : prop.riskLevel === "Risky" ? 18 : 24;
  const multiplierBoost = Number.isFinite(multiplier) && multiplier < 1 ? 8 : Number.isFinite(multiplier) && multiplier > 1 ? -8 : 0;
  const categoryBoost =
    categoryId === "goblins" && isGoblinProp(prop)
      ? 14
      : categoryId === "demons" && isDemonProp(prop)
        ? 10 + Math.max(0, streakStatEdge(prop)) * 4
        : 0;

  return (
    (Number.isFinite(probability) ? probability * 100 : 50) * 1.25 +
    confidence * 1.05 +
    (Number.isFinite(recentHitRate) ? recentHitRate * 22 : 0) +
    dataQuality * 0.28 +
    (Number.isFinite(expectedValue) ? expectedValue * 28 : 0) +
    (Number.isFinite(projectionEdge) ? Math.max(0, projectionEdge) * 7 : 0) +
    (Number.isFinite(sportsbookEdge) ? sportsbookEdge * 5 : 0) +
    matchupBonus +
    multiplierBoost +
    categoryBoost +
    historyAdjustment -
    (Number.isFinite(volatility) ? volatility * 2.2 : 4) -
    warningFlags(prop).length * 5 -
    riskPenalty -
    stalePenalty
  );
}

function streakSportKey(prop) {
  const sport = displaySport(prop);
  if (isTennisSport(prop.sport) || sport === APP_SPORTS.Tennis) return APP_SPORTS.Tennis;
  if (prop.sport === APP_SPORTS.Esports || prop.esports) return APP_SPORTS.Esports;
  return sport;
}

function hoursUntil(startTime) {
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(start)) return 0;
  return (start - Date.now()) / (60 * 60 * 1000);
}

function buildStreakRecommendationBoard(props, history) {
  const enriched = strongestSideOnly(props)
    .map((prop) => enrichStreakCandidate(prop, history))
    .sort(sortStreakRecommendations);
  const { mainCandidates, ladderPlays } = splitLadderCandidates(enriched);
  const playable = mainCandidates.filter((prop) => !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) && prop.confidenceScore >= 60);
  const starter = selectUncorrelatedPicks(playable, 2, [], { avoidSameGame: true });
  const next = selectUncorrelatedPicks(playable, 1, starter, { avoidSameGame: false });
  const usedPrimary = [...starter, ...next];
  const backups = selectUncorrelatedPicks(playable, BACKUP_STREAK_LIMIT, usedPrimary, { avoidSameGame: false });
  const selected = [...usedPrimary, ...backups];
  const correlatedAvoid = playable
    .filter((prop) => !selected.some((selectedProp) => selectedProp.id === prop.id) && isCorrelatedWithAny(prop, selected))
    .map((prop) => markAvoidReason(prop, "duplicate/correlated conflict"));
  const avoid = uniqueById([
    ...mainCandidates
    .filter((prop) => ["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) || prop.confidenceScore < 60)
      .map((prop) => markAvoidReason(prop, avoidReasonForProp(prop))),
    ...correlatedAvoid,
  ])
    .sort(sortAvoidRecommendations)
    .slice(0, AVOID_STREAK_LIMIT);
  const ladders = ladderPlays.sort(sortLadderRecommendations).slice(0, LADDER_STREAK_LIMIT);

  return { starter, next, backups, ladders, avoid };
}

function splitLadderCandidates(props) {
  const grouped = new Map();
  props.forEach((prop) => {
    const key = ladderGroupKey(prop);
    const group = grouped.get(key) || [];
    group.push(prop);
    grouped.set(key, group);
  });

  const mainCandidates = [];
  const ladderPlays = [];
  grouped.forEach((group) => {
    const sorted = [...group].sort(sortLadderSafety);
    const safest = sorted[0];
    mainCandidates.push(safest);
    sorted.slice(1).forEach((prop) => {
      ladderPlays.push(markLadderPlay(prop, safest));
    });
  });

  return { mainCandidates, ladderPlays };
}

function sortLadderSafety(a, b) {
  const side = normalizeStreakSide(a.side);
  const lineA = Number(a.line);
  const lineB = Number(b.line);
  const saferLineOrder = side === "Lower" ? lineB - lineA : lineA - lineB;
  return saferLineOrder || b.confidenceScore - a.confidenceScore || Number(a.multiplier) - Number(b.multiplier);
}

function markLadderPlay(prop, safest) {
  const saferText = `${safest.side} ${formatNumber(safest.line)}`;
  const whyNotElite = unique([...(prop.whyNotElite || []), `aggressive ladder line; safer version is ${saferText}`]);
  return {
    ...prop,
    riskLevel: prop.riskLevel === "Low Data Confidence" ? "Low Data Confidence" : "Risky",
    confidenceScore: Math.max(35, Math.round(prop.confidenceScore * 0.9)),
    whyNotElite,
    ladderBaseLine: safest.line,
    reasoningSummary: `${prop.reasoningSummary} This is a correlated ladder with a safer ${saferText} version, so it is separated from main streak picks.`,
  };
}

function selectUncorrelatedPicks(candidates, limit, used = [], options = {}) {
  const selected = [];
  const usedPlayerKeys = new Set(used.map(playerCorrelationKey));
  const usedStatKeys = new Set(used.map(playerStatCorrelationKey));
  const usedGameKeys = new Set(used.map(gameCorrelationKey).filter(Boolean));

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const playerKey = playerCorrelationKey(candidate);
    const statKey = playerStatCorrelationKey(candidate);
    const gameKey = gameCorrelationKey(candidate);
    if (usedPlayerKeys.has(playerKey) || usedStatKeys.has(statKey)) continue;
    if (options.avoidSameGame && gameKey && usedGameKeys.has(gameKey)) continue;

    selected.push(candidate);
    usedPlayerKeys.add(playerKey);
    usedStatKeys.add(statKey);
    if (gameKey) usedGameKeys.add(gameKey);
  }

  return selected;
}

function isCorrelatedWithAny(prop, selected) {
  return selected.some(
    (selectedProp) =>
      playerStatCorrelationKey(prop) === playerStatCorrelationKey(selectedProp) ||
      playerCorrelationKey(prop) === playerCorrelationKey(selectedProp)
  );
}

function markAvoidReason(prop, reason) {
  const whyNotElite = unique([...(prop.whyNotElite || []), reason]);
  return {
    ...prop,
    avoidReason: reason,
    whyNotElite,
    reasoningSummary: `${prop.reasoningSummary} Avoid reason: ${reason}.`,
  };
}

function avoidReasonForProp(prop) {
  if (prop.riskLevel === "Low Data Confidence") return "low data confidence";
  if (prop.riskLevel === "Risky" || prop.riskLevel === "High Risk") return "risk signals outweigh the edge";
  if (prop.confidenceScore < 60) return "confidence below playable threshold";
  return "model did not clear streak safety rules";
}

function uniqueById(props) {
  const seen = new Set();
  return props.filter((prop) => {
    if (seen.has(prop.id)) return false;
    seen.add(prop.id);
    return true;
  });
}

function strongestSideOnly(props) {
  const byProp = new Map();
  props.forEach((prop) => {
    const key = streakSideKey(prop);
    const current = byProp.get(key);
    if (!current || compareStreakSideStrength(prop, current) < 0) byProp.set(key, prop);
  });
  return Array.from(byProp.values());
}

function compareStreakSideStrength(a, b) {
  return (
    streakSideRank(a) - streakSideRank(b) ||
    Number(b.rawProbability || 0) - Number(a.rawProbability || 0) ||
    Number(a.multiplier) - Number(b.multiplier) ||
    sidePreference(a.side) - sidePreference(b.side)
  );
}

function streakSideRank(prop) {
  const modelSide = prop.modelSignal?.modelSide;
  if (!modelSide) return 1;
  return normalizeStreakSide(modelSide) === normalizeStreakSide(prop.side) ? 0 : 2;
}

function sidePreference(side) {
  return normalizeStreakSide(side) === "Higher" ? 0 : 1;
}

function streakSideKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.line, prop.startTime].map(normalize).join("|");
}

function ladderGroupKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType), prop.startTime, normalizeStreakSide(prop.side)]
    .map(normalize)
    .join("|");
}

function playerStatCorrelationKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType), prop.startTime].map(normalize).join("|");
}

function playerCorrelationKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.startTime].map(normalize).join("|");
}

function gameCorrelationKey(prop) {
  const teams = [prop.team, prop.opponent].map(normalize).filter(Boolean).sort();
  if (teams.length < 2) return "";
  return [prop.sport, prop.startTime, ...teams].map(normalize).join("|");
}

function streakModelSignalKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType)].map(normalize).join("|");
}

function enrichStreakCandidate(prop, history) {
  const multiplier = Number(prop.multiplier);
  const historySignal = historicalSignalForProp(prop, history);
  const signal = prop.modelSignal || {};
  const hasModelSignal = Number.isFinite(Number(signal.confidenceScore));
  const modelSide = signal.modelSide ? normalizeStreakSide(signal.modelSide) : "";
  const sideAligned = modelSide && modelSide === normalizeStreakSide(prop.side);
  const sideConflict = modelSide && modelSide !== normalizeStreakSide(prop.side);
  const recentHitRate = Number(signal.recentHitRate);
  const dataQualityScore = Number(signal.dataQualityScore);
  const sampleSize = Number(signal.sampleSize || 0);
  const volatility = Number(signal.volatility);
  const sportsbookDiscrepancy = Number(signal.sportsbookDiscrepancy);
  const hasSportsbookSupport = Number.isFinite(sportsbookDiscrepancy) && sportsbookDiscrepancy > 0;
  const streakPickSide = normalizeStreakSide(prop.side) === "Higher" ? "More" : "Less";
  const lineMovement = prop.rawLineMovement
    ? lineMovementForPick(prop.rawLineMovement, streakPickSide)
    : sideAligned
      ? signal.lineMovement
      : null;
  const projection = Number(signal.projection ?? prop.projection);
  const line = Number(prop.line);
  const streakMetrics = computeStandardPropMetrics({
    projection,
    line,
    edge: Number.isFinite(projection) && Number.isFinite(line) ? projection - line : null,
  });
  const edgePercentage = streakMetrics.edgePercent;
  const probabilityScore = streakMetrics.probabilityScore;
  const highMultiplierPenalty = multiplier > 1 ? -12 : 0;
  const multiplierScore = clamp((1 - multiplier) * 55, 0, 18);
  const streakProbContribution = Number.isFinite(Number(prop.rawProbability))
    ? clamp((Number(prop.rawProbability) - 0.5) * 35, -5, 8)
    : 0;
  const modelScore = hasModelSignal ? clamp((Number(signal.confidenceScore) - 55) * 0.55, -6, 18) : -10;
  const sideScore = sideAligned ? 7 : sideConflict ? -9 : 0;
  const hitRateScore = Number.isFinite(recentHitRate) ? clamp((recentHitRate - 0.5) * 34, -8, 10) : -2;
  const qualityScore = Number.isFinite(dataQualityScore) ? clamp((dataQualityScore - 50) * 0.18, -8, 10) : -8;
  const sampleScore = sampleSize >= 10 ? 6 : sampleSize >= 5 ? 3 : -4;
  const volatilityScore = Number.isFinite(volatility) ? -clamp(volatility * 1.4, 0, 8) : -2;
  const sportsbookScore = Number.isFinite(sportsbookDiscrepancy) ? clamp(sportsbookDiscrepancy * 2.25, -6, 8) : -4;
  const injuryScore = signal.injuryRisk === "High" ? -16 : signal.injuryRisk === "Medium" ? -7 : 0;
  const whyNotElite = whyNotEliteReasons({
    hasModelSignal,
    recentHitRate,
    dataQualityScore,
    sampleSize,
    volatility,
    sportsbookDiscrepancy,
    injuryRisk: signal.injuryRisk,
    sideConflict,
    multiplier,
  });
  const profileIsFallback = Boolean(signal.fallbackProfile || prop.fallbackProfile);
  let confidenceScore =
    hasModelSignal && Number(signal.confidenceScore) > 0
      ? Number(signal.confidenceScore)
      : computeStreakConfidence({
          multiplierScore,
          probabilityScore: streakProbContribution,
          modelScore,
          sideScore,
          hitRateScore,
          qualityScore,
          sampleScore,
          volatilityScore,
          sportsbookScore,
          injuryScore,
          highMultiplierPenalty,
          historyAdjustment: historySignal.adjustment,
          recentHitRate,
          sampleSize,
          profileIsFallback,
          profile: signal,
        });
  if (sideConflict) confidenceScore = Math.max(35, confidenceScore - 8);
  if (highMultiplierPenalty) confidenceScore = Math.max(35, confidenceScore + highMultiplierPenalty);
  const signalModelProbability = Number(signal.modelProbability);
  const impliedProbability = Number.isFinite(multiplier) ? round(1 / (1 + multiplier)) : null;
  const modelProbability = Number.isFinite(signalModelProbability)
    ? signalModelProbability
    : probabilityScore != null
      ? round(probabilityScore / 100, 3)
      : round(clamp(confidenceScore / 100, 0.45, 0.78));
  const probabilityEdge =
    Number.isFinite(modelProbability) && Number.isFinite(impliedProbability)
      ? round(modelProbability - impliedProbability)
      : null;
  const expectedValue =
    Number.isFinite(modelProbability) && Number.isFinite(multiplier)
      ? round(modelProbability * multiplier - (1 - modelProbability))
      : null;
  const sharpMoneyIndicator =
    signal.sharpMoneyIndicator ||
    sharpMoneyForProp({
      sportsbookDiscrepancy,
      sportsbookComparison: { books: hasSportsbookSupport ? 2 : 0 },
      movement: lineMovement,
    });
  const verifiedAdjustedOdds = isVerifiedAdjustedOddsProp(prop);
  const goblin = isGoblinProp({ ...prop, multiplier, verifiedAdjustedOdds });
  const demon = isDemonProp({ ...prop, multiplier, verifiedAdjustedOdds });
  const valueTags = unique([
    ...(signal.valueTags || []),
    goblin ? "Goblin" : "",
    demon ? "Demon" : "",
    confidenceScore >= 70 ? "High Confidence" : "",
    Number.isFinite(expectedValue) && expectedValue > 0 ? "Positive EV" : "",
    lineMovement?.supportsPick ? "Movement Supports Pick" : "",
    sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal" ? "Sharp Money" : "",
  ]);
  const lowData = !hasModelSignal || !Number.isFinite(dataQualityScore) || dataQualityScore < 42;
  const riskLevel = streakRiskLevel({
    confidenceScore,
    lowData,
    volatility,
    injuryRisk: signal.injuryRisk,
    sideConflict,
    dataQualityScore,
    recentHitRate,
    sampleSize,
    hasSportsbookSupport,
    multiplier,
  });
  const reasonBits = [
    `${prop.platform} is offering a ${formatMultiplier(multiplier)} ${prop.side} side on ${formatNumber(prop.line)} ${prop.statType}.`,
    verifiedAdjustedOdds
      ? `${prop.multiplierSource || prop.adjustedOddsType || "The source"} labels this as an adjusted ${goblin ? "Goblin" : demon ? "Demon" : "payout"} prop.`
      : "This is treated as a standard streak option unless the source or multiplier clearly classifies it as Goblin or Demon.",
    `Model probability is ${formatPercent(modelProbability)} vs break-even ${formatPercent(impliedProbability)} with EV ${formatSignedPercent(expectedValue)}.`,
    hasModelSignal
      ? `Model signal is ${Math.round(signal.confidenceScore)}/100 with ${sideAligned ? "side agreement" : sideConflict ? "side disagreement" : "no clear side agreement"}.`
      : "Low data confidence: no independent model/stat signal is available for this adjusted line yet.",
    Number.isFinite(recentHitRate) ? `Recent hit-rate signal is ${Math.round(recentHitRate * 100)}%.` : "",
    Number.isFinite(signal.last5HitRate) || Number.isFinite(signal.last10HitRate)
      ? `L5/L10 hit rates are ${formatPercent(signal.last5HitRate)} / ${formatPercent(signal.last10HitRate)}.`
      : "",
    Number.isFinite(sportsbookDiscrepancy) ? `Sportsbook comparison edge is ${formatSignedNumber(sportsbookDiscrepancy)}.` : "",
    sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal" ? `Sharp money: ${sharpMoneyIndicator}.` : "",
    lineMovement?.label ? `Line movement: ${lineMovement.label}.` : "",
    signal.injuryRisk && signal.injuryRisk !== "Low" ? `${signal.injuryRisk} injury/news concern lowers the streak grade.` : "",
    historySignal.note,
  ];

  return {
    ...prop,
    multiplier,
    projection: Number.isFinite(projection) ? projection : prop.projection,
    edge: streakMetrics.edge ?? signal.edge ?? prop.edge,
    edgePercentage,
    probabilityScore,
    sport: getTrustedSportFromProp(prop) || prop.sport,
    bestPick: streakPickSide,
    sampleSize,
    recentHitRate,
    last5HitRate: signal.last5HitRate,
    last10HitRate: signal.last10HitRate,
    volatility,
    sportsbookDiscrepancy,
    injuryRisk: signal.injuryRisk,
    matchupRating: signal.matchupRating,
    usageAdjustment: signal.usageAdjustment,
    confidenceScore,
    riskLevel,
    dataQualityScore: Number.isFinite(dataQualityScore) ? Math.round(dataQualityScore) : 0,
    modelProbability,
    impliedProbability,
    probabilityEdge,
    expectedValue,
    lineMovement,
    sharpMoneyIndicator,
    valueTags,
    whyNotElite: riskLevel === "Elite" ? [] : whyNotElite,
    reasoningSummary: reasonBits.filter(Boolean).join(" "),
    dataQualityBadge: dataQualityBadge({ ...prop, dataQualityScore: Number.isFinite(dataQualityScore) ? Math.round(dataQualityScore) : 0, fallbackProfile: lowData }),
    payoutLabel: propPayoutLabel({ ...prop, multiplier, verifiedAdjustedOdds }),
    dataSources: dataSourcesUsed({ ...prop, ...signal }),
  };
}

function whyNotEliteReasons({ hasModelSignal, recentHitRate, dataQualityScore, sampleSize, volatility, sportsbookDiscrepancy, injuryRisk, sideConflict, multiplier }) {
  const reasons = [];
  if (!hasModelSignal) reasons.push("no independent model/stat signal");
  if (Number.isFinite(recentHitRate) && recentHitRate < 0.62) reasons.push("recent hit rate is not strong enough");
  if (!Number.isFinite(recentHitRate)) reasons.push("missing recent hit-rate sample");
  if (sampleSize < 5) reasons.push("Projection based on a smaller recent sample size.");
  if (Number.isFinite(volatility) && volatility > 2.75) reasons.push("volatile player/stat profile");
  if (!Number.isFinite(dataQualityScore) || dataQualityScore < 65) reasons.push("data confidence below Elite threshold");
  if (!Number.isFinite(sportsbookDiscrepancy) || sportsbookDiscrepancy <= 0) reasons.push("no sportsbook edge support");
  if (injuryRisk && injuryRisk !== "Low") reasons.push(`${injuryRisk.toLowerCase()} injury/news concern`);
  if (sideConflict) reasons.push("model side disagrees with streak side");
  if (multiplier > 1) reasons.push("higher payout/demon style line");
  return unique(reasons);
}

function streakRiskLevel({ confidenceScore, lowData, volatility, injuryRisk, sideConflict, dataQualityScore, recentHitRate, sampleSize, hasSportsbookSupport, multiplier }) {
  if (lowData) return "Low Data Confidence";
  if (injuryRisk === "High" || sideConflict || confidenceScore < 58 || (Number.isFinite(volatility) && volatility > 4.5)) return "Risky";
  if (
    confidenceScore >= 78 &&
    dataQualityScore >= 65 &&
    Number.isFinite(recentHitRate) &&
    recentHitRate >= 0.62 &&
    sampleSize >= 5 &&
    (volatility == null || !Number.isFinite(volatility) || volatility <= 2.75) &&
    injuryRisk !== "Medium" &&
    hasSportsbookSupport &&
    multiplier <= 1
  ) {
    return "Elite";
  }
  return "Medium";
}

function historicalSignalForProp(prop, history) {
  const settled = history.filter(
    (pick) =>
      pickStatus(pick) !== "Pending" &&
      normalize(pick.platform) === normalize(prop.platform) &&
      normalize(pick.sport) === normalize(prop.sport) &&
      normalize(pick.statType || pick.market) === normalize(prop.statType)
  );
  const wins = settled.filter((pick) => pickStatus(pick) === "Win").length;
  const losses = settled.filter((pick) => pickStatus(pick) === "Loss").length;
  const decisions = wins + losses;
  if (decisions < 3) {
    return { adjustment: 0, note: "Not enough settled history yet to materially adjust the score." };
  }
  const winRate = wins / decisions;
  const adjustment = clamp((winRate - 0.55) * 20, -8, 8);
  const direction = adjustment >= 0 ? "raises" : "lowers";
  return {
    adjustment,
    note: `Saved result history for this platform/sport/prop is ${Math.round(winRate * 100)}%, which ${direction} confidence slightly.`,
  };
}

function historicalHitRateForProp(prop, history = []) {
  const propRange = confidenceRange(Number(prop.confidenceScore ?? prop.modelSignal?.confidenceScore ?? 0));
  const settled = history.filter((pick) => {
    const status = pickStatus(pick);
    if (!["Win", "Loss"].includes(status)) return false;
    const sameSport = normalize(pick.sport || pick.category) === normalize(prop.sport);
    const sameProp = normalize(pick.statType || pick.propType || pick.market) === normalize(prop.statType);
    const sameRange =
      propRange === "Unknown" ||
      confidenceRange(Number(pick.confidenceScore ?? pick.confidence ?? 0)) === propRange;
    return sameSport && sameProp && sameRange;
  });
  const wins = settled.filter((pick) => pickStatus(pick) === "Win").length;
  const losses = settled.filter((pick) => pickStatus(pick) === "Loss").length;
  const sampleSize = wins + losses;
  if (sampleSize < 4) {
    return {
      hitRate: null,
      sampleSize,
      adjustment: 0,
      note: sampleSize ? "Historical hit-rate sample is still too small." : "",
    };
  }
  const hitRate = wins / sampleSize;
  return {
    hitRate,
    sampleSize,
    adjustment: clamp((hitRate - 0.55) * 18, -6, 7),
    note: `Historical hit rate for similar sport/prop/confidence picks is ${Math.round(hitRate * 100)}% over ${sampleSize} decisions.`,
  };
}

function sortStreakProps(a, b) {
  return (
    Number(b.modelSignal?.confidenceScore || 0) - Number(a.modelSignal?.confidenceScore || 0) ||
    Number(b.modelSignal?.modelProbability || 0) - Number(a.modelSignal?.modelProbability || 0) ||
    Number(b.modelSignal?.expectedValue || 0) - Number(a.modelSignal?.expectedValue || 0) ||
    Number(a.multiplier) - Number(b.multiplier) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime() ||
    String(a.playerName).localeCompare(String(b.playerName))
  );
}

function sortStreakRecommendations(a, b) {
  return (
    b.confidenceScore - a.confidenceScore ||
    Number(b.expectedValue || 0) - Number(a.expectedValue || 0) ||
    Number(b.dataQualityScore || 0) - Number(a.dataQualityScore || 0) ||
    Number(a.multiplier) - Number(b.multiplier) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime() ||
    String(a.playerName).localeCompare(String(b.playerName))
  );
}

function sortLadderRecommendations(a, b) {
  return (
    b.confidenceScore - a.confidenceScore ||
    Number(a.multiplier) - Number(b.multiplier) ||
    Math.abs(Number(a.line) - Number(a.ladderBaseLine || a.line)) - Math.abs(Number(b.line) - Number(b.ladderBaseLine || b.line)) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function sortAvoidRecommendations(a, b) {
  return (
    a.confidenceScore - b.confidenceScore ||
    Number(b.multiplier) - Number(a.multiplier) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function normalizeStreakSide(side) {
  const key = normalize(side);
  if (key === "more" || key === "over" || key === "higher") return "Higher";
  if (key === "less" || key === "under" || key === "lower") return "Lower";
  return String(side || "Higher");
}

function riskFromSignals({ confidenceScore, volatility, injury, projection, lineComparison, sportsbookComparison }) {
  if (injury?.risk === "High") return "Risky";
  if (!Number.isFinite(projection) && !lineComparison && !sportsbookComparison) return "Low Data Confidence";
  if (confidenceScore >= 75 && (volatility == null || volatility <= 2.25)) return "Elite";
  if (confidenceScore >= 60) return "Medium";
  return "Risky";
}

function getScoringRejectReason(prop) {
  const validation = validateProp(prop);
  if (!validation.valid) return validation.reason;
  const player = String(prop.playerName || "").trim();
  if (!player || player === "Unknown Player") return "missing player name";
  if (!prop.statType && !prop.market) return "missing prop type";
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "missing or invalid line";
  return "";
}

function getFatalPropReason(prop, options = {}) {
  if (!prop.playerName || prop.playerName === "Unknown Player") return options.relaxed ? "" : "missing player name";
  if (!prop.statType) return "missing prop type";
  if (!options.relaxed && !isActiveUpcomingProp(prop, { includeUncertain: readIncludeUncertainPreference() })) {
    return "stale or already-started game time";
  }
  if (!Number.isFinite(Number(prop.line))) return "missing or invalid line";
  if (!options.relaxed && !Number.isFinite(prop.edge)) return "missing edge calculation";
  if (options.relaxed) return "";

  const range = projectionRangeForProp(prop);
  if (!range) return "";
  if (Number(prop.line) < range.min || Number(prop.line) > range.max) {
    return `${range.label} line ${formatNumber(prop.line)} outside realistic range ${range.min}-${range.max}`;
  }

  if (prop.projection == null) return "";
  if (!Number.isFinite(prop.projection)) return "projection is NaN";
  if (prop.projection === 0 && range.min > 0) return `${range.label} cannot use a zero projection`;
  if (prop.projection < range.min || prop.projection > range.max) {
    return `${range.label} projection ${formatNumber(prop.projection)} outside realistic range ${range.min}-${range.max}`;
  }

  return "";
}

function logFilteredProp(prop, reason) {
  if (!shouldLogVerbose()) return;
  if (
    reason === "game is live" ||
    reason === "game already started" ||
    reason === "game is final" ||
    reason === "game is postponed" ||
    reason === "outside pregame window" ||
    reason === "adjusted odds prop handled by Streak Finder" ||
    String(reason || "").startsWith("unsupported market:") ||
    String(reason || "").startsWith("unapproved market:")
  ) {
    return;
  }
  console.warn("Filtered verified DFS prop", {
    market: prop.statType,
    sport: prop.sport,
    reason,
  });
}

function projectionRangeForProp(prop) {
  const key = normalize(prop.statType);
  return (
    REALISTIC_PROJECTION_RANGES.find(
      (range) =>
        (range.sport === prop.sport || (range.sport === "Tennis" && isTennisSport(prop.sport))) &&
        range.match(key)
    ) || null
  );
}

function isTennisSport(sport) {
  return sport === APP_SPORTS.ATP || sport === APP_SPORTS.WTA || sport === APP_SPORTS.Tennis;
}

function isBasketballSport(sport) {
  return sport === "NBA" || sport === "WNBA";
}

function canonicalizeSportProp(prop) {
  const trusted = getTrustedSportFromProp(prop);
  if (trusted) {
    return { ...prop, sport: trusted, classifiedSport: trusted };
  }
  const fromLeague = normalizeScoringSportLabel(resolveIngestionSport(buildContextFromProp(prop)));
  if (fromLeague && ALLOWED_SCORING_SPORTS.has(fromLeague)) {
    return { ...prop, sport: fromLeague, classifiedSport: fromLeague, sportDetectionSource: "league-metadata" };
  }
  return prop;
}

function canonicalSportFromProp(prop) {
  return detectPropSport(prop).sport || prop?.classifiedSport || APP_SPORTS.Unsupported;
}

function ensurePropStartTime(prop) {
  const normalized = normalizeGameStartTime(prop.startTime, { allowFallback: Boolean(prop.partialTimeLabel) });
  if (!normalized) return prop;
  return { ...prop, startTime: normalized };
}

function readIncludeUncertainPreference() {
  try {
    return window.localStorage.getItem(INCLUDE_UNCERTAIN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeIncludeUncertainPreference(value) {
  try {
    window.localStorage.setItem(INCLUDE_UNCERTAIN_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

function formatTopFilterReasons(audit = {}) {
  const entries = Object.entries(audit.filterReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return "none";
  return entries.map(([reason, count]) => `${reason} (${count})`).join(" · ");
}

function keyStatsSummary(prop) {
  const parts = [];
  const probability = prop.modelProbability || prop.modelSignal?.modelProbability;
  const l5 = prop.last5HitRate || prop.modelSignal?.last5HitRate;
  const l10 = prop.last10HitRate || prop.modelSignal?.last10HitRate || prop.recentHitRate || prop.modelSignal?.recentHitRate;
  if (Number.isFinite(Number(probability))) parts.push(`model probability ${formatPercent(probability)}`);
  if (Number.isFinite(Number(l5)) || Number.isFinite(Number(l10))) parts.push(`L5/L10 ${formatPercent(l5)} / ${formatPercent(l10)}`);
  if (Number.isFinite(Number(prop.expectedValue))) parts.push(`EV ${formatSignedPercent(prop.expectedValue)}`);
  if (Number.isFinite(Number(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy))) {
    parts.push(`book edge ${formatSignedNumber(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy)}`);
  }
  if (Number.isFinite(Number(prop.multiplier))) parts.push(`multiplier ${formatMultiplier(prop.multiplier)}`);
  return parts.length ? parts.join("; ") : "limited stat sample";
}

function usageContextForProp(prop) {
  const usage = prop.usageAdjustment || prop.modelSignal?.usageAdjustment;
  const pitchCount = prop.pitchCountTrend || prop.modelSignal?.pitchCountTrend;
  const minutes = prop.projectedMinutes || prop.modelSignal?.projectedMinutes;
  const parts = [];
  if (usage) parts.push(String(usage));
  if (pitchCount) parts.push(`Pitch count: ${pitchCount}`);
  if (minutes) parts.push(`Minutes: ${minutes}`);
  return parts.length ? parts.join(" | ") : "No minutes/usage/pitch-count flag";
}

function lineMovementStatusText(prop) {
  const movement = prop.lineMovement || prop.modelSignal?.lineMovement;
  if (!movement) return "No movement yet";
  const lastSeen = new Date(movement.lastSeenAt || "").getTime();
  const stale = Number.isFinite(lastSeen) && Date.now() - lastSeen > DFS_CACHE_TTL_MS;
  const direction = movement.supportsPick
    ? "Moving toward value"
    : movement.againstPick
      ? "Moving against value"
      : "Stable";
  return `${direction}${stale ? " - stale line warning" : ""}`;
}

function warningFlags(prop) {
  const flags = [];
  if (prop.riskLevel === "Risky" || prop.riskLevel === "High Risk") flags.push("high risk");
  if (prop.riskLevel === "Low Data Confidence") flags.push("low data confidence");
  if (prop.injuryRisk === "High" || prop.modelSignal?.injuryRisk === "High") flags.push("injury/news concern");
  if (Number(prop.volatility || prop.modelSignal?.volatility) > 4) flags.push("high volatility");
  if (Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) < 5) flags.push("small sample");
  if (Number(prop.multiplier) > 1) flags.push("demon/aggressive line");
  if (prop.categoryFallback) flags.push("category fallback");
  if (prop.lineMovement?.againstPick || prop.modelSignal?.lineMovement?.againstPick) flags.push("market moved against pick");
  if (!Number.isFinite(Number(prop.modelProbability))) flags.push("missing probability");
  return unique(flags);
}

function riskExplanation(prop) {
  const flags = warningFlags(prop);
  if (flags.length) return flags.join(", ");
  if (prop.riskLevel === "Elite") return "Low-volatility profile with strong confidence and model support.";
  if (prop.riskLevel === "Medium") return "Playable edge, but keep normal streak caution.";
  return prop.riskLevel || "No major risk flags";
}

function historicalDimensionAdjustment(prop, history) {
  const settled = history.filter((pick) => pickStatus(pick) !== "Pending");
  if (settled.length < 4) return { adjustment: 0, note: "" };
  const dimensions = [
    ["source", (pick) => normalize(pick.platform) === normalize(prop.platform)],
    ["sport", (pick) => normalize(displaySport(pick)) === normalize(displaySport(prop))],
    ["prop type", (pick) => normalize(pick.statType || pick.market) === normalize(prop.statType)],
    ["category", (pick) => normalize(pick.category || pick.recommendationType) === normalize(prop.streakCategoryLabel || prop.recommendationType)],
  ];
  let adjustment = 0;
  const notes = [];

  dimensions.forEach(([label, matcher]) => {
    const matches = settled.filter(matcher);
    const wins = matches.filter((pick) => pickStatus(pick) === "Win").length;
    const losses = matches.filter((pick) => pickStatus(pick) === "Loss").length;
    const decisions = wins + losses;
    if (decisions < 3) return;
    const rate = wins / decisions;
    const delta = clamp((rate - 0.55) * 9, -4, 4);
    adjustment += delta;
    notes.push(`${label} history ${Math.round(rate * 100)}%`);
  });

  return {
    adjustment: clamp(adjustment, -8, 8),
    note: notes.length ? `Learning adjustment: ${notes.join(", ")}.` : "",
  };
}

// dataQualityFromSignals imported from ./services/dataQuality.js

function sportsbookValueBoost(prop, bestPick, comparison) {
  const discrepancy = sportsbookDiscrepancyForPick(prop, bestPick, comparison);
  if (!Number.isFinite(discrepancy)) return 0;
  return clamp(discrepancy * 4, -6, 10);
}

function sportsbookDiscrepancyForPick(prop, bestPick, comparison) {
  if (!comparison || !Number.isFinite(Number(comparison.marketAverageLine))) return null;
  if (bestPick !== "More" && bestPick !== "Less") return null;
  const dfsLine = Number(prop.line);
  const marketAverageLine = Number(comparison.marketAverageLine);
  if (!Number.isFinite(dfsLine) || !Number.isFinite(marketAverageLine)) return null;
  return round(bestPick === "More" ? marketAverageLine - dfsLine : dfsLine - marketAverageLine);
}

function sportsbookImpliedForPick(bestPick, comparison) {
  if (!comparison || (bestPick !== "More" && bestPick !== "Less")) return null;
  const side = bestPick === "More" ? comparison.over : comparison.under;
  return Number.isFinite(Number(side?.averageImpliedProbability)) ? Number(side.averageImpliedProbability) : null;
}

function sportsbookPriceForPick(bestPick, comparison) {
  if (!comparison || (bestPick !== "More" && bestPick !== "Less")) return null;
  const side = bestPick === "More" ? comparison.over : comparison.under;
  return Number.isFinite(Number(side?.averagePrice)) ? Number(side.averagePrice) : null;
}

// estimateModelProbability imported from ./services/projectionEngine.js

function expectedValueFromProbability(probability, americanPrice) {
  if (!Number.isFinite(probability)) return null;
  const profit = americanProfit(americanPrice);
  return round(probability * profit - (1 - probability));
}

function americanProfit(americanPrice) {
  const price = Number(americanPrice);
  if (!Number.isFinite(price) || price === 0) return 1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function updateLineMovementMap(props, sportsbookComparisonMap) {
  const previous = readLineMovement();
  const now = new Date().toISOString();
  const next = MLB_ONLY_MODE ? { ...previous } : { ...previous };

  props.forEach((prop) => {
    if (!guardMlbOnlyProp(prop)) return;
    const key = lineMovementKey(prop);
    const sportsbookComparison = sportsbookComparisonMap.get(sportsbookComparisonKey(prop));
    const currentLine = Number(prop.line);
    const marketLine = Number(sportsbookComparison?.marketAverageLine);
    if (!Number.isFinite(currentLine)) return;

    const existing = next[key] || {
      openingLine: currentLine,
      firstSeenAt: now,
      openingMarketLine: Number.isFinite(marketLine) ? marketLine : null,
    };

    const enriched = enrichLineMovementRecord(existing, currentLine, now);
    next[key] = {
      ...enriched,
      currentMarketLine: Number.isFinite(marketLine) ? marketLine : enriched.currentMarketLine ?? existing.currentMarketLine ?? null,
    };
  });

  writeLineMovement(next);
  return new Map(Object.entries(next));
}

function lineMovementForPick(movement, bestPick) {
  if (!movement || (bestPick !== "More" && bestPick !== "Less")) return null;
  const openingLine = Number(movement.openingLine);
  const currentLine = Number(movement.currentLine);
  if (!Number.isFinite(openingLine) || !Number.isFinite(currentLine)) return null;
  const move = round(currentLine - openingLine);
  const supportsPick = bestPick === "More" ? move < 0 : move > 0;
  const againstPick = bestPick === "More" ? move > 0 : move < 0;
  const direction = move === 0 ? "flat" : move > 0 ? "up" : "down";
  const lineQuality = supportsPick ? "better" : againstPick ? "worse" : "neutral";
  const enriched = enrichLineMovementWithTags(
    {
      openingLine,
      currentLine,
      previousLine: Number.isFinite(Number(movement.previousLine)) ? Number(movement.previousLine) : openingLine,
      supportsPick,
      againstPick,
      firstSeenAt: movement.firstSeenAt || "",
      lastSeenAt: movement.lastSeenAt || "",
    },
    bestPick
  );
  return {
    ...enriched,
    move,
    amount: Math.abs(move),
    direction,
    lineQuality,
    label:
      move === 0
        ? "No movement yet"
        : `${formatSignedNumber(move)} (${direction}) — line ${lineQuality} for ${bestPick}`,
  };
}

function sharpMoneyForProp({ sportsbookDiscrepancy, sportsbookComparison, movement }) {
  const books = Number(sportsbookComparison?.books || 0);
  const discrepancy = Number(sportsbookDiscrepancy);
  if (Number.isFinite(discrepancy) && discrepancy >= 0.5 && books >= 2 && movement?.supportsPick) return "Strong alignment";
  if (Number.isFinite(discrepancy) && discrepancy >= 0.5 && books >= 2) return "Sportsbook market supports value";
  if (movement?.supportsPick) return "Line moved toward model";
  if (movement?.againstPick) return "Market moved against model";
  return "No sharp signal";
}

function matchupRatingFromSignals({ profile, injury, sportsbookDiscrepancy, lineComparison }) {
  if (injury?.risk === "High") return "Tough";
  const hitRate = Number(profile?.recentHitRate);
  const discrepancy = Number(sportsbookDiscrepancy);
  if (Number.isFinite(hitRate) && hitRate >= 0.65 && Number.isFinite(discrepancy) && discrepancy > 0) return "Favorable";
  if (Number.isFinite(hitRate) && hitRate < 0.45) return "Tough";
  if (lineComparison?.difference >= 0.5 || (Number.isFinite(discrepancy) && discrepancy > 0)) return "Playable";
  return "Neutral";
}

function usageAdjustmentFromSignals({ prop, profile }) {
  const sampleSize = Number(profile?.sampleSize || 0);
  const statKey = canonicalStatType(prop.statType);
  if (prop.sport === "MLB" && ["strikeouts", "pitchesThrown"].includes(statKey)) {
    return sampleSize >= 5 ? "Pitch workload sample available" : "Pitch workload sample limited";
  }
  if (isBasketballSport(prop.sport)) return sampleSize >= 5 ? "Minutes/usage proxy stable" : "Minutes/usage data limited";
  return sampleSize >= 5 ? "Recent role sample available" : "Usage data limited";
}

function valueTagsForProp({ prop, confidenceScore, sportsbookDiscrepancy, lineComparison, movement, sharpMoneyIndicator, expectedValue, recentHitRate }) {
  const tags = [];
  if (confidenceScore >= 70) tags.push("High Confidence");
  if (Number.isFinite(sportsbookDiscrepancy) && sportsbookDiscrepancy > 0) tags.push("DFS Softer Than Books");
  if (Number.isFinite(expectedValue) && expectedValue > 0) tags.push("Positive EV");
  if (lineComparison?.difference >= 0.5) tags.push("Platform Line Gap");
  if (movement?.supportsPick) tags.push("Movement Supports Pick");
  if (sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal") tags.push("Sharp Money");
  if (Number.isFinite(recentHitRate) && recentHitRate >= 0.65) tags.push("L10 Hit Rate");
  if (isGoblinProp(prop)) tags.push("Goblin");
  if (isDemonProp(prop)) tags.push("Demon");
  return tags;
}

function savePropsOfDay(props) {
  return saveLearningPicks(props.slice(0, PROPS_OF_DAY_LIMIT).filter(isAutoSavablePick), "Props of the Day");
}

function generatedStreakPicks(boards) {
  return Object.values(boards || {}).flatMap((board) => {
    const picks = board.picks || [];
    return picks.map((pick) => ({
      ...pick,
      categorySource: board.sport === "goblins" ? "goblin" : board.sport === "demons" ? "demon" : "streakStarter",
    }));
  });
}

function saveGeneratedCategoryPicks(props, existing = readHistory()) {
  const today = dateKey(new Date());
  const additions = props.filter(isAutoSavablePick).map((prop) =>
    toHistoryPick(prop, today, prop.recommendationType || `Streak Finder - ${prop.streakSport || displaySport(prop)} - ${prop.streakCategoryLabel || "Top 2"}`)
  );
  if (!additions.length) {
    const trimmed = trimHistoryToLimit(existing);
    if (trimmed.length !== existing.length) writeHistory(trimmed);
    return trimmed;
  }
  const updated = mergeHistoryPicks(existing, additions);
  writeHistory(updated);
  return updated;
}

function saveLearningPicks(props, recommendationType = "Model Recommendation", options = {}) {
  const existing = readHistory();
  const today = dateKey(new Date());
  const additions = props
    .filter((prop) => options.allowResearch || options.allowManualAnalyzer || isAutoSavablePick(prop))
    .map((prop) =>
      toHistoryPick(
        {
          ...prop,
          categorySource: categorySourceFromRecommendation(recommendationType),
          manualAnalyzer: isManualAnalyzerProp(prop) || prop.manualAnalyzer,
        },
        today,
        recommendationType
      )
    );
  if (!additions.length) {
    const trimmed = trimHistoryToLimit(existing);
    if (trimmed.length !== existing.length) writeHistory(trimmed);
    return trimmed;
  }
  const updated = mergeHistoryPicks(existing, additions);
  writeHistory(updated);
  return updated;
}

function isAutoSavablePick(prop) {
  return Boolean(prop) && isReadyToBet(prop) && !prop.isDemoData && !prop.fallbackProfile && !prop.manualEntry;
}

function toHistoryPick(prop, today, recommendationType = "Model Recommendation") {
  const pickDirection = prop.bestPick || prop.side || "";
  const generatedAt = prop.generatedAt || new Date().toISOString();
  const categorySource = prop.categorySource || categorySourceFromRecommendation(recommendationType);
  const uniqueKey = generatedPickIdentity({
    ...prop,
    slateDate: today,
    side: pickDirection,
  });
  const settled = settlePickFromActual(prop, pickDirection);

  return {
    id: uniqueKey,
    uniqueKey,
    date: today,
    slateDate: today,
    recommendationType,
    categorySource,
    platform: prop.platform,
    sport: prop.streakSport || displaySport(prop),
    league: prop.league,
    playerName: prop.playerName,
    player: prop.playerName,
    team: prop.team,
    opponent: prop.opponent,
    playerImage: prop.playerImage,
    headshot: prop.headshot,
    imageUrl: prop.imageUrl,
    startTime: prop.startTime,
    statType: prop.statType,
    propType: prop.statType,
    market: prop.statType,
    line: prop.line,
    multiplier: prop.multiplier ?? "",
    pickDirection,
    pick: pickDirection,
    side: pickDirection,
    projection: prop.projection,
    modelProbability: prop.modelProbability,
    impliedProbability: prop.impliedProbability,
    expectedValue: prop.expectedValue,
    probabilityEdge: prop.probabilityEdge,
    confidenceScore: prop.confidenceScore,
    confidence: prop.confidenceScore,
    dataQualityLabel: prop.dataQualityBadge?.label || dataQualityBadge(prop).label,
    payoutLabel: prop.payoutLabel || propPayoutLabel(prop),
    edgeRating: prop.edgeRating,
    edge: prop.edge,
    edgePercentage: prop.edgePercentage ?? edgePercentForProp(prop),
    dataQualityScore: prop.dataQualityScore,
    sharpMoneyIndicator: prop.sharpMoneyIndicator,
    lineMovement: prop.lineMovement?.label || "",
    lineMovementData: prop.lineMovement || prop.modelSignal?.lineMovement || null,
    sportsbookComparison: prop.sportsbookComparison || prop.modelSignal?.sportsbookComparison || null,
    clv: prop.clv ?? null,
    clvWon: prop.clvWon ?? null,
    sportsbookDiscrepancy: prop.sportsbookDiscrepancy,
    riskLevel: prop.riskLevel,
    risk: prop.riskLevel,
    category: prop.streakCategoryLabel || recommendationType,
    streakCategory: prop.streakCategory || "",
    streakSport: prop.streakSport || displaySport(prop),
    streakTab: prop.streakTab || "",
    reasoningSummary: prop.reasoningSummary,
    reason: prop.reasoningSummary,
    notes: prop.notes || prop.topTwoReason || prop.reasoningSummary,
    generatedAt,
    createdAt: generatedAt,
    lineAtGeneration: prop.line,
    resultStatus: settled.resultStatus,
    finalResult: settled.resultStatus,
    actualStatResult: settled.actualStatResult,
    settledAt: settled.settledAt,
  };
}

function generatedPickIdentity(prop) {
  return [
    prop.slateDate || dateKey(new Date(prop.startTime || Date.now())),
    prop.platform,
    prop.playerName,
    prop.streakSport || displaySport(prop),
    prop.propType || prop.statType,
    prop.line,
    prop.side || prop.pickDirection || prop.bestPick,
  ]
    .map(normalize)
    .join("|");
}

function categorySourceFromRecommendation(recommendationType = "") {
  const text = normalize(recommendationType);
  if (text.includes("parlay") || text.includes("4man")) return "parlayBuilder";
  if (text.includes("propsofday")) return "propsOfDay";
  if (text.includes("goblin")) return "goblin";
  if (text.includes("demon")) return "demon";
  if (text.includes("streak")) return "streakStarter";
  return "model";
}

function mergeHistoryPicks(existing, additions) {
  const byKey = new Map();
  existing.forEach((pick) => byKey.set(pick.uniqueKey || generatedPickIdentity(pick), pick));
  additions.forEach((pick) => {
    const key = pick.uniqueKey || generatedPickIdentity(pick);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, pick);
      return;
    }
    const currentConfidence = Number(current.confidenceScore ?? current.confidence ?? 0);
    const nextConfidence = Number(pick.confidenceScore ?? pick.confidence ?? 0);
    const categorySource = mergeCategorySources(current.categorySource, pick.categorySource);
    byKey.set(key, {
      ...current,
      ...(nextConfidence >= currentConfidence ? pick : {}),
      categorySource,
      generatedAt: pick.generatedAt || current.generatedAt,
      updatedAt: new Date().toISOString(),
      lineMovementData: pick.lineMovementData || current.lineMovementData || null,
      sportsbookComparison: pick.sportsbookComparison || current.sportsbookComparison || null,
    });
  });
  return trimHistoryToLimit(Array.from(byKey.values()));
}

function trimHistoryToLimit(rows = []) {
  return [...rows]
    .sort((a, b) => new Date(b.generatedAt || b.createdAt || 0) - new Date(a.generatedAt || a.createdAt || 0))
    .slice(0, HISTORY_LIMIT);
}

function mergeCategorySources(a = "", b = "") {
  return unique([...String(a).split(","), ...String(b).split(",")].map((value) => value.trim()).filter(Boolean)).join(",");
}

function settlePickFromActual(prop, pickDirection) {
  const actual = prop.actualStatResult ?? prop.actualResult ?? null;
  const actualNumber = Number(actual);
  const line = Number(prop.line);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(line)) {
    return { resultStatus: "Pending", actualStatResult: null, settledAt: null };
  }
  const side = formatLeanSide(pickDirection);
  const resultStatus = actualNumber === line ? "Push" : side === "Under" ? (actualNumber < line ? "Win" : "Loss") : actualNumber > line ? "Win" : "Loss";
  return { resultStatus, actualStatResult: actualNumber, settledAt: new Date().toISOString() };
}

function saveGeneratedParlay(picks, existing = readParlayHistory()) {
  if (!Array.isArray(picks) || picks.length !== 4) return existing;
  if (!picks.every(isAutoSavablePick)) return existing;
  const record = toParlayRecord(picks);
  const currentIndex = existing.findIndex((item) => item.id === record.id);
  const updated = currentIndex >= 0
    ? existing.map((item, index) => (index === currentIndex ? { ...item, ...record, updatedAt: new Date().toISOString() } : item))
    : [record, ...existing];
  const trimmed = updated
    .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))
    .slice(0, HISTORY_LIMIT);
  writeParlayHistory(trimmed);
  return trimmed;
}

function toParlayRecord(picks) {
  const generatedAt = new Date().toISOString();
  const slateDate = dateKey(new Date());
  const normalizedPicks = picks.map((pick) => toHistoryPick({ ...pick, categorySource: "parlayBuilder" }, slateDate, "Quick 4-Man Builder"));
  const statuses = normalizedPicks.map((pick) => pickStatus(pick));
  const legsWon = statuses.filter((status) => status === "Win").length;
  const legsLost = statuses.filter((status) => status === "Loss").length;
  const legsPushed = statuses.filter((status) => status === "Push").length;
  const allLegsSettled = statuses.every((status) => status !== "Pending");
  const parlayResult = legsLost > 0 ? "Loss" : allLegsSettled ? "Win" : "Pending";
  const id = [slateDate, ...normalizedPicks.map((pick) => pick.uniqueKey)].map(normalize).join("|");
  return {
    id,
    generatedAt,
    picks: normalizedPicks,
    allLegsSettled,
    parlayResult,
    legsWon,
    legsLost,
    legsPushed,
    averageConfidence: Math.round(average(normalizedPicks.map((pick) => Number(pick.confidenceScore || 0)))),
    correlationRisk: parlayCorrelationRisk(picks),
  };
}

function buildParlayDashboard(history) {
  const total = history.length;
  const pending = history.filter((record) => record.parlayResult === "Pending").length;
  const wins = history.filter((record) => record.parlayResult === "Win").length;
  const losses = history.filter((record) => record.parlayResult === "Loss").length;
  return {
    total,
    pending,
    wins,
    losses,
    averageConfidence: total ? Math.round(average(history.map((record) => Number(record.averageConfidence || 0)))) : 0,
  };
}

function refreshParlayResults(parlays, pickHistory) {
  const pickMap = new Map(pickHistory.map((pick) => [pick.uniqueKey || pick.id, pick]));
  return parlays.map((record) => {
    const picks = (record.picks || []).map((pick) => pickMap.get(pick.uniqueKey || pick.id) || pick);
    const statuses = picks.map((pick) => pickStatus(pick));
    const legsWon = statuses.filter((status) => status === "Win").length;
    const legsLost = statuses.filter((status) => status === "Loss").length;
    const legsPushed = statuses.filter((status) => status === "Push").length;
    const allLegsSettled = statuses.every((status) => status !== "Pending");
    return {
      ...record,
      picks,
      allLegsSettled,
      parlayResult: legsLost > 0 ? "Loss" : allLegsSettled ? "Win" : "Pending",
      legsWon,
      legsLost,
      legsPushed,
    };
  });
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function confidenceRange(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence <= 0) return "Unknown";
  if (confidence >= 80) return "80+";
  if (confidence >= 70) return "70-79";
  if (confidence >= 60) return "60-69";
  if (confidence >= 50) return "50-59";
  return "Under 50";
}

function buildAccuracyDashboard(history) {
  const total = history.length;
  const pending = history.filter((pick) => pickStatus(pick) === "Pending").length;
  const wins = history.filter((pick) => pickStatus(pick) === "Win").length;
  const losses = history.filter((pick) => pickStatus(pick) === "Loss").length;
  const pushes = history.filter((pick) => pickStatus(pick) === "Push").length;
  const voids = history.filter((pick) => pickStatus(pick) === "Void").length;
  const settledDecisionCount = wins + losses;
  const winPercentage = settledDecisionCount ? Math.round((wins / settledDecisionCount) * 100) : 0;

  return {
    total,
    pending,
    wins,
    losses,
    pushes,
    voids,
    winPercentage,
    generatedToday: history.filter((pick) => pick.slateDate === dateKey(new Date()) || pick.date === dateKey(new Date())).length,
    goblinHitRate: hitRateFor(history, (pick) => String(pick.categorySource || pick.category || "").includes("goblin")),
    demonHitRate: hitRateFor(history, (pick) => String(pick.categorySource || pick.category || "").includes("demon")),
    streakStarterHitRate: hitRateFor(history, (pick) => String(pick.categorySource || "").includes("streakStarter")),
    parlayBuilderHitRate: hitRateFor(history, (pick) => String(pick.categorySource || "").includes("parlayBuilder")),
    clvWinRate: hitRateFor(history, (pick) => pick.clvWon === true || pick.clvWon === false, (pick) => pick.clvWon === true),
    bySport: breakdown(history, (pick) => pick.sport || "Unknown"),
    byStatType: breakdown(history, (pick) => pick.statType || pick.market || "Unknown"),
    byPlatform: breakdown(history, (pick) => pick.platform || "Unknown"),
    byCategory: breakdown(history, (pick) => pick.categorySource || pick.category || pick.recommendationType || "Unknown"),
    byCategorySource: breakdown(history, (pick) => pick.categorySource || "Unknown"),
    byConfidenceRange: breakdown(history, (pick) => confidenceRange(Number(pick.confidenceScore ?? pick.confidence ?? 0))),
    byRiskLevel: breakdown(history, (pick) => pick.riskLevel || pick.risk || "Unknown"),
  };
}

function hitRateFor(history, filterFn, winFn = (pick) => pickStatus(pick) === "Win") {
  const matches = history.filter(filterFn).filter((pick) => pickStatus(pick) !== "Pending" && pickStatus(pick) !== "Push");
  if (matches.length < 3) return "—";
  return Math.round((matches.filter(winFn).length / matches.length) * 100);
}

function historyFilterOptions(history) {
  return {
    sports: ["all", ...unique(history.map((pick) => pick.sport || "Unknown").filter(Boolean))],
    categories: ["all", ...unique(history.flatMap((pick) => String(pick.categorySource || "Unknown").split(",")).map((item) => item.trim()).filter(Boolean))],
    platforms: ["all", ...unique(history.map((pick) => pick.platform || "Unknown").filter(Boolean))],
  };
}

function matchesHistoryFilter(pick, filter) {
  if (filter.date === "today" && (pick.slateDate || pick.date) !== dateKey(new Date())) return false;
  if (filter.sport !== "all" && normalize(pick.sport) !== normalize(filter.sport)) return false;
  if (filter.categorySource !== "all" && !String(pick.categorySource || "").split(",").map(normalize).includes(normalize(filter.categorySource))) return false;
  if (filter.result !== "all" && pickStatus(pick) !== filter.result) return false;
  if (filter.platform !== "all" && normalize(pick.platform) !== normalize(filter.platform)) return false;
  return true;
}

function breakdown(history, selector) {
  const groups = new Map();
  history.forEach((pick) => {
    const key = selector(pick);
    const current = groups.get(key) || { key, wins: 0, losses: 0, pushes: 0 };
    const status = pickStatus(pick);
    if (status === "Win") current.wins += 1;
    if (status === "Loss") current.losses += 1;
    if (status === "Push") current.pushes += 1;
    groups.set(key, current);
  });

  return Array.from(groups.values())
    .map((row) => {
      const decisions = row.wins + row.losses;
      return {
        ...row,
        winPercentage: decisions < 3 ? "—" : Math.round((row.wins / decisions) * 100),
      };
    })
    .sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
}

function historyToCsv(history) {
  const fields = [
    "date",
    "recommendationType",
    "platform",
    "sport",
    "league",
    "playerName",
    "team",
    "opponent",
    "startTime",
    "statType",
    "line",
    "multiplier",
    "pickDirection",
    "projection",
    "modelProbability",
    "impliedProbability",
    "expectedValue",
    "probabilityEdge",
    "confidenceScore",
    "edgeRating",
    "edge",
    "sportsbookDiscrepancy",
    "sharpMoneyIndicator",
    "lineMovement",
    "riskLevel",
    "resultStatus",
    "actualStatResult",
    "generatedAt",
    "settledAt",
    "reasoningSummary",
  ];
  const rows = history.map((pick) => fields.map((field) => csvCell(pick[field] ?? "")).join(","));
  return [fields.join(","), ...rows].join("\n");
}

function csvCell(value) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

function isSupportedHistoryPick(pick) {
  if (!SUPPORTED_SPORTS.has(pick.sport)) return false;
  if (isMultiPlayerComboProp({ playerName: pick.playerName || pick.player, statType: pick.statType || pick.market })) return false;
  if (normalize(pick.league || "").includes("live")) return false;
  return true;
}

function sharedLineKey(prop) {
  return [prop.sport, prop.playerName, prop.statType, prop.startTime].map(normalize).join("|");
}

function sportsbookComparisonKey(prop) {
  return [prop.sport, prop.playerName, canonicalStatType(prop.statType)].map(normalize).join("|");
}

function statLookupKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.startTime]
    .map(normalize)
    .join("|");
}

function makePropId(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.line, prop.startTime]
    .map(normalize)
    .join("-");
}

function lineMovementKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType), prop.startTime]
    .map(normalize)
    .join("|");
}

function getPlayerImage(playerName, sport) {
  const initials = String(playerName || "Player")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "P";
  const palette = placeholderPalette(sport);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="18" fill="${palette.bg}"/>
      <circle cx="80" cy="58" r="31" fill="${palette.face}"/>
      <path d="M28 147c8-34 28-51 52-51s44 17 52 51" fill="${palette.face}"/>
      <text x="80" y="89" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="${palette.text}">${escapeSvg(initials)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function placeholderPalette(sport) {
  if (sport === "MLB") return { bg: "#123524", face: "#86efac", text: "#052e16" };
  if (sport === "NBA") return { bg: "#3b1d13", face: "#fdba74", text: "#431407" };
  if (sport === "WNBA") return { bg: "#3b0764", face: "#f0abfc", text: "#4a044e" };
  if (isTennisSport(sport)) return { bg: "#283414", face: "#bef264", text: "#1a2e05" };
  if (sport === "Soccer") return { bg: "#102a43", face: "#7dd3fc", text: "#082f49" };
  return { bg: "#1e293b", face: "#cbd5e1", text: "#0f172a" };
}

function escapeSvg(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function riskStyle(risk) {
  const base = { ...styles.riskPill };
  const label = String(risk || "");
  if (label === "Elite" || label === "Low Risk") return { ...base, color: "#052e16", background: "#86efac" };
  if (label === "Medium" || label === "Medium Risk") return { ...base, color: "#422006", background: "#fcd34d" };
  if (label === "Low Data Confidence" || label === "Invalid Data") return { ...base, color: "#111827", background: "#cbd5e1" };
  return { ...base, color: "#450a0a", background: "#fca5a5" };
}

function tierStyle(tier) {
  const base = { ...styles.riskPill };
  if (tier === "Elite verified" || tier === "Elite") return { ...base, color: "#052e16", background: "#86efac" };
  if (tier === "Strong") return { ...base, color: "#042f2e", background: "#5eead4" };
  if (tier === "Solid" || tier === "Medium") return { ...base, color: "#422006", background: "#facc15" };
  if (tier === "Weak lean") return { ...base, color: "#1e3a5f", background: "#93c5fd" };
  return { ...base, color: "#450a0a", background: "#fca5a5" };
}

function sourceStatusStyle(status) {
  const base = { ...styles.sourceStatusPill };
  if (status === "Connected" || status === "fresh") return { ...base, color: "#052e16", background: "#86efac", borderColor: "#22c55e" };
  if (status === "Partial/fallback" || status === "Cached" || status === "cached") return { ...base, color: "#422006", background: "#fcd34d", borderColor: "#ca8a04" };
  if (status === "Setup Needed") return { ...base, color: "#422006", background: "#fcd34d", borderColor: "#ca8a04" };
  if (status === "Failed" || status === "Not Connected") return { ...base, color: "#fecaca", background: "#450a0a", borderColor: "#991b1b" };
  return { ...base, color: "#cbd5e1", background: "#111827", borderColor: "#334155" };
}
