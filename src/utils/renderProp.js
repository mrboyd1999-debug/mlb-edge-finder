/** Strip heavy nested payloads before UI state / cache writes. */

const DETAIL_KEYS = new Set([
  "confidenceBreakdown",
  "projectionReasoning",
  "researchGaps",
  "lowConfidenceReasons",
  "valueTags",
  "reasoningSummary",
]);

function truncateList(value, max = 4) {
  if (!Array.isArray(value)) return value;
  return value.slice(0, max);
}

export function slimPropForUi(prop = {}) {
  if (!prop || typeof prop !== "object") return prop;

  const {
    raw,
    rawLineMovement,
    sportsbookComparison,
    lineComparison,
    bookDisagreement,
    modelSignal,
    dataSources,
    statEnrichmentSources,
    ...rest
  } = prop;

  const slim = {
    id: rest.id,
    playerName: rest.playerName,
    player: rest.playerName,
    sport: rest.sport,
    market: rest.statType,
    statType: rest.statType,
    line: rest.line,
    pick: rest.bestPick,
    bestPick: rest.bestPick,
    side: rest.side,
    confidence: rest.confidenceScore ?? rest.confidence,
    confidenceScore: rest.confidenceScore,
    edge: rest.edge,
    status: rest.status,
    source: rest.platform,
    platform: rest.platform,
    team: rest.team,
    opponent: rest.opponent,
    startTime: rest.startTime,
    projectedValue: rest.projectedValue,
    projection: rest.projection,
    riskLevel: rest.riskLevel,
    qualificationReason: rest.qualificationReason,
    sportsbookLine: rest.sportsbookLine,
    expectedValueScore: rest.expectedValueScore,
    volatilityScore: rest.volatilityScore,
    dataQualityScore: rest.dataQualityScore,
    volatility: rest.volatility,
    bettingLabel: rest.bettingLabel,
    verifiedBadge: rest.verifiedBadge,
    sportsbookVerified: rest.sportsbookVerified,
    lineSourceBadge: rest.lineSourceBadge,
    multiplier: rest.multiplier,
    payoutLabel: rest.payoutLabel,
    priorityScore: rest.priorityScore,
    decisionRankScore: rest.decisionRankScore,
    sportsbookDiscrepancy: rest.sportsbookDiscrepancy,
    bookSummary: bookDisagreement?.summary || "",
    hasVerifiedStats: rest.hasVerifiedStats,
    manualEnriched: rest.manualEnriched,
    displayTier: rest.displayTier,
    recommendationStatus: rest.recommendationStatus,
    isQualificationAccepted: rest.isQualificationAccepted,
    qualificationTier: rest.qualificationTier,
    qualificationLabel: rest.qualificationLabel,
    generatedAt: rest.generatedAt,
  };

  if (rest.lineMovement) {
    slim.lineMovement = {
      label: rest.lineMovement.label,
      supportsPick: rest.lineMovement.supportsPick,
      againstPick: rest.lineMovement.againstPick,
      openingLine: rest.lineMovement.openingLine,
      currentLine: rest.lineMovement.currentLine,
      amount: rest.lineMovement.amount,
      direction: rest.lineMovement.direction,
    };
  }

  DETAIL_KEYS.forEach((key) => {
    if (rest[key] != null) slim[key] = truncateList(rest[key]);
  });

  if (modelSignal && typeof modelSignal === "object") {
    slim.modelSignal = {
      confidenceScore: modelSignal.confidenceScore,
      edge: modelSignal.edge,
      dataQualityScore: modelSignal.dataQualityScore,
      lineSourceBadge: modelSignal.lineSourceBadge,
    };
  }

  return slim;
}

export function slimPropsForUi(props = []) {
  return props.map(slimPropForUi);
}
