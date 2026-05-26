/**
 * Goblin / Demon classification from live platform signals.
 */

import { isDemonProp, isGoblinProp } from "./propLabels.js";
import {
  DEMON_MAX_CONFIDENCE,
  DEMON_MIN_CONFIDENCE,
  GOBLIN_MIN_CONFIDENCE,
} from "./mlbWeightedConfidence.js";
import { computeLiveConfidence } from "./liveConfidenceEngine.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function classifyGoblinDemon(prop = {}) {
  if (prop.isDemoData) return { tier: "demo", role: null };

  const platformGoblin = isGoblinProp(prop) || prop.oddsType === "goblin";
  const platformDemon = isDemonProp(prop) || prop.oddsType === "demon";
  const conf = computeLiveConfidence(prop) ?? finiteOr(prop.confidenceScore ?? prop.confidence, NaN);
  const edge = finiteOr(prop.edge ?? prop.sideEvaluation?.edge, 0);
  const hit10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  const mult = finiteOr(prop.multiplier ?? prop.payout, 1);

  if (
    platformGoblin ||
    (Number.isFinite(conf) && conf >= GOBLIN_MIN_CONFIDENCE && edge >= 0.35 && (!Number.isFinite(hit10) || hit10 >= 0.55))
  ) {
    return { tier: "goblin", role: "goblin", confidence: conf, edge };
  }

  if (
    platformDemon ||
    (Number.isFinite(conf) &&
      conf >= DEMON_MIN_CONFIDENCE &&
      conf <= DEMON_MAX_CONFIDENCE &&
      edge >= 0.85 &&
      mult >= 1.1)
  ) {
    return { tier: "demon", role: "demon", confidence: conf, edge };
  }

  return { tier: "standard", role: null, confidence: conf, edge };
}

export function filterGoblinCandidates(props = []) {
  return (props || [])
    .filter((p) => !p.isDemoData)
    .map((p) => ({ prop: p, ...classifyGoblinDemon(p) }))
    .filter((row) => row.tier === "goblin" || row.role === "goblin")
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || (b.edge || 0) - (a.edge || 0))
    .map((row) => row.prop);
}

export function filterDemonCandidates(props = []) {
  return (props || [])
    .filter((p) => !p.isDemoData)
    .map((p) => ({ prop: p, ...classifyGoblinDemon(p) }))
    .filter((row) => row.tier === "demon" || row.role === "demon")
    .sort((a, b) => (b.edge || 0) - (a.edge || 0) || (b.confidence || 0) - (a.confidence || 0))
    .map((row) => row.prop);
}
