/**
 * Clean MLB-only data pipeline with stage validation + explicit failure logging.
 */

import { projectMlbPropBatch } from "./mlbProjectionEngine.js";
import { buildMlbPlayerLookup } from "./playerNormalization.js";
import { attachProjectionToProp, isValidMlbProjectionRow } from "../../models/mlb/projectionModel.js";

const STAGE = {
  FETCH: "FETCH MLB ODDS",
  NORMALIZE: "NORMALIZE PLAYERS",
  MATCH: "MATCH PLAYER IDS",
  STATS: "FETCH REAL MLB STATS",
  PROJECT: "GENERATE PROJECTION",
  EDGE: "CALCULATE EDGE",
  CONFIDENCE: "CALCULATE TRUE CONFIDENCE",
  FILTER: "FILTER VERIFIED PROPS",
  DISPLAY: "DISPLAY RESULTS",
};

function logStage(stage, payload = {}) {
  console.info(`[MLB Pipeline] ${stage}`, payload);
}

export async function runMlbPipeline({
  props = [],
  seasonStats = [],
  statsMap = null,
  options = {},
} = {}) {
  const audit = {
    stages: {},
    failures: [],
    counts: {},
  };

  logStage(STAGE.FETCH, { raw: props.length });
  audit.stages.fetch = props.length;

  const normalized = (props || []).filter((prop) => {
    const player = String(prop.playerName || prop.player || "").trim();
    const line = Number(prop.line);
    return Boolean(player) && Number.isFinite(line) && line > 0;
  });
  logStage(STAGE.NORMALIZE, { normalized: normalized.length, rejected: props.length - normalized.length });
  audit.stages.normalize = normalized.length;

  const playerLookup = buildMlbPlayerLookup(seasonStats);
  const matched = normalized.filter((prop) => {
    const row = playerLookup.byKey?.get(String(prop.playerName || prop.player || "").toLowerCase());
    return Boolean(row) || seasonStats.length === 0;
  });
  logStage(STAGE.MATCH, { matched: matched.length, seasonRows: seasonStats.length });
  audit.stages.match = matched.length;

  logStage(STAGE.STATS, { statsMapSize: statsMap instanceof Map ? statsMap.size : 0, seasonStats: seasonStats.length });
  audit.stages.stats = seasonStats.length;

  const projected = projectMlbPropBatch(normalized, { seasonStats, statsMap, options });
  const withProjection = projected.filter((row) => row.projection != null);
  logStage(STAGE.PROJECT, { projected: withProjection.length, missing: projected.length - withProjection.length });
  audit.stages.project = withProjection.length;

  projected
    .filter((row) => row.projection == null)
    .slice(0, 25)
    .forEach((row) => {
      audit.failures.push({
        stage: STAGE.PROJECT,
        player: row.player,
        statType: row.statType,
        reason: row.meta?.invalidReason || "projection missing",
      });
    });

  const withEdge = withProjection.map((row) => ({
    ...row,
    edge: row.edge ?? (row.projection != null && row.line != null ? Number((row.projection - row.line).toFixed(3)) : null),
  }));
  logStage(STAGE.EDGE, { withEdge: withEdge.length });
  audit.stages.edge = withEdge.length;

  const withConfidence = withEdge.filter((row) => row.confidence != null);
  logStage(STAGE.CONFIDENCE, { withConfidence: withConfidence.length });
  audit.stages.confidence = withConfidence.length;

  const verified = withConfidence.filter((row) => isValidMlbProjectionRow(row) && row.meta?.projectionSource !== "invalid");
  logStage(STAGE.FILTER, { verified: verified.length });
  audit.stages.filter = verified.length;

  const displayProps = normalized.map((prop, index) => {
    const row = projected[index];
    if (!row || row.projection == null) return prop;
    return attachProjectionToProp(prop, row);
  });

  logStage(STAGE.DISPLAY, { display: displayProps.filter((p) => p.projection != null).length });
  audit.counts = {
    raw: props.length,
    normalized: normalized.length,
    withProjections: withProjection.length,
    filtered: verified.length,
    display: displayProps.filter((p) => p.projection != null).length,
  };

  return {
    props: displayProps,
    projected,
    verified,
    audit,
  };
}
