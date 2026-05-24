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
  const playerName = String(form.playerName || "").trim();
  if (!playerName || playerName.length < 2) return "Enter a player name.";
  const statType = String(form.statType || "").trim();
  if (!statType) return "Enter a stat type.";
  const line = Number(form.line);
  if (!Number.isFinite(line) || line <= 0) return "Enter a valid line greater than 0.";
  const side = normalizeSide(form.side);
  if (!side) return "Select Over or Under.";
  if (!MANUAL_SOURCES.includes(form.source)) return "Source must be PrizePicks or Underdog.";
  return "";
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
  const id = makeManualPropId(form);

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
