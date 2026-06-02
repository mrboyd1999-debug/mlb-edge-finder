/** Graceful fallbacks for parser/projection paths — never crash the pipeline. */

export function safeParse(label, fn, fallback = null) {
  try {
    const result = fn();
    return result ?? fallback;
  } catch (error) {
    console.warn(`[SafeEngine] ${label} parse failed`, error);
    return fallback;
  }
}

export async function safeParseAsync(label, fn, fallback = null) {
  try {
    const result = await fn();
    return result ?? fallback;
  } catch (error) {
    console.warn(`[SafeEngine] ${label} async parse failed`, error);
    return fallback;
  }
}

export function safeNormalize(label, value, fallback = null) {
  if (value == null) return fallback;
  try {
    if (typeof value === "object" && !Array.isArray(value)) {
      return { ...value };
    }
    return value;
  } catch (error) {
    console.warn(`[SafeEngine] ${label} normalize failed`, error);
    return fallback;
  }
}

export function safeProjection(label, fn, fallback = { projectedValue: null, projectionSource: "missing", edge: 0, bestPick: "" }) {
  try {
    const result = fn();
    if (!result || typeof result !== "object") return fallback;
    return result;
  } catch (error) {
    console.warn(`[SafeEngine] ${label} projection failed`, error);
    return fallback;
  }
}

export function safePropArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}
