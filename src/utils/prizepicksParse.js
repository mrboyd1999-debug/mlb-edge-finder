/** Safe PrizePicks JSON:API parsing — never throws. */

export const EMPTY_PRIZEPICKS_PAYLOAD = Object.freeze({ data: [], included: [] });

export function normalizePrizePicksResponse(raw) {
  if (!raw) return { ...EMPTY_PRIZEPICKS_PAYLOAD };
  if (Array.isArray(raw)) return { data: raw, included: [] };
  if (Array.isArray(raw?.data?.data)) {
    return { data: raw.data.data, included: raw.data.included || [] };
  }
  if (Array.isArray(raw.data)) {
    return { data: raw.data, included: raw.included || [] };
  }
  if (Array.isArray(raw.props)) {
    return { data: raw.props, included: raw.included || raw.data?.included || [] };
  }
  return { ...EMPTY_PRIZEPICKS_PAYLOAD };
}

export function buildIncludedRecordMap(included = []) {
  const map = new Map();
  if (!Array.isArray(included)) return map;
  included.forEach((record) => {
    if (!record?.id) return;
    map.set(`${record.type}:${record.id}`, record);
    if (record.type === "new_player" || record.type === "player") {
      map.set(String(record.id), record);
    }
  });
  return map;
}

export function buildPlayerAttributeMap(included = []) {
  const playerMap = new Map();
  if (!Array.isArray(included)) return playerMap;
  included.forEach((record) => {
    if (record?.type === "new_player" || record?.type === "player") {
      playerMap.set(String(record.id), record.attributes || {});
    }
  });
  return playerMap;
}

export function resolvePrizePicksPlayer(item = {}, includedMap = new Map(), playerMap = new Map()) {
  const rel = item.relationships?.new_player || item.relationships?.player;
  const relId = rel?.data?.id ?? (Array.isArray(rel?.data) ? rel.data[0]?.id : null);
  if (relId != null) {
    const fromAttrMap = playerMap.get(String(relId));
    if (fromAttrMap) return fromAttrMap;
    const record =
      includedMap.get(`new_player:${relId}`) ||
      includedMap.get(`player:${relId}`) ||
      includedMap.get(String(relId));
    if (record?.attributes) return record.attributes;
  }
  return null;
}

export function parsePrizePicksProjections(payload = {}) {
  const { data, included } = normalizePrizePicksResponse(payload);
  if (!Array.isArray(data) || !data.length) return [];

  const includedMap = buildIncludedRecordMap(included);
  const playerMap = buildPlayerAttributeMap(included);

  return data
    .map((item) => {
      const attrs = item?.attributes || {};
      const player = resolvePrizePicksPlayer(item, includedMap, playerMap);
      const line = Number(attrs.line_score ?? attrs.line ?? attrs.projection);
      const statType = attrs.stat_type || attrs.stat_display_name || attrs.description || "";
      const playerName =
        player?.display_name ||
        player?.name ||
        player?.full_name ||
        attrs.player_name ||
        attrs.description ||
        "";

      return {
        id: item?.id || "",
        player: playerName || "Unknown",
        team: player?.team || player?.team_abbr || player?.team_name || "UNK",
        statType,
        line,
        startTime: attrs.start_time || attrs.board_time || attrs.game_time || "",
        oddsType: attrs.odds_type || "standard",
        raw: item,
        playerAttributes: player,
      };
    })
    .filter((row) => row.player && row.player !== "Unknown" && row.statType && Number.isFinite(row.line));
}

export function logPrizePicksRawSample(payload, { label = "PRIZEPICKS RAW" } = {}) {
  try {
    const text = JSON.stringify(payload, null, 2);
    console.log(label + ":", text.slice(0, 5000));
  } catch {
    console.log(label + ":", "unserializable payload");
  }
}
