/** Pitcher label formatting — avoids circular imports with opponentStarter. */

export function formatPitcherLabel(prop = {}) {
  const raw =
    prop.opposingPitcherName ||
    prop.probablePitcherName ||
    prop.pitcherName ||
    prop.opposingPitcher ||
    prop.opponentStarterNote ||
    prop.opposingPitcherDisplay ||
    "";
  const cleaned = String(raw)
    .replace(/^Pitcher:\s*/i, "")
    .trim();
  if (cleaned && !/^(pending|unavailable|pitcher pending|starter pending|opponent pitcher unavailable)$/i.test(cleaned)) {
    return `Pitcher: ${cleaned}`;
  }
  const status = String(prop.pitcherStatus || "").toLowerCase();
  if (status === "confirmed" && cleaned) return `Pitcher: ${cleaned}`;
  if (status === "unavailable" || status === "unknown") return "Pitcher: Unavailable";
  return "Pitcher: Pending";
}

export function resolvePitcherCardLabel(prop = {}) {
  return formatPitcherLabel(prop);
}
