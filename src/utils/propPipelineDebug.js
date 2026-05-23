import { canonicalMarketKey } from "./marketNormalization.js";
import { shouldTrackGroupedDebug } from "./devMode.js";
import { sanitizePipelineAuditForMlbOnly, sanitizeDebugInfoForMlbOnly, shouldRecordPipelineDebug } from "./mlbOnlyMode.js";

export const MAX_GROUPED_REJECTIONS = 40;
export const MAX_DECISION_DEBUG_SAMPLES = 20;
const MAX_SLATE_GROUPED = 12;

const EMPTY_REJECTION_BY_STAGE = {
  slate: {},
  approvedMarkets: {},
  active: {},
  preScore: {},
  scoring: {},
  qualification: {},
  display: {},
};

/** Minimal audit shape used when debug helpers fail at runtime. */
export const EMPTY_PIPELINE_AUDIT = Object.freeze({
  fetched: 0,
  normalized: 0,
  upcomingSlate: 0,
  slateExcluded: 0,
  slateExclusionReasons: {},
  active: 0,
  preScoring: 0,
  preScoringTotal: 0,
  scored: 0,
  displayed: 0,
  ready: 0,
  near: 0,
  research: 0,
  filterReasons: {},
  rejectionByStage: { ...EMPTY_REJECTION_BY_STAGE },
  groupedRejections: [],
  scoringDebug: [],
  projectionDebug: [],
  lineMovementDebug: [],
  pipelineCounters: {
    accepted: 0,
    rejected: 0,
    stale: 0,
    cached: 0,
    live: 0,
  },
});

export function createEmptyPipelineAudit() {
  return {
    fetched: 0,
    normalized: 0,
    upcomingSlate: 0,
    slateExcluded: 0,
    slateExclusionReasons: {},
    active: 0,
    preScoring: 0,
    preScoringTotal: 0,
    scored: 0,
    displayed: 0,
    ready: 0,
    near: 0,
    research: 0,
    filterReasons: {},
    rejectionByStage: {
      slate: {},
      approvedMarkets: {},
      active: {},
      preScore: {},
      scoring: {},
      qualification: {},
      display: {},
    },
    groupedRejections: [],
    scoringDebug: [],
    projectionDebug: [],
    lineMovementDebug: [],
    pipelineCounters: {
      accepted: 0,
      rejected: 0,
      stale: 0,
      cached: 0,
      live: 0,
    },
  };
}

export function safeCreateEmptyPipelineAudit() {
  try {
    return createEmptyPipelineAudit();
  } catch {
    return {
      ...EMPTY_PIPELINE_AUDIT,
      filterReasons: {},
      rejectionByStage: { ...EMPTY_REJECTION_BY_STAGE },
      groupedRejections: [],
      slateExclusionReasons: {},
    };
  }
}

function groupedEntryKey({ stage = "", sport = "", market = "", reason = "" }) {
  return [stage, sport, market, reason].join("|");
}

function marketLabelForProp(prop = {}) {
  return String(prop.statType || prop.marketLabel || prop.market || "").trim();
}

function sportLabelForProp(prop = {}) {
  return String(prop.sport || "").trim();
}

function ensureGroupedMap(audit) {
  if (!audit._groupedMap || !(audit._groupedMap instanceof Map)) {
    audit._groupedMap = new Map();
    (audit.groupedRejections || []).forEach((row) => {
      audit._groupedMap.set(groupedEntryKey(row), { ...row });
    });
  }
  return audit._groupedMap;
}

function syncGroupedRejectionsArray(audit, maxEntries = MAX_GROUPED_REJECTIONS) {
  const map = ensureGroupedMap(audit);
  audit.groupedRejections = Array.from(map.values())
    .sort(
      (a, b) =>
        Number(b.count || 0) - Number(a.count || 0) ||
        String(b.latestTimestamp || "").localeCompare(String(a.latestTimestamp || ""))
    )
    .slice(0, maxEntries);
}

export function upsertGroupedDebugEntry(
  audit,
  { stage = "", sport = "", market = "", reason = "" },
  { maxEntries = MAX_GROUPED_REJECTIONS } = {}
) {
  if (!audit || typeof audit !== "object") return;
  if (!shouldRecordPipelineDebug({ sport })) return;
  const map = ensureGroupedMap(audit);
  const key = groupedEntryKey({ stage, sport, market, reason });
  const now = new Date().toISOString();
  const existing = map.get(key);
  if (existing) {
    existing.count = Number(existing.count || 0) + 1;
    existing.latestTimestamp = now;
  } else {
    map.set(key, {
      stage,
      sport,
      market,
      reason,
      count: 1,
      latestTimestamp: now,
    });
  }
  syncGroupedRejectionsArray(audit, maxEntries);
}

export function buildGroupedDebugEntries(
  items = [],
  {
    stage = "",
    sportField = "sport",
    marketField = "statType",
    reasonField = () => "",
    max = MAX_DECISION_DEBUG_SAMPLES,
  } = {}
) {
  const map = new Map();
  items.forEach((item) => {
    if (!shouldRecordPipelineDebug(item)) return;
    const sport = String(item?.[sportField] || "").trim();
    const market = String(item?.[marketField] || "").trim();
    const reason =
      typeof reasonField === "function" ? String(reasonField(item) || "").trim() : String(item?.[reasonField] || "").trim();
    const key = groupedEntryKey({ stage, sport, market, reason });
    const now = new Date().toISOString();
    const row = map.get(key) || { stage, sport, market, reason, count: 0, latestTimestamp: now };
    row.count += 1;
    row.latestTimestamp = now;
    map.set(key, row);
  });
  return Array.from(map.values())
    .sort(
      (a, b) =>
        Number(b.count || 0) - Number(a.count || 0) ||
        String(b.latestTimestamp || "").localeCompare(String(a.latestTimestamp || ""))
    )
    .slice(0, max);
}

export function sortGroupedDebugEntries(entries = [], audit = null) {
  return [...(entries || [])]
    .filter((entry) => Number(entry?.count || 0) > 0 || entry?.reason)
    .sort((a, b) => {
      const countDiff = Number(b.count || 0) - Number(a.count || 0);
      if (countDiff) return countDiff;
      return String(a.stage || "").localeCompare(String(b.stage || ""));
    })
    .map((entry) => ({
      ...entry,
      inactive: Number(entry.count || 0) <= 0,
    }));
}

export function formatGroupedDebugLine(entry = {}, audit = null) {
  const count = Number(entry.count || 0);
  const stage = entry.stage ? String(entry.stage) : "";
  const stagePrefix = stage ? `${stage} • ` : "";
  const reason = entry.reason || "—";
  let suffix = "";

  if (audit && stage) {
    const stageTotal = Object.values(audit.rejectionByStage?.[stage] || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    const stageAccepted = Number(audit[`${stage}Accepted`] || audit[`${stage}Passed`] || 0);
    const acceptanceRate = audit[`${stage}AcceptanceRate`];
    if (Number.isFinite(acceptanceRate) && count > 0) {
      const label = reason.includes("missing") ? "missing stats" : reason.includes("adjusted") ? "adjusted" : "filtered";
      suffix = ` • ${count} ${label} • ${acceptanceRate}% accepted`;
    } else if (stage === "preScore" && stageAccepted > 0 && count > 0) {
      const acceptedPct = Math.round((stageAccepted / (stageAccepted + count)) * 100);
      suffix = ` • ${count} props adjusted • ${acceptedPct}% accepted`;
    } else if (stageTotal > 0 && count > 0) {
      suffix = ` • ${count} ${reason.includes("missing") ? "missing stats" : "filtered"} • ${Math.round((count / stageTotal) * 100)}%`;
    } else if (count > 0) {
      suffix = ` • ${count} ${reason}`;
    }
  } else if (count > 0) {
    suffix = ` • ${count} ${reason}`;
  }

  if (!suffix && count > 0) {
    suffix = ` • ${count} ${reason}`;
  }

  return `${stagePrefix}${entry.sport || "—"} • ${entry.market || "—"}${suffix || ` • ${reason}`}`;
}

export function coercePipelineAudit(audit) {
  const empty = safeCreateEmptyPipelineAudit();
  if (!audit || typeof audit !== "object") return empty;
  const groupedRejections = Array.isArray(audit.groupedRejections)
    ? audit.groupedRejections
    : legacyGroupedRejections(audit);
  const coerced = sanitizePipelineAuditForMlbOnly({
    ...empty,
    ...audit,
    filterReasons: { ...empty.filterReasons, ...(audit.filterReasons || {}) },
    slateExclusionReasons: { ...(audit.slateExclusionReasons || {}) },
    rejectionByStage: {
      ...empty.rejectionByStage,
      ...Object.fromEntries(
        Object.keys(empty.rejectionByStage).map((stage) => [
          stage,
          { ...(empty.rejectionByStage[stage] || {}), ...(audit.rejectionByStage?.[stage] || {}) },
        ])
      ),
    },
    groupedRejections,
    scoringDebug: Array.isArray(audit.scoringDebug) ? audit.scoringDebug : [],
    projectionDebug: Array.isArray(audit.projectionDebug) ? audit.projectionDebug : [],
    lineMovementDebug: Array.isArray(audit.lineMovementDebug) ? audit.lineMovementDebug : [],
  });
  delete coerced._groupedMap;
  delete coerced.filteredSamples;
  delete coerced.slateSamples;
  delete coerced.normalizedSamples;
  return coerced;
}

function legacyGroupedRejections(audit = {}) {
  const legacy = [...(audit.slateSamples || []), ...(audit.filteredSamples || [])];
  if (!legacy.length) return [];
  const map = new Map();
  legacy.forEach((row) => {
    const entry = {
      stage: row.stage || "",
      sport: row.sport || "",
      market: row.market || row.statType || "",
      reason: row.reason || "",
      count: 1,
      latestTimestamp: row.timestamp || row.latestTimestamp || "",
    };
    const key = groupedEntryKey(entry);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, entry);
  });
  return Array.from(map.values()).slice(0, MAX_GROUPED_REJECTIONS);
}

export function createEmptyPipelineStats(audit = null) {
  const coerced = coercePipelineAudit(audit);
  return {
    fetched: coerced.fetched || 0,
    normalized: coerced.normalized || 0,
    upcomingSlate: coerced.upcomingSlate || 0,
    slateExcluded: coerced.slateExcluded || 0,
    active: coerced.active || 0,
    preScoring: coerced.preScoring || 0,
    scored: coerced.scored || 0,
    displayed: coerced.displayed || 0,
    ready: coerced.ready || 0,
    near: coerced.near || 0,
    research: coerced.research || 0,
  };
}

export function createEmptyValidationSummary() {
  return { stages: [], global: [] };
}

export function buildRejectedPropsList(audit = null) {
  return coercePipelineAudit(audit).groupedRejections.slice(0, MAX_GROUPED_REJECTIONS);
}

export function attachDebugArtifacts(debugInfo = {}, audit = null) {
  const coercedAudit = sanitizePipelineAuditForMlbOnly(coercePipelineAudit(audit ?? debugInfo.pipelineAudit));
  const validationSummary = safeFormatRejectionSummary(coercedAudit);
  return sanitizeDebugInfoForMlbOnly({
    ...debugInfo,
    pipelineAudit: coercedAudit,
    rejectedProps: buildRejectedPropsList(coercedAudit),
    pipelineStats: createEmptyPipelineStats(coercedAudit),
    validationSummary,
    qualificationSummary: debugInfo.qualificationSummary || validationSummary,
  });
}

export function safeFormatRejectionSummary(audit = null) {
  try {
    return formatRejectionSummary(coercePipelineAudit(audit));
  } catch {
    return createEmptyValidationSummary();
  }
}

export function bucketFilterReason(reason = "", prop = null) {
  const text = String(reason || "");
  if (text.startsWith("unsupported market:")) {
    const raw = text.slice("unsupported market:".length).trim();
    const key = prop?.marketKey || canonicalMarketKey(prop?.statType || raw);
    const label = key || raw;
    const sport = prop?.sport ? ` (${prop.sport})` : "";
    return `unsupported market: ${label}${sport}`;
  }
  if (text.startsWith("unapproved market:")) {
    const raw = text.slice("unapproved market:".length).trim();
    return `unapproved market: ${raw}`;
  }
  return text;
}

export function groupFilterReasons(filterReasons = {}) {
  const grouped = {};
  Object.entries(filterReasons).forEach(([reason, count]) => {
    const key = reason.startsWith("unsupported market:") ? "unsupported market (grouped)" : reason;
    grouped[key] = (grouped[key] || 0) + count;
  });
  return grouped;
}

export function recordFilterReason(audit, reason, prop, stage = "display") {
  if (!reason || !audit || typeof audit !== "object") return;
  if (!shouldRecordPipelineDebug(prop)) return;
  const bucketedReason = bucketFilterReason(reason, prop);

  audit.filterReasons = audit.filterReasons || {};
  audit.filterReasons[bucketedReason] = (audit.filterReasons[bucketedReason] || 0) + 1;

  audit.rejectionByStage = audit.rejectionByStage || {
    slate: {},
    approvedMarkets: {},
    active: {},
    preScore: {},
    scoring: {},
    qualification: {},
    display: {},
  };
  audit.rejectionByStage[stage] = audit.rejectionByStage[stage] || {};
  audit.rejectionByStage[stage][bucketedReason] = (audit.rejectionByStage[stage][bucketedReason] || 0) + 1;

  if (!shouldTrackGroupedDebug()) return;

  const maxEntries = stage === "slate" ? MAX_SLATE_GROUPED : MAX_GROUPED_REJECTIONS;
  upsertGroupedDebugEntry(
    audit,
    {
      stage,
      sport: sportLabelForProp(prop),
      market: marketLabelForProp(prop),
      reason: bucketedReason,
    },
    { maxEntries: stage === "slate" ? MAX_SLATE_GROUPED : MAX_GROUPED_REJECTIONS }
  );
}

export function recordNormalizedSample() {
  // Intentionally no-op — avoid per-prop normalized debug rows.
}

export function logPipelineAudit(label, audit) {
  try {
    const safeAudit = coercePipelineAudit(audit);
    const topReasons = Object.entries(safeAudit.filterReasons || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const topGrouped = (safeAudit.groupedRejections || []).slice(0, 6).map(formatGroupedDebugLine);
    console.info(`[DFS Pipeline] ${label}`, {
      fetched: safeAudit.fetched,
      normalized: safeAudit.normalized,
      upcomingSlate: safeAudit.upcomingSlate,
      active: safeAudit.active,
      preScoring: safeAudit.preScoring,
      scored: safeAudit.scored,
      displayed: safeAudit.displayed,
      topFilterReasons: topReasons,
      topGroupedRejections: topGrouped,
    });
  } catch (error) {
    console.warn(`[DFS Pipeline] ${label} audit logging failed`, error);
  }
}

export function formatRejectionSummary(audit = {}) {
  try {
    const safeAudit = coercePipelineAudit(audit);
    const stages = ["slate", "approvedMarkets", "active", "preScore", "scoring", "qualification", "display"];
    const lines = [];
    stages.forEach((stage) => {
      const entries = Object.entries(safeAudit.rejectionByStage?.[stage] || {}).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return;
      lines.push(
        `${stage}: ${entries
          .slice(0, 6)
          .map(([reason, count]) => `${reason} (${count})`)
          .join(" · ")}`
      );
    });
    const grouped = (safeAudit.groupedRejections || [])
      .slice(0, 10)
      .map((entry) => `${entry.stage}: ${formatGroupedDebugLine(entry)}`);
    const global = Object.entries(groupFilterReasons(safeAudit.filterReasons || {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => `${reason}: ${count}`);
    return { stages: [...lines, ...grouped], global };
  } catch {
    return createEmptyValidationSummary();
  }
}

export function finalizePipelineCounters(audit = {}, { displayed = [], rejected = 0, stale = 0, cached = 0, live = 0 } = {}) {
  if (!audit || typeof audit !== "object") return audit;
  const accepted = Array.isArray(displayed) ? displayed.length : Number(audit.displayed || 0);
  audit.pipelineCounters = {
    accepted,
    rejected:
      Number(rejected || 0) +
      Number(audit.slateExcluded || 0) +
      Object.values(audit.filterReasons || {}).reduce((sum, n) => sum + Number(n || 0), 0),
    stale: Number(stale || 0),
    cached: Number(cached || 0),
    live: Number(live || accepted),
  };

  const stages = [
    { key: "preScore", input: audit.preScoringTotal || audit.preScoring, output: audit.preScoring },
    { key: "scoring", input: audit.preScoring, output: audit.scored },
    { key: "qualification", input: audit.scored, output: audit.ready },
    { key: "display", input: audit.scored, output: audit.displayed ?? accepted },
  ];
  stages.forEach(({ key, input, output }) => {
    const totalIn = Number(input || 0);
    const passed = Number(output || 0);
    if (totalIn > 0) {
      audit[`${key}Accepted`] = passed;
      audit[`${key}Rejected`] = Math.max(0, totalIn - passed);
      audit[`${key}AcceptanceRate`] = Math.round((passed / totalIn) * 100);
    }
  });

  return audit;
}
