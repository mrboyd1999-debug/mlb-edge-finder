/**
 * Emergency playable MLB board — verification/historical gaps must not empty the UI.
 */

import { buildNormalizedProjectionFallback } from "./pipelineProjectionAttach.js";
import { isVerifiedSportsbookProp } from "./propValidation.js";
import { isFakeOrFallbackProp } from "./livePropRender.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { isGoblinProp, isDemonProp } from "./propLabels.js";
import { withPlayerImageUrl } from "./playerImageFields.js";
import { buildAnalyticsReason } from "./propReasonEngine.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { normalizeSource } from "./normalizeSource.js";

export const EMERGENCY_FALLBACK_NOTICE =
  "Fallback mode: showing highest projected MLB props because verification data is missing.";

export const EMERGENCY_TIER_ELITE = { id: "elite", min: 75, label: "Elite" };
export const EMERGENCY_TIER_STRONG = { id: "strong", min: 68, label: "Strong" };
export const EMERGENCY_TIER_LEAN = { id: "lean", min: 60, label: "Lean" };
export const EMERGENCY_TIER_FALLBACK = { id: "fallback", min: 0, label: "Fallback" };

function resolveProbability(prop = {}) {
  return Number(
    prop.probability ??
      prop.probabilityScore ??
      prop.verifiedProbability ??
      prop.displayProbability ??
      0
  );
}

function resolveConfidence(prop = {}) {
  return Number(prop.confidenceScore ?? prop.confidence ?? prop.finalConfidence ?? 0);
}

function resolveEdge(prop = {}) {
  return Number(prop.edge ?? prop.evScore ?? 0);
}

export function resolveEmergencyTier(prop = {}) {
  const probability = resolveProbability(prop);
  if (probability >= EMERGENCY_TIER_ELITE.min) return EMERGENCY_TIER_ELITE;
  if (probability >= EMERGENCY_TIER_STRONG.min) return EMERGENCY_TIER_STRONG;
  if (probability >= EMERGENCY_TIER_LEAN.min) return EMERGENCY_TIER_LEAN;
  return EMERGENCY_TIER_FALLBACK;
}

export function isEmergencyPlayableProp(prop = {}) {
  if (!prop || isFakeOrFallbackProp(prop)) return false;
  const player = String(prop.playerName || prop.player || "").trim();
  const market = String(prop.statType || prop.market || prop.propType || "").trim();
  const line = Number(prop.line);
  const sport = resolvePropSport(prop);
  if (sport && sport !== "MLB") return false;
  const src = normalizeSource(prop);
  if (src !== "prizepicks" && src !== "underdog") return false;
  return player.length >= 2 && market.length > 0 && Number.isFinite(line) && line > 0;
}

function ensureEmergencyProjection(prop = {}) {
  const projection = Number(prop.projection ?? prop.projectedValue);
  if (Number.isFinite(projection) && projection > 0) return prop;
  return buildNormalizedProjectionFallback(prop);
}

export function compareEmergencyPlayRank(a = {}, b = {}) {
  const verifiedDiff = Number(isVerifiedSportsbookProp(b)) - Number(isVerifiedSportsbookProp(a));
  if (verifiedDiff !== 0) return verifiedDiff;

  const probDiff = resolveProbability(b) - resolveProbability(a);
  if (probDiff !== 0) return probDiff;

  const edgeDiff = Math.abs(resolveEdge(b)) - Math.abs(resolveEdge(a));
  if (edgeDiff !== 0) return edgeDiff;

  return resolveConfidence(b) - resolveConfidence(a);
}

function annotateEmergencyPlay(prop = {}, rank = 0) {
  const tier = resolveEmergencyTier(prop);
  const side = resolvePickSide(prop);
  const recommendedSide =
    side === "OVER" ? "OVER" : side === "UNDER" ? "UNDER" : prop.recommendedSide || "OVER";
  return withPlayerImageUrl({
    ...prop,
    emergencyTier: tier.id,
    emergencyTierLabel: tier.label,
    bestPlayRankLabel: tier.label,
    topMlbPlayRank: rank,
    isEmergencyPlay: true,
    recommendedSide,
    reason:
      prop.analyticsReason ||
      prop.premiumWhySummary ||
      buildAnalyticsReason(prop) ||
      `Projected ${prop.projection ?? prop.projectedValue} vs line ${prop.line}`,
  });
}

function buildUniquePlayerPicks(pool = [], limit = 4) {
  const out = [];
  const seen = new Set();
  for (const prop of pool) {
    if (out.length >= limit) break;
    const key = String(prop.playerName || prop.player || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(
      annotateEmergencyPlay(
        {
          ...prop,
          categorySource: "parlayBuilder",
          recommendationType: "4-Man Builder",
        },
        out.length + 1
      )
    );
  }
  return out;
}

export function buildEmergencyMlbBoard(displayProps = []) {
  const prepared = (displayProps || [])
    .filter(isEmergencyPlayableProp)
    .map(ensureEmergencyProjection)
    .sort(compareEmergencyPlayRank);

  const verifiedCount = prepared.filter(isVerifiedSportsbookProp).length;
  const fallbackNotice = verifiedCount === 0 && prepared.length ? EMERGENCY_FALLBACK_NOTICE : "";

  const top10 = prepared.slice(0, 10).map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const goblins = prepared
    .filter(isGoblinProp)
    .slice(0, 6)
    .map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const demons = prepared
    .filter(isDemonProp)
    .slice(0, 6)
    .map((prop, index) => annotateEmergencyPlay(prop, index + 1));
  const builder = buildUniquePlayerPicks(prepared, 4);

  return {
    sections: [
      {
        id: "top-10-best-plays",
        title: "Top 10 MLB Plays",
        eyebrow: "Verified first · then probability · edge · confidence",
        picks: top10,
        emptyMessage: prepared.length ? "" : "No MLB props loaded from PrizePicks or Underdog.",
        fallbackNotice,
      },
      {
        id: "top-goblins",
        title: "Top 6 Goblins",
        eyebrow: "Safer payout lines · PrizePicks & Underdog",
        picks: goblins,
        emptyMessage: goblins.length ? "" : "No goblin lines available right now.",
      },
      {
        id: "top-demons",
        title: "Top 6 Demons",
        eyebrow: "Higher payout lines · PrizePicks & Underdog",
        picks: demons,
        emptyMessage: demons.length ? "" : "No demon lines available right now.",
      },
      {
        id: "four-man-builder",
        title: "Best 4-Man Builder",
        eyebrow: "One prop per player · highest projected edge",
        picks: builder,
        emptyMessage: builder.length ? "" : "Not enough unique players for a 4-man card.",
      },
    ],
    filterDiagnostics: {
      emergencyMode: true,
      poolCount: prepared.length,
      verifiedCount,
      tierCounts: {
        elite: prepared.filter((p) => resolveEmergencyTier(p).id === "elite").length,
        strong: prepared.filter((p) => resolveEmergencyTier(p).id === "strong").length,
        lean: prepared.filter((p) => resolveEmergencyTier(p).id === "lean").length,
        fallback: prepared.filter((p) => resolveEmergencyTier(p).id === "fallback").length,
      },
    },
    usedFallback: verifiedCount === 0 && prepared.length > 0,
    fallbackNotice,
    loadedPropCount: prepared.length,
  };
}
