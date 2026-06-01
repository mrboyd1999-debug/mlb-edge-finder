import { normalizeSource } from "./normalizeSource.js";

function finiteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Canonical card shape — optional projection/confidence/edge. */
export function normalizeProp(prop = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  const line = finiteOrNull(prop.line);
  const projectionRaw = prop.projection ?? prop.projectedValue;
  const projection =
    projectionRaw != null && projectionRaw !== "" && Number(projectionRaw) > 0
      ? finiteOrNull(projectionRaw)
      : null;
  const edge = finiteOrNull(prop.edge);
  const confidenceRaw = prop.confidence ?? prop.confidenceScore;
  const confidence =
    confidenceRaw != null && confidenceRaw !== "" ? finiteOrNull(confidenceRaw) : null;
  const sportsbook = normalizeSource(prop) || String(prop.platform || prop.source || "").trim();

  return {
    player,
    playerName: player,
    team: String(prop.team || "").trim(),
    opponent: String(prop.opponent || "").trim(),
    statType,
    market: statType,
    propType: statType,
    line,
    projection,
    projectedValue: projection,
    edge,
    confidence,
    confidenceScore: confidence,
    sportsbook,
    platform: sportsbook,
    source: sportsbook,
    overOdds: finiteOrNull(prop.overOdds ?? prop.over_odds),
    underOdds: finiteOrNull(prop.underOdds ?? prop.under_odds),
  };
}

export function isMinimalRenderableProp(prop = {}) {
  const shaped = normalizeProp(prop);
  return (
    shaped.player.length >= 2 &&
    shaped.statType.length >= 1 &&
    Number.isFinite(shaped.line) &&
    shaped.line > 0
  );
}

export function mergeNormalizedProp(prop = {}) {
  return { ...prop, ...normalizeProp(prop) };
}

function resolveMlbLineUsed(prop = {}, { prizePicksLine, underdogLine, oddsApiLine } = {}) {
  const oddsLine = finiteOrNull(
    oddsApiLine ??
      prop.oddsApiLine ??
      prop.sportsbookLine ??
      prop.bestAvailableLine ??
      prop.lineComparison?.oddsApiLine
  );
  if (prizePicksLine != null) {
    return { lineUsed: prizePicksLine, lineSource: "PrizePicks" };
  }
  if (underdogLine != null) {
    return { lineUsed: underdogLine, lineSource: "Underdog" };
  }
  if (oddsLine != null) {
    return { lineUsed: oddsLine, lineSource: "Odds API" };
  }
  return {
    lineUsed: finiteOrNull(prop.lineUsed ?? prop.line),
    lineSource: null,
  };
}

function resolveLineSourceLabel(prop = {}, { prizePicksLine, underdogLine, lineSource } = {}) {
  if (lineSource) return lineSource;
  const raw = String(prop.lineSource || prop.lineSourceBadge || "").trim();
  if (raw && !/live_provider|cache_provider|null|undefined/i.test(raw)) return raw;

  const hasPp = prizePicksLine != null;
  const hasUd = underdogLine != null;
  const hasOdds = Boolean(
    prop.sportsbookLine != null ||
      prop.bestAvailableLine != null ||
      prop.oddsApiLine != null ||
      Number(prop.sportsbookBooksCount) > 0 ||
      /odds/i.test(String(prop.projectionSource || ""))
  );

  if (hasPp) return "PrizePicks";
  if (hasUd) return "Underdog";
  if (hasOdds) return "Odds API";
  if (hasPp && hasUd) return "PrizePicks";
  return null;
}

/** Attach canonical line fields for cards and modals. */
export function attachLineSourceFields(prop = {}) {
  const comparison = prop.lineComparison || {};
  const prizePicksLine = finiteOrNull(comparison.prizePicksLine ?? prop.prizePicksLine ?? prop.ppLine);
  const underdogLine = finiteOrNull(comparison.underdogLine ?? prop.underdogLine ?? prop.udLine);
  const oddsApiLine = finiteOrNull(
    comparison.oddsApiLine ??
      prop.oddsApiLine ??
      prop.sportsbookLine ??
      prop.bestAvailableLine
  );
  const consensusLine = finiteOrNull(
    comparison.consensusLine ??
      prop.consensusLine ??
      (prizePicksLine != null &&
      underdogLine != null &&
      Math.abs(prizePicksLine - underdogLine) < 0.01
        ? prizePicksLine
        : null)
  );
  const safeConsensus = consensusLine != null && consensusLine > 0 ? consensusLine : null;
  const { lineUsed, lineSource: primarySource } = resolveMlbLineUsed(prop, {
    prizePicksLine,
    underdogLine,
    oddsApiLine,
  });
  const lineSource = resolveLineSourceLabel(prop, { prizePicksLine, underdogLine, lineSource: primarySource });
  const providers = [];
  if (prizePicksLine != null) providers.push("PrizePicks");
  if (underdogLine != null) providers.push("Underdog");
  if (
    oddsApiLine != null ||
    prop.sportsbookLine != null ||
    prop.bestAvailableLine != null ||
    Number(prop.sportsbookBooksCount) > 0
  ) {
    providers.push("Odds API");
  }

  return {
    ...prop,
    prizePicksLine,
    underdogLine,
    oddsApiLine,
    consensusLine: safeConsensus,
    lineUsed,
    lineSource,
    providers,
  };
}
