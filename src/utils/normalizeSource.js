export function propProviderText(prop = {}) {
  try {
    return JSON.stringify(prop).toLowerCase();
  } catch {
    return "";
  }
}

export function propTextIncludesUnderdog(prop = {}) {
  return propProviderText(prop).includes("underdog");
}

export function propTextIncludesPrizePicks(prop = {}) {
  const text = propProviderText(prop);
  return text.includes("prizepicks") || /\bpp\b/.test(text);
}

export function normalizeSource(prop = {}) {
  const raw = String(
    prop.source ||
    prop.platform ||
    prop.book ||
    prop.bookmaker ||
    prop.provider ||
    prop.feedSource ||
    ""
  ).toLowerCase();
  if (raw.includes("underdog") || raw === "ud" || /\bud\b/.test(raw)) return "underdog";
  if (raw.includes("prizepicks") || raw === "pp" || /\bpp\b/.test(raw)) return "prizepicks";
  if (raw.includes("sleeper")) return "sleeper";
  if (raw.includes("chalkboard")) return "chalkboard";
  if (propTextIncludesUnderdog(prop)) return "underdog";
  if (propTextIncludesPrizePicks(prop)) return "prizepicks";
  return raw;
}

export function withNormalizedSource(prop) {
  const normalizedSource = normalizeSource(prop);
  return { ...prop, normalizedSource };
}

export function normalizePropsWithSource(props = []) {
  return (props || []).map(withNormalizedSource);
}
