/**
 * Edge-tier confidence — tiny edges cannot inflate to high confidence.
 */

import { isVerifiedSportsbookProp } from "./propValidation.js";
import {
  hasMatchupContext,
  PROJECTION_QUALITY,
  resolveProjectionQuality,
} from "./projectionQuality.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function hasMeaningfulRecentForm(prop = {}) {
  return (
    Number.isFinite(Number(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate)) ||
    Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) >= 5 ||
    Boolean(prop.sportsDataSeason || prop.sportsDataRecentGames?.length)
  );
}

function edgeBand(edge = 0) {
  const e = Math.max(0, edge);
  if (e <= 0.2) return { min: 50, max: 54, floor: 0, ceiling: 0.2 };
  if (e <= 0.5) return { min: 55, max: 59, floor: 0.2, ceiling: 0.5 };
  if (e <= 0.9) return { min: 60, max: 66, floor: 0.5, ceiling: 0.9 };
  if (e <= 1.4) return { min: 67, max: 74, floor: 0.9, ceiling: 1.4 };
  return { min: 75, max: 85, floor: 1.4, ceiling: 2.5 };
}

function hasFullVerification(prop = {}) {
  return (
    isVerifiedSportsbookProp(prop) &&
    hasMatchupContext(prop) &&
    hasMeaningfulRecentForm(prop) &&
    resolveProjectionQuality(prop) === PROJECTION_QUALITY.VERIFIED
  );
}

/** Confidence derived strictly from signed edge magnitude and verification depth. */
export function computeEdgeBasedConfidence(prop = {}, edge = 0) {
  const e = finiteOr(edge, 0);
  if (e <= 0) return null;

  const band = edgeBand(e);
  const span = Math.max(0.05, band.ceiling - band.floor);
  const progress = Math.min(1, Math.max(0, (Math.min(e, band.ceiling) - band.floor) / span));
  let conf = band.min + progress * (band.max - band.min);

  if (hasMatchupContext(prop)) conf += 0.4;
  if (hasMeaningfulRecentForm(prop)) conf += 0.5;
  if (resolveProjectionQuality(prop) === PROJECTION_QUALITY.VERIFIED) conf += 0.6;
  if (isVerifiedSportsbookProp(prop)) conf += 0.3;

  if (e >= 1.5 && !hasFullVerification(prop)) {
    conf = Math.min(conf, 74);
  }

  conf = Math.min(85, Math.max(band.min, Math.round(conf)));
  return conf;
}
