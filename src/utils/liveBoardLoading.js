export const LIVE_BOARD_LOADING_STAGES = {
  FETCH: "Loading live MLB props...",
  MATCH: "Matching players...",
  PROJECT: "Building projections...",
  RANK: "Ranking best plays...",
};

export const LIVE_BOARD_UNAVAILABLE_MESSAGE =
  "Live board unavailable — check API/proxy connection.";

export function liveBoardLoadingMessage(stage = "") {
  return LIVE_BOARD_LOADING_STAGES[stage] || LIVE_BOARD_LOADING_STAGES.FETCH;
}
