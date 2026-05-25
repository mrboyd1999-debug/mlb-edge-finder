import { fetchPrizePicksProps } from "./prizepicks.js";
import { fetchUnderdogProps } from "./underdog.js";
import { mergeProviderRawProps } from "./providerOrchestration.js";
import { normalizePropShape } from "../utils/propShape.js";
import { filterResolvedSportProps } from "../utils/underdogSportDetection.js";
import { isMlbVerifiedEngineMarket } from "../modules/mlbProjectionService.js";
import { isVerifiedRecommendableProp } from "../modules/propSideEngine.js";
import { sortMlbVerifiedProps, filterMlbRecommendableProps } from "../modules/mlbBestBets.js";
import {
  analyzeMlbPropWithData,
  logMlbData,
  logMlbPropScan,
  MLB_DATA_FETCH_LIMIT,
} from "./mlbDataService.js";
import { matchSportsbookPlayerToMlb } from "./playerMatcher.js";

export const MIN_SCAN_EDGE = 0.35;
export const MIN_SCAN_CONFIDENCE = 58;

export function normalizeLiveProp(prop = {}) {
  return normalizePropShape(prop, {
    platform: prop.platform || prop.source,
    source: prop.source || prop.platform,
    sport: prop.sport || "MLB",
  });
}

export function normalizeLiveProps(props = []) {
  const seen = new Set();
  const normalized = [];
  (props || []).forEach((prop) => {
    const shaped = normalizeLiveProp(prop);
    const key = shaped.id || `${shaped.playerName}|${shaped.statType}|${shaped.line}|${shaped.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(shaped);
  });
  return filterResolvedSportProps(normalized, "MLB", { selectedSportTab: "MLB" });
}

export async function fetchLiveProps({ sources = ["prizepicks", "underdog"] } = {}) {
  const prizePicksResult = sources.includes("prizepicks")
    ? await fetchPrizePicksProps({ sport: "MLB" }).catch((error) => ({ props: [], error: error.message }))
    : { props: [] };
  const underdogResult = sources.includes("underdog")
    ? await fetchUnderdogProps({ sport: "MLB" }).catch((error) => ({ props: [], error: error.message }))
    : { props: [] };

  const prizePicksProps = prizePicksResult?.props || [];
  const underdogProps = underdogResult?.props || underdogResult?.parsedProps || [];
  const merged = mergeProviderRawProps({ underdogProps, prizePicksProps });
  const props = normalizeLiveProps(merged);

  logMlbData("scanner.fetch", {
    prizePicks: prizePicksProps.length,
    underdog: underdogProps.length,
    merged: props.length,
  });

  return { props, prizePicksProps, underdogProps };
}

function invalidLineReason(prop = {}) {
  const line = Number(prop.line);
  if (!Number.isFinite(line) || line <= 0) return "Invalid sportsbook line";
  return null;
}

/**
 * End-to-end scan for one prop: match → data → projection → edge → log.
 */
export async function scanSingleMlbProp(prop = {}, { buildProfile = null } = {}) {
  const normalized = normalizeLiveProp(prop);
  const lineError = invalidLineReason(normalized);
  if (lineError) {
    const failure = {
      ...normalized,
      projectionUnavailable: true,
      displayStatus: "NO VERIFIED PLAY",
      statusMessage: lineError,
      failureReason: lineError,
    };
    logMlbPropScan(normalized, {
      matchedPlayer: null,
      logsFound: 0,
      projection: null,
      edge: null,
      confidence: null,
      recommendation: "NO VERIFIED PLAY",
      failureReason: lineError,
    });
    return failure;
  }

  const match = await matchSportsbookPlayerToMlb(normalized.playerName);
  if (!match?.player?.id) {
    const failure = {
      ...normalized,
      projectionUnavailable: true,
      displayStatus: "NO VERIFIED PLAY",
      statusMessage: "Awaiting projection data",
      failureReason: match?.reason || "No MLB player match",
    };
    logMlbPropScan(normalized, {
      matchedPlayer: null,
      matchConfidence: match?.confidence ?? 0,
      logsFound: 0,
      projection: null,
      edge: null,
      confidence: null,
      recommendation: "NO VERIFIED PLAY",
      failureReason: failure.failureReason,
    });
    return failure;
  }

  if (!isMlbVerifiedEngineMarket(normalized.statType)) {
    const failure = {
      ...normalized,
      projectionUnavailable: true,
      displayStatus: "NO VERIFIED PLAY",
      failureReason: "Market not supported by verified MLB engine",
    };
    logMlbPropScan(normalized, {
      matchedPlayer: match.player.fullName,
      matchConfidence: match.confidence,
      logsFound: 0,
      projection: null,
      edge: null,
      confidence: null,
      recommendation: "NO VERIFIED PLAY",
      failureReason: failure.failureReason,
    });
    return failure;
  }

  const scored = await analyzeMlbPropWithData(normalized, { buildProfile });
  return {
    ...scored,
    matchedMlbPlayer: scored.mlbPipelineTrace?.matchedPlayer || match.player.fullName,
    matchConfidence: scored.mlbPipelineTrace?.matchConfidence ?? match.confidence,
    failureReason: scored.mlbPipelineTrace?.failureReason || scored.dataFetchReason || null,
  };
}

export function filterWeakPlays(props = []) {
  return (props || []).filter((prop) => {
    if (prop.projectionUnavailable || prop.isFallbackProjection) return false;
    if (!prop.isVerifiedProjection) return false;
    const edge = Math.abs(Number(prop.edge ?? 0));
    const confidence = Number(prop.confidence ?? prop.confidenceScore ?? 0);
    if (prop.passPlay) return false;
    if (edge < MIN_SCAN_EDGE) return false;
    if (confidence < MIN_SCAN_CONFIDENCE) return false;
    return isVerifiedRecommendableProp(prop);
  });
}

export function rankStrongPlays(props = []) {
  return sortMlbVerifiedProps(filterMlbRecommendableProps(props));
}

/**
 * Full live board pipeline:
 * fetch props → match player → fetch MLB data → build projection → calculate edge → rank
 */
export async function scanLiveMlbProps(inputProps = null, { buildProfile = null, sources = ["prizepicks", "underdog"] } = {}) {
  const fetched = inputProps ? { props: normalizeLiveProps(inputProps) } : await fetchLiveProps({ sources });
  const props = (fetched.props || []).slice(0, MLB_DATA_FETCH_LIMIT);

  logMlbData("scanner.start", { props: props.length });

  const scanned = [];
  for (const prop of props) {
    try {
      scanned.push(await scanSingleMlbProp(prop, { buildProfile }));
    } catch (error) {
      logMlbData("scanner.propFailed", { player: prop.playerName, reason: error.message });
      scanned.push({
        ...prop,
        projectionUnavailable: true,
        displayStatus: "NO VERIFIED PLAY",
        failureReason: error.message,
      });
    }
  }

  const strong = filterWeakPlays(scanned);
  const ranked = rankStrongPlays(scanned);

  logMlbData("scanner.done", {
    total: scanned.length,
    verified: scanned.filter((prop) => prop.isVerifiedProjection).length,
    strong: strong.length,
    top: ranked.slice(0, 3).map((prop) => ({
      player: prop.playerName,
      stat: prop.statType,
      pick: prop.modelPick,
      edge: prop.edge,
      confidence: prop.confidence,
    })),
  });

  return {
    props: scanned,
    ranked,
    strongPlays: strong,
    verifiedCount: scanned.filter((prop) => prop.isVerifiedProjection).length,
    failureCount: scanned.filter((prop) => prop.projectionUnavailable).length,
  };
}
