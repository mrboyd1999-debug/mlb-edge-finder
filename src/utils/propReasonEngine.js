/** Build believable analytics copy from enrichment fields — no generic placeholders. */

import { hasMeaningfulEnrichment } from "./mlbConfidenceEngine.js";
import { formatNumber } from "./formatters.js";
import { resolvePickSide } from "./pickRecommendation.js";

function statKind(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").toLowerCase();
}

function isPitcherStat(stat) {
  return /strikeout|pitch|earned run|hit allowed|walk allowed|out recorded|pitch count/i.test(stat);
}

function isBatterStat(stat) {
  return /hit|total base|rbi|run|home run|steal|single|double|triple|walk|h\+r\+rbi/i.test(stat);
}

export function buildAnalyticsReason(prop = {}) {
  const reasons = [];
  const stat = statKind(prop);
  const side = resolvePickSide(prop);
  const profile = prop.profile || {};

  if (isPitcherStat(stat)) {
    const recentK =
      prop.recentStrikeoutAverage ??
      profile.recentStrikeoutAverage ??
      averageFromGames(prop.sportsDataRecentGames, "PitchingStrikeouts");
    if (Number.isFinite(recentK) && recentK > 0) {
      reasons.push(`Pitcher averaging ${formatNumber(recentK)} Ks over recent starts`);
    }

    const oppNote = prop.opponentStrikeoutRate || prop.opponentAllowed || prop.matchupNote;
    if (typeof oppNote === "string" && /strike|%|k rate|whiff|swing/i.test(oppNote)) {
      reasons.push(oppNote.replace(/\.$/, ""));
    } else if (Number(prop.opponentRank) >= 22) {
      reasons.push("Opponent profile leans strikeout-friendly");
    }

    if (/umpire|zone|strike/i.test(String(prop.formNote || prop.matchupNote || ""))) {
      reasons.push(String(prop.formNote || prop.matchupNote).replace(/\.$/, ""));
    }
  }

  if (isBatterStat(stat)) {
    const slug =
      prop.sluggingPct ??
      prop.batterSlugging ??
      profile.sluggingPct ??
      (Number.isFinite(Number(prop.sportsDataSeason?.SluggingPercentage))
        ? Number(prop.sportsDataSeason.SluggingPercentage)
        : null);
    if (Number.isFinite(slug) && slug >= 0.4) {
      const vsHand = /lhp|rhp|left|right/i.test(String(prop.matchupNote || prop.formNote || ""))
        ? ` vs ${prop.matchupNote || prop.formNote}`
        : "";
      reasons.push(`Batter slugging ${slug >= 1 ? slug.toFixed(3) : `.${Math.round(slug * 1000)}`}${vsHand}`.trim());
    }

    const recentHits = prop.recentHitsAverage ?? profile.recentHitsAverage;
    if (Number.isFinite(recentHits) && recentHits > 0 && reasons.length < 2) {
      reasons.push(`Averaging ${formatNumber(recentHits)} ${/total base/i.test(stat) ? "total bases" : "hits"} recently`);
    }
  }

  const weather = prop.weatherNote || "";
  if (/wind|wrigley|blowing|temp|humid|roof/i.test(weather)) {
    reasons.push(weather.replace(/\.$/, ""));
  } else if (/wind out|tailwind|hitter friendly/i.test(String(prop.formNote || ""))) {
    reasons.push(String(prop.formNote).replace(/\.$/, ""));
  }

  const hitRate = prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate;
  if (Number.isFinite(hitRate) && hitRate >= 0.58 && reasons.length < 2) {
    reasons.push(`Line has cleared in ${Math.round(hitRate * 100)}% of recent games`);
  }

  if (prop.matchupNote && reasons.length < 2) {
    const note = String(prop.matchupNote).trim();
    if (note.length > 8 && !reasons.includes(note)) {
      reasons.push(note.replace(/\.$/, ""));
    }
  }

  const edge = Number(prop.edge ?? prop.projectionEdge);
  const projection = Number(prop.projection ?? prop.projectedValue);
  const line = Number(prop.line);
  if (!reasons.length && Number.isFinite(edge) && edge > 0 && Number.isFinite(projection) && Number.isFinite(line)) {
    const dir = side === "UNDER" ? "below" : "above";
    reasons.push(`Model projects ${formatNumber(projection)}, ${dir} the ${formatNumber(line)} line`);
  }

  if (!reasons.length) {
    if (!hasMeaningfulEnrichment(prop)) {
      return "Limited data — confidence reduced.";
    }
    return "";
  }

  return `${reasons.slice(0, 2).join(". ")}.`;
}

function averageFromGames(games = [], field) {
  const values = (games || []).map((row) => Number(row?.[field])).filter(Number.isFinite);
  if (!values.length) return null;
  return values.slice(0, 5).reduce((sum, value) => sum + value, 0) / Math.min(values.length, 5);
}
