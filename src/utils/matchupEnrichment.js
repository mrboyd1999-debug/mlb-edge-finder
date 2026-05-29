/**
 * Matchup fallback — use rolling form when opponent/matchup notes are unavailable.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasRichMatchupData(prop = {}) {
  return Boolean(
    prop.matchupNote ||
      prop.handednessMatchup ||
      String(prop.opponent || "").trim() ||
      prop.opponentContext
  );
}

function resolveFormBaseline(prop = {}) {
  return (
    finite(prop.last5Average ?? prop.recentForm) ??
    finite(prop.last10Average) ??
    finite(prop.seasonAverage) ??
    null
  );
}

/** Score 0–100 from rolling averages vs line alignment. */
export function computeFormConfidenceScore(prop = {}, projection = null) {
  const line = finite(prop.line);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  const last5 = finite(prop.last5Average ?? prop.recentForm);
  const last10 = finite(prop.last10Average);
  const season = finite(prop.seasonAverage);
  if (!line || line <= 0) return 50;

  const samples = [last5, last10, season].filter((v) => v != null);
  if (!samples.length && proj == null) return 48;

  let score = 50;
  const leanOver = proj != null ? proj >= line : samples[0] >= line;

  samples.forEach((avg, index) => {
    const weight = index === 0 ? 0.45 : index === 1 ? 0.35 : 0.2;
    const favor = leanOver ? avg - line : line - avg;
    score += Math.max(-12, Math.min(12, favor * 8)) * weight;
  });

  if (proj != null) {
    const edge = Math.abs(proj - line) / line;
    score += Math.min(10, edge * 40);
  }

  const sampleSize = finite(prop.sampleSize ?? prop.games ?? prop.gamesPlayed) ?? samples.length * 5;
  if (sampleSize >= 15) score += 4;
  else if (sampleSize >= 8) score += 2;
  else score -= 2;

  return Math.max(35, Math.min(78, Math.round(score)));
}

export function enrichPropWithMatchupFallback(prop = {}) {
  if (hasRichMatchupData(prop)) {
    return {
      ...prop,
      matchupConfidence: prop.matchupConfidence || "HIGH",
    };
  }

  const formBaseline = resolveFormBaseline(prop);
  const formConfidenceScore = computeFormConfidenceScore(prop);

  return {
    ...prop,
    matchupConfidence: "LOW",
    matchupNote:
      prop.matchupNote ||
      (formBaseline != null
        ? `Rolling form baseline ${formBaseline} (L5/L10/season)`
        : "Matchup unavailable — rolling form only"),
    formBaseline,
    formConfidenceScore,
  };
}

export function enrichPropsWithMatchupFallback(props = []) {
  return (props || []).map(enrichPropWithMatchupFallback);
}
