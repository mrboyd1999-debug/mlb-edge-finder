/**
 * Unified live prop shape for all sportsbook sources.
 */

import { normalizeSource } from "./normalizeSource.js";
import { resolvePickSide } from "./pickRecommendation.js";
import { computeEdgeBasedConfidence } from "./mlbEdgeConfidence.js";
import { resolveProjectionValue } from "./projectionQuality.js";
import { isGoblinProp, isDemonProp } from "./propLabels.js";

function finiteOr(value, fallback = NaN) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function resolvePayoutTier(prop = {}) {
  if (prop.isDemoData) return "demo";
  if (isGoblinProp(prop) || prop.oddsType === "goblin" || prop.payoutRole === "goblin") return "goblin";
  if (isDemonProp(prop) || prop.oddsType === "demon" || prop.payoutRole === "demon") return "demon";
  const mult = finiteOr(prop.multiplier ?? prop.payout, NaN);
  if (Number.isFinite(mult) && mult > 1 && mult < 1.15) return "goblin";
  if (Number.isFinite(mult) && mult >= 1.15) return "demon";
  return "standard";
}

export function normalizeUnifiedProp(prop = {}, evaluation = null) {
  const side = evaluation?.recommendedSide || resolvePickSide(prop);
  const pickType =
    side === "UNDER" ? "under" : side === "OVER" ? "over" : String(prop.side || prop.pick || "").toLowerCase() || "pass";
  const projection = resolveProjectionValue(prop);
  const edge = finiteOr(evaluation?.edge ?? prop.edge, 0);
  const confidence =
    evaluation?.confidence ??
    prop.confidenceScore ??
    prop.confidence ??
    (edge > 0 ? computeEdgeBasedConfidence(prop, edge) : null);

  return {
    id: prop.id || `${prop.playerName}|${prop.statType}|${prop.line}|${prop.source}`,
    player: prop.playerName || prop.player || "Unknown",
    team: prop.team || "",
    opponent: prop.opponent || "",
    statType: prop.statType || prop.market || prop.propType || "",
    line: finiteOr(prop.line, null),
    projection,
    edge: edge > 0 ? edge : null,
    confidence,
    platform: normalizeSource(prop) || prop.platform || prop.source || "",
    pickType,
    gameTime: prop.startTime || prop.gameTime || prop.commenceTime || "",
    payoutTier: resolvePayoutTier(prop),
    isLive: !prop.isDemoData && Boolean(prop.platform || prop.source),
    isDemoData: Boolean(prop.isDemoData),
    _raw: prop,
  };
}

export function normalizeUnifiedProps(props = [], enrichFn = null) {
  return (props || []).map((prop) => {
    const enriched = enrichFn ? enrichFn(prop) : prop;
    const evaluation = enriched.sideEvaluation || null;
    const unified = normalizeUnifiedProp(enriched, evaluation);
    return { ...enriched, unifiedProp: unified };
  });
}

export function countLiveUnifiedProps(props = []) {
  return (props || []).filter((p) => !p.isDemoData && !p.unifiedProp?.isDemoData).length;
}
