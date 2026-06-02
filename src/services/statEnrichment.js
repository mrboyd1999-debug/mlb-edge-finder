/**
 * Stat enrichment layer — real logs only; never invent player averages.
 */

import { canonicalMarketKey } from "../utils/marketNormalization.js";
import { computeMlbHitterConfidenceAdjustments, isMlbHitterMarket } from "./mlbHitterConfidence.js";

export const SOURCE_LABELS = {
  line: "PrizePicks line",
  prizepicks: "PrizePicks line",
  underdog: "Underdog line",
  mlb: "MLB stats",
  espn: "ESPN stats",
  sportsdata: "SportsDataIO stats",
  soccer: "Soccer stats",
  tennis: "Tennis stats",
  sportsbook: "Sportsbook comparison",
  history: "Historical hit rate",
  manual: "manual input",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function hasVerifiedStats(profile = {}) {
  if (!profile || profile.fallback || profile.sparse) return false;
  if (profile.manualEnriched) return true;
  const sample = Number(profile.sampleSize || 0);
  const hasAvg =
    Number.isFinite(Number(profile.last5Average)) || Number.isFinite(Number(profile.seasonAverage));
  return sample >= 3 && hasAvg;
}

export function sparseProfileForProp(prop, reason = "stats unavailable") {
  return {
    playerName: prop.playerName,
    playerImage: prop.playerImage || prop.headshot || prop.imageUrl || "",
    sport: prop.sport,
    statType: prop.statType,
    sparse: true,
    fallback: false,
    projection: null,
    projectionSource: "missing",
    source: reason,
    statSources: [prop.platform === "Underdog" ? SOURCE_LABELS.underdog : SOURCE_LABELS.line],
    sampleSize: 0,
    recentHitRate: null,
    last5Average: null,
    seasonAverage: null,
    last5HitRate: null,
    last10HitRate: null,
    volatility: null,
    opponentAllowed: null,
    opponentRank: null,
    hasGameLogs: false,
    hasSeasonAverage: false,
    hasMatchup: false,
    hasRoleContext: false,
  };
}

export function leanSupportsValue(value, line, bestPick) {
  const v = Number(value);
  const ln = Number(line);
  const side = String(bestPick || "").toLowerCase();
  if (!Number.isFinite(v) || !Number.isFinite(ln) || !side) return false;
  if (side === "more" || side === "higher" || side === "over") return v > ln;
  if (side === "less" || side === "lower" || side === "under") return v < ln;
  return false;
}

export function minutesTrendFromGames(games = []) {
  const mins = games
    .slice(0, 10)
    .map((g) => parseMinutes(g.min ?? g.minutes))
    .filter(Number.isFinite);
  if (mins.length < 4) return null;
  const l5 = average(mins.slice(0, 5));
  const prev = average(mins.slice(5, 10));
  if (!Number.isFinite(l5) || !Number.isFinite(prev)) return null;
  const delta = round(l5 - prev, 1);
  if (Math.abs(delta) < 1.5) return { label: "stable minutes", delta, stable: true };
  return { label: delta > 0 ? "minutes trending up" : "minutes trending down", delta, stable: false };
}

export function usageTrendFromGames(games = [], statType = "") {
  const key = canonicalMarketKey(statType);
  const usageValues = games.slice(0, 8).map((g) => {
    const pts = Number(g.pts ?? g.points) || 0;
    const reb = Number(g.reb ?? g.rebounds) || 0;
    const ast = Number(g.ast ?? g.assists) || 0;
    const fga = Number(g.fga ?? g.field_goals_attempted);
    if (key === "pra") return pts + reb + ast;
    if (key === "pr") return pts + reb;
    if (key === "pa") return pts + ast;
    if (key === "assists") return ast;
    if (key === "rebounds") return reb;
    if (key === "points") return pts;
    return fga || pts;
  }).filter(Number.isFinite);
  if (usageValues.length < 4) return null;
  const l3 = average(usageValues.slice(0, 3));
  const prev = average(usageValues.slice(3, 6));
  if (!Number.isFinite(l3) || !Number.isFinite(prev)) return null;
  const delta = round(l3 - prev, 2);
  if (Math.abs(delta) < 0.8) return { label: "usage stable", delta, stable: true };
  return { label: delta > 0 ? "usage trending up" : "usage trending down", delta, stable: false };
}

export function mlbRoleContext(splits = [], statType = "") {
  const type = String(statType).toLowerCase();
  const key = canonicalMarketKey(statType);
  const isPitcher =
    type.includes("strikeout") ||
    type.includes("pitch") ||
    key === "outs" ||
    key === "hitsAllowed" ||
    key === "earnedRuns" ||
    (key === "walks" && type.includes("allow"));
  const recent = splits.slice(0, 5);
  const pitcherStarts = recent.filter((s) => Number(s.stat?.inningsPitched) > 0).length;
  const batterGames = recent.filter((s) => Number(s.stat?.atBats) > 0 || Number(s.stat?.plateAppearances) > 0).length;
  if (isPitcher && pitcherStarts >= 3) return "SP/RP workload in recent logs";
  if (isPitcher && pitcherStarts > 0) return "Limited recent pitching sample";
  if (batterGames >= 3) return "Regular batter plate appearances";
  if (batterGames > 0) return "Partial batter sample";
  return null;
}

export function enrichPlayerProfile(profile = {}, prop = {}, options = {}) {
  const line = Number(prop.line);
  const platform = String(prop.platform || "");
  const sources = uniqueLabels([
    platform === "Underdog" ? SOURCE_LABELS.underdog : SOURCE_LABELS.line,
    mapSourceLabel(profile.source),
    profile.manualEnriched ? SOURCE_LABELS.manual : "",
    ...(profile.statSources || []),
  ]);

  const hasGameLogs = Boolean(profile.hasGameLogs ?? (Number(profile.sampleSize) >= 3 && !profile.fallback && !profile.sparse));
  const hasSeasonAverage = Number.isFinite(Number(profile.seasonAverage));
  const hasPlayerAverage = Number.isFinite(Number(profile.last5Average)) || hasSeasonAverage;
  const hasMatchup = Number.isFinite(Number(profile.opponentAllowed)) || Number.isFinite(Number(profile.opponentRank));
  const hasRoleContext = Boolean(profile.roleContext || profile.pitchCountTrend || profile.usageAdjustment);

  const enrichment = {
    ...profile,
    statSources: sources,
    hasGameLogs,
    hasSeasonAverage,
    hasPlayerAverage,
    hasMatchup,
    hasRoleContext,
    minutesTrend: profile.minutesTrend || options.minutesTrend || null,
    usageTrend: profile.usageTrend || options.usageTrend || null,
    roleContext: profile.roleContext || options.roleContext || null,
    injuryClean: options.injuryClean ?? (prop.injuryRisk === "Low" || !prop.injuryRisk),
    line,
  };

  enrichment.verified = hasVerifiedStats(enrichment);
  return enrichment;
}

export function computeDataQualityFromEnrichment(enrichment = {}, prop = {}) {
  const manual = prop.manualStats || {};
  const hasLine = Number.isFinite(Number(enrichment.line ?? prop.line)) && Number(prop.line) > 0;
  const hasSeasonAverage =
    enrichment.hasSeasonAverage ||
    Number.isFinite(Number(enrichment.seasonAverage)) ||
    Number.isFinite(Number(manual.seasonAverage));
  const hasPlayerAvg =
    enrichment.hasPlayerAverage ||
    hasSeasonAverage ||
    Number.isFinite(Number(manual.last5Average)) ||
    Number.isFinite(Number(manual.seasonAverage));
  const hasLogs =
    enrichment.hasGameLogs ||
    Number(enrichment.sampleSize) >= 3 ||
    Number.isFinite(Number(manual.last5Average));
  const hasMatchup =
    enrichment.hasMatchup ||
    Boolean(manual.matchupNote) ||
    Number.isFinite(Number(manual.opponentAllowed)) ||
    Number.isFinite(Number(manual.opponentRank));
  const hasRoleContext =
    enrichment.hasRoleContext ||
    enrichment.minutesTrend ||
    enrichment.usageTrend ||
    manual.minutesNote ||
    manual.pitchCountNote;
  const injuryRisk = String(prop?.injuryRisk || enrichment.injuryRisk || "").toLowerCase();
  const hasInjuryFeed = Boolean(
    enrichment.injuryFetched ||
      prop?.injuryNote ||
      manual.injuryNote ||
      (injuryRisk && injuryRisk !== "low")
  );
  const hasSportsbookComparison = Boolean(
    enrichment.hasSportsbookComparison || prop.sportsbookComparison || prop.lineComparison
  );
  const sportsbookBooks = Number(
    prop?.sportsbookComparison?.books || enrichment.sportsbookBooks || (hasSportsbookComparison ? 1 : 0)
  );
  const hasHistoricalHitRate =
    Number.isFinite(Number(enrichment.historicalHitRate)) ||
    Number.isFinite(Number(prop.historicalHitRate));
  const manualConfidence = Number(manual.confidenceAdjustment);
  const projectionSource = String(prop?.projectionSource || enrichment.projectionSource || "");
  const edge = Number(prop?.edge);
  const lineScale = Math.max(1, Math.abs(Number(prop?.line || enrichment.line || 1)));
  const edgePct = Number.isFinite(edge) && edge > 0 ? edge / lineScale : 0;
  const movement = prop?.lineMovement || enrichment.lineMovement;

  if (!hasLine) return { score: 0, tier: "none" };

  let score = 20;
  if (prop?.sportsbookVerified || prop?.verifiedBadge === "VERIFIED") score += 4;

  if (hasLogs) {
    score += 10 + Math.min(10, Number(enrichment.sampleSize || 0));
  }
  if (hasSeasonAverage) score += 14;
  else if (hasPlayerAvg) score += 7;

  if (hasMatchup) score += 8 + Math.min(4, Number(enrichment.opponentRank) > 0 ? 2 : 0);
  if (hasRoleContext) score += 6;

  if (hasInjuryFeed) {
    if (injuryRisk === "high") score -= 6;
    else if (injuryRisk === "medium") score -= 2;
    else score += 5;
  }

  if (hasSportsbookComparison) {
    score += sportsbookBooks >= 3 ? 12 : sportsbookBooks >= 2 ? 9 : 6;
  }
  if (prop?.lineComparison || enrichment.hasLineComparison) score += 5;

  if (projectionSource === "player-stats" || projectionSource === "player-stats-estimate") score += 12;
  else if (projectionSource === "manual-stats") score += 10;
  else if (projectionSource === "sportsbook-market") score += 7;
  else if (projectionSource === "platform-line-comparison") score += 5;

  if (Number.isFinite(edge) && edge > 0) score += clamp(edgePct * 28, 1, 12);

  if (movement?.supportsPick) score += 5;
  else if (movement?.againstPick) score -= 4;

  if (hasHistoricalHitRate) score += 6;
  if (Number.isFinite(manualConfidence)) score += 3;

  if (enrichment.fallback || enrichment.sparse) {
    score = Math.min(score, 48 + (hasSportsbookComparison ? 8 : 0) + (Number.isFinite(edge) && edge > 0 ? 6 : 0));
  }

  const hasFull = hasLogs && hasMatchup && hasRoleContext && hasInjuryFeed;
  const tier =
    hasFull && enrichment.verified
      ? "full"
      : hasLogs && hasMatchup
        ? "logs-matchup"
        : hasLogs
          ? "logs"
          : hasPlayerAvg
            ? "averages"
            : hasSportsbookComparison || projectionSource === "sportsbook-market"
              ? "market"
              : "line-only";
  return { score: clamp(Math.round(score), hasLine ? 22 : 0, 100), tier };
}

export function computeStatConfidenceAdjustments({ profile = {}, prop = {}, bestPick = "", injury = null }) {
  const line = Number(prop.line);
  const side = bestPick || prop.bestPick || "";
  const hasMarketContext =
    Boolean(prop.sportsbookComparison || prop.lineComparison) ||
    prop.projectionSource === "sportsbook-market" ||
    prop.projectionSource === "platform-line-comparison";

  if (isMlbHitterMarket(prop.statType, prop.sport)) {
    if (!hasVerifiedStats(profile) && !profile.manualEnriched) {
      const hitterSparse = computeMlbHitterConfidenceAdjustments({ profile, prop, bestPick: side, injury });
      return {
        ...hitterSparse,
        cap: hasMarketContext ? hitterSparse.cap : 64,
        capReason: hasMarketContext ? hitterSparse.capReason : "No verified MLB hitter logs — market/line signals only.",
      };
    }
    return computeMlbHitterConfidenceAdjustments({ profile, prop, bestPick: side, injury });
  }

  if (!hasVerifiedStats(profile) && !profile.manualEnriched) {
    return {
      formBoost: 0,
      seasonBoost: 0,
      matchupBoost: 0,
      roleBoost: 0,
      injuryBoost: 0,
      cap: hasMarketContext ? null : 64,
      capReason: hasMarketContext ? "" : "No verified player logs — using market/line signals only.",
    };
  }

  let formBoost = 0;
  let seasonBoost = 0;
  let matchupBoost = 0;
  let roleBoost = 0;
  let injuryBoost = 0;

  if (leanSupportsValue(profile.last5Average, line, side)) formBoost = 10;
  else if (Number.isFinite(profile.last5Average)) formBoost = -4;

  if (leanSupportsValue(profile.seasonAverage, line, side)) seasonBoost = 6;
  else if (Number.isFinite(profile.seasonAverage)) seasonBoost = -3;

  if (Number.isFinite(profile.opponentAllowed) && leanSupportsValue(profile.opponentAllowed, line, side)) {
    matchupBoost = 6;
  } else if (Number.isFinite(profile.opponentRank)) {
    const rank = Number(profile.opponentRank);
    if (side.toLowerCase() === "more" && rank >= 22) matchupBoost = 4;
    if (side.toLowerCase() === "less" && rank <= 10) matchupBoost = 4;
  }

  if (profile.minutesTrend?.stable || profile.usageTrend?.stable) roleBoost = 4;
  else if (profile.minutesTrend && !profile.minutesTrend.stable) roleBoost = 1;
  else if (profile.roleContext) roleBoost = 2;
  if (profile.matchupNote && !matchupBoost) matchupBoost = 3;

  const injRisk = injury?.risk || prop.injuryRisk;
  if (injRisk === "Low" || profile.injuryClean) injuryBoost = 3;
  if (injRisk === "High") injuryBoost = -10;
  if (injRisk === "Medium") injuryBoost = -4;

  return { formBoost, seasonBoost, matchupBoost, roleBoost, injuryBoost, cap: null, capReason: "" };
}

export function buildStatsMissingExplanation(research = {}, enrichment = {}) {
  const parts = [];
  if (!enrichment.hasPlayerAverage) parts.push("player averages");
  if (!enrichment.hasGameLogs) parts.push("recent game logs");
  if (!enrichment.hasMatchup) parts.push("opponent matchup");
  if (!enrichment.hasRoleContext && !enrichment.minutesTrend && !enrichment.usageTrend) {
    parts.push("minutes/role or pitch workload context");
  }
  if (!enrichment.injuryClean) parts.push("clean injury/news check");
  const fromResearch = (research.gaps || []).filter(Boolean);
  const merged = uniqueLabels([...parts, ...fromResearch]);
  if (!merged.length) return "";
  return `Stats missing: ${merged.join(", ")}.`;
}

function mapSourceLabel(source = "") {
  const text = String(source).toLowerCase();
  if (text.includes("mlb") || text.includes("statsapi")) return SOURCE_LABELS.mlb;
  if (text.includes("espn")) return SOURCE_LABELS.espn;
  if (text.includes("sportsdata") || text.includes("nba") || text.includes("wnba")) return SOURCE_LABELS.sportsdata;
  if (text.includes("soccer") || text.includes("api-football") || text.includes("sofascore")) return SOURCE_LABELS.soccer;
  if (text.includes("tennis")) return SOURCE_LABELS.tennis;
  if (text.includes("sportsbook")) return SOURCE_LABELS.sportsbook;
  if (text.includes("history")) return SOURCE_LABELS.history;
  if (text.includes("manual")) return SOURCE_LABELS.manual;
  if (text.includes("prizepicks")) return SOURCE_LABELS.prizepicks;
  if (text.includes("underdog")) return SOURCE_LABELS.underdog;
  return "";
}

function uniqueLabels(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function parseMinutes(value) {
  if (value == null) return null;
  const text = String(value);
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":").map(Number);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) return minutes + seconds / 60;
  }
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values = []) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, v) => sum + v, 0) / clean.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
