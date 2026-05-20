import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPrizePicksProps } from "./services/prizepicks";
import { fetchUnderdogProps } from "./services/underdog";
import { fetchSportsbookComparison } from "./services/sportsbookOdds";
import { fetchPlayerStats } from "./services/playerStats";
import { fetchInjuryNews } from "./services/injuryNews";
import { clearApiCache } from "./services/fetchUtil";
import { dataQualityBadge, dataQualityFromSignals } from "./services/dataQuality";
import {
  buildPickExplanation,
  computeConfidence,
  computeRankScore,
  computeStreakConfidence,
  confidenceTierLabel,
  estimateModelProbability,
  propPayoutLabel,
} from "./services/projectionEngine";
import {
  DFS_CACHE_TTL_MS,
  clearBoardCache,
  readCachedBoard,
  readHistory,
  readLineMovement,
  readParlayHistory,
  writeCachedBoard,
  writeHistory,
  writeLineMovement,
  writeParlayHistory,
} from "./services/pickStore";

const HISTORY_KEY = "props-of-the-day-history";
const PARLAY_HISTORY_KEY = "dfs-pickem-parlay-history";
const LINE_MOVEMENT_KEY = "dfs-pickem-line-movement";
const PROPS_OF_DAY_LIMIT = 9;
const MAX_RANKED_PROPS = 240;
const MAX_WATCHLIST_PROPS = 240;
const MAX_STREAK_PROPS = 3000;
const BACKUP_STREAK_LIMIT = 12;
const LADDER_STREAK_LIMIT = 12;
const AVOID_STREAK_LIMIT = 12;
const MIN_RECOMMENDED_EDGE = 0.5;
const MIN_RECOMMENDED_CONFIDENCE = 55;
const MIN_STREAK_CONFIDENCE = 65;
const MIN_GOBLIN_CONFIDENCE = 68;
const MIN_DEMON_CONFIDENCE = 60;
const MIN_START_BUFFER_MS = 0;
const NO_EDGE_MESSAGE = "No betting edge detected. More data needed before this becomes a confident pick.";
const NEEDS_STATS_MESSAGE = "This prop needs more stats before a confident pick can be made.";
const STREAK_WARNING = "Low multiplier does not guarantee the pick will hit. Verify before adding to streak.";

const DEFAULT_SOURCE_STATUS = {
  PrizePicks: "Pending",
  Underdog: "Pending",
  "The Odds API": "Pending",
};

const UNDERDOG_UNAVAILABLE_MESSAGE = "Underdog data source not connected or unavailable.";

function buildSourceHealth(backgroundWarnings = [], sourceFailures = [], sourceStatus = {}) {
  const health = {
    BallDontLie: "Connected",
    "Soccer stats": "Connected",
    "WNBA stats": "Connected",
  };
  const text = backgroundWarnings.join(" ").toLowerCase();
  if (/balldontlie|nba stat/.test(text)) health.BallDontLie = "Partial/fallback";
  if (/soccer player stats|soccer stat/.test(text)) health["Soccer stats"] = "Partial/fallback";
  if (/wnba stat/.test(text)) health["WNBA stats"] = "Partial/fallback";
  if (sourceFailures.length && sourceStatus.PrizePicks === "Failed") health.PrizePicks = "Failed";
  if (sourceFailures.length && sourceStatus.Underdog === "Failed") health.Underdog = "Failed";
  return health;
}

function partitionWarnings(backgroundWarnings, sourceFailures, sourceStatus) {
  const criticalPatterns = [
    /could not load prizepicks/i,
    /underdog unavailable/i,
    /underdog data source not connected/i,
    /no active scheduled props/i,
  ];
  const criticalWarnings = unique([
    ...sourceFailures,
    ...backgroundWarnings.filter((warning) => criticalPatterns.some((pattern) => pattern.test(warning))),
  ]);
  const sourceHealth = {
    PrizePicks: sourceStatus.PrizePicks || "Pending",
    Underdog: sourceStatus.Underdog || "Pending",
    "The Odds API": sourceStatus["The Odds API"] || "Pending",
    ...buildSourceHealth(backgroundWarnings, sourceFailures, sourceStatus),
  };
  return { criticalWarnings, sourceHealth };
}

const PLATFORM_OPTIONS = [
  { id: "all", label: "All Sources" },
  { id: "prizepicks", label: "PrizePicks" },
  { id: "underdog", label: "Underdog" },
  { id: "sportsbookEdge", label: "Sportsbook Edge" },
];

const EDGE_FILTER_OPTIONS = [
  { id: "all", label: "All Edges" },
  { id: "highConfidence", label: "High Confidence" },
  { id: "valuePlays", label: "Value Plays" },
  { id: "earlyLines", label: "Early Lines" },
];

const BASE_SPORT_OPTIONS = [
  { value: "all", label: "All Sports" },
  { value: "WNBA", label: "WNBA" },
  { value: "NBA", label: "NBA" },
  { value: "MLB", label: "MLB" },
  { value: "Tennis", label: "Tennis" },
  { value: "Soccer", label: "Soccer" },
];

const STREAK_TAB_OPTIONS = [
  { value: "MLB", label: "MLB", type: "sport", always: true },
  { value: "WNBA", label: "WNBA", type: "sport", always: true },
  { value: "NBA", label: "NBA", type: "sport", always: true },
  { value: "Soccer", label: "Soccer", type: "sport", always: true },
  { value: "goblins", label: "Goblins", type: "goblin", always: true },
  { value: "demons", label: "Demons", type: "demon", always: true },
];

const SUPPORTED_SPORTS = new Set(["MLB", "NBA", "WNBA", "ATP Tennis", "WTA Tennis", "Tennis", "Soccer", "NFL", "NCAAF", "NHL"]);

const PRIORITY_PROP_TYPES = [
  "all",
  "Pitcher Strikeouts",
  "Pitches Thrown",
  "Hits+Runs+RBIs",
  "Total Bases",
  "Hits",
  "RBIs",
  "Runs",
  "Fantasy Score",
  "Points",
  "Rebounds",
  "Assists",
  "Points + Rebounds + Assists",
  "3-Pointers Made",
  "Total Games",
  "Aces",
  "Double Faults",
  "Break Points",
  "Shots",
  "Shots On Target",
  "Goals Allowed",
  "Goalie Saves",
  "Passes Attempted",
];

const REALISTIC_PROJECTION_RANGES = [
  { sport: "MLB", match: (key) => key.includes("pitchesthrown") || key.includes("pitchcount"), label: "MLB Pitches Thrown", min: 40, max: 130 },
  { sport: "MLB", match: (key) => key.includes("strikeout") && !key.includes("hitter") && !key.includes("batter"), label: "MLB Strikeouts", min: 0, max: 15 },
  { sport: "MLB", match: (key) => key.includes("hitsrunsrbis") || key.includes("hrr"), label: "MLB Hits+Runs+RBIs", min: 0, max: 8 },
  { sport: "MLB", match: (key) => key.includes("totalbases"), label: "MLB Total Bases", min: 0, max: 8 },
  { sport: "MLB", match: (key) => key === "hits", label: "MLB Hits", min: 0, max: 5 },
  { sport: "MLB", match: (key) => key === "rbis" || key === "rbi", label: "MLB RBIs", min: 0, max: 6 },
  { sport: "MLB", match: (key) => key === "runs", label: "MLB Runs", min: 0, max: 5 },
  { sport: "MLB", match: (key) => key.includes("fantasyscore"), label: "MLB Fantasy Score", min: 0, max: 70 },
  { sport: "NBA", match: (key) => key === "points", label: "NBA Points", min: 0, max: 60 },
  { sport: "NBA", match: (key) => key === "rebounds", label: "NBA Rebounds", min: 0, max: 25 },
  { sport: "NBA", match: (key) => key === "assists", label: "NBA Assists", min: 0, max: 20 },
  { sport: "NBA", match: (key) => key.includes("pointsreboundsassists") || key === "pra", label: "NBA PRA", min: 0, max: 100 },
  { sport: "NBA", match: (key) => key.includes("3pointers") || key.includes("threepointers"), label: "NBA 3-Pointers Made", min: 0, max: 12 },
  { sport: "WNBA", match: (key) => key === "points", label: "WNBA Points", min: 0, max: 60 },
  { sport: "WNBA", match: (key) => key === "rebounds", label: "WNBA Rebounds", min: 0, max: 25 },
  { sport: "WNBA", match: (key) => key === "assists", label: "WNBA Assists", min: 0, max: 20 },
  { sport: "WNBA", match: (key) => key.includes("pointsreboundsassists") || key === "pra", label: "WNBA PRA", min: 0, max: 100 },
  { sport: "WNBA", match: (key) => key.includes("3pointers") || key.includes("threepointers"), label: "WNBA 3-Pointers Made", min: 0, max: 12 },
  { sport: "Tennis", match: (key) => key.includes("gameswon") || key.includes("playergames"), label: "Tennis Games Won", min: 0, max: 30 },
  { sport: "Tennis", match: (key) => key.includes("totalgames"), label: "Tennis Total Games", min: 12, max: 65 },
  { sport: "Tennis", match: (key) => key.includes("fantasyscore"), label: "Tennis Fantasy Score", min: 0, max: 90 },
  { sport: "Tennis", match: (key) => key.includes("aces"), label: "Tennis Aces", min: 0, max: 40 },
  { sport: "Tennis", match: (key) => key.includes("doublefault"), label: "Tennis Double Faults", min: 0, max: 20 },
  { sport: "Soccer", match: (key) => key === "shots" || key.includes("shotsattempted"), label: "Soccer Shots", min: 0, max: 10 },
  { sport: "Soccer", match: (key) => key.includes("shotsontarget"), label: "Soccer Shots On Target", min: 0, max: 7 },
  { sport: "Soccer", match: (key) => key.includes("passesattempted") || key === "passes", label: "Soccer Passes Attempted", min: 0, max: 140 },
  { sport: "Soccer", match: (key) => key.includes("goalsallowed"), label: "Soccer Goals Allowed", min: 0, max: 8 },
  { sport: "Soccer", match: (key) => key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves", label: "Soccer Goalie Saves", min: 0, max: 15 },
];

async function fetchDFSProps({ platform = "both", sport = "all", statType = "all" } = {}) {
  console.info("[DFS Source Audit] fetchDFSProps requested", { platform, sport, statType });
  const sourceJobs = [];
  if (platform === "both" || platform === "all" || platform === "prizepicks") {
    sourceJobs.push({
      label: "PrizePicks",
      run: () => fetchPrizePicksProps({ sport, statType: "all" }),
    });
  }
  if (platform === "both" || platform === "all" || platform === "underdog") {
    sourceJobs.push({
      label: "Underdog",
      run: () => fetchUnderdogProps({ sport, statType: "all" }),
    });
  }

  const settledSources = await Promise.allSettled(sourceJobs.map((job) => job.run()));
  const sourceWarnings = [];
  const sourceFailures = [];
  const rawProps = [];
  const sourceStatus = { ...DEFAULT_SOURCE_STATUS };
  const debugInfo = createDebugInfo(platform);

  settledSources.forEach((result, index) => {
    const label = sourceJobs[index].label;
    if (result.status === "fulfilled") {
      const props = result.value.props || [];
      sourceStatus[label] = result.value.status || "Connected";
      if (label === "Underdog" && (!props.length || sourceStatus[label] !== "Connected")) {
        sourceStatus.Underdog = sourceStatus[label] === "Connected" ? "Not Connected" : sourceStatus[label];
        if (!sourceWarnings.includes(UNDERDOG_UNAVAILABLE_MESSAGE)) sourceWarnings.push(UNDERDOG_UNAVAILABLE_MESSAGE);
      }
      rawProps.push(...props);
      sourceWarnings.push(...(result.value.warnings || []));
      debugInfo.sources[label] = {
        ...debugInfo.sources[label],
        status: sourceStatus[label],
        apiStatus: result.value.debug?.apiStatus || sourceStatus[label],
        apiUrl: result.value.debug?.apiUrl || "",
        endpointsTried: result.value.debug?.endpointsTried || [],
        rawPropsLoaded: result.value.debug?.rawPropsLoaded ?? props.length,
        propsAfterParsing: result.value.debug?.propsAfterParsing ?? props.length,
        message: result.value.debug?.message || "",
      };
    } else if (label === "PrizePicks") {
      sourceStatus.PrizePicks = "Failed";
      console.warn("PrizePicks load failed", result.reason);
      sourceFailures.push(errorWithDetail("Could not load PrizePicks lines.", result.reason));
      debugInfo.sources.PrizePicks = {
        ...debugInfo.sources.PrizePicks,
        status: "Failed",
        apiStatus: "Failed",
        message: result.reason?.message || "Could not load PrizePicks lines.",
      };
    } else if (label === "Underdog") {
      sourceStatus.Underdog = "Failed";
      console.warn("Underdog load failed", result.reason);
      sourceFailures.push(errorWithDetail("Underdog unavailable.", result.reason));
      sourceWarnings.push(UNDERDOG_UNAVAILABLE_MESSAGE);
      debugInfo.sources.Underdog = {
        ...debugInfo.sources.Underdog,
        ...(result.reason?.debug || {}),
        status: "Failed",
        apiStatus: result.reason?.debug?.apiStatus || "Failed",
        message: result.reason?.debug?.message || UNDERDOG_UNAVAILABLE_MESSAGE,
      };
    }
  });

  const canonicalProps = rawProps.map(canonicalizeSportProp);

  const activeProps = canonicalProps
    .filter((prop) => {
      const filterReason = getBaseActiveFilterReason(prop);
      if (filterReason) {
        logFilteredProp(prop, filterReason);
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const normalProps = activeProps
    .filter((prop) => {
      const filterReason = getPreScoringFilterReason(prop);
      if (filterReason) {
        logFilteredProp(prop, filterReason);
        return false;
      }
      if (!matchesStatTypeFilter(prop, statType)) return false;
      return true;
    });
  attachSourceFilterCounts(debugInfo, { rawProps: canonicalProps, activeProps, normalProps });

  if (!activeProps.length) {
    debugInfo.totals = {
      rawPropsLoaded: canonicalProps.length,
      activeProps: activeProps.length,
      propsAfterFilters: normalProps.length,
      recommendedProps: 0,
      watchlistProps: 0,
      streakProps: 0,
    };
    const emptyHealth = buildSourceHealth([], sourceFailures, sourceStatus);
    return {
      props: [],
      watchlist: [],
      streakProps: [],
      sourceStatus,
      sourceHealth: emptyHealth,
      criticalWarnings: sourceFailures,
      warnings: sourceFailures,
      debugInfo,
    };
  }

  const backgroundJobs = [
    { label: "sportsbook", run: () => fetchSportsbookComparison({ props: normalProps }) },
    { label: "stats", run: () => fetchPlayerStats({ props: normalProps }) },
    { label: "news", run: () => fetchInjuryNews({ props: normalProps }) },
  ];
  const settledBackground = await Promise.allSettled(backgroundJobs.map((job) => job.run()));
  const background = {
    comparisons: [],
    stats: new Map(),
    news: new Map(),
  };
  const backgroundWarnings = [];

  settledBackground.forEach((result, index) => {
    const label = backgroundJobs[index].label;
    if (result.status === "fulfilled") {
      backgroundWarnings.push(...(result.value.warnings || []));
      if (label === "sportsbook") {
        background.comparisons = result.value.comparisons || [];
        sourceStatus["The Odds API"] = sportsbookSourceStatus(result.value);
        debugInfo.sources["The Odds API"] = {
          ...debugInfo.sources["The Odds API"],
          status: sourceStatus["The Odds API"],
          apiStatus: sourceStatus["The Odds API"],
          rawPropsLoaded: normalProps.length,
          propsAfterParsing: background.comparisons.length,
          propsAfterFilters: background.comparisons.length,
          message: (result.value.warnings || []).join(" "),
        };
      }
      if (label === "stats") background.stats = result.value.stats || new Map();
      if (label === "news") background.news = result.value.news || new Map();
      return;
    }

    if (label === "sportsbook") {
      sourceStatus["The Odds API"] = "Failed";
      backgroundWarnings.push("Sportsbook comparison unavailable.");
      debugInfo.sources["The Odds API"] = {
        ...debugInfo.sources["The Odds API"],
        status: "Failed",
        apiStatus: "Failed",
        message: "Sportsbook comparison unavailable.",
      };
    }
    if (label === "stats") backgroundWarnings.push("Could not load player stats.");
    if (label === "news") backgroundWarnings.push("Could not load injury/news data.");
  });

  if (settledBackground.some((item) => item.status === "rejected")) {
    backgroundWarnings.push("Some data sources failed, but available props are still shown.");
  }

  const lineComparisonMap = buildLineComparisonMap(normalProps);
  const sportsbookComparisonMap = buildSportsbookComparisonMap(background.comparisons);
  const lineMovementMap = updateLineMovementMap(activeProps, sportsbookComparisonMap);
  const scoredProps = normalProps
    .map((prop) => scoreDFSProp(prop, { ...background, lineComparisonMap, sportsbookComparisonMap, lineMovementMap }))
    .filter((prop) => {
      const invalidReason = getFatalPropReason(prop);
      if (invalidReason) {
        logFilteredProp(prop, invalidReason);
        return false;
      }
      return true;
    })
    .map(applyRecommendationStatus);

  const recommendedProps = scoredProps
    .filter((prop) => prop.recommendationStatus === "recommended")
    .sort(sortRecommendedProps)
    .slice(0, MAX_RANKED_PROPS);

  const watchlistProps = scoredProps
    .filter((prop) => prop.recommendationStatus === "watchlist")
    .sort(sortWatchlistProps)
    .slice(0, MAX_WATCHLIST_PROPS);
  const modelSignalMap = buildModelSignalMap(scoredProps);
  const streakProps = buildStreakFinderProps(activeProps, modelSignalMap, lineMovementMap).sort(sortStreakProps).slice(0, MAX_STREAK_PROPS);
  attachScoredSourceCounts(debugInfo, { recommendedProps, watchlistProps, streakProps });
  debugInfo.totals = {
    rawPropsLoaded: canonicalProps.length,
    activeProps: activeProps.length,
    propsAfterFilters: normalProps.length,
    recommendedProps: recommendedProps.length,
    watchlistProps: watchlistProps.length,
    streakProps: streakProps.length,
  };

  const { criticalWarnings, sourceHealth } = partitionWarnings(
    unique([...sourceWarnings, ...backgroundWarnings]),
    sourceFailures,
    sourceStatus
  );

  return {
    props: recommendedProps,
    watchlist: watchlistProps,
    streakProps,
    sourceStatus,
    sourceHealth,
    criticalWarnings,
    warnings: criticalWarnings,
    debugInfo,
  };
}

export default function DFSPropsApp() {
  const [platform, setPlatform] = useState("all");
  const [sport, setSport] = useState("all");
  const [statType, setStatType] = useState("all");
  const [edgeFilter, setEdgeFilter] = useState("all");
  const [props, setProps] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [streakProps, setStreakProps] = useState([]);
  const [streakSport, setStreakSport] = useState("MLB");
  const [parlayRiskMode, setParlayRiskMode] = useState("balanced");
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [learningSaveNotice, setLearningSaveNotice] = useState("");
  const [criticalWarnings, setCriticalWarnings] = useState([]);
  const [sourceHealth, setSourceHealth] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(() => readHistory());
  const [parlayHistory, setParlayHistory] = useState(() => readParlayHistory());
  const [lastUpdated, setLastUpdated] = useState("");
  const [cacheStatus, setCacheStatus] = useState("");
  const [sourceStatus, setSourceStatus] = useState(DEFAULT_SOURCE_STATUS);
  const [debugInfo, setDebugInfo] = useState(() => createDebugInfo("all"));

  const loadProps = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError("");
    setLearningSaveNotice("");
    try {
      if (force) {
        clearApiCache();
        clearBoardCache();
      }

      if (!force) {
        const cached = readCachedBoard(DEFAULT_SOURCE_STATUS);
        if (cached) {
          setProps(cached.props);
          setWatchlist(cached.watchlist || []);
          setStreakProps(cached.streakProps || []);
          setCriticalWarnings(cached.warnings || []);
          setSourceStatus(cached.sourceStatus || DEFAULT_SOURCE_STATUS);
          setSourceHealth(cached.sourceHealth || {});
          setDebugInfo(cached.debugInfo || createDebugInfo(platform));
          setLastUpdated(cached.updatedAt);
          setCacheStatus("cached");
          return;
        }
      }

      const result = await fetchDFSProps({ platform: "both", sport: "all", statType: "all" });
      const board = {
        props: result.props || [],
        watchlist: result.watchlist || [],
        streakProps: result.streakProps || [],
        warnings: result.criticalWarnings || [],
        sourceStatus: result.sourceStatus || DEFAULT_SOURCE_STATUS,
        sourceHealth: result.sourceHealth || {},
        debugInfo: result.debugInfo || createDebugInfo(platform),
        updatedAt: new Date().toISOString(),
      };
      writeCachedBoard(board);
      setProps(board.props);
      setWatchlist(board.watchlist);
      setStreakProps(board.streakProps);
      setCriticalWarnings(board.warnings);
      setSourceStatus(board.sourceStatus);
      setSourceHealth(board.sourceHealth);
      setDebugInfo(board.debugInfo);
      setLastUpdated(board.updatedAt);
      setCacheStatus("fresh");
      const updatedHistory = savePropsOfDay(board.props);
      setHistory(updatedHistory);
    } catch (loadError) {
      setError(loadError.message || "Could not load DFS lines.");
      setProps([]);
      setWatchlist([]);
      setStreakProps([]);
      setCriticalWarnings([]);
      setSourceHealth({});
      setSourceStatus(DEFAULT_SOURCE_STATUS);
      setDebugInfo(createDebugInfo(platform));
      setCacheStatus("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProps();
  }, [loadProps]);

  useEffect(() => {
    if (platform === "underdog") {
      console.info("[Underdog Audit] Underdog tab/source selected", {
        sourceStatus: sourceStatus.Underdog,
        debug: debugInfo.sources?.Underdog,
      });
    }
  }, [platform, sourceStatus, debugInfo]);

  const filteredProps = useMemo(
    () => props.filter((prop) => matchesUiFilters(prop, { platform, sport, statType, edgeFilter })),
    [props, platform, sport, statType, edgeFilter]
  );
  const filteredWatchlist = useMemo(
    () => watchlist.filter((prop) => matchesUiFilters(prop, { platform, sport, statType, edgeFilter })),
    [watchlist, platform, sport, statType, edgeFilter]
  );
  const filteredStreakProps = useMemo(
    () => streakProps.filter((prop) => matchesUiFilters(prop, { platform, sport, statType, edgeFilter })),
    [streakProps, platform, sport, statType, edgeFilter]
  );
  const streakFinderProps = useMemo(
    () =>
      streakProps.filter(
        (prop) =>
          matchesPlatformFilter(prop, platform) &&
          matchesStatTypeFilter(prop, statType)
      ),
    [streakProps, platform, statType]
  );
  const propsOfDay = useMemo(() => filteredProps.slice(0, PROPS_OF_DAY_LIMIT), [filteredProps]);
  const visibleHistory = useMemo(() => history.filter(isSupportedHistoryPick), [history]);
  const streakSportBoards = useMemo(
    () => buildStreakSportCategoryBoards(streakFinderProps, visibleHistory),
    [streakFinderProps, visibleHistory]
  );
  const visibleStreakSports = useMemo(() => visibleStreakSportOptions(streakSportBoards), [streakSportBoards]);
  const currentStreakBoard = streakSportBoards[streakSport] || emptyStreakSportBoard(streakSport);
  const currentCategoryPicks = currentStreakBoard.picks || [];
  const currentCategoryLabel = currentStreakBoard.label || STREAK_TAB_OPTIONS.find((option) => option.value === streakSport)?.label || "MLB";
  const isGoblinTab = streakSport === "goblins";
  const isDemonTab = streakSport === "demons";
  const propsOfDayPreview = propsOfDay.slice(0, 3);
  const rankedPropsPreview = filteredProps.slice(0, 12);
  const dashboard = useMemo(() => buildAccuracyDashboard(visibleHistory), [visibleHistory]);
  const quickParlayPicks = useMemo(
    () => buildQuickParlayPicks(streakSportBoards, parlayRiskMode),
    [streakSportBoards, parlayRiskMode]
  );
  const parlayDashboard = useMemo(() => buildParlayDashboard(parlayHistory), [parlayHistory]);
  const lastUpdatedLabel = lastUpdated ? `${formatDateTime(lastUpdated)}${cacheStatus === "cached" ? " (cached)" : ""}` : "Never";
  const staleDataWarning = lastUpdated && Date.now() - new Date(lastUpdated).getTime() > DFS_CACHE_TTL_MS
    ? "Stale data warning: refresh today's picks before using these lines."
    : "";
  const sportOptions = BASE_SPORT_OPTIONS;
  const platformOptions = useMemo(() => platformOptionsForStatus(sourceStatus), [sourceStatus]);
  const debugPanel = useMemo(
    () =>
      buildVisibleDebugPanel(debugInfo, {
        platform,
        props,
        watchlist,
        streakProps,
        filteredProps,
        filteredWatchlist,
        filteredStreakProps,
        streakSportBoards,
        history: visibleHistory,
        lastUpdated,
        sourceStatus,
      }),
    [debugInfo, platform, props, watchlist, streakProps, filteredProps, filteredWatchlist, filteredStreakProps, streakSportBoards, visibleHistory, lastUpdated, sourceStatus]
  );
  const underdogUnavailable =
    platform === "underdog" &&
    !loading &&
    (sourceStatus.Underdog !== "Connected" || Number(debugInfo.sources?.Underdog?.propsAfterParsing || 0) === 0);

  useEffect(() => {
    if (!visibleStreakSports.some((option) => option.value === streakSport)) {
      setStreakSport(visibleStreakSports[0]?.value || "MLB");
    }
  }, [visibleStreakSports, streakSport]);

  useEffect(() => {
    if (loading || !lastUpdated) return;
    const generatedPicks = [...generatedStreakPicks(streakSportBoards), ...quickParlayPicks];
    if (!generatedPicks.length) return;
    const updatedHistory = saveGeneratedCategoryPicks(generatedPicks);
    if (JSON.stringify(updatedHistory.slice(0, 40)) !== JSON.stringify(history.slice(0, 40))) {
      setHistory(updatedHistory);
      const added = Math.max(0, updatedHistory.length - history.length);
      setLearningSaveNotice(added ? `${added} new generated picks saved for accuracy review.` : "Generated pick memory updated.");
    }
    const updatedParlays = saveGeneratedParlay(quickParlayPicks, parlayHistory);
    if (updatedParlays.length !== parlayHistory.length) setParlayHistory(updatedParlays);
  }, [loading, lastUpdated, streakSportBoards, quickParlayPicks, history.length, parlayHistory]);

  function updatePickResult(id, resultStatus, actualStatResult = null) {
    const updated = history.map((pick) => {
      if (pick.id !== id) return pick;
      return {
        ...pick,
        resultStatus,
        finalResult: resultStatus,
        actualStatResult: actualStatResult ?? pick.actualStatResult ?? "",
        settledAt: resultStatus === "Pending" ? "" : new Date().toISOString(),
      };
    });
    writeHistory(updated);
    setHistory(updated);
    const updatedParlays = refreshParlayResults(parlayHistory, updated);
    writeParlayHistory(updatedParlays);
    setParlayHistory(updatedParlays);
  }

  function clearHistory() {
    if (!window.confirm("Clear all saved pick history?")) return;
    writeHistory([]);
    setHistory([]);
  }

  function exportHistoryCsv() {
    const csv = historyToCsv(history);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `props-of-the-day-history-${dateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div>
          <p style={styles.eyebrow}>DFS pick'em analytics</p>
          <h1 style={styles.title}>PrizePicks + Underdog Pick'em Engine</h1>
          <p style={styles.subtitle}>
            Real active lines only. Expired, locked, live, and already-started props are filtered out before scoring.
          </p>
          <p style={styles.lastUpdated}>Last updated: {lastUpdatedLabel}</p>
        </div>
        <button style={styles.refreshButton} onClick={() => loadProps({ force: true })} disabled={loading} title="Clears API cache and refetches all sources">
          {loading ? "Loading" : "Refresh (clear cache)"}
        </button>
      </section>

      <section style={styles.streakControls} aria-label="Streak Finder filters">
        <div>
          <p style={styles.eyebrow}>Reference tool only</p>
          <h2 style={styles.streakTitle}>Streak Finder</h2>
          <p style={styles.streakCopy}>
            Pick one category and the app shows only its 2 strongest active streak picks.
          </p>
        </div>
        <div style={styles.segmentGroup}>
          <span style={styles.controlLabel}>Category Tabs</span>
          <div style={styles.segmentRow}>
            {visibleStreakSports.map((option) => (
              <button
                key={option.value}
                style={streakSport === option.value ? styles.segmentActive : styles.segment}
                onClick={() => setStreakSport(option.value)}
              >
                {option.label} ({streakSportBoards[option.value]?.generatedCount || 0})
              </button>
            ))}
          </div>
          {learningSaveNotice && <p style={styles.streakNotice}>{learningSaveNotice}</p>}
        </div>
      </section>

      {criticalWarnings.length > 0 && (
        <section style={styles.errorPanel}>
          {criticalWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </section>
      )}

      {underdogUnavailable && <section style={styles.errorPanel}>{UNDERDOG_UNAVAILABLE_MESSAGE}</section>}

      {error && <section style={styles.errorPanel}>{error}</section>}

      <section style={styles.section}>
        <div style={styles.sectionHeading}>
          <div>
            <p style={styles.eyebrow}>{currentCategoryLabel}</p>
            <h2 style={styles.sectionTitle}>2 Strongest App-Selected Picks</h2>
          </div>
          <p style={styles.countPill}>
            {isGoblinTab ? `${currentCategoryPicks.length} Goblin Picks` : isDemonTab ? `${currentCategoryPicks.length} Demon Picks` : `${currentCategoryPicks.length}/2 picks`}
          </p>
        </div>

        {loading ? (
          <EmptyState text={`Finding the strongest ${currentCategoryLabel} streak picks.`} />
        ) : isGoblinTab && currentCategoryPicks.length === 0 ? (
          <EmptyState text="No verified Goblin props available right now." />
        ) : isDemonTab && currentCategoryPicks.length === 0 ? (
          <EmptyState text="No verified Demon props available right now." />
        ) : currentCategoryPicks.length === 0 ? (
          <EmptyState text={`No active scheduled props found for ${currentCategoryLabel}. Try Refresh or another category.`} />
        ) : (
          <>
            <div style={styles.cardGrid}>
              {currentCategoryPicks.map((prop) => (
                <StreakCard key={prop.id} prop={prop} onOpen={setSelectedEvaluation} />
              ))}
            </div>
            {isGoblinTab && <p style={styles.compactFlags}>Low payout does not guarantee hit.</p>}
            {isDemonTab && <p style={styles.compactFlags}>Higher payout means higher variance. Verify before using aggressive props.</p>}
          </>
        )}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeading}>
          <div>
            <p style={styles.eyebrow}>Low correlation</p>
            <h2 style={styles.sectionTitle}>Quick 4-Man Builder</h2>
          </div>
          <div style={styles.segmentRow}>
            <button
              style={parlayRiskMode === "balanced" ? styles.segmentActive : styles.segment}
              onClick={() => setParlayRiskMode("balanced")}
            >
              Balanced
            </button>
            <button
              style={parlayRiskMode === "aggressive" ? styles.segmentActive : styles.segment}
              onClick={() => setParlayRiskMode("aggressive")}
            >
              Aggressive
            </button>
            <p style={styles.countPill}>{quickParlayPicks.length}/4 picks</p>
          </div>
        </div>

        {quickParlayPicks.length < 4 ? (
          <EmptyState text="Not enough qualified picks for a 4-man right now." />
        ) : (
          <>
            <div style={styles.cardGridCompact}>
              {quickParlayPicks.map((prop) => (
                <ParlayLegCard key={prop.id} prop={prop} onOpen={setSelectedEvaluation} />
              ))}
            </div>
            <p style={styles.compactFlags}>
              Correlation check: {parlayCorrelationRisk(quickParlayPicks)}. This is a reference build, not guaranteed winnings.
            </p>
          </>
        )}
      </section>

      <details style={styles.compactDetails}>
        <summary style={styles.detailsSummary}>
          <span>
            <span style={styles.eyebrow}>Board controls</span>
            <strong>Filters</strong>
          </span>
          <span style={styles.countPill}>{sourceLabel(platform)} / {sport === "all" ? "All Sports" : sport}</span>
        </summary>
        <div style={styles.compactPanel}>
          <section style={styles.controls} aria-label="DFS filters">
            <div style={styles.segmentGroup}>
              <span style={styles.controlLabel}>Source Filter</span>
              <div style={styles.segmentRow}>
                {platformOptions.map((option) => (
                  <button
                    key={option.id}
                    style={platform === option.id ? styles.segmentActive : styles.segment}
                    onClick={() => setPlatform(option.id)}
                    title={option.statusMessage || option.label}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label style={styles.selectLabel}>
              Sport
              <select style={styles.select} value={sport} onChange={(event) => setSport(event.target.value)}>
                {sportOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.selectLabel}>
              Prop Type
              <select style={styles.select} value={statType} onChange={(event) => setStatType(event.target.value)}>
                {PRIORITY_PROP_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option === "all" ? "All Prop Types" : option}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section style={styles.quickFilters} aria-label="Edge filters">
            <span style={styles.controlLabel}>Edge Filters</span>
            <div style={styles.segmentRow}>
              {EDGE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  style={edgeFilter === option.id ? styles.segmentActive : styles.segment}
                  onClick={() => setEdgeFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </details>

      <SourceStatusBar sourceStatus={sourceStatus} sourceHealth={sourceHealth} cacheStatus={cacheStatus} stale={Boolean(staleDataWarning)} />

      <section style={styles.summaryStrip} aria-label="Compact board summary">
        <div style={styles.summaryCard}>
          <span style={styles.metricLabel}>Saved Picks</span>
          <strong>{visibleHistory.length}</strong>
          <span style={styles.summaryHint}>accuracy review</span>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.metricLabel}>Watchlist</span>
          <strong>{filteredWatchlist.length} active</strong>
          <span style={styles.summaryHint}>not shown on main page</span>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.metricLabel}>Props of the Day</span>
          <strong>{propsOfDay.length}</strong>
          <span style={styles.summaryHint}>compact below</span>
        </div>
        <div style={styles.summaryCard}>
          <span style={styles.metricLabel}>Ranked DFS</span>
          <strong>{filteredProps.length}</strong>
          <span style={styles.summaryHint}>secondary board</span>
        </div>
      </section>

      <details style={styles.compactDetails}>
        <summary style={styles.detailsSummary}>
          <span>
            <span style={styles.eyebrow}>Highest confidence</span>
            <strong>Props of the Day</strong>
          </span>
          <span style={styles.countPill}>{propsOfDay.length} active picks</span>
        </summary>
        <div style={styles.compactPanel}>
          {loading ? (
            <EmptyState text="Loading active PrizePicks and Underdog lines." />
          ) : propsOfDayPreview.length === 0 ? (
            <EmptyState text="No active scheduled props found for this sport/platform." />
          ) : (
            <div style={styles.cardGridCompact}>
              {propsOfDayPreview.map((prop) => (
                <PropCard key={prop.id} prop={prop} compact onOpen={setSelectedEvaluation} />
              ))}
            </div>
          )}
        </div>
      </details>

      <details style={styles.compactDetails}>
        <summary style={styles.detailsSummary}>
          <span>
            <span style={styles.eyebrow}>Active board</span>
            <strong>Ranked DFS Props</strong>
          </span>
          <span style={styles.countPill}>{filteredProps.length} shown</span>
        </summary>
        <div style={styles.compactPanel}>
          {loading ? (
            <EmptyState text="Refreshing current lines." />
          ) : rankedPropsPreview.length === 0 ? (
            <EmptyState text="No active scheduled props found for this sport/platform." />
          ) : (
            <div style={styles.cardGridCompact}>
              {rankedPropsPreview.map((prop) => (
                <PropCard key={prop.id} prop={prop} onOpen={setSelectedEvaluation} />
              ))}
            </div>
          )}
        </div>
      </details>

      <section style={styles.watchlistSummary}>
        <div style={styles.sectionHeading}>
          <div>
            <p style={styles.eyebrow}>No forced picks</p>
            <h2 style={styles.sectionTitleSmall}>Watchlist</h2>
          </div>
          <p style={styles.countPill}>Watchlist: {filteredWatchlist.length} active</p>
        </div>
      </section>

      <AccuracyDashboard
        dashboard={dashboard}
        history={visibleHistory}
        updatePickResult={updatePickResult}
        clearHistory={clearHistory}
        exportHistoryCsv={exportHistoryCsv}
      />

      <ParlayHistoryPanel history={parlayHistory} dashboard={parlayDashboard} />

      <SourceDebugPanel debug={debugPanel} />

      {selectedEvaluation && (
        <EvaluationModal prop={selectedEvaluation} onClose={() => setSelectedEvaluation(null)} />
      )}
    </main>
  );
}

function PropCard({ prop, watchlist = false, compact = false, onOpen }) {
  const isWatchlist = watchlist || prop.recommendationStatus === "watchlist";
  const tier = confidenceTier(prop);
  const lean = isWatchlist ? "Watch" : formatLeanSide(prop.bestPick || "Watch");
  const badge = prop.dataQualityBadge || dataQualityBadge(prop);

  return (
    <article
      style={isWatchlist ? { ...styles.card, ...styles.watchlistCard } : styles.card}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(prop)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(prop);
        }
      }}
    >
      <div style={styles.compactCardTop}>
        <PlayerImage prop={prop} compact />
        <div style={styles.cardInfo}>
          <div style={styles.cardTitleRow}>
            <div>
              <p style={styles.platform}>{prop.platform} · {displaySport(prop)}</p>
              <h3 style={styles.playerName}>{prop.playerName}</h3>
              <p style={styles.gameLine}>
                {prop.team || "Team"} vs {prop.opponent || "Opponent"}
              </p>
            </div>
            <div style={styles.cardBadgeColumn}>
              <DataQualityBadge badge={badge} />
              <span style={tierStyle(tier)}>{isWatchlist ? "Watch" : tier}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={compact ? styles.compactMetaGridTight : styles.compactMetaGrid}>
        <Metric label="Prop" value={prop.statType} />
        <Metric label="Line" value={formatNumber(prop.line)} />
        <Metric label="Lean" value={lean} strong />
        <Metric label="Confidence" value={`${prop.confidenceScore}%`} strong />
        {!compact && <Metric label="Risk" value={prop.riskLevel || "Medium"} />}
      </div>
      <div style={styles.whyLink}>Why this pick?</div>
    </article>
  );
}

function StreakCard({ prop, avoid = false, ladder = false, onOpen }) {
  const tier = avoid ? "Risky" : confidenceTier(prop);
  const cardTone = prop.streakCategory === "goblins" || isGoblinProp(prop)
    ? styles.goblinCard
    : prop.streakCategory === "demons" || isDemonProp(prop)
      ? styles.demonCard
      : styles.streakCard;

  return (
    <article
      style={{ ...styles.card, ...(avoid ? styles.avoidCard : ladder ? styles.ladderCard : cardTone) }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(prop)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(prop);
        }
      }}
    >
      <div style={styles.compactCardTop}>
        <PlayerImage prop={prop} />
        <div style={styles.cardInfo}>
          <div style={styles.cardTitleRow}>
            <div>
              <p style={styles.platform}>{prop.platform}</p>
              <h3 style={styles.playerName}>{prop.playerName}</h3>
              <p style={styles.gameLine}>
                {prop.team || "Team"} vs {prop.opponent || "Opponent"}
              </p>
            </div>
            <div style={styles.cardBadgeColumn}>
              <DataQualityBadge badge={prop.dataQualityBadge || dataQualityBadge(prop)} />
              <span style={tierStyle(tier)}>{avoid ? "Risky" : tier}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.compactMetaGridTight}>
        <Metric label="Prop" value={prop.statType} />
        <Metric label="Line" value={formatNumber(prop.line)} />
        <Metric label="Lean" value={formatLeanSide(prop.side || prop.bestPick)} strong />
        <Metric label="Conf." value={`${prop.confidenceScore}%`} strong />
        <Metric label="Type" value={prop.payoutLabel || propPayoutLabel(prop)} />
        <Metric label="Risk" value={prop.riskLevel || "Medium"} />
      </div>

      <div style={styles.whyLink}>Why this pick?</div>
    </article>
  );
}

function ParlayLegCard({ prop, onOpen }) {
  return (
    <article
      style={{ ...styles.card, ...styles.parlayCard }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(prop)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(prop);
        }
      }}
    >
      <div style={styles.compactCardTop}>
        <PlayerImage prop={prop} />
        <div style={styles.cardInfo}>
          <p style={styles.platform}>{prop.platform}</p>
          <h3 style={styles.playerName}>{prop.playerName}</h3>
          <p style={styles.gameLine}>{displaySport(prop)} - {prop.team || "Team"} vs {prop.opponent || "Opponent"}</p>
        </div>
        <span style={tierStyle(confidenceTier(prop))}>{confidenceTier(prop)}</span>
      </div>
      <div style={styles.compactMetaGrid}>
        <Metric label="Prop" value={prop.statType} />
        <Metric label="Line" value={formatNumber(prop.line)} />
        <Metric label="Side" value={formatLeanSide(prop.side || prop.bestPick)} strong />
        <Metric label="Confidence" value={`${prop.confidenceScore}%`} strong />
        <Metric label="Risk" value={prop.riskLevel || "Medium"} />
        <Metric label="Why included" value={parlayIncludeReason(prop)} />
      </div>
      {parlayLegWarning(prop) && <p style={styles.compactFlags}>{parlayLegWarning(prop)}</p>}
    </article>
  );
}

function EvaluationModal({ prop, onClose }) {
  const lean = formatLeanSide(prop.bestPick || prop.side || "Watch");
  const isWatchlist = prop.recommendationStatus === "watchlist";
  const tier = confidenceTier(prop);
  const explanation = buildPickExplanation({
    ...prop,
    dataQualityBadge: prop.dataQualityBadge || dataQualityBadge(prop),
    dataSources: prop.dataSources || dataSourcesUsed(prop),
  });
  const badge = prop.dataQualityBadge || dataQualityBadge(prop);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div style={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        style={styles.modalPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`${prop.playerName} evaluation`}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div style={styles.modalPlayer}>
            <PlayerImage prop={prop} large />
            <div>
              <p style={styles.platform}>{prop.platform}</p>
              <h2 style={styles.modalTitle}>{prop.playerName}</h2>
              <p style={styles.gameLine}>
                {displaySport(prop)} - {prop.team || "Team"} vs {prop.opponent || "Opponent"}
              </p>
            </div>
          </div>
          <button style={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={styles.tagRow}>
          <span style={tierStyle(tier)}>{tier}</span>
          <span style={riskStyle(prop.riskLevel)}>{prop.riskLevel || "Medium"}</span>
          <DataQualityBadge badge={badge} />
          {(prop.payoutLabel || propPayoutLabel(prop)) !== "standard" && (
            <span style={styles.valueTag}>{prop.payoutLabel || propPayoutLabel(prop)}</span>
          )}
          {prop.valueTags?.map((tag) => (
            <span key={tag} style={styles.valueTag}>
              {tag}
            </span>
          ))}
        </div>

        <div style={styles.modalGrid}>
          <Metric label="Prop Type" value={prop.statType} />
          <Metric label="Line" value={formatNumber(prop.line)} />
          <Metric label="Final Over/Under Lean" value={isWatchlist ? "No Edge / Watch" : lean} strong />
          <Metric label="Confidence Score" value={`${prop.confidenceScore ?? "-"}${prop.side ? "%" : "/100"}`} strong />
          <Metric label="Model Projection" value={prop.projection == null ? "Needs stats" : formatNumber(prop.projection)} />
          <Metric label="Stat Edge" value={formatSignedNumber(prop.edge)} strong />
          <Metric label="Edge Percentage" value={formatSignedPercent(edgePercentForProp(prop))} />
          <Metric label="Model Probability" value={formatPercent(prop.modelProbability)} />
          <Metric label="Implied Probability" value={formatPercent(prop.impliedProbability)} />
          <Metric label="Expected Value" value={formatSignedPercent(prop.expectedValue)} strong />
          <Metric label="Last 5 Hit Rate" value={formatPercent(prop.last5HitRate || prop.modelSignal?.last5HitRate)} />
          <Metric label="Last 10 Hit Rate" value={formatPercent(prop.last10HitRate || prop.modelSignal?.last10HitRate || prop.recentHitRate)} />
          <Metric label="Risk Level" value={prop.riskLevel || "Medium"} />
          <Metric label="Opponent/Matchup Ranking" value={prop.matchupRating || prop.modelSignal?.matchupRating || "Neutral"} />
          <Metric label="Usage / Minutes / Pitch Count" value={usageContextForProp(prop)} />
          <Metric label="Injury/News Notes" value={prop.injuryRisk || prop.modelSignal?.injuryRisk || "Low"} />
          <Metric label="Opening Line" value={formatMaybeLine((prop.lineMovement || prop.modelSignal?.lineMovement)?.openingLine)} />
          <Metric label="Current Line" value={formatMaybeLine((prop.lineMovement || prop.modelSignal?.lineMovement)?.currentLine)} />
          <Metric label="Movement Amount" value={formatSignedNumber((prop.lineMovement || prop.modelSignal?.lineMovement)?.move)} />
          <Metric label="Line Movement Status" value={lineMovementStatusText(prop)} />
          <Metric label="Sharp Money" value={prop.sharpMoneyIndicator || prop.modelSignal?.sharpMoneyIndicator || "No sharp signal"} />
          <Metric label="Data Sources Used" value={dataSourcesUsed(prop).join(", ")} />
          <Metric label="Key Stats Used" value={keyStatsSummary(prop)} />
          <Metric label="Warning Flags" value={warningFlags(prop).join(", ") || "None"} />
          <Metric label="Risk Explanation" value={riskExplanation(prop)} />
          <Metric label="Why It Made Top 2" value={prop.topTwoReason || "Ranked by confidence, probability, low volatility, and source agreement."} />
          <Metric label="Start Time" value={formatDateTime(prop.startTime)} />
        </div>

        {(prop.lineComparison || prop.sportsbookComparison) && (
          <div style={styles.comparisonBox}>
            {prop.lineComparison && <span>PrizePicks: {formatMaybeLine(prop.lineComparison.prizePicksLine)}</span>}
            {prop.lineComparison && <span>Underdog: {formatMaybeLine(prop.lineComparison.underdogLine)}</span>}
            {prop.lineComparison && <span>Platform gap: {formatNumber(prop.lineComparison.difference)}</span>}
            {prop.sportsbookComparison && <span>Sportsbook avg: {formatMaybeLine(prop.sportsbookComparison.marketAverageLine)}</span>}
            {prop.sportsbookComparison && <span>Books: {prop.sportsbookComparison.books || 0}</span>}
            {prop.sportsbookComparison && <span>DFS discrepancy: {formatSignedNumber(prop.sportsbookDiscrepancy)}</span>}
          </div>
        )}

        {prop.whyNotElite?.length > 0 && (
          <div style={styles.watchlistMessage}>
            <strong>Why not Elite</strong>
            <span>{prop.whyNotElite.join(", ")}.</span>
          </div>
        )}

        <div style={styles.explanationSections}>
          {explanation.map((section) => (
            <div key={section.title} style={styles.explanationBlock}>
              <strong>{section.title}</strong>
              <ul style={styles.explanationList}>
                {section.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={styles.evaluationText}>
          <strong>Summary</strong>
          <p>{isWatchlist ? prop.watchlistMessage || NO_EDGE_MESSAGE : prop.reasoningSummary}</p>
          {prop.side && <p>{STREAK_WARNING}</p>}
        </div>
      </section>
    </div>
  );
}

function PlayerImage({ prop, large = false, compact = false }) {
  const initials = playerInitials(prop.playerName);
  const avatarFallback = getPlayerImage(prop.playerName, prop.sport);
  const remoteSrc = prop.playerImage || prop.headshot || prop.imageUrl || prop.image_url || prop.player_image || "";
  const [imageSrc, setImageSrc] = useState(remoteSrc);
  const [showInitials, setShowInitials] = useState(!remoteSrc);

  useEffect(() => {
    setImageSrc(remoteSrc);
    setShowInitials(!remoteSrc);
  }, [remoteSrc]);

  const wrapStyle = large
    ? { ...styles.playerImageWrap, ...styles.playerImageWrapLarge }
    : compact
      ? { ...styles.playerImageWrap, ...styles.playerImageWrapCompact }
      : styles.playerImageWrap;

  return (
    <div style={wrapStyle} aria-hidden="true">
      {showInitials ? (
        <span style={styles.playerInitials}>{initials}</span>
      ) : (
        <img
          src={imageSrc}
          alt=""
          style={styles.playerImage}
          loading="lazy"
          onError={() => {
            setShowInitials(true);
            setImageSrc(avatarFallback);
          }}
        />
      )}
    </div>
  );
}

function playerInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function Metric({ label, value, strong = false }) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={strong ? styles.metricValueStrong : styles.metricValue}>{value}</strong>
    </div>
  );
}

function EmptyState({ text }) {
  return <div style={styles.emptyState}>{text}</div>;
}

function SourceStatusBar({ sourceStatus, sourceHealth = {}, cacheStatus = "", stale = false }) {
  const items = [
    ["PrizePicks", sourceStatus?.PrizePicks || "Pending"],
    ["Underdog", sourceStatus?.Underdog || "Pending"],
    ["Odds API", sourceStatus?.["The Odds API"] || "Pending"],
    ["BallDontLie", sourceHealth.BallDontLie || "—"],
    ["Soccer stats", sourceHealth["Soccer stats"] || "—"],
    ["WNBA stats", sourceHealth["WNBA stats"] || "—"],
  ];

  return (
    <section style={styles.sourceStatusBar} aria-label="Source status">
      {items.map(([source, status]) => (
        <div key={source} style={styles.sourceStatusItem}>
          <span style={styles.sourceName}>{source}</span>
          <span style={sourceStatusStyle(status)}>{status}</span>
        </div>
      ))}
      {cacheStatus && (
        <div style={styles.sourceStatusItem}>
          <span style={styles.sourceName}>Board cache</span>
          <span style={sourceStatusStyle(stale ? "Partial/fallback" : cacheStatus === "fresh" ? "Connected" : "Cached")}>
            {stale ? "Stale — refresh" : cacheStatus}
          </span>
        </div>
      )}
    </section>
  );
}

function DataQualityBadge({ badge }) {
  if (!badge?.label) return null;
  const toneStyle =
    badge.tone === "full"
      ? styles.dataBadgeFull
      : badge.tone === "partial"
        ? styles.dataBadgePartial
        : badge.tone === "fallback"
          ? styles.dataBadgeFallback
          : styles.dataBadgeWeak;
  return <span style={{ ...styles.dataQualityBadge, ...toneStyle }}>{badge.label}</span>;
}

function SourceDebugPanel({ debug }) {
  const sources = debug?.sources || {};
  const selected = debug?.selectedSource || "all";
  const generatedBySport = debug?.generatedBySport || [];

  return (
    <details style={styles.debugPanel} aria-label="Source debug panel">
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Data source audit</span>
          <strong>Debug Panel</strong>
        </span>
        <span style={styles.countPill}>Selected source: {sourceLabel(selected)}</span>
      </summary>

      <div style={styles.debugGrid}>
        {Object.entries(DEFAULT_SOURCE_STATUS).map(([source]) => {
          const row = sources[source] || emptySourceDebug(source);
          return (
            <div key={source} style={styles.debugCard}>
              <div style={styles.debugCardTop}>
                <strong>{source}</strong>
                <span style={sourceStatusStyle(row.status || "Pending")}>{row.status || "Pending"}</span>
              </div>
              <div style={styles.debugRows}>
                <DebugRow label="API status" value={row.apiStatus || row.status || "Pending"} />
                <DebugRow label="API/proxy URL" value={row.apiUrl || "Not called"} />
                <DebugRow label="Raw props loaded" value={row.rawPropsLoaded ?? 0} />
                <DebugRow label="Props after parsing" value={row.propsAfterParsing ?? 0} />
                <DebugRow label="Props after filters" value={row.propsAfterFilters ?? 0} />
                {row.visibleAfterCurrentFilters != null && (
                  <DebugRow label="Visible now" value={row.visibleAfterCurrentFilters} />
                )}
                {row.message && <DebugRow label="Message" value={row.message} />}
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.debugSummaryGrid}>
        <DebugRow label="Last refresh" value={debug?.lastRefresh ? formatDateTime(debug.lastRefresh) : "Never"} />
        <DebugRow label="Saved picks" value={debug?.savedPicks ?? 0} />
        <DebugRow label="Generated by category" value={generatedBySport.map((row) => `${row.sport}: ${row.count}`).join(" | ") || "None"} />
        <DebugRow label="Source mix" value={debug?.sourceMix || "No visible picks"} />
      </div>
    </details>
  );
}

function DebugRow({ label, value }) {
  return (
    <div style={styles.debugRow}>
      <span>{label}</span>
      <strong>{String(value)}</strong>
    </div>
  );
}

function AccuracyDashboard({ dashboard, history, updatePickResult, clearHistory, exportHistoryCsv }) {
  const [historyFilter, setHistoryFilter] = useState({ date: "all", sport: "all", categorySource: "all", result: "all", platform: "all" });
  const filteredHistory = history.filter((pick) => matchesHistoryFilter(pick, historyFilter));
  const recent = filteredHistory.slice(0, 12);
  const filterOptions = historyFilterOptions(history);

  return (
    <details style={styles.compactDetails}>
      <summary style={styles.detailsSummary}>
        <div>
          <p style={styles.eyebrow}>Saved picks</p>
          <strong>Saved Picks / Accuracy Review</strong>
        </div>
        <div style={styles.dashboardActions}>
          <button style={styles.secondaryButton} onClick={exportHistoryCsv} disabled={history.length === 0}>
            Export CSV
          </button>
          <button style={styles.secondaryButton} onClick={clearHistory} disabled={history.length === 0}>
            Clear History
          </button>
          <p style={styles.countPill}>{dashboard.total} saved</p>
        </div>
      </summary>

      <div style={{ ...styles.dashboardGrid, marginTop: "12px" }}>
        <MetricCard label="Generated Today" value={dashboard.generatedToday} />
        <MetricCard label="Total Picks" value={dashboard.total} />
        <MetricCard label="Pending" value={dashboard.pending} />
        <MetricCard label="Wins" value={dashboard.wins} />
        <MetricCard label="Losses" value={dashboard.losses} />
        <MetricCard label="Hit Rate" value={`${dashboard.winPercentage}%`} />
        <MetricCard label="Goblin Hit Rate" value={`${dashboard.goblinHitRate}%`} />
        <MetricCard label="Demon Hit Rate" value={`${dashboard.demonHitRate}%`} />
        <MetricCard label="Streak Starter Hit Rate" value={`${dashboard.streakStarterHitRate}%`} />
        <MetricCard label="4-Man Builder Hit Rate" value={`${dashboard.parlayBuilderHitRate}%`} />
      </div>

      <div style={styles.historyFilters}>
        <FilterSelect label="Date" value={historyFilter.date} options={["all", "today"]} onChange={(value) => setHistoryFilter((current) => ({ ...current, date: value }))} />
        <FilterSelect label="Sport" value={historyFilter.sport} options={filterOptions.sports} onChange={(value) => setHistoryFilter((current) => ({ ...current, sport: value }))} />
        <FilterSelect label="Category Source" value={historyFilter.categorySource} options={filterOptions.categories} onChange={(value) => setHistoryFilter((current) => ({ ...current, categorySource: value }))} />
        <FilterSelect label="Result" value={historyFilter.result} options={["all", "Pending", "Win", "Loss", "Push"]} onChange={(value) => setHistoryFilter((current) => ({ ...current, result: value }))} />
        <FilterSelect label="Platform" value={historyFilter.platform} options={filterOptions.platforms} onChange={(value) => setHistoryFilter((current) => ({ ...current, platform: value }))} />
      </div>

      <div style={styles.breakdownGrid}>
        <Breakdown title="Accuracy by sport" rows={dashboard.bySport} />
        <Breakdown title="Accuracy by prop type" rows={dashboard.byStatType} />
        <Breakdown title="Accuracy by platform" rows={dashboard.byPlatform} />
        <Breakdown title="Accuracy by category source" rows={dashboard.byCategorySource} />
        <Breakdown title="Accuracy by confidence range" rows={dashboard.byConfidenceRange} />
        <Breakdown title="Accuracy by risk level" rows={dashboard.byRiskLevel} />
      </div>

      {recent.length > 0 && (
        <div style={styles.historyList}>
          {recent.map((pick) => (
            <div key={pick.id} style={styles.historyRow}>
              <div>
                <strong>{pick.playerName || pick.player}</strong>
                <p style={styles.historyMeta}>
                  {pick.recommendationType || "Model Recommendation"} - {pick.platform || "Platform"} - {displaySport(pick)} - {pick.statType || pick.market} - {pick.pickDirection || pick.pick} {formatNumber(pick.line)}
                </p>
              </div>
              <div style={styles.resultButtons}>
                {["Win", "Loss", "Push", "Pending", "Manual"].map((result) => (
                  <button
                    key={result}
                    style={(pick.resultStatus || pick.finalResult) === result ? styles.resultButtonActive : styles.resultButton}
                    onClick={() => updatePickResult(pick.id, result)}
                  >
                    {result}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function ParlayHistoryPanel({ history, dashboard }) {
  const recent = history.slice(0, 8);
  return (
    <details style={styles.compactDetails}>
      <summary style={styles.detailsSummary}>
        <span>
          <span style={styles.eyebrow}>Parlay memory</span>
          <strong>4-Man Builder History</strong>
        </span>
        <span style={styles.countPill}>{dashboard.total} saved</span>
      </summary>
      <div style={{ ...styles.dashboardGrid, marginTop: "12px" }}>
        <MetricCard label="Total Parlays" value={dashboard.total} />
        <MetricCard label="Pending" value={dashboard.pending} />
        <MetricCard label="Wins" value={dashboard.wins} />
        <MetricCard label="Losses" value={dashboard.losses} />
        <MetricCard label="Avg Confidence" value={`${dashboard.averageConfidence}%`} />
      </div>
      {recent.length > 0 && (
        <div style={styles.historyList}>
          {recent.map((record) => (
            <div key={record.id} style={styles.historyRow}>
              <div>
                <strong>{record.parlayResult} - {record.averageConfidence}% avg confidence</strong>
                <p style={styles.historyMeta}>
                  {formatDateTime(record.generatedAt)} - {record.picks.map((pick) => `${pick.playerName} ${pick.side} ${formatNumber(pick.line)}`).join(" | ")}
                </p>
              </div>
              <p style={styles.countPill}>{record.correlationRisk}</p>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function MetricCard({ label, value }) {
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.dashboardValue}>{value}</strong>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label style={styles.selectLabel}>
      {label}
      <select style={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "All" : option === "today" ? "Today" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Breakdown({ title, rows }) {
  return (
    <div style={styles.breakdownCard}>
      <h3 style={styles.breakdownTitle}>{title}</h3>
      {rows.length === 0 ? (
        <p style={styles.breakdownEmpty}>No settled picks yet.</p>
      ) : (
        rows.map((row) => (
          <div key={row.key} style={styles.breakdownRow}>
            <span>{row.key}</span>
            <strong>
              {row.winPercentage}% ({row.wins}-{row.losses}-{row.pushes})
            </strong>
          </div>
        ))
      )}
    </div>
  );
}

function scoreDFSProp(prop, context) {
  const profile = context.stats.get(statLookupKey(prop));
  const injury = context.news.get(statLookupKey(prop));
  const lineComparison = context.lineComparisonMap.get(sharedLineKey(prop));
  const sportsbookComparison = context.sportsbookComparisonMap.get(sportsbookComparisonKey(prop));
  const lineMovement = context.lineMovementMap?.get(lineMovementKey(prop));
  const projectionResult = resolveProjection(prop, profile, lineComparison, sportsbookComparison);
  const projection = projectionResult.value;
  const line = Number(prop.line);
  const hasProjection = Number.isFinite(projection);
  const projectionEdge = hasProjection ? projection - line : 0;
  const bestPick = hasProjection && projectionEdge > 0 ? "More" : hasProjection && projectionEdge < 0 ? "Less" : "";
  const edge = bestPick ? Math.abs(projectionEdge) : 0;
  const absoluteEdge = Math.abs(edge);
  const lineValueBoost = lineComparison ? Math.min(10, Math.abs(lineComparison.difference) * 4) : 0;
  const sportsbookBoost = sportsbookValueBoost(prop, bestPick, sportsbookComparison);
  const recentHitRate = Number.isFinite(profile?.recentHitRate) ? profile.recentHitRate : null;
  const volatility = Number.isFinite(profile?.volatility) ? profile.volatility : null;
  const sampleSize = Number(profile?.sampleSize || 0);
  const profileIsFallback = Boolean(profile?.fallback);
  const dataQualityScore = dataQualityFromSignals({ profile, injury, lineComparison, sportsbookComparison, projection, projectionSource: projectionResult.source });
  const projectionScore = Number.isFinite(projection)
    ? Math.min(26, (absoluteEdge / Math.max(1, Math.abs(line))) * 70)
    : 0;
  const consistencyScore = recentHitRate == null ? 4 : clamp((recentHitRate - 0.45) * 38, 0, 13);
  const sampleScore = sampleSize >= 10 ? 7 : sampleSize >= 5 ? 4 : 0;
  const volatilityPenalty = volatility == null ? 4 : clamp(volatility * 1.8, 0, 12);
  const injuryPenalty = injury?.risk === "High" ? 18 : injury?.risk === "Medium" ? 8 : 0;
  const { score: confidenceScore } = computeConfidence({
    edge: absoluteEdge,
    line,
    projectionScore,
    consistencyScore,
    sampleScore,
    lineValueBoost,
    sportsbookBoost,
    dataQualityScore,
    volatilityPenalty,
    injuryPenalty,
    projectionSource: projectionResult.source,
    profileIsFallback,
    recentHitRate,
    sampleSize,
    multiplier: 1,
    profile,
  });
  const edgeRating = Math.round(clamp(projectionScore * 2.1 + lineValueBoost * 2.2 + sportsbookBoost * 2 + consistencyScore, 0, 100));
  const riskLevel = riskFromSignals({ confidenceScore, volatility, injury, projection, lineComparison, sportsbookComparison });
  const sportsbookDiscrepancy = sportsbookDiscrepancyForPick(prop, bestPick, sportsbookComparison);
  const sportsbookImpliedProbability = sportsbookImpliedForPick(bestPick, sportsbookComparison);
  const sportsbookAveragePrice = sportsbookPriceForPick(bestPick, sportsbookComparison);
  const modelProbability = estimateModelProbability({ edge, line, confidenceScore, dataQualityScore, volatility });
  const qualityBadge = dataQualityBadge({
    projection,
    projectionSource: projectionResult.source,
    fallbackProfile: profileIsFallback,
    sampleSize,
    dataQualityScore,
    recentHitRate,
    last5HitRate: profile?.last5HitRate,
    last10HitRate: profile?.last10HitRate,
  });
  const impliedProbability = Number.isFinite(sportsbookImpliedProbability) ? sportsbookImpliedProbability : 0.5;
  const probabilityEdge = Number.isFinite(modelProbability) ? round(modelProbability - impliedProbability) : null;
  const expectedValue = expectedValueFromProbability(modelProbability, sportsbookAveragePrice);
  const movement = lineMovementForPick(lineMovement, bestPick);
  const sharpMoneyIndicator = sharpMoneyForProp({ sportsbookDiscrepancy, sportsbookComparison, movement, bestPick });
  const matchupRating = matchupRatingFromSignals({ profile, injury, sportsbookDiscrepancy, lineComparison });
  const usageAdjustment = usageAdjustmentFromSignals({ prop, profile });
  const valueTags = valueTagsForProp({
    prop,
    confidenceScore,
    sportsbookDiscrepancy,
    lineComparison,
    movement,
    sharpMoneyIndicator,
    expectedValue,
    recentHitRate,
  });
  const marketAgreementLabel = sportsbookBoost > 0 ? "Sportsbook value" : sportsbookBoost < 0 ? "Market disagreement" : sportsbookComparison ? "No sportsbook edge" : "No sportsbook comp";
  const reasoningSummary = buildReason({
    prop,
    projection,
    bestPick,
    lineComparison,
    sportsbookComparison,
    sportsbookDiscrepancy,
    profile,
    injury,
    confidenceScore,
    edge,
    projectionSource: projectionResult.source,
    modelProbability,
    impliedProbability,
    expectedValue,
    sharpMoneyIndicator,
    movement,
    matchupRating,
    usageAdjustment,
  });

  return {
    ...prop,
    id: makePropId(prop),
    playerImage: prop.playerImage || profile?.playerImage || profile?.headshot || profile?.imageUrl || "",
    headshot: prop.headshot || profile?.headshot || profile?.playerImage || "",
    imageUrl: prop.imageUrl || profile?.imageUrl || profile?.playerImage || "",
    projection,
    projectionSource: projectionResult.source,
    statProfileSource: profile?.source || "",
    fallbackProfile: profileIsFallback,
    confidenceScore,
    edgeRating,
    edge: round(edge),
    dataQualityScore: Math.round(dataQualityScore),
    riskLevel,
    bestPick,
    lineComparison,
    sportsbookComparison,
    sportsbookDiscrepancy,
    marketAgreementLabel,
    modelSide: bestPick,
    projectionEdge: Number.isFinite(projectionEdge) ? round(projectionEdge) : 0,
    recentHitRate,
    volatility,
    sampleSize,
    last5HitRate: Number.isFinite(profile?.last5HitRate) ? profile.last5HitRate : null,
    last10HitRate: Number.isFinite(profile?.last10HitRate) ? profile.last10HitRate : null,
    last5Average: Number.isFinite(profile?.last5Average) ? profile.last5Average : null,
    last10Average: Number.isFinite(profile?.last10Average) ? profile.last10Average : null,
    seasonAverage: Number.isFinite(profile?.seasonAverage) ? profile.seasonAverage : null,
    injuryRisk: injury?.risk || "Low",
    modelProbability,
    impliedProbability,
    probabilityEdge,
    expectedValue,
    sportsbookAveragePrice,
    lineMovement: movement,
    sharpMoneyIndicator,
    matchupRating,
    usageAdjustment,
    valueTags,
    status: "upcoming",
    generatedAt: new Date().toISOString(),
    reasoningSummary,
    dataQualityBadge: qualityBadge,
    dataSources: dataSourcesUsed({
      ...prop,
      lineComparison,
      sportsbookComparison,
      statProfileSource: profile?.source || "",
      injuryRisk: injury?.risk,
      lineMovement: movement,
    }),
    payoutLabel: propPayoutLabel(prop),
  };
}

function resolveProjection(prop, profile, lineComparison, sportsbookComparison) {
  if (prop.projection != null && prop.projection !== "") {
    const direct = Number(prop.projection);
    if (Number.isFinite(direct) && direct >= 0) return { value: round(direct), source: "model" };
  }
  if (profile?.projection != null && profile.projection !== "") {
    const profiled = Number(profile.projection);
    if (Number.isFinite(profiled) && profiled >= 0) return { value: round(profiled), source: profile.projectionSource || "player-stats" };
  }

  return { value: null, source: "missing" };
}

function buildReason({
  prop,
  projection,
  bestPick,
  lineComparison,
  sportsbookComparison,
  sportsbookDiscrepancy,
  profile,
  injury,
  confidenceScore,
  edge,
  projectionSource,
  modelProbability,
  impliedProbability,
  expectedValue,
  sharpMoneyIndicator,
  movement,
  matchupRating,
  usageAdjustment,
}) {
  const parts = [];
  if (!bestPick) {
    parts.push(`${NO_EDGE_MESSAGE} ${projectionSource === "missing" ? NEEDS_STATS_MESSAGE : ""}`.trim());
  } else if (Number.isFinite(projection)) {
    const projectionLabel =
      projectionSource === "player-stats"
        ? "player-stat projection"
        : projectionSource === "fallback-player-stats"
          ? "fallback stat projection"
          : "model projection";
    parts.push(`${bestPick} ${formatNumber(prop.line)} because the ${projectionLabel} is ${formatNumber(projection)} with a ${formatSignedNumber(edge)} edge.`);
  } else {
    parts.push(`${NO_EDGE_MESSAGE} ${NEEDS_STATS_MESSAGE}`);
  }

  if (lineComparison) {
    parts.push(
      `PrizePicks ${formatMaybeLine(lineComparison.prizePicksLine)} vs Underdog ${formatMaybeLine(lineComparison.underdogLine)} creates a ${formatNumber(lineComparison.difference)} line gap.`
    );
  }

  if (Number.isFinite(profile?.recentHitRate)) {
    parts.push(`Recent stability signal is ${Math.round(profile.recentHitRate * 100)}%.`);
  }

  if (Number.isFinite(profile?.last5HitRate) || Number.isFinite(profile?.last10HitRate)) {
    parts.push(`Hit rates: L5 ${formatPercent(profile?.last5HitRate)} / L10 ${formatPercent(profile?.last10HitRate)}.`);
  }

  if (sportsbookComparison) {
    parts.push(`Sportsbook market average is ${formatNumber(sportsbookComparison.marketAverageLine)}, creating a ${formatSignedNumber(sportsbookDiscrepancy)} DFS discrepancy.`);
  }

  if (Number.isFinite(modelProbability) && Number.isFinite(impliedProbability)) {
    parts.push(`Model probability ${formatPercent(modelProbability)} vs implied ${formatPercent(impliedProbability)} with EV ${formatSignedPercent(expectedValue)}.`);
  }

  if (sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal") {
    parts.push(`Sharp money: ${sharpMoneyIndicator}.`);
  }

  if (movement?.label) {
    parts.push(`Line movement: ${movement.label}.`);
  }

  if (matchupRating) {
    parts.push(`Matchup rating: ${matchupRating}.`);
  }

  if (usageAdjustment) {
    parts.push(`Usage adjustment: ${usageAdjustment}.`);
  }

  if (injury?.risk && injury.risk !== "Low") {
    parts.push(`${injury.risk} injury/news concern lowers trust.`);
  }

  parts.push(`Confidence score is ${confidenceScore}/100.`);
  return parts.join(" ");
}

function buildSportsbookComparisonMap(comparisons = []) {
  const map = new Map();
  comparisons.forEach((comparison) => {
    if (!comparison?.playerName || !comparison?.statType) return;
    map.set(sportsbookComparisonKey(comparison), comparison);
  });
  return map;
}

function createDebugInfo(selectedSource = "all") {
  return {
    selectedSource,
    sources: {
      PrizePicks: emptySourceDebug("PrizePicks"),
      Underdog: emptySourceDebug("Underdog"),
      "The Odds API": emptySourceDebug("The Odds API"),
    },
    totals: {
      rawPropsLoaded: 0,
      activeProps: 0,
      propsAfterFilters: 0,
      recommendedProps: 0,
      watchlistProps: 0,
      streakProps: 0,
    },
  };
}

function emptySourceDebug(source) {
  return {
    source,
    status: "Pending",
    apiStatus: "Pending",
    apiUrl: "",
    endpointsTried: [],
    rawPropsLoaded: 0,
    propsAfterParsing: 0,
    propsAfterFilters: 0,
    visibleAfterCurrentFilters: null,
    message: "",
  };
}

function attachSourceFilterCounts(debugInfo, { rawProps, activeProps, normalProps }) {
  Object.keys(debugInfo.sources).forEach((source) => {
    if (source === "The Odds API") return;
    const platform = source;
    const rawCount = rawProps.filter((prop) => prop.platform === platform).length;
    const activeCount = activeProps.filter((prop) => prop.platform === platform).length;
    const filteredCount = normalProps.filter((prop) => prop.platform === platform).length;
    debugInfo.sources[source] = {
      ...debugInfo.sources[source],
      rawPropsLoaded: Math.max(Number(debugInfo.sources[source].rawPropsLoaded || 0), rawCount),
      propsAfterParsing: Math.max(Number(debugInfo.sources[source].propsAfterParsing || 0), rawCount),
      activeProps: activeCount,
      propsAfterFilters: filteredCount,
    };
  });
}

function attachScoredSourceCounts(debugInfo, { recommendedProps, watchlistProps, streakProps }) {
  Object.keys(debugInfo.sources).forEach((source) => {
    if (source === "The Odds API") return;
    const platform = source;
    const recommendedCount = recommendedProps.filter((prop) => prop.platform === platform).length;
    const watchlistCount = watchlistProps.filter((prop) => prop.platform === platform).length;
    const streakCount = streakProps.filter((prop) => prop.platform === platform).length;
    debugInfo.sources[source] = {
      ...debugInfo.sources[source],
      recommendedProps: recommendedCount,
      watchlistProps: watchlistCount,
      streakProps: streakCount,
      propsAfterFilters: recommendedCount + watchlistCount + streakCount,
    };
  });
}

function buildVisibleDebugPanel(debugInfo, { platform, props, watchlist, streakProps, filteredProps, filteredWatchlist, filteredStreakProps, streakSportBoards, history, lastUpdated, sourceStatus }) {
  const panel = debugInfo || createDebugInfo(platform);
  const next = {
    ...panel,
    selectedSource: platform,
    sources: { ...panel.sources },
  };
  Object.keys(DEFAULT_SOURCE_STATUS).forEach((source) => {
    const row = next.sources[source] || emptySourceDebug(source);
    const status = row.status && row.status !== "Pending" ? row.status : sourceStatus?.[source] || row.status || "Pending";
    next.sources[source] = {
      ...row,
      status,
      apiStatus: row.apiStatus && row.apiStatus !== "Pending" ? row.apiStatus : status,
      message:
        source === "Underdog" && status !== "Connected" && status !== "Pending"
          ? row.message || UNDERDOG_UNAVAILABLE_MESSAGE
          : row.message,
    };
  });
  Object.keys(next.sources).forEach((source) => {
    if (source === "The Odds API") return;
    const platformName = source;
    const allCount = [...props, ...watchlist, ...streakProps].filter((prop) => prop.platform === platformName).length;
    const visibleCount = [...filteredProps, ...filteredWatchlist, ...filteredStreakProps].filter(
      (prop) => prop.platform === platformName
    ).length;
    next.sources[source] = {
      ...next.sources[source],
      rawPropsLoaded: Number(next.sources[source].rawPropsLoaded || 0) || allCount,
      propsAfterParsing: Number(next.sources[source].propsAfterParsing || 0) || allCount,
      propsAfterFilters: Math.max(Number(next.sources[source].propsAfterFilters || 0), allCount),
      visibleAfterCurrentFilters: platform === "all" || normalize(platform) === normalize(source) ? visibleCount : 0,
    };
  });
  const generated = generatedStreakPicks(streakSportBoards);
  const sourceCounts = countBy(generated, (pick) => pick.platform || "Unknown");
  next.generatedBySport = STREAK_TAB_OPTIONS
    .map((option) => ({
      sport: option.label,
      count: generated.filter((pick) => (pick.streakTab || pick.streakSport) === option.value).length,
    }))
    .filter((row) => row.count > 0 || STREAK_TAB_OPTIONS.find((option) => option.label === row.sport)?.always);
  next.savedPicks = Array.isArray(history) ? history.length : 0;
  next.lastRefresh = lastUpdated || "";
  next.sourceMix = Object.entries(sourceCounts).map(([source, count]) => `${source}: ${count}`).join(" | ");
  return next;
}

function platformOptionsForStatus(sourceStatus = {}) {
  return PLATFORM_OPTIONS.map((option) => {
    if (option.id !== "underdog") return option;
    const status = sourceStatus.Underdog || "Pending";
    if (status === "Connected") return option;
    return {
      ...option,
      label: `Underdog (${status === "Pending" ? "Checking" : "Not Connected"})`,
      statusMessage: UNDERDOG_UNAVAILABLE_MESSAGE,
    };
  });
}

function sourceLabel(source) {
  if (source === "all") return "All Sources";
  if (source === "sportsbookEdge") return "Sportsbook Edge";
  if (source === "prizepicks") return "PrizePicks";
  if (source === "underdog") return "Underdog";
  return source;
}

function sportsbookSourceStatus(result = {}) {
  const warnings = result.warnings || [];
  if (
    warnings.some((warning) =>
      /missing api key|api limit reached|could not load sportsbook|sportsbook comparison unavailable/i.test(warning)
    )
  ) {
    return "Failed";
  }
  return "Connected";
}

function buildModelSignalMap(props = []) {
  const map = new Map();
  props.forEach((prop) => {
    const key = streakModelSignalKey(prop);
    const existing = map.get(key);
    if (!existing || modelSignalStrength(prop) > modelSignalStrength(existing)) {
      map.set(key, {
        confidenceScore: prop.confidenceScore,
        edge: prop.edge,
        edgeRating: prop.edgeRating,
        dataQualityScore: prop.dataQualityScore,
        projection: prop.projection,
        projectionSource: prop.projectionSource,
        modelSide: prop.modelSide || prop.bestPick,
        recentHitRate: prop.recentHitRate,
        last5HitRate: prop.last5HitRate,
        last10HitRate: prop.last10HitRate,
        volatility: prop.volatility,
        sampleSize: prop.sampleSize,
        injuryRisk: prop.injuryRisk,
        sportsbookDiscrepancy: prop.sportsbookDiscrepancy,
        sportsbookAveragePrice: prop.sportsbookAveragePrice,
        marketAgreementLabel: prop.marketAgreementLabel,
        modelProbability: prop.modelProbability,
        impliedProbability: prop.impliedProbability,
        probabilityEdge: prop.probabilityEdge,
        expectedValue: prop.expectedValue,
        lineMovement: prop.lineMovement,
        sharpMoneyIndicator: prop.sharpMoneyIndicator,
        matchupRating: prop.matchupRating,
        usageAdjustment: prop.usageAdjustment,
        statProfileSource: prop.statProfileSource,
        fallbackProfile: prop.fallbackProfile,
        valueTags: prop.valueTags,
        playerImage: prop.playerImage || prop.headshot || prop.imageUrl || "",
      });
    }
  });
  return map;
}

function modelSignalStrength(signal) {
  return Number(signal.dataQualityScore || 0) + Number(signal.confidenceScore || 0) * 0.35 + Number(signal.edgeRating || 0) * 0.2;
}

function buildLineComparisonMap(props) {
  const grouped = new Map();
  props.forEach((prop) => {
    const key = sharedLineKey(prop);
    const existing = grouped.get(key) || [];
    existing.push(prop);
    grouped.set(key, existing);
  });

  const comparisons = new Map();
  grouped.forEach((group, key) => {
    const prizePicks = group.find((prop) => prop.platform === "PrizePicks");
    const underdog = group.find((prop) => prop.platform === "Underdog");
    if (!prizePicks || !underdog) return;

    const prizePicksLine = Number(prizePicks.line);
    const underdogLine = Number(underdog.line);
    const marketAverageLine = (prizePicksLine + underdogLine) / 2;
    const difference = Math.abs(prizePicksLine - underdogLine);
    const lower = prizePicksLine <= underdogLine ? prizePicks : underdog;
    const higher = prizePicksLine > underdogLine ? prizePicks : underdog;

    comparisons.set(key, {
      prizePicksLine,
      underdogLine,
      marketAverageLine,
      difference,
      betterPlatform: difference === 0 ? "Even" : `${lower.platform} More / ${higher.platform} Less`,
      betterDirection: difference === 0 ? "More" : "More",
    });
  });

  return comparisons;
}

function isActiveUpcomingProp(prop) {
  const start = new Date(prop.startTime).getTime();
  const liveLabel = normalize(`${prop.league || ""} ${prop.status || ""}`);
  if (liveLabel.includes("live")) return false;
  return prop.status === "upcoming" && Number.isFinite(start) && start > Date.now() + MIN_START_BUFFER_MS;
}

function isSupportedAppSport(prop) {
  return SUPPORTED_SPORTS.has(prop.sport);
}

function isAllowedAppMarket(prop) {
  if (prop.sport !== "Soccer") return true;
  return ["shots", "shotsOnTarget", "goalsAllowed", "goalieSaves", "passesAttempted"].includes(
    canonicalStatType(prop.statType)
  );
}

function getBaseActiveFilterReason(prop) {
  if (!isSupportedAppSport(prop)) return `unsupported sport: ${prop.sport || "Unknown"}`;
  if (!isActiveUpcomingProp(prop)) return "stale, locked, expired, live, or already-started game time";
  return "";
}

function getPreScoringFilterReason(prop) {
  if (!isSupportedAppSport(prop)) return `unsupported sport: ${prop.sport || "Unknown"}`;
  if (!isAllowedAppMarket(prop)) return `unsupported market: ${prop.statType || "Unknown"}`;
  if (isMultiPlayerComboProp(prop)) return "combo props are not supported";
  if (isAdjustedOddsProp(prop)) return "adjusted odds prop handled by Streak Finder";
  if (!isActiveUpcomingProp(prop)) return "stale, locked, expired, live, or already-started game time";
  return "";
}

function matchesStatTypeFilter(prop, statType) {
  return statType === "all" || normalize(prop.statType) === normalize(statType);
}

function matchesUiFilters(prop, filters) {
  return (
    matchesPlatformFilter(prop, filters.platform) &&
    matchesSportFilter(prop, filters.sport) &&
    matchesStatTypeFilter(prop, filters.statType) &&
    matchesEdgeFilter(prop, filters.edgeFilter)
  );
}

function matchesPlatformFilter(prop, platform) {
  if (platform === "both" || platform === "all") return true;
  if (platform === "sportsbookEdge") return hasSportsbookEdge(prop);
  return normalize(prop.platform) === normalize(platform);
}

function matchesSportFilter(prop, sport) {
  if (sport === "all") return true;
  if (sport === "Tennis") return isTennisSport(prop.sport);
  if (sport === "WNBA") return displaySport(prop) === "WNBA";
  if (sport === "NBA") return displaySport(prop) === "NBA";
  return prop.sport === sport;
}

function hasSportsbookEdge(prop) {
  const direct = Number(prop.sportsbookDiscrepancy);
  const signal = Number(prop.modelSignal?.sportsbookDiscrepancy);
  return (Number.isFinite(direct) && direct > 0) || (Number.isFinite(signal) && signal > 0);
}

function matchesEdgeFilter(prop, edgeFilter) {
  if (!edgeFilter || edgeFilter === "all") return true;
  const confidence = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  const expectedValue = Number(prop.expectedValue || prop.modelSignal?.expectedValue);
  const multiplier = Number(prop.multiplier);
  const start = new Date(prop.startTime).getTime();
  const hoursUntilStart = Number.isFinite(start) ? (start - Date.now()) / (60 * 60 * 1000) : 0;
  if (edgeFilter === "highConfidence") return confidence >= 68;
  if (edgeFilter === "valuePlays") return hasSportsbookEdge(prop) || (Number.isFinite(expectedValue) && expectedValue > 0.02) || Number(prop.edge || prop.modelSignal?.edge || 0) >= 1;
  if (edgeFilter === "earlyLines") return hoursUntilStart >= 2;
  if (edgeFilter === "streakSafe") return confidence >= 65 && !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) && (!Number.isFinite(multiplier) || multiplier <= 1);
  return true;
}

function isMultiPlayerComboProp(prop) {
  const statText = String(prop.statType || "").toLowerCase();
  const playerText = String(prop.playerName || "");
  return statText.includes("(combo)") || statText.includes(" combo") || playerText.includes(" + ");
}

function isAdjustedOddsProp(prop) {
  const oddsType = normalize(prop.oddsType || prop.odds_type);
  return Boolean(prop.isAdjustedOdds) || (oddsType && oddsType !== "standard");
}

function isVerifiedAdjustedOddsProp(prop) {
  const descriptor = [
    prop.adjustedOddsType,
    prop.oddsType,
    prop.odds_type,
    prop.multiplierSource,
    prop.optionLabel,
  ]
    .map(normalize)
    .join(" ");
  return Boolean(prop.verifiedAdjustedOdds) || /demon|goblin|green goblin|higher payout|lower payout|verified adjusted/.test(descriptor);
}

function isGoblinProp(prop) {
  return propPayoutLabel(prop) === "Goblin";
}

function isDemonProp(prop) {
  return propPayoutLabel(prop) === "Demon";
}

function adjustedDescriptor(prop) {
  return [
    prop.adjustedOddsType,
    prop.oddsType,
    prop.odds_type,
    prop.multiplierSource,
    prop.optionLabel,
  ]
    .map(normalize)
    .join(" ");
}

function applyRecommendationStatus(prop) {
  if (isRecommendedPick(prop)) {
    return {
      ...prop,
      recommendationStatus: "recommended",
      watchlistMessage: "",
    };
  }

  const watchlistMessage = watchlistMessageForProp(prop);
  return {
    ...prop,
    bestPick: "",
    recommendationStatus: "watchlist",
    watchlistMessage,
    reasoningSummary: watchlistReasonSummary(prop, watchlistMessage),
  };
}

function isRecommendedPick(prop) {
  return (
    prop.projectionSource !== "missing" &&
    Number.isFinite(prop.projection) &&
    Number.isFinite(prop.edge) &&
    prop.edge >= MIN_RECOMMENDED_EDGE &&
    prop.confidenceScore >= MIN_RECOMMENDED_CONFIDENCE &&
    Boolean(prop.bestPick) &&
    isActiveUpcomingProp(prop)
  );
}

function watchlistMessageForProp(prop) {
  if (prop.projectionSource === "missing" || !Number.isFinite(prop.projection)) {
    return `${NO_EDGE_MESSAGE} ${NEEDS_STATS_MESSAGE}`;
  }

  if (!prop.bestPick || prop.edge === 0) {
    return NO_EDGE_MESSAGE;
  }

  if (prop.edge < MIN_RECOMMENDED_EDGE) {
    return `${NO_EDGE_MESSAGE} Edge is below ${formatNumber(MIN_RECOMMENDED_EDGE)}.`;
  }

  if (prop.confidenceScore < MIN_RECOMMENDED_CONFIDENCE) {
    return `${NO_EDGE_MESSAGE} Confidence is below ${MIN_RECOMMENDED_CONFIDENCE}/100.`;
  }

  return NO_EDGE_MESSAGE;
}

function watchlistReasonSummary(prop, message) {
  const details = [];
  if (prop.projectionSource === "missing" || !Number.isFinite(prop.projection)) {
    details.push(NEEDS_STATS_MESSAGE);
  } else {
    details.push(
      `Model projection is ${formatNumber(prop.projection)} against a ${formatNumber(prop.line)} line with only ${formatSignedNumber(prop.edge)} of edge.`
    );
  }
  details.push(message);
  details.push(`Confidence score is ${prop.confidenceScore}/100.`);
  return unique(details).join(" ");
}

function sortRecommendedProps(a, b) {
  return (
    computeRankScore(b) - computeRankScore(a) ||
    b.confidenceScore - a.confidenceScore ||
    Number(b.expectedValue || 0) - Number(a.expectedValue || 0) ||
    b.edge - a.edge ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function sortWatchlistProps(a, b) {
  return (
    b.confidenceScore - a.confidenceScore ||
    b.edge - a.edge ||
    b.dataQualityScore - a.dataQualityScore ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function buildStreakFinderProps(props, modelSignalMap = new Map(), lineMovementMap = new Map()) {
  const rawCandidates = props.filter((prop) => !isMultiPlayerComboProp(prop)).flatMap((prop) => {
    const options = Array.isArray(prop.streakOptions) && prop.streakOptions.length ? prop.streakOptions : defaultStreakOptions(prop);
    const modelSignal = modelSignalMap.get(streakModelSignalKey(prop)) || null;
    const rawMovement = lineMovementMap.get(lineMovementKey(prop)) || null;
    return options
      .filter((option) => Number.isFinite(Number(option.multiplier)) && Number(option.multiplier) > 0)
      .filter((option) => !option.status || normalize(option.status) === "active" || normalize(option.status) === "upcoming")
      .map((option) => {
        const side = normalizeStreakSide(option.side);
        return {
          ...prop,
          id: `${makePropId(prop)}-${normalize(side)}-${normalize(option.optionId || option.multiplier)}`,
          side,
          multiplier: round(Number(option.multiplier)),
          rawProbability: Number(option.rawProbability),
          multiplierSource: option.multiplierSource || prop.multiplierSource || "",
          adjustedOddsType: option.adjustedOddsType || prop.adjustedOddsType || prop.oddsType || prop.odds_type || "",
          verifiedAdjustedOdds: Boolean(option.verifiedAdjustedOdds || prop.verifiedAdjustedOdds),
          optionLabel: option.label || "",
          modelSignal,
          rawLineMovement: rawMovement,
          playerImage: prop.playerImage || modelSignal?.playerImage || "",
          recommendationStatus: "streak",
        };
      });
  });

  return strongestSideOnly(rawCandidates);
}

function defaultStreakOptions(prop) {
  return ["Higher", "Lower"].map((side) => ({
    side,
    multiplier: 1,
    rawProbability: null,
    status: prop.status || "upcoming",
    optionId: side,
    label: `${side} ${formatNumber(prop.line)}`,
    multiplierSource: `${prop.platform} standard line`,
    adjustedOddsType: "standard",
    verifiedAdjustedOdds: false,
  }));
}

function buildStreakSportCategoryBoards(props, history) {
  const enriched = strongestSideOnly(props)
    .map((prop) => enrichStreakCandidate(prop, history))
    .sort((a, b) => streakLifeScore(b, "safest", history) - streakLifeScore(a, "safest", history));
  const { mainCandidates, ladderPlays } = splitLadderCandidates(enriched);
  const boards = Object.fromEntries(STREAK_TAB_OPTIONS.map((option) => [option.value, emptyStreakSportBoard(option.value)]));

  STREAK_TAB_OPTIONS.forEach((tabOption) => {
    const tabCandidates = streakTabCandidates(tabOption, mainCandidates, ladderPlays);
    const tabLadders =
      tabOption.type === "demon"
        ? ladderPlays.filter(isDemonProp)
        : tabOption.type === "goblin"
          ? ladderPlays.filter(isGoblinProp)
        : ladderPlays.filter((prop) => streakSportKey(prop) === tabOption.value);
    const sorted = [...tabCandidates].sort((a, b) => streakLifeScore(b, tabOption.value, history) - streakLifeScore(a, tabOption.value, history));
    const picks = selectTopStreakPicks(sorted, tabOption, history);

    boards[tabOption.value] = {
      sport: tabOption.value,
      label: tabOption.label,
      picks,
      categories: { top: picks },
      ladders: tabLadders,
      generatedCount: picks.length,
      candidateCount: tabCandidates.length,
      verifiedOnly: tabOption.type === "adjusted",
    };
  });

  return boards;
}

function emptyStreakSportBoard(sport) {
  const tab = STREAK_TAB_OPTIONS.find((option) => option.value === sport);
  return {
    sport,
    label: tab?.label || sport,
    picks: [],
    categories: { top: [] },
    ladders: [],
    generatedCount: 0,
    candidateCount: 0,
  };
}

function visibleStreakSportOptions(boards) {
  return STREAK_TAB_OPTIONS.filter((option) => option.always || (boards?.[option.value]?.candidateCount || 0) > 0);
}

function streakTabCandidates(tabOption, mainCandidates, ladderPlays) {
  if (tabOption.type === "goblin") {
    return mainCandidates.filter(isGoblinCandidate);
  }
  if (tabOption.type === "demon") {
    return [...mainCandidates, ...ladderPlays].filter(isDemonCandidate);
  }
  return mainCandidates
    .filter((prop) => streakSportKey(prop) === tabOption.value)
    .filter(meetsStandardStreakRules);
}

function meetsStandardStreakRules(prop) {
  return (
    Number(prop.confidenceScore) >= MIN_STREAK_CONFIDENCE &&
    hasPositiveStreakEdge(prop, 0) &&
    hasEnoughStreakData(prop) &&
    !isStaleOrStarted(prop) &&
    !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel)
  );
}

function isGoblinCandidate(prop) {
  return (
    isGoblinProp(prop) &&
    Number(prop.confidenceScore) >= MIN_GOBLIN_CONFIDENCE &&
    hasPositiveStreakEdge(prop, 0) &&
    hasEnoughStreakData(prop) &&
    !isStaleOrStarted(prop) &&
    !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) &&
    Number(prop.multiplier) <= 1
  );
}

function isDemonCandidate(prop) {
  return (
    isDemonProp(prop) &&
    Number(prop.confidenceScore) >= MIN_DEMON_CONFIDENCE &&
    hasPositiveStreakEdge(prop, 0.25) &&
    hasEnoughStreakData(prop) &&
    !isStaleOrStarted(prop) &&
    prop.riskLevel !== "Low Data Confidence"
  );
}

function hasEnoughStreakData(prop) {
  const signal = prop.modelSignal || {};
  const dataQuality = Number(prop.dataQualityScore || signal.dataQualityScore);
  const sampleSize = Number(prop.sampleSize || signal.sampleSize || 0);
  const projection = Number(prop.projection ?? signal.projection);
  const probability = Number(prop.modelProbability || signal.modelProbability);
  return (
    Number.isFinite(Number(signal.confidenceScore)) &&
    Number.isFinite(projection) &&
    Number.isFinite(probability) &&
    (sampleSize >= 3 || dataQuality >= 55)
  );
}

function hasPositiveStreakEdge(prop, minEdge = 0) {
  const edge = streakStatEdge(prop);
  const probabilityEdge = Number(prop.probabilityEdge || prop.modelSignal?.probabilityEdge);
  const expectedValue = Number(prop.expectedValue || prop.modelSignal?.expectedValue);
  return (
    (Number.isFinite(edge) && edge > minEdge) ||
    (Number.isFinite(probabilityEdge) && probabilityEdge > 0.01 && Number.isFinite(expectedValue) && expectedValue > 0)
  );
}

function streakStatEdge(prop) {
  const projection = Number(prop.projection ?? prop.modelSignal?.projection);
  return statEdgeForSide(projection, prop.line, prop.side || prop.bestPick || prop.modelSignal?.modelSide);
}

function statEdgeForSide(projection, line, side) {
  const projected = Number(projection);
  const propLine = Number(line);
  if (!Number.isFinite(projected) || !Number.isFinite(propLine)) return null;
  const normalizedSide = normalizeStreakSide(side);
  return normalizedSide === "Lower" ? round(propLine - projected) : round(projected - propLine);
}

function edgePercentFromValues(edge, line) {
  const numericEdge = Number(edge);
  const numericLine = Number(line);
  if (!Number.isFinite(numericEdge) || !Number.isFinite(numericLine) || numericLine === 0) return null;
  return round(numericEdge / Math.abs(numericLine));
}

function edgePercentForProp(prop) {
  return prop.edgePercentage ?? edgePercentFromValues(streakStatEdge(prop) ?? prop.edge, prop.line);
}

function isStaleOrStarted(prop) {
  const start = new Date(prop.startTime).getTime();
  if (Number.isFinite(start) && start <= Date.now()) return true;
  const movement = prop.lineMovement || prop.modelSignal?.lineMovement;
  const lastSeen = new Date(movement?.lastSeenAt || prop.generatedAt || Date.now()).getTime();
  return Number.isFinite(lastSeen) && Date.now() - lastSeen > DFS_CACHE_TTL_MS * 2;
}

function buildQuickParlayPicks(boards, riskMode = "balanced") {
  const allowedTabs = new Set(["MLB", "WNBA", "NBA", "Soccer", "goblins"]);
  if (riskMode === "aggressive") allowedTabs.add("demons");

  const candidates = uniqueByGeneratedPick(
    Object.values(boards || {})
      .filter((board) => allowedTabs.has(board.sport))
      .flatMap((board) => board.picks || [])
      .filter((prop) => parlayQualified(prop, riskMode))
      .sort((a, b) => parlayScore(b) - parlayScore(a))
  );

  const selected = [];
  const playerKeys = new Set();
  const statKeys = new Set();
  const gameCounts = new Map();

  for (const candidate of candidates) {
    if (selected.length >= 4) break;
    const playerKey = playerCorrelationKey(candidate);
    const statKey = playerStatCorrelationKey(candidate);
    const gameKey = gameCorrelationKey(candidate);
    if (playerKeys.has(playerKey) || statKeys.has(statKey)) continue;
    if (gameKey && Number(gameCounts.get(gameKey) || 0) >= 1) continue;

    selected.push({
      ...candidate,
      categorySource: "parlayBuilder",
      recommendationType: "Quick 4-Man Builder",
      topTwoReason: `${candidate.playerName} is included for confidence, positive edge, low correlation, and ${candidate.riskLevel || "medium"} risk profile.`,
    });
    playerKeys.add(playerKey);
    statKeys.add(statKey);
    if (gameKey) gameCounts.set(gameKey, Number(gameCounts.get(gameKey) || 0) + 1);
  }

  return selected.length === 4 ? selected : [];
}

function parlayQualified(prop, riskMode) {
  if (!hasEnoughStreakData(prop) || !hasPositiveStreakEdge(prop, 0) || isStaleOrStarted(prop)) return false;
  if (prop.riskLevel === "Low Data Confidence") return false;
  if (isDemonProp(prop) && riskMode !== "aggressive") return false;
  if (isDemonProp(prop)) return Number(prop.confidenceScore) >= MIN_DEMON_CONFIDENCE;
  return Number(prop.confidenceScore) >= MIN_STREAK_CONFIDENCE && prop.riskLevel !== "Risky";
}

function parlayScore(prop) {
  return (
    Number(prop.confidenceScore || 0) +
    Math.max(0, Number(streakStatEdge(prop) || 0)) * 6 +
    Number(prop.dataQualityScore || 0) * 0.12 +
    Number(prop.expectedValue || 0) * 16 -
    Number(prop.volatility || prop.modelSignal?.volatility || 0) * 3 -
    (isDemonProp(prop) ? 12 : 0)
  );
}

function uniqueByGeneratedPick(props) {
  const seen = new Set();
  return props.filter((prop) => {
    const key = generatedPickIdentity(prop);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parlayIncludeReason(prop) {
  return `${prop.confidenceScore}% confidence, ${formatSignedNumber(streakStatEdge(prop))} edge, ${prop.riskLevel || "Medium"} risk`;
}

function parlayLegWarning(prop) {
  if (isDemonProp(prop)) return "Aggressive demon leg.";
  if (isGoblinProp(prop)) return "Low payout does not guarantee hit.";
  return "";
}

function parlayCorrelationRisk(picks) {
  if (!Array.isArray(picks) || picks.length < 4) return "Not enough legs";
  const games = picks.map(gameCorrelationKey).filter(Boolean);
  const repeatedGames = games.length - new Set(games).size;
  if (repeatedGames > 0) return "Medium correlation risk";
  return "Low correlation risk";
}

function selectTopStreakPicks(candidates, category, history) {
  const limit = category.type === "goblin" || category.type === "demon" ? 6 : 2;
  const primary = selectUncorrelatedPicks(candidates, limit, [], { avoidSameGame: category.type === "sport" });
  const selected = primary.length >= limit ? primary : selectUncorrelatedPicks(candidates, limit, [], { avoidSameGame: false });
  return selected.slice(0, limit).map((prop, index) => annotateTopTwoPick(prop, category.value, category, index, history, false));
}

function annotateTopTwoPick(prop, sport, category, index, history, fallbackUsed = false) {
  const categoryLabel = category.label;
  const reason = topTwoReason(prop, categoryLabel, index, history, fallbackUsed);
  return {
    ...prop,
    streakTab: sport,
    streakSport: category.type === "sport" ? sport : streakSportKey(prop),
    streakCategory: category.value,
    streakCategoryLabel: categoryLabel,
    recommendationType: `Streak Finder - ${categoryLabel}`,
    topTwoReason: reason,
    categoryFallback: fallbackUsed,
    notes: reason,
  };
}

function topTwoReason(prop, categoryLabel, index, history, fallbackUsed = false) {
  const categoryKey = normalize(categoryLabel);
  const categoryPurpose = categoryKey.includes("goblin")
    ? "safe streak profile, verified lower-payout pricing, positive projection edge, and low volatility"
    : categoryKey.includes("demon")
      ? "aggressive payout profile, verified demon pricing, and a larger projection edge"
      : "probability, confidence, positive edge, and data quality";
  const pieces = [
    `Top ${index + 1} ${categoryLabel.toLowerCase()} because it grades highest on ${categoryPurpose}.`,
    isVerifiedAdjustedOddsProp(prop) ? `${prop.multiplierSource || "Adjusted payout label"} is verified from the source feed.` : "",
    fallbackUsed ? `This sport did not have two perfect ${categoryLabel.toLowerCase()} matches, so the app used the two safest available candidates and kept warning flags visible.` : "",
    `Confidence ${prop.confidenceScore}% with model probability ${formatPercent(prop.modelProbability)} and EV ${formatSignedPercent(prop.expectedValue)}.`,
    keyStatsSummary(prop),
  ];
  const flags = warningFlags(prop);
  if (flags.length) pieces.push(`Warning flags: ${flags.join(", ")}.`);
  const historySignal = historicalDimensionAdjustment(prop, history);
  if (historySignal.note) pieces.push(historySignal.note);
  return pieces.filter(Boolean).join(" ");
}

function streakLifeScore(prop, categoryId, history) {
  const probability = Number(prop.modelProbability);
  const confidence = Number(prop.confidenceScore || 0);
  const recentHitRate = Number(prop.recentHitRate || prop.modelSignal?.recentHitRate);
  const dataQuality = Number(prop.dataQualityScore || 0);
  const volatility = Number(prop.volatility || prop.modelSignal?.volatility);
  const expectedValue = Number(prop.expectedValue);
  const sportsbookEdge = Number(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy);
  const multiplier = Number(prop.multiplier);
  const projectionEdge = Number(streakStatEdge(prop));
  const matchupBonus = /favorable|soft|plus/i.test(String(prop.matchupRating || prop.modelSignal?.matchupRating || "")) ? 7 : 0;
  const stalePenalty = isStaleOrStarted(prop) ? 100 : 0;
  const historyAdjustment = historicalDimensionAdjustment(prop, history).adjustment;
  const riskPenalty = prop.riskLevel === "Elite" ? 0 : prop.riskLevel === "Medium" ? 5 : prop.riskLevel === "Risky" ? 18 : 24;
  const multiplierBoost = Number.isFinite(multiplier) && multiplier < 1 ? 8 : Number.isFinite(multiplier) && multiplier > 1 ? -8 : 0;
  const categoryBoost =
    categoryId === "goblins" && isGoblinProp(prop)
      ? 14
      : categoryId === "demons" && isDemonProp(prop)
        ? 10 + Math.max(0, streakStatEdge(prop)) * 4
        : 0;

  return (
    (Number.isFinite(probability) ? probability * 100 : 50) * 1.25 +
    confidence * 1.05 +
    (Number.isFinite(recentHitRate) ? recentHitRate * 22 : 0) +
    dataQuality * 0.28 +
    (Number.isFinite(expectedValue) ? expectedValue * 28 : 0) +
    (Number.isFinite(projectionEdge) ? Math.max(0, projectionEdge) * 7 : 0) +
    (Number.isFinite(sportsbookEdge) ? sportsbookEdge * 5 : 0) +
    matchupBonus +
    multiplierBoost +
    categoryBoost +
    historyAdjustment -
    (Number.isFinite(volatility) ? volatility * 2.2 : 4) -
    warningFlags(prop).length * 5 -
    riskPenalty -
    stalePenalty
  );
}

function streakSportKey(prop) {
  const sport = displaySport(prop);
  if (isTennisSport(prop.sport) || sport === "Tennis") return "Tennis";
  return sport;
}

function hoursUntil(startTime) {
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(start)) return 0;
  return (start - Date.now()) / (60 * 60 * 1000);
}

function buildStreakRecommendationBoard(props, history) {
  const enriched = strongestSideOnly(props)
    .map((prop) => enrichStreakCandidate(prop, history))
    .sort(sortStreakRecommendations);
  const { mainCandidates, ladderPlays } = splitLadderCandidates(enriched);
  const playable = mainCandidates.filter((prop) => !["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) && prop.confidenceScore >= 60);
  const starter = selectUncorrelatedPicks(playable, 2, [], { avoidSameGame: true });
  const next = selectUncorrelatedPicks(playable, 1, starter, { avoidSameGame: false });
  const usedPrimary = [...starter, ...next];
  const backups = selectUncorrelatedPicks(playable, BACKUP_STREAK_LIMIT, usedPrimary, { avoidSameGame: false });
  const selected = [...usedPrimary, ...backups];
  const correlatedAvoid = playable
    .filter((prop) => !selected.some((selectedProp) => selectedProp.id === prop.id) && isCorrelatedWithAny(prop, selected))
    .map((prop) => markAvoidReason(prop, "duplicate/correlated conflict"));
  const avoid = uniqueById([
    ...mainCandidates
    .filter((prop) => ["Risky", "High Risk", "Low Data Confidence"].includes(prop.riskLevel) || prop.confidenceScore < 60)
      .map((prop) => markAvoidReason(prop, avoidReasonForProp(prop))),
    ...correlatedAvoid,
  ])
    .sort(sortAvoidRecommendations)
    .slice(0, AVOID_STREAK_LIMIT);
  const ladders = ladderPlays.sort(sortLadderRecommendations).slice(0, LADDER_STREAK_LIMIT);

  return { starter, next, backups, ladders, avoid };
}

function splitLadderCandidates(props) {
  const grouped = new Map();
  props.forEach((prop) => {
    const key = ladderGroupKey(prop);
    const group = grouped.get(key) || [];
    group.push(prop);
    grouped.set(key, group);
  });

  const mainCandidates = [];
  const ladderPlays = [];
  grouped.forEach((group) => {
    const sorted = [...group].sort(sortLadderSafety);
    const safest = sorted[0];
    mainCandidates.push(safest);
    sorted.slice(1).forEach((prop) => {
      ladderPlays.push(markLadderPlay(prop, safest));
    });
  });

  return { mainCandidates, ladderPlays };
}

function sortLadderSafety(a, b) {
  const side = normalizeStreakSide(a.side);
  const lineA = Number(a.line);
  const lineB = Number(b.line);
  const saferLineOrder = side === "Lower" ? lineB - lineA : lineA - lineB;
  return saferLineOrder || b.confidenceScore - a.confidenceScore || Number(a.multiplier) - Number(b.multiplier);
}

function markLadderPlay(prop, safest) {
  const saferText = `${safest.side} ${formatNumber(safest.line)}`;
  const whyNotElite = unique([...(prop.whyNotElite || []), `aggressive ladder line; safer version is ${saferText}`]);
  return {
    ...prop,
    riskLevel: prop.riskLevel === "Low Data Confidence" ? "Low Data Confidence" : "Risky",
    confidenceScore: Math.max(35, Math.round(prop.confidenceScore * 0.9)),
    whyNotElite,
    ladderBaseLine: safest.line,
    reasoningSummary: `${prop.reasoningSummary} This is a correlated ladder with a safer ${saferText} version, so it is separated from main streak picks.`,
  };
}

function selectUncorrelatedPicks(candidates, limit, used = [], options = {}) {
  const selected = [];
  const usedPlayerKeys = new Set(used.map(playerCorrelationKey));
  const usedStatKeys = new Set(used.map(playerStatCorrelationKey));
  const usedGameKeys = new Set(used.map(gameCorrelationKey).filter(Boolean));

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const playerKey = playerCorrelationKey(candidate);
    const statKey = playerStatCorrelationKey(candidate);
    const gameKey = gameCorrelationKey(candidate);
    if (usedPlayerKeys.has(playerKey) || usedStatKeys.has(statKey)) continue;
    if (options.avoidSameGame && gameKey && usedGameKeys.has(gameKey)) continue;

    selected.push(candidate);
    usedPlayerKeys.add(playerKey);
    usedStatKeys.add(statKey);
    if (gameKey) usedGameKeys.add(gameKey);
  }

  return selected;
}

function isCorrelatedWithAny(prop, selected) {
  return selected.some(
    (selectedProp) =>
      playerStatCorrelationKey(prop) === playerStatCorrelationKey(selectedProp) ||
      playerCorrelationKey(prop) === playerCorrelationKey(selectedProp)
  );
}

function markAvoidReason(prop, reason) {
  const whyNotElite = unique([...(prop.whyNotElite || []), reason]);
  return {
    ...prop,
    avoidReason: reason,
    whyNotElite,
    reasoningSummary: `${prop.reasoningSummary} Avoid reason: ${reason}.`,
  };
}

function avoidReasonForProp(prop) {
  if (prop.riskLevel === "Low Data Confidence") return "low data confidence";
  if (prop.riskLevel === "Risky" || prop.riskLevel === "High Risk") return "risk signals outweigh the edge";
  if (prop.confidenceScore < 60) return "confidence below playable threshold";
  return "model did not clear streak safety rules";
}

function uniqueById(props) {
  const seen = new Set();
  return props.filter((prop) => {
    if (seen.has(prop.id)) return false;
    seen.add(prop.id);
    return true;
  });
}

function strongestSideOnly(props) {
  const byProp = new Map();
  props.forEach((prop) => {
    const key = streakSideKey(prop);
    const current = byProp.get(key);
    if (!current || compareStreakSideStrength(prop, current) < 0) byProp.set(key, prop);
  });
  return Array.from(byProp.values());
}

function compareStreakSideStrength(a, b) {
  return (
    streakSideRank(a) - streakSideRank(b) ||
    Number(b.rawProbability || 0) - Number(a.rawProbability || 0) ||
    Number(a.multiplier) - Number(b.multiplier) ||
    sidePreference(a.side) - sidePreference(b.side)
  );
}

function streakSideRank(prop) {
  const modelSide = prop.modelSignal?.modelSide;
  if (!modelSide) return 1;
  return normalizeStreakSide(modelSide) === normalizeStreakSide(prop.side) ? 0 : 2;
}

function sidePreference(side) {
  return normalizeStreakSide(side) === "Higher" ? 0 : 1;
}

function streakSideKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.line, prop.startTime].map(normalize).join("|");
}

function ladderGroupKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType), prop.startTime, normalizeStreakSide(prop.side)]
    .map(normalize)
    .join("|");
}

function playerStatCorrelationKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType), prop.startTime].map(normalize).join("|");
}

function playerCorrelationKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.startTime].map(normalize).join("|");
}

function gameCorrelationKey(prop) {
  const teams = [prop.team, prop.opponent].map(normalize).filter(Boolean).sort();
  if (teams.length < 2) return "";
  return [prop.sport, prop.startTime, ...teams].map(normalize).join("|");
}

function streakModelSignalKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType)].map(normalize).join("|");
}

function enrichStreakCandidate(prop, history) {
  const multiplier = Number(prop.multiplier);
  const historySignal = historicalSignalForProp(prop, history);
  const signal = prop.modelSignal || {};
  const hasModelSignal = Number.isFinite(Number(signal.confidenceScore));
  const modelSide = signal.modelSide ? normalizeStreakSide(signal.modelSide) : "";
  const sideAligned = modelSide && modelSide === normalizeStreakSide(prop.side);
  const sideConflict = modelSide && modelSide !== normalizeStreakSide(prop.side);
  const recentHitRate = Number(signal.recentHitRate);
  const dataQualityScore = Number(signal.dataQualityScore);
  const sampleSize = Number(signal.sampleSize || 0);
  const volatility = Number(signal.volatility);
  const sportsbookDiscrepancy = Number(signal.sportsbookDiscrepancy);
  const hasSportsbookSupport = Number.isFinite(sportsbookDiscrepancy) && sportsbookDiscrepancy > 0;
  const streakPickSide = normalizeStreakSide(prop.side) === "Higher" ? "More" : "Less";
  const lineMovement = prop.rawLineMovement
    ? lineMovementForPick(prop.rawLineMovement, streakPickSide)
    : sideAligned
      ? signal.lineMovement
      : null;
  const projection = Number(signal.projection ?? prop.projection);
  const statEdge = statEdgeForSide(projection, prop.line, prop.side);
  const edgePercentage = edgePercentFromValues(statEdge, prop.line);
  const highMultiplierPenalty = multiplier > 1 ? -12 : 0;
  const multiplierScore = clamp((1 - multiplier) * 55, 0, 18);
  const probabilityScore = Number.isFinite(Number(prop.rawProbability))
    ? clamp((Number(prop.rawProbability) - 0.5) * 35, -5, 8)
    : 0;
  const modelScore = hasModelSignal ? clamp((Number(signal.confidenceScore) - 55) * 0.55, -6, 18) : -10;
  const sideScore = sideAligned ? 7 : sideConflict ? -9 : 0;
  const hitRateScore = Number.isFinite(recentHitRate) ? clamp((recentHitRate - 0.5) * 34, -8, 10) : -2;
  const qualityScore = Number.isFinite(dataQualityScore) ? clamp((dataQualityScore - 50) * 0.18, -8, 10) : -8;
  const sampleScore = sampleSize >= 10 ? 6 : sampleSize >= 5 ? 3 : -4;
  const volatilityScore = Number.isFinite(volatility) ? -clamp(volatility * 1.4, 0, 8) : -2;
  const sportsbookScore = Number.isFinite(sportsbookDiscrepancy) ? clamp(sportsbookDiscrepancy * 2.25, -6, 8) : -4;
  const injuryScore = signal.injuryRisk === "High" ? -16 : signal.injuryRisk === "Medium" ? -7 : 0;
  const whyNotElite = whyNotEliteReasons({
    hasModelSignal,
    recentHitRate,
    dataQualityScore,
    sampleSize,
    volatility,
    sportsbookDiscrepancy,
    injuryRisk: signal.injuryRisk,
    sideConflict,
    multiplier,
  });
  const confidenceScore = computeStreakConfidence({
    multiplierScore,
    probabilityScore,
    modelScore,
    sideScore,
    hitRateScore,
    qualityScore,
    sampleScore,
    volatilityScore,
    sportsbookScore,
    injuryScore,
    highMultiplierPenalty,
    historyAdjustment: historySignal.adjustment,
    recentHitRate,
    sampleSize,
    profile: signal,
  });
  const signalModelProbability = Number(signal.modelProbability);
  const impliedProbability = Number.isFinite(multiplier) ? round(1 / (1 + multiplier)) : null;
  const modelProbability = Number.isFinite(signalModelProbability)
    ? signalModelProbability
    : round(clamp(confidenceScore / 100, 0.45, 0.78));
  const probabilityEdge =
    Number.isFinite(modelProbability) && Number.isFinite(impliedProbability)
      ? round(modelProbability - impliedProbability)
      : null;
  const expectedValue =
    Number.isFinite(modelProbability) && Number.isFinite(multiplier)
      ? round(modelProbability * multiplier - (1 - modelProbability))
      : null;
  const sharpMoneyIndicator =
    signal.sharpMoneyIndicator ||
    sharpMoneyForProp({
      sportsbookDiscrepancy,
      sportsbookComparison: { books: hasSportsbookSupport ? 2 : 0 },
      movement: lineMovement,
    });
  const verifiedAdjustedOdds = isVerifiedAdjustedOddsProp(prop);
  const goblin = isGoblinProp({ ...prop, multiplier, verifiedAdjustedOdds });
  const demon = isDemonProp({ ...prop, multiplier, verifiedAdjustedOdds });
  const valueTags = unique([
    ...(signal.valueTags || []),
    goblin ? "Goblin" : "",
    demon ? "Demon" : "",
    confidenceScore >= 70 ? "High Confidence" : "",
    Number.isFinite(expectedValue) && expectedValue > 0 ? "Positive EV" : "",
    lineMovement?.supportsPick ? "Movement Supports Pick" : "",
    sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal" ? "Sharp Money" : "",
  ]);
  const lowData = !hasModelSignal || !Number.isFinite(dataQualityScore) || dataQualityScore < 42;
  const riskLevel = streakRiskLevel({
    confidenceScore,
    lowData,
    volatility,
    injuryRisk: signal.injuryRisk,
    sideConflict,
    dataQualityScore,
    recentHitRate,
    sampleSize,
    hasSportsbookSupport,
    multiplier,
  });
  const reasonBits = [
    `${prop.platform} is offering a ${formatMultiplier(multiplier)} ${prop.side} side on ${formatNumber(prop.line)} ${prop.statType}.`,
    verifiedAdjustedOdds
      ? `${prop.multiplierSource || prop.adjustedOddsType || "The source"} labels this as an adjusted ${goblin ? "Goblin" : demon ? "Demon" : "payout"} prop.`
      : "This is treated as a standard streak option unless the source or multiplier clearly classifies it as Goblin or Demon.",
    `Model probability is ${formatPercent(modelProbability)} vs break-even ${formatPercent(impliedProbability)} with EV ${formatSignedPercent(expectedValue)}.`,
    hasModelSignal
      ? `Model signal is ${Math.round(signal.confidenceScore)}/100 with ${sideAligned ? "side agreement" : sideConflict ? "side disagreement" : "no clear side agreement"}.`
      : "Low data confidence: no independent model/stat signal is available for this adjusted line yet.",
    Number.isFinite(recentHitRate) ? `Recent hit-rate signal is ${Math.round(recentHitRate * 100)}%.` : "",
    Number.isFinite(signal.last5HitRate) || Number.isFinite(signal.last10HitRate)
      ? `L5/L10 hit rates are ${formatPercent(signal.last5HitRate)} / ${formatPercent(signal.last10HitRate)}.`
      : "",
    Number.isFinite(sportsbookDiscrepancy) ? `Sportsbook comparison edge is ${formatSignedNumber(sportsbookDiscrepancy)}.` : "",
    sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal" ? `Sharp money: ${sharpMoneyIndicator}.` : "",
    lineMovement?.label ? `Line movement: ${lineMovement.label}.` : "",
    signal.injuryRisk && signal.injuryRisk !== "Low" ? `${signal.injuryRisk} injury/news concern lowers the streak grade.` : "",
    historySignal.note,
  ];

  return {
    ...prop,
    multiplier,
    projection: Number.isFinite(projection) ? projection : prop.projection,
    edge: Number.isFinite(statEdge) ? round(statEdge) : signal.edge ?? prop.edge,
    edgePercentage,
    bestPick: streakPickSide,
    sampleSize,
    recentHitRate,
    last5HitRate: signal.last5HitRate,
    last10HitRate: signal.last10HitRate,
    volatility,
    sportsbookDiscrepancy,
    injuryRisk: signal.injuryRisk,
    matchupRating: signal.matchupRating,
    usageAdjustment: signal.usageAdjustment,
    confidenceScore,
    riskLevel,
    dataQualityScore: Number.isFinite(dataQualityScore) ? Math.round(dataQualityScore) : 0,
    modelProbability,
    impliedProbability,
    probabilityEdge,
    expectedValue,
    lineMovement,
    sharpMoneyIndicator,
    valueTags,
    whyNotElite: riskLevel === "Elite" ? [] : whyNotElite,
    reasoningSummary: reasonBits.filter(Boolean).join(" "),
    dataQualityBadge: dataQualityBadge({ ...prop, dataQualityScore: Number.isFinite(dataQualityScore) ? Math.round(dataQualityScore) : 0, fallbackProfile: lowData }),
    payoutLabel: propPayoutLabel({ ...prop, multiplier, verifiedAdjustedOdds }),
    dataSources: dataSourcesUsed({ ...prop, ...signal }),
  };
}

function whyNotEliteReasons({ hasModelSignal, recentHitRate, dataQualityScore, sampleSize, volatility, sportsbookDiscrepancy, injuryRisk, sideConflict, multiplier }) {
  const reasons = [];
  if (!hasModelSignal) reasons.push("no independent model/stat signal");
  if (Number.isFinite(recentHitRate) && recentHitRate < 0.62) reasons.push("recent hit rate is not strong enough");
  if (!Number.isFinite(recentHitRate)) reasons.push("missing recent hit-rate sample");
  if (sampleSize < 5) reasons.push("limited sample size");
  if (Number.isFinite(volatility) && volatility > 2.75) reasons.push("volatile player/stat profile");
  if (!Number.isFinite(dataQualityScore) || dataQualityScore < 65) reasons.push("data confidence below Elite threshold");
  if (!Number.isFinite(sportsbookDiscrepancy) || sportsbookDiscrepancy <= 0) reasons.push("no sportsbook edge support");
  if (injuryRisk && injuryRisk !== "Low") reasons.push(`${injuryRisk.toLowerCase()} injury/news concern`);
  if (sideConflict) reasons.push("model side disagrees with streak side");
  if (multiplier > 1) reasons.push("higher payout/demon style line");
  return unique(reasons);
}

function streakRiskLevel({ confidenceScore, lowData, volatility, injuryRisk, sideConflict, dataQualityScore, recentHitRate, sampleSize, hasSportsbookSupport, multiplier }) {
  if (lowData) return "Low Data Confidence";
  if (injuryRisk === "High" || sideConflict || confidenceScore < 58 || (Number.isFinite(volatility) && volatility > 4.5)) return "Risky";
  if (
    confidenceScore >= 78 &&
    dataQualityScore >= 65 &&
    Number.isFinite(recentHitRate) &&
    recentHitRate >= 0.62 &&
    sampleSize >= 5 &&
    (volatility == null || !Number.isFinite(volatility) || volatility <= 2.75) &&
    injuryRisk !== "Medium" &&
    hasSportsbookSupport &&
    multiplier <= 1
  ) {
    return "Elite";
  }
  return "Medium";
}

function historicalSignalForProp(prop, history) {
  const settled = history.filter(
    (pick) =>
      pickStatus(pick) !== "Pending" &&
      normalize(pick.platform) === normalize(prop.platform) &&
      normalize(pick.sport) === normalize(prop.sport) &&
      normalize(pick.statType || pick.market) === normalize(prop.statType)
  );
  const wins = settled.filter((pick) => pickStatus(pick) === "Win").length;
  const losses = settled.filter((pick) => pickStatus(pick) === "Loss").length;
  const decisions = wins + losses;
  if (decisions < 3) {
    return { adjustment: 0, note: "Not enough settled history yet to materially adjust the score." };
  }
  const winRate = wins / decisions;
  const adjustment = clamp((winRate - 0.55) * 20, -8, 8);
  const direction = adjustment >= 0 ? "raises" : "lowers";
  return {
    adjustment,
    note: `Saved result history for this platform/sport/prop is ${Math.round(winRate * 100)}%, which ${direction} confidence slightly.`,
  };
}

function sortStreakProps(a, b) {
  return (
    Number(b.modelSignal?.confidenceScore || 0) - Number(a.modelSignal?.confidenceScore || 0) ||
    Number(b.modelSignal?.modelProbability || 0) - Number(a.modelSignal?.modelProbability || 0) ||
    Number(b.modelSignal?.expectedValue || 0) - Number(a.modelSignal?.expectedValue || 0) ||
    Number(a.multiplier) - Number(b.multiplier) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime() ||
    String(a.playerName).localeCompare(String(b.playerName))
  );
}

function sortStreakRecommendations(a, b) {
  return (
    b.confidenceScore - a.confidenceScore ||
    Number(b.expectedValue || 0) - Number(a.expectedValue || 0) ||
    Number(b.dataQualityScore || 0) - Number(a.dataQualityScore || 0) ||
    Number(a.multiplier) - Number(b.multiplier) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime() ||
    String(a.playerName).localeCompare(String(b.playerName))
  );
}

function sortLadderRecommendations(a, b) {
  return (
    b.confidenceScore - a.confidenceScore ||
    Number(a.multiplier) - Number(b.multiplier) ||
    Math.abs(Number(a.line) - Number(a.ladderBaseLine || a.line)) - Math.abs(Number(b.line) - Number(b.ladderBaseLine || b.line)) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function sortAvoidRecommendations(a, b) {
  return (
    a.confidenceScore - b.confidenceScore ||
    Number(b.multiplier) - Number(a.multiplier) ||
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

function normalizeStreakSide(side) {
  const key = normalize(side);
  if (key === "more" || key === "over" || key === "higher") return "Higher";
  if (key === "less" || key === "under" || key === "lower") return "Lower";
  return String(side || "Higher");
}

function riskFromSignals({ confidenceScore, volatility, injury, projection, lineComparison, sportsbookComparison }) {
  if (injury?.risk === "High") return "Risky";
  if (!Number.isFinite(projection) && !lineComparison && !sportsbookComparison) return "Low Data Confidence";
  if (confidenceScore >= 75 && (volatility == null || volatility <= 2.25)) return "Elite";
  if (confidenceScore >= 60) return "Medium";
  return "Risky";
}

function getFatalPropReason(prop) {
  if (!prop.playerName || prop.playerName === "Unknown Player") return "missing player name";
  if (!prop.statType) return "missing prop type";
  if (!isActiveUpcomingProp(prop)) return "stale or already-started game time";
  if (!Number.isFinite(Number(prop.line))) return "missing or invalid line";
  if (!Number.isFinite(prop.edge)) return "missing edge calculation";

  const range = projectionRangeForProp(prop);
  if (!range) return `unsupported market: ${prop.statType}`;
  if (Number(prop.line) < range.min || Number(prop.line) > range.max) {
    return `${range.label} line ${formatNumber(prop.line)} outside realistic range ${range.min}-${range.max}`;
  }

  if (prop.projection == null) return "";
  if (!Number.isFinite(prop.projection)) return "projection is NaN";
  if (prop.projection === 0 && range.min > 0) return `${range.label} cannot use a zero projection`;
  if (prop.projection < range.min || prop.projection > range.max) {
    return `${range.label} projection ${formatNumber(prop.projection)} outside realistic range ${range.min}-${range.max}`;
  }

  return "";
}

function logFilteredProp(prop, reason) {
  if (!isDebugLoggingEnabled()) return;
  console.warn("Filtered invalid DFS prop", {
    playerName: prop.playerName,
    propType: prop.statType,
    line: prop.line,
    projection: prop.projection,
    reason,
  });
}

function isDebugLoggingEnabled() {
  try {
    return window.localStorage.getItem("dfs-debug-filtered-props") === "1";
  } catch {
    return false;
  }
}

function projectionRangeForProp(prop) {
  const key = normalize(prop.statType);
  return (
    REALISTIC_PROJECTION_RANGES.find(
      (range) =>
        (range.sport === prop.sport || (range.sport === "Tennis" && isTennisSport(prop.sport))) &&
        range.match(key)
    ) || null
  );
}

function isTennisSport(sport) {
  return sport === "ATP Tennis" || sport === "WTA Tennis" || sport === "Tennis";
}

function isBasketballSport(sport) {
  return sport === "NBA" || sport === "WNBA";
}

function canonicalizeSportProp(prop) {
  const sport = canonicalSportFromProp(prop);
  return sport === prop.sport ? prop : { ...prop, sport };
}

function canonicalSportFromProp(prop) {
  const league = normalize(prop?.league);
  const sportText = normalize(prop?.sport);
  if (league.includes("wnba") || sportText === "wnba" || sportText.includes("women")) return "WNBA";
  if (
    (league === "nba" || league.includes("nationalbasketballassociation") || sportText === "nba") &&
    !league.includes("wnba") &&
    !sportText.includes("wnba")
  ) {
    return "NBA";
  }
  return prop?.sport || "Other";
}

function displaySport(propOrSport) {
  if (typeof propOrSport === "string") return propOrSport;
  return canonicalSportFromProp(propOrSport) === "Other"
    ? isTennisSport(propOrSport?.sport)
      ? "Tennis"
      : propOrSport?.sport || "Sport"
    : canonicalSportFromProp(propOrSport);
}

function confidenceTier(prop) {
  const score = Number(prop.confidenceScore || prop.modelSignal?.confidenceScore || 0);
  return confidenceTierLabel(score, prop.riskLevel || "");
}

function dataSourcesUsed(prop) {
  return unique([
    prop.platform,
    prop.lineComparison ? "PrizePicks/Underdog line comparison" : "",
    prop.sportsbookComparison || prop.modelSignal?.sportsbookDiscrepancy ? "Sportsbook comparison" : "",
    prop.statProfileSource || prop.modelSignal?.statProfileSource || (prop.sampleSize || prop.modelSignal?.sampleSize ? "Player stats" : ""),
    prop.injuryRisk || prop.modelSignal?.injuryRisk ? "Injury/news" : "",
    prop.lineMovement || prop.modelSignal?.lineMovement ? "Line movement" : "",
  ]);
}

function keyStatsSummary(prop) {
  const parts = [];
  const probability = prop.modelProbability || prop.modelSignal?.modelProbability;
  const l5 = prop.last5HitRate || prop.modelSignal?.last5HitRate;
  const l10 = prop.last10HitRate || prop.modelSignal?.last10HitRate || prop.recentHitRate || prop.modelSignal?.recentHitRate;
  if (Number.isFinite(Number(probability))) parts.push(`model probability ${formatPercent(probability)}`);
  if (Number.isFinite(Number(l5)) || Number.isFinite(Number(l10))) parts.push(`L5/L10 ${formatPercent(l5)} / ${formatPercent(l10)}`);
  if (Number.isFinite(Number(prop.expectedValue))) parts.push(`EV ${formatSignedPercent(prop.expectedValue)}`);
  if (Number.isFinite(Number(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy))) {
    parts.push(`book edge ${formatSignedNumber(prop.sportsbookDiscrepancy || prop.modelSignal?.sportsbookDiscrepancy)}`);
  }
  if (Number.isFinite(Number(prop.multiplier))) parts.push(`multiplier ${formatMultiplier(prop.multiplier)}`);
  return parts.length ? parts.join("; ") : "limited stat sample";
}

function usageContextForProp(prop) {
  const usage = prop.usageAdjustment || prop.modelSignal?.usageAdjustment;
  const pitchCount = prop.pitchCountTrend || prop.modelSignal?.pitchCountTrend;
  const minutes = prop.projectedMinutes || prop.modelSignal?.projectedMinutes;
  const parts = [];
  if (usage) parts.push(String(usage));
  if (pitchCount) parts.push(`Pitch count: ${pitchCount}`);
  if (minutes) parts.push(`Minutes: ${minutes}`);
  return parts.length ? parts.join(" | ") : "No minutes/usage/pitch-count flag";
}

function lineMovementStatusText(prop) {
  const movement = prop.lineMovement || prop.modelSignal?.lineMovement;
  if (!movement) return "No movement yet";
  const lastSeen = new Date(movement.lastSeenAt || "").getTime();
  const stale = Number.isFinite(lastSeen) && Date.now() - lastSeen > DFS_CACHE_TTL_MS;
  const direction = movement.supportsPick
    ? "Moving toward value"
    : movement.againstPick
      ? "Moving against value"
      : "Stable";
  return `${direction}${stale ? " - stale line warning" : ""}`;
}

function warningFlags(prop) {
  const flags = [];
  if (prop.riskLevel === "Risky" || prop.riskLevel === "High Risk") flags.push("high risk");
  if (prop.riskLevel === "Low Data Confidence") flags.push("low data confidence");
  if (prop.injuryRisk === "High" || prop.modelSignal?.injuryRisk === "High") flags.push("injury/news concern");
  if (Number(prop.volatility || prop.modelSignal?.volatility) > 4) flags.push("high volatility");
  if (Number(prop.sampleSize || prop.modelSignal?.sampleSize || 0) < 5) flags.push("small sample");
  if (Number(prop.multiplier) > 1) flags.push("demon/aggressive line");
  if (prop.categoryFallback) flags.push("category fallback");
  if (prop.lineMovement?.againstPick || prop.modelSignal?.lineMovement?.againstPick) flags.push("market moved against pick");
  if (!Number.isFinite(Number(prop.modelProbability))) flags.push("missing probability");
  return unique(flags);
}

function riskExplanation(prop) {
  const flags = warningFlags(prop);
  if (flags.length) return flags.join(", ");
  if (prop.riskLevel === "Elite") return "Low-volatility profile with strong confidence and model support.";
  if (prop.riskLevel === "Medium") return "Playable edge, but keep normal streak caution.";
  return prop.riskLevel || "No major risk flags";
}

function historicalDimensionAdjustment(prop, history) {
  const settled = history.filter((pick) => pickStatus(pick) !== "Pending");
  if (settled.length < 4) return { adjustment: 0, note: "" };
  const dimensions = [
    ["source", (pick) => normalize(pick.platform) === normalize(prop.platform)],
    ["sport", (pick) => normalize(displaySport(pick)) === normalize(displaySport(prop))],
    ["prop type", (pick) => normalize(pick.statType || pick.market) === normalize(prop.statType)],
    ["category", (pick) => normalize(pick.category || pick.recommendationType) === normalize(prop.streakCategoryLabel || prop.recommendationType)],
  ];
  let adjustment = 0;
  const notes = [];

  dimensions.forEach(([label, matcher]) => {
    const matches = settled.filter(matcher);
    const wins = matches.filter((pick) => pickStatus(pick) === "Win").length;
    const losses = matches.filter((pick) => pickStatus(pick) === "Loss").length;
    const decisions = wins + losses;
    if (decisions < 3) return;
    const rate = wins / decisions;
    const delta = clamp((rate - 0.55) * 9, -4, 4);
    adjustment += delta;
    notes.push(`${label} history ${Math.round(rate * 100)}%`);
  });

  return {
    adjustment: clamp(adjustment, -8, 8),
    note: notes.length ? `Learning adjustment: ${notes.join(", ")}.` : "",
  };
}

// dataQualityFromSignals imported from ./services/dataQuality.js

function sportsbookValueBoost(prop, bestPick, comparison) {
  const discrepancy = sportsbookDiscrepancyForPick(prop, bestPick, comparison);
  if (!Number.isFinite(discrepancy)) return 0;
  return clamp(discrepancy * 4, -6, 10);
}

function sportsbookDiscrepancyForPick(prop, bestPick, comparison) {
  if (!comparison || !Number.isFinite(Number(comparison.marketAverageLine))) return null;
  if (bestPick !== "More" && bestPick !== "Less") return null;
  const dfsLine = Number(prop.line);
  const marketAverageLine = Number(comparison.marketAverageLine);
  if (!Number.isFinite(dfsLine) || !Number.isFinite(marketAverageLine)) return null;
  return round(bestPick === "More" ? marketAverageLine - dfsLine : dfsLine - marketAverageLine);
}

function sportsbookImpliedForPick(bestPick, comparison) {
  if (!comparison || (bestPick !== "More" && bestPick !== "Less")) return null;
  const side = bestPick === "More" ? comparison.over : comparison.under;
  return Number.isFinite(Number(side?.averageImpliedProbability)) ? Number(side.averageImpliedProbability) : null;
}

function sportsbookPriceForPick(bestPick, comparison) {
  if (!comparison || (bestPick !== "More" && bestPick !== "Less")) return null;
  const side = bestPick === "More" ? comparison.over : comparison.under;
  return Number.isFinite(Number(side?.averagePrice)) ? Number(side.averagePrice) : null;
}

// estimateModelProbability imported from ./services/projectionEngine.js

function expectedValueFromProbability(probability, americanPrice) {
  if (!Number.isFinite(probability)) return null;
  const profit = americanProfit(americanPrice);
  return round(probability * profit - (1 - probability));
}

function americanProfit(americanPrice) {
  const price = Number(americanPrice);
  if (!Number.isFinite(price) || price === 0) return 1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function updateLineMovementMap(props, sportsbookComparisonMap) {
  const previous = readLineMovement();
  const now = new Date().toISOString();
  const next = { ...previous };

  props.forEach((prop) => {
    const key = lineMovementKey(prop);
    const sportsbookComparison = sportsbookComparisonMap.get(sportsbookComparisonKey(prop));
    const currentLine = Number(prop.line);
    const marketLine = Number(sportsbookComparison?.marketAverageLine);
    if (!Number.isFinite(currentLine)) return;

    const existing = next[key] || {
      openingLine: currentLine,
      firstSeenAt: now,
      openingMarketLine: Number.isFinite(marketLine) ? marketLine : null,
    };

    next[key] = {
      ...existing,
      currentLine,
      currentMarketLine: Number.isFinite(marketLine) ? marketLine : existing.currentMarketLine ?? null,
      lastSeenAt: now,
    };
  });

  writeLineMovement(next);
  return new Map(Object.entries(next));
}

function lineMovementForPick(movement, bestPick) {
  if (!movement || (bestPick !== "More" && bestPick !== "Less")) return null;
  const openingLine = Number(movement.openingLine);
  const currentLine = Number(movement.currentLine);
  if (!Number.isFinite(openingLine) || !Number.isFinite(currentLine)) return null;
  const move = round(currentLine - openingLine);
  const supportsPick = bestPick === "More" ? move < 0 : move > 0;
  const againstPick = bestPick === "More" ? move > 0 : move < 0;
  const direction = move === 0 ? "flat" : move > 0 ? "up" : "down";
  const lineQuality = supportsPick ? "better" : againstPick ? "worse" : "neutral";
  return {
    openingLine,
    currentLine,
    move,
    direction,
    lineQuality,
    supportsPick,
    againstPick,
    firstSeenAt: movement.firstSeenAt || "",
    lastSeenAt: movement.lastSeenAt || "",
    label:
      move === 0
        ? "No movement yet"
        : `${formatSignedNumber(move)} (${direction}) — line ${lineQuality} for ${bestPick}`,
  };
}

function sharpMoneyForProp({ sportsbookDiscrepancy, sportsbookComparison, movement }) {
  const books = Number(sportsbookComparison?.books || 0);
  const discrepancy = Number(sportsbookDiscrepancy);
  if (Number.isFinite(discrepancy) && discrepancy >= 0.5 && books >= 2 && movement?.supportsPick) return "Strong alignment";
  if (Number.isFinite(discrepancy) && discrepancy >= 0.5 && books >= 2) return "Sportsbook market supports value";
  if (movement?.supportsPick) return "Line moved toward model";
  if (movement?.againstPick) return "Market moved against model";
  return "No sharp signal";
}

function matchupRatingFromSignals({ profile, injury, sportsbookDiscrepancy, lineComparison }) {
  if (injury?.risk === "High") return "Tough";
  const hitRate = Number(profile?.recentHitRate);
  const discrepancy = Number(sportsbookDiscrepancy);
  if (Number.isFinite(hitRate) && hitRate >= 0.65 && Number.isFinite(discrepancy) && discrepancy > 0) return "Favorable";
  if (Number.isFinite(hitRate) && hitRate < 0.45) return "Tough";
  if (lineComparison?.difference >= 0.5 || (Number.isFinite(discrepancy) && discrepancy > 0)) return "Playable";
  return "Neutral";
}

function usageAdjustmentFromSignals({ prop, profile }) {
  const sampleSize = Number(profile?.sampleSize || 0);
  const statKey = canonicalStatType(prop.statType);
  if (prop.sport === "MLB" && ["strikeouts", "pitchesThrown"].includes(statKey)) {
    return sampleSize >= 5 ? "Pitch workload sample available" : "Pitch workload sample limited";
  }
  if (isBasketballSport(prop.sport)) return sampleSize >= 5 ? "Minutes/usage proxy stable" : "Minutes/usage data limited";
  return sampleSize >= 5 ? "Recent role sample available" : "Usage data limited";
}

function valueTagsForProp({ prop, confidenceScore, sportsbookDiscrepancy, lineComparison, movement, sharpMoneyIndicator, expectedValue, recentHitRate }) {
  const tags = [];
  if (confidenceScore >= 70) tags.push("High Confidence");
  if (Number.isFinite(sportsbookDiscrepancy) && sportsbookDiscrepancy > 0) tags.push("DFS Softer Than Books");
  if (Number.isFinite(expectedValue) && expectedValue > 0) tags.push("Positive EV");
  if (lineComparison?.difference >= 0.5) tags.push("Platform Line Gap");
  if (movement?.supportsPick) tags.push("Movement Supports Pick");
  if (sharpMoneyIndicator && sharpMoneyIndicator !== "No sharp signal") tags.push("Sharp Money");
  if (Number.isFinite(recentHitRate) && recentHitRate >= 0.65) tags.push("L10 Hit Rate");
  if (isGoblinProp(prop)) tags.push("Goblin");
  if (isDemonProp(prop)) tags.push("Demon");
  return tags;
}

function savePropsOfDay(props) {
  return saveLearningPicks(props.slice(0, PROPS_OF_DAY_LIMIT), "Props of the Day");
}

function generatedStreakPicks(boards) {
  return Object.values(boards || {}).flatMap((board) => {
    const picks = board.picks || [];
    return picks.map((pick) => ({
      ...pick,
      categorySource: board.sport === "goblins" ? "goblin" : board.sport === "demons" ? "demon" : "streakStarter",
    }));
  });
}

function saveGeneratedCategoryPicks(props) {
  const existing = readHistory();
  const today = dateKey(new Date());
  const additions = props.map((prop) =>
    toHistoryPick(prop, today, prop.recommendationType || `Streak Finder - ${prop.streakSport || displaySport(prop)} - ${prop.streakCategoryLabel || "Top 2"}`)
  );
  const updated = mergeHistoryPicks(existing, additions);
  writeHistory(updated);
  return updated;
}

function saveLearningPicks(props, recommendationType = "Model Recommendation") {
  const existing = readHistory();
  const today = dateKey(new Date());
  const additions = props.map((prop) => toHistoryPick({ ...prop, categorySource: categorySourceFromRecommendation(recommendationType) }, today, recommendationType));
  const updated = mergeHistoryPicks(existing, additions);
  writeHistory(updated);
  return updated;
}

function toHistoryPick(prop, today, recommendationType = "Model Recommendation") {
  const pickDirection = prop.bestPick || prop.side || "";
  const generatedAt = prop.generatedAt || new Date().toISOString();
  const categorySource = prop.categorySource || categorySourceFromRecommendation(recommendationType);
  const uniqueKey = generatedPickIdentity({
    ...prop,
    slateDate: today,
    side: pickDirection,
  });
  const settled = settlePickFromActual(prop, pickDirection);

  return {
    id: uniqueKey,
    uniqueKey,
    date: today,
    slateDate: today,
    recommendationType,
    categorySource,
    platform: prop.platform,
    sport: prop.streakSport || displaySport(prop),
    league: prop.league,
    playerName: prop.playerName,
    player: prop.playerName,
    team: prop.team,
    opponent: prop.opponent,
    playerImage: prop.playerImage,
    headshot: prop.headshot,
    imageUrl: prop.imageUrl,
    startTime: prop.startTime,
    statType: prop.statType,
    propType: prop.statType,
    market: prop.statType,
    line: prop.line,
    multiplier: prop.multiplier ?? "",
    pickDirection,
    pick: pickDirection,
    side: pickDirection,
    projection: prop.projection,
    modelProbability: prop.modelProbability,
    impliedProbability: prop.impliedProbability,
    expectedValue: prop.expectedValue,
    probabilityEdge: prop.probabilityEdge,
    confidenceScore: prop.confidenceScore,
    confidence: prop.confidenceScore,
    dataQualityLabel: prop.dataQualityBadge?.label || dataQualityBadge(prop).label,
    payoutLabel: prop.payoutLabel || propPayoutLabel(prop),
    edgeRating: prop.edgeRating,
    edge: prop.edge,
    edgePercentage: prop.edgePercentage ?? edgePercentForProp(prop),
    dataQualityScore: prop.dataQualityScore,
    sharpMoneyIndicator: prop.sharpMoneyIndicator,
    lineMovement: prop.lineMovement?.label || "",
    lineMovementData: prop.lineMovement || prop.modelSignal?.lineMovement || null,
    sportsbookComparison: prop.sportsbookComparison || prop.modelSignal?.sportsbookComparison || null,
    clv: prop.clv ?? null,
    clvWon: prop.clvWon ?? null,
    sportsbookDiscrepancy: prop.sportsbookDiscrepancy,
    riskLevel: prop.riskLevel,
    risk: prop.riskLevel,
    category: prop.streakCategoryLabel || recommendationType,
    streakCategory: prop.streakCategory || "",
    streakSport: prop.streakSport || displaySport(prop),
    streakTab: prop.streakTab || "",
    reasoningSummary: prop.reasoningSummary,
    reason: prop.reasoningSummary,
    notes: prop.notes || prop.topTwoReason || prop.reasoningSummary,
    generatedAt,
    createdAt: generatedAt,
    lineAtGeneration: prop.line,
    resultStatus: settled.resultStatus,
    finalResult: settled.resultStatus,
    actualStatResult: settled.actualStatResult,
    settledAt: settled.settledAt,
  };
}

function generatedPickIdentity(prop) {
  return [
    prop.slateDate || dateKey(new Date(prop.startTime || Date.now())),
    prop.platform,
    prop.playerName,
    prop.streakSport || displaySport(prop),
    prop.propType || prop.statType,
    prop.line,
    prop.side || prop.pickDirection || prop.bestPick,
  ]
    .map(normalize)
    .join("|");
}

function categorySourceFromRecommendation(recommendationType = "") {
  const text = normalize(recommendationType);
  if (text.includes("parlay") || text.includes("4man")) return "parlayBuilder";
  if (text.includes("propsofday")) return "propsOfDay";
  if (text.includes("goblin")) return "goblin";
  if (text.includes("demon")) return "demon";
  if (text.includes("streak")) return "streakStarter";
  return "model";
}

function mergeHistoryPicks(existing, additions) {
  const byKey = new Map();
  existing.forEach((pick) => byKey.set(pick.uniqueKey || generatedPickIdentity(pick), pick));
  additions.forEach((pick) => {
    const key = pick.uniqueKey || generatedPickIdentity(pick);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, pick);
      return;
    }
    const currentConfidence = Number(current.confidenceScore ?? current.confidence ?? 0);
    const nextConfidence = Number(pick.confidenceScore ?? pick.confidence ?? 0);
    const categorySource = mergeCategorySources(current.categorySource, pick.categorySource);
    byKey.set(key, {
      ...current,
      ...(nextConfidence >= currentConfidence ? pick : {}),
      categorySource,
      generatedAt: pick.generatedAt || current.generatedAt,
      updatedAt: new Date().toISOString(),
      lineMovementData: pick.lineMovementData || current.lineMovementData || null,
      sportsbookComparison: pick.sportsbookComparison || current.sportsbookComparison || null,
    });
  });
  return Array.from(byKey.values()).sort((a, b) => new Date(b.generatedAt || b.createdAt || 0) - new Date(a.generatedAt || a.createdAt || 0));
}

function mergeCategorySources(a = "", b = "") {
  return unique([...String(a).split(","), ...String(b).split(",")].map((value) => value.trim()).filter(Boolean)).join(",");
}

function settlePickFromActual(prop, pickDirection) {
  const actual = prop.actualStatResult ?? prop.actualResult ?? null;
  const actualNumber = Number(actual);
  const line = Number(prop.line);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(line)) {
    return { resultStatus: "Pending", actualStatResult: null, settledAt: null };
  }
  const side = formatLeanSide(pickDirection);
  const resultStatus = actualNumber === line ? "Push" : side === "Under" ? (actualNumber < line ? "Win" : "Loss") : actualNumber > line ? "Win" : "Loss";
  return { resultStatus, actualStatResult: actualNumber, settledAt: new Date().toISOString() };
}

function saveGeneratedParlay(picks, existing = readParlayHistory()) {
  if (!Array.isArray(picks) || picks.length !== 4) return existing;
  const record = toParlayRecord(picks);
  const currentIndex = existing.findIndex((item) => item.id === record.id);
  const updated = currentIndex >= 0
    ? existing.map((item, index) => (index === currentIndex ? { ...item, ...record, updatedAt: new Date().toISOString() } : item))
    : [record, ...existing];
  writeParlayHistory(updated);
  return updated;
}

function toParlayRecord(picks) {
  const generatedAt = new Date().toISOString();
  const slateDate = dateKey(new Date());
  const normalizedPicks = picks.map((pick) => toHistoryPick({ ...pick, categorySource: "parlayBuilder" }, slateDate, "Quick 4-Man Builder"));
  const statuses = normalizedPicks.map((pick) => pickStatus(pick));
  const legsWon = statuses.filter((status) => status === "Win").length;
  const legsLost = statuses.filter((status) => status === "Loss").length;
  const legsPushed = statuses.filter((status) => status === "Push").length;
  const allLegsSettled = statuses.every((status) => status !== "Pending");
  const parlayResult = legsLost > 0 ? "Loss" : allLegsSettled ? "Win" : "Pending";
  const id = [slateDate, ...normalizedPicks.map((pick) => pick.uniqueKey)].map(normalize).join("|");
  return {
    id,
    generatedAt,
    picks: normalizedPicks,
    allLegsSettled,
    parlayResult,
    legsWon,
    legsLost,
    legsPushed,
    averageConfidence: Math.round(average(normalizedPicks.map((pick) => Number(pick.confidenceScore || 0)))),
    correlationRisk: parlayCorrelationRisk(picks),
  };
}

function buildParlayDashboard(history) {
  const total = history.length;
  const pending = history.filter((record) => record.parlayResult === "Pending").length;
  const wins = history.filter((record) => record.parlayResult === "Win").length;
  const losses = history.filter((record) => record.parlayResult === "Loss").length;
  return {
    total,
    pending,
    wins,
    losses,
    averageConfidence: total ? Math.round(average(history.map((record) => Number(record.averageConfidence || 0)))) : 0,
  };
}

function refreshParlayResults(parlays, pickHistory) {
  const pickMap = new Map(pickHistory.map((pick) => [pick.uniqueKey || pick.id, pick]));
  return parlays.map((record) => {
    const picks = (record.picks || []).map((pick) => pickMap.get(pick.uniqueKey || pick.id) || pick);
    const statuses = picks.map((pick) => pickStatus(pick));
    const legsWon = statuses.filter((status) => status === "Win").length;
    const legsLost = statuses.filter((status) => status === "Loss").length;
    const legsPushed = statuses.filter((status) => status === "Push").length;
    const allLegsSettled = statuses.every((status) => status !== "Pending");
    return {
      ...record,
      picks,
      allLegsSettled,
      parlayResult: legsLost > 0 ? "Loss" : allLegsSettled ? "Win" : "Pending",
      legsWon,
      legsLost,
      legsPushed,
    };
  });
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function buildAccuracyDashboard(history) {
  const total = history.length;
  const pending = history.filter((pick) => pickStatus(pick) === "Pending").length;
  const wins = history.filter((pick) => pickStatus(pick) === "Win").length;
  const losses = history.filter((pick) => pickStatus(pick) === "Loss").length;
  const pushes = history.filter((pick) => pickStatus(pick) === "Push").length;
  const settledDecisionCount = wins + losses;
  const winPercentage = settledDecisionCount ? Math.round((wins / settledDecisionCount) * 100) : 0;

  return {
    total,
    pending,
    wins,
    losses,
    pushes,
    winPercentage,
    generatedToday: history.filter((pick) => pick.slateDate === dateKey(new Date()) || pick.date === dateKey(new Date())).length,
    goblinHitRate: hitRateFor(history, (pick) => String(pick.categorySource || pick.category || "").includes("goblin")),
    demonHitRate: hitRateFor(history, (pick) => String(pick.categorySource || pick.category || "").includes("demon")),
    streakStarterHitRate: hitRateFor(history, (pick) => String(pick.categorySource || "").includes("streakStarter")),
    parlayBuilderHitRate: hitRateFor(history, (pick) => String(pick.categorySource || "").includes("parlayBuilder")),
    clvWinRate: hitRateFor(history, (pick) => pick.clvWon === true || pick.clvWon === false, (pick) => pick.clvWon === true),
    bySport: breakdown(history, (pick) => pick.sport || "Unknown"),
    byStatType: breakdown(history, (pick) => pick.statType || pick.market || "Unknown"),
    byPlatform: breakdown(history, (pick) => pick.platform || "Unknown"),
    byCategory: breakdown(history, (pick) => pick.categorySource || pick.category || pick.recommendationType || "Unknown"),
    byCategorySource: breakdown(history, (pick) => pick.categorySource || "Unknown"),
    byConfidenceRange: breakdown(history, (pick) => confidenceRange(Number(pick.confidenceScore ?? pick.confidence ?? 0))),
    byRiskLevel: breakdown(history, (pick) => pick.riskLevel || pick.risk || "Unknown"),
  };
}

function hitRateFor(history, filterFn, winFn = (pick) => pickStatus(pick) === "Win") {
  const matches = history.filter(filterFn).filter((pick) => pickStatus(pick) !== "Pending" && pickStatus(pick) !== "Push");
  if (!matches.length) return 0;
  return Math.round((matches.filter(winFn).length / matches.length) * 100);
}

function historyFilterOptions(history) {
  return {
    sports: ["all", ...unique(history.map((pick) => pick.sport || "Unknown").filter(Boolean))],
    categories: ["all", ...unique(history.flatMap((pick) => String(pick.categorySource || "Unknown").split(",")).map((item) => item.trim()).filter(Boolean))],
    platforms: ["all", ...unique(history.map((pick) => pick.platform || "Unknown").filter(Boolean))],
  };
}

function matchesHistoryFilter(pick, filter) {
  if (filter.date === "today" && (pick.slateDate || pick.date) !== dateKey(new Date())) return false;
  if (filter.sport !== "all" && normalize(pick.sport) !== normalize(filter.sport)) return false;
  if (filter.categorySource !== "all" && !String(pick.categorySource || "").split(",").map(normalize).includes(normalize(filter.categorySource))) return false;
  if (filter.result !== "all" && pickStatus(pick) !== filter.result) return false;
  if (filter.platform !== "all" && normalize(pick.platform) !== normalize(filter.platform)) return false;
  return true;
}

function breakdown(history, selector) {
  const groups = new Map();
  history.forEach((pick) => {
    const key = selector(pick);
    const current = groups.get(key) || { key, wins: 0, losses: 0, pushes: 0 };
    const status = pickStatus(pick);
    if (status === "Win") current.wins += 1;
    if (status === "Loss") current.losses += 1;
    if (status === "Push") current.pushes += 1;
    groups.set(key, current);
  });

  return Array.from(groups.values())
    .map((row) => {
      const decisions = row.wins + row.losses;
      return {
        ...row,
        winPercentage: decisions ? Math.round((row.wins / decisions) * 100) : 0,
      };
    })
    .sort((a, b) => b.wins + b.losses - (a.wins + a.losses));
}

function historyToCsv(history) {
  const fields = [
    "date",
    "recommendationType",
    "platform",
    "sport",
    "league",
    "playerName",
    "team",
    "opponent",
    "startTime",
    "statType",
    "line",
    "multiplier",
    "pickDirection",
    "projection",
    "modelProbability",
    "impliedProbability",
    "expectedValue",
    "probabilityEdge",
    "confidenceScore",
    "edgeRating",
    "edge",
    "sportsbookDiscrepancy",
    "sharpMoneyIndicator",
    "lineMovement",
    "riskLevel",
    "resultStatus",
    "actualStatResult",
    "generatedAt",
    "settledAt",
    "reasoningSummary",
  ];
  const rows = history.map((pick) => fields.map((field) => csvCell(pick[field] ?? "")).join(","));
  return [fields.join(","), ...rows].join("\n");
}

function csvCell(value) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

function pickStatus(pick) {
  return pick.resultStatus || pick.finalResult || "Pending";
}

function isSupportedHistoryPick(pick) {
  if (!SUPPORTED_SPORTS.has(pick.sport)) return false;
  if (isMultiPlayerComboProp({ playerName: pick.playerName || pick.player, statType: pick.statType || pick.market })) return false;
  if (normalize(pick.league || "").includes("live")) return false;
  return true;
}

function sharedLineKey(prop) {
  return [prop.sport, prop.playerName, prop.statType, prop.startTime].map(normalize).join("|");
}

function sportsbookComparisonKey(prop) {
  return [prop.sport, prop.playerName, canonicalStatType(prop.statType)].map(normalize).join("|");
}

function canonicalStatType(statType) {
  const key = normalize(statType);
  if (key.includes("pitchesthrown") || key.includes("pitchcount")) return "pitchesThrown";
  if (key.includes("strikeout")) return "strikeouts";
  if (key.includes("hitsrunsrbis") || key.includes("hrr")) return "hitsRunsRbis";
  if (key.includes("totalbases")) return "totalBases";
  if (key === "hits") return "hits";
  if (key === "rbis" || key === "rbi") return "rbis";
  if (key === "runs") return "runs";
  if (key.includes("pointsreboundsassists") || key === "pra") return "pra";
  if (key === "points") return "points";
  if (key === "rebounds") return "rebounds";
  if (key === "assists") return "assists";
  if (key.includes("3pointers") || key.includes("threepointers")) return "threes";
  if (key.includes("gameswon") || key.includes("playergames")) return "gamesWon";
  if (key.includes("totalgames")) return "totalGames";
  if (key.includes("aces")) return "aces";
  if (key.includes("doublefault")) return "doubleFaults";
  if (key.includes("shotsontarget")) return "shotsOnTarget";
  if (key === "shots" || key.includes("shotsattempted")) return "shots";
  if (key.includes("passesattempted") || key === "passes") return "passesAttempted";
  if (key.includes("goalsallowed")) return "goalsAllowed";
  if (key.includes("goaliesaves") || key.includes("keepersaves") || key === "saves") return "goalieSaves";
  if (key.includes("fantasyscore")) return "fantasyScore";
  return key;
}

function statLookupKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.startTime]
    .map(normalize)
    .join("|");
}

function makePropId(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.line, prop.startTime]
    .map(normalize)
    .join("-");
}

function lineMovementKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, canonicalStatType(prop.statType), prop.startTime]
    .map(normalize)
    .join("|");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function errorWithDetail(label, error) {
  const detail = error?.message;
  return detail && !detail.includes(label) ? `${label} ${detail}` : label;
}

function confidenceRange(score) {
  if (score >= 80) return "80-100";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";
  if (score >= 50) return "50-59";
  return "Below 50";
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(2));
}

function formatNumber(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatMaybeLine(value) {
  return value != null && value !== "" && Number.isFinite(Number(value)) ? formatNumber(value) : "-";
}

function formatSignedNumber(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const formatted = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return number > 0 ? `+${formatted}` : formatted;
}

function formatLeanSide(value) {
  const side = normalizeStreakSide(value);
  if (side === "Higher") return "Over";
  if (side === "Lower") return "Under";
  if (normalize(value) === "more") return "Over";
  if (normalize(value) === "less") return "Under";
  return String(value || "Watch");
}

function formatPercent(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${Math.round(number * 100)}%`;
}

function formatSignedPercent(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const formatted = `${Math.round(number * 100)}%`;
  return number > 0 ? `+${formatted}` : formatted;
}

function formatAmericanPrice(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const rounded = Math.round(number);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatMultiplier(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(2)}x`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getPlayerImage(playerName, sport) {
  const initials = String(playerName || "Player")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "P";
  const palette = placeholderPalette(sport);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="18" fill="${palette.bg}"/>
      <circle cx="80" cy="58" r="31" fill="${palette.face}"/>
      <path d="M28 147c8-34 28-51 52-51s44 17 52 51" fill="${palette.face}"/>
      <text x="80" y="89" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="${palette.text}">${escapeSvg(initials)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function placeholderPalette(sport) {
  if (sport === "MLB") return { bg: "#123524", face: "#86efac", text: "#052e16" };
  if (sport === "NBA") return { bg: "#3b1d13", face: "#fdba74", text: "#431407" };
  if (sport === "WNBA") return { bg: "#3b0764", face: "#f0abfc", text: "#4a044e" };
  if (isTennisSport(sport)) return { bg: "#283414", face: "#bef264", text: "#1a2e05" };
  if (sport === "Soccer") return { bg: "#102a43", face: "#7dd3fc", text: "#082f49" };
  return { bg: "#1e293b", face: "#cbd5e1", text: "#0f172a" };
}

function escapeSvg(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function riskStyle(risk) {
  const base = { ...styles.riskPill };
  const label = String(risk || "");
  if (label === "Elite" || label === "Low Risk") return { ...base, color: "#052e16", background: "#86efac" };
  if (label === "Medium" || label === "Medium Risk") return { ...base, color: "#422006", background: "#fcd34d" };
  if (label === "Low Data Confidence" || label === "Invalid Data") return { ...base, color: "#111827", background: "#cbd5e1" };
  return { ...base, color: "#450a0a", background: "#fca5a5" };
}

function tierStyle(tier) {
  const base = { ...styles.riskPill };
  if (tier === "Elite verified" || tier === "Elite") return { ...base, color: "#052e16", background: "#86efac" };
  if (tier === "Strong") return { ...base, color: "#042f2e", background: "#5eead4" };
  if (tier === "Solid" || tier === "Medium") return { ...base, color: "#422006", background: "#facc15" };
  if (tier === "Weak lean") return { ...base, color: "#1e3a5f", background: "#93c5fd" };
  return { ...base, color: "#450a0a", background: "#fca5a5" };
}

function sourceStatusStyle(status) {
  const base = { ...styles.sourceStatusPill };
  if (status === "Connected" || status === "fresh") return { ...base, color: "#052e16", background: "#86efac", borderColor: "#22c55e" };
  if (status === "Partial/fallback" || status === "Cached" || status === "cached") return { ...base, color: "#422006", background: "#fcd34d", borderColor: "#ca8a04" };
  if (status === "Setup Needed") return { ...base, color: "#422006", background: "#fcd34d", borderColor: "#ca8a04" };
  if (status === "Failed" || status === "Not Connected") return { ...base, color: "#fecaca", background: "#450a0a", borderColor: "#991b1b" };
  return { ...base, color: "#cbd5e1", background: "#111827", borderColor: "#334155" };
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "28px",
    background: "#0a0f1a",
    color: "#f8fafc",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    marginBottom: "18px",
  },
  eyebrow: {
    margin: "0 0 6px",
    color: "#38bdf8",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0",
  },
  title: {
    margin: 0,
    fontSize: "clamp(28px, 4vw, 48px)",
    lineHeight: 1.02,
    letterSpacing: "0",
  },
  subtitle: {
    margin: "12px 0 0",
    color: "#b6c2d2",
    maxWidth: "760px",
    lineHeight: 1.55,
  },
  lastUpdated: {
    margin: "8px 0 0",
    color: "#7dd3fc",
    fontSize: "13px",
    fontWeight: 800,
  },
  refreshButton: {
    border: "1px solid #38bdf8",
    background: "#0e7490",
    color: "#ecfeff",
    padding: "12px 16px",
    borderRadius: "8px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  sourceStatusBar: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "10px",
    marginBottom: "18px",
  },
  sourceStatusItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "10px 12px",
    border: "1px solid #263449",
    background: "#0f172a",
    borderRadius: "8px",
  },
  sourceName: {
    color: "#dbeafe",
    fontWeight: 900,
    fontSize: "13px",
  },
  sourceStatusPill: {
    border: "1px solid #334155",
    borderRadius: "999px",
    padding: "5px 9px",
    fontSize: "12px",
    fontWeight: 900,
  },
  debugPanel: {
    display: "grid",
    gap: "10px",
    marginBottom: "18px",
    padding: "12px",
    border: "1px solid #263449",
    background: "#0b1220",
    borderRadius: "8px",
  },
  debugHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  debugTitle: {
    margin: 0,
    fontSize: "18px",
    letterSpacing: "0",
  },
  debugGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "10px",
  },
  debugSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "8px",
    paddingTop: "10px",
    borderTop: "1px solid #1f2937",
  },
  debugCard: {
    minWidth: 0,
    border: "1px solid #1f2937",
    background: "#0f172a",
    borderRadius: "8px",
    padding: "10px",
  },
  debugCardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  debugRows: {
    display: "grid",
    gap: "6px",
  },
  debugRow: {
    display: "grid",
    gridTemplateColumns: "minmax(82px, .7fr) minmax(0, 1.3fr)",
    gap: "8px",
    alignItems: "baseline",
    color: "#94a3b8",
    fontSize: "12px",
  },
  controls: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1.4fr) minmax(180px, .6fr) minmax(220px, .8fr)",
    gap: "14px",
    alignItems: "end",
    marginBottom: "18px",
  },
  quickFilters: {
    display: "grid",
    gap: "8px",
    marginBottom: "18px",
    padding: "12px",
    border: "1px solid #1f2937",
    background: "#0b1220",
    borderRadius: "8px",
  },
  streakControls: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(320px, 1.2fr)",
    gap: "14px",
    alignItems: "end",
    marginBottom: "18px",
    padding: "14px",
    border: "1px solid #263449",
    background: "#0f172a",
    borderRadius: "8px",
  },
  streakTitle: {
    margin: 0,
    fontSize: "20px",
    letterSpacing: "0",
  },
  streakCopy: {
    margin: "8px 0 0",
    color: "#94a3b8",
    lineHeight: 1.45,
    fontSize: "14px",
  },
  streakControlGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(180px, 1fr))",
    gap: "10px",
    alignItems: "end",
  },
  streakNotice: {
    gridColumn: "1 / -1",
    margin: 0,
    color: "#bae6fd",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  segmentGroup: {
    display: "grid",
    gap: "8px",
  },
  controlLabel: {
    color: "#cbd5e1",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  segmentRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  segment: {
    border: "1px solid #334155",
    background: "#111827",
    color: "#cbd5e1",
    borderRadius: "8px",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  segmentActive: {
    border: "1px solid #22c55e",
    background: "#14532d",
    color: "#dcfce7",
    borderRadius: "8px",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },
  selectLabel: {
    display: "grid",
    gap: "8px",
    color: "#cbd5e1",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  select: {
    width: "100%",
    minHeight: "42px",
    borderRadius: "8px",
    border: "1px solid #334155",
    background: "#111827",
    color: "#f8fafc",
    padding: "0 12px",
    fontSize: "14px",
  },
  input: {
    width: "100%",
    minHeight: "42px",
    borderRadius: "8px",
    border: "1px solid #334155",
    background: "#111827",
    color: "#f8fafc",
    padding: "0 12px",
    fontSize: "14px",
    boxSizing: "border-box",
  },
  warningPanel: {
    display: "grid",
    gap: "6px",
    padding: "12px",
    border: "1px solid #854d0e",
    background: "#1c1917",
    borderRadius: "8px",
    marginBottom: "18px",
  },
  warningText: {
    margin: 0,
    color: "#fde68a",
    fontSize: "14px",
  },
  errorPanel: {
    padding: "12px",
    border: "1px solid #991b1b",
    background: "#450a0a",
    color: "#fecaca",
    borderRadius: "8px",
    marginBottom: "18px",
  },
  section: {
    marginTop: "22px",
  },
  sectionHeading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
    marginBottom: "12px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "24px",
    letterSpacing: "0",
  },
  sectionTitleSmall: {
    margin: 0,
    fontSize: "18px",
    letterSpacing: "0",
  },
  countPill: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "999px",
    background: "#111827",
    color: "#cbd5e1",
    border: "1px solid #334155",
    fontSize: "13px",
    fontWeight: 800,
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "10px",
  },
  cardGridCompact: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "8px",
  },
  summaryStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "8px",
    marginTop: "16px",
  },
  summaryCard: {
    display: "grid",
    gap: "4px",
    border: "1px solid #1f2937",
    background: "#0b1220",
    borderRadius: "8px",
    padding: "10px",
  },
  summaryHint: {
    color: "#94a3b8",
    fontSize: "11px",
  },
  compactDetails: {
    marginTop: "12px",
    border: "1px solid #1f2937",
    background: "#0b1220",
    borderRadius: "8px",
    padding: "10px",
  },
  detailsSummary: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    cursor: "pointer",
    listStyle: "none",
  },
  compactPanel: {
    marginTop: "10px",
  },
  watchlistSummary: {
    marginTop: "12px",
    padding: "10px",
    border: "1px solid #1f2937",
    background: "#0b1220",
    borderRadius: "8px",
  },
  card: {
    border: "1px solid #243244",
    background: "#0f172a",
    borderRadius: "8px",
    padding: "10px",
    minWidth: 0,
    cursor: "pointer",
  },
  watchlistCard: {
    borderColor: "#3f3f46",
    background: "#111827",
  },
  streakCard: {
    borderColor: "#164e63",
    background: "#0c1826",
  },
  goblinCard: {
    borderColor: "#15803d",
    background: "#071a12",
  },
  demonCard: {
    borderColor: "#b45309",
    background: "#1f1308",
  },
  parlayCard: {
    borderColor: "#4f46e5",
    background: "#11152a",
  },
  ladderCard: {
    borderColor: "#854d0e",
    background: "#1c1917",
  },
  avoidCard: {
    borderColor: "#7f1d1d",
    background: "#1f1418",
  },
  cardTop: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "12px",
  },
  compactCardTop: {
    display: "flex",
    gap: "9px",
    alignItems: "flex-start",
    marginBottom: "8px",
  },
  cardInfo: {
    minWidth: 0,
    flex: 1,
  },
  cardTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "12px",
  },
  valueTag: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #0e7490",
    background: "#082f49",
    color: "#bae6fd",
    borderRadius: "999px",
    padding: "5px 8px",
    fontSize: "11px",
    fontWeight: 900,
    textTransform: "uppercase",
  },
  playerImageWrap: {
    position: "relative",
    flex: "0 0 48px",
    width: "48px",
    aspectRatio: "1 / 1",
    borderRadius: "8px",
    overflow: "hidden",
    background: "#111827",
    border: "1px solid #263449",
  },
  playerImageWrapLarge: {
    flexBasis: "74px",
    width: "74px",
  },
  playerImage: {
    width: "100%",
    height: "100%",
    display: "block",
    objectFit: "cover",
    transition: "opacity 160ms ease",
  },
  imageLoading: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#94a3b8",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    background: "#111827",
  },
  platform: {
    margin: "0 0 6px",
    color: "#22c55e",
    fontWeight: 900,
    fontSize: "10px",
    textTransform: "uppercase",
  },
  playerName: {
    margin: 0,
    fontSize: "17px",
    lineHeight: 1.15,
  },
  gameLine: {
    margin: "4px 0 0",
    color: "#94a3b8",
    fontSize: "12px",
  },
  riskPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 900,
    minWidth: "64px",
  },
  multiplierPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 900,
    minWidth: "64px",
    color: "#083344",
    background: "#67e8f9",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
  },
  compactMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "7px",
  },
  compactMetaGridTight: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "6px",
  },
  cardBadgeColumn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "6px",
  },
  dataQualityBadge: {
    display: "inline-block",
    fontSize: "10px",
    fontWeight: 800,
    padding: "3px 7px",
    borderRadius: "999px",
    border: "1px solid transparent",
  },
  dataBadgeFull: { color: "#052e16", background: "#86efac", borderColor: "#22c55e" },
  dataBadgePartial: { color: "#422006", background: "#fde68a", borderColor: "#ca8a04" },
  dataBadgeFallback: { color: "#431407", background: "#fdba74", borderColor: "#ea580c" },
  dataBadgeWeak: { color: "#450a0a", background: "#fca5a5", borderColor: "#ef4444" },
  playerImageWrapCompact: {
    width: "40px",
    height: "40px",
    minWidth: "40px",
  },
  playerInitials: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    borderRadius: "999px",
    background: "#1e293b",
    color: "#e2e8f0",
    fontWeight: 900,
    fontSize: "13px",
  },
  explanationSections: {
    display: "grid",
    gap: "10px",
    marginTop: "12px",
  },
  explanationBlock: {
    border: "1px solid #263449",
    background: "#0b1220",
    borderRadius: "8px",
    padding: "10px",
    color: "#dbeafe",
    fontSize: "13px",
  },
  explanationList: {
    margin: "6px 0 0",
    paddingLeft: "18px",
    lineHeight: 1.45,
  },
  compactReason: {
    margin: "8px 0 0",
    color: "#dbeafe",
    fontSize: "12px",
    lineHeight: 1.35,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  compactFlags: {
    margin: "6px 0 0",
    color: "#94a3b8",
    fontSize: "11px",
    lineHeight: 1.35,
  },
  whyLink: {
    marginTop: "8px",
    paddingTop: "8px",
    borderTop: "1px solid #1f2937",
    color: "#7dd3fc",
    fontSize: "12px",
    fontWeight: 900,
  },
  metric: {
    minWidth: 0,
    borderTop: "1px solid #1f2937",
    paddingTop: "6px",
  },
  metricLabel: {
    display: "block",
    color: "#94a3b8",
    fontSize: "10px",
    marginBottom: "3px",
  },
  metricValue: {
    display: "block",
    color: "#e2e8f0",
    fontSize: "13px",
    overflowWrap: "anywhere",
  },
  metricValueStrong: {
    display: "block",
    color: "#f8fafc",
    fontSize: "14px",
    overflowWrap: "anywhere",
  },
  comparisonBox: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    marginTop: "12px",
    padding: "10px",
    background: "#111827",
    border: "1px solid #263449",
    borderRadius: "8px",
    color: "#cbd5e1",
    fontSize: "13px",
  },
  reason: {
    margin: "12px 0 0",
    color: "#dbeafe",
    lineHeight: 1.55,
    fontSize: "14px",
  },
  watchlistMessage: {
    display: "grid",
    gap: "4px",
    marginTop: "12px",
    padding: "10px",
    border: "1px solid #334155",
    background: "#0b1220",
    borderRadius: "8px",
    color: "#cbd5e1",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "18px",
    background: "rgba(2, 6, 23, 0.78)",
  },
  modalPanel: {
    width: "min(940px, 100%)",
    maxHeight: "min(86vh, 920px)",
    overflowY: "auto",
    border: "1px solid #334155",
    background: "#0f172a",
    borderRadius: "8px",
    padding: "16px",
    boxShadow: "0 24px 80px rgba(0,0,0,.45)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "14px",
  },
  modalPlayer: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  modalTitle: {
    margin: 0,
    fontSize: "26px",
    lineHeight: 1.1,
    letterSpacing: "0",
  },
  modalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "10px",
  },
  closeButton: {
    border: "1px solid #334155",
    background: "#111827",
    color: "#e2e8f0",
    borderRadius: "8px",
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 900,
  },
  evaluationText: {
    display: "grid",
    gap: "8px",
    marginTop: "12px",
    padding: "12px",
    border: "1px solid #263449",
    background: "#0b1220",
    borderRadius: "8px",
    color: "#dbeafe",
    fontSize: "14px",
    lineHeight: 1.55,
  },
  streakWarning: {
    display: "grid",
    gap: "4px",
    marginTop: "12px",
    padding: "10px",
    border: "1px solid #155e75",
    background: "#082f49",
    borderRadius: "8px",
    color: "#cffafe",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  ladderWarning: {
    display: "grid",
    gap: "4px",
    marginTop: "12px",
    padding: "10px",
    border: "1px solid #854d0e",
    background: "#451a03",
    borderRadius: "8px",
    color: "#fde68a",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  avoidWarning: {
    display: "grid",
    gap: "4px",
    marginTop: "12px",
    padding: "10px",
    border: "1px solid #7f1d1d",
    background: "#450a0a",
    borderRadius: "8px",
    color: "#fecaca",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  generated: {
    margin: "10px 0 0",
    color: "#64748b",
    fontSize: "12px",
  },
  emptyState: {
    minHeight: "120px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "18px",
    border: "1px dashed #334155",
    borderRadius: "8px",
    color: "#cbd5e1",
    background: "#0f172a",
    textAlign: "center",
  },
  dashboardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
    marginBottom: "14px",
  },
  historyFilters: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    margin: "12px 0",
  },
  metricCard: {
    border: "1px solid #243244",
    background: "#0f172a",
    borderRadius: "8px",
    padding: "14px",
  },
  dashboardValue: {
    display: "block",
    marginTop: "4px",
    fontSize: "28px",
  },
  breakdownGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },
  breakdownCard: {
    border: "1px solid #243244",
    background: "#0f172a",
    borderRadius: "8px",
    padding: "14px",
  },
  breakdownTitle: {
    margin: "0 0 10px",
    fontSize: "16px",
  },
  breakdownEmpty: {
    margin: 0,
    color: "#94a3b8",
    fontSize: "13px",
  },
  breakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    padding: "7px 0",
    borderTop: "1px solid #1f2937",
    color: "#cbd5e1",
    fontSize: "13px",
  },
  historyList: {
    display: "grid",
    gap: "10px",
    marginTop: "14px",
  },
  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    border: "1px solid #243244",
    background: "#0f172a",
    borderRadius: "8px",
    padding: "12px",
  },
  historyMeta: {
    margin: "5px 0 0",
    color: "#94a3b8",
    fontSize: "13px",
  },
  resultButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    justifyContent: "flex-end",
  },
  dashboardActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "wrap",
  },
  secondaryButton: {
    border: "1px solid #334155",
    background: "#111827",
    color: "#cbd5e1",
    borderRadius: "8px",
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 800,
  },
  resultButton: {
    border: "1px solid #334155",
    background: "#111827",
    color: "#cbd5e1",
    borderRadius: "8px",
    padding: "8px 9px",
    cursor: "pointer",
    fontWeight: 800,
  },
  resultButtonActive: {
    border: "1px solid #22c55e",
    background: "#14532d",
    color: "#dcfce7",
    borderRadius: "8px",
    padding: "8px 9px",
    cursor: "pointer",
    fontWeight: 900,
  },
};
