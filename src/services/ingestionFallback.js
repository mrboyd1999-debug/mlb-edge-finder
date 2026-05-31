/**
 * Ingestion fallback chain — never return empty when any source can supply props.
 */

import { normalizeDisplayProp, readPropSourceCache } from "../utils/allDisplayProps.js";
import { enrichDisplayPropsPipeline } from "../utils/displayPropScoring.js";
import { normalizePropsWithSource } from "../utils/normalizeSource.js";
import { generateMlbPropsFromSportsData } from "./propSportsDataEnrichment.js";
import { readLastGoodBoard, boardFromLastGood } from "./lastGoodBoardCache.js";
import { mergeProviderRawProps } from "./providerOrchestration.js";

function normalizeRows(props = [], fetchSport = "MLB") {
  return normalizePropsWithSource(
    enrichDisplayPropsPipeline(
      (props || []).map((prop) =>
        normalizeDisplayProp(prop, {
          selectedSport: fetchSport === "all" ? "MLB" : fetchSport,
          source: prop.platform || prop.source || "Underdog",
          status: prop.isSportsDataFallback ? "cached" : "live",
        })
      )
    )
  );
}

export async function resolveIngestionFallback({
  rawProps = [],
  allDisplayProps = [],
  underdogResult = null,
  prizePicksResult = null,
  sourceStatus = {},
  fetchSport = "MLB",
} = {}) {
  if (allDisplayProps.length) {
    return { rawProps, allDisplayProps, source: "live", pipelineFallback: false };
  }

  const merged = mergeProviderRawProps({
    underdogProps: underdogResult?.parsedProps || underdogResult?.props || [],
    prizePicksProps: prizePicksResult?.props || [],
  });
  if (merged.length) {
    const display = normalizeRows(merged, fetchSport);
    return { rawProps: merged, allDisplayProps: display, source: "provider-merge", pipelineFallback: true };
  }

  const cachedUd = readPropSourceCache(fetchSport, "Underdog");
  const cachedPp = readPropSourceCache(fetchSport, "PrizePicks");
  const cachedMerged = mergeProviderRawProps({ underdogProps: cachedUd, prizePicksProps: cachedPp });
  if (cachedMerged.length) {
    const display = normalizeRows(cachedMerged, fetchSport);
    sourceStatus.Underdog = sourceStatus.Underdog || "Cached";
    sourceStatus.PrizePicks = sourceStatus.PrizePicks || "Cached";
    return { rawProps: cachedMerged, allDisplayProps: display, source: "source-cache", pipelineFallback: true };
  }

  const generated = await generateMlbPropsFromSportsData({ limit: 48 });
  if (generated.props?.length) {
    sourceStatus.SportsDataIO = "Connected";
    const display = normalizeRows(generated.props, fetchSport);
    return {
      rawProps: generated.props,
      allDisplayProps: display,
      source: "sportsdata-generated",
      pipelineFallback: true,
      warnings: generated.warnings || [],
    };
  }

  const lastGood = readLastGoodBoard();
  if (lastGood) {
    const board = boardFromLastGood(lastGood, sourceStatus);
    return {
      rawProps: board.props,
      allDisplayProps: board.allDisplayProps,
      source: "last-good-board",
      pipelineFallback: true,
      board,
    };
  }

  return { rawProps: rawProps || [], allDisplayProps: [], source: "empty", pipelineFallback: false };
}

export function buildNonEmptyBoardResult(baseResult = {}, fallback = {}) {
  if (!fallback.allDisplayProps?.length) return null;
  const props = fallback.allDisplayProps;
  return {
    ...baseResult,
    props,
    allDisplayProps: props,
    usableProps: props,
    qualifiedReadyProps: props.slice(0, 40),
    acceptedPropsForRender: props.slice(0, 40),
    pipelineFallback: true,
    ingestionSource: fallback.source,
    warnings: [...(baseResult.warnings || []), ...(fallback.warnings || [])].filter(Boolean),
  };
}
