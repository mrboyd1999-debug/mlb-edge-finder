import { useState, useEffect } from "react";

const MARKETS = [
  { id: "Hits", label: "Hits", line: 0.5 },
  { id: "Total Bases", label: "Total Bases", line: 1.5 },
  { id: "RBIs", label: "RBIs", line: 0.5 },
  { id: "Strikeouts", label: "Strikeouts (P)", line: 4.5 },
  { id: "Home Runs", label: "Home Runs", line: 0.5 },
  { id: "Pitching Outs", label: "Pitching Outs", line: 14.5 },
];

export default function MLBPickFinder() {
  const [selectedMarket, setSelectedMarket] = useState("Hits");
  const [minConf, setMinConf] = useState(80);
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [todaysGames, setTodaysGames] = useState([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);

  useEffect(() => {
    loadTodaysGames();
  }, []);

  const loadTodaysGames = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=team,linescore,probablePitcher`
      );
      const data = await res.json();
      const games = [];
      (data.dates || []).forEach((d) => {
        (d.games || []).forEach((g) => {
          games.push({
            away: g.teams?.away?.team?.name || "TBD",
            awayAbbr: g.teams?.away?.team?.abbreviation || "???,",
            home: g.teams?.home?.team?.name || "TBD",
            homeAbbr: g.teams?.home?.team?.abbreviation || "???,",
            awayPitcher: g.teams?.away?.probablePitcher?.fullName || "TBD",
            homePitcher: g.teams?.home?.probablePitcher?.fullName || "TBD",
            status: g.status?.detailedState || "Scheduled",
            gameTime: g.gameDate
              ? new Date(g.gameDate).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })
              : "TBD",
          });
        });
      });
      setTodaysGames(games);
      setGamesLoaded(true);
    } catch {
      setGamesLoaded(true);
    }
  };

  const scanPicks = async () => {
    setLoading(true);
    setError(null);
    setHasScanned(true);
    setPicks([]);

    try {
      setLoadingStep("Fetching today's confirmed MLB games...");
      const today = new Date().toISOString().split("T")[0];
      const schedRes = await fetch(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=team,linescore,probablePitcher`
      );
      const schedData = await schedRes.json();

      const games = [];
      (schedData.dates || []).forEach((d) => {
        (d.games || []).forEach((g) => {
          games.push({
            away: g.teams?.away?.team?.name,
            awayAbbr: g.teams?.away?.team?.abbreviation,
            home: g.teams?.home?.team?.name,
            homeAbbr: g.teams?.home?.team?.abbreviation,
            awayPitcher: g.teams?.away?.probablePitcher?.fullName || "TBD",
            homePitcher: g.teams?.home?.probablePitcher?.fullName || "TBD",
            status: g.status?.detailedState,
            gameTime: g.gameDate
              ? new Date(g.gameDate).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })
              : "TBD",
          });
        });
      });

      if (games.length === 0) {
        setError("No MLB games found today. Check back on a game day.");
        setLoading(false);
        return;
      }

      setLoadingStep(
        `Analyzing ${games.length} real games · finding ${selectedMarket} edges...`
      );

      const gamesSummary = games
        .map(
          (g) =>
            `${g.awayAbbr} @ ${g.homeAbbr} (${g.gameTime}) | Away SP: ${g.awayPitcher} | Home SP: ${g.homePitcher} | Status: ${g.status}`
        )
        .join("\n");

      const marketDefault = MARKETS.find((m) => m.id === selectedMarket);
      const defaultLine = marketDefault ? marketDefault.line : 0.5;

      const prompt = `You are a sharp MLB prop betting analyst with deep knowledge of current MLB players, their 2024-2025 season stats, recent form, and how they perform against specific pitchers and ballparks.

Today's date: ${new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}

TODAY'S ACTUAL MLB GAMES (live from MLB Stats API):
${gamesSummary}

Find the best ${selectedMarket} prop bets with ${minConf}%+ confidence.

Rules:
- Only use players from these ACTUAL games
- For pitcher props (Strikeouts, Pitching Outs) use the listed starting pitchers
- Use your knowledge of 2024-2025 stats, career splits, recent form (last 10-14 games)
- Consider: ballpark factors, pitcher handedness matchups, hot/cold streaks, career vs opponent
- Typical sportsbook line for ${selectedMarket}: around ${defaultLine}
- Only return picks at ${minConf}%+ confidence
- Return 4-6 picks max, strongest edges only

Return ONLY a valid JSON array, no markdown, no backticks:
[
  {
    "player": "Full Player Name",
    "team": "ABBR",
    "opponent": "ABBR",
    "prop": "${selectedMarket}",
    "line": ${defaultLine},
    "pick": "Over",
    "confidence": 85,
    "season_avg": 1.8,
    "hit_rate_pct": 72,
    "last5": [2, 1, 3, 2, 1],
    "pitcher_faced": "Opposing pitcher full name",
    "key_edge": "One sharp sentence on the edge",
    "reasoning": "2 sentences of specific analytical reasoning using real stats"
  }
]`;

      const aiRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!aiRes.ok) throw new Error(`API error: ${aiRes.status}`);
      const aiData = await aiRes.json();
      if (aiData.error) throw new Error(aiData.error.message || "AI error");

      const text = aiData.content.map((i) => i.text || "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setPicks(parsed);
    } catch (e) {
      setError(
        e.message.includes("JSON")
          ? "AI returned unexpected format. Try again."
          : `Error: ${e.message}`
      );
    }

    setLoading(false);
    setLoadingStep("");
  };

  return (
    <div style={S.page}>
      <div style={S.container}>
        <header style={S.header}>
          <div style={S.titleRow}>
            <span style={S.logo}>⚾</span>
            <h1 style={S.title}>MLB Edge Finder</h1>
            <span style={S.liveBadge}>LIVE DATA</span>
          </div>
          <p style={S.subtitle}>
            Pulls today's real MLB games from MLB Stats API · AI analyzes actual
            matchups · surfaces highest-confidence props
          </p>
        </header>

        {gamesLoaded && todaysGames.length > 0 && (
          <div style={S.gamesCard}>
            <div style={S.sectionLabel}>
              {todaysGames.length} games on the board today
            </div>
            <div style={S.gamesRow}>
              {todaysGames.map((g, i) => (
                <div key={i} style={S.gameChip}>
                  <span style={S.gameTeams}>
                    {g.awayAbbr} @ {g.homeAbbr}
                  </span>
                  <span style={S.gameTime}>{g.gameTime}</span>
                  <span style={S.gamePitchers}>
                    {g.awayPitcher !== "TBD" ? g.awayPitcher.split(" ").pop() : "TBD"} vs{' '}
                    {g.homePitcher !== "TBD" ? g.homePitcher.split(" ").pop() : "TBD"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {gamesLoaded && todaysGames.length === 0 && (
          <div style={S.emptyBox}>
            No MLB games scheduled today. Come back on a game day.
          </div>
        )}

        <div style={S.controlsCard}>
          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Prop market</span>
            <div style={S.chipRow}>
              {MARKETS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMarket(m.id)}
                  style={{
                    ...S.chip,
                    ...(selectedMarket === m.id ? S.chipActive : {}),
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div style={S.controlGroup}>
            <span style={S.sectionLabel}>Minimum confidence</span>
            <div style={S.chipRow}>
              {[70, 75, 80, 85, 90].map((c) => (
                <button
                  key={c}
                  onClick={() => setMinConf(c)}
                  style={{
                    ...S.chip,
                    ...(minConf === c ? S.chipActive : {}),
                  }}
                >
                  {c}%+
                </button>
              ))}
            </div>
          </div>

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
                {loadingStep || "Analyzing..."}
              </>
            ) : (
              "⚡  Find best picks for today"
            )}
          </button>
        </div>

        {error && <div style={S.errorBox}>⚠ {error}</div>}

        {!loading && picks.length > 0 && (
          <div>
            <div style={{ ...S.sectionLabel, marginBottom: 10 }}>
              {picks.length} picks · {selectedMarket} · {minConf}%+ confidence · ranked by edge strength
            </div>
            {picks.map((pick, i) => (
              <PickCard key={i} pick={pick} rank={i} />
            ))}
          </div>
        )}

        {!loading && hasScanned && picks.length === 0 && !error && (
          <div style={S.emptyBox}>
            No picks above {minConf}% for {selectedMarket} today. Try lowering
            the confidence threshold.
          </div>
        )}

        <p style={S.disclaimer}>
          For entertainment only. AI uses known stats — always verify lineups
          before betting. Never bet more than you can afford to lose.
        </p>
      </div>
    </div>
  );
}

function PickCard({ pick, rank }) {
  const isTop = rank === 0;
  const isOver = pick.pick === "Over";
  const confColor =
    pick.confidence >= 85 ? "#14532d" : pick.confidence >= 75 ? "#78350f" : "#7f1d1d";
  const barColor =
    pick.confidence >= 85 ? "#16a34a" : pick.confidence >= 75 ? "#d97706" : "#dc2626";
  const edge = pick.season_avg != null ? (pick.season_avg - pick.line).toFixed(2) : null;

  return (
    <div style={{ ...S.pickCard, ...(isTop ? S.pickCardTop : {}) }}>
      {isTop && <div style={S.topBadge}>⭐ Top pick today</div>}
      <div style={S.pickTopRow}>
        <div style={{ flex: 1 }}>
          <div style={S.playerName}>{pick.player}</div>
          <div style={S.matchupText}>
            {pick.team} vs {pick.opponent} · {pick.prop} {pick.line}
            {pick.pitcher_faced ? ` · vs ${pick.pitcher_faced}` : ""}
          </div>
        </div>
        <div style={{ ...S.pickBadge, ...(isOver ? S.badgeOver : S.badgeUnder) }}>
          {isOver ? "↑" : "↓"} {pick.pick} {pick.line}
        </div>
      </div>

      <div style={S.confRow}>
        <span style={S.confLabel}>Confidence</span>
        <div style={S.barBg}>
          <div style={{ ...S.barFill, width: `${pick.confidence}%`, background: barColor }} />
        </div>
        <span style={{ ...S.confPct, color: confColor }}>{pick.confidence}%</span>
      </div>

      <div style={S.statsRow}>
        <Pill label="Season avg" value={(pick.season_avg || 0).toFixed(1)} />
        <Pill
          label="Hit rate"
          value={`${Math.round(pick.hit_rate_pct || 0)}%`}
          color={pick.hit_rate_pct >= 65 ? "#14532d" : "#78350f"}
        />
        {edge !== null && (
          <Pill
            label="Edge"
            value={`${Number(edge) >= 0 ? "+" : ""}${edge}`}
            color={Number(edge) >= 0 ? "#14532d" : "#7f1d1d"}
          />
        )}
        <div style={S.dotsGroup}>
          <span style={S.dotsLabel}>Last 5</span>
          {(pick.last5 || []).map((v, i) => {
            const hit = isOver ? v >= pick.line : v <= pick.line;
            return (
              <div
                key={i}
                style={{
                  ...S.dot,
                  background: hit ? "#dcfce7" : "#fee2e2",
                  color: hit ? "#14532d" : "#7f1d1d",
                  border: `1px solid ${hit ? "#86efac" : "#fca5a5"}`,
                }}
              >
                {v}
              </div>
            );
          })}
        </div>
      </div>

      <div style={S.analysisBox}>
        <div style={S.edgeLine}>
          <strong>Edge: </strong>
          {pick.key_edge}
        </div>
        <div style={S.reasoningText}>{pick.reasoning}</div>
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
  logo: { fontSize: 24 },
  title: {
    fontSize: 26,
    fontWeight: 700,
    color: "#f8fafc",
    margin: 0,
    letterSpacing: "-0.03em",
  },
  liveBadge: {
    padding: "3px 8px",
    background: "#052e16",
    color: "#4ade80",
    border: "1px solid #166534",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
  },
  subtitle: { fontSize: 13, color: "#64748b", lineHeight: 1.5, margin: 0 },
  gamesCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: "1rem",
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#475569",
    marginBottom: 8,
  },
  gamesRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  gameChip: {
    background: "#1e293b",
    border: "0.5px solid #334155",
    borderRadius: 8,
    padding: "5px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  gameTeams: { fontSize: 12, fontWeight: 700, color: "#e2e8f0" },
  gameTime: { fontSize: 10, color: "#64748b" },
  gamePitchers: { fontSize: 10, color: "#475569" },
  controlsCard: {
    background: "#0f172a",
    border: "0.5px solid #1e293b",
    borderRadius: 16,
    padding: "1.25rem 1.5rem",
    marginBottom: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  controlGroup: { display: "flex", flexDirection: "column", gap: 8 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  chip: {
    padding: "6px 14px",
    borderRadius: 999,
    border: "0.5px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 13,
    cursor: "pointer",
  },
  chipActive: { background: "#1d4ed8", borderColor: "#1d4ed8", color: "#eff6ff" },
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
    color: "#475569",
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
    letterSpacing: "-0.02em",
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
  confRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  confLabel: {
    fontSize: 10,
    color: "#475569",
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
    color: "#475569",
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
    color: "#475569",
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
  reasoningText: { fontSize: 12, color: "#64748b", lineHeight: 1.6 },
  disclaimer: {
    fontSize: 11,
    color: "#334155",
    textAlign: "center",
    marginTop: "1.5rem",
    lineHeight: 1.5,
  },
};
