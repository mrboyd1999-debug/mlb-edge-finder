/** MLB-only sport mappings — all multi-sport branches removed. */

export const MLB_SPORT = "MLB";
export const APP_SPORTS = { MLB: "MLB" };

export const PRIZEPICKS_MLB_LEAGUE_ID = "2";

export const PRIZEPICKS_LEAGUE_SPORTS = {
  "2": MLB_SPORT,
  "3": MLB_SPORT,
};

export function sportFromPrizePicksLeague(leagueRecord, leagueId) {
  const id = String(leagueId || leagueRecord?.id || leagueRecord?.attributes?.league_id || "");
  return PRIZEPICKS_LEAGUE_SPORTS[id] || MLB_SPORT;
}

export function sportFromUnderdogGame(game = {}) {
  const sport = String(game?.sport_id || game?.sport || game?.league || "").toLowerCase();
  if (/mlb|baseball/.test(sport)) return MLB_SPORT;
  return MLB_SPORT;
}

export function normalizeSportLabel(value = "") {
  const key = String(value || "").toLowerCase();
  if (/mlb|baseball|major league/.test(key)) return MLB_SPORT;
  return MLB_SPORT;
}

export function inferSportFromText(value = "") {
  const key = String(value || "").toLowerCase();
  if (/mlb|baseball|pitcher|batter|strikeout|rbi|home run|total bases/.test(key)) return MLB_SPORT;
  return MLB_SPORT;
}

export function isMlbSport(value = "") {
  return normalizeSportLabel(value) === MLB_SPORT;
}

export function sportLabelsMatch(a = "", b = "") {
  return normalizeSportLabel(a) === normalizeSportLabel(b);
}

export function getActiveFetchSport() {
  return MLB_SPORT;
}
