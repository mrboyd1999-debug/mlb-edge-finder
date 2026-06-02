/**
 * MLB player role vs stat type validation — rejects hitter/pitcher mismatches.
 */

import { compactMarketKey } from "./marketNormalization.js";

function statText(statType = "") {
  return String(statType || "").trim().toLowerCase();
}

function positionBlob(prop = {}) {
  return [
    prop.position,
    prop.playerPosition,
    prop.rosterPosition,
    prop.primaryPosition,
    prop.profile?.position,
    prop.sportsDataSeason?.Position,
    prop.sportsDataSeason?.position,
    prop.raw?.position,
    prop.raw?.player?.position,
  ]
    .filter(Boolean)
    .join(" ");
}

/** @returns {"pitcher"|"hitter"|"unknown"} */
export function resolvePlayerRole(prop = {}) {
  const pos = positionBlob(prop);
  const posUpper = pos.toUpperCase();

  if (prop.isPitcher === true || Number(prop.pitcherStarts || 0) > 0) return "pitcher";
  if (prop.isHitter === true || prop.battingOrder || prop.lineupSlot) return "hitter";

  if (/\b(SP|RP|P\b|PITCHER)\b/.test(posUpper)) return "pitcher";
  if (/\b(1B|2B|3B|SS|OF|LF|CF|RF|DH|IF|UT|C\b|BATTER|HITTER|OUTFIELD|INFIELD)\b/.test(posUpper)) {
    return "hitter";
  }

  if (Number.isFinite(Number(prop.recentStrikeoutAverage)) && !Number.isFinite(Number(prop.recentHitsAverage))) {
    return "pitcher";
  }
  if (
    Number.isFinite(Number(prop.recentHitsAverage)) ||
    Number.isFinite(Number(prop.sluggingPct)) ||
    Number.isFinite(Number(prop.batterSlugging))
  ) {
    return "hitter";
  }

  if (/pitcher|starting pitcher|relief|bullpen/i.test(String(prop.role || prop.playerRole || ""))) {
    return "pitcher";
  }
  if (/batter|hitter|lineup|everyday/i.test(String(prop.role || prop.playerRole || prop.battingOrderNote || ""))) {
    return "hitter";
  }

  return "unknown";
}

/** @returns {"pitcher"|"hitter"|"either"|"unknown"} */
export function classifyStatRole(statType = "") {
  const text = String(statType || "").trim().toLowerCase();
  if (!text) return "unknown";

  const compact = compactMarketKey(statType);

  if (
    /pitcher\s*strikeout|strikeouts?\s*thrown|strikeouts?\s*pitched|walks?\s*allowed|earned\s*runs?|outs?\s*recorded|hits?\s*allowed|pitch\s*count|pitching\s*fantasy|pitches?\s*thrown/.test(
      text
    )
  ) {
    return "pitcher";
  }

  if (
    compact === "pitcherstrikeouts" ||
    compact === "earnedruns" ||
    compact === "walksallowed" ||
    compact === "outsrecorded" ||
    compact === "pitchingfantasy"
  ) {
    return "pitcher";
  }

  if (
    /hits?\s*(\+|and|&)\s*runs?\s*(\+|and|&)\s*rbis?|total\s*bases?|home\s*runs?|stolen\s*bases?|\bhits?\b|\brbis?\b|\bruns?\b|\bsingles?\b|\bdoubles?\b|\btriples?\b/.test(
      text
    ) &&
    !/allowed|pitcher|walks?\s*allowed/.test(text)
  ) {
    return "hitter";
  }

  if (
    compact === "hits" ||
    compact === "rbis" ||
    compact === "rbi" ||
    compact === "totalbases" ||
    compact === "homeruns" ||
    compact === "stolenbases" ||
    compact.includes("hitsrunsrbis")
  ) {
    return "hitter";
  }

  if (/fantasy/.test(text) && /pitch/.test(text)) return "pitcher";
  if (/fantasy/.test(text)) return "either";

  return "either";
}

export function playerRoleStatMismatchReason(prop = {}) {
  const statType = prop.statType || prop.market || prop.propType || "";
  const statRole = classifyStatRole(statType);
  const playerRole = resolvePlayerRole(prop);

  if (statRole === "pitcher" && playerRole !== "pitcher") {
    return playerRole === "hitter"
      ? "Rejected: hitter on pitcher stat"
      : "Rejected: pitcher stat without pitcher role";
  }
  if (statRole === "hitter" && playerRole !== "hitter") {
    return playerRole === "pitcher"
      ? "Rejected: pitcher on hitter stat"
      : "Rejected: hitter stat without hitter role";
  }

  return "";
}

export function isPitcherOnlyStat(statType = "") {
  return classifyStatRole(statType) === "pitcher";
}

export function isHitterOnlyStat(statType = "") {
  return classifyStatRole(statType) === "hitter";
}
