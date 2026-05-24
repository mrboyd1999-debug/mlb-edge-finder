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

export function formatRiskShort(prop = {}) {
  const text = String(prop.riskLevel || "").toUpperCase();
  if (text.includes("LOW")) return "LOW";
  if (text.includes("HIGH")) return "HIGH";
  if (text.includes("MED") || text.includes("MOD")) return "MED";
  return text.slice(0, 8) || "—";
}

export function normalizeSourceLabel(prop = {}) {
  const src = String(prop.platform || prop.source || "").trim();
  if (/prize/i.test(src)) return "PrizePicks";
  if (/underdog/i.test(src)) return "Underdog";
  return src || "—";
}
