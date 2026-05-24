import assert from "node:assert/strict";
import { playerNamesMatch, normalizePlayerName } from "../src/utils/playerNames.js";
import { isVerifiedSportsbookProp, validateProp, validatePropRejectReason } from "../src/utils/propValidation.js";
import {
  isLegitimateComboStat,
  isParserMergeComboBug,
  resolveParsedPlayerName,
  splitMergedPlayerNames,
  validateParsedPropBeforeRender,
  COMBO_MARKET_TYPE,
} from "../src/utils/comboMarkets.js";
import {
  getIngestionRejectReason,
  buildPrizePicksFlatIngestionContext,
  buildUnderdogLineIngestionContext,
  sanitizePrizePicksPayloadForCache,
} from "../src/utils/ingestionFilter.js";
import {
  canonicalMarketKey,
  getMarketSupportTier,
  isRegisteredMarket,
  isResearchOnlyMarket,
  isNoveltyMarket,
  marketDisplayLabel,
  normalizeMarketStatType,
} from "../src/utils/marketNormalization.js";
import { applySportClassification, isUnsupportedMarket } from "../src/utils/marketClassification.js";
import { isApprovedMarket, isApprovedMarketInRegistry, filterApprovedMarketsOnly, applySportProcessingLimits, RENDER_LIMITS } from "../src/utils/approvedMarkets.js";
import { MLB_ONLY_MODE } from "../src/utils/mlbOnlyMode.js";
import { slimPropForUi } from "../src/utils/renderProp.js";
import { scoreConfidenceFromSignals, getReadyToBetRejectReason } from "../src/services/pickScoring.js";
import { calculateConfidenceScore, CONFIDENCE_THRESHOLDS } from "../src/services/confidenceEngine.js";
import {
  getPropVolatilityTier,
  resolveMarketConfidenceModel,
  scoreMarketConfidence,
} from "../src/services/marketConfidenceModels.js";
import {
  enrichPropDecision,
  detectBookDisagreement,
  sortDecisionBoard,
  isTopPickEligible,
  isBestValueEligible,
} from "../src/services/decisionEngine.js";
import { calibrateConfidence, buildCalibrationMap } from "../src/services/confidenceCalibration.js";
import { lineMovementTrustScore } from "../src/services/lineMovementTrust.js";
import { projectPlayerProp, sigmoidScale, weightedAverage, calculateProjectionConfidence, resolveProjectionEdge, computeProjectionRiskLevel, PROJECTION_CONFIDENCE_THRESHOLDS } from "../src/services/propProjection.js";
import {
  toOutcomeRecord,
  persistBoardOutcomes,
  gradeOutcome,
  gradeCompletedProps,
  buildOutcomeDashboard,
  normalizeOutcomeStatus,
  computeOutcomeAnalytics,
  historicalConfidenceBoost,
  historicalVolatilityPenalty,
  historicalAccuracyBoost,
  marketHitRateAdjustment,
  playerConsistencyModifier,
  BOARD_RECOMMENDATIONS,
} from "../src/services/outcomeTracking.js";
import {
  computePreScorePriority,
  computePropPriorityScore,
  classifyPriorityTier,
  isCoreMarket,
  isSharpOnlyCandidate,
  sortBoardProps,
  BOARD_SORT_MODES,
} from "../src/services/propPriority.js";
import { computeMlbHitterConfidenceAdjustments, shouldRouteMlbHitterToResearch } from "../src/services/mlbHitterConfidence.js";
import {
  evaluateAdaptiveQualification,
  evaluateQualificationPool,
  checkQualificationHardGates,
  QUALIFICATION_TIERS,
  isAcceptedQualificationTier,
  selectDiverseAcceptedProps,
} from "../src/services/adaptiveQualification.js";
import { buildQualificationBoards } from "../src/services/qualification.js";
import {
  attachCacheMetadata,
  computeFreshnessScore,
  FRESHNESS_TIERS,
  isPropCacheUsable,
  prepareVerifiedCacheBoard,
  resolveFreshnessTier,
} from "../src/services/verifiedCacheFallback.js";
import { computeDataQualityFromEnrichment } from "../src/services/statEnrichment.js";
import {
  attachDebugArtifacts,
  buildGroupedDebugEntries,
  buildRejectedPropsList,
  coercePipelineAudit,
  createEmptyPipelineAudit,
  bucketFilterReason,
  recordFilterReason,
  safeCreateEmptyPipelineAudit,
  upsertGroupedDebugEntry,
} from "../src/utils/propPipelineDebug.js";
import {
  GAME_STATUS,
  filterUpcomingSlate,
  getSlateFilterReason,
  normalizeGameStatus,
} from "../src/utils/slateFilter.js";
import {
  buildOfflineManualAnalyzedProp,
  analyzeManualProp,
  selectManualTopPicks,
} from "../src/utils/manualPropBuilder.js";
import {
  scoreManualPropInput,
  getManualStatVolatility,
  rankManualPropScore,
  computeDirectionalEdge,
} from "../src/utils/manualPropScoring.js";
import { projectPitcherStrikeouts, DATA_STATUS } from "../src/modules/mlbProjectionEngine.js";
import { VERIFIED_PROJECTION_LABEL } from "../src/modules/projectionBreakdown.js";
import { computePitcherEdge, computePitcherHitChance } from "../src/modules/scoringEngine.js";

function parseJsonEnvelope(text, source) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.startsWith("<") || /^export\s+default\b/.test(trimmed)) {
    return { ok: false, source, error: `${source} returned non-JSON response`, props: [] };
  }
  try {
    return { ok: true, source, data: JSON.parse(trimmed), props: [] };
  } catch {
    return { ok: false, source, error: `${source} returned non-JSON response`, props: [] };
  }
}

const prizePicks = parseJsonEnvelope(JSON.stringify({ data: [{ id: "pp1", attributes: { line_score: "5.5" } }] }), "PrizePicks");
assert.equal(prizePicks.ok, true);
assert.equal(Array.isArray(prizePicks.data.data), true);

const underdog = parseJsonEnvelope(JSON.stringify({ over_under_lines: [{ id: "ud1", stat_value: "6.5" }] }), "Underdog");
assert.equal(underdog.ok, true);
assert.equal(Array.isArray(underdog.data.over_under_lines), true);

const odds = parseJsonEnvelope(JSON.stringify([{ id: "event1", commence_time: "2099-01-01T00:00:00Z" }]), "The Odds API");
assert.equal(odds.ok, true);
assert.equal(Array.isArray(odds.data), true);

const html = parseJsonEnvelope("<!doctype html><html></html>", "PrizePicks");
assert.equal(html.ok, false);
assert.equal(html.props.length, 0);

const jsSource = parseJsonEnvelope("export default async function handler() {}", "Underdog");
assert.equal(jsSource.ok, false);
assert.equal(jsSource.props.length, 0);

assert.equal(normalizePlayerName("Aaron Judge Jr."), "aaron judge");
assert.equal(playerNamesMatch("Aaron Judge", "Aaron Judge"), true);
assert.equal(playerNamesMatch("Aaron Judge", "A Judge"), true);
assert.equal(playerNamesMatch("John Smith", "Mike Smith"), false);
assert.equal(playerNamesMatch("John Smith", "John"), false);
assert.equal(playerNamesMatch("Ja Morant", "Jon Morant"), false);

const verifiedProp = {
  platform: "PrizePicks",
  playerName: "Aaron Judge",
  statType: "Total Bases",
  line: 1.5,
  startTime: new Date(Date.now() + 3600000).toISOString(),
  sourceId: "pp-123",
  lineSourceBadge: "LIVE",
  sportsbookVerified: true,
  bestPick: "More",
  edge: 0.4,
  confidenceScore: 66,
  dataQualityScore: 52,
  sport: "MLB",
};
assert.equal(isVerifiedSportsbookProp(verifiedProp), true);
assert.deepEqual(validateProp(verifiedProp), { valid: true, reason: "" });
assert.deepEqual(validateProp({ ...verifiedProp, playerName: "Demo Player" }), {
  valid: false,
  reason: "malformed player name",
});
assert.equal(validatePropRejectReason({ ...verifiedProp, playerName: "Demo Player" }), "malformed player name");
assert.equal(validatePropRejectReason({ ...verifiedProp, lineSourceBadge: "FALLBACK" }), "fallback line badge");

assert.equal(isLegitimateComboStat("Points + Rebounds + Assists"), true);
assert.equal(isLegitimateComboStat("Hits+Runs+RBIs"), true);
assert.equal(isParserMergeComboBug({ playerName: "Aaron Judge + Mike Trout", statType: "Total Bases" }), true);
assert.equal(isParserMergeComboBug({ playerName: "LeBron James", statType: "Points + Rebounds + Assists" }), false);
assert.equal(
  validatePropRejectReason({ ...verifiedProp, playerName: "Aaron Judge + Mike Trout" }),
  "merged multi-player name (parser bug)"
);

assert.deepEqual(splitMergedPlayerNames("Jacob deGrom + Grayson Rodriguez"), ["Jacob deGrom", "Grayson Rodriguez"]);
assert.deepEqual(splitMergedPlayerNames("Jeffrey Springs + Walker Buehler"), ["Jeffrey Springs", "Walker Buehler"]);

const mergedWithoutCombo = resolveParsedPlayerName({
  playerName: "Jacob deGrom + Grayson Rodriguez",
  statType: "Pitcher Strikeouts",
  raw: { title: "Jacob deGrom + Grayson Rodriguez Pitcher Strikeouts" },
  explicitSources: [],
});
assert.equal(mergedWithoutCombo.valid, false);
assert.equal(mergedWithoutCombo.reason, "merged multi-player name (parser bug)");

const recoveredSingle = resolveParsedPlayerName({
  playerName: "Jacob deGrom + Grayson Rodriguez",
  statType: "Pitcher Strikeouts",
  raw: { title: "Jacob deGrom + Grayson Rodriguez Pitcher Strikeouts" },
  explicitSources: ["Jacob deGrom"],
});
assert.equal(recoveredSingle.valid, true);
assert.equal(recoveredSingle.playerName, "Jacob deGrom");
assert.equal(recoveredSingle.recoveredFromMerged, true);

const explicitCombo = resolveParsedPlayerName({
  playerName: "Jacob deGrom + Grayson Rodriguez",
  statType: "Pitcher Strikeouts",
  raw: { market_type: "combo", title: "Jacob deGrom + Grayson Rodriguez Pitcher Strikeouts" },
  explicitSources: [],
});
assert.equal(explicitCombo.valid, true);
assert.equal(explicitCombo.marketType, COMBO_MARKET_TYPE);

assert.deepEqual(validateParsedPropBeforeRender({ playerName: "Jeffrey Springs + Walker Buehler", statType: "Pitcher Strikeouts" }), {
  valid: false,
  reason: "merged multi-player name (parser bug)",
});
assert.deepEqual(
  validateParsedPropBeforeRender({
    playerName: "Jacob deGrom + Grayson Rodriguez",
    statType: "Pitcher Strikeouts",
    marketType: COMBO_MARKET_TYPE,
    isExplicitCombo: true,
  }),
  { valid: true, reason: "" }
);

assert.equal(
  getIngestionRejectReason(buildPrizePicksFlatIngestionContext({ league: "KBO", player_name: "Hyun-woo Kim", stat_type: "Hits" })),
  "blocked overseas/placeholder competition"
);
assert.equal(
  getIngestionRejectReason(buildUnderdogLineIngestionContext({
    line: {},
    overUnder: { title: "NPB Strikeouts" },
    game: { sport_id: "baseball", league: "NPB" },
    player: { full_name: "Player One" },
    appearance: {},
  })),
  "blocked overseas/placeholder competition"
);
assert.equal(getIngestionRejectReason({ sport: "MLB", league: "MLB", playerName: "Aaron Judge" }), "");
assert.equal(getIngestionRejectReason({ sport: "NFL", league: "NFL" }), "non-priority sport blocked at ingestion: NFL");
assert.equal(
  getIngestionRejectReason({ sport: "Soccer", league: "K-League", playerName: "Player One" }),
  "blocked overseas/placeholder competition"
);
assert.equal(
  getIngestionRejectReason({ sport: "Soccer", league: "EPL", playerName: "Player One" }),
  MLB_ONLY_MODE ? "unsupported sport blocked at ingestion: Soccer" : ""
);

const ppPayload = sanitizePrizePicksPayloadForCache({
  data: [
    { id: "1", league: "MLB", player_name: "Aaron Judge", stat_type: "Hits", line_score: 1.5 },
    { id: "2", league: "KBO", player_name: "Hyun-woo Kim", stat_type: "Hits", line_score: 1.5 },
  ],
});
assert.equal(ppPayload.data.length, 1);
assert.equal(ppPayload.data[0].league, "MLB");

assert.equal(canonicalMarketKey("Pts+Rebs"), "pr");
assert.equal(canonicalMarketKey("Pts+Asts"), "pa");
assert.equal(canonicalMarketKey("Pts+Rebs+Asts"), "pra");
assert.equal(marketDisplayLabel("Pts+Rebs"), "PR");
assert.equal(marketDisplayLabel("Pts+Asts"), "PA");
assert.equal(marketDisplayLabel("Pts+Rebs+Asts"), "PRA");
assert.equal(normalizeMarketStatType("Pts+Rebs"), "Points + Rebounds");
assert.equal(isRegisteredMarket("Pts+Rebs", "NBA"), true);
assert.equal(isRegisteredMarket("Pts+Asts", "WNBA"), true);
assert.equal(isRegisteredMarket("Pts+Rebs+Asts", "NBA"), true);
assert.equal(isUnsupportedMarket("Pts+Rebs", "NBA"), false);
assert.equal(isUnsupportedMarket("Pts+Asts", "WNBA"), false);
assert.equal(isUnsupportedMarket("Pts+Rebs+Asts", "NBA"), false);
assert.equal(isUnsupportedMarket("Random Market", "NBA"), false);
assert.equal(isNoveltyMarket("Random Market", "NBA"), true);

assert.equal(canonicalMarketKey("Rebs+Asts"), "ra");
assert.equal(canonicalMarketKey("Rebounds + Assists"), "ra");
assert.equal(marketDisplayLabel("Rebs+Asts"), "RA");
assert.equal(normalizeMarketStatType("Rebs+Asts"), "Rebounds + Assists");
assert.equal(isRegisteredMarket("Rebs+Asts", "NBA"), true);
assert.equal(isRegisteredMarket("Rebs+Asts", "WNBA"), true);
assert.equal(isUnsupportedMarket("Rebs+Asts", "NBA"), false);

assert.equal(canonicalMarketKey("H"), "hits");
assert.equal(canonicalMarketKey("TB"), "totalBases");
assert.equal(isRegisteredMarket("H", "MLB"), true);
assert.equal(isUnsupportedMarket("H", "MLB"), false);
assert.equal(normalizeMarketStatType("H"), "Hits");

assert.equal(canonicalMarketKey("Total Sets"), "totalSets");
assert.equal(canonicalMarketKey("Total Tie Breaks"), "totalTieBreaks");
assert.equal(canonicalMarketKey("Break Points"), "breakPoints");
assert.equal(isRegisteredMarket("Total Sets", "ATP Tennis"), true);
assert.equal(isRegisteredMarket("Total Tie Breaks", "WTA Tennis"), true);
assert.equal(isUnsupportedMarket("Total Sets", "ATP Tennis"), false);
assert.equal(getMarketSupportTier("Total Sets", "ATP Tennis"), 2);
assert.equal(getMarketSupportTier("Total Tie Breaks", "Tennis"), 2);
assert.equal(isResearchOnlyMarket("Break Points", "Tennis"), true);

assert.equal(canonicalMarketKey("Time On Ice"), "timeOnIce");
assert.equal(canonicalMarketKey("TOI"), "timeOnIce");
assert.equal(isRegisteredMarket("Time On Ice", "NHL"), true);
assert.equal(isUnsupportedMarket("Time On Ice", "NHL"), false);
assert.equal(getMarketSupportTier("Time On Ice", "NHL"), 2);
assert.equal(isResearchOnlyMarket("Time On Ice", "NHL"), true);

const classifiedRa = applySportClassification({ statType: "Rebs+Asts", sport: "NBA", playerName: "Test Player", line: 8.5 });
assert.equal(classifiedRa.marketKey, "ra");
assert.equal(classifiedRa.marketUnsupported, false);

const classifiedNovelty = applySportClassification({ statType: "First Serve Percentage", sport: "NBA", playerName: "Test Player", line: 50.5 });
assert.equal(classifiedNovelty.noveltyMarket, true);
assert.equal(classifiedNovelty.marketResearchOnly, true);
assert.equal(classifiedNovelty.marketUnsupported, false);

const audit = createEmptyPipelineAudit();
recordFilterReason(audit, "unsupported market: Singles", { statType: "Singles", sport: "MLB" }, "active");
recordFilterReason(audit, "unsupported market: Doubles", { statType: "Doubles", sport: "MLB" }, "active");
assert.equal(audit.filterReasons["unsupported market: singles (MLB)"], 1);
assert.equal(audit.filterReasons["unsupported market: doubles (MLB)"], 1);
assert.equal(bucketFilterReason("unsupported market: Pts+Rebs+Asts", { statType: "Pts+Rebs+Asts", sport: "NBA" }), "unsupported market: pra (NBA)");

assert.equal(canonicalMarketKey("3-PT Made"), "threes");
assert.equal(canonicalMarketKey("Pitching Outs"), "outs");
assert.equal(canonicalMarketKey("Hits Allowed"), "hitsAllowed");
assert.equal(canonicalMarketKey("Earned Runs Allowed"), "earnedRuns");
assert.equal(canonicalMarketKey("Double-Double"), "doubleDouble");
assert.equal(canonicalMarketKey("Points 1st 3 Minutes"), "pointsFirst3Min");
assert.equal(canonicalMarketKey("Quarters with 3+ Points"), "quarterPoints");
assert.equal(normalizeMarketStatType("3-PT Made"), "3-Pointers Made");
assert.equal(normalizeMarketStatType("Pitching Outs"), "Pitching Outs");
assert.equal(normalizeMarketStatType("Hits Allowed"), "Hits Allowed");
assert.equal(marketDisplayLabel("3-PT Made"), "3PM");
assert.equal(marketDisplayLabel("Pitching Outs"), "Outs");
assert.equal(marketDisplayLabel("Hits Allowed"), "HA");
assert.equal(marketDisplayLabel("Double-Double"), "DD");
assert.equal(isRegisteredMarket("Pitching Outs", "MLB"), true);
assert.equal(isRegisteredMarket("Hits Allowed", "MLB"), true);
assert.equal(isRegisteredMarket("3-PT Made", "NBA"), true);
assert.equal(isRegisteredMarket("Double-Double", "NBA"), true);
assert.equal(isUnsupportedMarket("3-PT Made", "NBA"), false);
assert.equal(isUnsupportedMarket("Pitching Outs", "MLB"), false);
assert.equal(isUnsupportedMarket("Hits Allowed", "MLB"), false);
assert.equal(isUnsupportedMarket("Earned Runs Allowed", "MLB"), false);
assert.equal(isUnsupportedMarket("Double-Double", "NBA"), false);
assert.equal(isUnsupportedMarket("Points 1st 3 Minutes", "NBA"), false);
assert.equal(isUnsupportedMarket("Quarters with 3+ Points", "WNBA"), false);
assert.equal(getMarketSupportTier("Pitching Outs", "MLB"), 2);
assert.equal(getMarketSupportTier("Double-Double", "NBA"), 2);
assert.equal(isResearchOnlyMarket("Double-Double", "NBA"), true);
assert.equal(isResearchOnlyMarket("3-PT Made", "NBA"), false);

assert.equal(canonicalMarketKey("Singles"), "singles");
assert.equal(canonicalMarketKey("1B"), "singles");
assert.equal(canonicalMarketKey("Doubles"), "doubles");
assert.equal(canonicalMarketKey("2B"), "doubles");
assert.equal(canonicalMarketKey("Home Runs"), "homeRuns");
assert.equal(canonicalMarketKey("HR"), "homeRuns");
assert.equal(canonicalMarketKey("Stolen Bases"), "stolenBases");
assert.equal(canonicalMarketKey("SB"), "stolenBases");
assert.equal(canonicalMarketKey("TB"), "totalBases");
assert.equal(canonicalMarketKey("Walks"), "batterWalks");
assert.equal(normalizeMarketStatType("Home Runs"), "Home Runs");
assert.equal(marketDisplayLabel("Home Runs"), "HR");
assert.equal(marketDisplayLabel("Stolen Bases"), "SB");
assert.equal(isRegisteredMarket("Singles", "MLB"), true);
assert.equal(isRegisteredMarket("Doubles", "MLB"), true);
assert.equal(isRegisteredMarket("Home Runs", "MLB"), true);
assert.equal(isRegisteredMarket("Stolen Bases", "MLB"), true);
assert.equal(isRegisteredMarket("1B", "MLB"), true);
assert.equal(isUnsupportedMarket("Singles", "MLB"), false);
assert.equal(isUnsupportedMarket("Doubles", "MLB"), false);
assert.equal(isUnsupportedMarket("Home Runs", "MLB"), false);
assert.equal(isUnsupportedMarket("Stolen Bases", "MLB"), false);
assert.equal(getMarketSupportTier("Singles", "MLB"), 1);
assert.equal(getMarketSupportTier("Doubles", "MLB"), 2);
assert.equal(getMarketSupportTier("Home Runs", "MLB"), 2);
assert.equal(getMarketSupportTier("Stolen Bases", "MLB"), 2);
assert.equal(getMarketSupportTier("Hits", "MLB"), 1);
assert.equal(isResearchOnlyMarket("Doubles", "MLB"), true);
assert.equal(isResearchOnlyMarket("Home Runs", "MLB"), true);
assert.equal(isResearchOnlyMarket("Stolen Bases", "MLB"), true);
assert.equal(isResearchOnlyMarket("Walks", "MLB"), true);

const tier2Prop = {
  ...verifiedProp,
  statType: "Double-Double",
  sport: "NBA",
  marketSupportTier: 2,
  marketResearchOnly: true,
  marketUnsupported: false,
};
assert.equal(getReadyToBetRejectReason(tier2Prop), "research-only market tier");

const futureStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const mlbHitterReadyProp = {
  ...verifiedProp,
  statType: "Total Bases",
  marketSupportTier: 1,
  marketResearchOnly: false,
  marketUnsupported: false,
  sampleSize: 8,
  hasVerifiedStats: true,
  startTime: futureStart,
  status: "upcoming",
};
assert.equal(getReadyToBetRejectReason(mlbHitterReadyProp), "");

const mlbHitterSparse = {
  ...verifiedProp,
  statType: "Singles",
  marketSupportTier: 1,
  marketResearchOnly: false,
  sampleSize: 1,
  sparseProfile: true,
  lineOnlyData: true,
  startTime: futureStart,
  status: "upcoming",
};
assert.equal(shouldRouteMlbHitterToResearch(mlbHitterSparse, { sampleSize: 1, sparse: true }, { lineOnly: true }), true);
assert.equal(getReadyToBetRejectReason({ ...mlbHitterSparse, bestPick: "More", edge: 0.3, confidenceScore: 66, dataQualityScore: 52 }), "MLB hitter research-only — insufficient data");

assert.equal(isUnsupportedMarket("Disposals", "MLB"), true);
assert.equal(isUnsupportedMarket("First Blood", "MLB"), true);

const hrAdj = computeMlbHitterConfidenceAdjustments({
  prop: { statType: "Home Runs", sport: "MLB", line: 0.5, bestPick: "More" },
  profile: {
    last5Average: 0.8,
    seasonAverage: 0.6,
    isolatedPower: 0.24,
    barrelRateEstimate: 0.11,
    hrPerFlyBallEstimate: 0.2,
    opponentPitcherHrAllowed: 1.1,
    sampleSize: 10,
  },
  bestPick: "More",
});
assert.ok(hrAdj.formBoost > 0, "HR market should get form boost from ISO/barrel signals");
assert.ok(hrAdj.matchupBoost > 0, "HR market should get matchup boost from pitcher HR allowed");
assert.equal(hrAdj.cap, 55, "HR is research-only in MLB-only mode and uses a confidence cap");
const liveProp = {
  ...verifiedProp,
  startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  status: "live",
  gameStatus: "live",
};
const upcomingProp = { ...verifiedProp, startTime: futureStart, status: "upcoming", gameStatus: "scheduled" };
const finalProp = { ...verifiedProp, startTime: futureStart, status: "final", gameStatus: "final" };
const farFutureProp = { ...verifiedProp, startTime: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), status: "upcoming" };

assert.equal(normalizeGameStatus(liveProp), GAME_STATUS.live);
assert.equal(normalizeGameStatus(finalProp), GAME_STATUS.final);
assert.equal(normalizeGameStatus(upcomingProp), GAME_STATUS.pregame);
assert.equal(getSlateFilterReason(liveProp), "game is live");
assert.equal(getSlateFilterReason(finalProp), "game is final");
assert.equal(getSlateFilterReason(upcomingProp), "");
assert.equal(getSlateFilterReason(farFutureProp, { pregameWindowHours: 24 }), "outside pregame window");

const slateAudit = { filterReasons: {}, rejectionByStage: {}, groupedRejections: [] };
const slateKept = filterUpcomingSlate([liveProp, finalProp, upcomingProp], { pregameWindowHours: 24 }, slateAudit);
assert.equal(slateKept.length, 1);
assert.equal(slateKept[0].playerName, upcomingProp.playerName);
assert.equal(slateAudit.upcomingSlate, 1);
assert.equal(slateAudit.slateExcluded, 2);

assert.ok(typeof createEmptyPipelineAudit === "function");
assert.equal(coercePipelineAudit(null).fetched, 0);
assert.ok(Array.isArray(safeCreateEmptyPipelineAudit().groupedRejections));
assert.ok(Array.isArray(attachDebugArtifacts({}, null).rejectedProps));
assert.deepEqual(attachDebugArtifacts({}, null).validationSummary, { stages: [], global: [] });

const groupedAudit = createEmptyPipelineAudit();
for (let i = 0; i < 18; i += 1) {
  upsertGroupedDebugEntry(groupedAudit, {
    stage: "preScore",
    sport: "MLB",
    market: "Pitcher Strikeouts",
    reason: "adjusted odds prop handled by Streak Finder",
  });
}
assert.equal(groupedAudit.groupedRejections.length, 1);
assert.equal(groupedAudit.groupedRejections[0].count, 18);
assert.equal(buildRejectedPropsList(groupedAudit)[0].reason, "adjusted odds prop handled by Streak Finder");

const groupedScoring = buildGroupedDebugEntries(
  [
    { sport: "MLB", statType: "Pitcher Strikeouts", decisionTier: "ready" },
    { sport: "MLB", statType: "Pitcher Strikeouts", decisionTier: "ready" },
    { sport: "MLB", statType: "Total Bases", decisionTier: "research" },
  ],
  { stage: "scoring", reasonField: (prop) => `tier:${prop.decisionTier}` }
);
assert.equal(groupedScoring.find((row) => row.market === "Pitcher Strikeouts")?.count, 2);

const lowEdge = scoreConfidenceFromSignals({ edge: 0.2, line: 10, dataQualityScore: 40, projectionSource: "sportsbook-market", sportsbookBoost: 4 });
const highEdge = scoreConfidenceFromSignals({ edge: 2.5, line: 10, dataQualityScore: 72, projectionSource: "player-stats", sampleScore: 7, sportsbookBoost: 8, formBoost: 8 });
assert.notEqual(lowEdge.score, highEdge.score, "confidence should vary by signals");
assert.ok(highEdge.score > lowEdge.score, "stronger signals should score higher");

const sparseDq = computeDataQualityFromEnrichment({ sparse: true, line: 22.5 }, { line: 22.5, sportsbookVerified: true, projectionSource: "missing" });
const richDq = computeDataQualityFromEnrichment(
  { sampleSize: 12, hasGameLogs: true, hasMatchup: true, hasRoleContext: true, verified: true, line: 22.5 },
  { line: 22.5, sportsbookVerified: true, projectionSource: "player-stats", edge: 2.1, sportsbookComparison: { books: 4 }, injuryRisk: "Low", injuryFetched: true }
);
assert.notEqual(sparseDq.score, richDq.score, "DQ should vary by enrichment");
assert.ok(richDq.score > sparseDq.score, "richer data should score higher DQ");

assert.equal(getPropVolatilityTier({ statType: "Pitcher Strikeouts" }), "LOW");
assert.equal(getPropVolatilityTier({ statType: "Home Runs" }), "HIGH");
assert.equal(getPropVolatilityTier({ statType: "Fantasy Score" }), "MEDIUM");
assert.equal(resolveMarketConfidenceModel({ sport: "MLB", statType: "Pitcher Strikeouts" }), "mlb_pitcher_strikeouts");
assert.equal(resolveMarketConfidenceModel({ sport: "NBA", statType: "PRA" }), "basketball_pra");

const mlbKsConfidence = calculateConfidenceScore({
  sport: "MLB",
  statType: "Pitcher Strikeouts",
  line: 5.5,
  projection: 6.8,
  edge: 1.3,
  bestPick: "More",
  last5Average: 6.4,
  opponentAllowed: 6.1,
  strikeoutTrend: "trending up",
  pitchCountTrend: "stable workload",
  handednessMatchup: "favorable L/R",
  umpireRating: 0.12,
  sampleSize: 12,
  last10HitRate: 0.62,
  volatility: 1.6,
  dataQualityScore: 70,
  hasVerifiedStats: true,
});
assert.equal(mlbKsConfidence.marketModel, "mlb_pitcher_strikeouts");
assert.ok(mlbKsConfidence.score > 0);
assert.ok((mlbKsConfidence.explanation || []).some((row) => /Matchup Score|Market Model/i.test(row.label)));

const wnbaPraConfidence = calculateConfidenceScore({
  sport: "WNBA",
  statType: "PRA",
  line: 28.5,
  projection: 31.2,
  edge: 2.7,
  bestPick: "More",
  last5Average: 30.1,
  opponentRank: 26,
  projectedMinutes: "stable minutes",
  usageTrend: { stable: true, label: "usage stable" },
  sampleSize: 14,
  last10HitRate: 0.66,
  volatility: 2.2,
  dataQualityScore: 72,
  hasVerifiedStats: true,
});
assert.equal(wnbaPraConfidence.marketModel, "basketball_pra");
assert.ok(wnbaPraConfidence.score >= CONFIDENCE_THRESHOLDS.READY);

const richConfidence = calculateConfidenceScore({
  sport: "NBA",
  statType: "Points",
  line: 24.5,
  projection: 27.2,
  edge: 2.7,
  bestPick: "More",
  dataQualityScore: richDq.score,
  dataCompleteness: 78,
  sampleSize: 12,
  last5Average: 26.8,
  last10HitRate: 0.68,
  recentHitRate: 0.68,
  volatility: 2.1,
  sportsbookDiscrepancy: 0.6,
  sportsbookComparison: { books: 3, marketAverageLine: 25.5 },
  sharpMoneyIndicator: "Strong alignment",
  matchupRating: "Favorable",
  lineMovement: { supportsPick: true },
  hasVerifiedStats: true,
});
assert.ok(richConfidence.score > 0, "confidence should never be zero for valid line");
assert.ok(richConfidence.score >= CONFIDENCE_THRESHOLDS.READY, "rich prop should meet ready threshold");
assert.equal(richConfidence.explanation.length, 8, "confidence breakdown should include 8 components");

const sparseConfidence = calculateConfidenceScore({
  sport: "NBA",
  statType: "Random Prop",
  line: 10.5,
  noveltyMarket: true,
  edge: 0.2,
  dataQualityScore: 32,
  sampleSize: 1,
  volatility: 4.2,
});
assert.ok(sparseConfidence.score < richConfidence.score, "sparse prop should score lower");
assert.ok(sparseConfidence.score >= 25, "sparse prop with line still gets baseline confidence");

assert.equal(isCoreMarket({ sport: "NBA", statType: "Points" }), true);
assert.equal(isCoreMarket({ sport: "NBA", statType: "Rebs+Asts" }), false);
assert.equal(isCoreMarket({ sport: "MLB", statType: "Pitcher Strikeouts" }), true);
assert.equal(isCoreMarket({ sport: "ATP Tennis", statType: "Aces" }), true);

const corePre = computePreScorePriority({ sport: "NBA", statType: "Points", platform: "PrizePicks", playerName: "A", line: 24.5, startTime: futureStart });
const exoticPre = computePreScorePriority({ sport: "ATP Tennis", statType: "Total Tie Breaks", platform: "PrizePicks", playerName: "B", line: 1.5, startTime: futureStart });
assert.ok(corePre > exoticPre, "core props should rank higher before scoring");

const scoredCore = {
  sport: "NBA",
  statType: "Points",
  confidenceScore: 72,
  dataQualityScore: 68,
  edge: 2.1,
  line: 24.5,
  expectedValue: 0.04,
  sampleSize: 10,
  recentHitRate: 0.7,
  volatility: 2.1,
  sharpMoneyIndicator: "Strong alignment",
  sportsbookDiscrepancy: 0.8,
  sportsbookComparison: { books: 3 },
  matchupRating: "Favorable",
  lineMovement: { supportsPick: true },
};
const scoredNovelty = {
  sport: "NBA",
  statType: "Random Prop",
  noveltyMarket: true,
  confidenceScore: 58,
  dataQualityScore: 44,
  edge: 0.6,
  line: 3.5,
  sampleSize: 2,
  volatility: 3.8,
};
assert.ok(computePropPriorityScore(scoredCore) > computePropPriorityScore(scoredNovelty), "core scored prop should outrank novelty");
assert.equal(classifyPriorityTier({ sport: "NBA", statType: "Points", priorityScore: 70 }), "core");

assert.equal(
  isSharpOnlyCandidate({
    ...scoredCore,
    priorityScore: computePropPriorityScore(scoredCore),
  }),
  true
);
assert.equal(isSharpOnlyCandidate({ ...scoredNovelty, priorityScore: 30 }), false);

const sortedEv = sortBoardProps(
  [
    { expectedValue: 0.01, priorityScore: 40, confidenceScore: 60 },
    { expectedValue: 0.06, priorityScore: 55, confidenceScore: 65 },
  ],
  BOARD_SORT_MODES.ev
);
assert.ok(Number(sortedEv[0].expectedValue) > Number(sortedEv[1].expectedValue), "EV sort should lead with highest EV");

assert.ok(sigmoidScale(0) > 0.85 && sigmoidScale(0) < 1.15, "sigmoidScale stays bounded");
assert.equal(weightedAverage([[10, 1], [20, 1]]), 15, "weightedAverage blends values");

const mlbProjection = projectPlayerProp(
  { sport: "MLB", statType: "Hits", line: 1.5, playerName: "Test Hitter" },
  {
    profile: {
      sport: "MLB",
      hasGameLogs: true,
      last5Average: 1.8,
      last10Average: 1.6,
      seasonAverage: 1.5,
      volatility: 0.6,
      handednessMatchup: "vs LHP — favorable",
      battingOrderNote: "Leadoff spot",
      parkFactorNote: "Hitter-friendly park",
      opponentAllowed: 1.9,
      sampleSize: 12,
    },
  }
);
assert.ok(Number.isFinite(mlbProjection.projectedValue), "MLB projection should return a value");
assert.ok(mlbProjection.projectedValue > 1.5, "MLB hits projection should lean over on favorable signals");
assert.ok(mlbProjection.edge > 0, "MLB projection should produce positive edge");
assert.ok(mlbProjection.bestPick === "More", "MLB edge should pick More");
assert.ok((mlbProjection.projectionReasoning || []).length > 0, "MLB projection should include reasoning");

const nbaProjection = projectPlayerProp(
  { sport: "NBA", statType: "Points", line: 22.5, playerName: "Test Guard" },
  {
    profile: {
      sport: "NBA",
      hasGameLogs: true,
      last5Average: 26.2,
      last10Average: 24.8,
      seasonAverage: 23.5,
      volatility: 2.4,
      usageTrend: { label: "Usage up", delta: 4 },
      minutesTrend: { label: "34+ min", delta: 3 },
      projectedMinutes: "34.5",
      opponentRank: 28,
      opponentAllowed: 24.5,
      sampleSize: 15,
    },
    injury: { risk: "Low" },
  }
);
if (MLB_ONLY_MODE) {
  assert.ok(nbaProjection.projectedValue == null, "NBA projection disabled in MLB-only mode");
  assert.ok((nbaProjection.projectionReasoning || []).some((line) => /MLB-only/i.test(line)), "NBA projection explains MLB-only disable");
} else {
  assert.ok(Number.isFinite(Number(nbaProjection.projectedValue)), "NBA projection enabled in multi-sport mode");
}

const tennisProjection = projectPlayerProp(
  { sport: "ATP Tennis", statType: "Aces", line: 8.5, playerName: "Test Server", opponent: "Returner", league: "Wimbledon" },
  {
    profile: {
      sport: "ATP Tennis",
      last5Average: 9.2,
      last10Average: 8.8,
      volatility: 2.2,
      holdPct: 0.82,
      breakPct: 0.22,
      aceRate: 11,
      sampleSize: 10,
    },
  }
);
if (MLB_ONLY_MODE) {
  assert.ok(tennisProjection.projectedValue == null, "Tennis projection disabled in MLB-only mode");
} else {
  assert.ok(Number.isFinite(Number(tennisProjection.projectedValue)), "Tennis projection enabled in multi-sport mode");
}

const projectedConfidence = calculateConfidenceScore({
  sport: "MLB",
  statType: "Pitcher Strikeouts",
  line: 5.5,
  projection: 6.8,
  edge: 1.3,
  bestPick: "More",
  dataQualityScore: 70,
  sampleSize: 12,
  last5Average: 6.4,
  last10Average: 6.1,
  seasonAverage: 5.8,
  volatility: 1.6,
  opponentAllowed: 6.0,
  hasVerifiedStats: true,
  strikeoutTrend: "trending up",
  pitchCountTrend: "stable workload",
  handednessMatchup: "favorable L/R",
  umpireRating: 0.12,
  last10HitRate: 0.62,
});
assert.ok(projectedConfidence.score > 0, "projected prop confidence should not be zero");
assert.equal(projectedConfidence.marketModel, "mlb_pitcher_strikeouts");

const bookEdge = resolveProjectionEdge(27.5, { dfsLine: 22.5, sportsbookLine: 24.5 });
assert.equal(bookEdge.bestPick, "More", "pick side should follow DFS line gap");
assert.equal(bookEdge.edge, 3, "edge should be vs sportsbook line");
assert.ok(bookEdge.sportsbookEdge > 0, "sportsbook edge should be positive");

const projectionConf = calculateProjectionConfidence({
  sport: "NBA",
  statType: "Points",
  line: 22.5,
  projectedValue: 27.5,
  projection: 27.5,
  edge: 3,
  bestPick: "More",
  dataQualityScore: 68,
  sampleSize: 15,
  last5Average: 26.2,
  last10Average: 24.8,
  volatility: 2.4,
  opponentRank: 28,
  hasVerifiedStats: true,
  sportsbookComparison: { books: 3, marketAverageLine: 24.5 },
  sharpMoneyIndicator: "Strong alignment",
  matchupRating: "Favorable",
});
assert.ok(projectionConf.score >= PROJECTION_CONFIDENCE_THRESHOLDS.READY, "projection confidence should meet ready bar");
assert.ok(projectionConf.score > 0, "projection confidence never zero with line");
assert.ok((projectionConf.explanation || []).length >= 8, "projection confidence includes factor breakdown");

const riskLow = computeProjectionRiskLevel({ confidenceScore: 75, volatility: 2, edge: 2.5, projectedValue: 27, hasVerifiedStats: true });
const riskHigh = computeProjectionRiskLevel({ confidenceScore: 40, volatility: 4.5, edge: 0.2, projectedValue: null, injury: { risk: "High" } });
assert.equal(riskLow, "LOW");
assert.equal(riskHigh, "HIGH");

const trackedProp = {
  id: "pp-track-1",
  sport: "NBA",
  statType: "Points",
  playerName: "Jamal Guard",
  platform: "PrizePicks",
  line: 22.5,
  confidenceScore: 74,
  edge: 2.1,
  bestPick: "More",
  startTime: "2099-06-01T00:00:00Z",
  hasVerifiedStats: true,
  sportsbookVerified: true,
  lineSourceBadge: "LIVE",
  status: "upcoming",
};
const outcome = toOutcomeRecord(trackedProp, BOARD_RECOMMENDATIONS.TOP_PICKS);
assert.equal(outcome.player, "Jamal Guard");
assert.equal(outcome.confidence, 74);
assert.equal(outcome.edge, 2.1);
assert.equal(outcome.recommendation, BOARD_RECOMMENDATIONS.TOP_PICKS);
assert.equal(outcome.result, "Pending");
assert.equal(outcome.status, "pending");
assert.equal(normalizeOutcomeStatus("Win"), "win");

const graded = gradeOutcome(outcome, 25.5);
assert.equal(graded.resultStatus, "Win");
assert.equal(graded.status, "win");

const history = [
  { ...outcome, resultStatus: "Win", finalResult: "Win", sport: "NBA", statType: "Points", confidenceScore: 74, confidenceTier: "72-79" },
  { ...outcome, id: "loss-1", uniqueKey: "loss-1", playerName: "Other", player: "Other", resultStatus: "Loss", finalResult: "Loss", sport: "NBA", statType: "Points", confidenceScore: 74, confidenceTier: "72-79" },
  { ...outcome, id: "win-2", uniqueKey: "win-2", playerName: "Other2", player: "Other2", resultStatus: "Win", finalResult: "Win", sport: "NBA", statType: "Points", confidenceScore: 74, confidenceTier: "72-79" },
  { ...outcome, id: "win-3", uniqueKey: "win-3", playerName: "Other3", player: "Other3", resultStatus: "Win", finalResult: "Win", sport: "NBA", statType: "Points", confidenceScore: 74, confidenceTier: "72-79" },
  { ...outcome, id: "win-4", uniqueKey: "win-4", playerName: "Other4", player: "Other4", resultStatus: "Win", finalResult: "Win", sport: "NBA", statType: "Points", confidenceScore: 74, confidenceTier: "72-79" },
];
const analytics = computeOutcomeAnalytics(history);
assert.ok(analytics.bySport.NBA.sample >= 4);
assert.ok(analytics.byPropType.Points.sample >= 4);

const boost = historicalConfidenceBoost(trackedProp, history);
assert.ok(Number.isFinite(boost.boost));
const penalty = historicalVolatilityPenalty(trackedProp, history);
assert.ok(Number.isFinite(penalty.penalty));

const learnedConfidence = calculateProjectionConfidence(
  { ...trackedProp, projectedValue: 25.5, projection: 25.5, dataQualityScore: 70, sampleSize: 12, hasVerifiedStats: true },
  { historyRows: history }
);
assert.ok(learnedConfidence.score > 0);

const persisted = persistBoardOutcomes(
  {
    topPicks: [trackedProp],
    readyToBet: [],
    goblins: [],
    demons: [],
  },
  []
);
assert.equal(persisted.length, 1);

const dashboard = buildOutcomeDashboard([
  { ...outcome, resultStatus: "Win", finalResult: "Win", statType: "Pitcher Strikeouts", sport: "MLB", confidenceScore: 76, confidenceTier: "72-79" },
  { ...outcome, id: "m2", uniqueKey: "m2", playerName: "Pitcher B", player: "Pitcher B", resultStatus: "Win", finalResult: "Win", statType: "Pitcher Strikeouts", sport: "MLB", confidenceScore: 76, confidenceTier: "72-79" },
  { ...outcome, id: "m3", uniqueKey: "m3", playerName: "Pitcher C", player: "Pitcher C", resultStatus: "Win", finalResult: "Win", statType: "Pitcher Strikeouts", sport: "MLB", confidenceScore: 76, confidenceTier: "72-79" },
  { ...outcome, id: "m4", uniqueKey: "m4", playerName: "Pitcher D", player: "Pitcher D", resultStatus: "Win", finalResult: "Win", statType: "Pitcher Strikeouts", sport: "MLB", confidenceScore: 76, confidenceTier: "72-79" },
  { ...outcome, id: "m5", uniqueKey: "m5", playerName: "Pitcher E", player: "Pitcher E", resultStatus: "Win", finalResult: "Win", statType: "Pitcher Strikeouts", sport: "MLB", confidenceScore: 76, confidenceTier: "72-79" },
  { ...outcome, id: "h1", uniqueKey: "h1", playerName: "Hitter A", player: "Hitter A", resultStatus: "Loss", finalResult: "Loss", statType: "Hits", sport: "MLB", confidenceScore: 60, confidenceTier: "58-64" },
  { ...outcome, id: "h2", uniqueKey: "h2", playerName: "Hitter B", player: "Hitter B", resultStatus: "Loss", finalResult: "Loss", statType: "Hits", sport: "MLB", confidenceScore: 60, confidenceTier: "58-64" },
  { ...outcome, id: "h3", uniqueKey: "h3", playerName: "Hitter C", player: "Hitter C", resultStatus: "Loss", finalResult: "Loss", statType: "Hits", sport: "MLB", confidenceScore: 60, confidenceTier: "58-64" },
  { ...outcome, id: "h4", uniqueKey: "h4", playerName: "Hitter D", player: "Hitter D", resultStatus: "Loss", finalResult: "Loss", statType: "Hits", sport: "MLB", confidenceScore: 60, confidenceTier: "58-64" },
  { ...outcome, id: "h5", uniqueKey: "h5", playerName: "Hitter E", player: "Hitter E", resultStatus: "Loss", finalResult: "Loss", statType: "Hits", sport: "MLB", confidenceScore: 60, confidenceTier: "58-64" },
]);
assert.ok(dashboard.bestMarket);
assert.ok(dashboard.worstMarket);
assert.ok(dashboard.total >= 10);

const decisionProp = enrichPropDecision({
  ...trackedProp,
  projectedValue: 25.2,
  projection: 25.2,
  edge: 2.7,
  confidence: 74,
  dataQualityScore: 72,
  volatility: 2.1,
  modelProbability: 0.58,
  impliedProbability: 0.52,
  expectedValue: 0.04,
  sportsbookComparison: { marketAverageLine: 23.5, books: 4 },
  lineMovement: { supportsPick: true, openingLine: 21.5, currentLine: 22.5, amount: 1, direction: "up" },
});
assert.ok(Number(decisionProp.expectedValueScore) > 0);
assert.ok(Number(decisionProp.volatilityScore) > 0);
assert.ok(Number(decisionProp.lineValueScore) > 0);
assert.ok(decisionProp.qualificationReason.includes("edge"));
assert.ok(detectBookDisagreement(decisionProp).softLine);

const sortedBoard = sortDecisionBoard([
  { ...decisionProp, expectedValueScore: 40, confidenceScore: 60 },
  { ...decisionProp, playerName: "Higher EV", expectedValueScore: 80, confidenceScore: 70 },
]);
assert.equal(sortedBoard[0].playerName, "Higher EV");

assert.ok(isTopPickEligible({ ...decisionProp, confidenceScore: 74, dataQualityScore: 72 }));
assert.equal(isTopPickEligible({ ...decisionProp, confidenceScore: 60 }), false);

assert.ok(isApprovedMarket({ sport: "MLB", statType: "Total Bases", marketKey: "totalBases" }));
assert.ok(isApprovedMarket({ sport: "MLB", statType: "Home Runs", marketKey: "homeRuns" }));
if (MLB_ONLY_MODE) {
  assert.equal(isApprovedMarket({ sport: "NBA", statType: "Points", marketKey: "points" }), false);
} else {
  assert.ok(isApprovedMarket({ sport: "NBA", statType: "Points", marketKey: "points" }));
}

assert.ok(isApprovedMarket({ sport: "MLB", statType: "Pitcher Strikeouts", marketKey: "strikeouts" }));
assert.equal(isApprovedMarket({ sport: "MLB", statType: "Steals", marketKey: "steals" }), false);
assert.ok(isApprovedMarketInRegistry({ sport: "NBA", statType: "Points", marketKey: "points" }));
assert.equal(filterApprovedMarketsOnly([
  { sport: "MLB", statType: "Pitcher Strikeouts", marketKey: "strikeouts" },
  { sport: "MLB", statType: "Steals", marketKey: "steals" },
  { sport: "NBA", statType: "Points", marketKey: "points" },
]).length, MLB_ONLY_MODE ? 1 : 2);
assert.equal(
  applySportProcessingLimits(Array.from({ length: 180 }, (_, i) => ({ sport: "MLB", id: i }))).length,
  MLB_ONLY_MODE ? 150 : 80
);
assert.equal(RENDER_LIMITS.readyToBet, 20);

const calibrationHistory = Array.from({ length: 12 }, (_, i) => ({
  id: `cal-${i}`,
  uniqueKey: `cal-${i}`,
  sport: "MLB",
  statType: "Pitcher Strikeouts",
  confidenceScore: 74,
  confidenceTier: "72-79",
  line: 5.5,
  bestPick: "More",
  resultStatus: i < 5 ? "Win" : "Loss",
  recommendation: BOARD_RECOMMENDATIONS.TOP_PICKS,
}));
const calibration = calibrateConfidence({ confidenceScore: 74 }, 74, calibrationHistory);
assert.ok(Number.isFinite(calibration.calibratedConfidence));
assert.ok(buildCalibrationMap(calibrationHistory));

const trust = lineMovementTrustScore(
  { bestPick: "More", line: 5.5, sportsbookVerified: true },
  { openingLine: 6, currentLine: 5.5, previousLine: 6 }
);
assert.ok(trust.supportsPick);

const marketAdj = marketHitRateAdjustment({ sport: "MLB", statType: "Pitcher Strikeouts" }, calibrationHistory);
assert.ok(typeof marketAdj.adjustment === "number");

const playerMod = playerConsistencyModifier({ playerName: "Test Pitcher" }, calibrationHistory);
assert.ok(typeof playerMod.penalty === "number");

const accuracyBoost = historicalAccuracyBoost({ sport: "MLB", statType: "Pitcher Strikeouts", playerName: "Test" }, calibrationHistory);
assert.ok(typeof accuracyBoost.boost === "number");

const gradedCompleted = gradeCompletedProps([
  { sport: "MLB", statType: "Hits", line: 1.5, bestPick: "More", startTime: "2000-01-01T00:00:00Z", resultStatus: "Pending" },
]);
assert.ok(Array.isArray(gradedCompleted.history));

assert.equal(resolveMarketConfidenceModel({ sport: "MLB", statType: "Pitching Outs" }), "mlb_pitching_outs");
assert.equal(resolveMarketConfidenceModel({ sport: "MLB", statType: "Total Bases" }), "mlb_total_bases");
assert.equal(resolveMarketConfidenceModel({ sport: "MLB", statType: "Fantasy Score" }), "mlb_fantasy_score");

assert.equal(
  isBestValueEligible({
    sport: "MLB",
    platform: "PrizePicks",
    playerName: "Mike Trout",
    statType: "Pitcher Strikeouts",
    line: 5.5,
    startTime: "2099-06-01T00:00:00Z",
    sourceId: "pp-test-1",
    lineSourceBadge: "LIVE",
    sportsbookVerified: true,
    edge: 1.2,
    bestPick: "More",
    expectedValueScore: 52,
    dataQualityScore: 55,
    status: "upcoming",
    hasVerifiedStats: true,
  }),
  true
);

const slim = slimPropForUi({ id: "1", playerName: "Test", sport: "NBA", statType: "Points", line: 20, sportsbookComparison: { books: 3 }, raw: {} });
assert.equal(slim.playerName, "Test");
assert.equal(slim.sportsbookComparison, undefined);

const adaptiveProp = {
  id: "qual-strong",
  sport: "MLB",
  platform: "PrizePicks",
  playerName: "Elite Pitcher",
  statType: "Pitcher Strikeouts",
  line: 5.5,
  startTime: "2099-06-01T00:00:00Z",
  sourceId: "pp-qual-1",
  lineSourceBadge: "LIVE",
  sportsbookVerified: true,
  edge: 1.4,
  bestPick: "More",
  confidenceScore: 68,
  dataQualityScore: 58,
  status: "upcoming",
  hasVerifiedStats: true,
  sampleSize: 10,
  projection: 6.8,
  projectionSource: "player-stats",
  volatility: 2.1,
  matchupRating: 72,
  opponentAllowed: 6.2,
  meetsVolatilityRequirements: true,
};
const adaptiveEval = evaluateAdaptiveQualification(adaptiveProp);
assert.ok(adaptiveEval.qualificationScore >= 65);
assert.ok(Object.keys(adaptiveEval.metrics).length >= 6);
assert.equal(checkQualificationHardGates({ ...adaptiveProp, freshnessTier: "EXPIRED", lineSourceBadge: "STALE" }).pass, false);

const adaptivePool = evaluateQualificationPool([adaptiveProp, { ...adaptiveProp, id: "qual-stale", freshnessTier: "EXPIRED", lineSourceBadge: "STALE" }]);
assert.ok(adaptivePool.analytics.avgQualificationScore > 0);
assert.ok(adaptivePool.analytics.topRejectionCauses.length >= 1);

const qualBoards = buildQualificationBoards([adaptiveProp], safeCreateEmptyPipelineAudit(), []);
assert.ok(qualBoards.qualificationAnalytics);
assert.ok(Array.isArray(qualBoards.ready));

const diverse = selectDiverseAcceptedProps(
  [
    { ...adaptiveProp, id: "a", statType: "Pitcher Strikeouts", qualificationScore: 82 },
    { ...adaptiveProp, id: "b", statType: "Pitcher Strikeouts", qualificationScore: 80 },
    { ...adaptiveProp, id: "c", statType: "Total Bases", qualificationScore: 78 },
  ],
  3
);
assert.equal(diverse.length, 3);

const cachedMeta = attachCacheMetadata(adaptiveProp, { verifiedAt: new Date().toISOString() });
assert.ok(cachedMeta.freshnessScore >= 80);
assert.equal(resolveFreshnessTier(2 * 60 * 1000, adaptiveProp), FRESHNESS_TIERS.LIVE);
assert.ok(isPropCacheUsable(adaptiveProp, { verifiedAt: new Date().toISOString() }));
const preparedBoard = prepareVerifiedCacheBoard({
  props: [adaptiveProp],
  qualifiedReadyProps: [adaptiveProp],
  updatedAt: new Date().toISOString(),
});
assert.ok(preparedBoard?.props?.length >= 1);
assert.ok(computeFreshnessScore(adaptiveProp, 4 * 60 * 1000) > 0);

const goblinHit = buildOfflineManualAnalyzedProp({
  playerName: "Juan Soto",
  sport: "MLB",
  statType: "Hits",
  line: 0.5,
  side: "over",
  source: "PrizePicks",
  payoutType: "goblin",
});
const demonHrr = buildOfflineManualAnalyzedProp({
  playerName: "Aaron Judge",
  sport: "MLB",
  statType: "Hits+Runs+RBIs",
  line: 2.5,
  side: "under",
  source: "Underdog",
  payoutType: "demon",
});
const nbaAst = buildOfflineManualAnalyzedProp({
  playerName: "Trae Young",
  sport: "NBA",
  statType: "Assists",
  line: 10.5,
  side: "under",
  source: "PrizePicks",
  payoutType: "standard",
});

assert.ok(goblinHit.confidenceScore >= 72 && goblinHit.confidenceScore <= 85);
assert.ok(demonHrr.confidenceScore >= 45 && demonHrr.confidenceScore <= 60);
assert.ok(nbaAst.confidenceScore >= 58 && nbaAst.confidenceScore <= 72);
assert.ok(goblinHit.edge >= 0.1 && goblinHit.edge <= 2.5);
assert.ok(demonHrr.edge >= -2.5 && demonHrr.edge <= 2.5);
assert.notEqual(goblinHit.confidenceScore, demonHrr.confidenceScore);
assert.notEqual(goblinHit.edge, demonHrr.edge);
assert.equal(goblinHit.bestPick, "over");
assert.equal(demonHrr.bestPick, "under");
assert.ok(goblinHit.whyThisPick.includes("Goblin") || goblinHit.whyThisPick.includes("margin"));
assert.ok(demonHrr.whyThisPick.length > 20);
assert.equal(getManualStatVolatility("MLB", "Hits+Runs+RBIs").tier, "HIGH");
assert.equal(getManualStatVolatility("MLB", "Hits").tier, "LOW");
assert.equal(getManualStatVolatility("MLB", "Pitcher Strikeouts").tier, "LOW");
assert.equal(getManualStatVolatility("NBA", "Assists").tier, "HIGH");
assert.equal(getManualStatVolatility("NBA", "Rebounds").tier, "LOW");

assert.equal(computeDirectionalEdge(5.8, 6.5, "over"), -0.7);
assert.equal(computeDirectionalEdge(5.8, 6.5, "under"), 0.7);
assert.ok(goblinHit.impliedHitChance >= 38 && goblinHit.impliedHitChance <= 88);
assert.ok(goblinHit.volatilityLabel);
assert.equal(goblinHit.scoringModeLabel, "Estimated grade");
assert.ok(goblinHit.confidenceScore <= 85);

const kProjection = projectPitcherStrikeouts(
  { statType: "Pitcher Strikeouts", line: 6.5, sport: "MLB", side: "over" },
  {
    last5Average: 6.3,
    seasonAverage: 5.9,
    hasGameLogs: true,
    source: "MLB StatsAPI game logs",
    statSources: ["MLB"],
    gradingRows: [
      { stat: { strikeOuts: 7, inningsPitched: "6.0", numberOfPitches: 95, gamesStarted: 1 } },
      { stat: { strikeOuts: 6, inningsPitched: "5.2", numberOfPitches: 88, gamesStarted: 1 } },
      { stat: { strikeOuts: 8, inningsPitched: "5.1", numberOfPitches: 91, gamesStarted: 1 } },
    ],
  },
  { opponentContext: { strikeoutsPerGame: 9.1 } }
);
assert.ok(kProjection.projectedValue > 0);
assert.equal(kProjection.projectionLabel, VERIFIED_PROJECTION_LABEL);
assert.ok(kProjection.projectionBreakdown.some((row) => row.label === "Last 5 Avg Ks"));
assert.ok(kProjection.projectionBreakdown.some((row) => row.label === "Season Avg Ks"));
assert.ok(kProjection.projectionBreakdown.some((row) => row.label === "Projected Innings"));
assert.equal(computePitcherEdge(6.2, 6.5, "over"), -0.3);
assert.equal(computePitcherEdge(6.8, 6.5, "over"), 0.3);
const fallbackHit = computePitcherHitChance({ edge: 0.2, volatility: { tier: "LOW" }, confidence: 52, isFallback: true });
assert.ok(fallbackHit >= 35 && fallbackHit <= 65);
const unverifiedK = projectPitcherStrikeouts(
  { statType: "Pitcher Strikeouts", line: 6.5, sport: "MLB" },
  { sparse: true, last5Average: 6.3 }
);
assert.equal(unverifiedK.projectedValue, null);
assert.equal(unverifiedK.projectionLabel, DATA_STATUS.FALLBACK);

const topTwo = selectManualTopPicks([demonHrr, goblinHit, nbaAst], 2);
assert.equal(topTwo.length, 2);
assert.ok(rankManualPropScore(topTwo[0]) >= rankManualPropScore(topTwo[1]));

const analyzedNoScoreFn = await analyzeManualProp({
  playerName: "Shohei Ohtani",
  sport: "MLB",
  statType: "Pitcher Strikeouts",
  line: 6.5,
  side: "over",
  source: "PrizePicks",
  payoutType: "standard",
});
assert.ok(analyzedNoScoreFn.riskLevel === "Low" || analyzedNoScoreFn.riskLevel === "Medium" || analyzedNoScoreFn.riskLevel === "High");
assert.ok(analyzedNoScoreFn.whyThisPick.length > 12);

console.log("Parser smoke tests passed.");
