/** Normalize accepted prop field names for guaranteed card rendering. */
export function normalizePropForCard(prop = {}, index = 0) {
  return {
    id: prop.id || prop.propId || prop.key || `accepted-${index}`,
    player:
      prop.player ||
      prop.playerName ||
      prop.name ||
      prop.participant ||
      prop.athlete ||
      "Unknown Player",
    market: prop.market || prop.statType || prop.propType || prop.category || "Unknown Market",
    line: prop.line ?? prop.value ?? prop.threshold ?? "—",
    pick: prop.pick || prop.recommendation || prop.lean || prop.side || prop.bestPick || prop.pickDirection || "Lean",
    confidence: Number(prop.confidence ?? prop.calibratedConfidence ?? prop.confidenceScore ?? prop.score ?? 65),
    edge: Number(prop.edge ?? prop.projectedEdge ?? 0),
    weightedScore: Number(prop.weightedScore ?? prop.confidenceScore ?? prop.confidence ?? prop.score ?? 65),
    source: prop.source || prop.sportsbook || prop.platform || "PrizePicks",
    _raw: prop,
  };
}

export function normalizePropsForCards(props = []) {
  return (props || []).filter(Boolean).map(normalizePropForCard);
}
