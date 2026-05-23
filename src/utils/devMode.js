import { isDevEnvironment } from "../services/fetchUtil.js";

/** When false, debug panels and grouped debug storage are disabled. */
export const DEV_MODE = isDevEnvironment();

export function isDebugPanelEnabled() {
  return DEV_MODE;
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
