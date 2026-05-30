export const LIVE_BOARD_LOADING_STAGES = {
  FETCH: "Loading feeds...",
  NORMALIZE: "Normalizing props...",
  PROJECT: "Generating projections...",
  RANK: "Ranking top plays...",
  DONE: "Done.",
  MATCH: "Matching players...",
};

export const LIVE_BOARD_UNAVAILABLE_MESSAGE =
  "Live board unavailable — check API/proxy connection.";

export function liveBoardLoadingMessage(stage = "") {
  return LIVE_BOARD_LOADING_STAGES[stage] || LIVE_BOARD_LOADING_STAGES.FETCH;
}
