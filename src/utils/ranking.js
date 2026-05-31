/**
 * Top-board ranking helpers — unique players for Best Plays display.
 */

import { normalizeSource } from "./normalizeSource.js";
import { computeTopPlayFinalScore } from "./bestPlayRankingScore.js";

const PROVIDER_RANK = {
  prizepicks: 3,
  underdog: 2,
  oddsapi: 2,
  sportsdataio: 1,
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function normalizePlayerNameKey(prop = {}) {
  return String(prop.playerName || prop.player || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function providerRank(prop = {}) {
  const src = normalizeSource(prop);
  return PROVIDER_RANK[src] || 1;
}

function compareUniqueTopPlays(a = {}, b = {}) {
  const scoreDiff = finite(computeTopPlayFinalScore(b)) - finite(computeTopPlayFinalScore(a));
  if (scoreDiff !== 0) return scoreDiff;

  const probDiff =
    finite(b.finalProbability ?? b.probabilityScore ?? b.verifiedProbability) -
    finite(a.finalProbability ?? a.probabilityScore ?? a.verifiedProbability);
  if (probDiff !== 0) return probDiff;

  const confDiff =
    finite(b.finalConfidence ?? b.displayConfidenceScore ?? b.confidenceScore ?? b.confidence) -
    finite(a.finalConfidence ?? a.displayConfidenceScore ?? a.confidenceScore ?? a.confidence);
  if (confDiff !== 0) return confDiff;

  return providerRank(b) - providerRank(a);
}

/** One highest-ranked prop per player for Top 3 / Top 10 boards. */
export function getUniquePlayerTopPlays(props = [], limit = 10) {
  const bestByPlayer = new Map();

  for (const prop of props || []) {
    const key = normalizePlayerNameKey(prop);
    if (!key) continue;
    const prev = bestByPlayer.get(key);
    if (!prev || compareUniqueTopPlays(prev, prop) > 0) {
      bestByPlayer.set(key, prop);
    }
  }

  return [...bestByPlayer.values()].sort(compareUniqueTopPlays).slice(0, limit);
}
