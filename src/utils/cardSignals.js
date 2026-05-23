import { formatSignedNumber } from "./formatters.js";

export function lineMovementArrow(prop) {
  const movement = prop?.lineMovement || prop?.modelSignal?.lineMovement;
  if (!movement) return null;
  const move = Number(movement.move);
  if (!Number.isFinite(move)) return movement.label ? String(movement.label).slice(0, 12) : null;
  const arrow = move > 0 ? "▲" : move < 0 ? "▼" : "→";
  const formatted = Math.abs(move) % 1 === 0 ? String(Math.abs(move)) : Math.abs(move).toFixed(1);
  return `${arrow} ${move > 0 ? "+" : move < 0 ? "-" : ""}${formatted}`;
}

export function sportsbookCardTag(prop) {
  const discrepancy = Number(prop?.sportsbookDiscrepancy ?? prop?.modelSignal?.sportsbookDiscrepancy);
  if (!Number.isFinite(discrepancy) || discrepancy <= 0.25) return null;
  return `DFS softer · ${formatSignedNumber(discrepancy)}`;
}

export function parlayLegReason(prop) {
  if (prop?.topTwoReason) return `Included because: ${prop.topTwoReason}`;
  const parts = [];
  if (prop?.confidenceScore != null) parts.push(`${prop.confidenceScore}% conf`);
  if (Number.isFinite(Number(prop?.edge ?? prop?.edgeScore))) {
    parts.push(`${formatSignedNumber(prop.edge ?? prop.edgeScore)} edge`);
  }
  if (prop?.lineMovement?.supportsPick) parts.push("line moved your way");
  if (Number(prop?.sportsbookDiscrepancy) > 0) parts.push("books gap");
  if (!parts.length) return "";
  return `Included because: ${parts.join(", ")}`;
}

export function lineSourceBadgeStyle(badge) {
  const key = String(badge || "").toUpperCase();
  if (key === "VERIFIED") {
    return {
      fontSize: "10px",
      fontWeight: 800,
      padding: "2px 6px",
      borderRadius: "6px",
      border: "1px solid #2563eb",
      background: "#1e3a8a",
      color: "#dbeafe",
      letterSpacing: "0.04em",
    };
  }
  if (key === "LIVE") {
    return {
      fontSize: "10px",
      fontWeight: 800,
      padding: "2px 6px",
      borderRadius: "6px",
      border: "1px solid #16a34a",
      background: "#14532d",
      color: "#dcfce7",
      letterSpacing: "0.04em",
    };
  }
  if (key === "CACHED") {
    return {
      fontSize: "10px",
      fontWeight: 800,
      padding: "2px 6px",
      borderRadius: "6px",
      border: "1px solid #ca8a04",
      background: "#fcd34d",
      color: "#1f2937",
      letterSpacing: "0.04em",
    };
  }
  return {
    fontSize: "10px",
    fontWeight: 800,
    padding: "2px 6px",
    borderRadius: "6px",
    border: "1px solid #f43f5e",
    background: "#450a0a",
    color: "#fecaca",
    letterSpacing: "0.04em",
  };
}

export function resultStatusBadge(status) {
  const key = String(status || "Pending");
  if (key === "Win") return { label: "W", color: "#14532d", border: "#22c55e", text: "#dcfce7" };
  if (key === "Loss") return { label: "L", color: "#450a0a", border: "#ef4444", text: "#fecaca" };
  if (key === "Push") return { label: "P", color: "#1e293b", border: "#94a3b8", text: "#e2e8f0" };
  return { label: "·", color: "#1e293b", border: "#475569", text: "#94a3b8" };
}
