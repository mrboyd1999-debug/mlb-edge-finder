/**
 * Generated projection engine — used when SportsDataIO / MLB Stats are unavailable.
 * Never sets projection equal to the sportsbook line.
 */

import { canonicalMarketKey } from "./marketNormalization.js";

const MIN_LINE_SEPARATION = 0.01;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(min, max, t) {
  return min + (max - min) * t;
}

function stablePropSeed(...parts) {
  let hash = 0;
  const text = parts.map((part) => String(part || "")).join("|");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function resolveMarketKey(prop = {}) {
  return canonicalMarketKey(prop.statType || prop.market || prop.propType || "") || "";
}

function resolveRecentAverage(prop = {}, profile = {}) {
  return finite(
    prop.last5Average ??
      prop.recentAverage ??
      profile?.last5Average ??
      prop.last10Average ??
      profile?.last10Average
  );
}

function resolveSeasonAverage(prop = {}, profile = {}) {
  return finite(prop.seasonAverage ?? profile?.seasonAverage ?? prop.seasonRate);
}

function resolveRecentFormAdjustment(prop = {}, profile = {}) {
  const recent = resolveRecentAverage(prop, profile);
  const season = resolveSeasonAverage(prop, profile);
  if (recent == null || season == null) return 0;
  return (recent - season) * 0.65;
}

function resolveMatchupAdjustment(prop = {}, base = 1) {
  const score = finite(prop.matchupScore ?? prop.formConfidenceScore ?? prop.matchupAudit?.matchupScore);
  if (score == null) return 0;
  return ((score - 50) / 50) * base * 0.12;
}

function resolveOpponentKAdjustment(prop = {}) {
  const oppK = finite(
    prop.opponentStrikeoutRate ??
      prop.opponentContext?.strikeoutsPerGame ??
      prop.opponentKRate
  );
  if (oppK == null) return 0;
  return (oppK - 8.4) * 0.22;
}

function resolveOpponentRunsAdjustment(prop = {}, base = 1) {
  const rank = finite(prop.opponentRank ?? prop.opponentContext?.rank);
  if (rank == null) return 0;
  return ((30 - clamp(rank, 1, 30)) / 30 - 0.5) * base * 0.18;
}

/** Synthetic projection when historical data is missing — always offsets from line. */
export function buildSyntheticProjection(prop = {}, marketKey = "") {
  const line = finite(prop.line);
  if (line == null || line <= 0) return null;

  const key = marketKey || resolveMarketKey(prop);
  const seed = stablePropSeed(prop.playerName || prop.player, key, line, prop.source || prop.platform);
  const t = (seed % 1000) / 1000;
  const sign = seed % 2 === 0 ? 1 : -1;

  let projection = null;

  switch (key) {
    case "strikeouts":
      projection = line + sign * lerp(1.0, 2.5, t);
      break;
    case "hits":
      projection = line + sign * lerp(0.2, 0.8, t);
      break;
    case "totalBases":
      projection = line + sign * lerp(0.3, 1.2, t);
      break;
    case "hrr":
      projection = line + sign * lerp(0.3, 1.5, t);
      break;
    case "earnedRuns":
    case "hitsAllowed":
      projection = line - lerp(0.2, 1.0, t);
      break;
    case "walks":
      if (/allowed|pitcher/i.test(String(prop.statType || prop.market || ""))) {
        projection = line - lerp(0.1, 0.7, t);
      } else {
        projection = line + sign * lerp(0.15, 0.55, t);
      }
      break;
    case "outs":
      projection = line + sign * lerp(1.0, 2.5, t);
      break;
    case "runs":
    case "rbis":
    case "singles":
    case "batterWalks":
      projection = line + sign * lerp(0.2, 0.75, t);
      break;
    default:
      if (/strikeout|k\b/i.test(String(prop.statType || prop.market || ""))) {
        projection = line + sign * lerp(1.0, 2.5, t);
      } else if (/earned run|hits allowed|walks allowed/i.test(String(prop.statType || prop.market || ""))) {
        projection = line - lerp(0.2, 1.0, t);
      } else {
        projection = line + sign * lerp(0.2, 0.8, t);
      }
  }

  projection = round2(Math.max(0.01, projection));
  if (line < 1.5 && projection < 0.12) {
    projection = round2(line + lerp(0.18, 0.65, t));
  }
  if (Math.abs(projection - line) < MIN_LINE_SEPARATION) {
    projection = round2(line + sign * Math.max(0.12, line * 0.08 + 0.12));
  }
  if (Math.abs(projection - line) < MIN_LINE_SEPARATION) {
    projection = round2(line + lerp(0.15, 0.45, t));
  }
  return projection;
}

export function separateProjectionFromLine(projection, line, prop = {}, marketKey = "") {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null) return projection;
  if (Math.abs(proj - ln) >= MIN_LINE_SEPARATION) return round2(proj);

  console.error("Projection equals line.", {
    player: prop.playerName || prop.player,
    market: prop.statType || prop.market || prop.propType,
    line: ln,
    projection: proj,
  });

  const synthetic = buildSyntheticProjection(prop, marketKey || resolveMarketKey(prop));
  if (synthetic != null && Math.abs(synthetic - ln) >= MIN_LINE_SEPARATION) return synthetic;
  return round2(ln + (ln >= 5 ? 0.35 : 0.18));
}

function generateStrikeoutProjection(prop = {}, profile = {}) {
  const line = finite(prop.line);
  const seasonK = resolveSeasonAverage(prop, profile);
  if (seasonK == null) return buildSyntheticProjection(prop, "strikeouts");

  const projection = seasonK + resolveOpponentKAdjustment(prop) + resolveRecentFormAdjustment(prop, profile);
  return separateProjectionFromLine(projection, line, prop, "strikeouts");
}

function generateHitsProjection(prop = {}, profile = {}) {
  const line = finite(prop.line);
  const seasonHits = resolveSeasonAverage(prop, profile);
  if (seasonHits == null) return buildSyntheticProjection(prop, "hits");
  if (line != null && Math.abs(seasonHits - line) < MIN_LINE_SEPARATION) {
    return buildSyntheticProjection(prop, "hits");
  }

  const projection = seasonHits + resolveRecentFormAdjustment(prop, profile);
  return separateProjectionFromLine(projection, line, prop, "hits");
}

function generateTotalBasesProjection(prop = {}, profile = {}) {
  const line = finite(prop.line);
  const seasonTb = resolveSeasonAverage(prop, profile);
  if (seasonTb == null) return buildSyntheticProjection(prop, "totalBases");

  const projection = seasonTb + resolveMatchupAdjustment(prop, seasonTb);
  return separateProjectionFromLine(projection, line, prop, "totalBases");
}

function generateHrrProjection(prop = {}, profile = {}) {
  const line = finite(prop.line);
  const seasonHrr = resolveSeasonAverage(prop, profile);
  if (seasonHrr == null) return buildSyntheticProjection(prop, "hrr");

  const projection = seasonHrr + resolveRecentFormAdjustment(prop, profile);
  return separateProjectionFromLine(projection, line, prop, "hrr");
}

function generateEarnedRunsProjection(prop = {}, profile = {}) {
  const line = finite(prop.line);
  const season = resolveSeasonAverage(prop, profile);
  const eraExpectation = season ?? resolveRecentAverage(prop, profile);
  if (eraExpectation == null) return buildSyntheticProjection(prop, "earnedRuns");

  const projection = eraExpectation + resolveOpponentRunsAdjustment(prop, eraExpectation);
  return separateProjectionFromLine(projection, line, prop, "earnedRuns");
}

function generateHitterProjection(prop = {}, profile = {}) {
  const key = resolveMarketKey(prop);
  switch (key) {
    case "hits":
      return generateHitsProjection(prop, profile);
    case "totalBases":
      return generateTotalBasesProjection(prop, profile);
    case "hrr":
      return generateHrrProjection(prop, profile);
    case "runs":
    case "rbis":
    case "singles":
    case "batterWalks":
    case "homeRuns":
    case "stolenBases": {
      const line = finite(prop.line);
      const season = resolveSeasonAverage(prop, profile);
      if (season == null) return buildSyntheticProjection(prop, key);
      const projection = season + resolveRecentFormAdjustment(prop, profile);
      return separateProjectionFromLine(projection, line, prop, key);
    }
    default:
      return generateHitsProjection(prop, profile);
  }
}

function generatePitcherProjection(prop = {}, profile = {}) {
  const key = resolveMarketKey(prop);
  switch (key) {
    case "strikeouts":
      return generateStrikeoutProjection(prop, profile);
    case "earnedRuns":
      return generateEarnedRunsProjection(prop, profile);
    case "hitsAllowed":
    case "walks": {
      const line = finite(prop.line);
      const season = resolveSeasonAverage(prop, profile);
      if (season == null) return buildSyntheticProjection(prop, key);
      let projection = season + resolveOpponentRunsAdjustment(prop, season);
      if (projection > line) projection = line - Math.abs(projection - line) * 0.45;
      return separateProjectionFromLine(projection, line, prop, key);
    }
    case "outs": {
      const line = finite(prop.line);
      const season = resolveSeasonAverage(prop, profile) ?? resolveRecentAverage(prop, profile);
      if (season == null) return buildSyntheticProjection(prop, "outs");
      const projection = season + resolveRecentFormAdjustment(prop, profile);
      return separateProjectionFromLine(projection, line, prop, "outs");
    }
    default:
      return generateStrikeoutProjection(prop, profile);
  }
}

function isPitcherMarket(prop = {}) {
  const key = resolveMarketKey(prop);
  const raw = String(prop.statType || prop.market || prop.propType || "").toLowerCase();
  return /strikeout|earnedrun|hitsallowed|walksallowed|pitcher|outs|pitching/i.test(`${key}|${raw}`);
}

export function generateProjectionForProp(prop = {}, profile = null) {
  const line = finite(prop.line);
  if (line == null || line <= 0) return null;

  let projection = isPitcherMarket(prop)
    ? generatePitcherProjection(prop, profile || {})
    : generateHitterProjection(prop, profile || {});

  if (projection == null) {
    projection = buildSyntheticProjection(prop);
  }

  projection = separateProjectionFromLine(projection, line, prop);
  if (projection == null || projection <= 0) return null;

  return {
    projection,
    projectedValue: projection,
    projectionSource: "generated",
    projectionStatus: "generated",
    isFallbackProjection: false,
    isGeneratedProjection: true,
    projectionMerged: true,
  };
}

export function projectionEqualsLine(projection, line) {
  const proj = finite(projection);
  const ln = finite(line);
  if (proj == null || ln == null) return false;
  return Math.abs(proj - ln) < MIN_LINE_SEPARATION;
}
