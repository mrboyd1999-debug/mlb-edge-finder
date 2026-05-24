import { normalizeSource, propProviderText } from "./normalizeSource.js";

export const UNDERDOG_STREAK_EMPTY_MESSAGE =
  "No Underdog streak props loaded. Check Underdog feed/API connection.";

export const MLB_UNDERDOG_STREAK_EMPTY_MESSAGE =
  "No MLB Underdog streak props loaded yet.";

export const UNDERDOG_PARSER_EMPTY_MESSAGE =
  "Underdog connected, but parser returned 0 props.";

export function isUnderdogProp(prop = {}) {
  if (prop.normalizedSource === "underdog") return true;
  if (normalizeSource(prop) === "underdog") return true;
  return propProviderText(prop).includes("underdog");
}

export function isPrizePicksProp(prop = {}) {
  if (prop.normalizedSource === "prizepicks") return true;
  if (normalizeSource(prop) === "prizepicks") return true;
  const text = propProviderText(prop);
  return text.includes("prizepicks") || /\bpp\b/.test(text);
}

/** Streak section must never include PrizePicks lines. */
export function filterUnderdogStreakPool(props = []) {
  const streakPool = (props || []).filter(
    (p) =>
      (p.normalizedSource === "underdog" || propProviderText(p).includes("underdog")) &&
      !isPrizePicksProp(p)
  );
  console.log("UD PROP COUNT", streakPool.length);
  if (streakPool.length === 0 && props.length) {
    console.log(
      "UD PROP SOURCE SAMPLE",
      props.slice(0, 5).map((prop) => ({
        source: prop.source,
        platform: prop.platform,
        book: prop.book,
        bookmaker: prop.bookmaker,
        provider: prop.provider,
        normalizedSource: prop.normalizedSource,
      }))
    );
  }
  return streakPool;
}
