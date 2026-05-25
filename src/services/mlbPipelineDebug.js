/** Verbose MLB pipeline debug — backend only. Filter console for [MLB Pipeline]. */
const ENABLED = typeof import.meta !== "undefined" ? import.meta.env?.DEV !== false : true;

function emit(label, payload) {
  if (!ENABLED || typeof console === "undefined") return;
  if (payload === undefined) console.log(`[MLB Pipeline] ${label}`);
  else console.log(`[MLB Pipeline] ${label}`, payload);
}

export function logIncomingProp(prop = {}) {
  emit("Incoming prop:", {
    player: prop.playerName,
    stat: prop.statType,
    line: prop.line,
    team: prop.team,
    opponent: prop.opponent,
    source: prop.source || prop.platform,
  });
}

export function logNormalizedName(incoming = "", normalized = "") {
  console.log("[MLB Pipeline] Normalized name:", normalized || incoming);
}

export function logMatchedPlayer(matched = null, confidence = null, reason = "") {
  console.log("[MLB Pipeline] Matched MLB player:", matched, { confidence, reason });
}

export function logFetchStart(label, details = {}) {
  console.log(`[MLB Pipeline] Fetching ${label}:`, details);
}

export function logFetchResponse(label, response = {}) {
  console.log(`[MLB Pipeline] ${label} response:`, response);
}

export function logFetchError(label, error = "") {
  console.log(`[MLB Pipeline] ${label} FAILED:`, error);
}

export function logLogsCount(count = 0, meta = {}) {
  console.log("[MLB Pipeline] Logs count:", count, meta);
}

export function logProjectionExecution(result = {}) {
  console.log("[MLB Pipeline] Projection result:", result.projection ?? null);
  console.log("[MLB Pipeline] Edge:", result.edge ?? null);
  console.log("[MLB Pipeline] Confidence:", result.confidence ?? null);
  console.log("[MLB Pipeline] Recommendation:", result.recommendation ?? result.modelPickLabel ?? null);
}

export function logPropFailure(reason = "", details = {}) {
  console.log("[MLB Pipeline] FAILURE:", reason, details);
}

export function tracePipelineStage(stage, payload = {}) {
  emit(stage, payload);
}
