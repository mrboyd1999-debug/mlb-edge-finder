/**
 * Provider coverage audit — diagnoses feed drop-off without touching projection math.
 */

import { countMergedProjections } from "./projectionCoverageAudit.js";
import { isSupportedMlbMarket } from "./mlbAllowedMarkets.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { getPrizePicksDiagnostics } from "./prizepicksDiagnostics.js";

function finiteCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function countMlbProps(props = []) {
  return (props || []).filter((prop) => resolvePropSport(prop) === "MLB").length;
}

function countSupportedProps(props = []) {
  return (props || []).filter((prop) => isSupportedMlbMarket(prop)).length;
}

function countProjectedFromList(props = []) {
  return countMergedProjections(props || []);
}

export function diagnoseProviderCoverageGap(audit = {}) {
  const causes = [];
  const ppUsable = finiteCount(audit.prizepicksUsable);
  const udUsable = finiteCount(audit.underdogUsable);
  const combined = finiteCount(audit.combinedUsable);
  const candidates = finiteCount(audit.projectionCandidates);
  const projected = finiteCount(audit.projected);

  if (audit.prizepicksTimedOut && ppUsable === 0) {
    causes.push("A");
  }
  if (ppUsable === 0 && audit.prizepicksUsedCache) {
    causes.push("D");
  }
  if (
    finiteCount(audit.underdogRaw) > finiteCount(audit.underdogParsed) * 2 ||
    audit.underdogParserMismatch
  ) {
    causes.push("B");
  }
  if (combined >= 100 && candidates < Math.min(combined, 100)) {
    causes.push("C");
  }
  if (audit.prizepicksUsedCache || audit.underdogUsedCache) {
    causes.push("D");
  }
  if (ppUsable === 0 && udUsable <= 150 && !audit.prizepicksTimedOut) {
    causes.push("D");
  }
  if (candidates >= 50 && projected < Math.min(50, Math.floor(candidates * 0.2))) {
    causes.push("C");
  }

  const unique = [...new Set(causes)];
  const labels = {
    A: "PrizePicks timeout",
    B: "Underdog parser",
    C: "Overly strict filtering",
    D: "Provider cache issue",
  };

  return {
    codes: unique,
    labels: unique.map((code) => labels[code] || code),
    primary: unique[0] || null,
    summary:
      unique.length === 0
        ? "No obvious provider gap — inspect individual stage counts."
        : unique.map((code) => `${code}) ${labels[code]}`).join(" · "),
  };
}

export function buildProviderCoverageAudit({
  debugInfo = {},
  pipelinePropCountAudit = null,
  prizePicksResult = null,
  underdogResult = null,
  prizePicksProps = [],
  underdogProps = [],
  providerFetchDiagnostics = null,
} = {}) {
  const ppSource = debugInfo.sources?.PrizePicks || {};
  const udSource = debugInfo.sources?.Underdog || {};
  const ppDiag = ppSource.diagnostics || getPrizePicksDiagnostics();
  const udParser = udSource.underdogParser || underdogResult?.debug?.underdogParser || null;
  const ppFetchDiag = providerFetchDiagnostics?.prizepicks || {};

  const prizepicksFetched = finiteCount(
    ppSource.rawPropsLoaded ?? ppDiag.rawPropCount ?? prizePicksResult?.debug?.rawPropsLoaded ?? 0
  );
  const prizepicksParsed = finiteCount(
    ppSource.propsAfterParsing ?? ppDiag.parsedPropsCount ?? prizePicksProps.length ?? 0
  );
  const prizepicksUsable = finiteCount(
    ppSource.usablePropsCount ?? ppDiag.validationCount ?? ppDiag.finalPropsCount ?? countUsableFromProps(prizePicksProps)
  );

  const underdogFetched = finiteCount(
    udSource.rawPropsLoaded ??
      underdogResult?.debug?.rawPropsLoaded ??
      underdogResult?.pipelineAudit?.fetched ??
      udParser?.rawCount ??
      0
  );
  const underdogParsed = finiteCount(
    udSource.propsAfterParsing ?? underdogResult?.debug?.propsAfterParsing ?? underdogProps.length ?? udParser?.acceptedCount ?? 0
  );
  const underdogUsable = finiteCount(
    udSource.usablePropsCount ?? countUsableFromProps(underdogProps)
  );

  const pipeline = pipelinePropCountAudit || debugInfo.pipelinePropCountAudit || {};
  const combinedUsable = finiteCount(
    pipeline.afterLineValidation ?? pipeline.normalizedProps ?? debugInfo.pipelineProviderRaw?.afterCacheMerge ?? 0
  );
  const projectionCandidates = finiteCount(
    pipeline.projectionCandidates ?? pipeline.afterProjectionFilter ?? combinedUsable
  );
  const projected = finiteCount(
    pipeline.projectedProps ?? pipeline.afterProjectionMerge ?? countProjectedFromList([...(prizePicksProps || []), ...(underdogProps || [])])
  );
  const verified = finiteCount(pipeline.verifiedProps ?? pipeline.afterVerificationFilter);

  const underdogAudit = {
    rawProps: underdogFetched,
    mlbProps: countMlbProps(underdogProps),
    supportedProps: countSupportedProps(underdogProps),
    projectedProps: countProjectedFromList(underdogProps),
    parsedProps: underdogParsed,
    usableProps: underdogUsable,
    rejectionReasons: udParser?.rejectionReasons || {},
    parserMismatch: Boolean(udParser?.parserMismatch),
    usedCache: Boolean(
      underdogResult?.status === "Cached" ||
        underdogResult?.fallback ||
        /cached/i.test(String(udSource.lineSourceBadge || udSource.status || ""))
    ),
  };

  const prizepicksTimedOut = Boolean(
    ppFetchDiag.timedOut ||
      ppDiag.timedOut ||
      ppDiag.outerTimeout ||
      /timed out|timeout/i.test(String(ppSource.message || ppDiag.lastError || ""))
  );

  const audit = {
    prizepicksFetched,
    prizepicksParsed,
    prizepicksUsable,
    underdogFetched,
    underdogParsed,
    underdogUsable,
    combinedUsable,
    projectionCandidates,
    projected,
    verified,
    underdogAudit,
    prizepicksTimedOut,
    prizepicksTimeoutStep:
      ppDiag.lastTimeoutLocation ||
      ppFetchDiag.lastPhase ||
      (prizepicksTimedOut ? "outer provider wrapper or fetch retry" : ""),
    prizepicksUsedCache: Boolean(
      prizePicksResult?.status === "Cached" ||
        prizePicksResult?.fallback ||
        ppDiag.usedCacheFallback ||
        /cached/i.test(String(ppSource.lineSourceBadge || ppSource.status || ""))
    ),
    underdogUsedCache: underdogAudit.usedCache,
    underdogParserMismatch: underdogAudit.parserMismatch,
    underdogRaw: underdogFetched,
    updatedAt: new Date().toISOString(),
  };

  audit.diagnosis = diagnoseProviderCoverageGap(audit);
  return audit;
}

function countUsableFromProps(props = []) {
  return (props || []).filter((prop) => {
    const player = String(prop?.playerName || prop?.player || "").trim();
    const line = Number(prop?.line);
    return player && Number.isFinite(line) && line > 0;
  }).length;
}

export function logProviderCoverageSummary(audit = {}) {
  console.log("[Provider Coverage] PrizePicks usable:", audit.prizepicksUsable ?? 0);
  console.log("[Provider Coverage] Underdog usable:", audit.underdogUsable ?? 0);
  console.log("[Provider Coverage] Combined usable:", audit.combinedUsable ?? 0);
  console.log("[Provider Coverage] Projected:", audit.projected ?? 0);
  console.log("[Provider Coverage] Verified:", audit.verified ?? 0);

  const ud = audit.underdogAudit || {};
  console.log("[Underdog Audit] raw props:", ud.rawProps ?? 0);
  console.log("[Underdog Audit] MLB props:", ud.mlbProps ?? 0);
  console.log("[Underdog Audit] supported props:", ud.supportedProps ?? 0);
  console.log("[Underdog Audit] projected props:", ud.projectedProps ?? 0);

  if (audit.prizepicksTimedOut && audit.prizepicksTimeoutStep) {
    console.warn("[PrizePicks Timeout] step:", audit.prizepicksTimeoutStep);
  }
  if (audit.diagnosis?.summary) {
    console.log("[Provider Coverage] Diagnosis:", audit.diagnosis.summary);
  }
  return audit;
}
