export const UNDERDOG_STREAK_EMPTY_MESSAGE =
  "No Underdog streak props loaded. Check Underdog feed/API connection.";

export function isUnderdogProp(prop = {}) {
  return String(prop.source || prop.platform || prop.book || prop.bookmaker || "")
    .toLowerCase()
    .includes("underdog");
}

export function filterUnderdogStreakPool(props = []) {
  return (props || []).filter(isUnderdogProp);
}
