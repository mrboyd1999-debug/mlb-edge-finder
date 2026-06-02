/** Null-safe helpers for historical / statistical fields. */

export function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function safeFixed(value, digits = 1, empty = "—") {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toFixed(digits) : empty;
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function safePropNumber(prop, key, fallback = 0) {
  return safeNumber(prop?.[key], fallback);
}
