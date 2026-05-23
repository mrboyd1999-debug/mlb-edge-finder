/**
 * Normalize game start times from API feeds (ISO, unix, offsets, missing TZ).
 * Returns ISO string or "" if unparseable.
 */
export function normalizeGameStartTime(value, options = {}) {
  const fallbackHours = Number(options.fallbackHoursFromNow ?? 4);
  const raw = value == null ? "" : value;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }

  const text = String(raw).trim();
  if (!text) {
    if (options.allowFallback) {
      return new Date(Date.now() + fallbackHours * 60 * 60 * 1000).toISOString();
    }
    return "";
  }

  if (/^\d{10,13}$/.test(text)) {
    const n = Number(text);
    const ms = text.length <= 10 ? n * 1000 : n;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }

  let candidate = text;
  if (/^\d{4}-\d{2}-\d{2} /.test(candidate) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(candidate)) {
    candidate = candidate.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(candidate) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(candidate)) {
    candidate = `${candidate}Z`;
  }

  const parsed = new Date(candidate);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();

  const loose = Date.parse(text);
  if (Number.isFinite(loose)) return new Date(loose).toISOString();

  if (options.allowFallback) {
    return new Date(Date.now() + fallbackHours * 60 * 60 * 1000).toISOString();
  }
  return "";
}

export function isValidStartTime(value) {
  const normalized = normalizeGameStartTime(value, { allowFallback: false });
  return Boolean(normalized);
}

export function startTimeUncertainty(value) {
  const normalized = normalizeGameStartTime(value, { allowFallback: false });
  if (!normalized) return "missing";
  const raw = String(value || "").trim();
  if (!raw) return "missing";
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) && !/^\d{10,13}$/.test(raw)) return "timezone-assumed";
  return "ok";
}
