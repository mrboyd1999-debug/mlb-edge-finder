/**
 * Guaranteed base-feed display path — PrizePicks + Underdog props always render
 * even when enrichment APIs fail or advanced filters reject everything.
 */

import { normalizeDisplayProp, buildAllDisplayProps, enrichDisplayPropsPipeline } from "./allDisplayProps.js";
import { normalizePropsWithSource } from "./normalizeSource.js";
import { attachSportsbookVerifiedFields, isSupportedSportsbookSource } from "./propValidation.js";
import { normalizeSportLabel } from "./sportMappings.js";
import { lockSportFromStatType } from "./propStatSportLock.js";
import { hasMlbStatIndicator } from "./underdogSportDetection.js";
import { MLB_SPORT } from "./mlbOnlyMode.js";
import { normalizePropShape } from "./propShape.js";

export function inferMlbSportForProp(prop = {}) {
  const fromLabel = normalizeSportLabel(prop.sport || prop.classifiedSport || "", prop.league || "");
  if (fromLabel === MLB_SPORT) return MLB_SPORT;
  const statType = prop.statType || prop.market || prop.propType || "";
  if (lockSportFromStatType(statType) === MLB_SPORT || hasMlbStatIndicator(statType)) return MLB_SPORT;
  if (isSupportedSportsbookSource(prop)) return MLB_SPORT;
  return fromLabel || String(prop.sport || prop.league || "").trim();
}

/** Normalize sport/league on provider props before MLB tab filtering. */
export function ensureMlbSportOnProp(prop = {}) {
  if (!prop || typeof prop !== "object") return prop;
  const sport = inferMlbSportForProp(prop);
  const platform = String(prop.platform || prop.source || "").trim();
  const shaped = normalizePropShape(
    {
      ...prop,
      sport: sport || prop.sport || MLB_SPORT,
      league: prop.league || sport || MLB_SPORT,
      projectionSource: prop.projectionSource || (prop.projection ? prop.projectionSource : "base-feed"),
      baseFeedProjection: prop.projection == null && !prop.projectedValue,
      projectionLabel:
        prop.projectionLabel ||
        (prop.projection == null && !prop.projectedValue ? "Base Feed Projection" : prop.projectionLabel),
    },
    { platform, source: platform || prop.source }
  );
  return attachSportsbookVerifiedFields(
    {
      ...shaped,
      sport: sport || MLB_SPORT,
      league: shaped.league || sport || MLB_SPORT,
      lineSourceBadge: prop.lineSourceBadge || "LIVE",
    },
    platform || shaped.platform
  );
}

export function ensureMlbSportOnProps(props = []) {
  return (props || []).filter(Boolean).map(ensureMlbSportOnProp);
}

export function mapRawToDisplayProps(rawProps = [], { fetchSport = "MLB", selectedSport = "MLB" } = {}) {
  const sport = fetchSport === "all" ? selectedSport || "MLB" : fetchSport;
  return normalizePropsWithSource(
    enrichDisplayPropsPipeline(
      ensureMlbSportOnProps(rawProps).map((prop) =>
        normalizeDisplayProp(prop, {
          selectedSport: sport,
          source: prop.platform || prop.source || "PrizePicks",
          status: String(prop.lineSourceBadge || "").toUpperCase() === "CACHED" ? "cached" : "live",
        })
      )
    )
  );
}

export function buildGuaranteedBaseFeedDisplay({
  rawProps = [],
  underdogResult = null,
  prizePicksResult = null,
  fetchSport = "MLB",
  selectedSport = "MLB",
  oddsApi = [],
} = {}) {
  const fromBuild = normalizePropsWithSource(
    buildAllDisplayProps({
      prizePicksResult,
      underdogResult,
      sport: fetchSport,
      selectedSport: fetchSport === "all" ? selectedSport || "MLB" : fetchSport,
      oddsApi: oddsApi || [],
    })
  );
  if (fromBuild.length) return fromBuild;

  const merged = [
    ...(underdogResult?.parsedProps || underdogResult?.props || []),
    ...(prizePicksResult?.props || []),
    ...(rawProps || []),
  ];
  if (!merged.length) return [];
  return mapRawToDisplayProps(merged, { fetchSport, selectedSport });
}

export function logPipelinePropCounts(stage = "", counts = {}) {
  console.info(`[Pipeline ${stage}]`, {
    raw: Number(counts.raw ?? 0),
    normalized: Number(counts.normalized ?? 0),
    filteredMlb: Number(counts.filteredMlb ?? counts.filtered ?? 0),
    display: Number(counts.display ?? 0),
  });
  console.log("RAW PROPS", Number(counts.raw ?? 0));
  console.log("NORMALIZED", Number(counts.normalized ?? 0));
  console.log("FILTERED MLB", Number(counts.filteredMlb ?? counts.filtered ?? 0));
}
