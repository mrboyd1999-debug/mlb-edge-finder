function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hasVerifiedHitRateHistory(profile = {}) {
  const sampleSize = Number(profile.sampleSize || 0);
  const recent = Number(profile.recentHitRate);
  const l10 = Number(profile.last10HitRate);
  return sampleSize >= 10 && (Number.isFinite(recent) || Number.isFinite(l10));
}

export function computeConfidence({
  edge = 0,
  line = 1,
  projectionScore = 0,
  consistencyScore = 0,
  sampleScore = 0,
  lineValueBoost = 0,
  sportsbookBoost = 0,
  dataQualityScore = 0,
  volatilityPenalty = 0,
  injuryPenalty = 0,
  projectionSource = "model",
  profileIsFallback = false,
  recentHitRate = null,
  sampleSize = 0,
  multiplier = 1,
  profile = {},
  matchupBoost = 0,
  seasonEdgeBoost = 0,
  formBoost = 0,
  opponentBoost = 0,
  completenessBoost = 0,
  researchPenalty = 0,
  historyBoost = 0,
  sportBoost = 0,
  movementBoost = 0,
  lineOnly = false,
}) {
  const absoluteEdge = Math.abs(edge);
  const lineScale = Math.max(1, Math.abs(line) || 1);
  const edgeComponent = clamp((absoluteEdge / lineScale) * 28, 0, 16);
  const hitRateComponent =
    Number.isFinite(recentHitRate) ? clamp((recentHitRate - 0.5) * 22, -4, 10) : 0;
  const multiplierPenalty = Number(multiplier) > 1 ? clamp((Number(multiplier) - 1) * 10, 0, 12) : 0;

  const raw =
    48 +
    edgeComponent +
    projectionScore * 0.85 +
    consistencyScore +
    sampleScore +
    lineValueBoost +
    sportsbookBoost +
    dataQualityScore * 0.08 +
    hitRateComponent +
    matchupBoost +
    seasonEdgeBoost +
    formBoost +
    opponentBoost +
    completenessBoost +
    historyBoost +
    sportBoost +
    movementBoost -
    researchPenalty -
    volatilityPenalty -
    injuryPenalty -
    multiplierPenalty;

  const marketDerived =
    projectionSource === "sportsbook-market" || projectionSource === "platform-line-comparison";
  const hasPlayerProjection =
    projectionSource === "player-stats" ||
    projectionSource === "player-stats-estimate" ||
    projectionSource === "manual-stats" ||
    projectionSource === "model";

  let cap = 78;
  let capReason = "";
  if (hasPlayerProjection && !profileIsFallback && dataQualityScore >= 55) {
    cap = 82;
  } else if (marketDerived && (sportsbookBoost > 0 || absoluteEdge > 0)) {
    cap = 74;
  } else if (lineOnly) {
    cap = 62 + clamp(lineValueBoost + sportsbookBoost + Math.max(0, movementBoost), 0, 10);
    capReason = "Limited stat context — confidence derived mainly from line/market signals.";
  } else if (projectionSource === "missing") {
    cap = 58;
    capReason = "Projection missing.";
  } else if (profileIsFallback || dataQualityScore < 45) {
    cap = 66;
    capReason = "Sparse stat profile.";
  } else if (!Number.isFinite(edge) || edge <= 0) {
    cap = 58;
    capReason = "No positive edge.";
  }

  const verifiedHistory = hasVerifiedHitRateHistory({ ...profile, sampleSize, recentHitRate });
  const strongData = dataQualityScore >= 72 && sampleSize >= 8 && Number.isFinite(recentHitRate);
  if (
    !lineOnly &&
    !profileIsFallback &&
    dataQualityScore >= 50 &&
    verifiedHistory &&
    strongData &&
    Number(recentHitRate) >= 0.65 &&
    sampleSize >= 12
  ) {
    cap = 85;
  }

  const score = Math.round(clamp(raw, 35, cap));
  return { score, cap, verifiedHistory, strongData, capReason };
}

export function computeStreakConfidence(inputs) {
  const {
    multiplierScore = 0,
    probabilityScore = 0,
    modelScore = 0,
    sideScore = 0,
    hitRateScore = 0,
    qualityScore = 0,
    sampleScore = 0,
    volatilityScore = 0,
    sportsbookScore = 0,
    injuryScore = 0,
    highMultiplierPenalty = 0,
    historyAdjustment = 0,
    recentHitRate = null,
    sampleSize = 0,
    profileIsFallback = false,
    profile = {},
  } = inputs;

  const raw =
    50 +
    multiplierScore +
    probabilityScore +
    modelScore +
    sideScore +
    hitRateScore +
    qualityScore +
    sampleScore +
    volatilityScore +
    sportsbookScore +
    injuryScore +
    highMultiplierPenalty +
    historyAdjustment;

  let cap = 78;
  if (profileIsFallback) cap = 64;
  const verifiedHistory = hasVerifiedHitRateHistory({ ...profile, sampleSize, recentHitRate });
  if (!profileIsFallback && verifiedHistory && Number(recentHitRate) >= 0.68 && sampleSize >= 12) {
    cap = 82;
  }

  return Math.round(clamp(raw, 35, cap));
}

export function confidenceTierLabel(score, riskLevel = "", opts = {}) {
  if (riskLevel === "Low Data Confidence" || riskLevel === "Invalid Data") return "Research";
  const eliteOk = opts.strongData && opts.verifiedHistory && score >= 75;
  if (eliteOk || score >= 75) return "Elite";
  if (score >= 65) return "Strong";
  if (score >= 55) return "Playable";
  return "Research";
}

/**
 * Unified edge score (0–100) from all available signals.
 * Missing signals contribute 0 — never inflate with fake values.
 */
export function computeEdgeScore(prop = {}) {
  const signal = prop.modelSignal || {};
  const line = Number(prop.line ?? signal.line);
  const projection = Number(prop.projection ?? signal.projection);
  const edge = Number(prop.edge ?? signal.edge ?? (Number.isFinite(projection) && Number.isFinite(line) ? Math.abs(projection - line) : 0));
  const lineScale = Math.max(1, Math.abs(line) || 1);
  const modelProbability = Number(prop.modelProbability ?? signal.modelProbability);
  const probabilityEdge = Number(prop.probabilityEdge ?? signal.probabilityEdge);

  let score = 48;
  if (Number.isFinite(edge) && edge > 0) {
    score += clamp((edge / lineScale) * 38, 0, 22);
  } else if (Number.isFinite(projection) && Number.isFinite(line)) {
    score += clamp((Math.abs(projection - line) / lineScale) * 18, 0, 10);
  } else if (prop.projectionSource === "missing") {
    score = 28;
  }

  if (Number.isFinite(modelProbability)) {
    score += clamp((modelProbability - 0.5) * 40, -4, 14);
  }
  if (Number.isFinite(probabilityEdge) && probabilityEdge > 0) {
    score += clamp(probabilityEdge * 120, 0, 10);
  }

  const recentHitRate = Number(prop.recentHitRate ?? signal.recentHitRate);
  const l10 = Number(prop.last10HitRate ?? signal.last10HitRate);
  const l5 = Number(prop.last5HitRate ?? signal.last5HitRate);
  const hitRate = Number.isFinite(l10) ? l10 : Number.isFinite(l5) ? l5 : recentHitRate;
  if (Number.isFinite(hitRate)) score += clamp((hitRate - 0.5) * 28, -6, 12);

  const last5Avg = Number(prop.last5Average ?? signal.last5Average);
  const seasonAvg = Number(prop.seasonAverage ?? signal.seasonAverage);
  if (Number.isFinite(last5Avg) && Number.isFinite(line) && line > 0) {
    score += clamp(((last5Avg - line) / line) * 10, -4, 8);
  } else if (Number.isFinite(seasonAvg) && Number.isFinite(line) && line > 0) {
    score += clamp(((seasonAvg - line) / line) * 6, -3, 5);
  }

  const matchup = String(prop.matchupRating ?? signal.matchupRating ?? "");
  if (matchup === "Favorable") score += 7;
  else if (matchup === "Playable") score += 3;
  else if (matchup === "Tough") score -= 5;

  const movement = prop.lineMovement ?? signal.lineMovement;
  if (movement?.supportsPick) score += 6;
  else if (movement?.againstPick) score -= 6;

  const injury = prop.injuryRisk ?? signal.injuryRisk;
  if (injury === "High") score -= 12;
  else if (injury === "Medium") score -= 5;

  const bookEdge = Number(prop.sportsbookDiscrepancy ?? signal.sportsbookDiscrepancy);
  if (Number.isFinite(bookEdge) && bookEdge > 0) score += clamp(bookEdge * 4, 0, 12);

  const lineComparison = prop.lineComparison ?? signal.lineComparison;
  if (lineComparison && Number.isFinite(Number(lineComparison.difference))) {
    score += clamp(Math.abs(Number(lineComparison.difference)) * 3, 0, 8);
  }

  const dataQuality = Number(prop.dataQualityScore ?? signal.dataQualityScore ?? 0);
  score += clamp((dataQuality - 50) * 0.14, -8, 10);

  const volatility = Number(prop.volatility ?? signal.volatility);
  if (Number.isFinite(volatility)) score -= clamp(volatility * 1.1, 0, 10);

  const multiplier = Number(prop.multiplier ?? 1);
  if (multiplier > 1) score -= clamp((multiplier - 1) * 10, 0, 12);
  else if (multiplier > 0 && multiplier < 1) score += clamp((1 - multiplier) * 6, 0, 6);

  const isFallback = Boolean(prop.fallbackProfile || signal.fallbackProfile);
  let signalCount = 0;
  if (Number.isFinite(edge) && edge > 0) signalCount += 1;
  if (Number.isFinite(hitRate)) signalCount += 1;
  if (Number.isFinite(modelProbability)) signalCount += 1;
  if (matchup && matchup !== "Neutral") signalCount += 1;
  if (movement) signalCount += 1;
  if (Number.isFinite(bookEdge)) signalCount += 1;
  if (dataQuality >= 55) signalCount += 1;

  const edgeScore = Math.round(clamp(score, 0, 100));
  const edgeRating = edgeScore;

  return { edgeScore, edgeRating, signalCount, isFallback };
}

export function computeRankScore(prop = {}) {
  const { edgeScore, signalCount } = computeEdgeScore(prop);
  const signal = prop.modelSignal || {};
  const confidence = Number(prop.confidenceScore ?? signal.confidenceScore ?? 0);
  const expectedValue = Number(prop.expectedValue ?? signal.expectedValue ?? 0);
  const probabilityEdge = Number(prop.probabilityEdge ?? signal.probabilityEdge ?? 0);
  const sampleSize = Number(prop.sampleSize ?? signal.sampleSize ?? 0);
  const multiplier = Number(prop.multiplier ?? 1);
  const priorityScore = Number(prop.priorityScore ?? 0);
  const completeness = sampleSize >= 5 ? 8 : sampleSize >= 3 ? 4 : 0;
  const multiplierRisk = multiplier > 1 ? -10 : multiplier < 1 ? 3 : 0;

  return (
    edgeScore * 0.45 +
    confidence * 0.28 +
    priorityScore * 0.22 +
    signalCount * 3 +
    completeness +
    (Number.isFinite(expectedValue) ? expectedValue * 30 : 0) +
    (Number.isFinite(probabilityEdge) ? probabilityEdge * 75 : 0) +
    multiplierRisk
  );
}

export function estimateModelProbability({ edge, line, confidenceScore, dataQualityScore, volatility }) {
  if (!Number.isFinite(edge) || edge <= 0) return null;
  const lineScale = Math.max(1, Math.abs(Number(line) || 1));
  const edgeComponent = clamp((edge / lineScale) * 0.18, 0, 0.16);
  const confidenceComponent = clamp((confidenceScore - 55) * 0.0035, -0.04, 0.1);
  const qualityComponent = clamp((dataQualityScore - 50) * 0.0015, -0.03, 0.05);
  const volatilityPenalty = Number.isFinite(volatility) ? clamp(volatility * 0.006, 0, 0.06) : 0.025;
  return round(clamp(0.5 + edgeComponent + confidenceComponent + qualityComponent - volatilityPenalty, 0.5, 0.78));
}

export function buildPickExplanation(prop = {}) {
  const signal = prop.modelSignal || {};
  const projection = prop.projection ?? signal.projection;
  const line = prop.line;
  const edge = prop.edge ?? signal.edge;
  const lean = prop.bestPick || prop.side || "Watch";
  const movement = prop.lineMovement || signal.lineMovement;
  const badge = prop.dataQualityBadge?.label || "Unknown";
  const sections = [];

  sections.push({
    title: "Projection vs line",
    lines: [
      `Projected stat: ${Number.isFinite(Number(projection)) ? projection : "Unavailable"}`,
      `Listed line: ${line}`,
      `Edge difference: ${Number.isFinite(Number(edge)) ? (edge > 0 ? "+" : "") + edge : "N/A"}`,
      `Lean: ${lean}`,
    ],
  });

  const formParts = [];
  if (Number.isFinite(prop.last5HitRate ?? signal.last5HitRate)) {
    formParts.push(`L5 hit rate ${Math.round((prop.last5HitRate ?? signal.last5HitRate) * 100)}%`);
  }
  if (Number.isFinite(prop.last10HitRate ?? signal.last10HitRate)) {
    formParts.push(`L10 hit rate ${Math.round((prop.last10HitRate ?? signal.last10HitRate) * 100)}%`);
  }
  if (Number.isFinite(prop.recentHitRate ?? signal.recentHitRate)) {
    formParts.push(`Recent stability ${Math.round((prop.recentHitRate ?? signal.recentHitRate) * 100)}%`);
  }
  if (prop.seasonAverage != null || signal.seasonAverage != null) {
    formParts.push(`Season avg ${prop.seasonAverage ?? signal.seasonAverage}`);
  }
  sections.push({
    title: "Recent form",
    lines: formParts.length ? formParts : ["Limited recent-form sample for this market."],
  });

  sections.push({
    title: "Matchup",
    lines: [
      prop.matchupRating || signal.matchupRating || "Neutral",
      `${prop.team || "Team"} vs ${prop.opponent || "Opponent"}`,
      prop.usageAdjustment || signal.usageAdjustment || "No usage/minutes flag",
    ],
  });

  const risks = [];
  if (prop.injuryRisk && prop.injuryRisk !== "Low") risks.push(`${prop.injuryRisk} injury/news risk`);
  if (Number(prop.multiplier) > 1) risks.push(`Higher payout multiplier (${prop.multiplier}) increases variance`);
  if (prop.fallbackProfile || signal.fallbackProfile) risks.push("Fallback stat profile in use");
  if (movement?.againstPick) risks.push("Line moved against the pick");
  if (prop.riskLevel === "Risky" || prop.riskLevel === "Low Data Confidence") risks.push(prop.riskLevel);
  sections.push({
    title: "Risk factors",
    lines: risks.length ? risks : ["Stable role and matchup support this projection."],
  });

  sections.push({
    title: "Data sources",
    lines: [
      ...(prop.dataSources || []),
      `Data quality: ${badge}`,
      prop.fallbackProfile || signal.fallbackProfile ? "Fallback data was used for part of this evaluation." : "Primary stat sources were used.",
    ].filter(Boolean),
  });

  if (movement) {
    sections.push({
      title: "Line movement",
      lines: [
        `Opening: ${movement.openingLine ?? "—"}`,
        `Current: ${movement.currentLine ?? line}`,
        `Move: ${movement.move ?? 0}`,
        movement.label || (movement.supportsPick ? "Moved toward value" : movement.againstPick ? "Moved against value" : "Stable"),
      ],
    });
  }

  const projectedProbability = Number(prop.projectedProbability ?? prop.confidenceScore);
  if (Number.isFinite(projectedProbability)) {
    const conf = Number(prop.confidenceScore ?? projectedProbability);
    const probPct = projectedProbability > 1 ? projectedProbability : Math.round(projectedProbability * 100);
    const evScore = Number(prop.expectedValueScore);
    sections.push({
      title: "Projected probability",
      lines: [
        `Model probability: ${Math.round(probPct)}%`,
        Number.isFinite(conf) ? `Confidence: ${Math.round(conf)}/100` : null,
        Number.isFinite(evScore) ? `Expected value score: ${Math.round(evScore)}/100` : null,
      ].filter(Boolean),
    });
  }

  const sportsbookComparison = prop.sportsbookComparison || signal.sportsbookComparison;
  const bookLine = Number(prop.sportsbookLine ?? sportsbookComparison?.marketAverageLine);
  const sportsbookEdge = Number(prop.sportsbookEdge);
  if (Number.isFinite(bookLine) || prop.sportsbookEdgeLabel) {
    const books = Number(sportsbookComparison?.books || prop.sportsbookBooksCount || 0);
    sections.push({
      title: "Sportsbook comparison",
      lines: [
        Number.isFinite(bookLine) ? `Sportsbook consensus: ${bookLine}` : null,
        Number.isFinite(sportsbookEdge) ? `Sportsbook edge: ${sportsbookEdge > 0 ? "+" : ""}${sportsbookEdge}` : null,
        books > 0 ? `Books surveyed: ${books}` : null,
        prop.sportsbookEdgeDirection === "favorable"
          ? "Books agree the line is soft in favour of the pick"
          : prop.sportsbookEdgeDirection === "against"
            ? "Books disagree with the DFS line"
            : null,
      ].filter(Boolean),
    });
  } else if ((prop.bookDisagreement?.summary || "").length) {
    sections.push({
      title: "Sportsbook comparison",
      lines: [prop.bookDisagreement.summary],
    });
  }

  const boostLabels = prop.confidenceBoostLabels || [];
  const penaltyLabels = prop.confidencePenaltyLabels || [];
  if (boostLabels.length || penaltyLabels.length) {
    sections.push({
      title: "Confidence adjustments",
      lines: [...boostLabels, ...penaltyLabels],
    });
  }

  return sections;
}

export function propPayoutLabel(prop = {}) {
  if (!prop.verifiedAdjustedOdds) return "standard";
  const oddsType = String(prop.oddsType || prop.odds_type || prop.adjustedOddsType || "").toLowerCase();
  if (oddsType.includes("goblin")) return "Goblin";
  if (oddsType.includes("demon")) return "Demon";
  return "standard";
}
