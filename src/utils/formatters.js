export function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

export function formatMaybeLine(value) {
  return value != null && value !== "" && Number.isFinite(Number(value)) ? formatNumber(value) : "-";
}

export function formatSignedNumber(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const formatted = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return number > 0 ? `+${formatted}` : formatted;
}

export function formatLeanSide(value) {
  const key = normalize(value);
  if (key === "more" || key === "over" || key === "higher") return "Over";
  if (key === "less" || key === "under" || key === "lower") return "Under";
  return String(value || "Watch");
}

export function formatPercent(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${Math.round(number * 100)}%`;
}

export function formatSignedPercent(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const formatted = `${Math.round(number * 100)}%`;
  return number > 0 ? `+${formatted}` : formatted;
}

export function formatMultiplier(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(2)}x`;
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function shortReason(prop) {
  if (prop.elitePickExplanation?.compact) return prop.elitePickExplanation.compact;
  if (prop.topTwoReason) return prop.topTwoReason;
  if (prop.qualificationReason) return prop.qualificationReason;
  const edge = prop.edge ?? prop.projectionEdge;
  const lean = formatLeanSide(prop.bestPick || prop.side);
  const projected = prop.projectedValue ?? prop.projection;
  if (Number.isFinite(Number(projected))) {
    const edgeText = Number.isFinite(Number(edge)) && edge > 0 ? ` · ${formatSignedNumber(edge)} edge` : "";
    const confText = prop.confidenceScore ? ` · ${prop.confidenceScore}% conf` : "";
    return `Proj ${formatNumber(projected)}${edgeText}${confText}`;
  }
  if (!Number.isFinite(Number(edge)) || edge <= 0) return prop.reasoningSummary?.slice(0, 80) || "Building projection…";
  return `${lean} ${formatNumber(prop.line)} · ${formatSignedNumber(edge)} edge`;
}
