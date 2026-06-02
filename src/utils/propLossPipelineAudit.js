/**
 * Stage-by-stage prop loss audit — tracks why props drop from raw fetch to projection.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import {
  isBlockedNonMlbPipelineProp,
  resolveSupportedMlbMarketKey,
} from "./mlbAllowedMarkets.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { countMergedProjections } from "./projectionCoverageAudit.js";

export const REJECTION_CATEGORY = {
  UNSUPPORTED_MARKET: "REJECTED_BY_UNSUPPORTED_MARKET",
  NORMALIZATION: "REJECTED_BY_NORMALIZATION",
  ALIAS_FAILURE: "REJECTED_BY_ALIAS_FAILURE",
  MERGE: "REJECTED_BY_MERGE",
  PLAYER_LOOKUP: "REJECTED_BY_PLAYER_LOOKUP",
};

const MAX_REJECTION_RECORDS = 500;
const TOP_REASON_LIMIT = 20;

function propLabel(prop = {}) {
  return String(prop.playerName || prop.player || "Unknown").trim() || "Unknown";
}

function marketLabel(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "—").trim() || "—";
}

function dedupeKey(prop = {}) {
  return (
    String(prop.id || "").trim() ||
    `${propLabel(prop)}|${marketLabel(prop)}|${Number(prop.line)}|${String(prop.source || prop.platform || "").trim()}`
  );
}

function pushRejection(audit, { prop, category, reason, stage }) {
  if (!audit) return;
  audit.totalsByCategory[category] = (audit.totalsByCategory[category] || 0) + 1;
  const reasonKey = `${category}::${reason}`;
  audit.reasonCounts[reasonKey] = (audit.reasonCounts[reasonKey] || 0) + 1;

  if (audit.rejectedProps.length < MAX_REJECTION_RECORDS) {
    audit.rejectedProps.push({
      market: marketLabel(prop),
      player: propLabel(prop),
      reason,
      category,
      stage,
    });
  } else {
    audit.truncated = true;
  }
}

export function createEmptyPropLossAudit() {
  return {
    stages: {},
    propsLostByStage: {},
    totalsByCategory: {},
    reasonCounts: {},
    rejectedProps: [],
    truncated: false,
    topRejectionReasons: [],
    finalProjectedCount: 0,
    updatedAt: null,
  };
}

function stageLoss(audit, stageKey, before = 0, after = 0) {
  const lost = Math.max(0, finite(before) - finite(after));
  audit.stages[stageKey] = { before: finite(before), after: finite(after), lost };
  audit.propsLostByStage[stageKey] = lost;
  return lost;
}

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function indexProps(props = []) {
  const map = new Map();
  for (const prop of props || []) {
    if (!prop) continue;
    map.set(dedupeKey(prop), prop);
  }
  return map;
}

/** Compare provider inputs vs merged output — sport filter + dedupe losses. */
export function auditProviderMergeLoss(
  audit,
  { underdogProps = [], prizePicksProps = [], mergedProps = [] } = {}
) {
  const mergedKeys = indexProps(mergedProps);
  const seen = new Set();
  const inputs = [...underdogProps, ...prizePicksProps];

  for (const prop of inputs) {
    const key = dedupeKey(prop);
    if (seen.has(key)) {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.MERGE,
        reason: "duplicate provider line",
        stage: "provider_merge",
      });
      continue;
    }
    seen.add(key);

    if (mergedKeys.has(key)) continue;

    const statType = marketLabel(prop);
    const aliasKey = canonicalMarketKey(statType);
    const supportedKey = resolveSupportedMlbMarketKey(prop);

    if (statType && statType !== "—" && !aliasKey) {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.ALIAS_FAILURE,
        reason: `unmapped stat label: ${statType}`,
        stage: "provider_merge",
      });
      continue;
    }

    if (isBlockedNonMlbPipelineProp(prop)) {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.MERGE,
        reason: "non-MLB sport or blocked stat pattern",
        stage: "provider_merge",
      });
      continue;
    }

    const sport = resolvePropSport(prop);
    if (sport && sport !== "MLB") {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.MERGE,
        reason: `resolved sport ${sport} (MLB-only mode)`,
        stage: "provider_merge",
      });
      continue;
    }

    if (sport !== "MLB") {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.MERGE,
        reason: "could not resolve MLB sport",
        stage: "provider_merge",
      });
      continue;
    }

    pushRejection(audit, {
      prop,
      category: REJECTION_CATEGORY.MERGE,
      reason: "removed during provider merge",
      stage: "provider_merge",
    });
  }
}

/** Normalization drop — raw/scoped props that never reached display pool. */
export function auditNormalizationLoss(audit, { inputProps = [], outputProps = [] } = {}) {
  const outputKeys = indexProps(outputProps);
  for (const prop of inputProps || []) {
    if (outputKeys.has(dedupeKey(prop))) continue;
    pushRejection(audit, {
      prop,
      category: REJECTION_CATEGORY.NORMALIZATION,
      reason: "failed display normalization or shape gate",
      stage: "normalization",
    });
  }
}

/** Board pool hard drops + unsupported market flags. */
export function auditBoardPoolLoss(audit, { inputProps = [], boardPool = {} } = {}) {
  const boardKeys = indexProps(boardPool.boardProps || []);
  const rejectionMap = boardPool.rejections || {};

  const categoryForKey = {
    unsupportedMarket: REJECTION_CATEGORY.UNSUPPORTED_MARKET,
    missingPlayer: REJECTION_CATEGORY.NORMALIZATION,
    missingLine: REJECTION_CATEGORY.NORMALIZATION,
    badLine: REJECTION_CATEGORY.NORMALIZATION,
    missingMarket: REJECTION_CATEGORY.ALIAS_FAILURE,
    duplicate: REJECTION_CATEGORY.MERGE,
    nonMLB: REJECTION_CATEGORY.MERGE,
    unsupportedSport: REJECTION_CATEGORY.MERGE,
  };

  for (const prop of inputProps || []) {
    const key = dedupeKey(prop);
    if (boardKeys.has(key)) {
      if (!resolveSupportedMlbMarketKey(prop)) {
        pushRejection(audit, {
          prop,
          category: REJECTION_CATEGORY.UNSUPPORTED_MARKET,
          reason: `unsupported MLB market: ${marketLabel(prop)}`,
          stage: "market_filter",
        });
      }
      continue;
    }

    const statType = marketLabel(prop);
    if (statType && !canonicalMarketKey(statType)) {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.ALIAS_FAILURE,
        reason: `alias failure: ${statType}`,
        stage: "board_pool",
      });
      continue;
    }

    if (!resolveSupportedMlbMarketKey(prop)) {
      pushRejection(audit, {
        prop,
        category: REJECTION_CATEGORY.UNSUPPORTED_MARKET,
        reason: `unsupported MLB market: ${statType}`,
        stage: "board_pool",
      });
      continue;
    }

    pushRejection(audit, {
      prop,
      category: REJECTION_CATEGORY.NORMALIZATION,
      reason: "dropped by board pool validation",
      stage: "board_pool",
    });
  }

  Object.entries(rejectionMap).forEach(([key, count]) => {
    if (!count) return;
    audit.reasonCounts[`board_pool::${key}`] = finite(count);
    const category = categoryForKey[key] || REJECTION_CATEGORY.NORMALIZATION;
    audit.totalsByCategory[category] =
      (audit.totalsByCategory[category] || 0) + finite(count);
  });
}

/** Projection merge — props without numeric projection after merge/enrichment. */
export function auditProjectionLoss(audit, { props = [], mergeDebug = {} } = {}) {
  const unmatched = mergeDebug?.unmatchedKeys || mergeDebug?.unmatchedSample || [];
  if (Array.isArray(unmatched)) {
    for (const row of unmatched.slice(0, 100)) {
      pushRejection(audit, {
        prop: row?.prop || row,
        category: REJECTION_CATEGORY.PLAYER_LOOKUP,
        reason: row?.reason || "stats map / season row miss",
        stage: "projection_merge",
      });
    }
  }

  for (const prop of props || []) {
    const projection = Number(prop.projection ?? prop.projectedValue);
    if (Number.isFinite(projection) && projection > 0) continue;
    if (!resolveSupportedMlbMarketKey(prop)) continue;

    pushRejection(audit, {
      prop,
      category: REJECTION_CATEGORY.PLAYER_LOOKUP,
      reason: prop.projectionSource
        ? `no projection (${prop.projectionSource})`
        : "no projection formula / player lookup miss",
      stage: "projection_merge",
    });
  }
}

export function buildPropLossPipelineAudit({
  rawUnderdog = 0,
  rawPrizePicks = 0,
  underdogProps = [],
  prizePicksProps = [],
  mergedProps = [],
  scopedRawProps = [],
  normalizedProps = [],
  boardPool = {},
  projectedProps = 0,
  mergeDebug = {},
} = {}) {
  const audit = createEmptyPropLossAudit();
  const rawCombined = finite(rawUnderdog) + finite(rawPrizePicks);
  const mergedCount = Array.isArray(mergedProps) ? mergedProps.length : finite(mergedProps);
  const normalizedCount = Array.isArray(normalizedProps) ? normalizedProps.length : finite(normalizedProps);
  const boardCount = boardPool?.boardProps?.length ?? 0;
  const marketSupported = boardPool?.afterMarketFilter?.length ?? 0;
  const projected = finite(projectedProps) || countMergedProjections(normalizedProps);

  stageLoss(audit, "raw_underdog", rawUnderdog, rawUnderdog);
  stageLoss(audit, "raw_prizepicks", rawPrizePicks, rawPrizePicks);
  stageLoss(audit, "provider_merge", rawCombined || inputsLen(underdogProps, prizePicksProps), mergedCount);
  stageLoss(audit, "normalization", mergedCount, normalizedCount);
  stageLoss(audit, "board_pool", normalizedCount, boardCount);
  stageLoss(audit, "market_supported", boardCount, marketSupported);
  stageLoss(audit, "projected", marketSupported, projected);

  auditProviderMergeLoss(audit, { underdogProps, prizePicksProps, mergedProps: mergedProps || [] });
  auditNormalizationLoss(audit, {
    inputProps: scopedRawProps?.length ? scopedRawProps : mergedProps || [],
    outputProps: normalizedProps || [],
  });
  auditBoardPoolLoss(audit, {
    inputProps: normalizedProps || [],
    boardPool,
  });
  auditProjectionLoss(audit, { props: normalizedProps || [], mergeDebug });

  audit.finalProjectedCount = projected;
  audit.topRejectionReasons = Object.entries(audit.reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REASON_LIMIT)
    .map(([reason, count]) => ({ reason, count }));

  audit.updatedAt = new Date().toISOString();
  return audit;
}

function inputsLen(a = [], b = []) {
  return (a?.length || 0) + (b?.length || 0);
}

export function logPropLossPipelineAudit(audit = {}) {
  console.log("[Prop Loss Audit] Stage totals", audit.stages || {});
  console.log("[Prop Loss Audit] Props lost by stage", audit.propsLostByStage || {});
  console.log("[Prop Loss Audit] Category totals", audit.totalsByCategory || {});
  console.log("[Prop Loss Audit] Top rejection reasons", audit.topRejectionReasons || []);
  console.log("[Prop Loss Audit] Final projected count", audit.finalProjectedCount ?? 0);
  if (audit.truncated) {
    console.warn(`[Prop Loss Audit] Rejection detail truncated at ${MAX_REJECTION_RECORDS} records`);
  }
  if (audit.rejectedProps?.length) {
    console.table(audit.rejectedProps.slice(0, 50));
  }
  return audit;
}
