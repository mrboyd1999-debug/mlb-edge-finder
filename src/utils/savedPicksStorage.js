import { safeParseJSON } from "./safeParseJSON.js";
import { resolveRecommendedSide, resolveFinalTier, resolveTierDisplayLabel } from "./boardQuality.js";
import { resolveVerificationStatus } from "./verificationStatus.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import { formatEdgeDisplay } from "./conservativeProjection.js";
import { displayFullMarketLabel } from "./propLabels.js";
import { attachPropDisplayFields, resolveNormalizedConfidence, resolveNormalizedProbability } from "./propDisplayFields.js";

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
  const enriched = attachPropDisplayFields(prop);
  const edgeLabels = enriched.rawEdgeLabel
    ? { displayEdgeLabel: enriched.displayEdgeLabel }
    : formatEdgeDisplay(enriched);
  const projection = resolveProjectionValue(enriched);
  const recommended = resolveRecommendedSide(enriched);
  const side =
    recommended === "OVER"
      ? "Higher"
      : recommended === "UNDER"
        ? "Lower"
        : enriched.bestPick || enriched.side || enriched.lean || "";
  const gameTime = enriched.startTime || enriched.gameTime || enriched.eventTime || "";
  const matchup = enriched.matchup || (enriched.team && enriched.opponent ? `${enriched.team} @ ${enriched.opponent}` : "");
  const confidence = resolveNormalizedConfidence(enriched);
  const probability = resolveNormalizedProbability(enriched);

  return {
    id: enriched.id || `${buildSavedPickDedupKey({ ...enriched, gameTime })}|${Date.now()}`,
    savedAt: new Date().toISOString(),
    playerName: enriched.playerName || enriched.player || "Unknown",
    team: enriched.team || enriched.playerTeam || "",
    opponent: enriched.opponent || enriched.opponentTeam || "",
    matchup,
    gameTime,
    market: enriched.statType || enriched.propType || enriched.market || displayFullMarketLabel(enriched),
    recommendedSide: side,
    line: enriched.line,
    projection: projection ?? enriched.projection ?? enriched.projectedValue ?? null,
    edge: enriched.edge ?? edgeLabels?.displayEdgeLabel ?? null,
    probability,
    confidence,
    risk: enriched.riskLevel || "HIGH",
    tier: resolveFinalTier(enriched),
    verificationStatus: enriched.verificationStatus || resolveVerificationStatus(enriched),
    providerLabel: enriched.providerLabel || "",
    dataSource: enriched.providerLabel || enriched.platform || enriched.source || enriched.dataSource || "",
    resultStatus: "pending",
    actualResult: "",
    gradedAt: null,
    propSnapshot: enriched,
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
