/** Provider health — merge probe results with actual parsed feed data. */

import { getProxyUrl } from "../config/apiConfig.js";
import { CONNECTION_STATUS } from "./apiConnectionTest.js";

export const PROVIDER_UI_STATUS = {
  CONNECTED: "Connected",
  LIVE_FEED: "Live Feed Available",
  CACHED_FEED: "Cached Feed",
  PROXY_REQUIRED: "Proxy Required",
  INVALID_KEY: "Invalid API Key",
  RATE_LIMITED: "Rate Limited",
  NOT_CONFIGURED: "Not configured",
};

const PROVIDER_KEYS = {
  PrizePicks: "PrizePicks",
  Underdog: "Underdog",
  "Odds API": "Odds API",
};

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
    if (needle.includes("odds") && (platform.includes("odds") || prop.sportsbookVerified)) return true;
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
    const fromProps = countPropsForProvider(allDisplayProps, provider);
    const parsedCount = finiteOr(sourceRow.propsAfterParsing, fromProps);
    const usableCount = finiteOr(sourceRow.usablePropsCount ?? sourceRow.propsAfterParsing, fromProps);
    const cached =
      /cached/i.test(String(sourceRow.status || sourceStatus[statusKey] || "")) ||
      /cached/i.test(String(sourceRow.lineSourceBadge || ""));
    return {
      provider,
      parsedCount,
      usableCount,
      rawCount: finiteOr(sourceRow.rawPropsLoaded, parsedCount),
      hasUsableProps: usableCount > 0 || fromProps > 0,
      cached,
      live: usableCount > 0 && !cached,
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

function mapUiStatusToConnectionStatus(uiStatus = "") {
  const key = String(uiStatus || "").toUpperCase();
  if (key === PROVIDER_UI_STATUS.CONNECTED.toUpperCase()) return CONNECTION_STATUS.LIVE;
  if (key === PROVIDER_UI_STATUS.LIVE_FEED.toUpperCase()) return "LIVE FEED AVAILABLE";
  if (key === PROVIDER_UI_STATUS.CACHED_FEED.toUpperCase()) return CONNECTION_STATUS.CACHED;
  if (key === PROVIDER_UI_STATUS.PROXY_REQUIRED.toUpperCase()) return "PROXY REQUIRED";
  if (key === PROVIDER_UI_STATUS.INVALID_KEY.toUpperCase()) return CONNECTION_STATUS.FAILED;
  if (key === PROVIDER_UI_STATUS.RATE_LIMITED.toUpperCase()) return CONNECTION_STATUS.CACHED;
  if (key === PROVIDER_UI_STATUS.NOT_CONFIGURED.toUpperCase()) return CONNECTION_STATUS.NOT_CONFIGURED;
  return uiStatus;
}

export function resolveEffectiveProviderStatus(provider = "", { probe = {}, feed = {} } = {}) {
  const name = PROVIDER_KEYS[provider] || provider;
  const parsedCount = finiteOr(feed.parsedCount ?? feed.usableCount, 0);
  const usableCount = finiteOr(feed.usableCount, parsedCount);
  const hasFeed = Boolean(feed.hasUsableProps || usableCount > 0 || parsedCount > 0);

  if (name === "Odds API" && probe?.sportsListOk) {
    return {
      uiStatus: PROVIDER_UI_STATUS.CONNECTED,
      message: `Odds API /v4/sports OK (${probe.sportsCount || "multiple"} sports)`,
      status: CONNECTION_STATUS.LIVE,
      showError: false,
    };
  }

  if (probe?.unauthorized) {
    return {
      uiStatus: PROVIDER_UI_STATUS.INVALID_KEY,
      message: PROVIDER_UI_STATUS.INVALID_KEY,
      status: CONNECTION_STATUS.FAILED,
      showError: true,
    };
  }

  if (hasFeed) {
    if (probe?.rateLimited || feed.cached) {
      return {
        uiStatus: PROVIDER_UI_STATUS.CACHED_FEED,
        message: `${usableCount || parsedCount} props from cache/live parse`,
        status: CONNECTION_STATUS.CACHED,
        showError: false,
      };
    }
    return {
      uiStatus: PROVIDER_UI_STATUS.LIVE_FEED,
      message: `${usableCount || parsedCount} props parsed successfully`,
      status: "LIVE FEED AVAILABLE",
      showError: false,
    };
  }

  if (probe?.rateLimited) {
    return {
      uiStatus: PROVIDER_UI_STATUS.RATE_LIMITED,
      message: PROVIDER_UI_STATUS.RATE_LIMITED,
      status: CONNECTION_STATUS.CACHED,
      showError: false,
    };
  }

  if ((name === "PrizePicks" || name === "Underdog") && isProxyBlockedProbe(probe)) {
    const proxyConfigured = Boolean(getProxyUrl(name === "PrizePicks" ? "prizepicks" : "underdog"));
    if (!proxyConfigured) {
      return {
        uiStatus: PROVIDER_UI_STATUS.PROXY_REQUIRED,
        message: "Browser blocked direct request — configure proxy in Settings",
        status: "PROXY REQUIRED",
        showError: false,
      };
    }
  }

  if (probe?.ok) {
    return {
      uiStatus: PROVIDER_UI_STATUS.CONNECTED,
      message: PROVIDER_UI_STATUS.CONNECTED,
      status: CONNECTION_STATUS.LIVE,
      showError: false,
    };
  }

  if (name === "Odds API" && !probe?.keyConfigured && probe?.status === CONNECTION_STATUS.NOT_CONFIGURED) {
    return {
      uiStatus: PROVIDER_UI_STATUS.NOT_CONFIGURED,
      message: PROVIDER_UI_STATUS.NOT_CONFIGURED,
      status: CONNECTION_STATUS.NOT_CONFIGURED,
      showError: false,
    };
  }

  return {
    uiStatus: probe?.message || "Unavailable",
    message: probe?.preview || probe?.lastError || "No usable props parsed yet",
    status: CONNECTION_STATUS.DEGRADED,
    showError: Boolean(probe?.preview && !hasFeed),
  };
}

export function mergeConnectionReportWithFeeds(report = {}, feedContext = {}) {
  const results = (report.results || []).map((row) => {
    const provider = row.provider || "";
    if (!PROVIDER_KEYS[provider] && provider !== "Odds API") return row;
    const feed = feedContext[provider] || {};
    const effective = resolveEffectiveProviderStatus(provider, { probe: row, feed });
    return {
      ...row,
      uiStatus: effective.uiStatus,
      message: effective.message,
      status: mapUiStatusToConnectionStatus(effective.uiStatus) || effective.status,
      displayStatus: effective.uiStatus,
      displayMessage: effective.message,
      showError: effective.showError,
      feedParsedCount: feed.parsedCount ?? 0,
      feedUsableCount: feed.usableCount ?? 0,
    };
  });
  return { ...report, results };
}

export function providerStatusStyle(status = "") {
  const key = String(status || "").toUpperCase();
  const colors = {
    CONNECTED: { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    "LIVE FEED AVAILABLE": { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    LIVE: { bg: "rgba(34,197,94,0.18)", text: "#86efac" },
    "CACHED FEED": { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    CACHED: { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "PROXY REQUIRED": { bg: "rgba(234,179,8,0.18)", text: "#fde047" },
    "INVALID API KEY": { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
    "RATE LIMITED": { bg: "rgba(59,130,246,0.18)", text: "#93c5fd" },
    "NOT CONFIGURED": { bg: "rgba(148,163,184,0.15)", text: "#cbd5e1" },
    DEGRADED: { bg: "rgba(249,115,22,0.18)", text: "#fdba74" },
    FAILED: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5" },
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
