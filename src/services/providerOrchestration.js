/**
 * Merge live provider props with isolation — one failure cannot block others.
 */

import { normalizePropShape } from "../utils/propShape.js";
import { filterResolvedSportProps } from "../utils/underdogSportDetection.js";
import { MLB_ONLY_MODE } from "../utils/mlbOnlyMode.js";

export const PRIZEPICKS_RATE_LIMIT_OTHERS_MESSAGE = "PrizePicks rate limited, using other sources";

/** Prefer MLB-filtered provider props over raw parsed pools. */
export function resolveProviderResultProps(result = {}) {
  if (result?.props?.length) return result.props;
  return result?.parsedProps || [];
}

export function mergeProviderRawProps({ underdogProps = [], prizePicksProps = [] } = {}) {
  const seen = new Set();
  const merged = [];

  [...underdogProps, ...prizePicksProps].forEach((prop) => {
    const shaped = normalizePropShape(prop, {
      platform: prop.platform || prop.source,
      source: prop.source || prop.platform,
    });
    const key = shaped.id || `${shaped.playerName}|${shaped.statType}|${shaped.line}|${shaped.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(shaped);
  });

  if (MLB_ONLY_MODE) {
    return filterResolvedSportProps(merged, "MLB", { selectedSportTab: "MLB" });
  }
  return merged;
}

export function hasAnyProviderProps({ rawProps = [], allDisplayProps = [], usableProps = [] } = {}) {
  return Boolean(rawProps.length || allDisplayProps.length || usableProps.length);
}

export function buildUnderdogParserFailureMessage(debug = {}) {
  const parser = debug.underdogParser || debug.parser || {};
  const parsedCount = Number(debug.parsedPropsCount ?? parser.acceptedCount ?? 0);
  const rawCount = Number(debug.rawPropsLoaded ?? parser.rawCount ?? 0);
  const reasons = Object.entries(parser.rejectionReasons || {})
    .map(([reason, count]) => `${reason} (${count})`)
    .join(", ");
  const sample = debug.rawUnderdogSamples?.[0] || parser.sampleKeys || null;
  const sampleKeys = sample && typeof sample === "object" ? Object.keys(sample).join(", ") : "";
  const parts = [];
  if (parsedCount > 0 && rawCount > 0) {
    parts.push(`Underdog parsed ${parsedCount} lines but 0 matched MLB filters (${rawCount} raw)`);
  } else if (rawCount > 0 && parsedCount === 0) {
    parts.push(`Underdog parser returned 0 props from ${rawCount} raw lines`);
  }
  if (reasons) parts.push(`rejections: ${reasons}`);
  if (sampleKeys) parts.push(`sample keys: ${sampleKeys}`);
  if (debug.responseShape?.keys?.length) {
    parts.push(`response keys: ${debug.responseShape.keys.join(", ")}`);
  }
  return parts.join(" · ") || "Underdog connected but no MLB props in current feed";
}

export function resolveProviderBoardProps({
  rawProps = [],
  allDisplayProps = [],
  underdogResult = null,
  prizePicksResult = null,
} = {}) {
  if (allDisplayProps.length) return { props: allDisplayProps, source: "display" };
  if (rawProps.length) return { props: rawProps, source: "raw" };

  const ud = resolveProviderResultProps(underdogResult);
  const pp = resolveProviderResultProps(prizePicksResult);
  const merged = mergeProviderRawProps({ underdogProps: ud, prizePicksProps: pp });
  if (merged.length) return { props: merged, source: "provider-fallback" };
  return { props: [], source: "empty" };
}
