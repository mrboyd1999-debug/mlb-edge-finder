/**
 * Emergency recovery flag — bypasses advanced filtering/enrichment that can block the board.
 * Disabled for production MLB-only mode; enable only for local pipeline debugging.
 */
export const SAFE_MODE = false;

export function isSafeModeEnabled() {
  return SAFE_MODE;
}

export const SAFE_MODE_LOADING_MESSAGE = "Loading MLB props...";
export const SAFE_MODE_FALLBACK_MESSAGE = "Fallback MLB props loaded.";
