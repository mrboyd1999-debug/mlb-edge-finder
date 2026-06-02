/**
 * Merge PrizePicks / Underdog / Odds API lines onto display props.
 */

import { attachLineSourceFields } from "./normalizeProp.js";
import { formatNumber } from "./formatters.js";

function finiteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePlatform(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (/prize.?picks/.test(text)) return "prizepicks";
  if (/underdog/.test(text)) return "underdog";
  if (/odds/.test(text)) return "odds";
  return text;
}

export function propLineMergeKey(prop = {}) {
  const player = String(prop.playerName || prop.player || "").trim().toLowerCase();
  const market = String(prop.statType || prop.market || prop.propType || "").trim().toLowerCase();
  return `${player}|${market}`;
}

export function buildProviderLineComparisonMap(props = []) {
  const grouped = new Map();
  for (const prop of props || []) {
    const key = propLineMergeKey(prop);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(prop);
  }

  const comparisons = new Map();
  grouped.forEach((group, key) => {
    const prizePicks = group.find((row) => normalizePlatform(row.platform || row.source) === "prizepicks");
    const underdog = group.find((row) => normalizePlatform(row.platform || row.source) === "underdog");
    const odds = group.find(
      (row) =>
        normalizePlatform(row.platform || row.source) === "odds" ||
        row.sportsbookLine != null ||
        row.oddsApiLine != null
    );

    const prizePicksLine = finiteOrNull(
      prizePicks?.line ?? prizePicks?.prizePicksLine ?? prizePicks?.ppLine
    );
    const underdogLine = finiteOrNull(underdog?.line ?? underdog?.underdogLine ?? underdog?.udLine);
    const oddsApiLine = finiteOrNull(
      odds?.oddsApiLine ?? odds?.sportsbookLine ?? odds?.bestAvailableLine ?? odds?.line
    );

    if (prizePicksLine == null && underdogLine == null && oddsApiLine == null) return;

    const lines = [prizePicksLine, underdogLine, oddsApiLine].filter((value) => value != null);
    let consensusLine = null;
    if (prizePicksLine != null && underdogLine != null && Math.abs(prizePicksLine - underdogLine) < 0.01) {
      consensusLine = prizePicksLine;
    } else if (lines.length >= 2) {
      const min = Math.min(...lines);
      const max = Math.max(...lines);
      if (Math.abs(max - min) < 0.01) consensusLine = min;
    }

    comparisons.set(key, {
      prizePicksLine,
      underdogLine,
      oddsApiLine,
      consensusLine,
      marketAverageLine: lines.length ? lines.reduce((sum, value) => sum + value, 0) / lines.length : null,
    });
  });

  return comparisons;
}

export function attachMergedLineComparison(prop = {}, comparisonMap = new Map()) {
  const key = propLineMergeKey(prop);
  const merged = comparisonMap.get(key) || {};
  const platform = normalizePlatform(prop.platform || prop.source || prop.normalizedSource);
  const lineComparison = {
    ...(prop.lineComparison || {}),
    ...merged,
    prizePicksLine: merged.prizePicksLine ?? prop.lineComparison?.prizePicksLine ?? prop.prizePicksLine ?? (platform === "prizepicks" ? finiteOrNull(prop.line) : null),
    underdogLine: merged.underdogLine ?? prop.lineComparison?.underdogLine ?? prop.underdogLine ?? (platform === "underdog" ? finiteOrNull(prop.line) : null),
    oddsApiLine:
      merged.oddsApiLine ??
      prop.lineComparison?.oddsApiLine ??
      prop.oddsApiLine ??
      prop.sportsbookLine ??
      (platform === "odds" ? finiteOrNull(prop.line) : null),
    consensusLine: merged.consensusLine ?? prop.lineComparison?.consensusLine ?? prop.consensusLine ?? null,
  };

  return attachLineSourceFields({
    ...prop,
    lineComparison,
    prizePicksLine: lineComparison.prizePicksLine,
    underdogLine: lineComparison.underdogLine,
    oddsApiLine: lineComparison.oddsApiLine,
    consensusLine: lineComparison.consensusLine,
  });
}

export function attachMergedLineComparisons(props = [], pool = []) {
  const comparisonMap = buildProviderLineComparisonMap(pool.length ? pool : props);
  return (props || []).map((prop) => attachMergedLineComparison(prop, comparisonMap));
}

export function resolveProviderLineDisplayRows(prop = {}) {
  const withLines = attachLineSourceFields(prop);
  const rows = [];
  if (withLines.prizePicksLine != null) {
    rows.push({ label: "PrizePicks", value: formatNumber(withLines.prizePicksLine) });
  }
  if (withLines.underdogLine != null) {
    rows.push({ label: "Underdog", value: formatNumber(withLines.underdogLine) });
  }
  const consensus =
    finiteOrNull(withLines.consensusLine ?? withLines.lineComparison?.consensusLine) ??
    (withLines.prizePicksLine != null &&
    withLines.underdogLine != null &&
    Math.abs(withLines.prizePicksLine - withLines.underdogLine) < 0.01
      ? withLines.prizePicksLine
      : null);
  if (consensus != null && consensus > 0) {
    rows.push({ label: "Consensus", value: formatNumber(consensus) });
  }
  const lineSource = withLines.lineSource || "Line";
  if (withLines.lineUsed != null) {
    rows.push({
      label: "Line Used",
      value: lineSource,
      detail: formatNumber(withLines.lineUsed),
    });
  }
  return rows;
}
