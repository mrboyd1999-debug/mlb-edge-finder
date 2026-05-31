/**
 * MLB market mapping for historical stat attachment (PrizePicks → game log fields).
 */

import { canonicalMarketKey } from "./marketNormalization.js";

/** PrizePicks / DFS label → canonical market key used in stats profiles. */
export const MLB_HISTORICAL_MARKET_ALIASES = {
  hitsrunsrbis: "hrr",
  hrr: "hrr",
  "hits+runs+rbis": "hrr",
  totalbases: "totalBases",
  tb: "totalBases",
  strikeouts: "strikeouts",
  pitcherstrikeouts: "strikeouts",
  earnedrunsallowed: "earnedRuns",
  earnedruns: "earnedRuns",
  hitsallowed: "hitsAllowed",
  pitchingouts: "outs",
  outs: "outs",
  outsrecorded: "outs",
  walks: "batterWalks",
  batterwalks: "batterWalks",
  singles: "singles",
  doubles: "doubles",
  homeruns: "homeRuns",
  hits: "hits",
  runs: "runs",
  rbis: "rbis",
  fantasyscore: "fantasyScore",
};

/** SportsData season row fields used to compose combo markets. */
export const MLB_HISTORICAL_SEASON_FIELDS = {
  hrr: ["Hits", "Runs", "RunsBattedIn"],
  totalBases: ["TotalBases"],
  strikeouts: ["Strikeouts", "PitchingStrikeouts"],
  earnedRuns: ["EarnedRuns", "EarnedRunsAllowed"],
  hitsAllowed: ["HitsAllowed"],
  outs: ["Outs", "PitchingOuts"],
  hits: ["Hits"],
  runs: ["Runs"],
  rbis: ["RunsBattedIn", "RBIs"],
  batterWalks: ["Walks", "BaseOnBalls"],
  singles: ["Singles"],
  doubles: ["Doubles"],
  homeRuns: ["HomeRuns"],
  fantasyScore: ["FantasyPoints", "FantasyPointsDraftKings"],
};

export function resolveMlbHistoricalMarketKey(statType = "") {
  const key = canonicalMarketKey(statType);
  if (key) return key;
  const compact = String(statType || "")
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "");
  return MLB_HISTORICAL_MARKET_ALIASES[compact] || "";
}

export function marketsMatchForHistoricalAttach(statA = "", statB = "") {
  const left = resolveMlbHistoricalMarketKey(statA);
  const right = resolveMlbHistoricalMarketKey(statB);
  if (left && right) return left === right;
  return canonicalMarketKey(statA) === canonicalMarketKey(statB);
}

export function resolveMlbHistoricalMarketLabel(statType = "") {
  const key = resolveMlbHistoricalMarketKey(statType);
  if (key === "hrr") return "Hits+Runs+RBIs";
  if (key === "totalBases") return "Total Bases";
  if (key === "strikeouts") return "Strikeouts";
  if (key === "earnedRuns") return "Earned Runs Allowed";
  if (key === "hitsAllowed") return "Hits Allowed";
  if (key === "outs") return "Pitching Outs";
  if (key === "batterWalks") return "Walks";
  if (key === "fantasyScore") return "Fantasy Score";
  return String(statType || "").trim();
}

/** Sum per-game season fields for H+R+RBI and similar combo markets. */
export function sumSeasonFieldsPerGame(statRow = {}, marketKey = "") {
  if (!statRow || !marketKey) return null;
  const games = Number(statRow.Games ?? statRow.GamesPlayed) || 0;
  if (games <= 0) return null;

  if (marketKey === "hrr") {
    const hits = Number(statRow.Hits) || 0;
    const runs = Number(statRow.Runs) || 0;
    const rbis = Number(statRow.RunsBattedIn ?? statRow.RBIs) || 0;
    return (hits + runs + rbis) / games;
  }

  const fields = MLB_HISTORICAL_SEASON_FIELDS[marketKey] || [];
  for (const field of fields) {
    const value = Number(statRow[field]);
    if (Number.isFinite(value)) return value / games;
  }
  return null;
}
