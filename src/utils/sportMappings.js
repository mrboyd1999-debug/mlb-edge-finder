/** MLB-only sport mappings (legacy re-export path). */
export {
  MLB_SPORT,
  APP_SPORTS,
  PRIZEPICKS_MLB_LEAGUE_ID,
  PRIZEPICKS_LEAGUE_SPORTS,
  sportFromPrizePicksLeague,
  sportFromUnderdogGame,
  normalizeSportLabel,
  inferSportFromText,
  isMlbSport,
  sportLabelsMatch,
  getActiveFetchSport,
} from "./mlb/sportMappings.js";

/** @deprecated MLB-only app — always returns MLB */
export const UNDERDOG_SPORT_SLUGS = { mlb: "MLB", baseball: "MLB" };

/** @deprecated MLB-only app */
export function sportFromUnderdogSlug() {
  return "MLB";
}
