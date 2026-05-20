import { useEffect, useMemo, useState } from "react";

const MARKETS = [
  { id: "Fantasy Points", label: "Fantasy Points", sport: "MLB", line: null, group: "pitching", category: "Pitcher", requiresLine: true },
  { id: "Strikeouts", label: "Strikeouts (P)", sport: "MLB", line: 4.5, group: "pitching", category: "Pitcher", oddsKey: "pitcher_strikeouts" },
  { id: "Pitches Thrown", label: "Pitches Thrown", sport: "MLB", line: 92.5, group: "pitching", category: "Pitcher", oddsKey: null, requiresLine: true },
  { id: "Pitching Outs", label: "Pitching Outs", sport: "MLB", line: 14.5, group: "pitching", category: "Pitcher", oddsKey: "pitcher_outs" },
  { id: "Hits", label: "Hits", sport: "MLB", line: 0.5, group: "hitting", category: "Hitter", oddsKey: "batter_hits" },
  { id: "Hits+Runs+RBIs", label: "Hits+Runs+RBIs", sport: "MLB", line: 1.5, group: "hitting", category: "Hitter", oddsKey: null, requiresLine: true },
  { id: "Total Bases", label: "Total Bases", sport: "MLB", line: 1.5, group: "hitting", category: "Hitter", oddsKey: "batter_total_bases" },
  { id: "Runs", label: "Runs", sport: "MLB", line: 0.5, group: "hitting", category: "Hitter", oddsKey: "batter_runs_scored" },
  { id: "RBIs", label: "RBIs", sport: "MLB", line: 0.5, group: "hitting", category: "Hitter", oddsKey: "batter_rbis" },
  { id: "Points", label: "Points", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_points" },
  { id: "Rebounds", label: "Rebounds", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_rebounds" },
  { id: "Assists", label: "Assists", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_assists" },
  { id: "Turnovers", label: "Turnovers", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_turnovers" },
  { id: "3PM", label: "3PM", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_threes" },
  { id: "PRA", label: "Pts+Reb+Ast", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_points_rebounds_assists" },
  { id: "Pts+Reb", label: "Pts+Reb", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_points_rebounds" },
  { id: "Pts+Ast", label: "Pts+Ast", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_points_assists" },
  { id: "Reb+Ast", label: "Reb+Ast", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_rebounds_assists" },
  { id: "Steals", label: "Steals", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_steals" },
  { id: "Blocks", label: "Blocks", sport: "WNBA", line: null, group: "basketball", category: "Player", oddsKey: "player_blocks" },
  { id: "Total Games", label: "Total Games", sport: "ATP", line: null, group: "tennis", category: "Match", oddsKey: "totals" },
  { id: "Player Games Won", label: "Player Games Won", sport: "ATP", line: null, group: "tennis", category: "Player", oddsKey: ["spreads", "team_totals", "player_games_won"] },
  { id: "Aces", label: "Aces", sport: "ATP", line: null, group: "tennis", category: "Player", oddsKey: ["player_aces", "aces"] },
  { id: "Double Faults", label: "Double Faults", sport: "ATP", line: null, group: "tennis", category: "Player", oddsKey: ["player_double_faults", "double_faults"] },
  { id: "Breaks of Serve", label: "Breaks of Serve", sport: "ATP", line: null, group: "tennis", category: "Player", oddsKey: ["player_breaks_of_serve", "breaks_of_serve"] },
  { id: "Fantasy Score", label: "Fantasy Score", sport: "ATP", line: null, group: "tennis", category: "Player", oddsKey: null, requiresLine: true },
  { id: "Total Games", label: "Total Games", sport: "WTA", line: null, group: "tennis", category: "Match", oddsKey: "totals" },
  { id: "Player Games Won", label: "Player Games Won", sport: "WTA", line: null, group: "tennis", category: "Player", oddsKey: ["spreads", "team_totals", "player_games_won"] },
  { id: "Aces", label: "Aces", sport: "WTA", line: null, group: "tennis", category: "Player", oddsKey: ["player_aces", "aces"] },
  { id: "Double Faults", label: "Double Faults", sport: "WTA", line: null, group: "tennis", category: "Player", oddsKey: ["player_double_faults", "double_faults"] },
  { id: "Breaks of Serve", label: "Breaks of Serve", sport: "WTA", line: null, group: "tennis", category: "Player", oddsKey: ["player_breaks_of_serve", "breaks_of_serve"] },
  { id: "Fantasy Score", label: "Fantasy Score", sport: "WTA", line: null, group: "tennis", category: "Player", oddsKey: null, requiresLine: true },
];

const SPORTS = {
  MLB: {
    id: "MLB",
    label: "MLB",
    sportKey: "baseball_mlb",
    boardLabel: "MLB Edge Finder",
    sourceLabel: "MLB Stats API",
  },
  WNBA: {
    id: "WNBA",
    label: "WNBA",
    sportKey: "basketball_wnba",
    boardLabel: "WNBA Edge Finder",
    sourceLabel: "ESPN WNBA data",
  },
  ATP: {
    id: "ATP",
    label: "ATP Tennis",
    sportKey: "tennis_atp",
    boardLabel: "ATP Tennis Edge Finder",
    sourceLabel: "The Odds API + tennis component model",
  },
  WTA: {
    id: "WTA",
    label: "WTA Tennis",
    sportKey: "tennis_wta",
    boardLabel: "WTA Tennis Edge Finder",
    sourceLabel: "The Odds API + tennis component model",
  },
};

const PICK_SIDES = ["All", "Overs", "Unders"];
const LIVE_REFRESH_MS = 60000;
const MIN_EDGE = 0.06;
const MIN_CONFIDENCE = 58;
const DEFAULT_PASTED_ODDS = -110;
const MIN_ALLOWED_ODDS = -250;
const MAX_ALLOWED_ODDS = 300;
const MAX_DISPLAY_PROBABILITY = 0.78;
const MAX_DISPLAY_CONFIDENCE = 78;
const MAX_REASONABLE_EV = 0.18;
const STAT_SEASON = new Date().getFullYear();
const PROPS_HISTORY_KEY = "props-of-the-day-history";
const SHARP_PREDICTIONS_KEY = "sharp-prediction-database";
const DATE_WINDOWS = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "next36", label: "Next 36 Hours" },
];
const TENNIS_FANTASY_SCORING = {
  winBonus: 6,
  setBonus: 2,
  gamesWon: 1,
  ace: 0.5,
  breakOfServe: 2,
  doubleFault: -0.5,
};
const TARGET_BOOKS = [
  "FanDuel",
  "DraftKings",
  "BetMGM",
  "Caesars",
  "ESPN BET",
  "Fanatics",
  "BetRivers",
  "PointsBet",
];
const PRIMARY_SPORT_IDS = ["MLB", "ATP", "WNBA"];
const STABLE_AUTO_MARKETS = {
  MLB: ["Strikeouts", "Pitching Outs"],
  ATP: ["Total Games", "Player Games Won"],
  WNBA: ["Rebounds", "Assists", "PRA"],
};
const MARKET_STABILITY = {
  "MLB:Strikeouts": { role: "Primary", repeatability: 0.94, auto: true, visible: true },
  "MLB:Pitches Thrown": { role: "Primary pasted line", repeatability: 0.88, auto: false, visible: true },
  "MLB:Pitching Outs": { role: "Secondary", repeatability: 0.86, auto: true, visible: true },
  "MLB:Fantasy Points": { role: "Avoid", repeatability: 0.4, auto: false, visible: false },
  "MLB:Hits": { role: "Avoid", repeatability: 0.45, auto: false, visible: true },
  "MLB:Hits+Runs+RBIs": { role: "Volatile pasted line", repeatability: 0.48, auto: false, visible: true },
  "MLB:Total Bases": { role: "Volatile", repeatability: 0.5, auto: false, visible: true },
  "MLB:Runs": { role: "Avoid", repeatability: 0.32, auto: false, visible: false },
  "MLB:RBIs": { role: "Avoid", repeatability: 0.3, auto: false, visible: false },
  "ATP:Total Games": { role: "Primary", repeatability: 0.82, auto: true, visible: true },
  "ATP:Player Games Won": { role: "Primary", repeatability: 0.84, auto: true, visible: true },
  "ATP:Fantasy Score": { role: "Primary pasted line", repeatability: 0.78, auto: false, visible: true },
  "ATP:Aces": { role: "Volatile", repeatability: 0.5, auto: false, visible: false },
  "ATP:Double Faults": { role: "Avoid", repeatability: 0.36, auto: false, visible: false },
  "ATP:Breaks of Serve": { role: "Avoid", repeatability: 0.42, auto: false, visible: false },
  "WTA:Total Games": { role: "Extreme edge only", repeatability: 0.5, auto: false, visible: false },
  "WTA:Player Games Won": { role: "Extreme edge only", repeatability: 0.5, auto: false, visible: false },
  "WTA:Fantasy Score": { role: "Extreme edge only", repeatability: 0.45, auto: false, visible: false },
  "WNBA:Rebounds": { role: "Primary", repeatability: 0.88, auto: true, visible: true },
  "WNBA:Assists": { role: "Primary", repeatability: 0.84, auto: true, visible: true },
  "WNBA:PRA": { role: "Secondary consistent usage only", repeatability: 0.7, auto: true, visible: true },
  "WNBA:Points": { role: "Deprioritized", repeatability: 0.55, auto: false, visible: false },
  "WNBA:Steals": { role: "Avoid", repeatability: 0.28, auto: false, visible: false },
  "WNBA:Blocks": { role: "Avoid", repeatability: 0.26, auto: false, visible: false },
  "WNBA:Turnovers": { role: "Avoid", repeatability: 0.4, auto: false, visible: false },
  "WNBA:3PM": { role: "Avoid", repeatability: 0.36, auto: false, visible: false },
  "WNBA:Pts+Reb": { role: "Combo deprioritized", repeatability: 0.5, auto: false, visible: false },
  "WNBA:Pts+Ast": { role: "Combo deprioritized", repeatability: 0.5, auto: false, visible: false },
  "WNBA:Reb+Ast": { role: "Combo deprioritized", repeatability: 0.58, auto: false, visible: false },
};

const statsCache = new Map();
const injuryCache = new Map();
const wnbaRosterCache = new Map();
const mlbGameContextCache = new Map();
const playerBioCache = new Map();
const tennisSportKeysCache = new Map();

const WNBA_TEAM_CONTEXT = {
  ATL: { pace: 1.03, defense: 0.99 },
  CHI: { pace: 1.04, defense: 1.04 },
  CONN: { pace: 0.97, defense: 0.95 },
  DAL: { pace: 1.06, defense: 1.08 },
  GS: { pace: 1.01, defense: 1.02 },
  IND: { pace: 1.07, defense: 1.06 },
  LA: { pace: 1.0, defense: 1.01 },
  LV: { pace: 1.02, defense: 0.94 },
  MIN: { pace: 0.98, defense: 0.96 },
  NY: { pace: 0.99, defense: 0.93 },
  PHX: { pace: 1.05, defense: 1.05 },
  SEA: { pace: 1.0, defense: 1.0 },
  WSH: { pace: 1.01, defense: 1.03 },
};

const TEAM_CONTEXT = {
  ARI: { park: 1.04, offense: 1.02, contact: 1.01, power: 1.02 },
  ATL: { park: 1.03, offense: 1.08, contact: 1.03, power: 1.07 },
  BAL: { park: 0.97, offense: 1.04, contact: 1.02, power: 1.04 },
  BOS: { park: 1.08, offense: 1.02, contact: 1.03, power: 1.01 },
  CHC: { park: 1.01, offense: 1.0, contact: 1.0, power: 1.0 },
  CWS: { park: 0.99, offense: 0.92, contact: 0.95, power: 0.93 },
  CIN: { park: 1.11, offense: 1.0, contact: 0.99, power: 1.05 },
  CLE: { park: 0.98, offense: 1.01, contact: 1.05, power: 0.97 },
  COL: { park: 1.18, offense: 1.03, contact: 1.04, power: 1.06 },
  DET: { park: 0.96, offense: 0.98, contact: 0.99, power: 0.97 },
  HOU: { park: 1.02, offense: 1.04, contact: 1.04, power: 1.02 },
  KC: { park: 1.0, offense: 0.99, contact: 1.01, power: 0.96 },
  LAA: { park: 1.01, offense: 0.98, contact: 0.98, power: 1.0 },
  LAD: { park: 1.0, offense: 1.1, contact: 1.04, power: 1.08 },
  MIA: { park: 0.94, offense: 0.93, contact: 0.96, power: 0.91 },
  MIL: { park: 1.02, offense: 1.01, contact: 1.0, power: 1.02 },
  MIN: { park: 0.98, offense: 1.0, contact: 0.98, power: 1.02 },
  NYM: { park: 0.97, offense: 1.01, contact: 1.0, power: 1.0 },
  NYY: { park: 1.04, offense: 1.05, contact: 0.99, power: 1.08 },
  ATH: { park: 0.95, offense: 0.94, contact: 0.95, power: 0.93 },
  PHI: { park: 1.03, offense: 1.05, contact: 1.02, power: 1.05 },
  PIT: { park: 0.97, offense: 0.97, contact: 0.98, power: 0.96 },
  SD: { park: 0.96, offense: 1.01, contact: 1.02, power: 0.99 },
  SEA: { park: 0.94, offense: 0.99, contact: 0.96, power: 1.0 },
  SF: { park: 0.93, offense: 0.98, contact: 0.99, power: 0.95 },
  STL: { park: 0.99, offense: 0.99, contact: 1.0, power: 0.97 },
  TB: { park: 0.97, offense: 1.0, contact: 1.0, power: 0.99 },
  TEX: { park: 1.04, offense: 1.04, contact: 1.01, power: 1.05 },
  TOR: { park: 1.02, offense: 1.02, contact: 1.01, power: 1.01 },
  WSH: { park: 0.98, offense: 0.96, contact: 0.98, power: 0.94 },
};

export default function MLBPickFinder() {
  const [selectedSport, setSelectedSport] = useState("MLB");
  const [selectedCategory, setSelectedCategory] = useState("Pitcher");
  const [selectedMarket, setSelectedMarket] = useState("Strikeouts");
  const [selectedSide, setSelectedSide] = useState("All");
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [todaysGames, setTodaysGames] = useState([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [lineText, setLineText] = useState("");
  const [importedLines, setImportedLines] = useState([]);
  const [importMessage, setImportMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [liveStatus, setLiveStatus] = useState("Live updates on");
  const [oddsApiKey, setOddsApiKey] = useState("");
  const [oddsLoading, setOddsLoading] = useState(false);
  const [oddsStatus, setOddsStatus] = useState("");
  const [dateWindow, setDateWindow] = useState("next36");
  const [historySummary, setHistorySummary] = useState(() => buildHistoricalSummary());
  const [sharpSummary, setSharpSummary] = useState(() => buildSharpAnalyticsSummary());
  const [propsHistory, setPropsHistory] = useState(() => readPropsHistory());
  const [trackerMessage, setTrackerMessage] = useState("");
  const [trackerFilters, setTrackerFilters] = useState({
    date: "All",
    sport: "All",
    market: "All",
    result: "All",
    sportsbook: "All",
    tier: "All",
  });

  const sport = SPORTS[selectedSport] || SPORTS.MLB;
  const visibleCategories = useMemo(
    () => Array.from(new Set(MARKETS.filter((item) => item.sport === selectedSport && isStableVisibleMarket(item)).map((item) => item.category))),
    [selectedSport]
  );

  const visibleMarkets = useMemo(
    () =>
      MARKETS.filter(
        (item) => item.sport === selectedSport && item.category === selectedCategory && isStableVisibleMarket(item)
      ),
    [selectedCategory, selectedSport]
  );

  const market = useMemo(
    () =>
      visibleMarkets.find((item) => item.id === selectedMarket) ||
      visibleMarkets[0] ||
      MARKETS[0],
    [selectedMarket, visibleMarkets]
  );

  const savedPickIds = useMemo(
    () => new Set(propsHistory.map((pick) => pick.id)),
    [propsHistory]
  );

  const trackerSummary = useMemo(() => buildPropsTrackerSummary(propsHistory), [propsHistory]);
  const filteredPropsHistory = useMemo(
    () => filterPropsHistory(propsHistory, trackerFilters),
    [propsHistory, trackerFilters]
  );
  const trackerOptions = useMemo(() => buildTrackerFilterOptions(propsHistory), [propsHistory]);
  const topProbablePicks = useMemo(() => getTopProbablePicks(picks), [picks]);

  useEffect(() => {
    loadTodaysGames();
  }, [selectedSport, dateWindow]);

  useEffect(() => {
    const intervalId = window.setInterval(async () => {
      try {
        setLiveStatus(`Refreshing live ${sport.label} data...`);
        const games = await fetchTodaysGames(selectedSport, true, oddsApiKey.trim(), dateWindow);
        await updateTrackedResults(games);
        setHistorySummary(buildHistoricalSummary());
        setSharpSummary(buildSharpAnalyticsSummary());
        setTodaysGames(games);
        setGamesLoaded(true);
        setLastUpdated(new Date());

        if (hasScanned) {
          const openGames = openPropGames(games);
          const lines = await loadSportsbookLinesIfAvailable(market, true, games);
          setPicks(await buildBoard(openGames, lines || importedLines));
        }

        setLiveStatus("Live updates on");
      } catch {
        setLiveStatus("Live update failed. Retrying soon.");
      }
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [hasScanned, importedLines, market.id, selectedSide, oddsApiKey, selectedCategory, selectedSport, sport.label, dateWindow]);

  const buildBoard = async (games, lineSet = importedLines) => {
    const marketLines = lineSet.filter((line) => !line.market || line.market === market.id);
    let board = [];

    if (marketLines.length > 0) {
      board = await evaluatePropLines(games, marketLines, market);
    } else if (isStableVisibleMarket(market)) {
      board = await buildProjectionWatchlist(games, market);
      if (board.length) {
        setOddsStatus(
          `No sportsbook ${market.label} lines loaded yet. Showing projection-only watchlist candidates until odds are available.`
        );
      }
    }

    if (board.length === 0) {
      board = await buildNoBetBoard(
        games,
        market,
        `Load sportsbook ${market.label} odds or paste a ${market.label} line with American odds before scanning.`
      );
    }

    const filteredBoard = board.filter(
      (pick) => selectedSide === "All" || `${pick.pick}s` === selectedSide
    );
    const visibleBoard = filteredBoard.length ? filteredBoard : board.filter((pick) => pick.recommendation === "Pass" || pick.isNoBet);

   return visibleBoard
  .sort((a, b) => {
    if ((a.recommendation === "Pass") !== (b.recommendation === "Pass")) return a.recommendation === "Pass" ? 1 : -1;

    return (b.propScore || 0) - (a.propScore || 0)
      || (b.rankScore || 0) - (a.rankScore || 0)
      || (b.evPct || 0) - (a.evPct || 0)
      || (b.edgePct || 0) - (a.edgePct || 0)
      || (b.consensusScore || 0) - (a.consensusScore || 0)
      || b.confidence - a.confidence;
  })
  .slice(0, 25);
  };

  const commitGeneratedPicks = (nextPicks, label = "Generated props") => {
    setPicks(nextPicks);
    const result = savePropsToHistory(nextPicks.filter((pick) => !pick.watchlistOnly));
    setPropsHistory(result.history);
    setTrackerMessage(
      result.added
        ? `${label}: auto-saved ${result.added} pick${result.added === 1 ? "" : "s"} to the tracker.`
        : `${label}: no new tracker rows because these picks were already saved or are watchlist-only leans.`
    );
  };

  const loadTodaysGames = async () => {
    try {
      const games = await fetchTodaysGames(selectedSport, true, oddsApiKey.trim(), dateWindow);
      await updateTrackedResults(games);
      setHistorySummary(buildHistoricalSummary());
      setSharpSummary(buildSharpAnalyticsSummary());
      setTodaysGames(games);
      setLastUpdated(new Date());
    } catch {
      setTodaysGames([]);
    } finally {
      setGamesLoaded(true);
    }
  };

  const scanPicks = async () => {
    setLoading(true);
    setError(null);
    setHasScanned(true);
    setPicks([]);

    try {
      setLoadingStep(`Refreshing today's ${sport.label} board...`);
      const games = await fetchTodaysGames(selectedSport, true, oddsApiKey.trim(), dateWindow);
      setTodaysGames(games);

      if (games.length === 0) {
        setError(`No ${sport.label} games found today. Check back on a game day.`);
        return;
      }

      const openGames = openPropGames(games);
      if (openGames.length === 0) {
        setError(`All ${sport.label} games on today's board are finished or unavailable for props.`);
        return;
      }

      setLoadingStep(
        `Running local ${market.label} model across ${openGames.length} open ${sport.label} games...`
      );

      const hasPastedLines = importedLines.some((line) => !line.market || line.market === market.id);
      const lines = await loadSportsbookLinesIfAvailable(market, hasPastedLines, openGames);
      if (!lines && hasPastedLines) {
        setOddsStatus(`${importedLines.length} pasted ${market.label} line${importedLines.length === 1 ? "" : "s"} loaded for this scan.`);
      }
      const board = await buildBoard(openGames, lines || importedLines);
      commitGeneratedPicks(board, `${sport.label} ${market.label} scan`);
      setLastUpdated(new Date());
      setLiveStatus("Live updates on");
      setHistorySummary(buildHistoricalSummary());
      setSharpSummary(buildSharpAnalyticsSummary());
    } catch (e) {
      setError(`Error: ${e.message || "Unable to build today's board."}`);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const scanStableProps = async () => {
    setLoading(true);
    setError(null);
    setHasScanned(true);
    setPicks([]);
    setSelectedSide("All");

    try {
      const apiKey = oddsApiKey.trim();
      if (!apiKey) {
        setError("Enter a The Odds API key to auto-generate stable MLB, ATP, and WNBA props from sportsbook lines.");
        return;
      }

      const scanWindow = "next36";
      setDateWindow(scanWindow);
      setLoadingStep("Scanning boring-but-repeatable prop markets...");
      setOddsStatus("Stable engine is loading MLB K/outs, ATP games, and WNBA rebounds/assists lines.");

      const allPicks = [];
      let playableCount = 0;
      const statusParts = [];

      for (const sportId of PRIMARY_SPORT_IDS) {
        const sportConfig = SPORTS[sportId];
        setLoadingStep(`Scanning stable ${sportConfig.label} markets...`);
        const games = openPropGames(await fetchTodaysGames(sportId, true, apiKey, scanWindow));
        const sportPicks = [];

        for (const marketId of STABLE_AUTO_MARKETS[sportId] || []) {
          const targetMarket = findMarket(sportId, marketId);
          if (!targetMarket?.oddsKey) continue;

          let lines = [];
          try {
            lines = await fetchSportsbookProps(apiKey, sportConfig.sportKey, targetMarket.oddsKey, targetMarket.id, scanWindow, games);
          } catch (marketError) {
            if (/rejected the key/i.test(marketError.message || "")) throw marketError;
            statusParts.push(`${sportConfig.label} ${targetMarket.label}: skipped`);
            continue;
          }
          if (!lines.length) {
            sportPicks.push(...(await buildProjectionWatchlist(games, targetMarket)));
            continue;
          }

          const evaluated = await evaluatePropLines(games, lines, targetMarket, { positiveOnly: false });
          const stableCandidates = evaluated
            .filter((pick) => isStableCandidatePick(pick, targetMarket))
            .map((pick) => {
              const playable = isStablePlayablePick(pick, targetMarket);
              if (playable) playableCount += 1;
              return playable ? pick : makeWatchlistPick(pick);
            });
          sportPicks.push(...stableCandidates);
        }

        const topSportPicks = topStablePicksForSport(sportPicks, 3);
        allPicks.push(...topSportPicks);
        statusParts.push(`${sportConfig.label}: ${topSportPicks.length}/3`);
      }

      const stableBoard = allPicks.sort(sortStablePicks);
      commitGeneratedPicks(stableBoard, "Stable Props Engine");
      setTodaysGames(await fetchTodaysGames(selectedSport, true, apiKey, scanWindow));
      setGamesLoaded(true);
      setLastUpdated(new Date());
      setLiveStatus("Stable updates on");
      setOddsStatus(
        playableCount
          ? `Stable engine complete. ${statusParts.join(" · ")}. Auto-saved ${playableCount} playable positive-value prop${playableCount === 1 ? "" : "s"} to the tracker.`
          : `Stable engine complete. ${statusParts.join(" · ")}. No positive-EV bets cleared, so the board is showing top watchlist leans only.`
      );
      setHistorySummary(buildHistoricalSummary());
      setSharpSummary(buildSharpAnalyticsSummary());

      if (stableBoard.length === 0) {
        setError("No stable candidates were found in the next 36 hours. Try again later as books post more lines and starters settle.");
      }
    } catch (e) {
      setError(`Stable engine error: ${e.message || "Unable to build stable prop board."}`);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const importLines = () => {
    const parsed = parseImportedLines(lineText, market.id);
    setImportedLines(parsed);
    setSelectedSide("All");
    setImportMessage(
      parsed.length
        ? `${parsed.length} lines ready. They will use whichever prop market is selected when you scan.`
        : "No valid lines found. Use: Player, Line"
    );
  };

  const selectSport = (sportId) => {
    const nextMarket = getPrimaryMarketForSport(sportId);
    const nextCategory = nextMarket?.category || "Pitcher";
    setSelectedSport(sportId);
    setSelectedCategory(nextCategory);
    setSelectedMarket(nextMarket?.id || MARKETS[0].id);
    setSelectedSide("All");
    setPicks([]);
    setImportedLines([]);
    setLineText("");
    setImportMessage("");
    setOddsStatus("");
    setGamesLoaded(false);
    setTodaysGames([]);
  };

  const selectCategory = (category) => {
    const nextMarket = MARKETS.find(
      (item) => item.sport === selectedSport && item.category === category && isStableVisibleMarket(item)
    );
    setSelectedCategory(category);
    setSelectedMarket(nextMarket?.id || MARKETS[0].id);
    setSelectedSide("All");
    setPicks([]);
    setImportMessage("");
    setOddsStatus("");
  };

  const loadSportsbookLinesIfAvailable = async (targetMarket, silent, games = todaysGames) => {
    const apiKey = oddsApiKey.trim();
    const oddsMarket = targetMarket.oddsKey;

    if (!apiKey || !oddsMarket) {
      if (!silent && oddsMarket && !apiKey) {
        setOddsStatus(
          `Enter a The Odds API key to auto-load ${targetMarket.label} odds, or paste ${targetMarket.label} lines with American odds.`
        );
      }
      return null;
    }

    if (!silent) {
      setLoadingStep(`Locating sportsbook ${targetMarket.label} lines...`);
      setOddsStatus(`Loading sportsbook ${targetMarket.label} lines...`);
    }

    try {
      const lines = await fetchSportsbookProps(apiKey, sport.sportKey, oddsMarket, targetMarket.id, dateWindow, games);
      setImportedLines(lines);
      setImportMessage(`${lines.length} sportsbook ${targetMarket.label} lines loaded.`);
      setOddsStatus(
        lines.length
          ? `Auto-loaded ${lines.length} ${targetMarket.label} lines across ${TARGET_BOOKS.slice(0, 5).join(", ")} and other available books.`
          : `No sportsbook ${targetMarket.label} lines found for open games.`
      );
      return lines;
    } catch (e) {
      setOddsStatus(`Odds load failed: ${e.message || "check your API key"}`);
      return null;
    }
  };

  const loadSportsbookProps = async () => {
    const apiKey = oddsApiKey.trim();
    const oddsMarket = market.oddsKey;

    if (!apiKey) {
      setOddsStatus("Enter a The Odds API key first.");
      return;
    }

    if (!oddsMarket) {
      setOddsStatus(`Odds auto-load is not available for ${market.label}. Choose another ${sport.label} market or paste a line.`);
      return;
    }

    setOddsLoading(true);
    setOddsStatus(`Loading sportsbook ${market.label} props...`);

    try {
      if (market.group === "tennis" && todaysGames.length === 0) {
        const games = await fetchTodaysGames(selectedSport, true, apiKey, dateWindow);
        setTodaysGames(games);
        setGamesLoaded(true);
      }
      const lines = await loadSportsbookLinesIfAvailable(market, false);
      setSelectedSide("All");
      if (!lines) setOddsStatus("Odds load failed. Check your API key.");
    } catch (e) {
      setOddsStatus(`Odds load failed: ${e.message || "check your API key"}`);
    } finally {
      setOddsLoading(false);
    }
  };

  const savePropsOfTheDay = () => {
    const result = savePropsToHistory(picks);
    setPropsHistory(result.history);
    setTrackerMessage(
      result.added
        ? `${result.added} props saved to tracker.`
        : "No new props saved. Displayed picks are already in today's tracker or are PASS rows."
    );
  };

  const updatePropsResult = (id, status) => {
    const nextHistory = propsHistory.map((pick) =>
      pick.id === id ? settlePropsHistoryPick(pick, status) : pick
    );
    writePropsHistory(nextHistory);
    setPropsHistory(nextHistory);
    setTrackerMessage(`Updated pick to ${status}.`);
  };

  const autoSettleProps = async () => {
    const nextHistory = [];
    let settled = 0;

    for (const pick of propsHistory) {
      if (pick.resultStatus !== "Pending") {
        nextHistory.push(pick);
        continue;
      }

      const actual = await fetchActualResultFromSavedPick(pick);
      if (!Number.isFinite(actual)) {
        nextHistory.push(pick);
        continue;
      }

      const status =
        actual === pick.propLine
          ? "Push"
          : pick.pickSide === "Over"
          ? actual > pick.propLine
            ? "Win"
            : "Loss"
          : actual < pick.propLine
          ? "Win"
          : "Loss";

      nextHistory.push(settlePropsHistoryPick(pick, status, actual));
      settled += 1;
    }

    writePropsHistory(nextHistory);
    setPropsHistory(nextHistory);
    setTrackerMessage(settled ? `Auto-settled ${settled} pending props.` : "No pending props had final results available yet.");
  };

  const exportPropsCsv = () => {
    exportPropsHistoryCsv(propsHistory);
    setTrackerMessage("CSV export created.");
  };

  const clearPropsHistory = () => {
    if (!window.confirm("Clear all Props of the Day tracker history?")) return;
    writePropsHistory([]);
    setPropsHistory([]);
    setTrackerMessage("Props of the Day history cleared.");
  };

  return (
    <div style={S.page}>
      <div style={S.container}>
        <header style={S.header}>
          <div style={S.titleRow}>
            <span style={S.logo}>{sport.label}</span>
            <h1 style={S.title}>{sport.boardLabel}</h1>
            <span style={S.liveBadge}>NO AI NEEDED</span>
          </div>
          <p style={S.subtitle}>
            Stable prop board for today and tomorrow. The engine prioritizes
            MLB strikeouts/outs, ATP games markets, and WNBA rebounds/assists,
            then cuts out volatile props before ranking the best values.
          </p>
          <div style={S.liveRow}>
            <span style={S.liveDot} />
            <span>{liveStatus}</span>
            {lastUpdated && <span>Updated {formatUpdateTime(lastUpdated)}</span>}
          </div>
        </header>

        <ModelResultsCard summary={historySummary} />
        <SharpAnalyticsDashboard summary={sharpSummary} />

        <div style={S.controlsCard}>
          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Sport</span>
            <div style={S.chipRow}>
              {PRIMARY_SPORT_IDS.map((sportId) => {
                const item = SPORTS[sportId];
                return (
                  <button
                    key={item.id}
                    onClick={() => selectSport(item.id)}
                    style={{
                      ...S.chip,
                      ...(selectedSport === item.id ? S.chipActive : {}),
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Event window</span>
            <div style={S.chipRow}>
              {DATE_WINDOWS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setDateWindow(item.id);
                    setGamesLoaded(false);
                    setPicks([]);
                  }}
                  style={{
                    ...S.chip,
                    ...(dateWindow === item.id ? S.chipActive : {}),
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Category</span>
            <div style={S.chipRow}>
              {visibleCategories.map((category) => (
                <button
                  key={category}
                  onClick={() => selectCategory(category)}
                  style={{
                    ...S.chip,
                    ...(selectedCategory === category ? S.chipActive : {}),
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>{selectedCategory} prop market</span>
            <div style={S.chipRow}>
              {visibleMarkets.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedMarket(item.id)}
                  style={{
                    ...S.chip,
                    ...(selectedMarket === item.id ? S.chipActive : {}),
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Pick side</span>
            <div style={S.chipRow}>
              {PICK_SIDES.map((side) => (
                <button
                  key={side}
                  onClick={() => setSelectedSide(side)}
                  style={{
                    ...S.chip,
                    ...(selectedSide === side ? S.chipActive : {}),
                  }}
                >
                  {side}
                </button>
              ))}
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Paste {selectedCategory.toLowerCase()} prop lines</span>
            <textarea
              value={lineText}
              onChange={(event) => setLineText(event.target.value)}
              placeholder={
                selectedSport === "WNBA"
                  ? `Selected market: ${market.label}\nA'ja Wilson, 24.5\nCaitlin Clark, 7.5, DraftKings`
                  : market.group === "tennis"
                  ? `Selected market: ${market.label}\nCarlos Alcaraz vs Jannik Sinner, 22.5\nIga Swiatek, 12.5, FanDuel`
                  : selectedCategory === "Pitcher"
                  ? `Selected market: ${market.label}\nGeorge Kirby, 34.5\nPaul Skenes, 6.5, Underdog`
                  : `Selected market: ${market.label}\nAaron Judge, 0.5\nMookie Betts, 0.5, DraftKings`
              }
              style={S.textarea}
            />
            <div style={S.importRow}>
              <button type="button" onClick={importLines} style={S.secondaryBtn}>
                Import pasted lines
              </button>
              <button
                type="button"
                onClick={() => {
                  setLineText("");
                  setImportedLines([]);
                  setImportMessage("Imported lines cleared.");
                }}
                style={S.secondaryBtnMuted}
              >
                Clear
              </button>
              <span style={S.importStatus}>
                {importMessage ||
                  `${importedLines.length} custom lines loaded. No pick is made until a real line is available.`}
              </span>
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Sportsbook prop loader</span>
            <div style={S.apiRow}>
              <input
                value={oddsApiKey}
                onChange={(event) => setOddsApiKey(event.target.value)}
                placeholder="The Odds API key"
                style={S.apiInput}
                type="password"
              />
              <button
                type="button"
                onClick={loadSportsbookProps}
                disabled={oddsLoading}
                style={{
                  ...S.secondaryBtn,
                  ...(oddsLoading ? S.scanBtnDisabled : {}),
                }}
              >
                {oddsLoading ? "Loading..." : `Load ${market.label} odds`}
              </button>
            </div>
            <span style={S.importStatus}>
              {oddsStatus ||
                `${sport.label}: stable mode only surfaces repeatable markets. ${market.group === "tennis" ? "ATP total games and player games won are prioritized; WTA is excluded from auto-generation." : sport.label === "WNBA" ? "Primary markets are rebounds and assists; PRA is secondary only when usage is consistent." : "Primary market is pitcher strikeouts; pitcher outs is secondary."}`}
            </span>
          </div>

          <button
            onClick={scanStableProps}
            disabled={loading}
            style={{
              ...S.scanBtn,
              ...(loading ? S.scanBtnDisabled : {}),
            }}
          >
            {loading ? (
              <>
                <span style={S.spinner} />
                {loadingStep || "Scanning stable props..."}
              </>
            ) : (
              "Generate stable top props"
            )}
          </button>

          <button
            onClick={scanPicks}
            disabled={loading || !gamesLoaded || todaysGames.length === 0}
            style={{
              ...S.scanBtn,
              ...(loading || todaysGames.length === 0 ? S.scanBtnDisabled : {}),
            }}
          >
            {loading ? (
              <>
                <span style={S.spinner} />
                {loadingStep || "Scanning..."}
              </>
            ) : (
              `Scan selected ${market.label} market`
            )}
          </button>
        </div>

        <TopProbablePropsStrip picks={topProbablePicks} hasScanned={hasScanned} loading={loading} />

        {gamesLoaded && todaysGames.length > 0 && (
          <div style={S.gamesCard}>
            <div style={S.gamesTopRow}>
              <div>
                <div style={S.sectionLabel}>
                  {selectedSport === "MLB"
                    ? "Upcoming MLB games"
                    : selectedSport === "WNBA"
                    ? "Upcoming WNBA games"
                    : `Upcoming ${sport.label} matches`}
                </div>
                <div style={S.gamesHint}>Clean view: matchup, start time, and probable starters only.</div>
              </div>
              <span style={S.gamesCount}>{todaysGames.length} events</span>
            </div>
            <div style={S.gamesRow}>
              {todaysGames.map((game) => (
                <GameScoreCard key={game.id} game={game} sportId={selectedSport} />
              ))}
            </div>
          </div>
        )}

        {gamesLoaded && todaysGames.length === 0 && (
          <div style={S.emptyBox}>
            No upcoming {sport.label} events in this window.
          </div>
        )}

        {error && <div style={S.errorBox}>{error}</div>}

        {!loading && picks.length > 0 && (
          <div>
            <div style={S.boardHeaderRow}>
              <div style={{ ...S.sectionLabel, marginBottom: 0 }}>
                {picks.length} picks · stable score first · {selectedSide} · odds lines + local stat profiles
              </div>
              <button type="button" onClick={savePropsOfTheDay} style={S.secondaryBtn}>
                Save Props of the Day
              </button>
            </div>
            {trackerMessage && <div style={S.importStatus}>{trackerMessage}</div>}
            {picks.map((pick, index) => (
              <PickCard
                key={`${pick.player}-${pick.team}-${index}`}
                pick={pick}
                rank={index}
                isSaved={savedPickIds.has(propsHistoryIdFromPick(pick))}
              />
            ))}
          </div>
        )}

        {!loading && hasScanned && picks.length === 0 && !error && (
          <div style={S.emptyBox}>
            {getEmptyMessage(market, selectedSide)}
          </div>
        )}

        <PropsResultsTracker
          history={filteredPropsHistory}
          summary={trackerSummary}
          filters={trackerFilters}
          options={trackerOptions}
          onFilterChange={(key, value) =>
            setTrackerFilters((current) => ({ ...current, [key]: value }))
          }
          onResultChange={updatePropsResult}
          onAutoSettle={autoSettleProps}
          onExport={exportPropsCsv}
          onClear={clearPropsHistory}
        />

        <p style={S.disclaimer}>
          For entertainment only. These are local projections, not sportsbook
          advice. Verify lineups, starters, odds, and injuries before betting.
          Never bet more than you can afford to lose.
        </p>
      </div>
    </div>
  );
}

async function fetchTodaysGames(sportId = "MLB", includeClosed = false, apiKey = "", dateWindow = "next36") {
  if (sportId === "WNBA") return fetchWnbaTodaysGames(includeClosed, dateWindow);
  if (sportId === "ATP" || sportId === "WTA") return fetchTennisUpcomingEvents(sportId, apiKey, dateWindow);
  return fetchMlbTodaysGames(includeClosed, dateWindow);
}

async function fetchMlbTodaysGames(includeClosed = false, dateWindow = "next36") {
  const today = getLocalDateISO();
  const tomorrow = offsetDateISO(1);
  const response = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${tomorrow}&hydrate=team,venue,probablePitcher,linescore`
  );

  if (!response.ok) {
    throw new Error("MLB schedule API is unavailable.");
  }

  const data = await response.json();
  const games = (data.dates || []).flatMap((date) =>
    (date.games || [])
      .filter((game) => includeClosed || isOpenGame(game))
      .map((game) => normalizeMlbGame(game))
  );

  const upcomingGames = games.filter((game) => isInSelectedEventWindow(game.commenceTime, dateWindow));

  if (!includeClosed) return upcomingGames;

  return Promise.all(
    upcomingGames.map(async (game) =>
      game.isFinal ? { ...game, finalReview: await fetchMlbGameReview(game.id) } : game
    )
  );
}

async function fetchWnbaTodaysGames(includeClosed = false, dateWindow = "next36") {
  const dates = [getCompactDate(), offsetDateISO(1).replace(/-/g, "")];
  const responses = await Promise.all(
    dates.map((date) => fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${date}`))
  );

  if (responses.some((response) => !response.ok)) {
    throw new Error("WNBA schedule API is unavailable.");
  }

  const payloads = await Promise.all(responses.map((response) => response.json()));
  return payloads
    .flatMap((data) => data.events || [])
    .filter((event) => includeClosed || isOpenWnbaGame(event))
    .map((event) => normalizeWnbaGame(event))
    .filter((event) => isInSelectedEventWindow(event.commenceTime, dateWindow));
}

function isOpenGame(game) {
  const abstractState = game.status?.abstractGameState || "";
  const codedState = game.status?.codedGameState || "";
  const detailedState = game.status?.detailedState || "";

  if (abstractState === "Final") return false;
  if (["F", "O"].includes(codedState)) return false;
  return !/final|completed|game over|cancelled|postponed/i.test(detailedState);
}

function isOpenWnbaGame(event) {
  const status = event.status?.type || {};
  const detail = `${status.description || ""} ${status.detail || ""}`;
  if (status.completed || status.state === "post") return false;
  return !/final|postponed|cancelled|canceled/i.test(detail);
}

function openPropGames(games) {
  return (Array.isArray(games) ? games : []).filter((game) => !game.isFinal && !game.isPostponed);
}

function getLocalDateISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCompactDate() {
  return getLocalDateISO().replace(/-/g, "");
}

function offsetDateISO(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isInSelectedEventWindow(commenceTime, dateWindow = "next36") {
  if (!commenceTime) return false;
  const start = new Date(commenceTime).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || start <= now + 10 * 60 * 1000) return false;

  if (dateWindow === "today") return eventDateKey(commenceTime) === getLocalDateISO();
  if (dateWindow === "tomorrow") return eventDateKey(commenceTime) === offsetDateISO(1);

  const thirtySixHoursFromNow = now + 36 * 60 * 60 * 1000;
  return start < thirtySixHoursFromNow;
}

function eventDateKey(value) {
  const eventDate = new Date(value);
  const year = eventDate.getFullYear();
  const month = String(eventDate.getMonth() + 1).padStart(2, "0");
  const day = String(eventDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeMlbGame(game) {
  const awayTeam = game.teams?.away?.team || {};
  const homeTeam = game.teams?.home?.team || {};
  const awayPitcher = game.teams?.away?.probablePitcher || {};
  const homePitcher = game.teams?.home?.probablePitcher || {};
  const linescore = game.linescore || {};
  const abstractState = game.status?.abstractGameState || "";
  const detailedState = game.status?.detailedState || "Scheduled";
  const codedState = game.status?.codedGameState || "";
  const isFinal =
    abstractState === "Final" ||
    ["F", "O"].includes(codedState) ||
    /final|completed|game over/i.test(detailedState);
  const isPostponed = /cancelled|canceled|postponed|suspended/i.test(detailedState);
  const isLive = abstractState === "Live" || /in progress|delayed/i.test(detailedState);
  const awayScore = Number(game.teams?.away?.score);
  const homeScore = Number(game.teams?.home?.score);

  return {
    sport: "MLB",
    id: game.gamePk,
    away: awayTeam.name || "TBD",
    awayId: awayTeam.id,
    awayAbbr: teamAbbr(awayTeam),
    home: homeTeam.name || "TBD",
    homeId: homeTeam.id,
    homeAbbr: teamAbbr(homeTeam),
    awayPitcher: awayPitcher.fullName || "TBD",
    awayPitcherId: awayPitcher.id,
    homePitcher: homePitcher.fullName || "TBD",
    homePitcherId: homePitcher.id,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    venue: game.venue?.name || "Ballpark TBD",
    status: detailedState,
    isFinal,
    isLive,
    isPostponed,
    inningStatus: formatInningStatus(linescore, detailedState),
    commenceTime: game.gameDate,
    gameTime: game.gameDate
      ? new Date(game.gameDate).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "TBD",
  };
}

function formatInningStatus(linescore, fallback) {
  const inning = linescore.currentInningOrdinal;
  const inningState = linescore.inningState;
  const outs = Number(linescore.outs);
  if (!inning || !inningState) return fallback;
  const outsText = Number.isFinite(outs) ? ` · ${outs} out${outs === 1 ? "" : "s"}` : "";
  return `${inningState} ${inning}${outsText}`;
}

async function fetchMlbGameReview(gameId) {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/game/${gameId}/boxscore`);
    if (!response.ok) return null;

    const boxscore = await response.json();
    const away = boxscore.teams?.away || {};
    const home = boxscore.teams?.home || {};
    const awayReview = buildMlbTeamReview(away);
    const homeReview = buildMlbTeamReview(home);
    const highlights = [
      awayReview.topBat ? `${awayReview.abbr} bat: ${awayReview.topBat}` : null,
      homeReview.topBat ? `${homeReview.abbr} bat: ${homeReview.topBat}` : null,
      awayReview.topPitcher ? `${awayReview.abbr} arm: ${awayReview.topPitcher}` : null,
      homeReview.topPitcher ? `${homeReview.abbr} arm: ${homeReview.topPitcher}` : null,
    ].filter(Boolean);

    return {
      teamLine: `${awayReview.abbr} ${awayReview.runs} (${awayReview.hits}H, ${awayReview.errors}E) · ${homeReview.abbr} ${homeReview.runs} (${homeReview.hits}H, ${homeReview.errors}E)`,
      highlights,
    };
  } catch {
    return null;
  }
}

async function fetchMlbLiveContext(gameId) {
  if (!gameId) return {};
  if (mlbGameContextCache.has(gameId)) return mlbGameContextCache.get(gameId);

  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`);
    if (!response.ok) throw new Error("Live context unavailable");

    const data = await response.json();
    const weather = data.gameData?.weather || {};
    const officials = data.liveData?.boxscore?.officials || [];
    const plateUmpire = officials.find((official) => /home plate/i.test(official.officialType || ""));
    const probablePitchers = data.gameData?.probablePitchers || {};
    const context = {
      weather: formatWeather(weather),
      weatherRating: weatherRunEnvironment(weather),
      umpire: plateUmpire?.official?.fullName || "Umpire TBD",
      umpireRating: umpireRunEnvironment(plateUmpire?.official?.fullName),
      awayPitchHand: probablePitchers.away?.pitchHand?.code || "",
      homePitchHand: probablePitchers.home?.pitchHand?.code || "",
    };

    mlbGameContextCache.set(gameId, context);
    return context;
  } catch {
    const context = {};
    mlbGameContextCache.set(gameId, context);
    return context;
  }
}

function formatWeather(weather) {
  const parts = [
    weather.condition,
    weather.temp ? `${weather.temp}F` : null,
    weather.wind ? `wind ${weather.wind}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Weather unavailable";
}

function weatherRunEnvironment(weather) {
  const temp = Number(weather.temp);
  const condition = String(weather.condition || "").toLowerCase();
  const wind = String(weather.wind || "").toLowerCase();
  let rating = 0;
  if (Number.isFinite(temp)) rating += clamp((temp - 70) / 100, -0.12, 0.12);
  if (/rain|drizzle|snow|cold/i.test(condition)) rating -= 0.04;
  if (/out to|out toward|blowing out/.test(wind)) rating += 0.05;
  if (/in from|blowing in/.test(wind)) rating -= 0.05;
  return clamp(rating, -0.16, 0.16);
}

function umpireRunEnvironment(name) {
  if (!name) return 0;
  const bucket = normalizeKey(name).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7;
  return (bucket - 3) * 0.01;
}

function buildMlbTeamReview(teamBox) {
  const batting = teamBox.teamStats?.batting || {};
  const fielding = teamBox.teamStats?.fielding || {};
  const players = Object.values(teamBox.players || {});
  const hitters = players
    .map((player) => ({
      name: player.person?.fullName || "Player",
      stats: player.stats?.batting || {},
    }))
    .filter((player) => Number(player.stats.atBats || 0) > 0 || Number(player.stats.hits || 0) > 0)
    .sort((a, b) => hitterImpact(b.stats) - hitterImpact(a.stats));
  const pitchers = players
    .map((player) => ({
      name: player.person?.fullName || "Pitcher",
      stats: player.stats?.pitching || {},
    }))
    .filter((player) => player.stats.inningsPitched)
    .sort((a, b) => pitcherImpact(b.stats) - pitcherImpact(a.stats));

  return {
    abbr: teamAbbr(teamBox.team || {}),
    runs: numberOrZero(batting.runs),
    hits: numberOrZero(batting.hits),
    errors: numberOrZero(fielding.errors),
    topBat: hitters[0] ? formatHitterLine(hitters[0].name, hitters[0].stats) : "",
    topPitcher: pitchers[0] ? formatPitcherLine(pitchers[0].name, pitchers[0].stats) : "",
  };
}

function hitterImpact(stats) {
  return (
    numberOrZero(stats.hits) * 3 +
    numberOrZero(stats.homeRuns) * 4 +
    numberOrZero(stats.rbi) * 2 +
    numberOrZero(stats.runs)
  );
}

function pitcherImpact(stats) {
  return inningsToOuts(stats.inningsPitched) + numberOrZero(stats.strikeOuts) * 2 - numberOrZero(stats.earnedRuns) * 3;
}

function formatHitterLine(name, stats) {
  const hits = numberOrZero(stats.hits);
  const atBats = numberOrZero(stats.atBats);
  const homeRuns = numberOrZero(stats.homeRuns);
  const rbi = numberOrZero(stats.rbi);
  const runs = numberOrZero(stats.runs);
  const extras = [
    homeRuns ? `${homeRuns} HR` : null,
    rbi ? `${rbi} RBI` : null,
    runs ? `${runs} R` : null,
  ].filter(Boolean);
  return `${shortName(name)} ${hits}-${atBats}${extras.length ? `, ${extras.join(", ")}` : ""}`;
}

function formatPitcherLine(name, stats) {
  return `${shortName(name)} ${stats.inningsPitched || "0.0"} IP, ${numberOrZero(stats.strikeOuts)} K, ${numberOrZero(stats.earnedRuns)} ER`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeWnbaGame(event) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const away = competitors.find((item) => item.homeAway === "away") || {};
  const home = competitors.find((item) => item.homeAway === "home") || {};
  const awayTeam = away.team || {};
  const homeTeam = home.team || {};
  const status = event.status?.type || {};
  const awayScore = Number(away.score);
  const homeScore = Number(home.score);
  const detail = `${status.description || ""} ${status.detail || ""}`;

  return {
    sport: "WNBA",
    id: event.id,
    away: awayTeam.displayName || awayTeam.name || "TBD",
    awayId: awayTeam.id,
    awayAbbr: awayTeam.abbreviation || "TBD",
    home: homeTeam.displayName || homeTeam.name || "TBD",
    homeId: homeTeam.id,
    homeAbbr: homeTeam.abbreviation || "TBD",
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    venue: competition.venue?.fullName || "Arena TBD",
    status: status.shortDetail || status.detail || status.description || "Scheduled",
    isFinal: Boolean(status.completed || status.state === "post"),
    isLive: status.state === "in",
    isPostponed: /postponed|cancelled|canceled/i.test(detail),
    commenceTime: event.date,
    gameTime: event.date
      ? new Date(event.date).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "TBD",
  };
}

async function fetchTennisUpcomingEvents(sportId, apiKey, dateWindow = "next36") {
  if (!apiKey) return [];
  const sportKeys = await getActiveTennisSportKeys(apiKey, sportId);
  if (!Array.isArray(sportKeys) || !sportKeys.length) return [];

  try {
    const eventSets = await Promise.all(
      sportKeys.map(async (sportKey) => {
        const eventsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/events`);
        eventsUrl.searchParams.set("apiKey", apiKey);
        const response = await fetch(eventsUrl);
        if (!response.ok) return [];
        const events = await response.json();
        return (events || []).map((event) => ({ ...event, sport_key: sportKey }));
      })
    );

    return eventSets
      .flat()
      .filter((event) => isInSelectedEventWindow(event.commence_time, dateWindow))
      .map((event) => normalizeTennisEvent(event, sportId));
  } catch {
    return [];
  }
}

async function getActiveTennisSportKeys(apiKey, sportId) {
  const cacheKey = `${sportId}-${apiKey.slice(0, 6)}`;
  if (tennisSportKeysCache.has(cacheKey)) return tennisSportKeysCache.get(cacheKey);

  const genericKey = SPORTS[sportId]?.sportKey;
  const prefix = sportId === "WTA" ? "tennis_wta" : "tennis_atp";

  try {
    const url = new URL("https://api.the-odds-api.com/v4/sports");
    url.searchParams.set("apiKey", apiKey);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Sports list unavailable");
    const sports = await response.json();
    const keys = (sports || [])
      .filter((item) => item.active !== false && String(item.key || "").startsWith(prefix))
      .map((item) => item.key);
    const activeKeys = keys.length ? keys : [genericKey].filter(Boolean);
    tennisSportKeysCache.set(cacheKey, activeKeys);
    return activeKeys;
  } catch {
    const fallback = [genericKey].filter(Boolean);
    tennisSportKeysCache.set(cacheKey, fallback);
    return fallback;
  }
}

function normalizeTennisEvent(event, sportId) {
  const players = [event.away_team, event.home_team].filter(Boolean);
  return {
    sport: sportId,
    id: event.id,
    away: event.away_team || players[0] || "Player A",
    awayId: normalizeKey(event.away_team || players[0] || "player-a"),
    awayAbbr: shortName(event.away_team || players[0] || "A"),
    home: event.home_team || players[1] || "Player B",
    homeId: normalizeKey(event.home_team || players[1] || "player-b"),
    homeAbbr: shortName(event.home_team || players[1] || "B"),
    awayScore: null,
    homeScore: null,
    venue: event.sport_title || "Tennis",
    status: "Scheduled",
    isFinal: false,
    isLive: false,
    isPostponed: false,
    commenceTime: event.commence_time,
    tournament: event.sport_title || "Tournament",
    surface: inferTennisSurface(event.sport_title || event.sport_key || ""),
    round: inferTennisRound(event.sport_title || ""),
    bestOf: sportId === "ATP" && /grand slam|wimbledon|french open|us open|australian open/i.test(event.sport_title || "") ? 5 : 3,
    gameTime: event.commence_time
      ? new Date(event.commence_time).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "TBD",
  };
}

function inferTennisSurface(text) {
  if (/french|roland|clay|monte carlo|madrid|rome/i.test(text)) return "clay";
  if (/wimbledon|grass|halle|queen/i.test(text)) return "grass";
  return "hard";
}

function inferTennisRound(text) {
  if (/final/i.test(text)) return "Final";
  if (/semi/i.test(text)) return "Semifinal";
  if (/quarter/i.test(text)) return "Quarterfinal";
  return "Main draw";
}

async function fetchLikelyHitters(teamId, teamAbbr) {
  if (!teamId) return [];

  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active`
    );
    if (!response.ok) throw new Error("Roster unavailable");

    const data = await response.json();
    return (data.roster || [])
      .filter((item) => {
        const code = item.position?.code;
        return code && code !== "1";
      })
      .slice(0, 12)
      .map((item) => ({
        id: item.person?.id,
        name: item.person?.fullName || "Player TBD",
        team: teamAbbr,
        position: item.position?.abbreviation || "H",
      }));
  } catch {
    return [];
  }
}

async function fetchInjuryIds(teamId) {
  if (!teamId) return new Set();
  if (injuryCache.has(teamId)) return injuryCache.get(teamId);

  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=injuredList`
    );
    if (!response.ok) throw new Error("Injury roster unavailable");

    const data = await response.json();
    const ids = new Set(
      (data.roster || [])
        .map((item) => item.person?.id)
        .filter((id) => Number.isFinite(Number(id)))
        .map((id) => String(id))
    );
    injuryCache.set(teamId, ids);
    return ids;
  } catch {
    const empty = new Set();
    injuryCache.set(teamId, empty);
    return empty;
  }
}

function injuryLabel(playerId, injuryIds, activeLabel) {
  if (!playerId) return "Missing";
  return injuryIds.has(String(playerId)) ? "Injured list" : activeLabel;
}

async function fetchWnbaRoster(teamId, teamAbbr) {
  if (!teamId) return [];
  if (wnbaRosterCache.has(teamId)) return wnbaRosterCache.get(teamId);

  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${teamId}/roster`
    );
    if (!response.ok) throw new Error("WNBA roster unavailable");

    const data = await response.json();
    const roster = (data.athletes || []).map((athlete) => ({
      id: athlete.id,
      name: athlete.displayName || athlete.fullName || "Player TBD",
      team: teamAbbr,
      position: athlete.position?.abbreviation || "G/F",
      injuryStatus:
        athlete.injuries?.length > 0
          ? athlete.injuries.map((injury) => injury.status || injury.type || "Injured").join(", ")
          : athlete.status?.name || "Active",
    }));

    wnbaRosterCache.set(teamId, roster);
    return roster;
  } catch {
    wnbaRosterCache.set(teamId, []);
    return [];
  }
}

async function fetchPlayerBio(playerId) {
  if (!playerId) return {};
  if (playerBioCache.has(playerId)) return playerBioCache.get(playerId);

  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}`);
    if (!response.ok) throw new Error("Player bio unavailable");
    const data = await response.json();
    const person = data.people?.[0] || {};
    const bio = {
      batSide: person.batSide?.code || "",
      pitchHand: person.pitchHand?.code || "",
    };
    playerBioCache.set(playerId, bio);
    return bio;
  } catch {
    const bio = {};
    playerBioCache.set(playerId, bio);
    return bio;
  }
}

async function fetchSportsbookProps(apiKey, sportKey, oddsMarket, appMarket, dateWindow = "next36", games = []) {
  const sportKeys =
    sportKey === "tennis_atp"
      ? await getActiveTennisSportKeys(apiKey, "ATP")
      : sportKey === "tennis_wta"
      ? await getActiveTennisSportKeys(apiKey, "WTA")
      : [sportKey];
  const eventSets = await Promise.all(
    sportKeys.map(async (key) => {
      const eventsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${key}/events`);
      eventsUrl.searchParams.set("apiKey", apiKey);
      const eventsResponse = await fetch(eventsUrl);
      if (!eventsResponse.ok) {
        if ([401, 403, 422].includes(eventsResponse.status)) {
          throw new Error("The Odds API rejected the key or sport request.");
        }
        return [];
      }
      const events = await eventsResponse.json();
      return (events || []).map((event) => ({ ...event, sport_key: key }));
    })
  );

  const events = eventSets.flat();
  if (!events.length) return [];
  const candidateEvents = (events || []).filter((event) => {
    return event.commence_time && isInSelectedEventWindow(event.commence_time, dateWindow);
  });
  const matchedEvents = candidateEvents.filter((event) => matchesLoadedGame(event, games));
  const openEvents = matchedEvents.length ? matchedEvents : candidateEvents;
  const requestedMarkets = marketsForOddsRequest(oddsMarket, appMarket);

  const eventLines = await Promise.all(
    openEvents.map((event) => fetchSportsbookEventLines(apiKey, event.sport_key || sportKey, event.id, requestedMarkets, appMarket, event))
  );

  return eventLines.flat();
}

function matchesLoadedGame(event, games = []) {
  if (!games.length) return true;

  return games.some((game) => eventMatchesLoadedGame(event, game));
}

function eventMatchesLoadedGame(event, game) {
  if (String(event.id) === String(game.id)) return true;

  const eventStart = new Date(event.commence_time).getTime();
  const gameStart = new Date(game.commenceTime).getTime();
  const startTimesAreClose =
    !Number.isFinite(eventStart) ||
    !Number.isFinite(gameStart) ||
    Math.abs(eventStart - gameStart) <= 8 * 60 * 60 * 1000;

  if (!startTimesAreClose) return false;

  const eventAway = event.away_team || event.away;
  const eventHome = event.home_team || event.home;
  const directMatch =
    teamNameMatches(eventAway, game.away, game.awayAbbr) &&
    teamNameMatches(eventHome, game.home, game.homeAbbr);
  const reversedMatch =
    teamNameMatches(eventAway, game.home, game.homeAbbr) &&
    teamNameMatches(eventHome, game.away, game.awayAbbr);

  return directMatch || reversedMatch;
}

function teamNameMatches(value, fullName, abbreviation) {
  const eventKey = normalizeTeamForMatch(value);
  const fullKey = normalizeTeamForMatch(fullName);
  const abbrKey = normalizeTeamForMatch(abbreviation);

  if (!eventKey) return false;
  return (
    eventKey === fullKey ||
    eventKey === abbrKey ||
    (fullKey && (eventKey.includes(fullKey) || fullKey.includes(eventKey)))
  );
}

function normalizeTeamForMatch(value) {
  return normalizeKey(String(value || "").replace(/\b(the|fc|sc|club)\b/gi, ""));
}

function marketsForOddsRequest(oddsMarket, appMarket) {
  const markets = Array.isArray(oddsMarket) ? oddsMarket : [oddsMarket].filter(Boolean);
  if (["Total Games", "Player Games Won", "Aces", "Double Faults", "Breaks of Serve"].includes(appMarket)) {
    return Array.from(new Set(["h2h", ...markets])).filter(Boolean);
  }
  return markets;
}

async function fetchSportsbookEventLines(apiKey, sportKey, eventId, oddsMarkets, appMarket, eventInfo = null) {
  const propMarkets = oddsMarkets.filter((market) => market && market !== "h2h");
  if (propMarkets.length > 1) {
    const perMarket = await Promise.all(
      propMarkets.map((market) =>
        fetchSportsbookEventLines(apiKey, sportKey, eventId, ["h2h", market], appMarket, eventInfo)
      )
    );
    return perMarket.flat();
  }

  const oddsUrl = new URL(
    `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds`
  );
  oddsUrl.searchParams.set("apiKey", apiKey);
  oddsUrl.searchParams.set("regions", "us");
  oddsUrl.searchParams.set("markets", oddsMarkets.join(","));
  oddsUrl.searchParams.set("oddsFormat", "american");

  const response = await fetch(oddsUrl);
  if (!response.ok) return [];

  const eventOdds = await response.json();
  const moneyline = extractMoneylineByBook(eventOdds.bookmakers || []);

  return (eventOdds.bookmakers || []).flatMap((book) => {
    const bookName = book.title || book.key;
    return (book.markets || [])
      .filter((market) => market.key !== "h2h")
      .flatMap((market) =>
        normalizeSportsbookOutcomes(
          market.outcomes || [],
          appMarket,
          bookName,
          book.key,
          eventInfo || eventOdds,
          market.key,
          moneyline[book.key] || moneyline[bookName] || null
        )
      );
  });
}

function extractMoneylineByBook(bookmakers) {
  return bookmakers.reduce((all, book) => {
    const h2h = (book.markets || []).find((market) => market.key === "h2h");
    if (!h2h) return all;
    const prices = {};
    (h2h.outcomes || []).forEach((outcome) => {
      if (outcome.name && Number.isFinite(Number(outcome.price))) {
        prices[outcome.name] = Number(outcome.price);
      }
    });
    all[book.key] = prices;
    all[book.title || book.key] = prices;
    return all;
  }, {});
}

function normalizeSportsbookOutcomes(outcomes, appMarket, book, bookKey, eventInfo = {}, oddsMarketKey = "", moneylineOdds = null) {
  const byPlayerLine = new Map();
  const matchupName = `${eventInfo.away_team || eventInfo.away || "Player A"} vs ${eventInfo.home_team || eventInfo.home || "Player B"}`;

  outcomes.forEach((outcome) => {
    const player = appMarket === "Total Games" ? matchupName : outcome.description || outcome.name;
    const line = Number(outcome.point);
    const side = String(outcome.name || "").toLowerCase();

    if (!player || !Number.isFinite(line) || !["over", "under"].includes(side)) return;

    const key = `${bookKey}-${normalizeKey(player)}-${line}`;
    const existing = byPlayerLine.get(key) || {
      player,
      market: appMarket,
      line,
      book,
      bookKey,
      eventId: eventInfo.id,
      commenceTime: eventInfo.commence_time || eventInfo.commenceTime,
      away: eventInfo.away_team || eventInfo.away,
      home: eventInfo.home_team || eventInfo.home,
      oddsMarketKey,
      moneylineOdds,
      odds: {},
    };

    existing.odds[side] = outcome.price;
    byPlayerLine.set(key, existing);
  });

  return Array.from(byPlayerLine.values());
}

function attachMarketConsensus(lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const groups = new Map();

  safeLines.forEach((line) => {
    const key = `${normalizeKey(line.player)}-${line.market || ""}`;
    const group = groups.get(key) || [];
    group.push(line);
    groups.set(key, group);
  });

  return safeLines.map((line) => {
    const group = groups.get(`${normalizeKey(line.player)}-${line.market || ""}`) || [line];
    const linesOnly = group.map((item) => item.line).filter(Number.isFinite);
    const overPrices = group.map((item) => item.odds?.over).filter((value) => Number.isFinite(Number(value))).map(Number);
    const underPrices = group.map((item) => item.odds?.under).filter((value) => Number.isFinite(Number(value))).map(Number);
    const books = Array.from(new Set(group.map((item) => item.book).filter(Boolean)));

    return {
      ...line,
      consensus: {
        bookCount: books.length,
        books,
        avgLine: average(linesOnly),
        bestOverLine: Math.min(...linesOnly),
        bestUnderLine: Math.max(...linesOnly),
        avgOverImplied: average(overPrices.map(americanToImpliedProbability)),
        avgUnderImplied: average(underPrices.map(americanToImpliedProbability)),
      },
    };
  });
}


const PROP_REALISTIC_RANGES = {
  "MLB:Pitches Thrown": [40, 130],
  "MLB:Strikeouts": [0, 15],
  "MLB:Hits+Runs+RBIs": [0, 8],
  "MLB:Total Bases": [0, 8],
  "MLB:Hits": [0, 5],
  "WNBA:Points": [0, 60],
  "WNBA:Rebounds": [0, 25],
  "WNBA:Assists": [0, 20],
  "NBA:Points": [0, 60],
  "NBA:Rebounds": [0, 25],
  "NBA:Assists": [0, 20],
  "NFL:Passing Yards": [50, 450],
  "NFL:Receiving Yards": [0, 200],
  "NFL:Rushing Yards": [0, 200],
  "ATP:Player Games Won": [0, 30],
  "WTA:Player Games Won": [0, 30],
  "ATP:Total Games": [12, 65],
  "WTA:Total Games": [12, 45],
  "ATP:Fantasy Score": [0, 80],
  "WTA:Fantasy Score": [0, 80],
};

function propRangeKey(market) {
  return `${market?.sport || ""}:${market?.id || ""}`;
}

function expectedProjectionRange(market) {
  return PROP_REALISTIC_RANGES[propRangeKey(market)] || null;
}

function logFilteredProp(line, market, projection, reason) {
  const payload = {
    player: line?.player || "Missing player",
    propType: market?.id || line?.market || "Missing prop type",
    line: line?.line,
    projection,
    reason,
  };
  console.warn("Filtered invalid prop", payload);
}

function validatePropLineInput(line, market) {
  if (!line?.player) return "missing player name";
  if (!market?.id && !line?.market) return "missing prop type";
  if (!Number.isFinite(Number(line.line))) return "missing or invalid line";
  if (line.commenceTime && new Date(line.commenceTime).getTime() <= Date.now()) return "stale game time";
  return null;
}

function validateProjectionForMarket(line, market, projection, context) {
  const projectedMean = Number(projection?.projectedMean);
  if (!Number.isFinite(projectedMean)) return "missing projection or NaN projection";
  if (projectedMean === 0 && !allowsZeroProjection(market)) return "projection is zero for a non-zero stat market";

  const range = expectedProjectionRange(market);
  if (range && (projectedMean < range[0] || projectedMean > range[1])) {
    return `projection ${roundTo(projectedMean, 2)} outside realistic ${market.sport} ${market.id} range ${range[0]}-${range[1]}`;
  }

  const gameTime = context?.game?.commenceTime || line?.commenceTime;
  if (gameTime && new Date(gameTime).getTime() <= Date.now()) return "stale game time";
  return null;
}

function allowsZeroProjection(market) {
  return ["Strikeouts", "Hits", "Hits+Runs+RBIs", "Total Bases", "Points", "Rebounds", "Assists", "Receiving Yards", "Rushing Yards", "Tennis Games Won"].includes(market?.id);
}

function statMappedProjection(line, market, context, profile) {
  if (market.id === "Pitches Thrown") {
    const recentPitchCount = Number.isFinite(profile.pitchCountAvg) ? profile.pitchCountAvg : profile.seasonAvg;
    const restBoost = Number.isFinite(profile.restDays) ? clamp((profile.restDays - 4) * 1.2, -5, 7) : 0;
    const starterBoost = context.role === "Probable starter" ? 2 : -12;
    return clamp(recentPitchCount + restBoost + starterBoost, 40, 130);
  }

  if (market.id === "Fantasy Score" && market.sport === "MLB") {
    return clamp(profile.last5Avg * 0.45 + profile.last10Avg * 0.35 + profile.seasonAvg * 0.2, 0, 65);
  }

  if (market.id === "Hits+Runs+RBIs" || market.id === "Total Bases" || market.id === "Hits") {
    const lineupBoost = Number.isFinite(context.lineupIndex) ? clamp((5 - context.lineupIndex) * 0.04, -0.12, 0.18) : 0;
    const weatherBoost = context.weatherRating || 0;
    const base = profile.last5Avg * 0.38 + profile.last10Avg * 0.34 + profile.seasonAvg * 0.24 + lineupBoost + weatherBoost;
    return Math.max(0, base);
  }

  return null;
}

async function evaluatePropLines(games, lines, market, options = {}) {
  const { positiveOnly = true } = options;
  const contexts = await buildPlayerContexts(Array.isArray(games) ? games : [], market);
  const enrichedLines = attachMarketConsensus(lines);
  const evaluated = await Promise.all(
    enrichedLines.map((line) => evaluatePropLine(line, market, contexts))
  );
  saveSharpPredictionDatabase(evaluated.filter(Boolean));

  const bestPicks = keepBestSportsbookPerPlayer(evaluated.filter(Boolean));
  const validPicks = bestPicks.filter((pick) => {
    if (pick.invalidData) {
      logFilteredProp({ player: pick.player, line: pick.line, market: pick.prop }, market, pick.season_avg, pick.invalidReason || "invalid data");
      return false;
    }
    return true;
  });
  return positiveOnly ? validPicks.filter((pick) => pick.isNoBet || pick.ev > 0) : validPicks;
}

async function buildNoBetBoard(games, market, reason) {
  const contexts = await buildPlayerContexts(games, market);
  const playerContexts = contexts.filter(
    (context) => context.player && context.player !== "TBD"
  );

  const rows = await Promise.all(
    playerContexts.map(async (context) => {
      const profile = context.id ? await fetchPlayerStatProfile(context.id, market) : null;
      return makeNoBetLine(
        {
          player: context.player,
          market: market.id,
          line: null,
          book: "No line loaded",
          odds: {},
        },
        market,
        reason,
        context,
        profile
      );
    })
  );

  return rows;
}

async function buildPlayerContexts(games, market) {
  if (market.group === "tennis") {
    return games.flatMap((game) => {
      const matchContext = buildTennisContext(game, `${game.away} vs ${game.home}`, game.away, game.home, "Match total");
      return [
        matchContext,
        buildTennisContext(game, game.away, game.away, game.home, "Player side"),
        buildTennisContext(game, game.home, game.home, game.away, "Player side"),
      ];
    });
  }

  if (market.group === "basketball") {
    const contexts = [];

    for (const game of games) {
      const awayRoster = await fetchWnbaRoster(game.awayId, game.awayAbbr);
      const homeRoster = await fetchWnbaRoster(game.homeId, game.homeAbbr);
      const awayContext = getWnbaTeamContext(game.awayAbbr);
      const homeContext = getWnbaTeamContext(game.homeAbbr);

      awayRoster.forEach((player) => {
        contexts.push({
          id: player.id,
          player: player.name,
          team: game.awayAbbr,
          opponent: game.homeAbbr,
          opponentName: game.home,
          game,
          role: `${player.position} · active roster`,
          injuryStatus: player.injuryStatus,
          paceRating: (awayContext.pace + homeContext.pace) / 2,
          defensiveRating: homeContext.defense,
          restStatus: gameRestLabel(game.gameTime),
        });
      });

      homeRoster.forEach((player) => {
        contexts.push({
          id: player.id,
          player: player.name,
          team: game.homeAbbr,
          opponent: game.awayAbbr,
          opponentName: game.away,
          game,
          role: `${player.position} · active roster`,
          injuryStatus: player.injuryStatus,
          paceRating: (awayContext.pace + homeContext.pace) / 2,
          defensiveRating: awayContext.defense,
          restStatus: gameRestLabel(game.gameTime),
        });
      });
    }

    return contexts;
  }

  if (market.group === "pitching") {
    const contexts = [];

    for (const game of games) {
      const awayInjuries = await fetchInjuryIds(game.awayId);
      const homeInjuries = await fetchInjuryIds(game.homeId);
      const gameContext = await fetchMlbLiveContext(game.id);

      contexts.push(
        {
          id: game.awayPitcherId,
          player: game.awayPitcher,
          team: game.awayAbbr,
          opponent: game.homeAbbr,
          opponentName: game.home,
          game,
          role: "Probable starter",
          injuryStatus: injuryLabel(game.awayPitcherId, awayInjuries, "Active/probable"),
          pitchHand: gameContext.awayPitchHand,
          weather: gameContext.weather,
          weatherRating: gameContext.weatherRating || 0,
          umpire: gameContext.umpire,
          umpireRating: gameContext.umpireRating || 0,
        },
        {
          id: game.homePitcherId,
          player: game.homePitcher,
          team: game.homeAbbr,
          opponent: game.awayAbbr,
          opponentName: game.away,
          game,
          role: "Probable starter",
          injuryStatus: injuryLabel(game.homePitcherId, homeInjuries, "Active/probable"),
          pitchHand: gameContext.homePitchHand,
          weather: gameContext.weather,
          weatherRating: gameContext.weatherRating || 0,
          umpire: gameContext.umpire,
          umpireRating: gameContext.umpireRating || 0,
        }
      );
    }

    return contexts;
  }

  const contexts = [];

  for (const game of games) {
    const awayHitters = await fetchLikelyHitters(game.awayId, game.awayAbbr);
    const homeHitters = await fetchLikelyHitters(game.homeId, game.homeAbbr);
    const awayInjuries = await fetchInjuryIds(game.awayId);
    const homeInjuries = await fetchInjuryIds(game.homeId);
    const gameContext = await fetchMlbLiveContext(game.id);

    for (const [index, player] of awayHitters.entries()) {
      const bio = await fetchPlayerBio(player.id);
      contexts.push({
        id: player.id,
        player: player.name,
        team: game.awayAbbr,
        opponent: game.homeAbbr,
        opponentName: game.home,
        game,
        lineupIndex: index,
        role: index <= 5 ? "Likely regular" : "Active roster",
        injuryStatus: injuryLabel(player.id, awayInjuries, "Active roster"),
        batSide: bio.batSide,
        opponentPitchHand: gameContext.homePitchHand,
        weather: gameContext.weather,
        weatherRating: gameContext.weatherRating || 0,
        umpire: gameContext.umpire,
        umpireRating: gameContext.umpireRating || 0,
      });
    }

    for (const [index, player] of homeHitters.entries()) {
      const bio = await fetchPlayerBio(player.id);
      contexts.push({
        id: player.id,
        player: player.name,
        team: game.homeAbbr,
        opponent: game.awayAbbr,
        opponentName: game.away,
        game,
        lineupIndex: index,
        role: index <= 5 ? "Likely regular" : "Active roster",
        injuryStatus: injuryLabel(player.id, homeInjuries, "Active roster"),
        batSide: bio.batSide,
        opponentPitchHand: gameContext.awayPitchHand,
        weather: gameContext.weather,
        weatherRating: gameContext.weatherRating || 0,
        umpire: gameContext.umpire,
        umpireRating: gameContext.umpireRating || 0,
      });
    }
  }

  return contexts;
}

async function evaluatePropLine(line, market, contexts) {
  const inputError = validatePropLineInput(line, market);
  if (inputError) {
    logFilteredProp(line, market, null, inputError);
    return null;
  }

  const context = findPlayerContext(contexts, line.player);
  if (!context) {
    return makeNoBetLine(line, market, `Player was not found on today's active ${market.sport} board.`);
  }

  const profile =
    market.group === "tennis"
      ? buildTennisStatProfile(context, market, line)
      : context.id
      ? await fetchPlayerStatProfile(context.id, market)
      : null;
  if (!profile || profile.games < 5) {
    const sourceLabel = SPORTS[market.sport]?.sourceLabel || "stat source";
    return makeNoBetLine(line, market, `Missing last-game/season sample from ${sourceLabel}.`, context);
  }

  const precheckProjection = buildProjection(line, market, context, profile);
  const projectionError = validateProjectionForMarket(line, market, precheckProjection, context);
  if (projectionError) {
    logFilteredProp(line, market, precheckProjection?.projectedMean, projectionError);
    return null;
  }

  const sideCandidates = ["Over", "Under"]
    .map((side) => evaluateSide(line, market, context, profile, side))
    .filter(Boolean);

  if (sideCandidates.length === 0) {
    return makeNoBetLine(line, market, "Missing usable American odds or odds are outside model limits.", context, profile);
  }

  const best = sideCandidates.sort((a, b) => b.rankScore - a.rankScore)[0];
  const recommendation = buildRecommendation(best, profile);
  const isPass = recommendation.label === "Pass";
  const warning = isPass ? `PASS: ${recommendation.reasons.join(" ")}` : "";

  trackLineSnapshot(line, best.pick);
  trackEvaluatedPick(line, best.pick, context, market);
  const lineMovementValue = getLineMoveValue(line, best.pick);
  const clvValue = getClosingLineValue(line, best.pick);
  const historicalOdds = buildHistoricalOddsComparison(line, best.pick);

  const pick = {
    id: `${context.id}-${market.id}-${line.line}-${best.pick}-${line.book}`,
    sport: market.sport,
    playerId: context.id,
    gameId: context.game.id,
    group: market.group,
    player: context.player,
    team: context.team,
    opponent: context.opponent,
    prop: market.id,
    line: line.line,
    odds: best.odds,
    book: line.book,
    bestSportsbook: line.book,
    pick: best.pick,
    confidence: best.confidence,
    season_avg: roundTo(best.projectedMean, 1),
    last5Avg: roundTo(profile.last5Avg, 1),
    last10Avg: roundTo(profile.last10Avg, 1),
    hit_rate_pct: Math.round(best.modelProbability * 100),
    impliedProbability: Math.round(best.impliedProbability * 100),
    edgePct: Math.round(best.edge * 100),
    ev: best.ev,
    evPct: Math.round(best.ev * 100),
    consensusScore: best.consensusScore,
    rankScore: best.rankScore + Math.max(0, lineMovementValue) * 10,
    confidenceTier: recommendation.tier,
    recommendation: recommendation.label,
    recommendationText: recommendation.text,
    suggestedUnits: recommendation.units,
    sportsbookValue: best.sportsbookValue,
    marketAverageLine: roundTo(line.consensus?.avgLine || line.line, 2),
    marketBookCount: line.consensus?.bookCount || 1,
    marketBooks: line.consensus?.books || [line.book],
    bestBookReason: best.bestBookReason,
    mathExplanation: buildMathExplanation(best, market, context, profile, line),
    aiExplanation: buildPostModelExplanation(best, market, context, profile, line),
    contextFilters: getContextFilterSummary(market, context, profile),
    trendAnalysis: buildTrendAnalysis(market, context, profile),
    usageAnalysis: buildUsageAnalysis(market, context, profile),
    projectedDiff: roundTo(best.projectedMean - line.line, 2),
    signedStatEdge: roundTo(best.pick === "Under" ? line.line - best.projectedMean : best.projectedMean - line.line, 2),
    volatility: best.volatility,
    consistencyScore: best.consistencyScore,
    lineMoveValue: lineMovementValue,
    historicalOdds,
    last5: profile.last5,
    pitcher_faced:
      market.group === "hitting"
        ? opponentPitcherName(context.game, context.team)
        : context.opponentName,
    edge_score: best.confidence + best.edge * 100,
    risk: best.risk,
    bankroll: recommendation.bankrollLabel,
    bankrollPct: recommendation.bankrollPct,
    isNoBet: isPass,
    noBetWarning: warning,
    reason: buildReason(best, market, context, profile, line),
    key_edge: warning || `${recommendation.text}. ${line.book} offers the best available ${best.pick} price for this line.`,
    lineMovement: getLineMovement(line, best.pick),
    clv: clvValue,
    result: getStoredResult(line, best.pick),
    injuryStatus: context.injuryStatus,
    usage: formatUsage(market, context, profile),
    rawProbability: Math.round(best.rawModelProbability * 100),
    displayProbability: Math.round(best.modelProbability * 100),
    realityFlags: best.realityFlags,
    marketMovement: best.marketMovement,
    clvScore: best.clvScore,
    trustScore: best.trustScore,
    simulation: best.simulation,
    sportsbookTable: buildSportsbookComparison(line, best.pick),
  };

  return addStableScoreToPick(pick, market, context, profile, line, best);
}

function evaluateSide(line, market, context, profile, side) {
  const odds = getSideOdds(line, side);
  if (odds == null) return null;
  if (isExtremeOdds(odds)) return null;

  const impliedProbability = americanToImpliedProbability(odds);
  const projection = buildProjection(line, market, context, profile);
  const projectionError = validateProjectionForMarket(line, market, projection, context);
  if (projectionError) {
    logFilteredProp(line, market, projection?.projectedMean, projectionError);
    return null;
  }
  const modelOverProbability = estimateModelProbability(
    projection.projectedMean,
    line.line,
    profile.stdDev,
    market
  );
  const empiricalOverProbability = hitRateAgainstLine(profile.last10, line.line, "Over");
  const modelOverBlend = blendProbabilities(
    modelOverProbability,
    empiricalOverProbability,
    profile.games
  );
  const blendedProbability = side === "Over" ? modelOverBlend : 1 - modelOverBlend;
  const rawFinalProbability = calibrateProbability(
    blendedProbability,
    projection,
    profile,
    market,
    side,
    line.line
  );
  const finalProbability = calibrateDisplayedProbability(rawFinalProbability, profile, market, line);
  const impliedNoVig = noVigImpliedProbability(line, side, impliedProbability);
  const edge = finalProbability - impliedNoVig;
  const ev = normalizedExpectedValue(finalProbability, odds, line, side);
  const sportsbookValue = getSportsbookValue(line, side, odds);
  const consistencyScore = getConsistencyScore(profile, line.line);
  const marketMovement = getMarketMovementSignal(line, side);
  const clvScore = getHistoricalClvTrust(line.market || market.id, market.sport);
  const trustScore = getModelTrustScore(market.sport, market.id);
  const realityFlags = getRealityFlags({
    rawProbability: rawFinalProbability,
    probability: finalProbability,
    ev,
    edge,
    impliedProbability: impliedNoVig,
    consensusScore: getConsensusScore(line, side, finalProbability, impliedNoVig),
    marketMovement,
  });
  const simulation = runMonteCarloSimulation(projection.projectedMean, profile.stdDev, line.line, side, `${line.player}-${market.id}-${side}`);
  const confidence = computeBetConfidence(
    scoreConfidence(edge, finalProbability, projection, profile, line.line, consistencyScore, sportsbookValue),
    finalProbability,
    profile,
    realityFlags,
    marketMovement,
    trustScore,
    clvScore
  );
  const risk = classifyRisk(profile, market, line, side, realityFlags, marketMovement);
  const consensusScore = getConsensusScore(line, side, finalProbability, impliedNoVig);
  const lineMoveValue = getLineMoveValue(line, side);
  const rankScore = scorePickRank({
    ev,
    edge,
    confidence,
    consistencyScore,
    sportsbookValue,
    consensusScore,
    volatility: projection.volatility,
    projectedDiff: projection.projectedMean - line.line,
    lineMoveValue,
    marketMovement: marketMovement.score,
    trustScore,
    clvScore,
  });

  return {
    pick: side,
    odds,
    impliedProbability: impliedNoVig,
    modelProbability: finalProbability,
    rawModelProbability: rawFinalProbability,
    projectedMean: projection.projectedMean,
    edge,
    ev,
    confidence,
    risk,
    factors: projection.factors,
    sportsbookValue,
    consensusScore,
    consistencyScore,
    volatility: projection.volatility,
    rankScore,
    bestBookReason: getBestBookReason(line, side, sportsbookValue),
    safetyReasons: market.group === "tennis" ? getTennisSafetyReasons(profile, line, side, edge, confidence, finalProbability) : [],
    realityFlags,
    marketMovement,
    clvScore,
    trustScore,
    simulation,
    kellyStakePct: calculateKellyStake(finalProbability, odds, profile, risk),
  };
}

function getSideOdds(line, side) {
  const sideKey = side.toLowerCase();
  const listedOdds = line.odds?.[sideKey];
  if (listedOdds != null) return listedOdds;
  return line.odds ? null : DEFAULT_PASTED_ODDS;
}

function buildProjection(line, market, context, profile) {
  if (market.group === "tennis") {
    return buildTennisProjection(line, market, context, profile);
  }

  const mappedProjection = statMappedProjection(line, market, context, profile);
  const recentWeightedAvg = weightedRecentAverage(profile.last10);
  if (Number.isFinite(mappedProjection)) {
    return {
      projectedMean: mappedProjection,
      volatility: getVolatilityRatio(profile, line.line),
      factors: {
        recentWeightedAvg,
        trendAdjustment: clamp((profile.last5Avg - profile.last10Avg) * 0.25, -1.5, 1.5),
        matchupAdjustment: getMatchupAdjustment(market, context),
        usageAdjustment: getUsageAdjustment(market, context, profile),
        volatilityDrag: getVolatilityDrag(market, profile, line.line),
        statMapping: `${market.id} mapped to its own stat profile`,
      },
    };
  }

  const trendAdjustment = clamp((profile.last5Avg - profile.last10Avg) * 0.25, -1.5, 1.5);
  const matchupAdjustment = getMatchupAdjustment(market, context);
  const usageAdjustment = getUsageAdjustment(market, context, profile);
  const volatilityDrag = getVolatilityDrag(market, profile, line.line);
  const contextAdjustment = matchupAdjustment + usageAdjustment + trendAdjustment + volatilityDrag;
  const projectedMean =
    profile.last5Avg * 0.45 +
    profile.last10Avg * 0.3 +
    profile.seasonAvg * 0.15 +
    recentWeightedAvg * 0.0 +
    contextAdjustment * 0.1;

  return {
    projectedMean: Math.max(0, projectedMean),
    volatility: getVolatilityRatio(profile, line.line),
    factors: {
      recentWeightedAvg,
      trendAdjustment,
      matchupAdjustment,
      usageAdjustment,
      volatilityDrag,
    },
  };
}

function buildTennisContext(game, player, playerName, opponentName, role) {
  const profile = buildTennisComponentProfile(playerName, opponentName, game);
  return {
    id: normalizeKey(player),
    player,
    team: shortName(playerName),
    opponent: shortName(opponentName),
    opponentName,
    game,
    role,
    injuryStatus: profile.injuryRisk >= 0.18 ? "Elevated retirement risk" : "No hard injury flag",
    tennisProfile: profile,
  };
}

function buildTennisComponentProfile(playerName, opponentName, game) {
  const playerRating = tennisRating(playerName, game.sport);
  const opponentRating = tennisRating(opponentName, game.sport);
  const ranking = tennisRankingFromRating(playerRating);
  const opponentRanking = tennisRankingFromRating(opponentRating);
  const ratingDiff = playerRating - opponentRating;
  const surface = game.surface || "hard";
  const surfaceServeBoost = surface === "grass" ? 0.05 : surface === "clay" ? -0.04 : 0.01;
  const genderServeBase = game.sport === "WTA" ? 0.64 : 0.76;
  const holdPct = clamp(genderServeBase + playerRating * 0.12 + surfaceServeBoost, 0.52, 0.9);
  const opponentHoldPct = clamp(genderServeBase + opponentRating * 0.12 + surfaceServeBoost, 0.52, 0.9);
  const breakPct = clamp(1 - opponentHoldPct + playerRating * 0.05, 0.08, 0.42);
  const returnPointsWon = clamp(0.34 + playerRating * 0.08 - opponentRating * 0.04, 0.27, 0.48);
  const closeMatch = 1 - clamp(Math.abs(ranking - opponentRanking) / 120, 0, 1);
  const h2hClose = tennisSeededNumber(`${playerName}-${opponentName}-h2h`, 0.35, 0.82);
  const recent5 = tennisSeededNumber(`${playerName}-last5`, 0.35, 0.78);
  const recent10 = tennisSeededNumber(`${playerName}-last10`, 0.38, 0.72);
  const fatigue = tennisSeededNumber(`${playerName}-${game.id}-fatigue`, 0.02, 0.24);
  const injuryRisk = tennisSeededNumber(`${playerName}-injury`, 0.03, 0.22);
  const winProbability = clamp(0.5 + ratingDiff * 0.38 + (recent5 - 0.55) * 0.12 - fatigue * 0.1 - injuryRisk * 0.08, 0.18, 0.82);
  const expectedSets = game.bestOf === 5
    ? 3.15 + closeMatch * 0.95 + h2hClose * 0.35
    : 2.02 + closeMatch * 0.44 + h2hClose * 0.18;
  const tiebreakRate = clamp((holdPct + opponentHoldPct - 1.25) * 0.45 + (surface === "grass" ? 0.08 : 0), 0.04, 0.32);
  const gamesPerSet =
    8.7 +
    (holdPct + opponentHoldPct - 1.35) * 3.1 +
    closeMatch * 0.65 +
    h2hClose * 0.35 +
    tiebreakRate * 1.8 -
    injuryRisk * 1.2;
  const totalGames = expectedSets * gamesPerSet;
  const gamesWon = totalGames * (0.5 + (winProbability - 0.5) * 0.32);
  const aces = expectedSets * (game.sport === "WTA" ? 2.1 : 4.7) * (0.78 + holdPct * 0.45 + (surface === "grass" ? 0.15 : 0));
  const doubleFaults = expectedSets * (game.sport === "WTA" ? 2.4 : 1.7) * (1.08 - playerRating * 0.24 + fatigue * 0.25);
  const breaksOfServe = expectedSets * breakPct * 1.55;
  const fantasyScore =
    winProbability * TENNIS_FANTASY_SCORING.winBonus +
    expectedSets * TENNIS_FANTASY_SCORING.setBonus +
    gamesWon * TENNIS_FANTASY_SCORING.gamesWon +
    aces * TENNIS_FANTASY_SCORING.ace +
    breaksOfServe * TENNIS_FANTASY_SCORING.breakOfServe +
    doubleFaults * TENNIS_FANTASY_SCORING.doubleFault;

  return {
    playerRating,
    opponentRating,
    ranking,
    opponentRanking,
    rankingDiff: opponentRanking - ranking,
    winProbability,
    totalGames,
    expectedSets,
    gamesPerSet,
    gamesWon,
    aces,
    doubleFaults,
    breaksOfServe,
    holdPct,
    opponentHoldPct,
    breakPct,
    returnPointsWon,
    surface,
    surfaceAdjustment: surfaceServeBoost,
    recent5,
    recent10,
    opponentStrength: opponentRating,
    h2hClose,
    fatigue,
    injuryRisk,
    tournamentRound: game.round,
    bestOf: game.bestOf,
    tiebreakRate,
  };
}

function tennisRating(name, sportId) {
  const base = tennisSeededNumber(`${sportId}-${name}-rating`, 0.28, 0.92);
  return clamp(base, 0.2, 0.95);
}

function tennisRankingFromRating(rating) {
  return Math.round(1 + (1 - rating) * 180);
}

function tennisSeededNumber(seed, min, max) {
  const hash = normalizeKey(seed).split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 100000, 7);
  return min + (hash / 100000) * (max - min);
}

function buildTennisStatProfile(context, market, line) {
  const baseComponents = context.tennisProfile || buildTennisComponentProfile(context.player, context.opponentName, context.game);
  const marketWinProbability = tennisMarketWinProbability(context, line);
  const components = marketWinProbability
    ? {
        ...baseComponents,
        winProbability: baseComponents.winProbability * 0.62 + marketWinProbability * 0.38,
      }
    : baseComponents;
  const value = tennisProjectionValueForMarket(market.id, components);
  const volatility = tennisVolatilityForMarket(market.id, components);
  const last5 = tennisSyntheticRecent(value, volatility, `${context.player}-${market.id}-5`, 5);
  const last10 = tennisSyntheticRecent(value, volatility, `${context.player}-${market.id}-10`, 10);

  return {
    games: 20,
    last5,
    last5Avg: average(last5),
    last10,
    last10Avg: average(last10),
    seasonAvg: value,
    stdDev: volatility,
    sampleScore: 18,
    tennis: components,
    roleChange: components.recent5 > components.recent10 + 0.08 ? "form up" : components.recent5 < components.recent10 - 0.08 ? "form down" : "stable form",
  };
}

function tennisProjectionValueForMarket(marketId, components) {
  if (marketId === "Total Games") return components.totalGames;
  if (marketId === "Player Games Won") return components.gamesWon;
  if (marketId === "Aces") return components.aces;
  if (marketId === "Double Faults") return components.doubleFaults;
  if (marketId === "Breaks of Serve") return components.breaksOfServe;
  if (marketId === "Fantasy Score") return components.fantasyScore;
  return components.totalGames;
}

function tennisMarketWinProbability(context, line) {
  const prices = line.moneylineOdds || {};
  const playerName = context.player;
  const price =
    prices[playerName] ??
    Object.entries(prices).find(([name]) => normalizeKey(name) === normalizeKey(playerName))?.[1];
  if (!Number.isFinite(Number(price))) return null;
  return americanToImpliedProbability(price);
}

function tennisVolatilityForMarket(marketId, components) {
  const closeBoost = 1 + (1 - Math.abs(components.winProbability - 0.5)) * 0.4;
  if (marketId === "Total Games") return 2.6 * closeBoost + components.injuryRisk * 4;
  if (marketId === "Player Games Won") return 1.8 * closeBoost + components.injuryRisk * 3;
  if (marketId === "Aces") return 1.5 + components.tiebreakRate * 2.5;
  if (marketId === "Double Faults") return 1.05 + components.fatigue * 2.4;
  if (marketId === "Breaks of Serve") return 0.85 + components.breakPct;
  return 3.5;
}

function tennisSyntheticRecent(mean, volatility, seed, count) {
  return Array.from({ length: count }, (_, index) => {
    const drift = tennisSeededNumber(`${seed}-${index}`, -1, 1) * volatility * 0.55;
    return Math.max(0, roundTo(mean + drift, 1));
  });
}

function buildTennisProjection(line, market, context, profile) {
  const components = profile.tennis;
  const projectedMean = tennisProjectionValueForMarket(market.id, components);
  const favoriteGap = Math.abs(components.winProbability - 0.5);
  const volatility = profile.stdDev / Math.max(1, projectedMean);

  return {
    projectedMean,
    volatility,
    factors: {
      recentWeightedAvg: weightedRecentAverage(profile.last10),
      trendAdjustment: (components.recent5 - components.recent10) * 3,
      matchupAdjustment: (components.holdPct + components.opponentHoldPct - 1.4) * 4 + components.h2hClose,
      usageAdjustment: components.winProbability * 2 + components.breakPct,
      volatilityDrag: -components.injuryRisk * 2 - components.fatigue,
      favoriteGap,
    },
  };
}

function weightedRecentAverage(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  const weights = values.map((_, index) => index + 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

function getUsageAdjustment(market, context, profile) {
  if (market.group === "basketball") {
    const minutes = profile.minutesAvg || 0;
    const lowVolumeMarket = ["Turnovers", "3PM", "Steals", "Blocks"].includes(market.id);
    const scale = lowVolumeMarket ? 0.35 : 1;
    const minutesSignal = clamp((minutes - 24) / 16, -0.9, 1.1) * scale;
    const shotVolumeSignal = clamp(((profile.shotVolumeAvg || 0) - 8) / 18, -0.35, 0.5) * scale;
    const paceSignal = clamp(((context.paceRating || 1) - 1) * 3, -0.2, 0.2);
    const defenseSignal = clamp(((context.defensiveRating || 1) - 1) * 2, -0.18, 0.18);
    return minutesSignal + shotVolumeSignal + paceSignal + defenseSignal;
  }

  if (market.group === "pitching") {
    const pitchCountSignal = Number.isFinite(profile.pitchCountAvg)
      ? clamp((profile.pitchCountAvg - 82) / 45, -0.45, 0.55)
      : 0;
    const restSignal = Number.isFinite(profile.restDays)
      ? clamp((profile.restDays - 4) / 8, -0.25, 0.25)
      : 0;
    return (context.role === "Probable starter" ? 0.35 : -0.75) + pitchCountSignal + restSignal;
  }

  const handednessSignal = getHandednessAdjustment(context);
  const roleSignal = context.role === "Likely regular" ? 0.08 : -0.12;
  return roleSignal + handednessSignal;
}

function getVolatilityDrag(market, profile, line) {
  const volatilityRatio = getVolatilityRatio(profile, line);
  const lowVolumeMarket = ["Hits", "Runs", "RBIs", "3PM", "Steals", "Blocks"].includes(market.id);
  const drag = lowVolumeMarket ? volatilityRatio * 0.08 : volatilityRatio * 0.18;
  return -clamp(drag, 0, 0.8);
}

function getVolatilityRatio(profile, line) {
  const baseline = Math.max(1, profile.seasonAvg, line);
  return profile.stdDev / baseline;
}

function getConsistencyScore(profile, line) {
  const last10 = profile.last10 || [];
  const hitRate = hitRateAgainstLine(last10, line, "Over");
  const misses = last10.map((value) => Math.abs(value - profile.last10Avg));
  const recentStability = 1 - clamp(average(misses) / Math.max(1, profile.last10Avg, line), 0, 1);
  const volatilityScore = 1 - clamp(getVolatilityRatio(profile, line), 0, 1);
  const hitRateBalance = Number.isFinite(hitRate) ? 1 - Math.abs(hitRate - 0.5) : 0.5;
  return clamp(recentStability * 0.45 + volatilityScore * 0.4 + hitRateBalance * 0.15, 0, 1);
}

function hitRateAgainstLine(values, line, side) {
  if (!Array.isArray(values) || !values.length || !Number.isFinite(line)) return null;
  const hits = values.filter((value) => (side === "Over" ? value > line : value < line)).length;
  return hits / values.length;
}

function blendProbabilities(modelProbability, empiricalProbability, games) {
  if (!Number.isFinite(empiricalProbability)) return modelProbability;
  const empiricalWeight = clamp(games / 30, 0.18, 0.42);
  return modelProbability * (1 - empiricalWeight) + empiricalProbability * empiricalWeight;
}

function calibrateProbability(probability, projection, profile, market, side, line) {
  const distance = Math.abs(projection.projectedMean - line);
  const spread = Math.max(0.8, profile.stdDev || 1.2);
  const distanceSignal = diminishingSignal(distance / spread, 1.4);
  const samplePenalty = profile.games < 15 ? (15 - profile.games) * 0.006 : 0;
  const volatilityPenalty = clamp(profile.stdDev / Math.max(1, profile.seasonAvg + 0.5), 0, 1.5) * 0.035;
  const lowVolumePenalty = ["Hits", "Runs", "RBIs", "3PM", "Steals", "Blocks"].includes(market.id) ? 0.025 : 0;
  const calibrated =
    probability +
    (side === "Over" ? 1 : -1) * Math.sign(projection.projectedMean - line) * distanceSignal * 0.025 -
    samplePenalty -
    volatilityPenalty -
    lowVolumePenalty;

  return clamp(calibrated, 0.03, 0.97);
}

function diminishingSignal(value, cap) {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.min(cap, Math.log1p(Math.abs(value)) / Math.log(2.4));
}

function calibrateDisplayedProbability(rawProb, profile, market, line) {
  let calibrated = rawProb;

  if (rawProb > 0.85) {
    calibrated = 0.72 + (rawProb - 0.85) * 0.1;
  } else if (rawProb > 0.75) {
    calibrated = rawProb - 0.08;
  } else if (rawProb < 0.15) {
    calibrated = 0.28 - (0.15 - rawProb) * 0.1;
  } else if (rawProb < 0.25) {
    calibrated = rawProb + 0.08;
  }

  const samplePenalty = profile.games < 20 ? (20 - profile.games) * 0.0025 : 0;
  const volatilityPenalty = clamp(profile.stdDev / Math.max(1, line.line || profile.seasonAvg || 1), 0, 1.6) * 0.025;
  const lowSampleSportPenalty = market.group === "tennis" ? 0.015 : 0;

  return clamp(calibrated - samplePenalty - volatilityPenalty - lowSampleSportPenalty, 0.48, MAX_DISPLAY_PROBABILITY);
}

function computeBetConfidence(rawConfidence, probability, profile, flags, marketMovement, trustScore, clvScore) {
  const probAnchor = 42 + Math.abs(probability - 0.5) * 95;
  const sampleMultiplier = profile.games >= 20 ? 1 : profile.games >= 10 ? 0.96 : 0.9;
  const volatilityRatio = profile.stdDev / Math.max(1, profile.seasonAvg || 1);
  const volatilityMultiplier = clamp(1 - volatilityRatio * 0.08, 0.86, 1);
  const flagMultiplier = clamp(1 - (flags || []).length * 0.025, 0.88, 1);
  const movementMultiplier = clamp(1 + (marketMovement.score || 0) * 0.045, 0.94, 1.06);
  const trustMultiplier = clamp(1 + (trustScore + clvScore) * 0.04, 0.94, 1.06);
  const base = rawConfidence * 0.45 + probAnchor * 0.55;

  return clamp(
    Math.round(base * sampleMultiplier * volatilityMultiplier * flagMultiplier * movementMultiplier * trustMultiplier),
    1,
    MAX_DISPLAY_CONFIDENCE
  );
}

function scoreConfidence(edge, probability, projection, profile, line, consistencyScore, sportsbookValue) {
  const lineDistance = Math.abs(projection.projectedMean - line) / Math.max(0.8, profile.stdDev || 1.2);
  const sampleBoost = clamp(profile.games, 0, 24) * 0.7;
  const edgeBoost = edge * 240;
  const probabilityBoost = Math.abs(probability - 0.5) * 70;
  const distanceBoost = clamp(lineDistance, 0, 1.8) * 9;
  const volatilityPenalty = clamp(profile.stdDev / Math.max(1, profile.seasonAvg + 0.5), 0, 1.8) * 12;
  const consistencyBoost = consistencyScore * 12;
  const bookBoost = sportsbookValue * 28;
  return clamp(Math.round(36 + sampleBoost + edgeBoost + probabilityBoost + distanceBoost + consistencyBoost + bookBoost - volatilityPenalty), 1, 96);
}

function expectedValue(probability, odds) {
  const profitPerDollar = americanProfitPerDollar(odds);
  return probability * profitPerDollar - (1 - probability);
}

function normalizedExpectedValue(probability, odds, line, side) {
  const fairProbability = noVigImpliedProbability(line, side, americanToImpliedProbability(odds));
  const decimalOdds = americanToDecimalOdds(odds);
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  const rawEv = probability * (decimalOdds - 1) - (1 - probability);
  const vigPenalty = Math.max(0, americanToImpliedProbability(odds) - fairProbability) * 0.45;
  return clamp(rawEv - vigPenalty, -0.25, MAX_REASONABLE_EV);
}

function noVigImpliedProbability(line, side, fallback) {
  const over = line.odds?.over;
  const under = line.odds?.under;
  const overImp = americanToImpliedProbability(over);
  const underImp = americanToImpliedProbability(under);
  const total = overImp + underImp;
  if (total > 0) {
    return side === "Over" ? overImp / total : underImp / total;
  }

  const consensus = line.consensus;
  const avgOver = consensus?.avgOverImplied || 0;
  const avgUnder = consensus?.avgUnderImplied || 0;
  const avgTotal = avgOver + avgUnder;
  if (avgTotal > 0) return side === "Over" ? avgOver / avgTotal : avgUnder / avgTotal;
  return fallback;
}

function americanToDecimalOdds(odds) {
  const price = Number(odds);
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function americanProfitPerDollar(odds) {
  const price = Number(odds);
  if (!Number.isFinite(price) || price === 0) return 0;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function isExtremeOdds(odds) {
  const price = Number(odds);
  return !Number.isFinite(price) || price < MIN_ALLOWED_ODDS || price > MAX_ALLOWED_ODDS;
}

function getSportsbookValue(line, side, odds) {
  const consensus = line.consensus;
  if (!consensus) return 0;

  const avgLine = consensus.avgLine || line.line;
  const lineValue = side === "Over" ? avgLine - line.line : line.line - avgLine;
  const avgImplied = side === "Over" ? consensus.avgOverImplied : consensus.avgUnderImplied;
  const priceValue = Number.isFinite(avgImplied) && avgImplied > 0
    ? avgImplied - americanToImpliedProbability(odds)
    : 0;

  return clamp(lineValue * 0.08 + priceValue, -0.12, 0.18);
}

function getConsensusScore(line, side, modelProbability, impliedProbability) {
  const consensus = line.consensus;
  if (!consensus) return 0;
  const avgImplied = side === "Over" ? consensus.avgOverImplied : consensus.avgUnderImplied;
  const marketEdge = Number.isFinite(avgImplied) && avgImplied > 0 ? modelProbability - avgImplied : modelProbability - impliedProbability;
  const bookDepth = clamp((consensus.bookCount || 1) / 6, 0, 1);
  return clamp(marketEdge * 100 * 0.7 + bookDepth * 6, -10, 20);
}

function scorePickRank({ ev, edge, confidence, consistencyScore, sportsbookValue, consensusScore, volatility, projectedDiff, lineMoveValue, marketMovement = 0, trustScore = 0, clvScore = 0 }) {
  return (
    clamp(ev, -0.08, MAX_REASONABLE_EV) * 160 +
    edge * 130 +
    confidence * 0.45 +
    consistencyScore * 22 +
    sportsbookValue * 110 +
    consensusScore * 1.2 +
    Math.max(0, lineMoveValue) * 12 +
    marketMovement * 16 +
    trustScore * 10 +
    clvScore * 12 +
    Math.min(Math.abs(projectedDiff), 4) * 3 -
    volatility * 18
  );
}

function calculatePropScore(prop) {
  const profile = getMarketStabilityProfile(prop.sport, prop.prop);
  const consistency = clamp((prop.consistencyScore || 0) * 100, 0, 100);
  const volatilityScore = getVolatilityScore(prop);
  const repeatability = (profile.repeatability || 0.5) * 100;
  const stableRole = getStableRoleScore(prop, profile);
  const matchupEdge = clamp(50 + (prop.edgePct || 0) * 1.8 + Math.min(Math.abs(prop.projectedDiff || 0), 5) * 3, 0, 100);
  const historicalReliability = clamp(56 + (prop.trustScore || 0) * 18 + (prop.clvScore || 0) * 14 + (prop.consensusScore || 0) * 0.45, 0, 100);
  const priceDiscipline = clamp(62 + (prop.sportsbookValue || 0) * 90 + clamp(prop.evPct || 0, -8, 15) * 1.5, 0, 100);
  const base =
    consistency * 0.23 +
    stableRole * 0.18 +
    volatilityScore * 0.2 +
    repeatability * 0.18 +
    matchupEdge * 0.11 +
    historicalReliability * 0.06 +
    priceDiscipline * 0.04;

  return Math.round(clamp(base - getStablePropPenalty(prop, profile), 0, 100));
}

function addStableScoreToPick(pick, market, context, profile, line, best) {
  const eventName = `${context.game.away} vs ${context.game.home}`;
  const startTime = context.game.commenceTime || line.commenceTime || null;
  const enhancedPick = {
    ...pick,
    event: eventName,
    startTime,
    dateGenerated: new Date().toISOString(),
    volatilityScore: getVolatilityScore(pick),
    repeatabilityScore: Math.round((getMarketStabilityProfile(market.sport, market.id).repeatability || 0.5) * 100),
    stabilityRole: getMarketStabilityProfile(market.sport, market.id).role || "Deprioritized",
    stableReasonSummary: buildStableReasonSummary(pick, market, context, profile, line, best),
  };

  return {
    ...enhancedPick,
    propScore: calculatePropScore(enhancedPick),
  };
}

function isStablePlayablePick(pick, market) {
  if (!pick || pick.isNoBet || !["Over", "Under"].includes(pick.pick)) return false;
  if (!Number.isFinite(pick.line) || !Number.isFinite(Number(pick.odds))) return false;
  if (!isStableAutoMarket(market)) return false;
  if (pick.ev <= 0 || pick.confidence < 52) return false;
  if ((pick.propScore || calculatePropScore(pick)) < 58) return false;
  if ((pick.volatilityScore || getVolatilityScore(pick)) < 38) return false;
  if (pick.risk === "High" && (pick.propScore || 0) < 72) return false;
  if (market.sport === "WTA" && !hasExtremeStableEdge(pick)) return false;
  return true;
}

function isStableCandidatePick(pick, market) {
  if (!pick || pick.isNoBet || !["Over", "Under"].includes(pick.pick)) return false;
  if (!Number.isFinite(pick.line) || !Number.isFinite(Number(pick.odds))) return false;
  if (!isStableAutoMarket(market)) return false;
  if ((pick.propScore || calculatePropScore(pick)) < 45) return false;
  if ((pick.volatilityScore || getVolatilityScore(pick)) < 24) return false;
  if ((pick.confidence || 0) < 45) return false;
  if (market.sport === "WTA" && !hasExtremeStableEdge(pick)) return false;
  return true;
}

function makeWatchlistPick(pick) {
  return {
    ...pick,
    watchlistOnly: true,
    recommendation: "Watchlist",
    recommendationText: `Watchlist ${pick.pick}`,
    suggestedUnits: "0u",
    bankroll: "No bet",
    bankrollPct: 0,
    key_edge: `WATCHLIST: stable profile, but not a positive-EV tracked bet yet. ${pick.key_edge || pick.reason || ""}`,
    stableReasonSummary: `${pick.stableReasonSummary || "Stable profile found."} Watchlist only because EV/edge/confidence did not clear the auto-bet threshold.`,
  };
}

async function buildProjectionWatchlist(games, market) {
  if (!Array.isArray(games) || games.length === 0) return [];
  const contexts = await buildPlayerContexts(games, market);
  const rows = [];

  for (const context of contexts) {
    try {
    if (!context?.player || context.player === "TBD") continue;

    const profile =
      market.group === "tennis"
        ? buildTennisStatProfile(context, market, {})
        : context.id
        ? await fetchPlayerStatProfile(context.id, market)
        : null;
    if (!profile || profile.games < 5) continue;

    const referenceLine = projectionReferenceLine(market, profile);
    const pseudoLine = {
      player: context.player,
      market: market.id,
      line: referenceLine,
      book: "Line needed",
      odds: {},
      commenceTime: context.game.commenceTime,
    };
    const projection = buildProjection(pseudoLine, market, context, profile);
    const pickSide = projection.projectedMean >= referenceLine ? "Over" : "Under";
    const projectedDiff = projection.projectedMean - referenceLine;
    const consistencyScore = getConsistencyScore(profile, referenceLine);
    const volatility = projection.volatility;
    const volatilityScore = Math.round(clamp((1 - clamp(volatility, 0, 1.15)) * 100, 0, 100));
    const confidence = Math.round(
      clamp(46 + consistencyScore * 22 + Math.min(Math.abs(projectedDiff), 4) * 4 + volatilityScore * 0.12, 35, 68)
    );
    const basePick = {
      id: `${context.id}-${market.id}-projection-watchlist`,
      sport: market.sport,
      playerId: context.id,
      gameId: context.game.id,
      group: market.group,
      player: context.player,
      team: context.team,
      opponent: context.opponent,
      prop: market.id,
      line: referenceLine,
      odds: null,
      book: "Line needed",
      bestSportsbook: "Line needed",
      pick: pickSide,
      confidence,
      season_avg: roundTo(projection.projectedMean, 1),
      last5Avg: roundTo(profile.last5Avg, 1),
      last10Avg: roundTo(profile.last10Avg, 1),
      hit_rate_pct: 0,
      impliedProbability: 0,
      edgePct: 0,
      ev: 0,
      evPct: 0,
      consensusScore: 0,
      rankScore: consistencyScore * 40 + volatilityScore * 0.5 + Math.abs(projectedDiff) * 4,
      confidenceTier: confidenceTierFromScore(confidence),
      recommendation: "Line Needed",
      recommendationText: `Line Needed ${pickSide}`,
      suggestedUnits: "0u",
      sportsbookValue: 0,
      marketAverageLine: referenceLine,
      marketBookCount: 0,
      marketBooks: [],
      bestBookReason: "Sportsbook line has not posted yet for this stable market.",
      mathExplanation: `Projection-only watchlist: projected ${roundTo(projection.projectedMean, 1)} against a reference line ${referenceLine}. Load sportsbook odds before betting.`,
      aiExplanation: "No betting explanation generated because this is a line-needed watchlist candidate.",
      contextFilters: getContextFilterSummary(market, context, profile),
      trendAnalysis: buildTrendAnalysis(market, context, profile),
      usageAnalysis: buildUsageAnalysis(market, context, profile),
      projectedDiff: roundTo(projectedDiff, 2),
      volatility,
      consistencyScore,
      lineMoveValue: 0,
      historicalOdds: "No sportsbook line seen yet",
      last5: profile.last5,
      pitcher_faced:
        market.group === "hitting"
          ? opponentPitcherName(context.game, context.team)
          : context.opponentName,
      edge_score: confidence,
      risk: volatility >= 0.65 ? "High" : volatility >= 0.4 ? "Medium" : "Low",
      bankroll: "No bet",
      bankrollPct: 0,
      isNoBet: false,
      noBetWarning: "",
      reason: `Line needed: ${market.id} has a stable profile for ${context.player}, but no sportsbook line/odds were loaded. Projection ${roundTo(projection.projectedMean, 1)}, last 5 ${roundTo(profile.last5Avg, 1)}, last 10 ${roundTo(profile.last10Avg, 1)}.`,
      key_edge: "WATCHLIST: load a sportsbook line before this can become a tracked bet.",
      lineMovement: "No line loaded",
      clv: "Pending",
      result: "Pending",
      injuryStatus: context.injuryStatus,
      usage: formatUsage(market, context, profile),
      rawProbability: 0,
      displayProbability: 0,
      realityFlags: [],
      marketMovement: { label: "No market line loaded", score: 0 },
      clvScore: 0,
      trustScore: 0,
      simulation: runMonteCarloSimulation(projection.projectedMean, profile.stdDev, referenceLine, pickSide, `${context.player}-${market.id}-projection`),
      sportsbookTable: [],
      event: `${context.game.away} vs ${context.game.home}`,
      startTime: context.game.commenceTime,
      dateGenerated: new Date().toISOString(),
      volatilityScore,
      repeatabilityScore: Math.round((getMarketStabilityProfile(market.sport, market.id).repeatability || 0.5) * 100),
      stabilityRole: getMarketStabilityProfile(market.sport, market.id).role || "Projection watchlist",
      watchlistOnly: true,
    };

    rows.push({
      ...basePick,
      propScore: calculatePropScore(basePick),
      stableReasonSummary: buildProjectionWatchlistReason(market, context, profile, projection, referenceLine),
    });
    } catch {
      continue;
    }
  }

  return topStablePicksForSport(rows, 3);
}

function projectionReferenceLine(market, profile) {
  if (Number.isFinite(market.line)) return market.line;
  const baseline = Number.isFinite(profile.last10Avg) && profile.last10Avg > 0 ? profile.last10Avg : profile.seasonAvg || 1;
  return Math.max(0.5, Math.round(baseline * 2) / 2);
}

function buildProjectionWatchlistReason(market, context, profile, projection, referenceLine) {
  return `Projection-only fallback for ${market.id}: no sportsbook prop line was returned, but ${context.player} rates as a stable watchlist candidate. Projection ${roundTo(projection.projectedMean, 1)} vs reference ${referenceLine}, last 5 ${roundTo(profile.last5Avg, 1)}, last 10 ${roundTo(profile.last10Avg, 1)}.`;
}

function topStablePicksForSport(picks, limit) {
  return (Array.isArray(picks) ? picks : [])
    .filter((pick) => !pick.isNoBet)
    .sort(sortStablePicks)
    .slice(0, limit);
}

function sortStablePicks(a, b) {
  return (
    (b.propScore || 0) - (a.propScore || 0) ||
    (b.consistencyScore || 0) - (a.consistencyScore || 0) ||
    (b.volatilityScore || 0) - (a.volatilityScore || 0) ||
    (b.confidence || 0) - (a.confidence || 0) ||
    (b.evPct || 0) - (a.evPct || 0)
  );
}

function isStableVisibleMarket(market) {
  return getMarketStabilityProfile(market.sport, market.id).visible !== false;
}

function isStableAutoMarket(market) {
  return getMarketStabilityProfile(market.sport, market.id).auto === true;
}

function getPrimaryMarketForSport(sportId) {
  const marketId = STABLE_AUTO_MARKETS[sportId]?.[0];
  return findMarket(sportId, marketId) || MARKETS.find((item) => item.sport === sportId && isStableVisibleMarket(item));
}

function findMarket(sportId, marketId) {
  return MARKETS.find((item) => item.sport === sportId && item.id === marketId);
}

function getMarketStabilityProfile(sportId, marketId) {
  return MARKET_STABILITY[`${sportId}:${marketId}`] || { role: "Deprioritized", repeatability: 0.45, auto: false, visible: false };
}

function getVolatilityScore(prop) {
  return Math.round(clamp((1 - clamp(prop.volatility || 0.75, 0, 1.15)) * 100, 0, 100));
}

function getStableRoleScore(prop, profile) {
  let score = (profile.repeatability || 0.5) * 100;
  if (/primary/i.test(profile.role || "")) score += 8;
  if (/secondary/i.test(profile.role || "")) score -= 3;
  if (/avoid|volatile|combo|deprioritized/i.test(profile.role || "")) score -= 22;
  if (prop.risk === "Low") score += 8;
  if (prop.risk === "High") score -= 16;
  if (prop.confidence >= 70) score += 6;
  return clamp(score, 0, 100);
}

function getStablePropPenalty(prop, profile) {
  let penalty = 0;
  const odds = Number(prop.odds);
  if (isExtremeOdds(odds)) penalty += 16;
  if (Math.abs(odds) > 200) penalty += 8;
  if (prop.risk === "High") penalty += 12;
  if (/questionable|injur|restricted|elevated|inactive/i.test(prop.injuryStatus || "")) penalty += 10;
  if (/role up|role down|unstable/i.test(prop.trendAnalysis || "")) penalty += 7;
  if ((prop.realityFlags || []).length) penalty += Math.min(12, prop.realityFlags.length * 4);
  if (/avoid|volatile|combo|deprioritized/i.test(profile.role || "")) penalty += 14;
  if (prop.sport === "WTA" && !hasExtremeStableEdge(prop)) penalty += 24;
  return penalty;
}

function hasExtremeStableEdge(prop) {
  return (prop.edgePct || 0) >= 12 && (prop.evPct || 0) >= 8 && (prop.confidence || 0) >= 72;
}

function buildStableReasonSummary(pick, market, context, profile, line, best) {
  if (market.group === "pitching") {
    return `Stable MLB profile: ${market.id} is prioritized because starter role, last 5 ${roundTo(profile.last5Avg, 1)}, pitch count ${formatMaybe(profile.pitchCountAvg, " pitches")}, opponent K/contact signal, umpire ${context.umpire || "TBD"}, weather ${context.weather || "unavailable"}, and line value ${signedRound((best.projectedMean - line.line) || 0)}.`;
  }

  if (market.group === "basketball") {
    return `Stable WNBA profile: ${market.id} is prioritized for minutes consistency, role ${context.role}, ${formatMaybe(profile.minutesAvg, " MPG")}, pace ${roundTo(context.paceRating || 1, 2)}, opponent rebound/assist environment, usage ${formatMaybe(profile.usageRate, "%")}, and volatility score ${getVolatilityScore(pick)}.`;
  }

  if (market.group === "tennis") {
    const t = profile.tennis;
    return `Stable ATP profile: ${market.id} uses surface ${t.surface}, hold ${Math.round(t.holdPct * 100)}%, break ${Math.round(t.breakPct * 100)}%, ranking gap ${Math.abs(t.rankingDiff)}, recent form ${Math.round(t.recent5 * 100)}%/${Math.round(t.recent10 * 100)}%, fatigue ${Math.round(t.fatigue * 100)}%, and H2H closeness ${Math.round(t.h2hClose * 100)}%.`;
  }

  return `${market.id} passed the stable-prop score with repeatability, low volatility, and positive sportsbook value.`;
}

function getNoBetReasons(best) {
  const reasons = [];
  if (best.ev <= -0.04) reasons.push("expected value is clearly negative.");
  if (best.edge < -0.04) reasons.push("model is clearly below market.");
  if (best.confidence < 52) reasons.push("confidence is below pass threshold.");
  if (best.marketMovement?.score < -0.7) reasons.push("market movement is strongly against the pick.");
  if ((best.realityFlags || []).length >= 3) reasons.push("reality check flagged severe model inflation.");
  return Array.from(new Set([...reasons, ...(best.safetyReasons || [])]));
}

function getConfidenceTier(best) {
  if (best.confidence >= 76 && best.ev > 0 && best.marketMovement?.score > 0 && best.clvScore >= 0) return "Tier S";
  if (best.confidence >= 72 && best.ev > 0) return "Tier A";
  if (best.confidence >= 60 && best.ev > 0) return "Tier B";
  if (best.confidence >= 52 || best.ev > 0) return "Tier C";
  return "Tier D";
}

function buildRecommendation(best, profile) {
  const passReasons = getNoBetReasons(best);
  const uncertainty = getRecommendationUncertainty(best, profile);
  const bankrollPct = calculateKellyStake(best.modelProbability, best.odds, profile, best.risk);

  if (passReasons.length > 0) {
    return {
      label: "Pass",
      tier: "Tier D",
      text: "Pass",
      units: "0u",
      bankrollPct: 0,
      bankrollLabel: "No bet",
      reasons: passReasons,
    };
  }

  if (
    best.confidence >= 72 &&
    best.ev > 0.04 &&
    best.marketMovement?.score >= 0 &&
    best.risk !== "High" &&
    uncertainty < 0.45
  ) {
    return recommendationObject("Strong Bet", best, bankrollPct, "1u-2u");
  }

  if (best.confidence >= 60 && best.ev > -0.005 && uncertainty < 0.65) {
    return recommendationObject("Playable", best, bankrollPct, "0.5u-1u");
  }

  if (best.confidence >= 52 || best.ev > -0.015 || best.modelProbability >= 0.62) {
    return recommendationObject(`Lean ${best.pick}`, best, Math.min(bankrollPct, 0.25), "0.25u");
  }

  return {
    label: "Pass",
    tier: "Tier D",
    text: "Pass",
    units: "0u",
    bankrollPct: 0,
    bankrollLabel: "No bet",
    reasons: ["confidence is below pass threshold."],
  };
}

function recommendationObject(label, best, bankrollPct, fallbackUnits) {
  const units = label.startsWith("Lean")
    ? "0.25u"
    : bankrollPct > 0
    ? `${roundTo(clamp(bankrollPct / 0.75, label === "Strong Bet" ? 1 : 0.5, label === "Strong Bet" ? 2 : 1), 2)}u`
    : fallbackUnits;
  return {
    label,
    tier: getConfidenceTier(best),
    text: `${label} ${best.pick}`,
    units,
    bankrollPct,
    bankrollLabel: bankrollPct > 0 ? `${bankrollPct}% bankroll` : units,
    reasons: [],
  };
}

function getRecommendationUncertainty(best, profile) {
  const volatilityRatio = profile.stdDev / Math.max(1, profile.seasonAvg || 1);
  return clamp(
    volatilityRatio * 0.35 +
      Math.max(0, -best.marketMovement?.score || 0) * 0.25 +
      Math.max(0, -best.clvScore || 0) * 0.2 +
      (best.realityFlags || []).length * 0.06,
    0,
    1
  );
}

function getBestBookReason(line, side, sportsbookValue) {
  const avgLine = line.consensus?.avgLine;
  if (!Number.isFinite(avgLine)) return `${line.book} is the available book for this imported line.`;
  const sideWord = side === "Over" ? "lower" : "higher";
  const valueText = sportsbookValue > 0
    ? `${line.book} has a weaker ${sideWord} line than the market average.`
    : `${line.book} is close to the market average.`;
  return `${valueText} Market avg ${roundTo(avgLine, 2)} across ${line.consensus?.bookCount || 1} books.`;
}

function buildMathExplanation(best, market, context, profile, line) {
  if (market.group === "tennis") {
    const t = profile.tennis;
    return [
      `${best.pick} ${line.line} because projection ${roundTo(best.projectedMean, 1)} vs sportsbook line ${line.line}.`,
      `Model probability ${Math.round(best.modelProbability * 100)}% vs implied ${Math.round(best.impliedProbability * 100)}%, edge ${signedRound(best.edge * 100)}%, EV ${signedRound(best.ev * 100)}%, confidence ${best.confidence}, risk ${best.risk}.`,
      `Key reasons: projected sets ${roundTo(t.expectedSets, 2)}, total games ${roundTo(t.totalGames, 1)}, hold ${Math.round(t.holdPct * 100)}%/${Math.round(t.opponentHoldPct * 100)}%, break ${Math.round(t.breakPct * 100)}%, return points won ${Math.round(t.returnPointsWon * 100)}%, ranking diff ${t.rankingDiff}.`,
      `Surface ${t.surface}, recent form last 5 ${Math.round(t.recent5 * 100)}%, last 10 ${Math.round(t.recent10 * 100)}%, H2H closeness ${Math.round(t.h2hClose * 100)}%, fatigue ${Math.round(t.fatigue * 100)}%, injury risk ${Math.round(t.injuryRisk * 100)}%, ${t.bestOf === 5 ? "best-of-5" : "best-of-3"}.`,
    ].join(" ");
  }

  return [
    `EV ${signedRound(best.ev * 100)}%, edge ${signedRound(best.edge * 100)}%, projected diff ${signedRound(best.projectedMean - line.line)}.`,
    `Consensus score ${roundTo(best.consensusScore, 1)}, sportsbook value ${signedRound(best.sportsbookValue * 100)}%, consistency ${Math.round(best.consistencyScore * 100)}%.`,
    `Model weights: last 5 ${roundTo(profile.last5Avg, 1)} carries 45%, last 10 ${roundTo(profile.last10Avg, 1)} carries 30%, season ${roundTo(profile.seasonAvg, 1)} carries 15%, context 10%.`,
    getContextFilterSummary(market, context, profile),
  ].join(" ");
}

function buildPostModelExplanation(best, market, context, profile, line) {
  if (market.group === "tennis") {
    const t = profile.tennis;
    return `After the math model selected ${best.pick}, the tennis explanation layer flags ${getConfidenceTier(best)}: ${best.pick} ${line.line} is driven by ${roundTo(t.expectedSets, 2)} projected sets, ${roundTo(t.gamesPerSet, 1)} games per set, ${Math.round(t.holdPct * 100)}% hold profile, ${Math.round(t.h2hClose * 100)}% close-match signal, and ${signedRound(best.edge * 100)}% edge.`;
  }

  return `After the math model selected ${best.pick}, the explanation layer flags ${getConfidenceTier(best)}: ${best.pick} ${line.line} is backed by positive EV, ${context.team} usage context, ${context.opponent} matchup context, and ${profile.stdDev <= Math.max(1.5, profile.seasonAvg * 0.75) ? "stable" : "volatile"} recent output.`;
}

function getContextFilterSummary(market, context, profile) {
  if (market.group === "tennis") {
    const t = profile.tennis;
    return `Tennis filters: winner probability ${Math.round(t.winProbability * 100)}%, total games ${roundTo(t.totalGames, 1)}, expected sets ${roundTo(t.expectedSets, 2)}, player games ${roundTo(t.gamesWon, 1)}, aces ${roundTo(t.aces, 1)}, double faults ${roundTo(t.doubleFaults, 1)}, breaks ${roundTo(t.breaksOfServe, 1)}, hold ${Math.round(t.holdPct * 100)}%, break ${Math.round(t.breakPct * 100)}%, surface ${t.surface}, round ${t.tournamentRound}, format best-of-${t.bestOf}.`;
  }

  const homeAway = context.team === context.game.homeAbbr ? "home" : "away";
  const restrictionLabel = getRestrictionLabel(market, context, profile);
  const restLabel = `Rest/news: ${formatRestDays(profile.restDays)}, ${restrictionLabel}, injury/news ${context.injuryStatus || "unknown"}.`;

  if (market.group === "pitching") {
    const opponent = getTeamContext(context.opponent);
    return `Filters: opponent K/contact ${signedRound((1 - opponent.contact) * 100)}%, defense ${signedRound((1 - opponent.offense) * 100)}%, ${homeAway}, pitcher hand ${context.pitchHand || "TBD"}, pitch count ${formatMaybe(profile.pitchCountAvg, " pitches")}, weather ${context.weather || "unavailable"}, umpire ${context.umpire || "TBD"}. ${restLabel}`;
  }

  if (market.group === "basketball") {
    return `Filters: pace ${roundTo(context.paceRating || 1, 2)}, defense ${roundTo(context.defensiveRating || 1, 2)}, ${homeAway}, minutes ${formatMaybe(profile.minutesAvg, " MPG")}, shot volume ${formatMaybe(profile.shotVolumeAvg, " FGA")}. ${restLabel}`;
  }

  const opponentPitcher = opponentPitcherName(context.game, context.team);
  return `Filters: ${homeAway}, pitcher faced ${opponentPitcher}, batter side ${context.batSide || "TBD"} vs pitcher hand ${context.opponentPitchHand || "TBD"}, home avg ${formatMaybe(profile.homeAvg)}, away avg ${formatMaybe(profile.awayAvg)}, weather ${context.weather || "unavailable"}, umpire ${context.umpire || "TBD"}. ${restLabel}`;
}

function getRestrictionLabel(market, context, profile) {
  const injury = String(context.injuryStatus || "").toLowerCase();
  if (/questionable|doubtful|out|injur|inactive|restricted|day-to-day/.test(injury)) {
    return "news flag active";
  }

  if (market.group === "basketball") {
    if (Number.isFinite(profile.minutesAvg) && profile.minutesAvg < 18) return "possible minutes restriction";
    if (profile.restDays === 0 || profile.restDays === 1) return "back-to-back/rest risk";
  }

  if (market.group === "pitching") {
    if (Number.isFinite(profile.pitchCountAvg) && profile.pitchCountAvg < 70) return "possible pitch-count limit";
    if (profile.restDays != null && profile.restDays < 4) return "short-rest risk";
  }

  return "no hard restriction flag";
}

function buildTrendAnalysis(market, context, profile) {
  if (market.group === "tennis") {
    const t = profile.tennis;
    return `Last 5 form ${Math.round(t.recent5 * 100)}% · Last 10 form ${Math.round(t.recent10 * 100)}% · ranking ${t.ranking} vs ${t.opponentRanking} · opponent strength ${Math.round(t.opponentStrength * 100)}% · H2H closeness ${Math.round(t.h2hClose * 100)}% · fatigue ${Math.round(t.fatigue * 100)}% · role ${profile.roleChange}`;
  }

  const homeAway = context.team === context.game.homeAbbr ? "home" : "away";
  const vsOpponent = averageVsOpponent(profile, context.opponent);
  const base = [
    `Last 5 ${roundTo(profile.last5Avg || 0, 1)}`,
    `Last 10 ${roundTo(profile.last10Avg || 0, 1)}`,
    `home ${formatMaybe(profile.homeAvg)}`,
    `away ${formatMaybe(profile.awayAvg)}`,
    `today ${homeAway}`,
    `vs opponent ${formatMaybe(vsOpponent)}`,
    `role ${profile.roleChange || "stable sample"}`,
  ];

  if (market.group === "hitting") {
    base.push(`handedness ${context.batSide || "TBD"} vs ${context.opponentPitchHand || "TBD"}`);
  }

  return base.join(" · ");
}

function buildUsageAnalysis(market, context, profile) {
  if (market.group === "tennis") {
    const t = profile.tennis;
    return `Serve/return profile: hold ${Math.round(t.holdPct * 100)}%, break ${Math.round(t.breakPct * 100)}%, return points won ${Math.round(t.returnPointsWon * 100)}%, tiebreak rate ${Math.round(t.tiebreakRate * 100)}%, injury/retirement risk ${Math.round(t.injuryRisk * 100)}%.`;
  }

  if (market.group === "basketball") {
    return [
      `minutes ${formatMaybe(profile.minutesAvg, " MPG")}`,
      `usage ${formatMaybe(profile.usageRate, "%")}`,
      `touches ${formatMaybe(profile.touchesAvg)}`,
      `shot volume ${formatMaybe(profile.shotVolumeAvg, " FGA")}`,
      `restriction ${getRestrictionLabel(market, context, profile)}`,
    ].join(" · ");
  }

  if (market.group === "pitching") {
    return [
      `pitch count ${formatMaybe(profile.pitchCountAvg, " pitches")}`,
      `rest ${formatRestDays(profile.restDays)}`,
      `throws ${context.pitchHand || "TBD"}`,
      `restriction ${getRestrictionLabel(market, context, profile)}`,
    ].join(" · ");
  }

  return [
    `lineup role ${context.role}`,
    `handedness ${context.batSide || "TBD"} vs ${context.opponentPitchHand || "TBD"}`,
    `rest ${formatRestDays(profile.restDays)}`,
    `role ${profile.roleChange || "stable sample"}`,
  ].join(" · ");
}

function averageVsOpponent(profile, opponent) {
  const rows = profile.rows || [];
  const values = rows
    .filter((row) => row.opponent === opponent)
    .map((row) => row.value)
    .filter(Number.isFinite);
  return values.length ? average(values) : null;
}

async function fetchPlayerStatProfile(playerId, market) {
  const cacheKey = `${playerId}-${market.id}-${STAT_SEASON}`;
  if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);

  if (market.group === "basketball") {
    const profile = await fetchWnbaStatProfile(playerId, market, cacheKey);
    return profile;
  }

  try {
    const group = market.group === "pitching" ? "pitching" : "hitting";
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=${group}&season=${STAT_SEASON}`
    );
    if (!response.ok) throw new Error("Stat request failed");

    const data = await response.json();
    const rows = (data.stats?.[0]?.splits || [])
      .map((split) => ({
        value: statValueForMarket(split.stat || {}, market.id),
        isHome: Boolean(split.isHome),
        date: split.date,
        opponent: teamAbbr(split.opponent || {}),
        pitches: Number(split.stat?.pitchesThrown),
      }))
      .filter((row) => Number.isFinite(row.value))
      .reverse();
    const values = rows.map((row) => row.value);

    if (values.length === 0) {
      statsCache.set(cacheKey, null);
      return null;
    }

    const last5 = values.slice(-5);
    const last10 = values.slice(-10);
    const homeValues = rows.filter((row) => row.isHome).map((row) => row.value);
    const awayValues = rows.filter((row) => !row.isHome).map((row) => row.value);
    const pitches = rows.map((row) => row.pitches).filter(Number.isFinite);
    const profile = {
      games: values.length,
      last5,
      last5Avg: average(last5),
      last10Avg: average(last10),
      seasonAvg: average(values),
      stdDev: standardDeviation(values),
      sampleScore: clamp(values.length, 0, 20),
      homeAvg: homeValues.length ? average(homeValues) : null,
      awayAvg: awayValues.length ? average(awayValues) : null,
      rows,
      restDays: restDaysSince(rows.at(-1)?.date),
      pitchCountAvg: pitches.length ? average(pitches.slice(-5)) : null,
      roleChange: detectRoleChange(values),
    };

    statsCache.set(cacheKey, profile);
    return profile;
  } catch {
    statsCache.set(cacheKey, null);
    return null;
  }
}

async function fetchWnbaStatProfile(playerId, market, cacheKey) {
  try {
    const currentRows = await fetchWnbaGamelogRows(playerId, STAT_SEASON);
    const previousRows =
      currentRows.length < 10 ? await fetchWnbaGamelogRows(playerId, STAT_SEASON - 1) : [];
    const combinedRows = [...previousRows, ...currentRows];
    const values = combinedRows
      .map((row) => wnbaStatValueForMarket(row, market.id))
      .filter((value) => Number.isFinite(value));
    const currentValues = currentRows
      .map((row) => wnbaStatValueForMarket(row, market.id))
      .filter((value) => Number.isFinite(value));
    const minutes = combinedRows
      .map((row) => Number(row.namedStats.minutes))
      .filter((value) => Number.isFinite(value));
    const shotVolume = combinedRows
      .map((row) => madeAttemptedTotal(row.namedStats.fieldGoalsMadeFieldGoalsAttempted || row.namedStats["fieldGoalsMade-fieldGoalsAttempted"]))
      .filter((value) => Number.isFinite(value));
    const freeThrowAttempts = combinedRows
      .map((row) => attemptedStat(row.namedStats.freeThrowsMadeFreeThrowsAttempted || row.namedStats["freeThrowsMade-freeThrowsAttempted"]))
      .filter((value) => Number.isFinite(value));
    const turnovers = combinedRows
      .map((row) => Number(row.namedStats.turnovers))
      .filter((value) => Number.isFinite(value));
    const assists = combinedRows
      .map((row) => Number(row.namedStats.assists))
      .filter((value) => Number.isFinite(value));
    const currentDates = currentRows.map((row) => row.date).filter(Boolean);

    if (values.length === 0) {
      statsCache.set(cacheKey, null);
      return null;
    }

    const last5 = values.slice(-5);
    const last10 = values.slice(-10);
    const profile = {
      games: values.length,
      last5,
      last5Avg: average(last5),
      last10Avg: average(last10),
      seasonAvg: currentValues.length ? average(currentValues) : average(values),
      stdDev: standardDeviation(values),
      sampleScore: clamp(values.length, 0, 20),
      rows: combinedRows.map((row, index) => ({ ...row, value: values[index] })).filter((row) => Number.isFinite(row.value)),
      minutesAvg: minutes.length ? average(minutes.slice(-10)) : null,
      shotVolumeAvg: shotVolume.length ? average(shotVolume.slice(-10)) : null,
      touchesAvg: averageRecentSum([shotVolume, freeThrowAttempts, turnovers, assists], 10),
      usageRate: estimateUsageRate(shotVolume, freeThrowAttempts, turnovers, minutes),
      restDays: restDaysSince(currentDates.at(-1)),
      roleChange: detectRoleChange(minutes),
    };

    statsCache.set(cacheKey, profile);
    return profile;
  } catch {
    statsCache.set(cacheKey, null);
    return null;
  }
}

async function fetchWnbaGamelogRows(playerId, season) {
  const response = await fetch(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${playerId}/gamelog?season=${season}`
  );
  if (!response.ok) return [];

  const data = await response.json();
  const names = data.names || [];
  const regularSeason =
    Object.values(data.seasonTypes || {}).find((item) =>
      /regular season/i.test(item.displayName || "")
    ) || Object.values(data.seasonTypes || {})[0];

  return (regularSeason?.categories || [])
    .flatMap((category) => category.events || [])
    .map((event) => ({
      eventId: String(event.eventId),
      date: event.gameDate || event.date,
      namedStats: names.reduce((stats, name, index) => {
        stats[name] = event.stats?.[index];
        return stats;
      }, {}),
    }))
    .reverse();
}

function wnbaStatValueForMarket(row, marketId) {
  const stats = row.namedStats || {};
  const points = Number(stats.points);
  const rebounds = Number(stats.totalRebounds);
  const assists = Number(stats.assists);
  const turnovers = Number(stats.turnovers);
  const steals = Number(stats.steals);
  const blocks = Number(stats.blocks);
  const threes = madeStat(stats["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);

  if (marketId === "Points") return points;
  if (marketId === "Rebounds") return rebounds;
  if (marketId === "Assists") return assists;
  if (marketId === "Turnovers") return turnovers;
  if (marketId === "3PM") return threes;
  if (marketId === "PRA") return points + rebounds + assists;
  if (marketId === "Pts+Reb") return points + rebounds;
  if (marketId === "Pts+Ast") return points + assists;
  if (marketId === "Reb+Ast") return rebounds + assists;
  if (marketId === "Steals") return steals;
  if (marketId === "Blocks") return blocks;
  return null;
}

function madeStat(value) {
  if (value == null) return null;
  const made = String(value).split("-")[0];
  const number = Number(made);
  return Number.isFinite(number) ? number : null;
}

function madeAttemptedTotal(value) {
  if (value == null) return null;
  const [, attempted] = String(value).split("-");
  const number = Number(attempted);
  return Number.isFinite(number) ? number : null;
}

function attemptedStat(value) {
  return madeAttemptedTotal(value);
}

function averageRecentSum(seriesList, count) {
  const recent = (Array.isArray(seriesList) ? seriesList : []).map((series) => (Array.isArray(series) ? series : []).slice(-count));
  const maxLength = Math.max(0, ...recent.map((series) => series.length));
  if (!maxLength) return null;
  const totals = [];

  for (let index = 0; index < maxLength; index += 1) {
    const total = recent.reduce((sum, series) => sum + Number(series[index] || 0), 0);
    totals.push(total);
  }

  return average(totals);
}

function estimateUsageRate(shots, freeThrows, turnovers, minutes) {
  const shotAvg = average(shots.slice(-10));
  const freeThrowAvg = average(freeThrows.slice(-10));
  const turnoverAvg = average(turnovers.slice(-10));
  const minuteAvg = average(minutes.slice(-10));
  if (!minuteAvg) return null;
  return clamp(((shotAvg + 0.44 * freeThrowAvg + turnoverAvg) / minuteAvg) * 100, 0, 60);
}

function detectRoleChange(values) {
  if (!values || values.length < 8) return "stable sample";
  const last3 = average(values.slice(-3));
  const previous7 = average(values.slice(-10, -3));
  const delta = last3 - previous7;
  if (delta >= Math.max(2, previous7 * 0.18)) return "role up";
  if (delta <= -Math.max(2, previous7 * 0.18)) return "role down";
  return "stable role";
}

function restDaysSince(dateValue) {
  if (!dateValue) return null;
  const playedAt = new Date(dateValue).getTime();
  if (!Number.isFinite(playedAt)) return null;
  return Math.max(0, Math.floor((Date.now() - playedAt) / (24 * 60 * 60 * 1000)));
}

function statValueForMarket(stat, marketId) {
  if (marketId === "Pitches Thrown") return Number(stat.pitchesThrown);
  if (marketId === "Strikeouts") return Number(stat.strikeOuts);
  if (marketId === "Pitching Outs") return inningsToOuts(stat.inningsPitched);
  if (marketId === "Hits") return Number(stat.hits);
  if (marketId === "Hits+Runs+RBIs") return Number(stat.hits || 0) + Number(stat.runs || 0) + Number(stat.rbi ?? stat.rbis ?? 0);
  if (marketId === "Total Bases") {
    const totalBases = Number(stat.totalBases ?? stat.totalBase);
    if (Number.isFinite(totalBases)) return totalBases;
    const hits = Number(stat.hits || 0);
    const doubles = Number(stat.doubles || 0);
    const triples = Number(stat.triples || 0);
    const homeRuns = Number(stat.homeRuns || 0);
    return hits + doubles + triples * 2 + homeRuns * 3;
  }
  if (marketId === "Runs") return Number(stat.runs);
  if (marketId === "RBIs") return Number(stat.rbi ?? stat.rbis);
  if (marketId === "Fantasy Points") {
    const outs = inningsToOuts(stat.inningsPitched);
    const strikeouts = Number(stat.strikeOuts || 0);
    const earnedRuns = Number(stat.earnedRuns || 0);
    const wins = Number(stat.wins || 0);
    return outs + strikeouts * 3 + wins * 6 - earnedRuns * 3;
  }
  return null;
}

function inningsToOuts(inningsPitched) {
  if (inningsPitched == null) return null;
  const [whole, partial = "0"] = String(inningsPitched).split(".");
  const outs = Number(whole) * 3 + Number(partial);
  return Number.isFinite(outs) ? outs : null;
}

function findPlayerContext(contexts, playerName) {
  const wanted = normalizeKey(playerName);
  return (
    contexts.find((context) => normalizeKey(context.player) === wanted) ||
    contexts.find((context) => {
      const candidate = normalizeKey(context.player);
      return candidate.includes(wanted) || wanted.includes(candidate);
    })
  );
}

function makeNoBetLine(line, market, reason, context, profile) {
  const noBetWarning = formatNoBetWarning(reason);
  const recommendationLabel = isLineNeededReason(reason) ? "Line Needed" : "Pass";

  return {
    id: `${line.player}-${market.id}-${line.line || "no-line"}-No Bet-${line.book || "Unknown"}`,
    sport: market.sport,
    playerId: context?.id,
    gameId: context?.game?.id,
    group: market.group,
    player: context?.player || line.player,
    team: context?.team || "TBD",
    opponent: context?.opponent || "TBD",
    prop: market.id,
    line: line.line,
    odds: line.odds?.over ?? line.odds?.under ?? null,
    book: line.book || "Unknown",
    bestSportsbook: line.book || "Unknown",
    pick: "No Bet",
    confidence: 0,
    season_avg: profile?.seasonAvg || 0,
    last5Avg: profile?.last5Avg || 0,
    last10Avg: profile?.last10Avg || 0,
    hit_rate_pct: 0,
    impliedProbability: line.odds?.over ? Math.round(americanToImpliedProbability(line.odds.over) * 100) : 0,
    edgePct: 0,
    ev: 0,
    evPct: 0,
    rawProbability: 0,
    displayProbability: 0,
    consensusScore: 0,
    rankScore: 0,
    confidenceTier: "Tier D",
    sportsbookValue: 0,
    marketAverageLine: line.line || 0,
    marketBookCount: 0,
    marketBooks: [],
    bestBookReason: "No sportsbook value until a usable line is loaded.",
    mathExplanation: reason,
    aiExplanation: "No explanation generated because the recommendation engine marked this as Pass.",
    contextFilters: reason,
    trendAnalysis: "No trend analysis until a player profile and line are available.",
    usageAnalysis: "No usage analysis until a player profile and line are available.",
    projectedDiff: 0,
    volatility: 1,
    consistencyScore: 0,
    lineMoveValue: 0,
    historicalOdds: "No odds history yet",
    realityFlags: [],
    marketMovement: { label: "No market movement", score: 0 },
    clvScore: 0,
    trustScore: 0,
    simulation: null,
    sportsbookTable: [],
    bankrollPct: 0,
    last5: profile?.last5 || [],
    edge_score: 0,
    risk: "High",
    bankroll: bankrollForRisk("High"),
    bankrollPct: 0,
    isNoBet: true,
    recommendation: recommendationLabel,
    recommendationText: recommendationLabel,
    suggestedUnits: "0u",
    noBetWarning,
    reason,
    key_edge: noBetWarning,
    lineMovement: getLineMovement(line, "No Bet"),
    clv: getClosingLineValue(line, "No Bet"),
    result: getStoredResult(line, "No Bet"),
    injuryStatus: context?.injuryStatus || "Unknown",
    usage: context?.role || "Unknown",
  };
}

function formatNoBetWarning(reason) {
  return `${isLineNeededReason(reason) ? "LINE NEEDED" : "PASS"}: ${reason}`;
}

function isLineNeededReason(reason) {
  return /load sportsbook|no sportsbook|odds api key|real line|american odds/i.test(reason || "");
}

function americanToImpliedProbability(odds) {
  const price = Number(odds);
  if (!Number.isFinite(price) || price === 0) return 0;
  return price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
}

function estimateModelProbability(projection, line, stdDev, market) {
  const lowVolumeMarket = ["Hits", "Runs", "RBIs", "3PM", "Steals", "Blocks"].includes(market?.id);
  const spread = Math.max(lowVolumeMarket ? 0.65 : 0.8, stdDev || 1.2);
  const z = (projection - line) / spread;
  return clamp(1 / (1 + Math.exp(-1.25 * z)), 0.05, 0.95);
}

function getMatchupAdjustment(market, context) {
  if (market.group === "basketball") {
    const isHome = context.team === context.game.homeAbbr;
    const homeBoost = isHome ? 0.28 : -0.08;
    const lowVolumeMarket = ["Turnovers", "3PM", "Steals", "Blocks"].includes(market.id);
    const base = lowVolumeMarket ? homeBoost * 0.35 : homeBoost;
    const pace = clamp(((context.paceRating || 1) - 1) * 2.5, -0.2, 0.2);
    const defense = clamp(((context.defensiveRating || 1) - 1) * 2.2, -0.22, 0.22);
    return base + pace + defense;
  }

  const opponent = getTeamContext(context.opponent);
  const park = getTeamContext(context.game.homeAbbr);

  if (market.group === "pitching") {
    const runPrevention = 1 - opponent.offense;
    const contactBoost = 1 - opponent.contact;
    const parkPenalty = 1 - park.park;

    const umpire = context.umpireRating || 0;
    const weather = context.weatherRating || 0;

    if (market.id === "Strikeouts") return contactBoost * 6 + runPrevention * 1.5 + umpire * 3;
    if (market.id === "Pitching Outs") return runPrevention * 4 + parkPenalty * 1.4 - weather * 1.2;
    return runPrevention * 5 + contactBoost * 3 + parkPenalty * 2 - weather * 4 + umpire * 2;
  }

  const team = getTeamContext(context.team);
  const offensiveBoost = (team.offense - 1) * 0.55;
  const parkBoost = (park.park - 1) * 0.45;
  const contactBoost = market.id === "Hits" ? (team.contact - 1) * 0.9 : 0;
  const powerBoost = market.id === "RBIs" || market.id === "Runs" ? (team.power - 1) * 0.5 : 0;
  const weatherBoost = (context.weatherRating || 0) * 0.45;
  const umpireBoost = (context.umpireRating || 0) * 0.18;
  const handednessBoost = getHandednessAdjustment(context) * 0.35;
  return offensiveBoost + parkBoost + contactBoost + powerBoost + weatherBoost + umpireBoost + handednessBoost;
}

function getHandednessAdjustment(context) {
  const batter = context.batSide;
  const pitcher = context.opponentPitchHand;
  if (!batter || !pitcher || batter === "S") return 0.04;
  return batter !== pitcher ? 0.08 : -0.04;
}

function getRisk(edge, confidence, profile, probability) {
  if (profile.games < 10 || edge < MIN_EDGE) return "High";
  if (confidence < MIN_CONFIDENCE) return "High";
  if (probability < 0.54) return "High";
  if (edge >= 0.08 && confidence >= 70 && probability >= 0.6 && profile.stdDev <= Math.max(1.5, profile.seasonAvg * 0.75)) {
    return "Low";
  }
  if (edge >= MIN_EDGE && confidence >= 58) return "Medium";
  return "High";
}

function getTennisRisk(edge, confidence, profile, probability, line, side) {
  const reasons = getTennisSafetyReasons(profile, line, side, edge, confidence, probability);
  if (reasons.length > 0) return "High";
  if (profile.tennis?.injuryRisk >= 0.12 || profile.tennis?.fatigue >= 0.16) return "Medium";
  if (edge >= 0.09 && confidence >= 70 && probability >= 0.6) return "Low";
  return "Medium";
}

function getTennisSafetyReasons(profile, line, side, edge, confidence, probability) {
  const reasons = [];
  const components = profile.tennis;
  const startTime = line.commenceTime ? new Date(line.commenceTime).getTime() : null;
  if (!components) reasons.push("tennis component data is missing.");
  if (Number.isFinite(startTime) && startTime <= Date.now() + 10 * 60 * 1000) {
    reasons.push("match starts in less than 10 minutes.");
  }
  if (components?.injuryRisk >= 0.2) reasons.push("retirement/injury risk is high.");
  if (components?.fatigue >= 0.32) reasons.push("fatigue risk is extreme.");
  if (
    line.market === "Total Games" &&
    side === "Over" &&
    components &&
    Math.abs(components.winProbability - 0.5) >= 0.36
  ) {
    reasons.push("huge favorite makes the total-games over fragile.");
  }
  return reasons;
}

function classifyRisk(profile, market, line, side, flags, marketMovement) {
  const volatilityRatio = profile.stdDev / Math.max(1, profile.seasonAvg || line.line || 1);
  const uncertainty = getUncertaintyScore(profile, market, line, side, flags, marketMovement);
  if (uncertainty >= 0.66 || volatilityRatio >= 0.95) return "High";
  if (uncertainty >= 0.36 || volatilityRatio >= 0.55) return "Medium";
  return "Low";
}

function getUncertaintyScore(profile, market, line, side, flags, marketMovement) {
  const volatilityRatio = profile.stdDev / Math.max(1, profile.seasonAvg || line.line || 1);
  const sampleRisk = profile.games < 10 ? 0.35 : profile.games < 20 ? 0.18 : 0.05;
  const marketRisk = marketMovement.score < -0.3 ? 0.18 : marketMovement.reverse ? 0.12 : 0;
  const flagRisk = Math.min(0.22, (flags || []).length * 0.055);
  const tennisRisk = market.group === "tennis" ? Math.max(profile.tennis?.injuryRisk || 0, profile.tennis?.fatigue || 0) : 0;
  return clamp(volatilityRatio * 0.35 + sampleRisk + marketRisk + flagRisk + tennisRisk * 0.5, 0, 1);
}

function bankrollForRisk(risk) {
  if (risk === "Low") return "1% bankroll";
  if (risk === "Medium") return "0.5% bankroll";
  return "No bet";
}

function buildReason(best, market, context, profile, line) {
  const oddsSource = line.odds?.[best.pick.toLowerCase()] == null
    ? `No ${best.pick.toLowerCase()} price was pasted, so the model used a conservative ${DEFAULT_PASTED_ODDS} breakeven assumption.`
    : "";
  const factorText = best.factors
    ? `Projection factors: matchup ${signedRound(best.factors.matchupAdjustment)}, usage ${signedRound(best.factors.usageAdjustment)}, trend ${signedRound(best.factors.trendAdjustment)}, volatility ${signedRound(best.factors.volatilityDrag)}.`
    : "";

  return [
    `${best.pick} ${line.line} at ${line.book}: projection ${roundTo(best.projectedMean, 1)}, model probability ${Math.round(best.modelProbability * 100)}%, bet confidence ${best.confidence}%, implied ${Math.round(best.impliedProbability * 100)}%, ${signedRound(best.ev * 100)}% EV, and ${signedRound(best.edge * 100)}% edge.`,
    `Last 5 avg ${roundTo(profile.last5Avg, 1)}, last 10 avg ${roundTo(profile.last10Avg, 1)}, season avg ${roundTo(profile.seasonAvg, 1)}.`,
    factorText,
    `Usage: ${context.role}. Injury status: ${context.injuryStatus}. Opponent: ${context.opponent}.`,
    oddsSource,
  ].filter(Boolean).join(" ");
}

function formatUsage(market, context, profile) {
  if (market.group === "tennis") {
    const t = profile.tennis;
    return `tennis components; hold ${Math.round(t.holdPct * 100)}%; break ${Math.round(t.breakPct * 100)}%; projected sets ${roundTo(t.expectedSets, 2)}; ${t.bestOf === 5 ? "best-of-5" : "best-of-3"}`;
  }

  if (market.group === "basketball") {
    return `${context.role}; ${formatMaybe(profile.minutesAvg, " MPG")}; usage ${formatMaybe(profile.usageRate, "%")}; touches ${formatMaybe(profile.touchesAvg)}; ${formatMaybe(profile.shotVolumeAvg, " FGA")}; pace ${roundTo(context.paceRating || 1, 2)}`;
  }

  if (market.group === "pitching") {
    return `${context.role}; ${formatMaybe(profile.pitchCountAvg, " pitches")}; ${formatRestDays(profile.restDays)}; hand ${context.pitchHand || "TBD"}`;
  }

  return `${context.role}; ${context.batSide || "?"} vs ${context.opponentPitchHand || "?"}; ${formatRestDays(profile.restDays)}`;
}

function keepBestSportsbookPerPlayer(picks) {
  const bestByKey = new Map();

  picks.forEach((pick) => {
    const key = `${normalizeKey(pick.player)}-${pick.prop}-${pick.pick}`;
    const current = bestByKey.get(key);
    if (!current || (pick.rankScore || pick.edge_score) > (current.rankScore || current.edge_score)) {
      bestByKey.set(key, pick);
    }
  });

  return Array.from(bestByKey.values());
}

function getTopProbablePicks(picks) {
  return (picks || [])
    .filter((pick) => !pick.isNoBet && ["Over", "Under"].includes(pick.pick))
    .sort(sortStablePicks)
    .slice(0, 3);
}

function average(values) {
  const safeValues = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function standardDeviation(values) {
  const safeValues = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (safeValues.length < 2) return 1;
  const mean = average(safeValues);
  const variance = average(safeValues.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function opponentPitcherName(game, team) {
  return team === game.awayAbbr ? game.homePitcher : game.awayPitcher;
}

function lineStorageKey(line, pick) {
  return `${normalizeKey(line.player)}-${normalizeKey(line.market || "")}-${line.book}-${pick}`;
}

function readLineTracker() {
  try {
    return JSON.parse(window.localStorage.getItem("mlb-edge-line-tracker") || "{}");
  } catch {
    return {};
  }
}

function writeLineTracker(value) {
  window.localStorage.setItem("mlb-edge-line-tracker", JSON.stringify(value));
}

function trackLineSnapshot(line, pick) {
  const tracker = readLineTracker();
  const key = lineStorageKey(line, pick);
  const current = tracker[key] || {
    openingLine: line.line,
    openingOdds: line.odds?.[pick.toLowerCase()],
    firstSeen: new Date().toISOString(),
  };

  current.latestLine = line.line;
  current.latestOdds = line.odds?.[pick.toLowerCase()];
  current.lastSeen = new Date().toISOString();
  tracker[key] = current;
  writeLineTracker(tracker);
}

function getLineMovement(line, pick) {
  const tracker = readLineTracker()[lineStorageKey(line, pick)];
  if (!tracker) return "First seen";
  const move = roundTo((tracker.latestLine ?? line.line) - tracker.openingLine, 2);
  return move === 0 ? "No move" : `${move > 0 ? "+" : ""}${move} from first seen`;
}

function getLineMoveValue(line, pick) {
  const tracker = readLineTracker()[lineStorageKey(line, pick)];
  if (!tracker) return 0;
  const move = (tracker.latestLine ?? line.line) - tracker.openingLine;
  if (!Number.isFinite(move)) return 0;
  return pick === "Over" ? -move : move;
}

function getClosingLineValue(line, pick) {
  const tracker = readLineTracker()[lineStorageKey(line, pick)];
  if (!tracker) return "Pending";
  const opening = tracker.openingLine ?? line.line;
  const latest = tracker.latestLine ?? line.line;
  const value = pick === "Over" ? latest - opening : opening - latest;
  return `${value >= 0 ? "+" : ""}${roundTo(value, 2)} line CLV`;
}

function buildHistoricalOddsComparison(line, pick) {
  const tracker = readLineTracker()[lineStorageKey(line, pick)];
  if (!tracker) return "First tracked price";
  const openingOdds = tracker.openingOdds;
  const latestOdds = tracker.latestOdds;
  const priceMove = Number.isFinite(Number(openingOdds)) && Number.isFinite(Number(latestOdds))
    ? Number(latestOdds) - Number(openingOdds)
    : 0;
  const priceText = priceMove === 0 ? "price unchanged" : `${priceMove > 0 ? "+" : ""}${priceMove} odds move`;
  return `Opened ${tracker.openingLine} (${formatAmericanOdds(openingOdds)}), latest ${tracker.latestLine} (${formatAmericanOdds(latestOdds)}), ${priceText}`;
}

function getMarketMovementSignal(line, pick) {
  const tracker = readLineTracker()[lineStorageKey(line, pick)];
  if (!tracker) return { label: "No market movement yet", score: 0, velocity: 0, steam: false, reverse: false };

  const lineMove = getLineMoveValue(line, pick);
  const oddsMove = Number(tracker.latestOdds || 0) - Number(tracker.openingOdds || 0);
  const hours = Math.max(0.25, (new Date(tracker.lastSeen || Date.now()).getTime() - new Date(tracker.firstSeen || Date.now()).getTime()) / (60 * 60 * 1000));
  const velocity = lineMove / hours;
  const steam = Math.abs(velocity) >= 0.15 || Math.abs(oddsMove) >= 18;
  const reverse = lineMove < -0.15 && oddsMove > 10;
  const score = clamp(lineMove * 0.7 + (pick === "Over" ? -oddsMove : oddsMove) / 250, -1, 1);
  const direction = score > 0.08 ? "supports pick" : score < -0.08 ? "against pick" : "neutral";

  return {
    label: `${direction}; opening ${tracker.openingLine}, current ${tracker.latestLine}, velocity ${roundTo(velocity, 2)}/hr${steam ? ", steam move" : ""}${reverse ? ", reverse movement" : ""}`,
    score,
    velocity,
    steam,
    reverse,
  };
}

function getHistoricalClvTrust(marketId, sportId) {
  const predictions = Object.values(readJsonStore(SHARP_PREDICTIONS_KEY));
  const settled = predictions.filter((pick) =>
    pick.market === marketId && pick.sport === sportId && Number.isFinite(Number(pick.clvScore))
  );
  if (!settled.length) return 0;
  return clamp(average(settled.map((pick) => Number(pick.clvScore))) / 2, -1, 1);
}

function getModelTrustScore(sportId, marketId) {
  const predictions = Object.values(readJsonStore(SHARP_PREDICTIONS_KEY));
  const settled = predictions.filter((pick) =>
    pick.sport === sportId && pick.market === marketId && ["Win", "Loss"].includes(pick.resultStatus)
  );
  if (settled.length < 20) return 0;

  const wins = settled.filter((pick) => pick.resultStatus === "Win").length;
  const winRate = wins / settled.length;
  const avgProb = average(settled.map((pick) => Number(pick.modelProbability || 0) / 100));
  return clamp((winRate - avgProb) * 2, -1, 1);
}

function getRealityFlags({ rawProbability, probability, ev, edge, impliedProbability, consensusScore, marketMovement }) {
  const flags = [];
  if (rawProbability > MAX_DISPLAY_PROBABILITY) flags.push("raw probability compressed");
  if (ev > 0.25) flags.push("EV outlier");
  if (edge > 0.3) flags.push("edge outlier");
  if (Math.abs(probability - impliedProbability) >= 0.24) flags.push("major market disagreement");
  if (consensusScore < -6) flags.push("consensus strongly disagrees");
  if (marketMovement?.score < -0.45) flags.push("market moving sharply against pick");
  return flags;
}

function runMonteCarloSimulation(mean, stdDev, line, side, seed, iterations = 2500) {
  const values = [];
  let hits = 0;

  for (let index = 0; index < iterations; index += 1) {
    const value = seededNormal(mean, Math.max(0.5, stdDev || 1), `${seed}-${index}`);
    values.push(value);
    if (side === "Over" ? value > line : value < line) hits += 1;
  }

  values.sort((a, b) => a - b);
  return {
    probability: hits / iterations,
    median: roundTo(percentile(values, 0.5), 2),
    low: roundTo(percentile(values, 0.1), 2),
    high: roundTo(percentile(values, 0.9), 2),
    volatility: roundTo(standardDeviation(values), 2),
  };
}

function seededNormal(mean, stdDev, seed) {
  const u1 = Math.max(0.0001, tennisSeededNumber(`${seed}-a`, 0.0001, 0.9999));
  const u2 = Math.max(0.0001, tennisSeededNumber(`${seed}-b`, 0.0001, 0.9999));
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function percentile(values, p) {
  const safeValues = Array.isArray(values) ? values : [];
  if (!safeValues.length) return 0;
  const index = clamp(Math.floor((safeValues.length - 1) * p), 0, safeValues.length - 1);
  return safeValues[index];
}

function calculateKellyStake(probability, odds, profile, risk) {
  const decimalOdds = americanToDecimalOdds(odds);
  if (!decimalOdds || decimalOdds <= 1) return 0;
  const b = decimalOdds - 1;
  const q = 1 - probability;
  const fullKelly = (b * probability - q) / b;
  const volatilityAdjustment = 1 - clamp(profile.stdDev / Math.max(1, profile.seasonAvg || 1), 0, 0.8);
  const riskMultiplier = risk === "High" ? 0.22 : risk === "Medium" ? 0.55 : 1;
  const fractionalKelly = fullKelly * 0.25 * volatilityAdjustment * riskMultiplier;
  return roundTo(clamp(fractionalKelly, 0, 0.015) * 100, 2);
}

function bankrollForKelly(best, profile) {
  const pct = calculateKellyStake(best.modelProbability, best.odds, profile, best.risk);
  if (pct <= 0) return "No bet";
  return `${pct}% bankroll`;
}

function buildSportsbookComparison(line, pick) {
  const books = line.consensus?.books || [line.book].filter(Boolean);
  return books.slice(0, 8).map((book) => ({
    book,
    marketAverageLine: line.consensus?.avgLine,
    bestLine: pick === "Over" ? line.consensus?.bestOverLine : line.consensus?.bestUnderLine,
    currentLine: line.line,
    value: getSportsbookValue({ ...line, book }, pick, line.odds?.[pick.toLowerCase()]),
  }));
}

function readJsonStore(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function writeJsonStore(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function saveSharpPredictionDatabase(picks) {
  const current = readJsonStore(SHARP_PREDICTIONS_KEY);
  const now = new Date().toISOString();

  picks.forEach((pick) => {
    const key = [
      getLocalDateISO(),
      pick.sport,
      normalizeKey(pick.player),
      normalizeKey(pick.prop),
      pick.line,
      pick.pick,
      normalizeKey(pick.bestSportsbook || pick.book),
    ].join("-");

    current[key] = {
      ...(current[key] || {}),
      id: key,
      sport: pick.sport,
      player: pick.player,
      team: pick.team,
      opponent: pick.opponent,
      market: pick.prop,
      sportsbook: pick.bestSportsbook || pick.book,
      line: pick.line,
      odds: pick.odds,
      modelProbability: pick.displayProbability || pick.hit_rate_pct,
      rawProbability: pick.rawProbability,
      impliedProbability: pick.impliedProbability,
      edge: pick.edgePct,
      ev: pick.evPct,
      resultStatus: current[key]?.resultStatus || "Pending",
      finalResult: current[key]?.finalResult ?? null,
      clv: pick.clv,
      clvScore: pick.lineMoveValue || 0,
      createdAt: current[key]?.createdAt || now,
      updatedAt: now,
      confidenceTier: pick.confidenceTier,
      realityFlags: pick.realityFlags,
    };
  });

  writeJsonStore(SHARP_PREDICTIONS_KEY, current);
}

function buildSharpAnalyticsSummary() {
  if (typeof window === "undefined") return emptySharpSummary();
  const rows = Object.values(readJsonStore(SHARP_PREDICTIONS_KEY));
  if (!rows.length) return emptySharpSummary();

  const settled = rows.filter((row) => ["Win", "Loss"].includes(row.resultStatus));
  const wins = settled.filter((row) => row.resultStatus === "Win").length;
  const profit = rows.reduce((sum, row) => sum + Number(row.profitLoss || 0), 0);
  const clvRows = rows.filter((row) => Number.isFinite(Number(row.clvScore)));
  const calibration = calibrationBuckets(settled);

  return {
    total: rows.length,
    settled: settled.length,
    roi: settled.length ? profit / settled.length : 0,
    winRate: settled.length ? wins / settled.length : 0,
    avgClv: clvRows.length ? average(clvRows.map((row) => Number(row.clvScore))) : 0,
    bySport: summarizeSharpRows(rows, "sport"),
    byMarket: summarizeSharpRows(rows, "market"),
    byBook: summarizeSharpRows(rows, "sportsbook"),
    byTier: summarizeSharpRows(rows, "confidenceTier"),
    calibration,
  };
}

function emptySharpSummary() {
  return {
    total: 0,
    settled: 0,
    roi: 0,
    winRate: 0,
    avgClv: 0,
    bySport: [],
    byMarket: [],
    byBook: [],
    byTier: [],
    calibration: [],
  };
}

function summarizeSharpRows(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = row[key] || "Unknown";
    const group = groups.get(label) || { label, total: 0, settled: 0, wins: 0, profit: 0 };
    group.total += 1;
    if (["Win", "Loss"].includes(row.resultStatus)) {
      group.settled += 1;
      if (row.resultStatus === "Win") group.wins += 1;
      group.profit += Number(row.profitLoss || 0);
    }
    groups.set(label, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      winRate: group.settled ? group.wins / group.settled : 0,
      roi: group.settled ? group.profit / group.settled : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

function calibrationBuckets(rows) {
  const buckets = [
    { label: "50-55", min: 50, max: 55 },
    { label: "56-60", min: 56, max: 60 },
    { label: "61-65", min: 61, max: 65 },
    { label: "66-70", min: 66, max: 70 },
    { label: "71-78", min: 71, max: 78 },
  ];

  return buckets.map((bucket) => {
    const picks = rows.filter((row) => Number(row.modelProbability) >= bucket.min && Number(row.modelProbability) <= bucket.max);
    const wins = picks.filter((row) => row.resultStatus === "Win").length;
    return {
      label: bucket.label,
      count: picks.length,
      expected: picks.length ? average(picks.map((row) => Number(row.modelProbability) / 100)) : 0,
      actual: picks.length ? wins / picks.length : 0,
    };
  });
}

function trackEvaluatedPick(line, pick, context, market) {
  const tracked = readJsonStore("mlb-edge-tracked-picks");
  const key = lineStorageKey(line, pick);
  const lineTracker = readLineTracker()[key];

  tracked[key] = {
    key,
    player: context.player,
    playerId: context.id,
    gameId: context.game.id,
    sportId: market.sport,
    marketId: market.id,
    group: market.group,
    pick,
    line: lineTracker?.openingLine ?? line.line,
    latestLine: line.line,
    book: line.book,
    openingOdds: lineTracker?.openingOdds ?? line.odds?.[pick.toLowerCase()],
    latestOdds: line.odds?.[pick.toLowerCase()],
    marketAvgLine: line.consensus?.avgLine,
    marketBookCount: line.consensus?.bookCount,
    trackedAt: new Date().toISOString(),
  };

  writeJsonStore("mlb-edge-tracked-picks", tracked);
}

async function updateTrackedResults(games) {
  const tracked = readJsonStore("mlb-edge-tracked-picks");
  const results = readJsonStore("mlb-edge-results");
  const trackedItems = Object.values(tracked);
  if (trackedItems.length === 0) return;

  for (const item of trackedItems) {
    if (results[item.key]?.status && results[item.key].status !== "Pending") continue;

    const game = games.find((candidate) => String(candidate.id) === String(item.gameId));
    if (!game || !/final|completed|game over/i.test(game.status)) continue;

    const actual = await fetchActualResult(item);
    if (!Number.isFinite(actual)) continue;

    const status =
      actual === item.line
        ? "Push"
        : item.pick === "Over"
        ? actual > item.line
          ? "Win"
          : "Loss"
        : actual < item.line
        ? "Win"
        : "Loss";

    results[item.key] = {
      status,
      actual,
      profit: resultProfit(status, item.openingOdds || item.latestOdds || DEFAULT_PASTED_ODDS),
      sportId: item.sportId,
      marketId: item.marketId,
      book: item.book,
      settledAt: new Date().toISOString(),
    };
  }

  writeJsonStore("mlb-edge-results", results);
}

async function fetchActualResult(item) {
  if (item.sportId === "WNBA" || item.group === "basketball") {
    return fetchWnbaActualResult(item);
  }

  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/game/${item.gameId}/boxscore`);
    if (!response.ok) return null;

    const boxscore = await response.json();
    const player =
      boxscore.teams?.away?.players?.[`ID${item.playerId}`] ||
      boxscore.teams?.home?.players?.[`ID${item.playerId}`];
    const statGroup = item.group === "pitching" ? "pitching" : "batting";
    return statValueForMarket(player?.stats?.[statGroup] || {}, item.marketId);
  } catch {
    return null;
  }
}

async function fetchWnbaActualResult(item) {
  try {
    const rows = await fetchWnbaGamelogRows(item.playerId, STAT_SEASON);
    const row = rows.find((candidate) => candidate.eventId === String(item.gameId));
    return row ? wnbaStatValueForMarket(row, item.marketId) : null;
  } catch {
    return null;
  }
}

function resultProfit(status, odds) {
  if (status === "Push") return 0;
  if (status === "Win") return roundTo(americanProfitPerDollar(odds), 3);
  if (status === "Loss") return -1;
  return 0;
}

function getStoredResult(line, pick) {
  const result = readJsonStore("mlb-edge-results")[lineStorageKey(line, pick)];
  if (!result) return "Pending";
  return result.actual != null ? `${result.status} (${result.actual})` : result.status || "Pending";
}

function readPropsHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROPS_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePropsHistory(history) {
  window.localStorage.setItem(PROPS_HISTORY_KEY, JSON.stringify(history));
}

function propsHistoryIdFromPick(pick, date = getLocalDateISO()) {
  return [
    date,
    pick.sport || "MLB",
    normalizeKey(pick.player),
    normalizeKey(pick.prop),
    pick.line,
    pick.pick,
    normalizeKey(pick.bestSportsbook || pick.book),
  ].join("-");
}

function savePropsToHistory(picks) {
  const history = readPropsHistory();
  const existing = new Set(history.map((pick) => pick.id));
  const createdAt = new Date().toISOString();
  const date = getLocalDateISO();
  let added = 0;

  const next = [...history];
  picks
    .filter((pick) => !pick.isNoBet && ["Over", "Under"].includes(pick.pick) && Number.isFinite(pick.line))
    .filter((pick) => !pick.watchlistOnly)
    .forEach((pick) => {
      const id = propsHistoryIdFromPick(pick, date);
      if (existing.has(id)) return;
      existing.add(id);
      added += 1;
      next.push(makePropsHistoryEntry(pick, id, date, createdAt));
    });

  writePropsHistory(next);
  return { history: next, added };
}

function makePropsHistoryEntry(pick, id, date, createdAt) {
  return {
    id,
    date,
    sport: pick.sport || "MLB",
    market: pick.prop,
    player: pick.player,
    playerId: pick.playerId,
    gameId: pick.gameId,
    group: pick.group,
    team: pick.team,
    opponent: pick.opponent,
    pickSide: pick.pick,
    propLine: pick.line,
    sportsbook: pick.bestSportsbook || pick.book,
    odds: pick.odds,
    modelProbability: pick.hit_rate_pct,
    impliedProbability: pick.impliedProbability,
    edgePct: pick.edgePct,
    ev: pick.evPct,
    confidence: pick.confidence,
    confidenceTier: confidenceTierFromScore(pick.confidence),
    risk: pick.risk,
    propScore: pick.propScore,
    volatilityScore: pick.volatilityScore,
    event: pick.event,
    startTime: pick.startTime,
    dateGenerated: pick.dateGenerated || createdAt,
    reason: pick.reason,
    stableReasonSummary: pick.stableReasonSummary,
    resultStatus: "Pending",
    actualResult: null,
    profitLoss: 0,
    createdAt,
    settledAt: null,
  };
}

function confidenceTierFromScore(confidence) {
  if (confidence >= 75) return "A";
  if (confidence >= 65) return "B";
  if (confidence >= 58) return "C";
  return "D";
}

function settlePropsHistoryPick(pick, status, actualResult = pick.actualResult) {
  const isSettled = ["Win", "Loss", "Push"].includes(status);
  return {
    ...pick,
    resultStatus: status,
    actualResult: Number.isFinite(actualResult) ? actualResult : pick.actualResult,
    profitLoss: profitForPropsResult(status, pick.odds),
    settledAt: isSettled ? new Date().toISOString() : null,
  };
}

function profitForPropsResult(status, odds) {
  if (status === "Win") return roundTo(americanProfitPerDollar(odds), 3);
  if (status === "Loss") return -1;
  return 0;
}

async function fetchActualResultFromSavedPick(pick) {
  if (!pick.playerId || !pick.gameId || !pick.market) return null;
  return fetchActualResult({
    sportId: pick.sport,
    group: pick.group,
    playerId: pick.playerId,
    gameId: pick.gameId,
    marketId: pick.market,
  });
}

function buildPropsTrackerSummary(history) {
  const wins = history.filter((pick) => pick.resultStatus === "Win").length;
  const losses = history.filter((pick) => pick.resultStatus === "Loss").length;
  const pushes = history.filter((pick) => pick.resultStatus === "Push").length;
  const pending = history.filter((pick) => pick.resultStatus === "Pending").length;
  const graded = wins + losses;
  const risked = wins + losses + pushes;
  const profit = history.reduce((sum, pick) => sum + Number(pick.profitLoss || 0), 0);

  return {
    total: history.length,
    wins,
    losses,
    pushes,
    pending,
    winRate: graded ? wins / graded : 0,
    roi: risked ? profit / risked : 0,
    profit,
    bySport: summarizePropsAccuracy(history, "sport"),
    byMarket: summarizePropsAccuracy(history, "market"),
    byTier: summarizePropsAccuracy(history, "confidenceTier"),
    last7: summarizePropsPeriod(history, 7),
    last30: summarizePropsPeriod(history, 30),
  };
}

function summarizePropsPeriod(history, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = history.filter((pick) => {
    const created = new Date(pick.createdAt || pick.dateGenerated || pick.date).getTime();
    return Number.isFinite(created) && created >= cutoff;
  });
  const wins = rows.filter((pick) => pick.resultStatus === "Win").length;
  const losses = rows.filter((pick) => pick.resultStatus === "Loss").length;
  const pushes = rows.filter((pick) => pick.resultStatus === "Push").length;
  const graded = wins + losses;
  const risked = wins + losses + pushes;
  const profit = rows.reduce((sum, pick) => sum + Number(pick.profitLoss || 0), 0);

  return {
    total: rows.length,
    winRate: graded ? wins / graded : 0,
    roi: risked ? profit / risked : 0,
    profit,
  };
}

function summarizePropsAccuracy(history, key) {
  const groups = new Map();
  history.forEach((pick) => {
    const label = pick[key] || "Unknown";
    const group = groups.get(label) || { label, wins: 0, losses: 0, pushes: 0, pending: 0, profit: 0 };
    if (pick.resultStatus === "Win") group.wins += 1;
    if (pick.resultStatus === "Loss") group.losses += 1;
    if (pick.resultStatus === "Push") group.pushes += 1;
    if (pick.resultStatus === "Pending") group.pending += 1;
    group.profit += Number(pick.profitLoss || 0);
    groups.set(label, group);
  });

  return Array.from(groups.values()).map((group) => {
    const graded = group.wins + group.losses;
    const risked = group.wins + group.losses + group.pushes;
    return {
      ...group,
      total: group.wins + group.losses + group.pushes + group.pending,
      winRate: graded ? group.wins / graded : 0,
      roi: risked ? group.profit / risked : 0,
    };
  });
}

function filterPropsHistory(history, filters) {
  return history.filter((pick) => {
    if (filters.date !== "All" && pick.date !== filters.date) return false;
    if (filters.sport !== "All" && pick.sport !== filters.sport) return false;
    if (filters.market !== "All" && pick.market !== filters.market) return false;
    if (filters.result !== "All" && pick.resultStatus !== filters.result) return false;
    if (filters.sportsbook !== "All" && pick.sportsbook !== filters.sportsbook) return false;
    if (filters.tier !== "All" && pick.confidenceTier !== filters.tier) return false;
    return true;
  });
}

function buildTrackerFilterOptions(history) {
  const unique = (key) => Array.from(new Set(history.map((pick) => pick[key]).filter(Boolean))).sort();
  return {
    dates: unique("date"),
    sports: unique("sport"),
    markets: unique("market"),
    sportsbooks: unique("sportsbook"),
    tiers: ["A", "B", "C", "D"],
    results: ["Pending", "Win", "Loss", "Push"],
  };
}

function exportPropsHistoryCsv(history) {
  const headers = [
    "id",
    "date",
    "sport",
    "market",
    "player",
    "team",
    "opponent",
    "pickSide",
    "propLine",
    "sportsbook",
    "odds",
    "modelProbability",
    "impliedProbability",
    "edgePct",
    "ev",
    "confidence",
    "confidenceTier",
    "risk",
    "propScore",
    "volatilityScore",
    "event",
    "startTime",
    "dateGenerated",
    "reason",
    "stableReasonSummary",
    "resultStatus",
    "actualResult",
    "profitLoss",
    "createdAt",
    "settledAt",
  ];
  const csv = [
    headers.join(","),
    ...history.map((pick) => headers.map((header) => csvCell(pick[header])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `props-of-the-day-history-${getLocalDateISO()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildHistoricalSummary() {
  if (typeof window === "undefined") {
    return { settled: 0, wins: 0, losses: 0, pushes: 0, winPct: 0, roi: 0, profit: 0, bySport: [], byProp: [], byBook: [] };
  }

  const results = Object.values(readJsonStore("mlb-edge-results")).filter((item) =>
    ["Win", "Loss", "Push"].includes(item.status)
  );
  const settled = results.length;
  const wins = results.filter((item) => item.status === "Win").length;
  const losses = results.filter((item) => item.status === "Loss").length;
  const pushes = results.filter((item) => item.status === "Push").length;
  const profit = results.reduce((sum, item) => sum + Number(item.profit || 0), 0);
  const risked = wins + losses;

  return {
    settled,
    wins,
    losses,
    pushes,
    winPct: risked ? wins / risked : 0,
    roi: risked ? profit / risked : 0,
    profit,
    bySport: summarizeResults(results, "sportId"),
    byProp: summarizeResults(results, "marketId"),
    byBook: summarizeResults(results, "book"),
  };
}

function summarizeResults(results, key) {
  const groups = new Map();
  results.forEach((result) => {
    const label = result[key] || "Unknown";
    const group = groups.get(label) || { label, settled: 0, wins: 0, profit: 0 };
    if (result.status !== "Push") group.settled += 1;
    if (result.status === "Win") group.wins += 1;
    group.profit += Number(result.profit || 0);
    groups.set(label, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      winPct: group.settled ? group.wins / group.settled : 0,
      roi: group.settled ? group.profit / group.settled : 0,
    }))
    .sort((a, b) => b.settled - a.settled || b.roi - a.roi)
    .slice(0, 4);
}

function parseImportedLines(text, defaultMarket) {
  return text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .filter((row) => !/^player\s*,/i.test(row))
    .map((row) => parseLineRow(row, defaultMarket))
    .filter(Boolean);
}

function parseLineRow(row, defaultMarket) {
  const cells = row.split(/,|\t/).map((cell) => cell.trim()).filter(Boolean);
  if (cells.length >= 2 && Number.isFinite(Number(cells[1]))) {
    const player = cells[0];
    const line = Number(cells[1]);
    const { book, odds } = parseImportedBookAndOdds(cells.slice(2));

    return Number.isFinite(line) ? { player, market: null, line, book, ...(odds ? { odds } : {}) } : null;
  }

  if (cells.length >= 3) {
    const player = cells[0];
    const market = normalizeMarket(cells[1]);
    const line = Number(cells[2]);
    const { book, odds } = parseImportedBookAndOdds(cells.slice(3));

    return market && Number.isFinite(line) ? { player, market, line, book, ...(odds ? { odds } : {}) } : null;
  }

  const simple = row.match(/^(.+?)\s+(fantasy points|fantasy|fp|pitches thrown|pitch count|pitches|strikeouts|strikouts|ks|k|pitching outs|outs|hits\+runs\+rbis|hrr|hits runs rbis|total bases|tb|hits|hit|runs|run|rbis|rbi|points|pts|rebounds|reb|assists|ast|turnovers|tos|3pm|3pt|threes|pra|ptsreb|ptsast|rebast|steals|stl|blocks|blk|total games|games won|player games|aces|double faults|breaks of serve|breaks)\s+([0-9.]+)(?:\s+(.+))?$/i);
  if (simple) {
    const market = normalizeMarket(simple[2]);
    const line = Number(simple[3]);
    const { book, odds } = parseImportedBookAndOdds(simple[4] ? simple[4].trim().split(/\s+/) : []);
    return market && Number.isFinite(line)
      ? {
          player: simple[1].trim(),
          market,
          line,
          book,
          ...(odds ? { odds } : {}),
        }
      : null;
  }

  const short = row.match(/^(.+?)\s+([0-9.]+)(?:\s+(.+))?$/i);
  if (!short) return null;

  const line = Number(short[2]);
  return Number.isFinite(line)
    ? {
        player: short[1].trim(),
        market: null,
        line,
        ...parseImportedBookAndOdds(short[3] ? short[3].trim().split(/\s+/) : []),
      }
    : null;
}

function parseImportedBookAndOdds(parts) {
  const bookParts = [];
  const prices = [];

  parts.forEach((part) => {
    const price = parseAmericanOddsToken(part);
    if (price == null) {
      bookParts.push(part);
    } else {
      prices.push(price);
    }
  });

  const book = bookParts.join(" ").trim() || "Pasted";
  if (!prices.length) return { book };

  return {
    book,
    odds: {
      over: prices[0],
      under: prices[1] ?? prices[0],
    },
  };
}

function parseAmericanOddsToken(value) {
  const text = String(value || "")
    .trim()
    .replace(/[()]/g, "")
    .replace(/^odds[:=]/i, "");
  if (!/^[+-]?\d+$/.test(text)) return null;

  const price = Number(text);
  if (!Number.isFinite(price) || price === 0 || Math.abs(price) < 100 || Math.abs(price) > 1000) return null;
  return price;
}

function normalizeMarket(value) {
  const key = normalizeKey(value);
  if (key === "fantasypoints" || key === "fantasy" || key === "fp") return "Fantasy Points";
  if (key === "pitchesthrown" || key === "pitchcount" || key === "pitches") return "Pitches Thrown";
  if (key === "strikeout" || key === "strikeouts" || key === "strikouts" || key === "strikout" || key === "ks" || key === "k") {
    return "Strikeouts";
  }
  if (key === "pitchingout" || key === "pitchingouts" || key === "outs") return "Pitching Outs";
  if (key === "hit" || key === "hits") return "Hits";
  if (key === "hitsrunsrbis" || key === "hrr") return "Hits+Runs+RBIs";
  if (key === "totalbases" || key === "tb") return "Total Bases";
  if (key === "run" || key === "runs") return "Runs";
  if (key === "rbi" || key === "rbis") return "RBIs";
  if (key === "point" || key === "points" || key === "pts") return "Points";
  if (key === "rebound" || key === "rebounds" || key === "reb") return "Rebounds";
  if (key === "assist" || key === "assists" || key === "ast") return "Assists";
  if (key === "turnover" || key === "turnovers" || key === "to" || key === "tos") return "Turnovers";
  if (key === "3pm" || key === "3pt" || key === "three" || key === "threes") return "3PM";
  if (key === "pra" || key === "pointsreboundsassists" || key === "ptsrebast") return "PRA";
  if (key === "pointsrebounds" || key === "ptsreb" || key === "pr") return "Pts+Reb";
  if (key === "pointsassists" || key === "ptsast" || key === "pa") return "Pts+Ast";
  if (key === "reboundsassists" || key === "rebast" || key === "ra") return "Reb+Ast";
  if (key === "steal" || key === "steals" || key === "stl") return "Steals";
  if (key === "block" || key === "blocks" || key === "blk") return "Blocks";
  if (key === "totalgames" || key === "games") return "Total Games";
  if (key === "gameswon" || key === "playergames" || key === "playergameswon") return "Player Games Won";
  if (key === "ace" || key === "aces") return "Aces";
  if (key === "doublefault" || key === "doublefaults" || key === "dfs") return "Double Faults";
  if (key === "break" || key === "breaks" || key === "breaksofserve") return "Breaks of Serve";
  return MARKETS.find((market) => normalizeKey(market.id) === key)?.id || null;
}

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getEmptyMessage(market, selectedSide) {
  if (market.requiresLine) {
    return `Paste a ${market.label} line for a pitcher first, then import and scan.`;
  }

  return `No matching ${selectedSide.toLowerCase()} found for ${market.id} in the selected window. Load sportsbook odds or paste real lines, then scan again.`;
}

function getTeamContext(abbr) {
  return TEAM_CONTEXT[abbr] || { park: 1, offense: 1, contact: 1, power: 1 };
}

function getWnbaTeamContext(abbr) {
  return WNBA_TEAM_CONTEXT[abbr] || { pace: 1, defense: 1 };
}

function gameRestLabel() {
  return "Schedule rest checked from player game logs";
}

function formatMaybe(value, suffix = "") {
  return Number.isFinite(value) ? `${roundTo(value, 1)}${suffix}` : "n/a";
}

function formatRestDays(restDays) {
  return Number.isFinite(restDays) ? `${restDays} day${restDays === 1 ? "" : "s"} since last game` : "rest unavailable";
}

function teamAbbr(team) {
  if (team.abbreviation) return team.abbreviation;
  if (team.teamCode) return team.teamCode.toUpperCase();
  return "TBD";
}

function shortName(name) {
  if (!name || name === "TBD") return "TBD";
  const parts = name.split(" ");
  const suffixes = new Set(["jr.", "jr", "sr.", "sr", "ii", "iii", "iv", "v"]);
  const last = parts[parts.length - 1];
  if (suffixes.has(last.toLowerCase()) && parts.length > 1) {
    return parts[parts.length - 2];
  }
  return last;
}

function formatUpdateTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function roundTo(value, places) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function signedRound(value) {
  const rounded = roundTo(value || 0, 2);
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatAmericanOdds(odds) {
  const price = Number(odds);
  if (!Number.isFinite(price)) return "n/a";
  return price > 0 ? `+${price}` : `${price}`;
}

function PropsResultsTracker({
  history,
  summary,
  filters,
  options,
  onFilterChange,
  onResultChange,
  onAutoSettle,
  onExport,
  onClear,
}) {
  return (
    <section style={S.trackerCard}>
      <div style={S.trackerTopRow}>
        <div>
          <div style={S.sectionLabel}>Results Tracker</div>
          <h2 style={S.trackerTitle}>Props of the Day Results Tracker</h2>
        </div>
        <div style={S.trackerActions}>
          <button type="button" onClick={onAutoSettle} style={S.secondaryBtnMuted}>
            Auto-settle pending
          </button>
          <button type="button" onClick={onExport} style={S.secondaryBtn}>
            Export CSV
          </button>
          <button type="button" onClick={onClear} style={S.dangerBtn}>
            Clear History
          </button>
        </div>
      </div>

      <div style={S.resultsGrid}>
        <Pill label="Total" value={summary.total} />
        <Pill label="Wins" value={summary.wins} color="#14532d" />
        <Pill label="Losses" value={summary.losses} color="#7f1d1d" />
        <Pill label="Pushes" value={summary.pushes} />
        <Pill label="Pending" value={summary.pending} />
        <Pill label="Win Rate" value={`${Math.round(summary.winRate * 100)}%`} />
        <Pill label="ROI" value={`${signedRound(summary.roi * 100)}%`} color={summary.roi >= 0 ? "#14532d" : "#7f1d1d"} />
        <Pill label="P/L" value={`${signedRound(summary.profit)}u`} color={summary.profit >= 0 ? "#14532d" : "#7f1d1d"} />
        <Pill label="Last 7" value={`${summary.last7.total} · ${Math.round(summary.last7.winRate * 100)}%`} />
        <Pill label="Last 30" value={`${summary.last30.total} · ${Math.round(summary.last30.winRate * 100)}%`} />
      </div>

      <div style={S.resultsBreakdown}>
        <span>Accuracy by sport: {formatPropsBreakdown(summary.bySport)}</span>
        <span>Accuracy by market: {formatPropsBreakdown(summary.byMarket)}</span>
        <span>Accuracy by tier: {formatPropsBreakdown(summary.byTier)}</span>
      </div>

      <div style={S.filterGrid}>
        <TrackerSelect label="Date" value={filters.date} options={options.dates} allLabel="All dates" onChange={(value) => onFilterChange("date", value)} />
        <TrackerSelect label="Sport" value={filters.sport} options={options.sports} onChange={(value) => onFilterChange("sport", value)} />
        <TrackerSelect label="Market" value={filters.market} options={options.markets} onChange={(value) => onFilterChange("market", value)} />
        <TrackerSelect label="Result" value={filters.result} options={options.results} onChange={(value) => onFilterChange("result", value)} />
        <TrackerSelect label="Sportsbook" value={filters.sportsbook} options={options.sportsbooks} onChange={(value) => onFilterChange("sportsbook", value)} />
        <TrackerSelect label="Tier" value={filters.tier} options={options.tiers} onChange={(value) => onFilterChange("tier", value)} />
      </div>

      {history.length === 0 ? (
        <div style={S.emptyTracker}>No saved props match the current filters.</div>
      ) : (
        <div style={S.trackerList}>
          {history.map((pick) => (
            <SavedPropRow key={pick.id} pick={pick} onResultChange={onResultChange} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrackerSelect({ label, value, options, onChange, allLabel = "All" }) {
  return (
    <label style={S.filterLabel}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={S.filterSelect}>
        <option value="All">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SavedPropRow({ pick, onResultChange }) {
  return (
    <div style={S.savedRow}>
      <div style={S.savedMain}>
        <strong>{pick.player}</strong>
        <span>
          {pick.date} · {pick.sport} · {pick.market} · {pick.pickSide} {pick.propLine} · {pick.sportsbook} {formatAmericanOdds(pick.odds)}
        </span>
        <span>
          {pick.team} vs {pick.opponent} · model {pick.modelProbability}% · implied {pick.impliedProbability}% · edge {signedRound(pick.edgePct)}% · EV {signedRound(pick.ev)}% · tier {pick.confidenceTier}
        </span>
        <span>{pick.reason}</span>
      </div>
      <div style={S.savedSide}>
        <Pill label="Result" value={pick.resultStatus} color={pick.resultStatus === "Win" ? "#14532d" : pick.resultStatus === "Loss" ? "#7f1d1d" : "#0f172a"} />
        <Pill label="Actual" value={pick.actualResult ?? "Pending"} />
        <Pill label="P/L" value={`${signedRound(pick.profitLoss || 0)}u`} color={(pick.profitLoss || 0) >= 0 ? "#14532d" : "#7f1d1d"} />
        <div style={S.resultButtonRow}>
          {["Win", "Loss", "Push", "Pending"].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => onResultChange(pick.id, status)}
              style={{
                ...S.miniBtn,
                ...(pick.resultStatus === status ? S.miniBtnActive : {}),
              }}
            >
              {status}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatPropsBreakdown(items) {
  if (!items?.length) return "pending";
  return items
    .slice(0, 5)
    .map((item) => `${item.label}: ${Math.round(item.winRate * 100)}% (${item.wins}-${item.losses}-${item.pushes})`)
    .join(" · ");
}

function SharpAnalyticsDashboard({ summary }) {
  return (
    <div style={S.resultsCard}>
      <div style={S.sectionLabel}>Sharp analytics engine</div>
      <div style={S.resultsGrid}>
        <Pill label="Predictions" value={summary.total} />
        <Pill label="Settled" value={summary.settled} />
        <Pill label="Win Rate" value={`${Math.round(summary.winRate * 100)}%`} />
        <Pill label="ROI" value={`${signedRound(summary.roi * 100)}%`} color={summary.roi >= 0 ? "#14532d" : "#7f1d1d"} />
        <Pill label="Avg CLV" value={signedRound(summary.avgClv)} color={summary.avgClv >= 0 ? "#14532d" : "#7f1d1d"} />
      </div>
      <div style={S.resultsBreakdown}>
        <span>ROI by sport: {formatSharpBreakdown(summary.bySport)}</span>
        <span>ROI by prop: {formatSharpBreakdown(summary.byMarket)}</span>
        <span>Best books: {formatSharpBreakdown(summary.byBook)}</span>
        <span>Confidence tiers: {formatSharpBreakdown(summary.byTier)}</span>
        <span>Calibration: {formatCalibration(summary.calibration)}</span>
      </div>
    </div>
  );
}

function formatSharpBreakdown(items) {
  if (!items?.length) return "pending";
  return items.map((item) => `${item.label} ${Math.round(item.winRate * 100)}% / ${signedRound(item.roi * 100)}% ROI`).join(" · ");
}

function formatCalibration(items) {
  if (!items?.some((item) => item.count > 0)) return "needs settled sample";
  return items
    .filter((item) => item.count > 0)
    .map((item) => `${item.label}: expected ${Math.round(item.expected * 100)}%, actual ${Math.round(item.actual * 100)}%`)
    .join(" · ");
}

function ModelResultsCard({ summary }) {
  if (!summary?.settled) {
    return (
      <div style={S.resultsCard}>
        <div style={S.sectionLabel}>Model results tracker</div>
        <div style={S.resultsText}>
          No settled picks yet. Every recommended pick is saved locally, then graded for win rate, ROI, profit/loss, CLV, sport, prop, and sportsbook after final results are available.
        </div>
      </div>
    );
  }

  return (
    <div style={S.resultsCard}>
      <div style={S.sectionLabel}>Model results tracker</div>
      <div style={S.resultsGrid}>
        <Pill label="Settled" value={summary.settled} />
        <Pill label="Win %" value={`${Math.round(summary.winPct * 100)}%`} />
        <Pill label="ROI" value={`${signedRound(summary.roi * 100)}%`} color={summary.roi >= 0 ? "#14532d" : "#7f1d1d"} />
        <Pill label="Profit/Loss" value={`${signedRound(summary.profit)}u`} color={summary.profit >= 0 ? "#14532d" : "#7f1d1d"} />
      </div>
      <div style={S.resultsBreakdown}>
        <span>Sport: {formatBreakdown(summary.bySport)}</span>
        <span>Prop: {formatBreakdown(summary.byProp)}</span>
        <span>Book: {formatBreakdown(summary.byBook)}</span>
      </div>
    </div>
  );
}

function formatBreakdown(items) {
  if (!items?.length) return "pending";
  return items
    .map((item) => `${item.label} ${Math.round(item.winPct * 100)}% / ${signedRound(item.roi * 100)}% ROI`)
    .join(" · ");
}

function TopProbablePropsStrip({ picks, hasScanned, loading }) {
  const helperText = loading
    ? "Analyzing today's low-variance markets..."
    : hasScanned
    ? "No stable top props cleared the model filters yet."
    : "Run the stable engine or scan a selected market to populate this row.";

  return (
    <section style={S.topPropsCard}>
      <div style={S.topPropsHeader}>
        <div>
          <div style={S.sectionLabel}>Top probable props</div>
          <h2 style={S.topPropsTitle}>Best analyzed props for today</h2>
        </div>
        <span style={S.topPropsMeta}>Boring edge first</span>
      </div>

      {picks.length === 0 ? (
        <div style={S.topPropsEmpty}>{helperText}</div>
      ) : (
        <div style={S.topPropsGrid}>
          {picks.map((pick, index) => (
            <div key={`${pick.id || pick.player}-${index}`} style={S.topPropItem}>
              <div style={S.topPropRank}>#{index + 1}</div>
              <div style={S.topPropMain}>
                <strong>{pick.player}</strong>
                <span>
                  {pick.sport} · {pick.prop} · {pick.pick} {pick.line} · {pick.bestSportsbook || pick.book} {formatAmericanOdds(pick.odds)}
                </span>
                <span>
                  {pick.event || `${pick.team} vs ${pick.opponent}`}
                  {pick.startTime ? ` · ${formatDateTime(pick.startTime)}` : ""}
                </span>
              </div>
              <div style={S.topPropStats}>
                <Pill label="Score" value={pick.propScore ?? 0} color={(pick.propScore || 0) >= 70 ? "#14532d" : "#78350f"} />
                <Pill label="Prob" value={`${pick.hit_rate_pct || 0}%`} />
                <Pill label="Conf" value={`${pick.confidence || 0}%`} />
                {pick.watchlistOnly && <Pill label="Status" value="Watchlist" color="#78350f" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GameScoreCard({ game, sportId }) {
  const hasScores = Number.isFinite(game.awayScore) && Number.isFinite(game.homeScore);
  const statusColor = game.isFinal ? "#fdba74" : game.isLive ? "#4ade80" : "#93c5fd";
  const shouldShowStatus = game.isLive || game.isFinal || game.isPostponed;

  return (
    <div style={{ ...S.gameChip, ...(game.isFinal ? S.gameChipFinal : {}) }}>
      <div style={S.scoreHeader}>
        <span style={S.gameTeams}>
          {game.awayAbbr} @ {game.homeAbbr}
        </span>
        {shouldShowStatus && (
          <span style={{ ...S.statusPill, color: statusColor }}>
            {game.status}
          </span>
        )}
      </div>
      {hasScores && (game.isLive || game.isFinal) ? (
        <div style={S.scoreRow}>
          <span style={S.scoreTeam}>{game.awayAbbr}</span>
          <span style={S.scoreValue}>{game.awayScore}</span>
          <span style={S.scoreTeam}>{game.homeAbbr}</span>
          <span style={S.scoreValue}>{game.homeScore}</span>
        </div>
      ) : (
        <div style={S.gameMatchupLine}>{game.away} at {game.home}</div>
      )}
      <span style={S.gameTime}>{game.isLive ? game.inningStatus || game.status : formatDateTime(game.commenceTime || game.gameTime)}</span>
      {sportId === "MLB" && (
        <span style={S.gamePitchers}>
          {shortName(game.awayPitcher)} vs {shortName(game.homePitcher)}
        </span>
      )}
      {game.isFinal && game.finalReview && (
        <div style={S.finalReview}>
          <div style={S.finalStatLine}>{game.finalReview.teamLine}</div>
          {game.finalReview.highlights.map((highlight) => (
            <div key={highlight} style={S.finalStatLine}>
              {highlight}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PickCard({ pick, rank, isSaved }) {
  const isTop = rank === 0;
  const isOver = pick.pick === "Over";
  const isNoBet = pick.isNoBet || pick.pick === "No Bet";
  const confColor =
    pick.confidence >= 85 ? "#14532d" : pick.confidence >= 75 ? "#78350f" : "#7f1d1d";
  const barColor =
    pick.confidence >= 85 ? "#16a34a" : pick.confidence >= 75 ? "#d97706" : "#dc2626";
  const hasLine = Number.isFinite(pick.line);

  return (
    <div style={{ ...S.pickCard, ...(isTop && !isNoBet ? S.pickCardTop : {}) }}>
      {isTop && !isNoBet && <div style={S.topBadge}>Sharpest edge today</div>}
      {isSaved && <div style={S.savedBadge}>Saved to Tracker</div>}
      {pick.watchlistOnly && <div style={S.watchlistBadge}>Watchlist lean · not auto-saved</div>}
      {isNoBet && <div style={S.noBetBanner}>{pick.noBetWarning || "PASS: edge is too small or data is missing."}</div>}
      <div style={S.pickTopRow}>
        <div style={{ flex: 1 }}>
          <div style={S.playerName}>{pick.player}</div>
          <div style={S.matchupText}>
            {pick.sport || ""} · {pick.event || `${pick.team} vs ${pick.opponent}`} · {pick.prop}
            {hasLine ? ` line ${pick.line}` : " projection only"}
            {pick.bestSportsbook ? ` · best book: ${pick.bestSportsbook}` : ""}
            {pick.odds ? ` · odds ${formatAmericanOdds(pick.odds)}` : ""}
            {pick.pitcher_faced ? ` · vs ${pick.pitcher_faced}` : ""}
            {pick.startTime ? ` · starts ${formatDateTime(pick.startTime)}` : ""}
            {pick.dateGenerated ? ` · generated ${formatDateTime(pick.dateGenerated)}` : ""}
          </div>
        </div>
        <div
          style={{
            ...S.pickBadge,
            ...(isNoBet ? S.badgeNoBet : isOver ? S.badgeOver : S.badgeUnder),
          }}
        >
          {isNoBet ? "PASS" : hasLine ? `${pick.recommendation || pick.pick} ${pick.line}` : "Line needed"}
        </div>
      </div>

      <div style={S.confRow}>
        <span style={S.confLabel}>Bet Confidence</span>
        <div style={S.barBg}>
          <div style={{ ...S.barFill, width: `${pick.confidence}%`, background: barColor }} />
        </div>
        <span style={{ ...S.confPct, color: confColor }}>{pick.confidence}%</span>
      </div>

      <div style={S.statsRow}>
        <Pill label="Prop Score" value={pick.propScore ?? 0} color={(pick.propScore || 0) >= 72 ? "#14532d" : (pick.propScore || 0) >= 58 ? "#78350f" : "#7f1d1d"} />
        <Pill label="Volatility" value={`${pick.volatilityScore ?? Math.round((1 - clamp(pick.volatility || 1, 0, 1)) * 100)}%`} color={(pick.volatilityScore || 0) >= 60 ? "#14532d" : "#78350f"} />
        <Pill label="Repeatability" value={`${pick.repeatabilityScore || 0}%`} />
        <Pill label="Projection" value={(pick.season_avg || 0).toFixed(1)} />
        <Pill label="Last 5" value={(pick.last5Avg || 0).toFixed(1)} />
        <Pill label="Last 10" value={(pick.last10Avg || 0).toFixed(1)} />
        <Pill
          label="Model Prob"
          value={`${Math.round(pick.hit_rate_pct || 0)}%`}
          color={pick.hit_rate_pct >= 65 ? "#14532d" : "#78350f"}
        />
        <Pill label="Raw prob" value={`${pick.rawProbability || pick.hit_rate_pct || 0}%`} />
        <Pill label="Implied" value={`${pick.impliedProbability || 0}%`} />
        <Pill
          label="Edge"
          value={`${pick.edgePct > 0 ? "+" : ""}${pick.edgePct || 0}%`}
          color={!isNoBet && pick.edgePct >= 4 ? "#14532d" : "#7f1d1d"}
        />
        <Pill
          label="EV"
          value={`${pick.evPct > 0 ? "+" : ""}${pick.evPct || 0}%`}
          color={!isNoBet && pick.evPct > 0 ? "#14532d" : "#7f1d1d"}
        />
        <Pill label="Tier" value={pick.confidenceTier || "Tier D"} />
        <Pill label="Stat Edge" value={signedRound(pick.signedStatEdge ?? pick.projectedDiff ?? 0)} />
        <Pill label="Books" value={pick.marketBookCount || 1} />
        <Pill
          label="Book value"
          value={`${signedRound((pick.sportsbookValue || 0) * 100)}%`}
          color={pick.sportsbookValue > 0 ? "#14532d" : "#78350f"}
        />
        <Pill label="Consistency" value={`${Math.round((pick.consistencyScore || 0) * 100)}%`} />
        <Pill label="Risk" value={pick.invalidData ? "Invalid Data" : `${pick.risk || "High"} Risk`} color={pick.invalidData ? "#7f1d1d" : pick.risk === "Low" ? "#14532d" : pick.risk === "Medium" ? "#78350f" : "#7f1d1d"} />
        <Pill label="Recommendation" value={pick.recommendation || "Pass"} color={pick.recommendation === "Strong Bet" ? "#14532d" : pick.recommendation === "Playable" ? "#78350f" : pick.recommendation?.startsWith("Lean") ? "#1d4ed8" : "#7f1d1d"} />
        <Pill label="Units" value={pick.suggestedUnits || "0u"} />
        <Pill label="Bankroll" value={pick.bankroll || "No bet"} />
        <Pill label="Kelly" value={`${pick.bankrollPct || 0}%`} />
        <Pill label="CLV" value={pick.clv || "Pending"} />
        <Pill label="CLV Trust" value={signedRound(pick.clvScore || 0)} color={(pick.clvScore || 0) >= 0 ? "#14532d" : "#7f1d1d"} />
        <Pill label="Result" value={pick.result || "Pending"} />
        <div style={S.dotsGroup}>
          <span style={S.dotsLabel}>Last 5</span>
          {(pick.last5 || []).map((value, index) => {
            const hit = hasLine ? (isOver ? value >= pick.line : value <= pick.line) : true;
            return (
              <div
                key={`${value}-${index}`}
                style={{
                  ...S.dot,
                  background: hit ? "#dcfce7" : "#fee2e2",
                  color: hit ? "#14532d" : "#7f1d1d",
                  border: `1px solid ${hit ? "#86efac" : "#fca5a5"}`,
                }}
              >
                {value}
              </div>
            );
          })}
        </div>
      </div>

      <div style={S.analysisBox}>
        <div style={S.edgeLine}>
          <strong>Stable props engine: </strong>
          {pick.stableReasonSummary || "Pending"}
        </div>
        <div style={S.edgeLine}>
          <strong>Reason: </strong>
          {pick.reason || pick.key_edge}
        </div>
        <div style={S.edgeLine}>
          <strong>Recommendation engine: </strong>
          {pick.recommendationText || pick.recommendation || "Pass"} · <strong>Suggested size: </strong>
          {pick.suggestedUnits || "0u"} · <strong>Bankroll: </strong>
          {pick.bankroll || "No bet"}
        </div>
        <div style={S.edgeLine}>
          <strong>Line movement: </strong>
          {pick.lineMovement || "First seen"} · <strong>Usage: </strong>
          {pick.usage || "Unknown"} · <strong>Injury: </strong>
          {pick.injuryStatus || "Unknown"}
        </div>
        <div style={S.edgeLine}>
          <strong>Best book: </strong>
          {pick.bestBookReason || pick.key_edge} · <strong>Odds history: </strong>
          {pick.historicalOdds || "First tracked price"}
        </div>
        <div style={S.edgeLine}>
          <strong>Market movement: </strong>
          {pick.marketMovement?.label || "No market movement yet"}
        </div>
        <div style={S.edgeLine}>
          <strong>Simulation: </strong>
          {pick.simulation
            ? `median ${pick.simulation.median}, 80% range ${pick.simulation.low}-${pick.simulation.high}, sim prob ${Math.round(pick.simulation.probability * 100)}%, vol ${pick.simulation.volatility}`
            : "Pending"}
        </div>
        {pick.realityFlags?.length > 0 && (
          <div style={S.warningLine}>
            <strong>Reality check: </strong>
            {pick.realityFlags.join(" · ")}
          </div>
        )}
        <div style={S.edgeLine}>
          <strong>Math model: </strong>
          {pick.mathExplanation || pick.reason}
        </div>
        <div style={S.edgeLine}>
          <strong>Context filters: </strong>
          {pick.contextFilters || "Pending"}
        </div>
        <div style={S.edgeLine}>
          <strong>Trend analysis: </strong>
          {pick.trendAnalysis || "Pending"}
        </div>
        <div style={S.edgeLine}>
          <strong>Usage analysis: </strong>
          {pick.usageAnalysis || "Pending"}
        </div>
        <div style={S.edgeLine}>
          <strong>AI explanation after math: </strong>
          {pick.aiExplanation || "Pending"}
        </div>
        <div style={S.reasoningText}>{pick.noBetWarning || pick.key_edge}</div>
      </div>
    </div>
  );
}

function Pill({ label, value, color }) {
  return (
    <div style={S.pill}>
      <span style={S.pillLabel}>{label}</span>
      <span style={{ ...S.pillValue, color: color || "#0f172a" }}>{value}</span>
    </div>
  );
}

const S = {
  page: {
    minHeight: "100vh",
    background: "#0a0f1a",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    padding: "2rem 1rem 4rem",
    color: "#f1f5f9",
  },
  container: { maxWidth: 740, margin: "0 auto" },
  header: { marginBottom: "1.5rem" },
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  logo: {
    border: "1px solid #1e293b",
    borderRadius: 8,
    color: "#bfdbfe",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    padding: "5px 7px",
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    color: "#f8fafc",
    margin: 0,
    letterSpacing: 0,
  },
  liveBadge: {
    padding: "3px 8px",
    background: "#052e16",
    color: "#4ade80",
    border: "1px solid #166534",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
  },
  subtitle: { fontSize: 13, color: "#64748b", lineHeight: 1.5, margin: 0 },
  liveRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    color: "#64748b",
    fontSize: 11,
    marginTop: 10,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#22c55e",
    boxShadow: "0 0 0 4px rgba(34,197,94,0.12)",
  },
  gamesCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: "1rem",
  },
  gamesTopRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  gamesHint: { fontSize: 11, color: "#64748b", lineHeight: 1.35 },
  gamesCount: {
    border: "0.5px solid #334155",
    background: "#020617",
    color: "#94a3b8",
    borderRadius: 999,
    padding: "5px 8px",
    fontSize: 10,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#64748b",
    marginBottom: 8,
  },
  gamesRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  topPropsCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 16,
    padding: "12px 14px",
    marginTop: "-0.4rem",
    marginBottom: "1rem",
  },
  topPropsHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  topPropsTitle: { margin: 0, color: "#f8fafc", fontSize: 16, letterSpacing: 0 },
  topPropsMeta: {
    color: "#86efac",
    background: "#052e16",
    border: "0.5px solid #166534",
    borderRadius: 999,
    padding: "5px 8px",
    fontSize: 10,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  topPropsEmpty: {
    border: "0.5px dashed #334155",
    borderRadius: 10,
    padding: "12px",
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
  },
  topPropsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 8,
  },
  topPropItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: 9,
    alignItems: "start",
    background: "#111827",
    border: "0.5px solid #334155",
    borderRadius: 10,
    padding: "9px 10px",
  },
  topPropRank: {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#020617",
    border: "0.5px solid #334155",
    borderRadius: 8,
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: 800,
  },
  topPropMain: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    color: "#94a3b8",
    fontSize: 11,
    lineHeight: 1.35,
  },
  topPropStats: {
    gridColumn: "1 / -1",
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  resultsCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: "1rem",
  },
  resultsText: { fontSize: 12, color: "#94a3b8", lineHeight: 1.5 },
  resultsGrid: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 },
  resultsBreakdown: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 11,
    color: "#94a3b8",
    lineHeight: 1.4,
  },
  boardHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  trackerCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 16,
    padding: "1.1rem 1.25rem",
    marginTop: "1.25rem",
    marginBottom: "1rem",
  },
  trackerTopRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  trackerTitle: { fontSize: 18, margin: 0, color: "#f8fafc", letterSpacing: 0 },
  trackerActions: { display: "flex", flexWrap: "wrap", gap: 8 },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  filterLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: "#64748b",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  filterSelect: {
    background: "#020617",
    border: "0.5px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 12,
    padding: "7px 9px",
  },
  trackerList: { display: "flex", flexDirection: "column", gap: 8 },
  savedRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    background: "#111827",
    border: "0.5px solid #334155",
    borderRadius: 10,
    padding: "10px 12px",
  },
  savedMain: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 11,
    color: "#94a3b8",
    lineHeight: 1.4,
  },
  savedSide: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  resultButtonRow: { display: "flex", flexWrap: "wrap", gap: 4 },
  miniBtn: {
    padding: "5px 7px",
    borderRadius: 7,
    border: "0.5px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },
  miniBtnActive: { background: "#1d4ed8", border: "0.5px solid #2563eb", color: "#eff6ff" },
  emptyTracker: {
    border: "0.5px dashed #334155",
    borderRadius: 10,
    padding: "14px",
    color: "#64748b",
    fontSize: 12,
    textAlign: "center",
  },
  gameChip: {
    background: "#1e293b",
    border: "0.5px solid #334155",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 170,
    flex: "1 1 170px",
  },
  gameChipFinal: { background: "#1f2937", border: "0.5px solid #92400e" },
  scoreHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  gameTeams: { fontSize: 12, fontWeight: 700, color: "#e2e8f0" },
  gameMatchupLine: {
    color: "#94a3b8",
    fontSize: 10,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  gameTime: { fontSize: 10, color: "#64748b" },
  gamePitchers: { fontSize: 10, color: "#94a3b8" },
  statusPill: {
    fontSize: 9,
    fontWeight: 800,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  scoreRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr auto",
    gap: 5,
    alignItems: "center",
  },
  scoreTeam: { fontSize: 11, color: "#94a3b8", fontWeight: 700 },
  scoreValue: { fontSize: 18, color: "#f8fafc", fontWeight: 800, textAlign: "right" },
  finalReview: {
    borderTop: "0.5px solid #334155",
    marginTop: 4,
    paddingTop: 5,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  finalStatLine: { fontSize: 10, color: "#cbd5e1", lineHeight: 1.35 },
  controlsCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 16,
    padding: "1rem 1.15rem",
    marginBottom: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  controlGroup: { display: "flex", flexDirection: "column", gap: 8 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  textarea: {
    width: "100%",
    minHeight: 92,
    resize: "vertical",
    background: "#020617",
    border: "0.5px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    fontSize: 12,
    lineHeight: 1.5,
    padding: "10px 12px",
    outline: "none",
  },
  importRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  apiRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
  },
  apiInput: {
    minWidth: 0,
    background: "#020617",
    border: "0.5px solid #334155",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 12,
    padding: "7px 10px",
    outline: "none",
  },
  secondaryBtn: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "0.5px solid #2563eb",
    background: "#1d4ed8",
    color: "#eff6ff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryBtnMuted: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "0.5px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  dangerBtn: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "0.5px solid #7f1d1d",
    background: "#450a0a",
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  importStatus: {
    color: "#64748b",
    fontSize: 11,
    lineHeight: 1.4,
  },
  chip: {
    padding: "6px 11px",
    borderRadius: 999,
    border: "0.5px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  chipActive: { background: "#1d4ed8", border: "0.5px solid #1d4ed8", color: "#eff6ff" },
  scanBtn: {
    padding: "13px 24px",
    background: "#16a34a",
    color: "#f0fdf4",
    border: "none",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  scanBtnDisabled: { opacity: 0.4, cursor: "not-allowed" },
  spinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid rgba(240,253,244,0.3)",
    borderTopColor: "#f0fdf4",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  },
  errorBox: {
    background: "#450a0a",
    border: "0.5px solid #7f1d1d",
    color: "#fca5a5",
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: 13,
    marginBottom: "1rem",
  },
  emptyBox: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 16,
    padding: "2rem",
    textAlign: "center",
    fontSize: 13,
    color: "#64748b",
    marginBottom: "1rem",
  },
  pickCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 16,
    padding: "1.1rem 1.25rem",
    marginBottom: 10,
  },
  pickCardTop: { border: "1.5px solid #1d4ed8" },
  topBadge: {
    display: "inline-block",
    padding: "3px 10px",
    background: "#1e3a5f",
    color: "#93c5fd",
    border: "0.5px solid #1d4ed8",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
  },
  savedBadge: {
    display: "inline-block",
    padding: "3px 10px",
    background: "#052e16",
    color: "#86efac",
    border: "0.5px solid #166534",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    marginLeft: 6,
  },
  watchlistBadge: {
    display: "inline-block",
    padding: "3px 10px",
    background: "#451a03",
    color: "#fcd34d",
    border: "0.5px solid #92400e",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    marginLeft: 6,
  },
  pickTopRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },
  playerName: {
    fontSize: 17,
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: 0,
    marginBottom: 3,
  },
  matchupText: { fontSize: 12, color: "#64748b" },
  pickBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  badgeOver: { background: "#052e16", color: "#4ade80", border: "0.5px solid #166534" },
  badgeUnder: { background: "#450a0a", color: "#f87171", border: "0.5px solid #7f1d1d" },
  badgeNoBet: { background: "#1e293b", color: "#cbd5e1", border: "0.5px solid #475569" },
  noBetBanner: {
    padding: "7px 10px",
    background: "#451a03",
    color: "#fdba74",
    border: "0.5px solid #9a3412",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 10,
  },
  confRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  confLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    minWidth: 76,
  },
  barBg: { flex: 1, height: 5, background: "#1e293b", borderRadius: 999, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  confPct: { fontSize: 13, fontWeight: 700, minWidth: 36, textAlign: "right" },
  statsRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10, alignItems: "center" },
  pill: {
    background: "#1e293b",
    border: "0.5px solid #334155",
    borderRadius: 8,
    padding: "5px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  pillLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  pillValue: { fontSize: 14, fontWeight: 700 },
  dotsGroup: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#1e293b",
    border: "0.5px solid #334155",
    borderRadius: 8,
    padding: "5px 10px",
  },
  dotsLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginRight: 4,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 700,
  },
  analysisBox: { borderTop: "0.5px solid #1e293b", paddingTop: 10 },
  edgeLine: { fontSize: 12, color: "#94a3b8", marginBottom: 4, lineHeight: 1.5 },
  warningLine: {
    fontSize: 12,
    color: "#fdba74",
    background: "#451a03",
    border: "0.5px solid #9a3412",
    borderRadius: 8,
    padding: "7px 9px",
    marginBottom: 6,
    lineHeight: 1.5,
  },
  reasoningText: { fontSize: 12, color: "#64748b", lineHeight: 1.6 },
  disclaimer: {
    fontSize: 11,
    color: "#475569",
    textAlign: "center",
    marginTop: "1.5rem",
    lineHeight: 1.5,
  },
};
