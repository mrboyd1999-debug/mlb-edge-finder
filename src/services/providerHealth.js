/** Provider health — merge probe results with actual parsed feed data. */

import { getOddsApiKey } from "../config/apiConfig.js";
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
  if (probe.corsBlocked) {
    return {
      settingsStatus: "Failed",
      settingsLine: "Browser blocked direct request — backend proxy recommended.",
      keySaved: true,
      showError: true,
      debugLine: "",
    };
  }
  if (probe.timedOut) {
    return {
      settingsStatus: "Failed",
      settingsLine: "Timed out",
      keySaved: true,
      showError: true,
      debugLine: "",
    };
  }
  if (probe.unauthorized) {
    return {
      settingsStatus: "Failed",
      settingsLine: "Invalid key or subscription",
      keySaved: true,
      showError: true,
      debugLine: "",
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
  const apiConnected = probe.ok || probe.settingsLine === "Connected";
  if (apiConnected && !feed.usedOnBoard) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.CONNECTED,
      settingsLine: "Connected — not used for current board",
      keySaved: true,
      showError: false,
      debugLine: probe.debugLine || "SportsDataIO endpoint tested successfully.",
    };
  }
  if (apiConnected) {
    return {
      settingsStatus: PROVIDER_UI_STATUS.CONNECTED,
      settingsLine: PROVIDER_UI_STATUS.CONNECTED,
      keySaved: true,
      showError: false,
      debugLine: probe.debugLine || "SportsDataIO endpoint tested successfully.",
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

  if (probe?.unauthorized) {
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
    return {
      settingsStatus: "Failed",
      settingsLine: "Failed",
      showError: true,
    };
  }

  if (name === "PrizePicks" || name === "Underdog") {
    if (hasBoardProps || probe?.ok || probe?.lastSuccessfulFetchAt) {
      return {
        settingsStatus: PROVIDER_UI_STATUS.LIVE,
        settingsLine: PROVIDER_UI_STATUS.LIVE,
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
    "TIMED OUT": { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
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
