/** Provider health — merge probe results with actual parsed feed data. */

import { getOddsApiKey } from "../config/apiConfig.js";
import { ENRICHMENT_TIMEOUT_MESSAGE, isTimeoutPreview } from "../utils/apiTimeout.js";
import { isUnderdogProp } from "../utils/underdogStreakPool.js";
import { normalizeSource } from "../utils/normalizeSource.js";
import { SPORTSDATA_CONNECTED_VIA_PROXY, SPORTSDATA_UNAVAILABLE_MESSAGE } from "./sportsDataService.js";
import { SPORTSDATA_STATUS_LABELS } from "./sportsDataAuthTest.js";
import { CONNECTION_STATUS } from "./apiConnectionTest.js";

export const PROVIDER_UI_STATUS = {
  CONNECTED: "Connected",
  CONNECTED_VIA_PROXY: SPORTSDATA_CONNECTED_VIA_PROXY,
  LIVE: "Live",
  CACHED: "Cached",
  KEY_SAVED: "Key Saved",
  NOT_USED: "Not Used",
  PROXY_REQUIRED: "Proxy Required",
  INVALID_KEY: "Invalid API Key",
  RATE_LIMITED: "Rate Limited",
  NOT_CONFIGURED: "Not configured",
};

const PROVIDER_KEYS = {
  PrizePicks: "PrizePicks",
  Underdog: "Underdog",
  "Odds API": "Odds API",
  SportsDataIO: "SportsDataIO",
};

export const SPORTSDATA_SETTINGS_STATUS = {
  CONNECTED: "Connected",
  INVALID_KEY: "Invalid Key",
  NOT_TESTED: "Not Tested",
  RATE_LIMITED: "Rate Limited",
  ERROR: "Error",
};

function propUsesSportsData(prop = {}) {
  const sources = [
    ...(prop.statEnrichmentSources || []),
    ...(prop.dataSources || []),
    ...(prop.modelSignal?.statEnrichmentSources || []),
  ];
  return sources.some((source) => /sportsdata/i.test(String(source || "")));
}

function resolveSportsDataSettingsStatus(probe = {}, feed = {}) {
  const keySaved = Boolean(probe.keyConfigured);
  if (!keySaved) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.NOT_USED,
      settingsLine: PROVIDER_UI_STATUS.NOT_USED,
      keySaved: false,
      showError: false,
      debugLine: "",
    };
  }

  if (probe.explicitTest && (probe.endpointTests?.length || probe.statusLabel)) {
    const connected =
      probe.ok ||
      probe.statusLabel === SPORTSDATA_STATUS_LABELS.CONNECTED ||
      probe.settingsLine === SPORTSDATA_STATUS_LABELS.CONNECTED;
    return {
      settingsStatus: probe.statusLabel || probe.settingsLine,
      settingsLine: probe.statusLabel || probe.settingsLine,
      keySaved: true,
      showError: probe.showError ?? !connected,
      debugLine: probe.debugLine || probe.message || "",
      endpointTests: probe.endpointTests || [],
      statusLabel: probe.statusLabel || probe.settingsLine,
      mlbStatsFallbackNote: probe.mlbStatsFallbackNote || "",
      feedUsedOnBoard: feed.usedOnBoard,
    };
  }

  if (probe.corsBlocked) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.PROXY_REQUIRED,
      settingsLine: "Browser blocked direct request — backend proxy recommended.",
      keySaved: true,
      showError: true,
      debugLine: "",
    };
  }
  if (probe.timedOut) {
    return {
      settingsStatus: "Timed out",
      settingsLine: ENRICHMENT_TIMEOUT_MESSAGE,
      keySaved: true,
      showError: false,
      debugLine: "",
    };
  }
  if (probe.unauthorized) {
    const label =
      probe.statusLabel ||
      (probe.settingsLine && probe.settingsLine !== "Invalid key or subscription" ? probe.settingsLine : SPORTSDATA_STATUS_LABELS.INVALID_KEY);
    return {
      settingsStatus: label,
      settingsLine: label,
      keySaved: true,
      showError: true,
      debugLine: probe.debugLine || probe.message || "",
      mlbStatsFallbackNote: SPORTSDATA_UNAVAILABLE_MESSAGE,
    };
  }
  if (probe.rateLimited) {
    return {
      settingsStatus: "Rate limited",
      settingsLine: "Rate limited",
      keySaved: true,
      showError: false,
      debugLine: "",
    };
  }
  const connectedViaProxy =
    probe.ok ||
    probe.proxied ||
    probe.settingsLine === SPORTSDATA_CONNECTED_VIA_PROXY ||
    probe.settingsStatus === SPORTSDATA_CONNECTED_VIA_PROXY;
  if (connectedViaProxy && !feed.usedOnBoard) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.CONNECTED_VIA_PROXY,
      settingsLine: `${SPORTSDATA_CONNECTED_VIA_PROXY} — not used for current board`,
      keySaved: true,
      showError: false,
      debugLine: probe.debugLine || "SportsDataIO MLB status probe succeeded via backend proxy.",
    };
  }
  if (connectedViaProxy) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.CONNECTED_VIA_PROXY,
      settingsLine: SPORTSDATA_CONNECTED_VIA_PROXY,
      keySaved: true,
      showError: false,
      debugLine: probe.debugLine || "SportsDataIO MLB status probe succeeded via backend proxy.",
    };
  }
  return {
    settingsStatus: "Failed",
    settingsLine: probe.settingsLine || "Failed",
    keySaved: true,
    showError: true,
    debugLine: "",
  };
}

function finiteOr(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePlatform(value = "") {
  return String(value || "").trim().toLowerCase();
}

function countPropsForProvider(props = [], provider = "") {
  const needle = normalizePlatform(provider);
  if (!needle) return 0;
  return (props || []).filter((prop) => {
    const normalized = normalizeSource(prop);
    const platform = normalizePlatform(prop.platform || prop.source || normalized);
    if (needle.includes("prize") && (platform.includes("prize") || normalized === "prizepicks")) return true;
    if (needle.includes("underdog") && (isUnderdogProp(prop) || normalized === "underdog")) return true;
    if (needle.includes("odds") && platform.includes("odds")) return true;
    return platform.includes(needle);
  }).length;
}

export function buildFeedHealthContext({
  allDisplayProps = [],
  debugInfo = {},
  sourceStatus = {},
  lastUpdated = "",
} = {}) {
  const sources = debugInfo?.sources || {};
  const pp = sources.PrizePicks || {};
  const ud = sources.Underdog || {};
  const odds = sources["The Odds API"] || {};

  const buildRow = (provider, sourceRow = {}, statusKey = provider) => {
    const boardCount = countPropsForProvider(allDisplayProps, provider);
    const cached =
      /cached/i.test(String(sourceRow.status || sourceStatus[statusKey] || "")) ||
      /cached/i.test(String(sourceRow.lineSourceBadge || ""));
    return {
      provider,
      boardCount,
      parsedCount: finiteOr(sourceRow.propsAfterParsing, 0),
      usableCount: finiteOr(sourceRow.usablePropsCount, boardCount),
      rawCount: finiteOr(sourceRow.rawPropsLoaded, 0),
      hasUsableProps: finiteOr(sourceRow.usablePropsCount, boardCount) > 0,
      cached,
      live: boardCount > 0 && !cached,
      lastSuccessfulFetchAt: sourceRow.lastSuccessfulFetchAt || lastUpdated || "",
      lastError: sourceRow.message || sourceRow.lastError || "",
    };
  };

  return {
    PrizePicks: buildRow("PrizePicks", pp, "PrizePicks"),
    Underdog: buildRow("Underdog", ud, "Underdog"),
    "Odds API": buildRow("Odds API", odds, "The Odds API"),
    SportsDataIO: {
      usedOnBoard: (allDisplayProps || []).some(propUsesSportsData),
    },
  };
}

function mapUiStatusToConnectionStatus(settingsStatus = "") {
  const key = String(settingsStatus || "").toUpperCase();
  if (key === "LIVE" || key === "CONNECTED") return CONNECTION_STATUS.LIVE;
  if (key === "FAILED") return CONNECTION_STATUS.FAILED;
  if (key === "NOT USED") return CONNECTION_STATUS.NOT_CONFIGURED;
  return settingsStatus;
}

function resolveLineProviderStatus(provider = "", { probe = {}, feed = {} } = {}) {
  const name = PROVIDER_KEYS[provider] || provider;
  const boardCount = finiteOr(feed.boardCount ?? feed.usableCount, 0);
  const hasBoardProps = boardCount > 0;

  if (probe?.unauthorized && name !== "Odds API") {
    return {
      settingsStatus: "Failed",
      settingsLine: "Failed",
      showError: true,
    };
  }

  if (name === "Odds API") {
    const keyConfigured = Boolean(probe?.keyConfigured ?? getOddsApiKey());
    if (!keyConfigured) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.NOT_USED,
        settingsLine: PROVIDER_UI_STATUS.NOT_USED,
        showError: false,
      };
    }
    if (probe?.unauthorized) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.INVALID_KEY,
        settingsLine: "Invalid Key",
        showError: true,
      };
    }
    if (probe?.sportsListOk) {
      if (hasBoardProps) {
        return {
          settingsStatus: PROVIDER_UI_STATUS.CONNECTED,
          settingsLine: PROVIDER_UI_STATUS.CONNECTED,
          showError: false,
        };
      }
      return {
        settingsStatus: PROVIDER_UI_STATUS.CONNECTED,
        settingsLine: "Connected — not used for current board",
        showError: false,
      };
    }
    if (probe?.timedOut || isTimeoutPreview(probe?.preview)) {
      return {
        settingsStatus: "Timed out",
        settingsLine: ENRICHMENT_TIMEOUT_MESSAGE,
        showError: false,
      };
    }
    return {
      settingsStatus: PROVIDER_UI_STATUS.INVALID_KEY,
      settingsLine: /401|403|invalid|unauthorized|subscription/i.test(String(probe?.preview || ""))
        ? "Invalid Key"
        : "Failed",
      showError: true,
    };
  }

  if (name === "PrizePicks" || name === "Underdog") {
    const rawCount = finiteOr(feed.rawCount ?? feed.rawPropsLoaded, 0);
    const parsedCount = finiteOr(feed.parsedCount ?? feed.propsAfterParsing, 0);
    const usableCount = finiteOr(feed.usableCount ?? feed.usablePropsCount, 0);
    if (usableCount > 0) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.LIVE,
        settingsLine: `Live — ${usableCount} usable props`,
        showError: false,
      };
    }
    if (rawCount > 0 && parsedCount === 0) {
      return {
        settingsStatus: "Connected",
        settingsLine: "Connected — parser returned 0 props",
        showError: false,
      };
    }
    if (rawCount > 0) {
      return {
        settingsStatus: "Connected",
        settingsLine: "Connected — no usable props",
        showError: false,
      };
    }
    return {
      settingsStatus: "Failed",
      settingsLine: "Failed",
      showError: Boolean(probe?.preview),
    };
  }

  if (probe?.ok) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.CONNECTED,
      settingsLine: PROVIDER_UI_STATUS.CONNECTED,
      showError: false,
    };
  }

  if (probe?.status === CONNECTION_STATUS.NOT_CONFIGURED) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.NOT_USED,
      settingsLine: PROVIDER_UI_STATUS.NOT_USED,
      showError: false,
    };
  }

  return {
    settingsStatus: "Failed",
    settingsLine: "Failed",
    showError: Boolean(probe?.preview && !hasBoardProps),
  };
}

export function resolveEffectiveProviderStatus(provider = "", context = {}) {
  const resolved = resolveLineProviderStatus(provider, context);
  return {
    uiStatus: resolved.settingsStatus,
    message: "",
    status: mapUiStatusToConnectionStatus(resolved.settingsStatus),
    displayStatus: resolved.settingsLine,
    displayMessage: "",
    settingsStatus: resolved.settingsStatus,
    settingsLine: resolved.settingsLine,
    showError: resolved.showError,
  };
}

export function mergeConnectionReportWithFeeds(report = {}, feedContext = {}) {
  const results = (report.results || []).map((row) => {
    const provider = row.provider || "";
    if (provider === "SportsDataIO") {
      const feed = feedContext.SportsDataIO || {};
      const effective = resolveSportsDataSettingsStatus(row, feed);
      if (row.explicitTest && row.endpointTests?.length) {
        return {
          ...row,
          ...effective,
          settingsLine: effective.settingsLine,
          settingsStatus: effective.settingsStatus,
          statusLabel: effective.statusLabel || effective.settingsLine,
          showError: effective.showError,
          endpointTests: row.endpointTests,
          debugLine: row.debugLine || effective.debugLine || "",
        };
      }
      return {
        ...row,
        ...effective,
        debugLine: row.debugLine || effective.debugLine || "",
      };
    }
    if (!PROVIDER_KEYS[provider] && provider !== "Odds API") return row;
    const feed = feedContext[provider] || {};
    const effective = resolveEffectiveProviderStatus(provider, { probe: row, feed });
    return {
      ...row,
      ...effective,
      feedParsedCount: feed.parsedCount ?? 0,
      feedUsableCount: feed.boardCount ?? feed.usableCount ?? 0,
      feedBoardCount: feed.boardCount ?? 0,
    };
  });
  return { ...report, results };
}

export function providerStatusStyle(status = "") {
  const key = String(status || "").toUpperCase();
  if (key.includes("CONNECTED")) {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      background: "rgba(34,197,94,0.18)",
      color: "#86efac",
    };
  }
  if (key.includes("PROXY")) {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      background: "rgba(34,197,94,0.18)",
      color: "#86efac",
    };
  }
  const colors = {
    LIVE: { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    CONNECTED: { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    "CONNECTED — NOT USED FOR CURRENT BOARD": { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    CACHED: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "KEY SAVED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    "NOT USED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    "PROXY REQUIRED": { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
    "INVALID API KEY": { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "INVALID KEY": { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "Invalid Key": { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "NOT TESTED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    "TIMED OUT": { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
    "TIMED OUT — USING BASE FEED.": { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
    "RATE LIMITED": { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "INVALID KEY OR SUBSCRIPTION": { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "BROWSER BLOCKED DIRECT REQUEST — BACKEND PROXY RECOMMENDED.": {
      bg: "rgba(234,179,8,0.18)",
      text: "#fde047",
    },
    "NOT CONFIGURED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74" },
    FAILED: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    Failed: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    UNAVAILABLE: { bg: "rgba(249,115,22,0.18)", text: "#fdba74" },
  };
  const palette = colors[key] || colors.DEGRADED;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: palette.bg,
    color: palette.text,
  };
}
