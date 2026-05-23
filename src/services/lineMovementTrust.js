import { isVerifiedSportsbookProp } from "../utils/propValidation.js";

const TINY_MOVE_THRESHOLD = 0.25;
const MEANINGFUL_MOVE = 0.5;
const STEAMED_THRESHOLD = 1.0;
const VOLATILE_THRESHOLD = 0.75;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Line movement speed — magnitude per hour since first seen. */
export function computeMovementSpeed({
  firstSeenAt = "",
  lastSeenAt = "",
  absMove = 0,
  previousLine = null,
  currentLine = null,
} = {}) {
  const start = new Date(firstSeenAt).getTime();
  const end = new Date(lastSeenAt || Date.now()).getTime();
  const hours = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 3600000 : 0;
  const recent =
    Number.isFinite(previousLine) && Number.isFinite(currentLine) ? Math.abs(currentLine - previousLine) : 0;
  const magnitude = Math.max(absMove, recent);
  if (!hours || hours < 0.05) return round(magnitude, 3);
  return round(magnitude / hours, 3);
}

/** stable | rising | falling | steamed | volatile */
export function classifyLineMovementTag({
  move = 0,
  absMove = 0,
  supportsPick = false,
  againstPick = false,
  previousLine = null,
  currentLine = null,
  movementSpeed = 0,
} = {}) {
  const recent =
    Number.isFinite(previousLine) && Number.isFinite(currentLine) ? Math.abs(currentLine - previousLine) : 0;
  const speed = Number(movementSpeed) || 0;

  if (absMove >= STEAMED_THRESHOLD || recent >= STEAMED_THRESHOLD * 0.75 || speed >= 1.2) {
    return "steamed";
  }
  if (absMove >= VOLATILE_THRESHOLD || recent >= VOLATILE_THRESHOLD * 0.55 || speed >= 0.65) {
    return "volatile";
  }
  if (absMove < TINY_MOVE_THRESHOLD) return "stable";
  if (move > 0) return "rising";
  if (move < 0) return "falling";
  return "stable";
}

export function lineMovementTrustScore(prop = {}, movement = null) {
  const lineMovement = movement || prop.lineMovement || {};
  const openingLine = finiteNumber(lineMovement.openingLine);
  const currentLine = finiteNumber(lineMovement.currentLine ?? prop.line);
  const previousLine = finiteNumber(lineMovement.previousLine);
  const bestPick = String(prop.bestPick || prop.side || "").toLowerCase();
  const verified = isVerifiedSportsbookProp(prop);

  let score = 50;
  const notes = [];

  if (!Number.isFinite(openingLine) || !Number.isFinite(currentLine)) {
    return {
      score: verified ? 52 : 45,
      label: "No movement history",
      supportsPick: false,
      againstPick: false,
      movementAmount: 0,
      movementDirection: "flat",
      movementSpeed: 0,
      tag: "stable",
      note: verified ? "Verified line — no movement tracked yet." : "Movement unavailable.",
    };
  }

  const move = round(currentLine - openingLine);
  const absMove = Math.abs(move);
  const direction = move === 0 ? "flat" : move > 0 ? "up" : "down";

  let supportsPick = false;
  let againstPick = false;
  if (bestPick === "more" || bestPick === "over") {
    supportsPick = move < -TINY_MOVE_THRESHOLD;
    againstPick = move > TINY_MOVE_THRESHOLD;
  } else if (bestPick === "less" || bestPick === "under") {
    supportsPick = move > TINY_MOVE_THRESHOLD;
    againstPick = move < -TINY_MOVE_THRESHOLD;
  }

  if (absMove < TINY_MOVE_THRESHOLD) {
    score = 50;
    notes.push("flat line");
  } else if (absMove < MEANINGFUL_MOVE) {
    score += supportsPick ? 5 : againstPick ? -5 : 0;
    notes.push("minor move");
  } else {
    score += supportsPick ? 16 : againstPick ? -18 : 0;
    notes.push(`${direction} ${absMove}`);
  }

  if (Number.isFinite(previousLine) && previousLine !== currentLine) {
    const recentMove = round(currentLine - previousLine);
    if (Math.abs(recentMove) >= TINY_MOVE_THRESHOLD) {
      notes.push(`recent ${recentMove > 0 ? "up" : "down"} ${Math.abs(recentMove)}`);
    }
  }

  const movementSpeed = computeMovementSpeed({
    firstSeenAt: lineMovement.firstSeenAt,
    lastSeenAt: lineMovement.lastSeenAt,
    absMove,
    previousLine,
    currentLine,
  });
  const tag = classifyLineMovementTag({
    move,
    absMove,
    supportsPick,
    againstPick,
    previousLine,
    currentLine,
    movementSpeed,
  });

  if (tag === "steamed" && againstPick) {
    score -= 10;
    notes.push("steamed against pick");
  } else if (tag === "volatile") {
    score -= 4;
    notes.push("volatile line");
  } else if (tag === "falling" && supportsPick) {
    score += 3;
    notes.push("sharp move supports pick");
  } else if (tag === "rising" && supportsPick) {
    score += 2;
  }

  if (prop.lineSourceBadge === "CACHED") {
    score -= 6;
    notes.push("cached line");
  } else if (verified && prop.bookDisagreement?.softLine) {
    score += 6;
    notes.push("verified soft line");
  }

  if (prop.bookDisagreement?.sharpDisagreement && againstPick) {
    score -= 8;
    notes.push("sharp disagreement");
  }

  score = round(clamp(score, 0, 100));

  return {
    score,
    label: supportsPick ? "Supports pick" : againstPick ? "Against pick" : direction === "flat" ? "Flat" : "Neutral",
    supportsPick,
    againstPick,
    movementAmount: absMove,
    movementDirection: direction,
    movementSpeed,
    tag,
    volatility: round(absMove + (Number.isFinite(previousLine) ? Math.abs(currentLine - previousLine) : 0), 2),
    openingLine,
    currentLine,
    previousLine,
    note: notes.join(" · ") || "No notable movement.",
  };
}

export function enrichLineMovementWithTags(movement = {}, bestPick = "") {
  if (!movement || typeof movement !== "object") return movement;
  const openingLine = finiteNumber(movement.openingLine);
  const currentLine = finiteNumber(movement.currentLine);
  const previousLine = finiteNumber(movement.previousLine);
  if (!Number.isFinite(openingLine) || !Number.isFinite(currentLine)) return movement;
  const move = currentLine - openingLine;
  const absMove = Math.abs(move);
  const pick = String(bestPick || "").toLowerCase();
  let supportsPick = movement.supportsPick;
  let againstPick = movement.againstPick;
  if (supportsPick == null && againstPick == null) {
    if (pick === "more" || pick === "over") {
      supportsPick = move < -TINY_MOVE_THRESHOLD;
      againstPick = move > TINY_MOVE_THRESHOLD;
    } else if (pick === "less" || pick === "under") {
      supportsPick = move > TINY_MOVE_THRESHOLD;
      againstPick = move < -TINY_MOVE_THRESHOLD;
    }
  }
  const movementSpeed = computeMovementSpeed({
    firstSeenAt: movement.firstSeenAt,
    lastSeenAt: movement.lastSeenAt,
    absMove,
    previousLine,
    currentLine,
  });
  const tag = classifyLineMovementTag({
    move,
    absMove,
    supportsPick,
    againstPick,
    previousLine,
    currentLine,
    movementSpeed,
  });
  return {
    ...movement,
    move,
    amount: absMove,
    tag,
    movementSpeed,
    volatility: round(absMove + (Number.isFinite(previousLine) ? Math.abs(currentLine - previousLine) : 0), 2),
    supportsPick: Boolean(supportsPick),
    againstPick: Boolean(againstPick),
  };
}

export function enrichLineMovementRecord(existing = {}, currentLine, now = new Date().toISOString()) {
  const line = finiteNumber(currentLine);
  if (!Number.isFinite(line)) return existing;

  const prevCurrent = finiteNumber(existing.currentLine);
  const opening = finiteNumber(existing.openingLine) ?? line;

  return {
    ...existing,
    openingLine: opening,
    previousLine: Number.isFinite(prevCurrent) && prevCurrent !== line ? prevCurrent : existing.previousLine ?? opening,
    currentLine: line,
    firstSeenAt: existing.firstSeenAt || now,
    lastSeenAt: now,
  };
}
