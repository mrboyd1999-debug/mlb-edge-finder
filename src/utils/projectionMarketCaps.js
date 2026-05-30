/**
 * MLB sport-specific projection bounds — out-of-range projections fail sanity.
 */

import { resolvePropMarketKey } from "./marketNormalization.js";
import { RESEARCH_ONLY_TIER_LABEL } from "./tierHistoricalValidation.js";

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** min/max inclusive bounds by canonical market key. */
export const MLB_PROJECTION_CAPS = {
  totalBases: { min: 0, max: 2.5, label: "Total Bases" },
  hits: { min: 0, max: 2.5, label: "Hits" },
  homeRuns: { min: 0, max: 1, label: "Home Runs" },
  hrr: { min: 0, max: 5, label: "H+R+RBI" },
  strikeouts: { min: 0, max: 12, label: "Strikeouts" },
  hitsAllowed: { min: 0, max: 12, label: "Hits Allowed" },
};

export const SANITY_FAIL_FLAG = "SANITY_FAIL";
export const MISSING_MARKET_KEY_REASON = "Missing market key";

export function resolveMlbProjectionCap(prop = {}) {
  const marketKey = resolvePropMarketKey(prop);
  const cap = marketKey ? MLB_PROJECTION_CAPS[marketKey] || null : null;
  return { marketKey, cap };
}

export function applyMissingMarketKeyFallback(prop = {}, reason = MISSING_MARKET_KEY_REASON) {
  return {
    ...prop,
    marketKey: "",
    projectionSanityFail: true,
    sanityFail: true,
    pickTierLabel: RESEARCH_ONLY_TIER_LABEL,
    bettingLabel: RESEARCH_ONLY_TIER_LABEL,
    displayResearchOnly: true,
    verifiedTier: null,
    verifiedTierLabel: null,
    marketKeyMissing: true,
    enrichmentError: reason,
    projectionSanityAudit: {
      supported: false,
      sanityFail: true,
      missingMarketKey: true,
      blocksTierA: true,
      sanityScore: 0,
      summary: reason,
    },
  };
}

export function validateProjectionAgainstCap(prop = {}, projection = null) {
  const marketKey = resolvePropMarketKey(prop);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);

  if (!marketKey) {
    return {
      marketKey: "",
      cap: null,
      projection: proj,
      inRange: false,
      sanityFail: true,
      missingMarketKey: true,
      reason: MISSING_MARKET_KEY_REASON,
    };
  }

  const cap = MLB_PROJECTION_CAPS[marketKey] || null;

  if (!cap || proj == null) {
    return {
      marketKey,
      cap,
      projection: proj,
      inRange: true,
      sanityFail: false,
      reason: "",
    };
  }

  const inRange = proj >= cap.min && proj <= cap.max;
  const reason = inRange
    ? ""
    : proj > cap.max
      ? `${cap.label} projection ${proj} exceeds max ${cap.max}`
      : `${cap.label} projection ${proj} below min ${cap.min}`;

  return {
    marketKey,
    cap,
    projection: proj,
    inRange,
    sanityFail: !inRange,
    reason,
  };
}
