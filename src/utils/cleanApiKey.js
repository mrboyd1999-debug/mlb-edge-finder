import { cleanApiKey } from "../../api/lib/cleanApiKey.js";

export { cleanApiKey };

export const ODDS_API_KEY_LENGTH = 32;

export function getOddsKeyLengthWarning(key = "") {
  const cleaned = cleanApiKey(key);
  if (!cleaned) return "";
  if (cleaned.length !== ODDS_API_KEY_LENGTH) {
    return "Odds API key looks incomplete. Re-copy the full key.";
  }
  return "";
}

export function getSportsDataAuthWarning(httpStatus) {
  const status = Number(httpStatus);
  if (status === 401 || status === 403) {
    return "SportsDataIO key is valid format but unauthorized for this endpoint.";
  }
  return "";
}

export function getSportsDataMlbAccessMessage(httpStatus) {
  const status = Number(httpStatus);
  if (status === 401 || status === 403) {
    return "Key may not include MLB access or subscription is not active yet.";
  }
  return "";
}
