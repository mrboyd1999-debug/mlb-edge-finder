import { normalizePropShape } from "./propShape.js";
import { normalize } from "./formatters.js";
import { normalizeSportLabel } from "./sportMappings.js";
import {
  mergeManualPropScoring,
  scoreManualPropInput,
  selectManualTopPicksByRank,
  sortManualPropsByRank,
} from "./manualPropScoring.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { buildMlbStatProfileFromLogs } from "../services/playerStats.js";
import { buildMlbPropDataPackage, logMlbData } from "../services/mlbDataService.js";

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
  source: "PrizePicks",
  payoutType: "standard",
};

export function isManualAnalyzerProp(prop = {}) {
  return Boolean(prop?.isManualAnalyzer || prop?.manualAnalyzer);
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
  const data = await buildMlbPropDataPackage(built, {
    buildProfile: (bundle, statType, line) => buildMlbStatProfileFromLogs(bundle, statType, line),
  });
  if (!data.profile) {
    logMlbData("manual.profile.miss", { player: built.playerName, reason: data.reason });
  }
  return { profile: data.profile, built, warnings: data.reason && !data.profile ? [data.reason] : [] };
}

export async function analyzeManualProp(form = {}, scoreFn = null) {
  const validated = validateManualPropFields(form);
  if (!validated.ok) throw new Error(validated.error);

  let profile = null;
  let built = null;
  try {
    const fetched = await fetchManualPropProfile(form);
    profile = fetched.profile;
    built = fetched.built;
  } catch (error) {
    console.warn("[Manual Analyzer] stat fetch failed", error);
  }

  let liveScored = null;
  if (typeof scoreFn === "function") {
    try {
      const prop = built || buildManualPropFromInput({
        ...form,
        ...validated.manualProp,
      });
      liveScored = scoreFn(prop);
    } catch (error) {
      console.warn("[Manual Analyzer] live scoring failed, using dynamic manual scoring", error);
    }
  }

  return buildOfflineManualAnalyzedProp(form, liveScored?.playerName ? liveScored : null, profile);
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
  const id = `${makeManualPropId(form)}|${Date.now()}`;

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
