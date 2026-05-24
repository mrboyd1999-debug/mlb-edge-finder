/** Provider health — merge probe results with actual parsed feed data. */

import { getOddsApiKey, getProxyUrl } from "../config/apiConfig.js";
import { CONNECTION_STATUS } from "./apiConnectionTest.js";

export const PROVIDER_UI_STATUS = {
  CONNECTED: "Connected",
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

function resolveSportsDataSettingsStatus(probe = {}) {
  const keySaved = Boolean(probe.keyConfigured);
  if (!keySaved) {
    return {
      settingsStatus: SPORTSDATA_SETTINGS_STATUS.NOT_TESTED,
      settingsLine: SPORTSDATA_SETTINGS_STATUS.NOT_TESTED,
      keySaved: false,
      showError: false,
    };
  }
  if (probe.unauthorized) {
    return {
      settingsStatus: SPORTSDATA_SETTINGS_STATUS.INVALID_KEY,
      settingsLine: SPORTSDATA_SETTINGS_STATUS.INVALID_KEY,
      keySaved: true,
      showError: true,
    };
  }
  if (probe.rateLimited) {
    return {
      settingsStatus: SPORTSDATA_SETTINGS_STATUS.RATE_LIMITED,
      settingsLine: SPORTSDATA_SETTINGS_STATUS.RATE_LIMITED,
      keySaved: true,
      showError: false,
    };
  }
  if (probe.ok && Array.isArray(probe.payload) && probe.payload.length) {
    return {
      settingsStatus: SPORTSDATA_SETTINGS_STATUS.CONNECTED,
      settingsLine: SPORTSDATA_SETTINGS_STATUS.CONNECTED,
      keySaved: true,
      showError: false,
    };
  }
  if (!probe.ok || probe.networkError) {
    return {
      settingsStatus: SPORTSDATA_SETTINGS_STATUS.ERROR,
      settingsLine: SPORTSDATA_SETTINGS_STATUS.ERROR,
      keySaved: true,
      showError: true,
    };
  }
  return {
    settingsStatus: SPORTSDATA_SETTINGS_STATUS.NOT_TESTED,
    settingsLine: SPORTSDATA_SETTINGS_STATUS.NOT_TESTED,
    keySaved: true,
    showError: false,
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
    const platform = normalizePlatform(prop.platform || prop.source);
    if (needle.includes("prize") && platform.includes("prize")) return true;
    if (needle.includes("underdog") && platform.includes("underdog")) return true;
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
      usableCount: boardCount,
      rawCount: finiteOr(sourceRow.rawPropsLoaded, 0),
      hasUsableProps: boardCount > 0,
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
  };
}

function isProxyBlockedProbe(probe = {}) {
  if (!probe) return false;
  if (probe.unauthorized || probe.rateLimited) return false;
  if (probe.networkError) return true;
  if (probe.looksHtml) return true;
  if (String(probe.status) === "0") return true;
  return /failed to fetch|cors|network|blocked|timeout|abort/i.test(String(probe.preview || ""));
}

function mapUiStatusToConnectionStatus(settingsStatus = "") {
  const key = String(settingsStatus || "").toUpperCase();
  if (key === "LIVE" || key === "CONNECTED") return CONNECTION_STATUS.LIVE;
  if (key === "CACHED") return CONNECTION_STATUS.CACHED;
  if (key === "PROXY REQUIRED") return "PROXY REQUIRED";
  if (key === "INVALID API KEY") return CONNECTION_STATUS.FAILED;
  if (key === "RATE LIMITED") return CONNECTION_STATUS.CACHED;
  if (key === "NOT CONFIGURED" || key === "NOT USED" || key === "KEY SAVED") {
    return CONNECTION_STATUS.NOT_CONFIGURED;
  }
  return settingsStatus;
}

function resolveLineProviderStatus(provider = "", { probe = {}, feed = {} } = {}) {
  const name = PROVIDER_KEYS[provider] || provider;
  const boardCount = finiteOr(feed.boardCount ?? feed.usableCount, 0);
  const hasBoardProps = boardCount > 0;

  if (probe?.unauthorized) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.INVALID_KEY,
      settingsLine: PROVIDER_UI_STATUS.INVALID_KEY,
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
    if (keyConfigured && !probe?.sportsListOk && !hasBoardProps) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.KEY_SAVED,
        settingsLine: PROVIDER_UI_STATUS.KEY_SAVED,
        showError: false,
      };
    }
  }

  if (name === "PrizePicks" || name === "Underdog") {
    if (hasBoardProps) {
      return {
        settingsStatus: feed.cached ? PROVIDER_UI_STATUS.CACHED : PROVIDER_UI_STATUS.LIVE,
        settingsLine: feed.cached ? PROVIDER_UI_STATUS.CACHED : PROVIDER_UI_STATUS.LIVE,
        showError: false,
      };
    }
    if (probe?.rateLimited || feed.cached) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.RATE_LIMITED,
        settingsLine: PROVIDER_UI_STATUS.RATE_LIMITED,
        showError: false,
      };
    }
    if (isProxyBlockedProbe(probe)) {
      const proxyConfigured = Boolean(getProxyUrl(name === "PrizePicks" ? "prizepicks" : "underdog"));
      if (!proxyConfigured) {
        return {
          settingsStatus: PROVIDER_UI_STATUS.PROXY_REQUIRED,
          settingsLine: PROVIDER_UI_STATUS.PROXY_REQUIRED,
          showError: false,
        };
      }
    }
    if (probe?.ok || probe?.lastSuccessfulFetchAt) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.LIVE,
        settingsLine: PROVIDER_UI_STATUS.LIVE,
        showError: false,
      };
    }
  }

  if (probe?.rateLimited) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.RATE_LIMITED,
      settingsLine: PROVIDER_UI_STATUS.RATE_LIMITED,
      showError: false,
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
      settingsStatus: PROVIDER_UI_STATUS.NOT_CONFIGURED,
      settingsLine: PROVIDER_UI_STATUS.NOT_CONFIGURED,
      showError: false,
    };
  }

  return {
    settingsStatus: "Unavailable",
    settingsLine: "Unavailable",
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
      const effective = resolveSportsDataSettingsStatus(row);
      return {
        ...row,
        ...effective,
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
    "NOT TESTED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    ERROR: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "RATE LIMITED": { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "NOT CONFIGURED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74" },
    FAILED: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
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
