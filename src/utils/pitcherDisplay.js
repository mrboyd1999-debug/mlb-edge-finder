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

/** Matchup detail: name, hand, ERA, WHIP for modal/card display. */
export function formatPitcherMatchupDetail(prop = {}) {
  const intel = prop.matchupIntelligence || {};
  const rawName =
    intel.opponentStarter ||
    prop.pitcherName ||
    prop.opposingPitcherName ||
    prop.probablePitcherName ||
    "";
  const name = String(rawName).replace(/^Pitcher:\s*/i, "").trim();
  if (!name || /^(pending|unavailable)$/i.test(name)) {
    return formatPitcherLabel(prop);
  }

  const hand = intel.pitcherHand || prop.pitcherHand;
  const era = intel.pitcherERA ?? prop.pitcherERA ?? prop.opposingPitcherEra;
  const whip = intel.pitcherWHIP ?? prop.pitcherWHIP ?? prop.opposingPitcherWhip;
  const parts = [`Pitcher: ${name}`];
  if (hand) parts.push(String(hand).toUpperCase().charAt(0));
  if (era != null && Number.isFinite(Number(era))) parts.push(`ERA ${Number(era).toFixed(2)}`);
  if (whip != null && Number.isFinite(Number(whip))) parts.push(`WHIP ${Number(whip).toFixed(2)}`);
  return parts.join(" · ");
}

export function resolvePitcherCardLabel(prop = {}) {
  return formatPitcherLabel(prop);
}
