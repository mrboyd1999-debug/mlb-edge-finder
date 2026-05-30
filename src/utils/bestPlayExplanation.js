/**
 * Best play projection source labels and verified-play explanations.
 */

import { buildHitRateSnapshot, buildProbabilityAudit } from "./modelValidation.js";
import { resolveProjectionSourceLabel, normalizeProjectionSourceKey } from "./projectionQuality.js";
import { classifyVerifiedTier } from "./verifiedTierSystem.js";
import { getSportsDataApiKey } from "../config/apiConfig.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveLean(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  const line = finite(prop.line);
  if (projection == null || line == null || line <= 0) return null;
  if (Math.abs(projection - line) < 0.04) return "PASS";
  return projection > line ? "OVER" : "UNDER";
}

function formatStat(value) {
  if (value == null) return "—";
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "—";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/** User-facing projection source label for Best Plays cards. */
export function formatBestPlayProjectionSource(prop = {}) {
  const sportsDataConfigured = Boolean(getSportsDataApiKey());
  const key = normalizeProjectionSourceKey(prop.projectionSource);
  const fromSportsData = /sportsdata|mlb-verified|player-stats-model|merged/.test(key);

  if (!sportsDataConfigured || !fromSportsData) {
    return "Fallback Projection";
  }

  if (/sportsdata|mlb-verified|player-stats-model|merged/.test(key)) return "SportsDataIO";
  if (/rolling|recent-games|recent|last5|last10|l5|l10|season/.test(key)) return "Rolling Average";
  if (/fallback|estimate|manual|stat-fallback|line-neutral|missing|unavailable/.test(key)) {
    return "Fallback Model";
  }

  const existing = String(prop.projectionSourceLabel || resolveProjectionSourceLabel(prop) || "").trim();
  if (/sportsdata/i.test(existing)) return "SportsDataIO";
  if (/rolling|recent|average|estimated/i.test(existing)) return "Rolling Average";
  if (/fallback|missing|neutral/i.test(existing)) return "Fallback Model";
  return existing || "Rolling Average";
}

function resolveEdgePercent(prop = {}) {
  const direct = finite(prop.edgePercent);
  if (direct != null) return direct;
  const edge = finite(prop.edge);
  const line = finite(prop.line);
  if (edge == null || line == null || line <= 0) return null;
  return Math.round((edge / line) * 100);
}

function buildHitRateReason(prop = {}, lean = null) {
  const hitRate = finite(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate);
  if (hitRate == null) return null;

  const games = Math.max(1, Math.round(hitRate * 10));
  const pct = Math.round(hitRate * 100);
  const direction = lean || resolveLean(prop);

  if (direction === "OVER") {
    return `Player exceeded line in ${games} of last 10 games (${pct}% hit rate).`;
  }
  if (direction === "UNDER") {
    const underGames = Math.max(0, 10 - games);
    const underPct = Math.max(0, 100 - pct);
    return `Player stayed under line in ${underGames} of last 10 games (${underPct}% under rate).`;
  }
  return `Recent hit rate: ${pct}% over last 10 games.`;
}

function buildRollingAverageReason(prop = {}) {
  const line = finite(prop.line);
  const last10 = finite(prop.last10Average ?? prop.recentForm);
  const last5 = finite(prop.last5Average);
  const baseline = last10 ?? last5;
  if (baseline == null || line == null || line <= 0) return null;

  const label = last10 != null ? "Last 10 average" : "Last 5 average";
  if (Math.abs(baseline - line) < 0.05) {
    return `${label} (${formatStat(baseline)}) aligns with the line (${formatStat(line)}).`;
  }
  return `${label} (${formatStat(baseline)}) ${baseline > line ? "exceeds" : "is below"} the line (${formatStat(line)}).`;
}

function buildTierReason(prop = {}) {
  const tier = prop.verifiedTier || classifyVerifiedTier(prop);
  const probability = finite(prop.probabilityScore ?? prop.verifiedProbability);
  const confidence = finite(prop.displayConfidenceScore ?? prop.confidenceScore ?? prop.confidence);
  if (!tier || probability == null || confidence == null) return null;
  return `Passed Tier ${tier} verification (${Math.round(probability)}% probability, ${Math.round(confidence)}% confidence).`;
}

export function buildVerifiedPlayExplanation(prop = {}) {
  const line = finite(prop.line);
  const projection = finite(prop.projection ?? prop.projectedValue);
  const last10 = finite(prop.last10Average ?? prop.recentForm);
  const edgePct = resolveEdgePercent(prop);
  const lean = resolveLean(prop);
  const probabilityAudit = prop.probabilityAudit || buildProbabilityAudit(prop);
  const hitRates = prop.hitRateSnapshot || buildHitRateSnapshot(prop);

  const stats = [];
  if (last10 != null) stats.push(`Last 10 Avg: ${formatStat(last10)}`);
  if (line != null) stats.push(`Line: ${formatStat(line)}`);
  if (projection != null) stats.push(`Projection: ${formatStat(projection)}`);
  if (edgePct != null) stats.push(`Edge: ${edgePct > 0 ? "+" : ""}${edgePct}%`);

  const reason =
    buildHitRateReason(prop, lean) ||
    buildRollingAverageReason(prop) ||
    buildTierReason(prop) ||
    prop.marketContext ||
    "Projection and recent form support this side.";

  const projectionSource = formatBestPlayProjectionSource(prop);
  const probabilityExplanation = probabilityAudit.summary || probabilityAudit.explanationLines?.join(" · ");

  return {
    statsLine: stats.join(" · "),
    reason,
    summary: reason,
    projectionSource,
    projectionSourceLabel: projectionSource,
    probabilityAudit,
    probabilityExplanation,
    hitRates,
  };
}

export function attachBestPlayExplanation(prop = {}) {
  const explanation = buildVerifiedPlayExplanation(prop);
  return {
    ...prop,
    verifiedPlayExplanation: explanation,
    qualifyReason: explanation.summary,
    whyThisPick: explanation.summary,
    projectionSourceLabel: explanation.projectionSource,
  };
}
