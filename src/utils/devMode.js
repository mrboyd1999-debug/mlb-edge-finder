import { isDevEnvironment } from "../services/fetchUtil.js";

/** When false, debug panels and grouped debug storage are disabled. */
export const DEV_MODE = isDevEnvironment();

export const SHOW_DEBUG_PANELS_KEY = "dfs-show-debug-panels";

export function readShowDebugPanelsPreference() {
  try {
    return window.localStorage.getItem(SHOW_DEBUG_PANELS_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeShowDebugPanelsPreference(value) {
  try {
    window.localStorage.setItem(SHOW_DEBUG_PANELS_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}

/** Debug UI renders only when the user explicitly enables it in Settings. */
export function isDebugPanelEnabled(showDebugPanels = readShowDebugPanelsPreference()) {
  return showDebugPanels === true;
}

export function isHeavyDebugEnabled() {
  return DEV_MODE;
}

export function shouldTrackGroupedDebug() {
  return DEV_MODE;
}

export function shouldLogVerbose() {
  return DEV_MODE;
}

export function shouldTrackRejectedProps() {
  return DEV_MODE;
}
