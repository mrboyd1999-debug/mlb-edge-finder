import { normalizePropShape } from "./propShape.js";
import { normalize } from "./formatters.js";
import { normalizeSportLabel } from "./sportMappings.js";

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
  "Hits+Runs+RBIs",
  "Total Bases",
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
  "Fantasy Score",
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
  return Boolean(prop?.isManualAnalyzer || prop?.manualAnalyzer);
}

export function validateManualForm(form = {}) {
  return validateManualPropFields(form).error;
}

/** Normalize form into manualProp with numeric line and pick/side. */
export function normalizeManualFormInput(form = {}) {
  const pick = normalizeSide(form.side || form.pick);
  const numericLine = Number(form.line);
  return {
    playerName: String(form.playerName || "").trim(),
    sport: String(form.sport || "MLB").trim() || "MLB",
    team: String(form.team || "").trim(),
    opponent: String(form.opponent || "").trim(),
    statType: String(form.statType || "").trim(),
    line: numericLine,
    side: pick,
    pick,
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
  if (!manualProp.pick) missing.push("pick");
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

export function buildOfflineManualAnalyzedProp(form = {}) {
  const validated = validateManualPropFields(form);
  if (!validated.ok) throw new Error(validated.error);
  const { manualProp } = validated;
  const built = buildManualPropFromInput({
    ...form,
    ...manualProp,
    team: manualProp.team || "",
    opponent: manualProp.opponent || "",
    side: manualProp.pick,
  });
  const numericLine = Number(manualProp.line);
  const lean = manualProp.pick;
  const confidence = lean === "under" ? 67 : 63;

  return {
    ...built,
    player: built.playerName,
    line: numericLine,
    bestPick: lean,
    side: lean,
    pick: lean,
    team: manualProp.team || "",
    opponent: manualProp.opponent || "",
    confidence,
    confidenceScore: confidence,
    calibratedConfidence: confidence,
    riskLevel: "Medium",
    edge: 0.35,
    whyThisPick: MANUAL_OFFLINE_REASON,
    qualificationReason: MANUAL_OFFLINE_REASON,
    premiumWhySummary: MANUAL_OFFLINE_REASON,
    projectionLabel: "Base Feed Projection",
    projectionSource: "manual-offline",
    manualOfflineAnalysis: true,
    isDisplayPlayable: true,
    bettingLabel: "Manual Analyze",
    displayTier: "research",
    dataQualityScore: 42,
    lineSourceBadge: "MANUAL",
    analyzedAt: new Date().toISOString(),
  };
}

export function analyzeManualProp(form = {}, scoreFn = null) {
  const validated = validateManualPropFields(form);
  if (!validated.ok) throw new Error(validated.error);

  if (typeof scoreFn === "function") {
    try {
      const built = buildManualPropFromInput({
        ...form,
        ...validated.manualProp,
        side: validated.manualProp.pick,
      });
      const scored = scoreFn(built);
      if (scored && scored.playerName) {
        const confidence = Number(scored.confidenceScore ?? scored.confidence ?? 0);
        if (confidence > 0) {
          return {
            ...scored,
            team: validated.manualProp.team || scored.team || "",
            opponent: validated.manualProp.opponent || scored.opponent || "",
            whyThisPick: scored.whyThisPick || MANUAL_OFFLINE_REASON,
            manualOfflineAnalysis: Boolean(scored.manualOfflineAnalysis || scored.projectionSource === "missing"),
          };
        }
      }
    } catch (error) {
      console.warn("[Manual Analyzer] live scoring failed, using offline fallback", error);
    }
  }

  return buildOfflineManualAnalyzedProp(form);
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
  const side = normalizeSide(form.side);
  return [
    "manual",
    normalize(form.source),
    normalize(form.playerName),
    normalize(form.statType),
    Number(form.line),
    side,
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
  const side = normalizeSide(form.side);
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
      side,
      pick: side,
      bestPick: side,
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
  return [...(props || [])].sort((a, b) => {
    const confDiff = Number(b.confidenceScore ?? b.confidence ?? 0) - Number(a.confidenceScore ?? a.confidence ?? 0);
    if (confDiff !== 0) return confDiff;
    return Number(b.edge ?? 0) - Number(a.edge ?? 0);
  });
}

export function selectManualTopPicks(props = [], limit = 2) {
  return sortManualPropsByConfidence(props).slice(0, Math.max(0, limit));
}
