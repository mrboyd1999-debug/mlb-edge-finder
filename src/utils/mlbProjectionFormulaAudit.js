/**
 * MLB projection formula audit — expose formula path, SDIO fields, components, and range validation.
 */

import { resolveSportsDataPropLabel } from "../../api/lib/sportsDataMlbStatProjection.js";
import { resolvePropMarketKey } from "./marketNormalization.js";
import { resolveBestPlayStatSpecificProjection } from "./bestPlaysPipelineDebug.js";
import { validateProjectionAgainstCap } from "./projectionMarketCaps.js";

export const PROJECTION_FORMULA_ERROR = "PROJECTION FORMULA ERROR";

/** Expected per-game projection ranges for MLB markets. */
export const MLB_PROJECTION_FORMULA_RANGES = {
  hits: { min: 0, max: 3, label: "Hits" },
  runs: { min: 0, max: 2, label: "Runs" },
  rbis: { min: 0, max: 3, label: "RBIs" },
  hrr: { min: 1, max: 5, label: "Hits+Runs+RBIs" },
  totalBases: { min: 1, max: 6, label: "Total Bases" },
  fantasyScore: { min: 2, max: 25, label: "Fantasy Score" },
  strikeouts: { min: 2, max: 12, label: "Strikeouts" },
  hitsAllowed: { min: 2, max: 10, label: "Hits Allowed" },
  outs: { min: 12, max: 24, label: "Pitching Outs" },
  homeRuns: { min: 0, max: 2, label: "Home Runs" },
  earnedRuns: { min: 0, max: 6, label: "Earned Runs Allowed" },
};

const SDIO_FIELD_MAP = {
  hits: ["Hits"],
  runs: ["Runs"],
  rbis: ["RunsBattedIn", "RBI", "RBIs"],
  hrr: ["HitsRunsRBIs", "Hits", "Runs", "RunsBattedIn"],
  totalBases: ["TotalBases"],
  fantasyScore: ["FantasyPointsDraftKings", "FantasyPoints", "FantasyPointsFanDuel"],
  strikeouts: ["PitchingStrikeouts", "Strikeouts"],
  hitsAllowed: ["HitsAllowed", "PitchingHits"],
  outs: ["InningsPitchedDecimal", "InningsPitched"],
};

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round4(value) {
  const num = finite(value);
  if (num == null) return null;
  return Math.round(num * 10000) / 10000;
}

function pickField(row = {}, keys = []) {
  for (const key of keys) {
    const val = finite(row?.[key]);
    if (val != null) return val;
  }
  return null;
}

function resolveGamesCount(prop = {}, statRow = null) {
  const fromProp = finite(prop.sportsDataGames ?? prop.games ?? prop.sampleSize ?? prop.gamesPlayed);
  const fromRow = statRow
    ? pickField(statRow, ["Games", "GamesPlayed", "Appearances", "Started"])
    : null;
  const games = fromProp ?? fromRow;
  if (games != null && games > 0 && games <= 200) return games;
  if (fromRow != null && fromRow > 0 && fromRow <= 200) return fromRow;
  return games != null && games > 0 ? games : null;
}

function perGame(total, games) {
  const value = finite(total);
  const count = finite(games);
  if (value == null || count == null || count <= 0) return null;
  return round4(value / count);
}

function resolveSportsDataStatRow(prop = {}) {
  return prop.sportsDataSeason || prop.sportsDataRawStat || prop.sportsDataProjectionRow || null;
}

function resolveProjectionFormulaUsed(prop = {}) {
  const source = String(prop.projectionSource || prop.source || "").toLowerCase();
  if (/mlb-verified|player-stats-model|verified-engine/.test(source)) return "MLB Verified Engine (game logs + weighted form)";
  if (/sportsdataio-generated|sportsdataio-projections/.test(source)) return "SportsDataIO daily projection field";
  if (/sportsdataio-season|sportsdataio season/.test(source)) return "SportsDataIO season totals ÷ games";
  if (/stat-fallback|stat-fallback-weighted/.test(source)) return "Stat fallback (L5/season/line blend)";
  if (/merged/.test(source)) return "Merged projection pipeline";
  if (/sportsdataio/.test(source)) return "SportsDataIO enrichment";
  if (prop.isSportsDataSeasonProjection) return "SportsDataIO season totals ÷ games";
  if (prop.projectionBreakdown?.length) return "Model breakdown (projectionBreakdown)";
  return source ? `Other (${prop.projectionSource || prop.source})` : "Unknown / missing source";
}

function resolveRawSportsDataFields(prop = {}, marketKey = "") {
  const row = resolveSportsDataStatRow(prop);
  const keys = SDIO_FIELD_MAP[marketKey] || [];
  const fields = {};
  if (row && typeof row === "object" && !Array.isArray(row)) {
    for (const key of keys) {
      const val = finite(row[key]);
      if (val != null) fields[key] = val;
    }
    const games = pickField(row, ["Games", "GamesPlayed", "Appearances", "Started"]);
    if (games != null) fields.Games = games;
  }
  if (prop.sportsDataPropLabel) fields.propLabel = prop.sportsDataPropLabel;
  if (prop.sportsDataRawStat != null && typeof prop.sportsDataRawStat !== "object") {
    fields.rawStat = prop.sportsDataRawStat;
  }
  return Object.keys(fields).length ? fields : null;
}

function buildHrrComponents(prop = {}, statRow = null, games = null) {
  const row = statRow || resolveSportsDataStatRow(prop);
  const gameCount = games ?? resolveGamesCount(prop, row);
  if (!row || !gameCount) return null;

  const hitsTotal = pickField(row, ["Hits"]);
  const runsTotal = pickField(row, ["Runs"]);
  const rbisTotal = pickField(row, ["RunsBattedIn", "RBI", "RBIs"]);
  const hitsAvg = perGame(hitsTotal, gameCount);
  const runsAvg = perGame(runsTotal, gameCount);
  const rbisAvg = perGame(rbisTotal, gameCount);

  if (hitsAvg == null && runsAvg == null && rbisAvg == null) return null;

  const final =
    finite(prop.projection ?? prop.projectedValue) ??
    round4((hitsAvg ?? 0) + (runsAvg ?? 0) + (rbisAvg ?? 0));

  return {
    hitsAvg,
    runsAvg,
    rbisAvg,
    finalProjection: final,
    formula: "Hits/G + Runs/G + RBIs/G",
    gamesCount: gameCount,
  };
}

function buildMarketComponents(prop = {}, marketKey = "") {
  const row = resolveSportsDataStatRow(prop);
  const games = resolveGamesCount(prop, row);
  const propLabel = resolveSportsDataPropLabel(prop) || MLB_PROJECTION_FORMULA_RANGES[marketKey]?.label;

  if (marketKey === "hrr") {
    return buildHrrComponents(prop, row, games);
  }

  if (!row || !games) {
    const projection = finite(prop.projection ?? prop.projectedValue);
    return projection != null
      ? { finalProjection: round4(projection), formula: propLabel || marketKey, gamesCount: games }
      : null;
  }

  const fieldKeys = SDIO_FIELD_MAP[marketKey] || [];
  const rawTotal = pickField(row, fieldKeys);
  let perGameValue = perGame(rawTotal, games);

  if (marketKey === "outs" && perGameValue == null) {
    const ip = pickField(row, ["InningsPitchedDecimal", "InningsPitched"]);
    if (ip != null) perGameValue = round4((ip * 3) / games);
  }

  if (marketKey === "hrr" && perGameValue == null) {
    return buildHrrComponents(prop, row, games);
  }

  return {
    rawTotal: round4(rawTotal),
    perGameAverage: perGameValue,
    finalProjection: finite(prop.projection ?? prop.projectedValue) ?? perGameValue,
    formula: `${propLabel || marketKey}: season total ÷ games`,
    gamesCount: games,
  };
}

export function validateMlbProjectionFormulaRange(prop = {}, projection = null) {
  const marketKey = resolvePropMarketKey(prop);
  const proj = finite(projection ?? prop.projection ?? prop.projectedValue);
  const range = marketKey ? MLB_PROJECTION_FORMULA_RANGES[marketKey] : null;
  const capValidation = validateProjectionAgainstCap(prop, proj);

  if (!marketKey || proj == null) {
    return {
      valid: false,
      marketKey: marketKey || "",
      projection: proj,
      range: range || null,
      reason: "Projection or market key missing",
      flag: PROJECTION_FORMULA_ERROR,
    };
  }

  if (!range) {
    return {
      valid: capValidation.sanityFail !== true,
      marketKey,
      projection: proj,
      range: capValidation.cap,
      reason: capValidation.reason || "",
      flag: capValidation.sanityFail ? PROJECTION_FORMULA_ERROR : "",
    };
  }

  const inRange = proj >= range.min && proj <= range.max;
  const line = finite(prop.line);
  const implausibleVsLine =
    line != null &&
    line >= 1 &&
    ((marketKey === "hrr" && proj < 0.5 && line >= 2) ||
      (marketKey === "totalBases" && proj < 0.5 && line >= 1.5) ||
      (proj < line * 0.15 && ["hrr", "totalBases", "fantasyScore"].includes(marketKey)));

  if (inRange && !implausibleVsLine && !capValidation.sanityFail) {
    return {
      valid: true,
      marketKey,
      projection: proj,
      range,
      reason: "",
      flag: "",
    };
  }

  let reason = "";
  if (implausibleVsLine) {
    reason = `${range.label} projection ${proj} implausible vs line ${line}`;
  } else if (!inRange) {
    reason =
      proj < range.min
        ? `${range.label} projection ${proj} below min ${range.min}`
        : `${range.label} projection ${proj} exceeds max ${range.max}`;
  } else if (capValidation.sanityFail) {
    reason = capValidation.reason || "Projection cap validation failed";
  }

  return {
    valid: false,
    marketKey,
    projection: proj,
    range,
    reason,
    flag: PROJECTION_FORMULA_ERROR,
  };
}

export function passesMlbProjectionFormulaValidation(prop = {}) {
  const projection = resolveBestPlayStatSpecificProjection(prop) ?? finite(prop.projection ?? prop.projectedValue);
  return validateMlbProjectionFormulaRange(prop, projection).valid;
}

export function buildMlbProjectionFormulaAudit(prop = {}) {
  const marketKey = resolvePropMarketKey(prop);
  const market =
    MLB_PROJECTION_FORMULA_RANGES[marketKey]?.label ||
    String(prop.statType || prop.market || prop.propType || "Unknown").trim();
  const projection = resolveBestPlayStatSpecificProjection(prop) ?? finite(prop.projection ?? prop.projectedValue);
  const validation = validateMlbProjectionFormulaRange(prop, projection);
  const components = buildMarketComponents(prop, marketKey);
  const gamesCount = components?.gamesCount ?? resolveGamesCount(prop, resolveSportsDataStatRow(prop));
  const sampleSize = finite(prop.sampleSize ?? prop.games ?? prop.gamesPlayed ?? gamesCount);

  return {
    market,
    marketKey: marketKey || "",
    projectionFormulaUsed: resolveProjectionFormulaUsed(prop),
    rawSportsDataFields: resolveRawSportsDataFields(prop, marketKey),
    gamesCount,
    sampleSize,
    projectionComponents: components,
    projectionComponentsLabel: formatComponentsLabel(components, marketKey),
    projection,
    line: finite(prop.line),
    validation,
    projectionFormulaValid: validation.valid,
    projectionFormulaError: validation.valid ? "" : validation.flag,
    projectionFormulaErrorReason: validation.reason || "",
  };
}

function formatComponentsLabel(components, marketKey) {
  if (!components) return "—";
  if (marketKey === "hrr") {
    return [
      `Hits Avg: ${components.hitsAvg ?? "—"}`,
      `Runs Avg: ${components.runsAvg ?? "—"}`,
      `RBIs Avg: ${components.rbisAvg ?? "—"}`,
      `Final: ${components.finalProjection ?? "—"}`,
    ].join(" · ");
  }
  if (components.perGameAverage != null) {
    return `Per-game: ${components.perGameAverage} · Final: ${components.finalProjection ?? "—"}`;
  }
  return `Final: ${components.finalProjection ?? "—"}`;
}

export function summarizeProjectionFormulaErrors(rows = []) {
  const invalid = (rows || []).filter((row) => row?.projectionFormulaValid === false);
  return {
    total: rows?.length || 0,
    invalidCount: invalid.length,
    samples: invalid.slice(0, 5).map((row) => ({
      player: row.player,
      market: row.market,
      projection: row.projection ?? row.rawProjection,
      line: row.line,
      reason: row.projectionFormulaErrorReason,
    })),
  };
}
