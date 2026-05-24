/**
 * Supported MLB prop markets — unsupported categories are hard-rejected.
 */

import { canonicalMarketKey } from "./marketNormalization.js";

const ALLOWED_MARKET_KEYS = new Set([
  "strikeouts",
  "hits",
  "totalbases",
  "singles",
  "fantasyscore",
  "fantasy",
  "outs",
  "walks",
  "walksallowed",
  "earnedruns",
  "hrr",
  "hitsrunsrbis",
  "pitchingfantasy",
  "hitterfantasy",
  "batterfantasy",
  "pitcherfantasy",
]);

function statText(prop = {}) {
  return String(prop.statType || prop.market || prop.propType || "").trim().toLowerCase();
}

export function resolveSupportedMlbMarketKey(prop = {}) {
  const text = statText(prop);
  const key = canonicalMarketKey(prop.statType || prop.market || prop.propType || "");
  const compact = key.replace(/[^a-z0-9]/g, "").toLowerCase();

  if (ALLOWED_MARKET_KEYS.has(compact)) return compact;

  if (/pitcher\s*strikeout|strikeouts?\s*thrown/.test(text)) return "strikeouts";
  if (/^hits?\b/.test(text) && !/allowed/.test(text)) return "hits";
  if (/total\s*bases?|\btb\b/.test(text)) return "totalbases";
  if (/\bsingles?\b|(^|\s)1b(\s|$)/.test(text)) return "singles";
  if (/hits?\s*(\+|and|&)\s*runs?\s*(\+|and|&)\s*rbis?|hitsrunsrbis/.test(text)) return "hrr";
  if (/outs?\s*recorded|pitching\s*outs?/.test(text)) return "outs";
  if (/walks?\s*allowed/.test(text)) return "walksallowed";
  if (/earned\s*runs?/.test(text) && /allowed|pitcher/.test(text)) return "earnedruns";
  if (/fantasy/.test(text) && /pitch/.test(text)) return "pitchingfantasy";
  if (/fantasy/.test(text)) return "fantasyscore";

  return "";
}

export function isSupportedMlbMarket(prop = {}) {
  return Boolean(resolveSupportedMlbMarketKey(prop));
}

export function unsupportedMarketRejectReason(prop = {}) {
  if (!isSupportedMlbMarket(prop)) {
    return "Rejected: unsupported MLB market";
  }
  return "";
}
