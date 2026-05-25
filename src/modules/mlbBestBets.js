import { isManualPropPlayable, selectManualTopPicksByRank } from "../utils/manualPropScoring.js";
import { isVerifiedRecommendableProp } from "./propSideEngine.js";

export const MLB_BEST_BET_MIN_EDGE = 0.35;
export const MLB_BEST_BET_MIN_CONFIDENCE = 58;

export function isMlbSportProp(prop = {}) {
  return String(prop.sport || prop.league || "").toUpperCase() === "MLB";
}

/** Top verified MLB plays — highest edge with quality gates. */
export function selectMlbVerifiedBestBets(props = [], limit = 2) {
  const pool = (props || []).filter(
    (prop) =>
      isMlbSportProp(prop) &&
      isVerifiedRecommendableProp(prop) &&
      isManualPropPlayable(prop)
  );
  return selectManualTopPicksByRank(pool, limit);
}

export function filterMlbRecommendableProps(props = []) {
  return (props || []).filter((prop) => isMlbSportProp(prop) && isVerifiedRecommendableProp(prop));
}
