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
}) {
  const absoluteEdge = Math.abs(edge);
  const lineScale = Math.max(1, Math.abs(line) || 1);
  const edgeComponent = clamp((absoluteEdge / lineScale) * 28, 0, 14);
  const hitRateComponent =
    Number.isFinite(recentHitRate) ? clamp((recentHitRate - 0.5) * 22, -4, 10) : 0;
  const multiplierPenalty = Number(multiplier) > 1 ? clamp((Number(multiplier) - 1) * 10, 0, 12) : 0;

  const raw =
    50 +
    edgeComponent +
    projectionScore * 0.85 +
    consistencyScore +
    sampleScore +
    lineValueBoost +
    sportsbookBoost +
    dataQualityScore * 0.06 +
    hitRateComponent -
    volatilityPenalty -
    injuryPenalty -
    multiplierPenalty;

  let cap = 78;
  if (projectionSource === "missing") cap = 54;
  else if (profileIsFallback) cap = 66;
  else if (!Number.isFinite(edge) || edge <= 0) cap = 58;

  const verifiedHistory = hasVerifiedHitRateHistory({ ...profile, sampleSize, recentHitRate });
  if (verifiedHistory && Number(recentHitRate) >= 0.68 && sampleSize >= 12) {
    cap = 82;
  }

  const score = Math.round(clamp(raw, 35, cap));
  return { score, cap, verifiedHistory };
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
  const verifiedHistory = hasVerifiedHitRateHistory({ ...profile, sampleSize, recentHitRate });
  if (verifiedHistory && Number(recentHitRate) >= 0.68 && sampleSize >= 12) {
    cap = 82;
  }

  return Math.round(clamp(raw, 35, cap));
}

export function confidenceTierLabel(score, riskLevel = "") {
  if (riskLevel === "Low Data Confidence" || riskLevel === "Invalid Data") return "Weak lean";
  if (score >= 80) return "Elite verified";
  if (score >= 70) return "Strong";
  if (score >= 60) return "Solid";
  if (score >= 50) return "Weak lean";
  return "Risky";
}

export function computeRankScore(prop = {}) {
  const signal = prop.modelSignal || {};
  const edge = Number(prop.edge ?? signal.edge ?? 0);
  const edgeRating = Number(prop.edgeRating ?? signal.edgeRating ?? 0);
  const confidence = Number(prop.confidenceScore ?? signal.confidenceScore ?? 0);
  const dataQuality = Number(prop.dataQualityScore ?? signal.dataQualityScore ?? 0);
  const expectedValue = Number(prop.expectedValue ?? signal.expectedValue ?? 0);
  const probabilityEdge = Number(prop.probabilityEdge ?? signal.probabilityEdge ?? 0);
  const recentHitRate = Number(prop.recentHitRate ?? signal.recentHitRate);
  const sampleSize = Number(prop.sampleSize ?? signal.sampleSize ?? 0);
  const multiplier = Number(prop.multiplier ?? 1);
  const hasForm = Number.isFinite(recentHitRate) ? 8 : 0;
  const completeness = dataQuality * 0.35 + (sampleSize >= 5 ? 10 : sampleSize >= 3 ? 5 : 0);
  const marketReliability = prop.platform === "PrizePicks" ? 4 : 3;
  const multiplierRisk = multiplier > 1 ? -8 : multiplier < 1 ? 2 : 0;

  return (
    edge * 12 +
    edgeRating * 0.4 +
    confidence * 0.55 +
    completeness +
    marketReliability +
    (Number.isFinite(expectedValue) ? expectedValue * 40 : 0) +
    (Number.isFinite(probabilityEdge) ? probabilityEdge * 100 : 0) +
    hasForm +
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
    lines: risks.length ? risks : ["No major risk flags flagged by the model."],
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

  return sections;
}

export function propPayoutLabel(prop = {}) {
  const oddsType = String(prop.oddsType || prop.odds_type || prop.adjustedOddsType || "").toLowerCase();
  if (prop.verifiedAdjustedOdds || isVerifiedAdjustedOddsProp(prop)) {
    if (oddsType.includes("goblin") || /goblin|green goblin|lower payout/.test(adjustedDescriptor(prop))) return "Goblin";
    if (oddsType.includes("demon") || /demon|higher payout|boosted payout/.test(adjustedDescriptor(prop))) return "Demon";
  }
  if (oddsType === "goblin" || oddsType === "demon") {
    return oddsType.charAt(0).toUpperCase() + oddsType.slice(1);
  }
  return "standard";
}

function isVerifiedAdjustedOddsProp(prop) {
  const descriptor = adjustedDescriptor(prop);
  return Boolean(prop.verifiedAdjustedOdds) || /demon|goblin|green goblin|higher payout|lower payout|verified adjusted/.test(descriptor);
}

function adjustedDescriptor(prop) {
  return [prop.adjustedOddsType, prop.oddsType, prop.odds_type, prop.multiplierSource, prop.optionLabel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
