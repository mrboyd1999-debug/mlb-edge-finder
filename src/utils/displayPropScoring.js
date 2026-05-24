/** Temporary display scoring — dedupe, confidence, edge, risk, category picks. */

const BASE_CONFIDENCE = 50;

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function normalizePlayerToken(name = "") {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

export function buildPropDedupeKey(prop = {}) {
  const player = normalizePlayerToken(prop.player || prop.playerName);
  const statType = String(prop.statType || prop.market || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const line = finiteOr(prop.line, 0);
  const source = String(prop.source || prop.platform || "")
    .trim()
    .toLowerCase();
  return `${player}-${statType}-${line}-${source}`;
}

function propTimestamp(prop = {}) {
  const candidates = [prop.updatedAt, prop.lastFetchAt, prop.generatedAt, prop.startTime, prop.cacheMetadata?.verifiedAt];
  for (const value of candidates) {
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return prop.status === "live" ? Date.now() : 0;
}

function isLiveProp(prop = {}) {
  return (
    prop.status === "live" ||
    String(prop.lineSourceBadge || "").toUpperCase() === "LIVE" ||
    String(prop.status || "").toLowerCase() === "live"
  );
}

function isBetterDuplicate(candidate = {}, incumbent = {}) {
  const candidateLive = isLiveProp(candidate);
  const incumbentLive = isLiveProp(incumbent);
  if (candidateLive !== incumbentLive) return candidateLive;

  const confDelta = finiteOr(candidate.confidence ?? candidate.confidenceScore, BASE_CONFIDENCE) -
    finiteOr(incumbent.confidence ?? incumbent.confidenceScore, BASE_CONFIDENCE);
  if (confDelta !== 0) return confDelta > 0;

  return propTimestamp(candidate) > propTimestamp(incumbent);
}

export function dedupeDisplayProps(props = []) {
  const map = new Map();
  (props || []).forEach((prop) => {
    const key = buildPropDedupeKey(prop);
    const existing = map.get(key);
    if (!existing || isBetterDuplicate(prop, existing)) {
      map.set(key, prop);
    }
  });
  return Array.from(map.values());
}

function seededVariance(seed = "", min = 0.5, max = 2) {
  let hash = 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const t = (Math.abs(hash) % 1000) / 1000;
  return min + t * (max - min);
}

export function ensureDisplayProjection(prop = {}) {
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const existing = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  if (Number.isFinite(existing) && existing !== line) {
    return existing;
  }
  const variance = seededVariance(prop.id || buildPropDedupeKey(prop));
  if (side.includes("under")) return round1(line - variance);
  return round1(line + variance);
}

export function computeDisplayEdgeValue(prop = {}) {
  const line = finiteOr(prop.line, 0);
  const projection = finiteOr(prop.projection ?? prop.projectedValue, line);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  if (side.includes("under")) return round1(line - projection);
  return round1(projection - line);
}

export function computeDisplayRiskLevel(confidence = BASE_CONFIDENCE) {
  if (confidence >= 80) return "LOW";
  if (confidence >= 60) return "MEDIUM";
  return "HIGH";
}

export function scoreDisplayProp(prop = {}) {
  const projection = ensureDisplayProjection(prop);
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const edge = computeDisplayEdgeValue({ ...prop, projection, side });

  let confidence = BASE_CONFIDENCE;
  const boostLabels = [];
  const penaltyLabels = [];

  if (isLiveProp(prop)) {
    confidence += 10;
    boostLabels.push("Live source");
  }

  if (Math.abs(projection - line) >= 0.25) {
    confidence += 10;
    boostLabels.push("Projection differs from line");
  }

  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2 || Number(prop.sportsbookEdge) > 0) {
    confidence += 5;
    boostLabels.push("Books agree");
  }

  const hitRate = finiteOr(prop.recentHitRate ?? prop.last5HitRate ?? prop.last10HitRate, NaN);
  if (Number.isFinite(hitRate) && hitRate >= 0.55) {
    confidence += 5;
    boostLabels.push("Recent trend favorable");
  } else if (prop.formNote || prop.recentTrend) {
    confidence += 5;
    boostLabels.push("Matchup/trend signal");
  } else if (prop.opponent || prop.matchupNote) {
    confidence += 5;
    boostLabels.push("Matchup context");
  }

  const volatility = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(volatility) && volatility >= 3.5) {
    confidence -= 10;
    penaltyLabels.push("High variance");
  }

  const sample = finiteOr(prop.sampleSize ?? prop.profile?.sampleSize, NaN);
  if (Number.isFinite(sample) && sample < 5) {
    confidence -= 5;
    penaltyLabels.push("Limited sample");
  } else if (!prop.hasVerifiedStats && !prop.manualEnriched) {
    confidence -= 5;
    penaltyLabels.push("Limited sample");
  }

  if (prop.lineOnlyData || prop.sparseProfile) {
    confidence -= 5;
    penaltyLabels.push("Minutes/usage uncertainty");
  }

  confidence = clamp(Math.round(confidence), 1, 99);
  const riskLevel = computeDisplayRiskLevel(confidence);
  const lineDiff = round1(projection - line);
  const signedDiff = lineDiff >= 0 ? `+${lineDiff}` : `${lineDiff}`;
  const confidenceExplanation = `Projection ${projection} vs line ${line} (${signedDiff} edge)`;

  return {
    ...prop,
    projection,
    projectedValue: projection,
    edge,
    confidence,
    confidenceScore: confidence,
    riskLevel,
    confidenceBoostLabels: boostLabels,
    confidencePenaltyLabels: penaltyLabels,
    confidenceExplanation,
    scoringEngine: "display-temp-v1",
  };
}

export function enrichDisplayPropsPipeline(props = []) {
  return dedupeDisplayProps(props).map((prop) => scoreDisplayProp(prop));
}

function hasValidPlayerName(prop = {}) {
  const name = String(prop.player || prop.playerName || "").trim();
  return name.length >= 2 && name.toLowerCase() !== "unknown player";
}

export function selectTop2Picks(props = []) {
  return [...(props || [])]
    .filter((prop) => hasValidPlayerName(prop) && finiteOr(prop.edge, 0) > 0)
    .sort(
      (a, b) =>
        finiteOr(b.confidence, BASE_CONFIDENCE) - finiteOr(a.confidence, BASE_CONFIDENCE) ||
        finiteOr(b.edge, 0) - finiteOr(a.edge, 0) ||
        Number(isLiveProp(b)) - Number(isLiveProp(a))
    )
    .slice(0, 2);
}

export function selectNearMissProps(props = []) {
  return [...(props || [])]
    .filter((prop) => {
      const conf = finiteOr(prop.confidence, BASE_CONFIDENCE);
      return conf >= 45 && conf <= 59;
    })
    .sort(
      (a, b) =>
        finiteOr(b.confidence, BASE_CONFIDENCE) - finiteOr(a.confidence, BASE_CONFIDENCE) ||
        finiteOr(b.edge, 0) - finiteOr(a.edge, 0)
    );
}

export function selectBestValueProps(props = []) {
  return [...(props || [])]
    .filter((prop) => finiteOr(prop.confidence, BASE_CONFIDENCE) >= 60)
    .sort((a, b) => finiteOr(b.edge, 0) - finiteOr(a.edge, 0));
}

export function selectReadyToBetProps(props = []) {
  const sorted = [...(props || [])].sort(
    (a, b) =>
      finiteOr(b.confidence, BASE_CONFIDENCE) - finiteOr(a.confidence, BASE_CONFIDENCE) ||
      finiteOr(b.edge, 0) - finiteOr(a.edge, 0)
  );
  const qualified = sorted.filter((prop) => finiteOr(prop.confidence, BASE_CONFIDENCE) >= 50);
  if (qualified.length) return qualified;
  return sorted.map((prop) => ({ ...prop, needsReview: true }));
}

export function selectDemonProps(props = []) {
  return [...(props || [])]
    .filter((prop) => finiteOr(prop.edge, 0) >= 3)
    .sort((a, b) => finiteOr(b.edge, 0) - finiteOr(a.edge, 0));
}

export function selectGoblinProps(props = []) {
  return [...(props || [])]
    .filter((prop) => finiteOr(prop.confidence, BASE_CONFIDENCE) >= 80 && String(prop.riskLevel || "").toUpperCase() === "LOW")
    .sort(
      (a, b) =>
        finiteOr(b.confidence, BASE_CONFIDENCE) - finiteOr(a.confidence, BASE_CONFIDENCE) ||
        finiteOr(b.edge, 0) - finiteOr(a.edge, 0)
    );
}

export function riskAccentStyle(riskLevel = "") {
  const key = String(riskLevel || "").toUpperCase();
  if (key === "LOW") return { borderLeft: "3px solid #22c55e", boxShadow: "inset 0 0 0 1px rgba(34,197,94,0.12)" };
  if (key === "MEDIUM") return { borderLeft: "3px solid #eab308", boxShadow: "inset 0 0 0 1px rgba(234,179,8,0.12)" };
  if (key === "HIGH") return { borderLeft: "3px solid #ef4444", boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.12)" };
  return {};
}
