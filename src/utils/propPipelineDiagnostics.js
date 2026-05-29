/**
 * End-to-end prop pipeline diagnostics — console + UI counters.
 */

import { groupFilterReasons } from "./propPipelineDebug.js";
import { passesVerifiedBestPlaysFilter } from "./bestPlaysPipelineDebug.js";
import { PICK_TIER_VERIFIED } from "./conservativeProjection.js";

const SAMPLE_LIMIT = 3;

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function topReasons(map = {}, limit = 5) {
  return Object.entries(map || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([reason, count]) => `${reason} (${count})`);
}

function countProjectedProps(props = []) {
  return (props || []).filter((prop) => {
    const projection = Number(prop?.projection ?? prop?.projectedValue);
    return Number.isFinite(projection) && projection > 0;
  }).length;
}

function countVerifiedProps(props = []) {
  return (props || []).filter(
    (prop) =>
      prop?.pickTierLabel === PICK_TIER_VERIFIED &&
      passesVerifiedBestPlaysFilter(prop) &&
      !prop?.displayResearchOnly
  ).length;
}

function providerSamples(provider = "", debugInfo = {}) {
  const source = debugInfo?.sources?.[provider] || debugInfo?.sources?.[provider === "prizepicks" ? "PrizePicks" : "Underdog"];
  const fromWindow =
    typeof window !== "undefined"
      ? window.__DEBUG_RESPONSES__?.[provider]?.samples ||
        (window.__DEBUG_RESPONSES__?.[provider]?.firstRawObject
          ? [window.__DEBUG_RESPONSES__[provider].firstRawObject]
          : [])
      : [];
  const parsed = source?.sampleProps || source?.samples || fromWindow;
  return Array.isArray(parsed) ? parsed.slice(0, SAMPLE_LIMIT) : parsed ? [parsed].slice(0, SAMPLE_LIMIT) : [];
}

export function createEmptyPipelineDiagnostics() {
  return {
    updatedAt: "",
    raw: 0,
    normalized: 0,
    projected: 0,
    verified: 0,
    rendered: 0,
    prizepicksFetch: 0,
    underdogFetch: 0,
    fallbackMode: null,
    bottleneckStage: null,
    failureReason: "",
    rejectionReasons: {},
    providerSamples: {},
    consoleLabel: "PIPELINE",
  };
}

function diagnoseBottleneck({
  raw = 0,
  normalized = 0,
  projected = 0,
  verified = 0,
  rendered = 0,
  pipelineAudit = {},
  debugInfo = {},
  providers = {},
  filterDiagnostics = null,
} = {}) {
  const rejectionReasons = {
    ...groupFilterReasons(pipelineAudit?.filterReasons || {}),
    ...(filterDiagnostics?.invalidReasons || {}),
  };

  if (raw === 0) {
    const ppMsg = providers.prizepicks?.message || debugInfo?.sources?.PrizePicks?.message || "no data";
    const udMsg = providers.underdog?.message || debugInfo?.sources?.Underdog?.message || "no data";
    const samples = [
      ...(providers.prizepicks?.samples || []),
      ...(providers.underdog?.samples || []),
    ].slice(0, SAMPLE_LIMIT);
    return {
      stage: "fetch",
      reason: `No raw props after provider merge. PrizePicks: ${providers.prizepicks?.fetchCount ?? 0} (${ppMsg}). Underdog: ${providers.underdog?.fetchCount ?? 0} (${udMsg}).`,
      rejectionReasons,
      samples,
    };
  }

  if (normalized === 0 && raw > 0) {
    const reasons = topReasons(rejectionReasons);
    const stageReasons = topReasons(pipelineAudit?.rejectionByStage?.slate || {}, 3);
    const detail = reasons.length ? reasons.join(" · ") : stageReasons.join(" · ") || "normalization dropped all props";
    return {
      stage: "normalize",
      reason: `Raw ${raw} props but normalized 0 — ${detail}`,
      rejectionReasons,
      samples: (debugInfo?.rejectionSamples || []).slice(0, SAMPLE_LIMIT),
    };
  }

  if (projected === 0 && normalized > 0) {
    const projectionReason =
      debugInfo?.statsEnrichmentError ||
      debugInfo?.projectionProvider?.statusMessage ||
      debugInfo?.projectionMerge?.failureReason ||
      pipelineAudit?.projectionDebug?.[0]?.reason ||
      "projection merge or scoring produced zero projections";
    return {
      stage: "project",
      reason: `Normalized ${normalized} props but projected 0 — ${projectionReason}`,
      rejectionReasons,
      samples: (allDisplayPropsSample(debugInfo) || []).slice(0, SAMPLE_LIMIT),
    };
  }

  if (verified === 0 && projected > 0) {
    const filterReasons = topReasons(filterDiagnostics?.invalidReasons || rejectionReasons, 4);
    const detail = filterReasons.length
      ? filterReasons.join(" · ")
      : "no props passed verified-play thresholds (confidence, probability, data quality, matchup)";
    return {
      stage: "verify",
      reason: `Projected ${projected} props but verified 0 — ${detail}`,
      rejectionReasons,
      samples: [],
    };
  }

  if (rendered === 0 && normalized > 0) {
    return {
      stage: "render",
      reason: `Normalized ${normalized} props but rendered 0 — props failed minimal render checks or were filtered as fallback/demo`,
      rejectionReasons,
      samples: [],
    };
  }

  return { stage: null, reason: "", rejectionReasons, samples: [] };
}

function allDisplayPropsSample(debugInfo = {}) {
  const sample = debugInfo?.displayDebugCounts?.sample || debugInfo?.rejectionSamples;
  return Array.isArray(sample) ? sample : [];
}

export function buildPipelineDiagnostics({
  rawProps = [],
  allDisplayProps = [],
  scoredProps = [],
  acceptedPropsForRender = [],
  liveRenderCounts = {},
  pipelineAudit = {},
  debugInfo = {},
  prizePicksResult = null,
  underdogResult = null,
  filterDiagnostics = null,
  pipelineFallback = false,
} = {}) {
  const raw = finiteCount(rawProps?.length ?? pipelineAudit?.fetched);
  const normalized = finiteCount(
    allDisplayProps?.length ?? pipelineAudit?.normalized ?? liveRenderCounts?.normalized
  );
  const projected = finiteCount(
    countProjectedProps(scoredProps?.length ? scoredProps : allDisplayProps) ?? pipelineAudit?.scored
  );
  const verified = finiteCount(
    filterDiagnostics?.pipelineCounts?.filtered ??
      countVerifiedProps(scoredProps?.length ? scoredProps : allDisplayProps)
  );
  const rendered = finiteCount(
    acceptedPropsForRender?.length ?? liveRenderCounts?.rendered ?? pipelineAudit?.displayed
  );

  const prizepicksFetch = finiteCount(
    prizePicksResult?.props?.length ??
      debugInfo?.sources?.PrizePicks?.propsAfterParsing ??
      debugInfo?.providerFetchCounts?.prizepicks
  );
  const underdogFetch = finiteCount(
    underdogResult?.parsedProps?.length ??
      underdogResult?.props?.length ??
      debugInfo?.sources?.Underdog?.propsAfterParsing ??
      debugInfo?.providerFetchCounts?.underdog
  );

  const providers = {
    prizepicks: {
      fetchCount: prizepicksFetch,
      message:
        prizePicksResult?.warnings?.[0] ||
        debugInfo?.sources?.PrizePicks?.message ||
        debugInfo?.sources?.PrizePicks?.status ||
        "",
      samples: providerSamples("prizepicks", debugInfo),
    },
    underdog: {
      fetchCount: underdogFetch,
      message:
        underdogResult?.warnings?.[0] ||
        debugInfo?.sources?.Underdog?.message ||
        debugInfo?.sources?.Underdog?.status ||
        "",
      samples: providerSamples("underdog", debugInfo),
    },
  };

  const fallbackMode = pipelineFallback ? debugInfo?.ingestionFallback || "fallback" : null;
  const bottleneck = diagnoseBottleneck({
    raw,
    normalized,
    projected,
    verified,
    rendered,
    pipelineAudit,
    debugInfo,
    providers,
    filterDiagnostics,
  });

  const snapshot = {
    updatedAt: new Date().toISOString(),
    raw,
    normalized,
    projected,
    verified,
    rendered,
    fetched: raw,
    withProjections: projected,
    prizepicksFetch,
    underdogFetch,
    fallbackMode,
    bottleneckStage: bottleneck.stage,
    failureReason: bottleneck.reason,
    rejectionReasons: bottleneck.rejectionReasons,
    providerSamples: {
      prizepicks: providers.prizepicks.samples,
      underdog: providers.underdog.samples,
    },
    providers,
    consoleLabel: "PIPELINE",
  };

  if (typeof window !== "undefined") {
    window.__PIPELINE_DIAGNOSTICS__ = snapshot;
  }

  return snapshot;
}

export function logPipelineDiagnostics(snapshot = createEmptyPipelineDiagnostics()) {
  const safe = snapshot || createEmptyPipelineDiagnostics();
  console.group(safe.consoleLabel || "PIPELINE");
  console.log("raw:", safe.raw);
  console.log("normalized:", safe.normalized);
  console.log("projected:", safe.projected);
  console.log("verified:", safe.verified);
  console.log("rendered:", safe.rendered);
  console.log("prizepicks fetch:", safe.prizepicksFetch);
  console.log("underdog fetch:", safe.underdogFetch);
  if (safe.fallbackMode) console.log("fallback mode:", safe.fallbackMode);
  if (safe.failureReason) console.warn("bottleneck:", safe.failureReason);
  if (safe.raw === 0 && (safe.providerSamples?.prizepicks?.length || safe.providerSamples?.underdog?.length)) {
    console.log("provider samples (first 3):", safe.providerSamples);
  }
  if (Object.keys(safe.rejectionReasons || {}).length) {
    console.log("rejection reasons:", safe.rejectionReasons);
  }
  console.groupEnd();
}
