import { normalizePropShape } from "./propShape.js";
import { normalize } from "./formatters.js";
import { normalizeSportLabel } from "./sportMappings.js";
import {
  mergeManualPropScoring,
  scoreManualPropInput,
  selectManualTopPicksByRank,
  sortManualPropsByRank,
  NO_VERIFIED_GRADE_STATUS,
} from "./manualPropScoring.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { buildMlbStatProfileFromLogs } from "../services/playerStats.js";
import { buildMlbPropDataPackage, logMlbData } from "../services/mlbDataService.js";
import { recordMlbProjectionResult } from "../services/mlbPipelineStatus.js";
import { applyMlbProjectionToProp } from "../modules/mlbProjectionService.js";
import {
  buildCardPipelineDebug,
  getFetchPropTrace,
  MLB_CARD_CODE,
  MLB_FAILURE,
} from "../services/mlbPropPipelineTrace.js";
import { normalizeSportsbookName } from "../services/playerMatcher.js";

export const MANUAL_SOURCES = ["PrizePicks", "Underdog"];

export const MANUAL_PAYOUT_TYPES = [
  { value: "standard", label: "Standard" },
  { value: "goblin", label: "Goblin" },
  { value: "demon", label: "Demon" },
];

export const MANUAL_SIDE_OPTIONS = [
  { value: "over", label: "Over" },
  { value: "under", label: "Under" },
];

export const MLB_STAT_SUGGESTIONS = [
  "Pitcher Strikeouts",
  "Pitching Outs",
  "Hits+Runs+RBIs",
  "Total Bases",
  "Fantasy Score",
  "Hits Allowed",
  "Earned Runs Allowed",
  "Singles",
  "Doubles",
  "Home Runs",
  "Stolen Bases",
  "Walks",
  "Hits",
  "RBIs",
  "Runs",
];

export const DEFAULT_MANUAL_FORM = {
  playerName: "",
  sport: "MLB",
  team: "",
  opponent: "",
  statType: "",
  line: "",
  side: "over",
  source: "PrizePicks",
  payoutType: "standard",
};

export function isManualAnalyzerProp(prop = {}) {
  if (!prop) return false;
  return Boolean(
    prop.isManualAnalyzer ||
      prop.manualAnalyzer ||
      prop.manual === true ||
      prop.mode === "manual" ||
      prop.analyzerSource
  );
}

export function validateManualForm(form = {}) {
  return validateManualPropFields(form).error;
}

/** Normalize form into manualProp with numeric line. Side is engine-determined. */
export function normalizeManualFormInput(form = {}) {
  const numericLine = Number(form.line);
  return {
    playerName: String(form.playerName || "").trim(),
    sport: String(form.sport || "MLB").trim() || "MLB",
    team: String(form.team || "").trim(),
    opponent: String(form.opponent || "").trim(),
    statType: String(form.statType || "").trim(),
    line: numericLine,
    side: normalizeSide(form.side || form.pick || "over"),
    source: form.source === "Underdog" ? "Underdog" : "PrizePicks",
    payoutType: form.payoutType || "standard",
  };
}

/** Validate required manual fields — team/opponent optional. */
export function validateManualPropFields(form = {}) {
  const manualProp = normalizeManualFormInput(form);
  const missing = [];
  if (!manualProp.playerName) missing.push("playerName");
  if (!manualProp.sport) missing.push("sport");
  if (!manualProp.statType) missing.push("statType");
  if (!Number.isFinite(manualProp.line) || manualProp.line <= 0) missing.push("line");
  if (!manualProp.source) missing.push("source");
  if (missing.length) {
    return {
      ok: false,
      error: `Missing required fields: ${missing.join(", ")}`,
      manualProp,
    };
  }
  return { ok: true, error: "", manualProp };
}

export const MANUAL_OFFLINE_REASON =
  "Manual prop analyzed offline using base scoring. API enrichment unavailable.";

export function buildOfflineManualAnalyzedProp(form = {}, liveScored = null, profile = null) {
  const validated = validateManualPropFields(form);
  if (!validated.ok) throw new Error(validated.error);
  const { manualProp } = validated;
  const built = buildManualPropFromInput({
    ...form,
    ...manualProp,
    team: manualProp.team || "",
    opponent: manualProp.opponent || "",
  });
  const imageFields = profile
    ? withPlayerImageUrl({
        ...built,
        playerImage: profile.playerImage,
        playerImageUrl: profile.playerImage,
        mlbId: profile.mlbId || profile.playerId,
        playerId: profile.playerId || profile.mlbId,
      })
    : built;
  const manualScore = scoreManualPropInput(manualProp, liveScored, profile);
  return mergeManualPropScoring(
    {
      ...imageFields,
      player: built.playerName,
      team: manualProp.team || "",
      opponent: manualProp.opponent || "",
      projectionLabel: manualScore.projectionLabel || liveScored?.projectionLabel || "Projection unavailable",
      manualOfflineAnalysis: manualScore.isFallbackProjection ?? (!liveScored?.projectionSource || liveScored?.projectionSource === "missing"),
    },
    manualScore,
    liveScored
  );
}

export async function fetchManualPropProfile(form = {}) {
  const validated = validateManualPropFields(form);
  if (!validated.ok) throw new Error(validated.error);
  const built = buildManualPropFromInput({
    ...form,
    ...validated.manualProp,
  });
  const normalizedName = normalizeSportsbookName(built.playerName);
  console.info("[Manual Analyzer] normalized player name:", normalizedName);

  try {
    const data = await buildMlbPropDataPackage(built, {
      buildProfile: (bundle, statType, line) => buildMlbStatProfileFromLogs(bundle, statType, line),
    });
    if (data.profile) {
      console.info("[Manual Analyzer] matched player result:", {
        matchedPlayer: data.pipelineTrace?.matchedPlayer ?? null,
        playerId: data.pipelineTrace?.playerId ?? null,
        logsCount: data.pipelineTrace?.logsCount ?? 0,
      });
      console.info("[Manual Analyzer] projection value used:", {
        player: built.playerName,
        statType: built.statType,
        line: built.line,
        last5: data.profile.last5Average,
        season: data.profile.seasonAverage,
      });
    } else {
      console.warn("[Manual Analyzer] profile unavailable", {
        reason: data.reason,
        failureCode: data.pipelineTrace?.failureCode,
        matchedPlayer: data.pipelineTrace?.matchedPlayer ?? null,
        playerId: data.pipelineTrace?.playerId ?? null,
      });
    }
    if (!data.profile) {
      logMlbData("manual.profile.miss", { player: built.playerName, reason: data.reason });
    }
    return {
      profile: data.profile,
      built,
      pipelineTrace: data.pipelineTrace || null,
      warnings: data.reason && !data.profile ? [data.reason] : [],
    };
  } catch (error) {
    console.warn("[Manual Analyzer] stat fetch failed", {
      message: error?.message || String(error),
      normalizedName,
    });
    return {
      profile: null,
      built,
      pipelineTrace: {
        normalizedName,
        failureCode: MLB_FAILURE.MLB_API_FAILED,
        failureReason: error?.message || "Load failed",
      },
      warnings: [error?.message || "Load failed"],
    };
  }
}

function pickAuthoritativePipelineTrace({ liveScored = null, pipelineTrace = null, built = null, prop = null } = {}) {
  const candidates = [pipelineTrace, getFetchPropTrace(built || prop), liveScored?.mlbPipelineTrace].filter(Boolean);
  const priority = [
    MLB_FAILURE.PLAYER_NOT_MATCHED,
    MLB_FAILURE.MLB_API_FAILED,
    MLB_FAILURE.EMPTY_GAME_LOGS,
    MLB_FAILURE.INSUFFICIENT_MARKET_LOGS,
    MLB_FAILURE.MISSING_STAT_VALUES,
    MLB_FAILURE.PROJECTION_BUILD_FAILED,
  ];
  for (const code of priority) {
    const match = candidates.find((trace) => trace.failureCode === code);
    if (match) return match;
  }
  return candidates[0] || null;
}

function attachPipelineDebug(prop = {}, { liveScored = null, pipelineTrace = null, built = null } = {}) {
  const isMlb = String(prop.sport || "MLB").toUpperCase() === "MLB";
  if (!isMlb) return prop;

  const trace = pickAuthoritativePipelineTrace({ liveScored, pipelineTrace, built, prop });
  const blockedGrade = Boolean(prop.projectionUnavailable || prop.unverifiedGradeBlocked);
  const projectionUnavailable = Boolean(prop.projectionUnavailable || liveScored?.projectionUnavailable);
  const projection = Number(prop.projectedValue ?? prop.projection ?? liveScored?.projection);
  const hasProjection = Number.isFinite(projection) && projection > 0;

  if (blockedGrade) {
    return {
      ...prop,
      statusMessage: prop.statusMessage || NO_VERIFIED_GRADE_STATUS,
      mlbPipelineTrace: prop.mlbPipelineTrace || trace || null,
      pipelineFailureCode: null,
    };
  }

  if (hasProjection && !projectionUnavailable) {
    return {
      ...prop,
      pipelineFailureCode: liveScored?.pipelineFailureCode || prop.pipelineFailureCode || MLB_CARD_CODE.PROJECTION_SUCCESS,
      pipelineDebugLine: liveScored?.pipelineDebugLine || prop.pipelineDebugLine || null,
      mlbPipelineTrace: liveScored?.mlbPipelineTrace || trace || prop.mlbPipelineTrace || null,
    };
  }

  const debug = buildCardPipelineDebug(trace || {}, {
    normalizedName:
      trace?.normalizedName ||
      liveScored?.mlbPipelineTrace?.normalizedName ||
      normalizeSportsbookName(prop.playerName),
    failureReason:
      trace?.failureReason ||
      liveScored?.mlbPipelineTrace?.failureReason ||
      prop.dataFetchReason ||
      null,
    projectionNotCalled: projectionUnavailable && !trace?.failureCode && !liveScored?.mlbPipelineTrace?.failureCode,
  });

  let failureCode = debug.pipelineFailureCode;
  let failureTrace = debug.mlbPipelineTrace;

  if ((!failureCode || failureCode === MLB_CARD_CODE.PROJECTION_SUCCESS) && projectionUnavailable) {
    failureCode = MLB_CARD_CODE.EMPTY_GAME_LOGS;
    failureTrace = {
      ...(failureTrace || {}),
      failureCode: MLB_FAILURE.EMPTY_GAME_LOGS,
      failureReason: prop.dataFetchReason || trace?.failureReason || "No verified projection produced",
      normalizedName: failureTrace?.normalizedName || normalizeSportsbookName(prop.playerName),
      lastSuccessfulStage: failureTrace?.lastSuccessfulStage || "normalized sportsbook prop",
    };
  }

  if (!failureCode || failureCode === MLB_CARD_CODE.PROJECTION_SUCCESS) return prop;

  const refreshed = buildCardPipelineDebug(failureTrace || {}, {
    normalizedName: failureTrace?.normalizedName || normalizeSportsbookName(prop.playerName),
    failureReason: failureTrace?.failureReason || prop.dataFetchReason || null,
  });

  return {
    ...prop,
    pipelineFailureCode: refreshed.pipelineFailureCode || failureCode,
    pipelineDebugLine: refreshed.pipelineDebugLine || debug.pipelineDebugLine,
    mlbPipelineTrace: refreshed.mlbPipelineTrace || failureTrace,
    statusMessage: refreshed.pipelineFailureCode || failureCode,
    projectionLabel: refreshed.pipelineFailureCode || failureCode,
    scoringModeLabel: refreshed.pipelineFailureCode || failureCode,
  };
}

export async function analyzeManualProp(form = {}, scoreFn = null) {
  const validated = validateManualPropFields(form);
  if (!validated.ok) throw new Error(validated.error);

  let profile = null;
  let built = null;
  let pipelineTrace = null;
  let apiWarning = null;
  try {
    const fetched = await fetchManualPropProfile(form);
    profile = fetched.profile;
    built = fetched.built;
    pipelineTrace = fetched.pipelineTrace;
    apiWarning = fetched.warnings?.[0] || pipelineTrace?.failureReason || null;
  } catch (error) {
    console.warn("[Manual Analyzer] stat fetch failed", error);
    apiWarning = error?.message || "Load failed";
  }

  if (!profile) {
    console.warn("[Manual Analyzer] prop data empty — no stat profile returned", {
      player: form.playerName,
      statType: form.statType,
    });
  }

  let liveScored = null;
  if (typeof scoreFn === "function") {
    try {
      const prop = built || buildManualPropFromInput({
        ...form,
        ...validated.manualProp,
      });
      liveScored = scoreFn(prop, profile);
    } catch (error) {
      console.warn("[Manual Analyzer] live scoring failed, using dynamic manual scoring", error);
    }
  }

  if (profile && !profile.sparse && !profile.fallback && built) {
    const mlbApplied = applyMlbProjectionToProp(built, profile, {
      opponentContext: profile.opponentContext,
      impliedGameTotal: profile.impliedGameTotal,
      weatherNote: profile.weatherNote,
      opponentStarterNote: profile.opponentStarterNote,
    });
    recordMlbProjectionResult({
      ok: Boolean(mlbApplied.isVerifiedProjection && Number.isFinite(mlbApplied.projection)),
      player: built.playerName,
      statType: built.statType,
      projection: mlbApplied.projection,
      error: mlbApplied.projectionUnavailable ? mlbApplied.statusMessage || NO_VERIFIED_GRADE_STATUS : "",
    });
    console.info("[Manual Analyzer] projection value used:", {
      player: built.playerName,
      statType: built.statType,
      line: built.line,
      projection: mlbApplied.projection,
      source: mlbApplied.projectionSource,
      verified: mlbApplied.isVerifiedProjection,
    });
    if (mlbApplied.isVerifiedProjection) {
      liveScored = { ...(liveScored || {}), ...mlbApplied };
    } else if (!liveScored?.projectionSource || liveScored.projectionSource === "missing") {
      liveScored = {
        ...(liveScored || {}),
        ...mlbApplied,
        projectionUnavailable: true,
        unverifiedGradeBlocked: true,
      };
    }
  }

  const analyzed = buildOfflineManualAnalyzedProp(form, liveScored?.playerName ? liveScored : null, profile);
  if (profile && !profile.sparse && !profile.fallback) {
    analyzed.playerMatchVerified = true;
    analyzed.mlbId = profile.mlbId || profile.playerId || analyzed.mlbId;
    analyzed.playerId = profile.playerId || profile.mlbId || analyzed.playerId;
  }
  if (apiWarning && analyzed.projectionUnavailable) {
    analyzed.statusMessage = analyzed.statusMessage || `${NO_VERIFIED_GRADE_STATUS} ${apiWarning}`.trim();
  }

  return attachPipelineDebug(analyzed, { liveScored, pipelineTrace, built });
}

export function normalizeSide(value = "") {
  const key = normalize(value);
  if (key === "over" || key === "more" || key === "higher") return "over";
  if (key === "under" || key === "less" || key === "lower") return "under";
  return "";
}

function payoutFields(payoutType = "standard") {
  const key = normalize(payoutType);
  if (key === "goblin") {
    return { oddsType: "goblin", payoutRole: "goblin", payoutLabel: "Goblin", multiplier: 1 };
  }
  if (key === "demon") {
    return { oddsType: "demon", payoutRole: "demon", payoutLabel: "Demon", multiplier: 1.5 };
  }
  return { oddsType: "standard", payoutRole: "standard", payoutLabel: "Standard", multiplier: 1 };
}

export function makeManualPropId(form = {}) {
  return [
    "manual",
    normalize(form.source),
    normalize(form.playerName),
    normalize(form.statType),
    Number(form.line),
    normalize(form.payoutType || "standard"),
  ].join("|");
}

/** Dedupe key: player + stat + line + source (ignores payout and timestamp). */
export function manualPropIdentityKey(form = {}) {
  const source = form.source === "Underdog" ? "Underdog" : form.source === "PrizePicks" ? "PrizePicks" : form.source || form.platform || "PrizePicks";
  return [
    normalize(source),
    normalizeSportsbookName(form.playerName),
    normalize(form.statType),
    Number(form.line),
  ].join("|");
}

export function buildManualPropFromInput(form = {}) {
  const playerName = String(form.playerName || "").trim();
  const statType = String(form.statType || "").trim();
  const sport =
    normalizeSportLabel(form.sport || "MLB", form.league || "") ||
    String(form.sport || "MLB").trim() ||
    "MLB";
  const line = Number(form.line);
  const platform = form.source === "Underdog" ? "Underdog" : "PrizePicks";
  const payout = payoutFields(form.payoutType);
  const id = form.id || form.editingId || makeManualPropId(form);

  const raw = normalizePropShape(
    {
      id,
      playerName,
      player: playerName,
      sport,
      league: sport,
      team: String(form.team || "").trim(),
      opponent: String(form.opponent || "").trim(),
      statType,
      market: statType,
      propType: statType,
      line,
      platform,
      source: platform,
      lineSourceBadge: "MANUAL",
      isManualAnalyzer: true,
      manualAnalyzer: true,
      manual: true,
      mode: "manual",
      analyzerSource: true,
      sportsbookVerified: true,
      verifiedBadge: "MANUAL",
      enteredAt: new Date().toISOString(),
      ...payout,
    },
    { platform, source: platform, sport }
  );

  return raw;
}

export function sortManualPropsByConfidence(props = []) {
  return sortManualPropsByRank(props);
}

export function selectManualTopPicks(props = [], limit = 2) {
  return selectManualTopPicksByRank(props, limit);
}

export { selectMlbVerifiedBestBets, selectMlbStrongLeans } from "../modules/mlbBestBets.js";
