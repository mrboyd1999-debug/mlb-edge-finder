/** Historical prop performance — last 5/10/20 windows. */

import { readHistory, readPropHistory, recordPropHistoryEntry } from "../services/pickStore.js";

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function pickStatus(row = {}) {
  return String(row.resultStatus || row.finalResult || row.result || "Pending");
}

function settledRows(rows = []) {
  return rows.filter((row) => ["Win", "Loss"].includes(pickStatus(row)));
}

function computeWindowStats(rows = []) {
  const settled = settledRows(rows);
  const wins = settled.filter((row) => pickStatus(row) === "Win").length;
  const sample = settled.length;
  const edges = settled.map((row) => Number(row.edge)).filter(Number.isFinite);
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
  const roiUnits = settled.reduce((sum, row) => {
    if (pickStatus(row) === "Win") return sum + 0.91;
    if (pickStatus(row) === "Loss") return sum - 1;
    return sum;
  }, 0);
  const roiPct = sample ? (roiUnits / sample) * 100 : null;

  let streakTrend = "flat";
  if (sample >= 3) {
    const recent = settled.slice(0, 3).map((row) => pickStatus(row));
    const winStreak = recent.every((s) => s === "Win");
    const lossStreak = recent.every((s) => s === "Loss");
    if (winStreak) streakTrend = "hot";
    else if (lossStreak) streakTrend = "cold";
  }

  return {
    sample,
    hitPct: sample ? Math.round((wins / sample) * 100) : null,
    avgEdge: avgEdge != null ? Math.round(avgEdge * 10) / 10 : null,
    roiPct: roiPct != null ? Math.round(roiPct * 10) / 10 : null,
    streakTrend,
    wins,
    losses: sample - wins,
  };
}

function mergeHistorySources() {
  const primary = readHistory();
  const compact = readPropHistory();
  const seen = new Set();
  const merged = [];
  [...primary, ...compact].forEach((row) => {
    const key = [
      row.playerName || row.player,
      row.statType || row.propType,
      row.line,
      row.timestamp || row.createdAt,
    ]
      .map(normalize)
      .join("|");
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });
  return merged.sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0));
}

export function buildHistoricalPerformance({ sport, playerName, statType } = {}) {
  const history = mergeHistorySources().filter((row) => {
    if (sport && sport !== "all" && normalize(row.sport) !== normalize(sport)) return false;
    if (playerName && normalize(row.playerName || row.player) !== normalize(playerName)) return false;
    if (statType && statType !== "all" && normalize(row.statType || row.propType) !== normalize(statType)) return false;
    return true;
  });

  return {
    last5: computeWindowStats(history.slice(0, 5)),
    last10: computeWindowStats(history.slice(0, 10)),
    last20: computeWindowStats(history.slice(0, 20)),
    totalTracked: history.length,
  };
}

export function attachHistoricalPerformance(prop = {}) {
  const perf = buildHistoricalPerformance({
    sport: prop.sport,
    playerName: prop.playerName || prop.player,
    statType: prop.statType || prop.propType,
  });
  return { ...prop, historicalPerformance: perf };
}

export function recordCalibratedPickSnapshot(prop = {}, outcome = {}) {
  recordPropHistoryEntry(
    {
      ...prop,
      confidenceScore: prop.confidence ?? prop.confidenceScore,
      projection: prop.projection ?? prop.projectedValue,
      sportsbook: prop.platform || prop.source,
    },
    outcome
  );
}
