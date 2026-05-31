import { safeParseJSON } from "./safeParseJSON.js";
import { resolveRecommendedSide, resolveFinalTier, resolveTierDisplayLabel } from "./boardQuality.js";
import { resolveVerificationStatus } from "./verificationStatus.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import { formatEdgeDisplay } from "./conservativeProjection.js";
import { displayFullMarketLabel } from "./propLabels.js";

export const SAVED_PICKS_STORAGE_KEY = "mlb_pick_finder_saved_picks";

function normalizeResultStatus(value = "pending") {
  const key = String(value || "pending").toLowerCase();
  if (key === "win" || key === "won") return "won";
  if (key === "loss" || key === "lost") return "lost";
  if (key === "push") return "push";
  return "pending";
}

function tierKey(value = "") {
  const key = String(value || "C").trim().toUpperCase().replace(/^TIER\s*/i, "");
  if (key === "A" || key === "PREMIUM") return "A";
  if (key === "B" || key === "PLAYABLE") return "B";
  return "C";
}

function buildTierRecord(rows = []) {
  const won = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "won").length;
  const lost = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "lost").length;
  const push = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "push").length;
  return { won, lost, push, label: `${won}-${lost}-${push}` };
}

export function buildSavedPickDedupKey(pick = {}) {
  const player = String(pick.playerName || pick.player || "").trim().toLowerCase();
  const market = String(pick.market || pick.statType || pick.propType || "").trim().toLowerCase();
  const line = String(pick.line ?? "").trim();
  const gameTime = String(pick.gameTime || pick.startTime || "").trim().toLowerCase();
  return `${player}|${market}|${line}|${gameTime}`;
}

export function buildSavedPickFromProp(prop = {}) {
  const edgeLabels = prop.rawEdgeLabel
    ? { displayEdgeLabel: prop.displayEdgeLabel }
    : formatEdgeDisplay(prop);
  const projection = resolveProjectionValue(prop);
  const recommended = resolveRecommendedSide(prop);
  const side =
    recommended === "OVER"
      ? "Higher"
      : recommended === "UNDER"
        ? "Lower"
        : prop.bestPick || prop.side || prop.lean || "";
  const gameTime = prop.startTime || prop.gameTime || prop.eventTime || "";
  const matchup = prop.matchup || (prop.team && prop.opponent ? `${prop.team} @ ${prop.opponent}` : "");

  return {
    id: prop.id || `${buildSavedPickDedupKey({ ...prop, gameTime })}|${Date.now()}`,
    savedAt: new Date().toISOString(),
    playerName: prop.playerName || prop.player || "Unknown",
    team: prop.team || prop.playerTeam || "",
    opponent: prop.opponent || prop.opponentTeam || "",
    matchup,
    gameTime,
    market: prop.statType || prop.propType || prop.market || displayFullMarketLabel(prop),
    recommendedSide: side,
    line: prop.line,
    projection: projection ?? prop.projection ?? prop.projectedValue ?? null,
    edge: prop.edge ?? edgeLabels?.displayEdgeLabel ?? null,
    probability: prop.probabilityScore ?? prop.verifiedProbability ?? null,
    confidence: prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence ?? null,
    tier: resolveFinalTier(prop),
    verificationStatus: prop.verificationStatus || resolveVerificationStatus(prop),
    dataSource: prop.platform || prop.source || prop.dataSource || "",
    resultStatus: "pending",
    actualResult: "",
    gradedAt: null,
    propSnapshot: prop,
  };
}

export function readSavedPicks() {
  try {
    const parsed = safeParseJSON(window.localStorage.getItem(SAVED_PICKS_STORAGE_KEY), []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSavedPicks(picks = []) {
  try {
    window.localStorage.setItem(SAVED_PICKS_STORAGE_KEY, JSON.stringify(picks.slice(0, 200)));
  } catch (error) {
    console.warn("[Saved Picks] Could not persist saved picks.", error);
  }
}

export function isSavedPickDuplicate(existing = [], candidate = {}) {
  const key = buildSavedPickDedupKey(candidate);
  return existing.some((row) => buildSavedPickDedupKey(row) === key);
}

export function savePickToStorage(prop = {}) {
  const existing = readSavedPicks();
  const next = buildSavedPickFromProp(prop);
  if (isSavedPickDuplicate(existing, next)) {
    return { picks: existing, saved: false, duplicate: true };
  }
  const picks = [next, ...existing].slice(0, 200);
  writeSavedPicks(picks);
  return { picks, saved: true, duplicate: false, pick: next };
}

export function removeSavedPickById(id = "") {
  const picks = readSavedPicks().filter((row) => row.id !== id);
  writeSavedPicks(picks);
  return picks;
}

export function clearSavedPicks() {
  writeSavedPicks([]);
  return [];
}

export function updateSavedPickResult(id, { resultStatus, actualResult = "" } = {}) {
  const normalized = normalizeResultStatus(resultStatus);
  const picks = readSavedPicks().map((row) => {
    if (row.id !== id) return row;
    return {
      ...row,
      resultStatus: normalized,
      actualResult: actualResult ?? row.actualResult ?? "",
      gradedAt: normalized === "pending" ? null : new Date().toISOString(),
    };
  });
  writeSavedPicks(picks);
  return picks;
}

export function buildSavedPickSummary(picks = []) {
  const rows = picks || [];
  const pending = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "pending").length;
  const won = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "won").length;
  const lost = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "lost").length;
  const push = rows.filter((row) => normalizeResultStatus(row.resultStatus) === "push").length;
  const graded = won + lost;
  const winRate = graded > 0 ? Math.round((won / graded) * 100) : null;

  const tierA = rows.filter((row) => tierKey(row.tier) === "A");
  const tierB = rows.filter((row) => tierKey(row.tier) === "B");
  const tierC = rows.filter((row) => tierKey(row.tier) === "C");

  const last50 = [...rows]
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .slice(0, 50);
  const last50Graded = last50.filter((row) => {
    const status = normalizeResultStatus(row.resultStatus);
    return status === "won" || status === "lost";
  });
  const last50Won = last50Graded.filter((row) => normalizeResultStatus(row.resultStatus) === "won").length;
  const last50WinRate =
    last50Graded.length > 0 ? Math.round((last50Won / last50Graded.length) * 100) : null;

  return {
    total: rows.length,
    pending,
    won,
    lost,
    push,
    winRate,
    hasGradedPicks: graded > 0,
    tierARecord: buildTierRecord(tierA),
    tierBRecord: buildTierRecord(tierB),
    tierCRecord: buildTierRecord(tierC),
    last50WinRate,
    last50Graded: last50Graded.length,
  };
}

export function isPropSaved(prop = {}, savedPicks = []) {
  const key = buildSavedPickDedupKey(buildSavedPickFromProp(prop));
  return (savedPicks || readSavedPicks()).some((row) => buildSavedPickDedupKey(row) === key);
}

export function formatSavedTierLabel(tier = "") {
  return resolveTierDisplayLabel({ tier: tierKey(tier) });
}
