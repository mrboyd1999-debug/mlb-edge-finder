/**
 * Emergency recovery flag — bypasses advanced filtering/enrichment that can block the board.
 * Flip to false once the pipeline is stable again.
 */
export const SAFE_MODE = true;

export function isSafeModeEnabled() {
  return SAFE_MODE;
}

export const SAFE_MODE_LOADING_MESSAGE = "Loading MLB props...";
export const SAFE_MODE_FALLBACK_MESSAGE = "Fallback MLB props loaded.";
