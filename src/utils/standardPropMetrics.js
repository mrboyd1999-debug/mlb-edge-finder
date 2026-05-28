/** Canonical edge / probability metrics and trusted-sport validation for scoring. */

export const ALLOWED_SCORING_SPORTS = new Set(["NBA", "MLB", "NFL", "NHL"]);

const BLOCKED_SPORT_PATTERN = /\b(pga|lpga|golf|dp world|pga tour|liv golf)\b/i;

const TRUSTED_SPORT_ALIASES = {
  MLB: "MLB",
  BASEBALL: "MLB",
  NBA: "NBA",
  BASKETBALL: "NBA",
  NFL: "NFL",
  FOOTBALL: "NFL",
  NHL: "NHL",
  HOCKEY: "NHL",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function normalizeTrustedSportToken(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw === "Other" || raw === "Unsupported" || raw === "null" || raw === "undefined") {
    return null;
  }
  if (BLOCKED_SPORT_PATTERN.test(raw)) return null;
  const upper = raw.toUpperCase();
  if (TRUSTED_SPORT_ALIASES[upper]) return TRUSTED_SPORT_ALIASES[upper];
  if (ALLOWED_SCORING_SPORTS.has(upper)) return upper;
  return null;
}

/** Validate sport from explicit source fields only — never infer from player name or stat text. */
export function getTrustedSportFromProp(prop = {}) {
  const candidates = [prop.sport, prop.classifiedSport, prop.sourceSport, prop.leagueSport].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = normalizeTrustedSportToken(candidate);
    if (normalized) return normalized;
    if (BLOCKED_SPORT_PATTERN.test(String(candidate))) return null;
  }
  return null;
}

export function getBlockedSportRejectReason(prop = {}) {
  const candidates = [prop.sport, prop.classifiedSport, prop.sourceSport, prop.leagueSport].filter(Boolean);
  for (const candidate of candidates) {
    if (BLOCKED_SPORT_PATTERN.test(String(candidate))) {
      return `blocked sport: ${candidate}`;
    }
  }
  return "";
}

export function getScoringSportRejectReason(prop = {}) {
  const blocked = getBlockedSportRejectReason(prop);
  if (blocked) return blocked;
  const trusted = getTrustedSportFromProp(prop);
  if (trusted) return "";
  const raw = String(prop.sport || prop.classifiedSport || prop.sourceSport || prop.leagueSport || "").trim();
  if (!raw) return "missing sport";
  return `unsupported sport: ${raw}`;
}

export function isAllowedScoringSportProp(prop = {}) {
  return !getScoringSportRejectReason(prop);
}

/** Raw edge: projection minus line (positive favors OVER). */
export function computeStandardEdge(projection, line) {
  const proj = Number(projection);
  const ln = Number(line);
  if (!Number.isFinite(proj) || !Number.isFinite(ln)) return null;
  return round(proj - ln);
}

/** Display edge percent, clamped to [-50, +50]. */
export function computeStandardEdgePercent(edge, line) {
  const e = Number(edge);
  const ln = Number(line);
  if (!Number.isFinite(e) || !Number.isFinite(ln) || ln <= 0) return null;
  return Math.round(clamp((e / ln) * 100, -50, 50));
}

/** Probability score (1–99) from projection vs line — not a raw ratio elsewhere. */
export function computeStandardProbabilityScore(projection, line) {
  const proj = Number(projection);
  const ln = Number(line);
  if (!Number.isFinite(proj) || !Number.isFinite(ln) || proj < 0 || ln <= 0) return null;
  const baseProb = proj / (proj + ln);
  return clamp(Math.round(baseProb * 100), 1, 99);
}

export function computeStandardPropMetrics({ projection, line, edge = null } = {}) {
  const rawEdge =
    edge != null && Number.isFinite(Number(edge)) ? round(Number(edge)) : computeStandardEdge(projection, line);
  return {
    edge: rawEdge,
    edgePercent: computeStandardEdgePercent(rawEdge, line),
    probabilityScore: computeStandardProbabilityScore(projection, line),
  };
}

export function normalizeScoringSportLabel(value = "") {
  return normalizeTrustedSportToken(value);
}
