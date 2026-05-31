export const LIVE_BOARD_LOADING_STAGES = {
  CACHED: "Loading cached board...",
  FETCH: "Refreshing feeds...",
  REFRESH: "Refreshing feeds...",
  NORMALIZE: "Normalizing props...",
  PROJECT: "Generating projections...",
  VERIFY: "Verifying plays...",
  RANK: "Ranking top plays...",
  DONE: "Done.",
  MATCH: "Matching players...",
};

export const LIVE_BOARD_UNAVAILABLE_MESSAGE =
  "Live board unavailable — check API/proxy connection.";

export function liveBoardLoadingMessage(stage = "", { refreshing = false } = {}) {
  if (refreshing && (!stage || stage === "FETCH" || stage === "REFRESH")) {
    return LIVE_BOARD_LOADING_STAGES.REFRESH;
  }
  return LIVE_BOARD_LOADING_STAGES[stage] || LIVE_BOARD_LOADING_STAGES.FETCH;
}
