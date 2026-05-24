import { confidenceTierLabel, propPayoutLabel } from "../services/projectionEngine.js";
import { classifyPropSport, isTennisSportLabel } from "./marketClassification.js";
import { marketDisplayLabel, fullMarketDisplayLabel } from "./marketNormalization.js";
import { normalize } from "./formatters.js";

export function canonicalSportFromProp(prop) {
  if (prop?.classifiedSport) return prop.classifiedSport;
  return classifyPropSport(prop);
}

export function displaySport(propOrSport) {
  if (typeof propOrSport === "string") return propOrSport;
  const canonical = canonicalSportFromProp(propOrSport);
  if (canonical !== "Other") return canonical;
  const sport = propOrSport?.sport || "";
  if (isTennisSportLabel(sport) || sport === "Tennis") return "Tennis";
  if (sport === "Esports") return "Esports";
  if (sport === "Unsupported") return "Unsupported";
  return sport || "Sport";
}

export function displayMarketLabel(prop = {}) {
  if (prop?.fullMarketLabel) return prop.fullMarketLabel;
  if (prop?.marketLabel) return prop.marketLabel;
  return marketDisplayLabel(prop?.statType, prop?.sport);
}

export function displayFullMarketLabel(prop = {}) {
  if (prop?.fullMarketLabel) return prop.fullMarketLabel;
  return fullMarketDisplayLabel(prop?.statType || prop?.market, prop?.sport);
}

export { fullMarketDisplayLabel };

export function confidenceTier(prop) {
  const playability = Number(prop.playabilityScore);
  const score = Number.isFinite(playability)
    ? playability
    : Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  return confidenceTierLabel(score, prop.riskLevel || "", {
    strongData: prop.strongData,
    verifiedHistory: prop.verifiedHistory,
  });
}

export { propPayoutLabel };

export function isGoblinProp(prop) {
  return Boolean(prop?.verifiedAdjustedOdds) && propPayoutLabel(prop) === "Goblin";
}

export function isDemonProp(prop) {
  return Boolean(prop?.verifiedAdjustedOdds) && propPayoutLabel(prop) === "Demon";
}

export function playerInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}
