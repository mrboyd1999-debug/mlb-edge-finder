/**
 * Phase 1 — Saved picks and manual analyzer persistence.
 */
import {
  readHistory,
  writeHistory,
  readManualAnalyzerProps,
  writeManualAnalyzerProps,
} from "../services/pickStore.js";
import { isManualAnalyzerProp } from "../utils/manualPropBuilder.js";

export {
  readHistory,
  writeHistory,
  readManualAnalyzerProps,
  writeManualAnalyzerProps,
};

export function saveManualAnalyzerPick(prop, existingHistory = readHistory()) {
  if (!prop?.playerName) return existingHistory;
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    ...prop,
    date: today,
    slateDate: today,
    recommendationType: "Manual Analyzer Pick",
    categorySource: "manual-analyzer",
    manualAnalyzer: true,
    savedAt: new Date().toISOString(),
  };
  const deduped = existingHistory.filter((row) => row.id !== entry.id && row.uniqueKey !== entry.uniqueKey);
  const updated = [entry, ...deduped].slice(0, 500);
  writeHistory(updated);
  return updated;
}

export function removeManualAnalyzerProp(props = [], propId = "") {
  return (props || []).filter((row) => row.id !== propId);
}

export function upsertManualAnalyzerProp(props = [], analyzedProp = {}) {
  if (!analyzedProp?.id) return props;
  return [analyzedProp, ...(props || []).filter((row) => row.id !== analyzedProp.id)];
}

export function isSavedManualPick(prop = {}) {
  return Boolean(prop?.manualAnalyzer || isManualAnalyzerProp(prop));
}
