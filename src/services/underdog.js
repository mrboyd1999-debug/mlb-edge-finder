import { cachedFetch } from "./fetchUtil.js";

const UNDERDOG_ENDPOINTS = [
  "/api/underdog/beta/v3/over_under_lines",
  "/api/underdog/beta/v5/over_under_lines",
  "/api/underdog",
];
const UNDERDOG_UNAVAILABLE_MESSAGE = "Underdog data source not connected or unavailable.";
const UNDERDOG_AUDIT_PREFIX = "[Underdog Audit]";

const WTA_NAME_HINTS = new Set([
  "amandine",
  "ashlyn",
  "bianca",
  "daphnee",
  "dominika",
  "eva",
  "julia",
  "karolina",
  "katherine",
  "laura",
  "luisina",
  "maddison",
  "marina",
  "margaux",
  "robin",
  "viktoria",
  "yeon",
]);

export async function fetchUnderdogProps({ sport = "all", statType = "all" } = {}) {
  let lastError = null;
  const endpointsTried = [];

  for (const endpoint of UNDERDOG_ENDPOINTS) {
    const apiUrl = absoluteUrl(endpoint);
    endpointsTried.push(apiUrl);
    console.info(`${UNDERDOG_AUDIT_PREFIX} calling API/proxy URL`, apiUrl);

    try {
      const response = await cachedFetch(endpoint, {
        headers: {
          accept: "application/json",
        },
      });
      if (!response.ok) {
        console.warn(`${UNDERDOG_AUDIT_PREFIX} response failed`, {
          url: apiUrl,
          status: response.status,
          statusText: response.statusText,
        });
        lastError = new Error(`Underdog returned status ${response.status}.`);
        continue;
      }

      const payload = await response.json();
      console.info(`${UNDERDOG_AUDIT_PREFIX} raw Underdog response`, payload);
      const setupWarning = setupWarningFromPayload(payload, "Underdog");
      if (payload?.error && payload?.needsSetup) {
        return {
          source: "Underdog",
          status: "Setup Needed",
          props: [],
          warnings: [],
          debug: underdogDebug({
            apiUrl,
            apiStatus: "Setup Needed",
            endpointsTried,
            rawPropsLoaded: rawUnderdogRecordCount(payload),
            parsedPropsCount: 0,
            message: setupWarning || UNDERDOG_UNAVAILABLE_MESSAGE,
          }),
        };
      }
      if (payload?.error) {
        return {
          source: "Underdog",
          status: "Failed",
          props: [],
          warnings: setupWarning ? [setupWarning] : ["Underdog unavailable."],
          debug: underdogDebug({
            apiUrl,
            apiStatus: "Failed",
            endpointsTried,
            rawPropsLoaded: rawUnderdogRecordCount(payload),
            parsedPropsCount: 0,
            message: setupWarning || UNDERDOG_UNAVAILABLE_MESSAGE,
          }),
        };
      }
      const parsedProps = parseUnderdogPayload(payload);
      const props = parsedProps.filter((prop) => matchesFilter(prop, sport, statType));
      console.info(`${UNDERDOG_AUDIT_PREFIX} parsed Underdog props count`, {
        rawPropsLoaded: rawUnderdogRecordCount(payload),
        parsedPropsCount: parsedProps.length,
        filteredPropsCount: props.length,
      });

      if (!props.length) {
        console.warn(`${UNDERDOG_AUDIT_PREFIX} no parsed props returned`, {
          url: apiUrl,
          rawPropsLoaded: rawUnderdogRecordCount(payload),
          parsedPropsCount: parsedProps.length,
        });
        return {
          source: "Underdog",
          status: "Not Connected",
          props: [],
          warnings: [UNDERDOG_UNAVAILABLE_MESSAGE],
          debug: underdogDebug({
            apiUrl,
            apiStatus: "Empty",
            endpointsTried,
            rawPropsLoaded: rawUnderdogRecordCount(payload),
            parsedPropsCount: parsedProps.length,
            message: UNDERDOG_UNAVAILABLE_MESSAGE,
          }),
        };
      }

      return {
        source: "Underdog",
        status: "Connected",
        props,
        warnings: setupWarning ? [setupWarning] : [],
        debug: underdogDebug({
          apiUrl,
          apiStatus: "Connected",
          endpointsTried,
          rawPropsLoaded: rawUnderdogRecordCount(payload),
          parsedPropsCount: parsedProps.length,
          message: "",
        }),
      };
    } catch (error) {
      console.warn(`${UNDERDOG_AUDIT_PREFIX} fetch blocked or failed`, {
        url: apiUrl,
        message: error?.message || String(error),
      });
      lastError = error;
    }
  }

  const error = lastError || new Error("Could not load Underdog lines.");
  error.debug = underdogDebug({
    apiUrl: endpointsTried.at(-1) || "",
    apiStatus: "Failed",
    endpointsTried,
    rawPropsLoaded: 0,
    parsedPropsCount: 0,
    message: UNDERDOG_UNAVAILABLE_MESSAGE,
  });
  throw error;
}

function parseUnderdogPayload(payload) {
  const normalizedPayload = unwrapProxyPayload(payload);
  if (Array.isArray(normalizedPayload)) return normalizedPayload.map(normalizeFlatUnderdogItem).filter(Boolean);

  const players = mapById(normalizedPayload.players || normalizedPayload.athletes || []);
  const games = mapById(normalizedPayload.games || []);
  const appearances = mapById(normalizedPayload.appearances || []);
  const teams = mapById(normalizedPayload.teams || []);
  const lines = normalizedPayload.over_under_lines || normalizedPayload.overUnders || normalizedPayload.data || [];

  return lines.map((line) => normalizeUnderdogLine(line, players, games, appearances, teams)).filter(Boolean);
}

function rawUnderdogRecordCount(payload) {
  const normalizedPayload = unwrapProxyPayload(payload);
  if (Array.isArray(normalizedPayload)) return normalizedPayload.length;
  const lines = normalizedPayload.over_under_lines || normalizedPayload.overUnders || normalizedPayload.data || normalizedPayload.items || normalizedPayload.results || [];
  return Array.isArray(lines) ? lines.length : 0;
}

function underdogDebug({ apiUrl, apiStatus, endpointsTried, rawPropsLoaded, parsedPropsCount, message }) {
  return {
    selectedSource: "Underdog",
    apiUrl,
    endpointsTried,
    apiStatus,
    rawPropsLoaded,
    propsAfterParsing: parsedPropsCount,
    message,
  };
}

function absoluteUrl(endpoint) {
  try {
    return new URL(endpoint, window.location.origin).toString();
  } catch {
    return endpoint;
  }
}

function unwrapProxyPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data) && !payload.players && !payload.games && !payload.over_under_lines) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return payload || {};
}

function setupWarningFromPayload(payload, source) {
  if (!payload?.error && !payload?.needsSetup) return "";
  return payload.message || `${source} proxy needs setup.`;
}

function normalizeFlatUnderdogItem(item = {}) {
  const line = Number(item.stat_value ?? item.line ?? item.projection ?? item.value);
  const statType = normalizeStatType(item.stat_type || item.statType || item.market || item.title || item.description);
  const startTime = item.start_time || item.startTime || item.scheduled_at || item.game_time || item.commence_time;
  if (!Number.isFinite(line) || !statType || !startTime) return null;

  const playerName = item.player_name || item.playerName || item.name || item.display_name || item.player || "Unknown Player";
  const playerImage = item.playerImage || item.player_image || item.imageUrl || item.image_url || item.headshot || item.headshot_url || "";
  const options = item.options || item.choices || [];

  return {
    platform: "Underdog",
    sport: normalizeSport(item.league || item.sport || statType, { playerName, opponent: item.opponent || "" }),
    league: item.league || item.sport || "",
    playerName,
    team: item.team || item.team_abbr || item.teamAbbr || "",
    opponent: item.opponent || item.opponent_abbr || item.matchup || "",
    playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    image_url: playerImage,
    player_image: playerImage,
    startTime,
    statType,
    line,
    directionOptions: ["More", "Less"],
    streakOptions: buildUnderdogStreakOptions(options),
    isAdjustedOdds: false,
    oddsType: "standard",
    odds_type: "standard",
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status: normalizeStatus(item.status || item.state, startTime),
    sourceId: item.id || "",
    raw: item,
  };
}

function normalizeUnderdogLine(line, players, games, appearances, teams) {
  const overUnder = line.over_under || line.overUnder || line.attributes || line;
  const statRecord = overUnder.appearance_stat || overUnder.stat || line.stat || {};
  const appearanceId =
    overUnder.appearance_id ||
    statRecord.appearance_id ||
    line.appearance_id ||
    line.relationships?.appearance?.data?.id;
  const appearance = appearances.get(String(appearanceId)) || {};
  const playerId = appearance.player_id || overUnder.player_id || line.player_id || line.athlete_id;
  const player = players.get(String(playerId)) || {};
  const gameId = appearance.game_id || appearance.match_id || overUnder.game_id || overUnder.match_id || line.game_id || line.match_id;
  const game = games.get(String(gameId)) || {};
  const lineValue = Number(line.stat_value ?? line.line ?? overUnder.stat_value ?? overUnder.line);
  const startTime = game.scheduled_at || game.start_time || appearance.scheduled_at || overUnder.scheduled_at;
  const statType = normalizeStatType(statRecord.display_stat || statRecord.stat || overUnder.title || overUnder.stat_type);
  const options = line.options || line.choices || overUnder.options || overUnder.choices || [];
  const optionHeader = commonOptionHeader(options);
  const playerName = playerFullName(player) || line.player_name || optionHeader || titlePlayerName(overUnder.title) || "Unknown Player";
  const playerImage =
    player.image_url ||
    player.light_image_url ||
    player.dark_image_url ||
    player.headshot_url ||
    player.headshot ||
    player.photo_url ||
    player.avatar_url ||
    player.image ||
    overUnder.image_url ||
    line.image_url ||
    line.player_image ||
    "";
  const team = teamLabel(teams.get(String(appearance.team_id)) || {}, appearance, player);
  const opponent = appearance.opponent_abbr || game.short_title || game.abbreviated_title || game.title || game.away_team || game.home_team || "";
  const sport = normalizeSport(game.sport_id || game.sport || overUnder.sport || statType, {
    playerName,
    opponent,
  });
  const status = normalizeStatus(line.status || overUnder.status, startTime);

  if (!Number.isFinite(lineValue) || !statType || !startTime) return null;

  return {
    platform: "Underdog",
    sport,
    league: normalizeLeague(game.sport_id || game.league || sport),
    playerName,
    team,
    opponent,
    playerImage,
    headshot: playerImage,
    imageUrl: playerImage,
    image_url: playerImage,
    player_image: playerImage,
    startTime,
    statType,
    line: lineValue,
    directionOptions: ["More", "Less"],
    streakOptions: buildUnderdogStreakOptions(options),
    isAdjustedOdds: false,
    oddsType: "standard",
    odds_type: "standard",
    projection: null,
    confidenceScore: 0,
    edgeRating: 0,
    riskLevel: "High",
    status,
    sourceId: line.id,
    raw: line,
  };
}

function playerFullName(player = {}) {
  if (player.full_name || player.name) return player.full_name || player.name;
  return [player.first_name, player.last_name].filter(Boolean).join(" ").trim();
}

function titlePlayerName(title = "") {
  const text = String(title || "");
  const marker = text.match(/^(.*?)\s+(Points|Pts|Rebounds|Assists|Hits|Runs|Total Bases|Strikeouts|3s|Fantasy)/i);
  return marker?.[1]?.trim() || "";
}

function teamLabel(team = {}, appearance = {}, player = {}) {
  return (
    appearance.team_abbr ||
    team.abbr ||
    team.abbreviation ||
    team.short_name ||
    team.name ||
    player.team_abbr ||
    player.team ||
    ""
  );
}

function buildUnderdogStreakOptions(options = []) {
  return options
    .map((option) => {
      const multiplier = Number(
        option.payout_multiplier ??
          option.multiplier ??
          option.boosted_multiplier ??
          option.payoutMultiplier
      );
      const adjustedDescriptor = [
        option.payout_type,
        option.boost_type,
        option.type,
        option.label,
        option.title,
        option.name,
        option.selection_subheader,
      ]
        .map(normalizeKey)
        .join(" ");
      const verifiedAdjustedOdds = /demon|goblin|green goblin|higher payout|lower payout|boosted|special payout/.test(adjustedDescriptor);
      return {
        side: normalizeSide(option.choice_display || option.choice || option.choice_display_short),
        multiplier,
        rawProbability: Number(option.raw_probability),
        status: option.status,
        optionId: option.id,
        label: option.selection_subheader || option.choice_display || "",
        multiplierSource: verifiedAdjustedOdds ? "Underdog verified adjusted payout" : "Underdog payout multiplier",
        adjustedOddsType: verifiedAdjustedOdds ? adjustedDescriptor : "standard",
        verifiedAdjustedOdds,
      };
    })
    .filter((option) => Number.isFinite(option.multiplier));
}

function normalizeSide(value) {
  const key = normalizeKey(value);
  if (key.includes("higher") || key.includes("over")) return "Higher";
  if (key.includes("lower") || key.includes("under")) return "Lower";
  return String(value || "Higher");
}

function commonOptionHeader(options = []) {
  const headers = Array.from(new Set(options.map((option) => option.selection_header).filter(Boolean)));
  return headers.length === 1 ? headers[0] : "";
}

function mapById(records) {
  const map = new Map();
  records.forEach((record) => {
    if (record?.id != null) map.set(String(record.id), record);
  });
  return map;
}

function normalizeSport(value, context = {}) {
  const text = String(value || "").toLowerCase();
  if (text.includes("mlb") || text.includes("baseball")) return "MLB";
  if (text.includes("nhl") || text.includes("hockey")) return "NHL";
  if (text.includes("ncaaf") || text.includes("college football")) return "NCAAF";
  if (text.includes("nfl")) return "NFL";
  if (text.includes("wnba") || text.includes("women's basketball") || text.includes("womens basketball")) return "WNBA";
  if (text.includes("nba") && !text.includes("wnba")) return "NBA";
  if (text.includes("basketball")) return "NBA";
  if (text.includes("wta") || text.includes("women")) return "WTA Tennis";
  if (text.includes("tennis")) return classifyTennisSport(context);
  if (text.includes("atp") || text.includes("men")) return "ATP Tennis";
  if (text.includes("soccer") || text.includes("football")) return "Soccer";
  return "Other";
}

function classifyTennisSport({ playerName = "", opponent = "" } = {}) {
  const names = `${playerName} ${opponent}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return names.some((name) => WTA_NAME_HINTS.has(name)) ? "WTA Tennis" : "ATP Tennis";
}

function normalizeLeague(value) {
  const sport = normalizeSport(value);
  return sport === "Other" ? String(value || "Other") : sport;
}

function normalizeStatType(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  const key = normalizeKey(text);
  if (key.includes("pitchesthrown") || key.includes("pitchcount")) return "Pitches Thrown";
  if (key.includes("strikeout")) return "Pitcher Strikeouts";
  if (key.includes("hitsrunsrbis") || key.includes("hrr")) return "Hits+Runs+RBIs";
  if (key.includes("totalbases")) return "Total Bases";
  if (key.includes("pointsreboundsassists") || key === "pra") return "Points + Rebounds + Assists";
  if (key.includes("3pointers") || key.includes("threepointers")) return "3-Pointers Made";
  if (key.includes("shotsontarget")) return "Shots On Target";
  if (key === "shots" || key.includes("shotsattempted")) return "Shots";
  if (key.includes("passesattempted") || key === "passes") return "Passes Attempted";
  if (key.includes("goalsallowed")) return "Goals Allowed";
  if (key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves") return "Goalie Saves";
  if (key.includes("fantasyscore")) return "Fantasy Score";
  if (key.includes("gameswon") || key.includes("playergames")) return "Player Games Won";
  if (key.includes("totalgames")) return "Total Games";
  if (key.includes("doublefault")) return "Double Faults";
  return text;
}

function normalizeStatus(status, startTime) {
  const lower = String(status || "").toLowerCase();
  const start = new Date(startTime).getTime();
  if (lower.includes("locked") || lower.includes("suspended")) return "locked";
  if (lower.includes("expired") || lower.includes("closed")) return "expired";
  if (Number.isFinite(start) && start <= Date.now()) return "live";
  return "upcoming";
}

function matchesFilter(prop, sport, statType) {
  const sportOk = sport === "all" || prop.sport === sport;
  const statOk = statType === "all" || normalizeKey(prop.statType) === normalizeKey(statType);
  return sportOk && statOk;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
