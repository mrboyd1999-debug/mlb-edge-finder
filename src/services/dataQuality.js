export function dataQualityBadge(prop = {}) {
  const signal = prop.modelSignal || {};
  const projectionSource = prop.projectionSource || signal.projectionSource || "";
  const fallback = Boolean(prop.fallbackProfile || signal.fallbackProfile);
  const sampleSize = Number(prop.sampleSize ?? signal.sampleSize ?? 0);
  const projection = prop.projection ?? signal.projection;
  const hasProjection = Number.isFinite(Number(projection));
  const dataQualityScore = Number(prop.dataQualityScore ?? signal.dataQualityScore ?? 0);
  const hasHitRate =
    Number.isFinite(Number(prop.recentHitRate ?? signal.recentHitRate)) ||
    Number.isFinite(Number(prop.last10HitRate ?? signal.last10HitRate));

  if (projectionSource === "missing" || !hasProjection) {
    return { label: "Weak data", tone: "weak" };
  }
  if (fallback) {
    return { label: "Fallback data", tone: "fallback" };
  }
  if (dataQualityScore >= 72 && sampleSize >= 8 && hasHitRate) {
    return { label: "Full data", tone: "full" };
  }
  if (dataQualityScore >= 50 || sampleSize >= 3) {
    return { label: "Partial data", tone: "partial" };
  }
  return { label: "Weak data", tone: "weak" };
}

export function dataQualityFromSignals({ profile, injury, lineComparison, sportsbookComparison, projection, projectionSource }) {
  let score = projectionSource === "missing" ? 22 : 42;
  if (Number.isFinite(projection)) score += 18;
  if (Number(profile?.sampleSize || 0) >= 10) score += 14;
  else if (Number(profile?.sampleSize || 0) >= 5) score += 8;
  if (Number.isFinite(profile?.recentHitRate)) score += 8;
  if (Number.isFinite(profile?.volatility)) score += 6;
  if (profile?.fallback) score -= 12;
  if (lineComparison) score += 6;
  if (sportsbookComparison) score += 8;
  if (injury?.risk === "Medium") score -= 8;
  if (injury?.risk === "High") score -= 18;
  return clamp(score, 0, 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
