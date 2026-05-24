import { normalize } from "./formatters.js";

/** Resolve OVER / UNDER / WATCH from prop fields or projection vs line. */
export function resolvePickSide(prop = {}) {
  const raw = prop.bestPick || prop.side || prop.pickDirection || prop.pick || "";
  const key = normalize(raw);
  if (key === "more" || key === "over" || key === "higher") return "OVER";
  if (key === "less" || key === "under" || key === "lower") return "UNDER";

  const line = Number(prop.line);
  const projection = Number(prop.projectedValue ?? prop.projection);
  if (Number.isFinite(line) && Number.isFinite(projection) && projection !== line) {
    return projection > line ? "OVER" : "UNDER";
  }

  const edge = Number(prop.edge ?? prop.projectionEdge);
  if (Number.isFinite(edge) && edge !== 0) {
    return edge > 0 ? "OVER" : "UNDER";
  }

  return "WATCH";
}

export function recommendationPalette(side = "") {
  if (side === "OVER") {
    return {
      bg: "#14532d",
      border: "#22c55e",
      color: "#86efac",
      bannerBg: "#052e16",
      bannerText: "#dcfce7",
    };
  }
  if (side === "UNDER") {
    return {
      bg: "#431407",
      border: "#f97316",
      color: "#fdba74",
      bannerBg: "#7c2d12",
      bannerText: "#ffedd5",
    };
  }
  return {
    bg: "#1e293b",
    border: "#475569",
    color: "#cbd5e1",
    bannerBg: "#0f172a",
    bannerText: "#94a3b8",
  };
}

export function formatRecommendationLabel(side = "", { streak = false } = {}) {
  if (side === "OVER") return streak ? "TAKE OVER" : "OVER";
  if (side === "UNDER") return streak ? "TAKE UNDER" : "UNDER";
  return "WATCH";
}

export function formatDfsSide(side = "", prop = null) {
  const platform = String(prop?.platform || prop?.source || prop?.normalizedSource || "").toLowerCase();
  const isUnderdog = /underdog/.test(platform) || prop?.normalizedSource === "underdog";
  if (side === "OVER") return isUnderdog ? "Higher" : "More";
  if (side === "UNDER") return isUnderdog ? "Lower" : "Less";
  return "Watch";
}

export function formatPlatformSideLabel(prop = {}) {
  const side = resolvePickSide(prop);
  return formatDfsSide(side, prop);
}

export function formatRiskShort(prop = {}) {
  const text = String(prop.riskLevel || "").toUpperCase();
  if (text.includes("LOW")) return "LOW";
  if (text.includes("HIGH")) return "HIGH";
  if (text.includes("MED") || text.includes("MOD")) return "MED";
  return text.slice(0, 8) || "—";
}

export function formatRiskLevel(prop = {}) {
  const text = String(prop.riskLevel || "").toUpperCase();
  if (text.includes("LOW")) return "Low";
  if (text.includes("HIGH")) return "High";
  if (text.includes("MED") || text.includes("MOD")) return "Medium";

  const conf = Number(prop.confidenceScore ?? prop.confidence ?? NaN);
  if (Number.isFinite(conf)) {
    if (conf >= 74) return "Low";
    if (conf >= 60) return "Medium";
    return "High";
  }
  return "Medium";
}

export function riskLevelPalette(level = "") {
  const key = String(level || "").toLowerCase();
  if (key.includes("low")) {
    return { bg: "#052e16", border: "#22c55e", color: "#86efac" };
  }
  if (key.includes("high")) {
    return { bg: "#450a0a", border: "#ef4444", color: "#fca5a5" };
  }
  return { bg: "#422006", border: "#ca8a04", color: "#fde68a" };
}

export function platformBadgePalette(platform = "") {
  const key = String(platform || "").toLowerCase();
  if (/prize/.test(key)) {
    return { bg: "#2e1065", border: "#7c3aed", color: "#ddd6fe", label: "PrizePicks" };
  }
  if (/underdog/.test(key)) {
    return { bg: "#422006", border: "#eab308", color: "#fef08a", label: "Underdog" };
  }
  return { bg: "#1e293b", border: "#475569", color: "#cbd5e1", label: platform || "DFS" };
}

export function normalizeSourceLabel(prop = {}) {
  const src = String(prop.platform || prop.source || "").trim();
  if (/prize/i.test(src)) return "PrizePicks";
  if (/underdog/i.test(src)) return "Underdog";
  return src || "—";
}
