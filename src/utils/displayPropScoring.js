/** Display scoring — dedupe, weighted confidence, rankings, category picks. */

const BASE_CONFIDENCE = 50;
const MIN_TOP_PICK_CONFIDENCE = 75;
const MIN_ACCEPTED_CONFIDENCE = 70;
const MIN_ACCEPTED_EDGE = 1.5;

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

function hashString(text = "") {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function propVariance(prop = {}) {
  return (hashString(buildPropDedupeKey(prop)) % 7) - 3;
}

export function buildPropDedupeKey(prop = {}) {
  const player = String(prop.player || prop.playerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const statType = String(prop.statType || prop.market || prop.propType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const line = finiteOr(prop.line, 0);
  const source = String(prop.source || prop.platform || "")
    .trim()
    .toLowerCase();
  return `${player}-${statType}-${line}-${source}`;
}

function playerKey(prop = {}) {
  return String(prop.player || prop.playerName || "")
    .trim()
    .toLowerCase();
}

function propTimestamp(prop = {}) {
  const candidates = [prop.updatedAt, prop.lastFetchAt, prop.generatedAt, prop.startTime, prop.gameTime];
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
    String(prop.source || "").toLowerCase() !== "cache"
  );
}

function isBetterDuplicate(candidate = {}, incumbent = {}) {
  if (isLiveProp(candidate) !== isLiveProp(incumbent)) return isLiveProp(candidate);
  const confDelta =
    finiteOr(candidate.confidence ?? candidate.confidenceScore, BASE_CONFIDENCE) -
    finiteOr(incumbent.confidence ?? incumbent.confidenceScore, BASE_CONFIDENCE);
  if (confDelta !== 0) return confDelta > 0;
  return propTimestamp(candidate) > propTimestamp(incumbent);
}

export function dedupeDisplayProps(props = []) {
  const map = new Map();
  (props || []).forEach((prop) => {
    const key = buildPropDedupeKey(prop);
    const existing = map.get(key);
    if (!existing || isBetterDuplicate(prop, existing)) map.set(key, prop);
  });
  return Array.from(map.values());
}

function seededVariance(seed = "", min = 0.5, max = 2) {
  const t = (hashString(seed) % 1000) / 1000;
  return min + t * (max - min);
}

export function ensureDisplayProjection(prop = {}) {
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const existing = finiteOr(prop.projection ?? prop.projectedValue, NaN);
  if (Number.isFinite(existing) && Math.abs(existing - line) >= 0.1) return existing;
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

export function confidenceTierLabel(confidence = BASE_CONFIDENCE) {
  if (confidence >= 90) return "ELITE";
  if (confidence >= 80) return "STRONG";
  if (confidence >= 70) return "SAFE";
  if (confidence >= 60) return "RISKY";
  return "REJECT";
}

export function computeDisplayRiskLevel(confidence = BASE_CONFIDENCE) {
  if (confidence >= 80) return "LOW";
  if (confidence >= 60) return "MEDIUM";
  return "HIGH";
}

function computeWeightedConfidence(prop = {}, projection, line, edge) {
  let confidence = BASE_CONFIDENCE;
  const boostLabels = [];
  const penaltyLabels = [];

  const marketLine = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  if (Number.isFinite(marketLine)) {
    const lineValue = side.includes("under") ? line > marketLine : line < marketLine;
    if (lineValue) {
      confidence += 8;
      boostLabels.push("Line below market average");
    } else if (line > marketLine * 1.08 || line < marketLine * 0.92) {
      confidence -= 5;
      penaltyLabels.push("Line inflated vs market");
    }
  } else if (Math.abs(edge) >= 0.5) {
    confidence += 8;
    boostLabels.push("Line value vs projection");
  }

  const hit10 = finiteOr(prop.last10HitRate ?? prop.recentHitRate, NaN);
  if (Number.isFinite(hit10) && hit10 >= 0.7) {
    confidence += 7;
    boostLabels.push("70%+ hit rate last 10");
  } else if (Number.isFinite(hit10) && hit10 <= 0.35) {
    confidence -= 3;
    penaltyLabels.push("Recent cold streak");
  }

  const hit5 = finiteOr(prop.last5HitRate, NaN);
  if (Number.isFinite(hit5) && hit5 >= 0.6) {
    confidence += 3;
    boostLabels.push("Recent trend favorable");
  }

  if (prop.minutesTrend === "up" || /minutes up|role increase/i.test(String(prop.formNote || ""))) {
    confidence += 5;
    boostLabels.push("Projected minutes increase");
  }

  if (Number(prop.opponentRank) >= 24 || /weak|bottom/i.test(String(prop.matchupNote || prop.opponent || ""))) {
    confidence += 5;
    boostLabels.push("Favorable matchup");
  }

  if (Number(prop.usageDelta) > 0 || /usage up/i.test(String(prop.formNote || ""))) {
    confidence += 4;
    boostLabels.push("Usage rate increase");
  }

  if (prop.isHome === true || String(prop.homeAwaySplit).toLowerCase() === "home") {
    confidence += 4;
    boostLabels.push("Home game");
  }

  if (/pace up|fast pace/i.test(String(prop.matchupNote || prop.formNote || ""))) {
    confidence += 3;
    boostLabels.push("Pace-up matchup");
  }

  if (prop.teammateOut || /no competing|teammate out/i.test(String(prop.formNote || ""))) {
    confidence += 3;
    boostLabels.push("No competing teammate");
  }

  const movementTag = prop.lineMovementTag || prop.lineMovement?.tag;
  if (movementTag === "steam" && !prop.lineMovement?.againstPick) {
    confidence += 2;
    boostLabels.push("Favorable line movement");
  }

  if (prop.blowoutRisk || /blowout/i.test(String(prop.riskFlags || ""))) {
    confidence -= 8;
    penaltyLabels.push("Blowout risk");
  }

  if (prop.backToBack || /back-to-back|b2b/i.test(String(prop.formNote || ""))) {
    confidence -= 7;
    penaltyLabels.push("Back-to-back fatigue");
  }

  if (/questionable|gtd|doubtful/i.test(String(prop.injuryStatus || prop.statusNote || ""))) {
    confidence -= 6;
    penaltyLabels.push("Player questionable");
  }

  const vol = finiteOr(prop.volatility, NaN);
  if (Number.isFinite(vol) && vol >= 3) {
    confidence -= 5;
    penaltyLabels.push("Minutes/volatility risk");
  }

  const books = Number(prop.sportsbookBooksCount || prop.sportsbookComparison?.books || 0);
  if (books >= 2 && Number(prop.sportsbookEdge) < 0) {
    confidence -= 4;
    penaltyLabels.push("Sharp books disagree");
  } else if (books >= 2) {
    confidence += 5;
    boostLabels.push("Multiple books agree");
  }

  if (isLiveProp(prop)) {
    confidence += 2;
    boostLabels.push("Live source");
  }

  confidence += propVariance(prop);
  confidence = clamp(Math.round(confidence), 1, 99);

  return { confidence, boostLabels, penaltyLabels };
}

export function buildWhyThisPick(prop = {}) {
  const hitRate = finiteOr(prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate, NaN);
  const projection = finiteOr(prop.projection ?? prop.projectedValue, prop.line);
  const line = finiteOr(prop.line, 0);
  const delta = round1(projection - line);
  const marketLine = finiteOr(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine, NaN);
  const lineValue =
    Number.isFinite(marketLine) && line > 0 ? round1(((marketLine - line) / line) * 100) : null;

  const parts = [];
  if (Number.isFinite(hitRate)) parts.push(`Hit rate ${Math.round(hitRate * 100)}%`);
  if (prop.matchupNote || prop.opponent) parts.push(`Matchup: ${prop.matchupNote || prop.opponent}`);
  parts.push(`Projection ${projection} vs line ${line} (${delta >= 0 ? "+" : ""}${delta})`);
  if (lineValue != null) parts.push(`Line value ${lineValue}% vs books`);

  return {
    hitRate: Number.isFinite(hitRate) ? Math.round(hitRate * 100) : null,
    matchupEdge: prop.matchupNote || prop.opponent || "",
    projectionDelta: delta,
    lineValue,
    compact: parts.join(" · "),
  };
}

export function scoreDisplayProp(prop = {}) {
  const projection = ensureDisplayProjection(prop);
  const line = finiteOr(prop.line, 0);
  const side = String(prop.side || prop.bestPick || "over").toLowerCase();
  const edge = computeDisplayEdgeValue({ ...prop, projection, side });
  const { confidence, boostLabels, penaltyLabels } = computeWeightedConfidence(prop, projection, line, edge);
  const riskLevel = computeDisplayRiskLevel(confidence);
  const tier = confidenceTierLabel(confidence);
  const lineDiff = round1(projection - line);
  const signedDiff = lineDiff >= 0 ? `+${lineDiff}` : `${lineDiff}`;
  const whyThisPick = buildWhyThisPick({ ...prop, projection, edge, confidence });

  return {
    ...prop,
    projection,
    projectedValue: projection,
    edge,
    confidence,
    confidenceScore: confidence,
    riskLevel,
    confidenceTier: tier,
    confidenceBoostLabels: boostLabels,
    confidencePenaltyLabels: penaltyLabels,
    confidenceExplanation: whyThisPick.compact || `Projection ${projection} vs line ${line} (${signedDiff} edge)`,
    whyThisPick,
    edgeScore: round1(edge * (confidence / 50) + (finiteOr(prop.last10HitRate, 0.5) * 3)),
    scoringEngine: "display-weighted-v2",
    displayRejected: confidence < 60,
  };
}

export function enrichDisplayPropsPipeline(props = []) {
  return dedupeDisplayProps(props).map((prop) => scoreDisplayProp(prop));
}

export function sortPropsForDisplay(props = []) {
  return [...(props || [])].sort(
    (a, b) =>
      finiteOr(b.confidence, BASE_CONFIDENCE) - finiteOr(a.confidence, BASE_CONFIDENCE) ||
      finiteOr(b.edge, 0) - finiteOr(a.edge, 0) ||
      finiteOr(b.projection ?? b.projectedValue, 0) - finiteOr(a.projection ?? a.projectedValue, 0) ||
      finiteOr(b.last10HitRate ?? b.recentHitRate, 0) - finiteOr(a.last10HitRate ?? a.recentHitRate, 0) ||
      finiteOr(b.edgeScore, 0) - finiteOr(a.edgeScore, 0)
  );
}

function hasValidPlayerName(prop = {}) {
  const name = String(prop.player || prop.playerName || "").trim();
  return name.length >= 2 && !/^unknown player$/i.test(name);
}

function isCorrelated(a = {}, b = {}) {
  return playerKey(a) && playerKey(a) === playerKey(b);
}

export function selectTop2Picks(props = []) {
  const pool = sortPropsForDisplay(
    (props || []).filter(
      (prop) =>
        hasValidPlayerName(prop) &&
        finiteOr(prop.confidence, 0) >= MIN_TOP_PICK_CONFIDENCE &&
        finiteOr(prop.edge, 0) > 0 &&
        !prop.displayRejected
    )
  );

  const selected = [];
  for (const prop of pool) {
    if (selected.length >= 2) break;
    if (selected.some((pick) => isCorrelated(pick, prop))) continue;
    selected.push({ ...prop, topPick: true, whyThisPick: prop.whyThisPick || buildWhyThisPick(prop) });
  }
  return selected;
}

export function selectNearMissProps(props = []) {
  return sortPropsForDisplay(
    (props || []).filter((prop) => {
      const conf = finiteOr(prop.confidence, BASE_CONFIDENCE);
      return conf >= 45 && conf <= 59;
    })
  );
}

export function selectBestValueProps(props = []) {
  return sortPropsForDisplay(
    (props || []).filter((prop) => finiteOr(prop.confidence, BASE_CONFIDENCE) >= 60 && !prop.displayRejected)
  );
}

export function selectReadyToBetProps(props = []) {
  const sorted = sortPropsForDisplay(
    (props || []).filter((prop) => finiteOr(prop.confidence, BASE_CONFIDENCE) >= 50 && !prop.displayRejected)
  );
  if (sorted.length) return sorted;
  return sortPropsForDisplay(props).map((prop) => ({ ...prop, needsReview: true }));
}

export function selectDemonProps(props = []) {
  return sortPropsForDisplay(
    (props || []).filter((prop) => {
      const conf = finiteOr(prop.confidence, BASE_CONFIDENCE);
      const edge = finiteOr(prop.edge, 0);
      const upside = Math.abs(finiteOr(prop.projection, prop.line) - finiteOr(prop.line, 0));
      return conf >= 65 && conf <= 79 && (edge >= 2 || upside >= 1.5 || Number(prop.multiplier) > 1);
    })
  ).slice(0, 2);
}

export function selectGoblinProps(props = []) {
  return sortPropsForDisplay(
    (props || []).filter((prop) => {
      const conf = finiteOr(prop.confidence, BASE_CONFIDENCE);
      const hit = finiteOr(prop.last10HitRate ?? prop.recentHitRate, 0.55);
      const vol = finiteOr(prop.volatility, 2.5);
      return conf >= 80 && hit >= 0.55 && vol <= 2.75 && String(prop.riskLevel || "").toUpperCase() === "LOW";
    })
  ).slice(0, 2);
}

export function selectAcceptedDisplayProps(props = []) {
  const seenPlayers = new Set();
  return sortPropsForDisplay(props || []).filter((prop) => {
    if (!hasValidPlayerName(prop)) return false;
    if (finiteOr(prop.confidence, 0) < MIN_ACCEPTED_CONFIDENCE) return false;
    if (finiteOr(prop.edge, 0) < MIN_ACCEPTED_EDGE) return false;
    const src = String(prop.source || prop.platform || "").trim();
    if (!src || src.toLowerCase() === "unknown") return false;
    const pk = playerKey(prop);
    if (seenPlayers.has(pk)) return false;
    seenPlayers.add(pk);
    return true;
  });
}

export function riskAccentStyle(riskLevel = "") {
  const key = String(riskLevel || "").toUpperCase();
  if (key === "LOW") return { borderLeft: "3px solid #22c55e", boxShadow: "inset 0 0 0 1px rgba(34,197,94,0.12)" };
  if (key === "MEDIUM") return { borderLeft: "3px solid #eab308", boxShadow: "inset 0 0 0 1px rgba(234,179,8,0.12)" };
  if (key === "HIGH") return { borderLeft: "3px solid #ef4444", boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.12)" };
  return {};
}

export function matchesMarketQuickFilter(prop = {}, filter = "all") {
  if (!filter || filter === "all") return true;
  const stat = String(prop.statType || prop.market || prop.propType || "").toLowerCase();
  const map = {
    points: /point/,
    rebounds: /rebound/,
    assists: /assist/,
    pra: /pra|points \+ rebounds \+ assists|points rebounds assists/,
    threes: /three|3-pointer|3pm|threes/,
    fantasy: /fantasy/,
    goblins: /goblin/,
    demons: /demon/,
  };
  const pattern = map[filter];
  return pattern ? pattern.test(stat) || prop.isGoblin || prop.isDemon : true;
}
