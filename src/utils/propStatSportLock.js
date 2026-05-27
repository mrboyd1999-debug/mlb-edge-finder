/**
 * Hard-lock stat types to sports — prevents e.g. "Points + Rebounds" under MLB.
 */

import { compactMarketKey } from "./marketNormalization.js";

function statText(statType = "") {
  return String(statType || "").trim().toLowerCase();
}

/** NBA/WNBA-only markets — if matched, sport MUST be NBA or WNBA. */
export function isNbaOnlyStatType(statType = "") {
  const text = statText(statType);
  if (!text) return false;

  if (/\bpoints?\s*(\+|and|&)\s*rebounds?\b/.test(text)) return true;
  if (/\bpts?\s*(\+|and|&)\s*rebs?\b/.test(text)) return true;
  if (/\bpts?\s*(\+|and|&)\s*rebs?\s*(\+|and|&)\s*asts?\b/.test(text)) return true;
  if (/\brebounds?\s*(\+|and|&)\s*assists?\b/.test(text)) return true;
  if (/\brebounds?\b/.test(text)) return true;
  if (/\bassists?\b/.test(text)) return true;
  if (/\bpoints?\b/.test(text) && !/\bhits?\b/.test(text)) return true;
  if (/\bpra\b/.test(text)) return true;
  if (/\bthrees?\b/.test(text) || /\b3pm\b/.test(text)) return true;
  if (/\bsteals?\b/.test(text) || /\bblocks?\b/.test(text)) return true;
  if (/fantasy\s*(score|points?)/.test(text) && !/\bmlb\b/.test(text)) return true;

  const compact = compactMarketKey(statType);
  return compact === "pra" || compact === "pointsrebounds" || compact === "ptsrebs" || compact === "fantasyscore" || compact === "fantasypoints";
}

/** MLB-only markets — if matched, sport MUST be MLB. */
export function isMlbOnlyStatType(statType = "") {
  const text = statText(statType);
  if (!text) return false;

  if (/\bhits?\s*(\+|and|&)\s*runs?\s*(\+|and|&)\s*rbis?\b/.test(text)) return true;
  if (/\bhits?\s*(\+|and|&)\s*runs?\b/.test(text)) return true;
  if (/\btotal\s*bases?\b/.test(text)) return true;
  if (/\bhome\s*runs?\b/.test(text)) return true;
  if (/\bstrikeouts?\b/.test(text)) return true;
  if (/\bearned\s*runs?\b/.test(text)) return true;
  if (/\bwalks?\s*allowed\b/.test(text)) return true;
  if (/\bsingles?\b/.test(text)) return true;
  if (/\bdoubles?\b/.test(text)) return true;
  if (/\bstolen\s*bases?\b/.test(text)) return true;
  if (/\brbis?\b/.test(text)) return true;
  if (/\bhits?\b/.test(text)) return true;
  if (/\bruns?\b/.test(text) && !/\brebounds?\b/.test(text)) return true;

  const compact = compactMarketKey(statType);
  return (
    compact.includes("hitsrunsrbis") ||
    compact.includes("hitsrunsandrbis") ||
    compact.includes("totalbases") ||
    compact.includes("homerun") ||
    compact.includes("strikeout") ||
    compact.includes("earnedrun") ||
    compact === "hits" ||
    compact === "rbis" ||
    compact === "rbi"
  );
}

/** NFL-only markets — if matched, sport MUST be NFL. */
export function isNflOnlyStatType(statType = "") {
  const text = statText(statType);
  if (!text) return false;
  if (/\bseason\s+pass\s+yards\b/.test(text)) return true;
  if (/\bseason\s+(receiving|rushing)\s+yards\b/.test(text)) return true;
  if (/\bpass\s+yards\b/.test(text) && !/\bpitch/.test(text)) return true;
  if (/\b(receiving|rushing)\s+yards\b/.test(text)) return true;
  if (/\bpass\s+touchdowns?\b/.test(text)) return true;
  if (/\bpass\s+completions?\b/.test(text)) return true;
  if (/\binterceptions?\b/.test(text) && /\bpass/.test(text)) return true;
  if (/\brushing\s+attempts?\b/.test(text)) return true;
  if (/\breceptions?\b/.test(text) && !/\bmlb\b/.test(text)) return true;
  return false;
}

/** Returns "NBA", "WNBA", "MLB", "NFL", or "" */
export function lockSportFromStatType(statType = "") {
  if (isNflOnlyStatType(statType)) return "NFL";
  if (isNbaOnlyStatType(statType)) {
    const text = statText(statType);
    if (/\bwnba\b/.test(text)) return "WNBA";
    return "NBA";
  }
  if (isMlbOnlyStatType(statType)) return "MLB";
  return "";
}

export function isValidSportStatCombo(sport = "", statType = "") {
  const lock = lockSportFromStatType(statType);
  if (!lock) return true;
  if (!sport) return true;
  return lock === sport;
}

export function sportStatMismatchReason(sport = "", statType = "") {
  const lock = lockSportFromStatType(statType);
  if (!lock || !sport || lock === sport) return "";
  if (lock === "NBA" && sport === "MLB") return "Rejected: NBA stat under MLB";
  if (lock === "MLB" && (sport === "NBA" || sport === "WNBA")) return "Rejected: MLB stat under NBA";
  if (lock === "WNBA" && sport === "MLB") return "Rejected: WNBA stat under MLB";
  if (lock === "MLB" && sport === "WNBA") return "Rejected: MLB stat under WNBA";
  if (lock === "NFL" && sport === "MLB") return "Rejected: NFL stat under MLB";
  if (lock === "MLB" && sport === "NFL") return "Rejected: MLB stat under NFL";
  return "Rejected: invalid sport/stat combo";
}
