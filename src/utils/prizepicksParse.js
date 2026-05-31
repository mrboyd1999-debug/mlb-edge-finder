/** Safe PrizePicks JSON:API parsing — never throws. */

export const EMPTY_PRIZEPICKS_PAYLOAD = Object.freeze({ data: [], included: [] });

export function isPrizePicksBlockPayload(raw) {
  return Boolean(raw && typeof raw === "object" && raw.appId && (raw.blockScript || raw.jsClientSrc));
}

export function normalizePrizePicksResponse(raw) {
  if (!raw) return { ...EMPTY_PRIZEPICKS_PAYLOAD };
  if (isPrizePicksBlockPayload(raw)) return { ...EMPTY_PRIZEPICKS_PAYLOAD, blocked: true };
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

/** Unwrap proxy envelope `{ source, data: { data, included } }` to JSON:API shape. */
export function unwrapPrizePicksProxyPayload(payload, depth = 0) {
  if (depth > 5 || !payload || typeof payload !== "object") {
    return normalizePrizePicksResponse(null);
  }
  if (Array.isArray(payload)) return normalizePrizePicksResponse(payload);

  if (payload?.source === "PrizePicks") {
    if (Array.isArray(payload.data?.data)) {
      return normalizePrizePicksResponse({
        data: payload.data.data,
        included: payload.data.included || [],
      });
    }
    if (Array.isArray(payload.props) && payload.props.length) {
      return normalizePrizePicksResponse({
        data: payload.props,
        included: payload.data?.included || [],
      });
    }
    if (payload.data && !Array.isArray(payload.data)) {
      return unwrapPrizePicksProxyPayload(payload.data, depth + 1);
    }
    if (Array.isArray(payload.data)) return normalizePrizePicksResponse(payload);
  }

  return normalizePrizePicksResponse(payload);
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
    if (payload && typeof payload === "object") {
      console.log("PrizePicks response keys", Object.keys(payload));
      console.log("PrizePicks sample", JSON.stringify(payload).slice(0, 5000));
    }
    const text = JSON.stringify(payload, null, 2);
    console.log(label + ":", text.slice(0, 5000));
  } catch {
    console.log(label + ":", "unserializable payload");
  }
}

export function countPrizePicksRawRecords(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const shape = unwrapPrizePicksProxyPayload(payload);
  if (shape.blocked) return 0;
  return Array.isArray(shape.data) ? shape.data.length : 0;
}

/** Lightweight parse-stage audit (raw + JSON:API parse preview). */
export function auditPrizePicksParseStages(payload) {
  const shape = unwrapPrizePicksProxyPayload(payload);
  if (shape.blocked || isPrizePicksBlockPayload(payload)) {
    return {
      raw: 0,
      parsed: 0,
      blocked: true,
      failureReason: "Bot-protection payload — no projections array",
    };
  }
  const raw = Array.isArray(shape.data) ? shape.data.length : 0;
  const parsedRows = parsePrizePicksProjections(shape);
  const parsed = parsedRows.length;
  let failureReason = "";
  if (raw === 0) {
    failureReason = "Response JSON parsed but data array is empty";
  } else if (parsed === 0) {
    failureReason =
      "Parser extracted 0 props — verify attributes.line_score, stat_type, and included player records";
  }
  return { raw, parsed, parsedRows, failureReason, blocked: false };
}

export function validatePrizePicksNormalizedProp(prop = {}) {
  const playerName = String(prop.playerName || prop.player || "").trim();
  const statType = String(prop.statType || prop.market || prop.propType || "").trim();
  const line = Number(prop.line);
  const team = String(prop.team || "").trim();
  const league = String(prop.league || prop.sport || "").trim();
  return (
    playerName.length >= 2 &&
    statType.length >= 1 &&
    Number.isFinite(line) &&
    line > 0 &&
    team.length >= 1 &&
    league.length >= 1
  );
}
