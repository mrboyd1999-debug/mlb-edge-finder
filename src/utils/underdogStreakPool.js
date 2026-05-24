import { normalizeSource } from "./normalizeSource.js";

export const UNDERDOG_STREAK_EMPTY_MESSAGE =
  "No Underdog streak props loaded. Check Underdog feed/API connection.";

export function isUnderdogProp(prop = {}) {
  return prop.normalizedSource === "underdog" || normalizeSource(prop) === "underdog";
}

export function filterUnderdogStreakPool(props = []) {
  const streakPool = (props || []).filter(isUnderdogProp);
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
