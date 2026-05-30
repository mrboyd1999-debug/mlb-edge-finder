/**
 * Supported MLB prop markets — unsupported / non-MLB categories are hard-rejected.
 */

import { canonicalMarketKey } from "./marketNormalization.js";
import { resolvePropSport } from "./mlbOnlyMode.js";
import { getBlockedSportRejectReason } from "./standardPropMetrics.js";

/** Verified MLB projection pipeline markets only. */
const ALLOWED_MARKET_KEYS = new Set([
  "hits",
  "runs",
  "rbis",
  "rbi",
  "hrr",
  "hitsrunsrbis",
  "totalbases",
  "singles",
  "doubles",
  "homeruns",
  "walks",
  "batterwalks",
  "strikeouts",
  "earnedruns",
  "hitsallowed",
  "outs",
  "fantasyscore",
  "fantasy",
  "pitchingfantasy",
  "hitterfantasy",
  "batterfantasy",
  "pitcherfantasy",
  "stolenbases",
  "stolenbase",
  "sb",
  "pitchesthrown",
  "pitchcount",
  "triples",
  "triple",
]);

/** Golf, tennis, soccer, NBA, NFL, NHL, and other non-MLB stat labels. */
export const BLOCKED_NON_MLB_STAT_PATTERN =
  /\b(fairways?|fairways?\s*hit|greens?\s*in\s*regulation|\bgir\b|birdies?|bogeys?|putts?|strokes?|eagles?|pga|lpga|golf|liv\s*golf|tennis|atp|wta|aces?|double\s*faults?|total\s*games?\s*won|soccer|football|nfl|nhl|hockey|goals?\s*allowed|shots?\s*on\s*target|pass\s*yards?|passing\s*yards?|receptions?|rushing\s*yards?|receiving\s*yards?|touchdowns?|rebounds?|assists?|3pm|three\s*point|pts\s*\+\s*rebs?|pra\b|basketball)\b/i;

export const BLOCKED_NON_MLB_SPORT_PATTERN =
  /\b(pga|lpga|golf|liv\s*golf|tennis|atp|wta|soccer|football|nfl|nhl|hockey|nba|wnba|basketball|esports)\b/i;

function statText(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").trim().toLowerCase();
}

function sportText(prop = {}) {
  return [
    prop.sport,
    prop.classifiedSport,
    prop.league,
    prop.leagueName,
    prop.sourceSport,
    prop.platform,
    prop.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isBlockedNonMlbPipelineProp(prop = {}) {
  if (getBlockedSportRejectReason(prop)) return true;
  const stat = statText(prop);
  const sport = sportText(prop);
  if (BLOCKED_NON_MLB_STAT_PATTERN.test(stat)) return true;
  if (BLOCKED_NON_MLB_SPORT_PATTERN.test(sport)) return true;
  const resolved = resolvePropSport(prop);
  if (resolved && resolved !== "MLB") return true;
  return false;
}

export function resolveSupportedMlbMarketKey(prop = {}) {
  if (isBlockedNonMlbPipelineProp(prop)) return "";

  const text = statText(prop);
  const key = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  const compact = key.replace(/[^a-z0-9]/g, "").toLowerCase();

  if (ALLOWED_MARKET_KEYS.has(compact)) return compact;

  if (/pitcher\s*strikeout|strikeouts?\s*thrown|pitcher\s*strikeouts?/.test(text)) return "strikeouts";
  if (/batter\s*strikeouts?|hitter\s*strikeouts?/.test(text)) return "strikeouts";
  if (/^strikeouts?\b/.test(text) && !/allowed/.test(text)) return "strikeouts";
  if (/^hits?\b/.test(text) && !/allowed/.test(text) && !/\+/.test(text)) return "hits";
  if (/\bruns?\b/.test(text) && !/rbi|earned|allowed|\+/.test(text)) return "runs";
  if (/\brbi?s?\b/.test(text) && !/\+/.test(text)) return "rbis";
  if (/total\s*bases?|\btb\b/.test(text)) return "totalbases";
  if (/\bsingles?\b|(^|\s)1b(\s|$)/.test(text)) return "singles";
  if (/\bdoubles?\b|(^|\s)2b(\s|$)/.test(text)) return "doubles";
  if (/home\s*runs?|\bhr\b/.test(text)) return "homeruns";
  if (/hits?\s*(\+|and|&)\s*runs?\s*(\+|and|&)\s*rbis?|hitsrunsrbis/.test(text)) return "hrr";
  if (/outs?\s*recorded|pitching\s*outs?/.test(text)) return "outs";
  if (/walks?\s*allowed/.test(text)) return "walks";
  if (/^walks?\b/.test(text) && !/allowed/.test(text)) return "walks";
  if (/earned\s*runs?/.test(text) && /allowed|pitcher/.test(text)) return "earnedruns";
  if (/hits?\s*allowed/.test(text)) return "hitsallowed";
  if (/fantasy/.test(text) && /pitch/.test(text)) return "pitchingfantasy";
  if (/fantasy/.test(text)) return "fantasyscore";
  if (/stolen\s*base|\bsb\b/.test(text)) return "stolenbases";
  if (/pitches?\s*thrown|pitch\s*count/.test(text)) return "pitchesthrown";
  if (/\btriple\b|\b3b\b/.test(text)) return "triples";

  return "";
}

export function isSupportedMlbMarket(prop = {}) {
  return Boolean(resolveSupportedMlbMarketKey(prop));
}

export function unsupportedMarketRejectReason(prop = {}) {
  if (isBlockedNonMlbPipelineProp(prop)) {
    return "Rejected: non-MLB sport or market";
  }
  if (!isSupportedMlbMarket(prop)) {
    return "Rejected: unsupported MLB market";
  }
  return "";
}

export function filterMlbPipelineSportProps(props = []) {
  return (props || []).filter((prop) => {
    if (isBlockedNonMlbPipelineProp(prop)) return false;
    return resolvePropSport(prop) === "MLB";
  });
}

export function filterMlbPipelineSupportedMarkets(props = []) {
  return (props || []).filter(isSupportedMlbMarket);
}

export function logMlbPipelineFilterAudit(rawCount = 0, mlbProps = [], supportedProps = []) {
  console.log("RAW PROPS", rawCount);
  console.log("AFTER MLB FILTER", mlbProps.length);
  console.log("AFTER MARKET FILTER", supportedProps.length);
}

/** Sport / contamination gate before projection — does NOT drop props by market. */
export function prepareMlbSportPipelineProps(props = [], { rawPropCount = null, log = false } = {}) {
  const mlbProps = filterMlbPipelineSportProps(props);
  if (log) {
    logMlbPipelineFilterAudit(rawPropCount ?? props.length, mlbProps, mlbProps);
  }
  return mlbProps;
}

/** Verified / ranking gate — supported MLB markets only. */
export function prepareMlbProjectionPipelineProps(props = [], { rawPropCount = null, log = true } = {}) {
  const mlbProps = filterMlbPipelineSportProps(props);
  const supportedProps = filterMlbPipelineSupportedMarkets(mlbProps);
  if (log) {
    logMlbPipelineFilterAudit(rawPropCount ?? props.length, mlbProps, supportedProps);
  }
  return supportedProps;
}
