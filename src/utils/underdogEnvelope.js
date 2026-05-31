/** Underdog API/proxy envelope normalization — shared by parsers and services. */

function isLineLikeRecord(item = {}) {
  if (!item || typeof item !== "object") return false;
  return Boolean(
    item.stat_value != null ||
      item.line != null ||
      item.over_under ||
      item.overUnder ||
      item.appearance_id ||
      item.over_under_id
  );
}

function lineArrayFromEnvelope(payload = {}) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.over_under_lines) && payload.over_under_lines.length) {
    return payload.over_under_lines;
  }
  if (Array.isArray(payload.props) && payload.props.length && isLineLikeRecord(payload.props[0])) {
    return payload.props;
  }
  if (Array.isArray(payload.data) && payload.data.length && isLineLikeRecord(payload.data[0])) {
    return payload.data;
  }
  if (Array.isArray(payload.items) && payload.items.length && isLineLikeRecord(payload.items[0])) {
    return payload.items;
  }
  if (Array.isArray(payload.results) && payload.results.length && isLineLikeRecord(payload.results[0])) {
    return payload.results;
  }
  return [];
}

function envelopeLookupFields(payload = {}) {
  return {
    players: payload.players || payload.athletes || [],
    games: payload.games || payload.matches || [],
    appearances: payload.appearances || [],
    teams: payload.teams || [],
  };
}

/** Normalize proxy envelopes and raw API payloads — never let empty `data: []` hide `props`. */
export function unwrapUnderdogPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return payload || {};
  if (payload.over_under_lines || payload.players || payload.games || payload.appearances) {
    return payload;
  }
  if (payload?.source === "Underdog" && payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return unwrapUnderdogPayload(payload.data);
  }

  const lines = lineArrayFromEnvelope(payload);
  if (lines.length) {
    const lookup = envelopeLookupFields(payload);
    return { over_under_lines: lines, ...lookup };
  }

  if (Array.isArray(payload?.items)) return { over_under_lines: payload.items, ...envelopeLookupFields(payload) };
  if (Array.isArray(payload?.results)) return { over_under_lines: payload.results, ...envelopeLookupFields(payload) };
  return payload || {};
}

export function extractUnderdogLineRecords(payload) {
  const normalized = unwrapUnderdogPayload(payload);
  if (Array.isArray(normalized)) return normalized;
  if (normalized && typeof normalized === "object") {
    const lines =
      normalized.over_under_lines ||
      normalized.overUnders ||
      normalized.data ||
      normalized.items ||
      normalized.results ||
      normalized.props ||
      [];
    if (Array.isArray(lines) && lines.length) return lines;
  }
  return lineArrayFromEnvelope(payload);
}
