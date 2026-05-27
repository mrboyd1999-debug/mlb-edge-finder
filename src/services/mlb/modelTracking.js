/**
 * Track MLB projection outcomes for model accuracy / CLV / ROI.
 */

const STORAGE_KEY = "mlb-model-tracking-v1";

function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeStore(rows) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-5000)));
  } catch {
    // ignore quota errors
  }
}

export function recordMlbProjectionOutcome({
  player,
  statType,
  line,
  projection,
  confidence,
  side,
  finalResult = null,
  hit = null,
  clv = null,
  roi = null,
  source = "",
} = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    player,
    statType,
    line,
    projection,
    confidence,
    side,
    finalResult,
    hit,
    clv,
    roi,
    source,
    recordedAt: new Date().toISOString(),
  };
  const rows = readStore();
  rows.push(entry);
  writeStore(rows);
  return entry;
}

export function getMlbModelTrackingSummary(limit = 500) {
  const rows = readStore().slice(-limit);
  const resolved = rows.filter((row) => row.hit != null);
  const hits = resolved.filter((row) => row.hit === true).length;
  const avgClv =
    resolved.reduce((sum, row) => sum + (Number(row.clv) || 0), 0) / Math.max(resolved.length, 1);
  const avgRoi =
    resolved.reduce((sum, row) => sum + (Number(row.roi) || 0), 0) / Math.max(resolved.length, 1);

  return {
    total: rows.length,
    resolved: resolved.length,
    hitRate: resolved.length ? hits / resolved.length : null,
    avgClv: Number(avgClv.toFixed(4)),
    avgRoi: Number(avgRoi.toFixed(4)),
    recent: rows.slice(-20),
  };
}

export function clearMlbModelTracking() {
  writeStore([]);
}
