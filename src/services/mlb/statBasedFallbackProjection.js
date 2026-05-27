/**
 * Conservative stat-based projection fallback — never returns 0/null.
 */

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function computeConservativeStatProjection({
  last5Avg = null,
  seasonAvg = null,
  line = null,
  matchupModifier = 1,
} = {}) {
  const l5 = finite(last5Avg);
  const season = finite(seasonAvg);
  const ln = finite(line);
  const mod = finite(matchupModifier) ?? 1;

  if (l5 == null && season == null) return null;

  const last5Component = l5 ?? season ?? ln ?? 0;
  const seasonComponent = season ?? l5 ?? ln ?? 0;
  const lineComponent = ln ?? season ?? l5 ?? 0;

  const projection = last5Component * 0.5 + seasonComponent * 0.35 + lineComponent * mod * 0.15;
  if (!Number.isFinite(projection) || projection <= 0) return null;
  return Number(projection.toFixed(2));
}

export function resolveSeasonPerGameRate(statRow = {}, propLabel = "") {
  if (!statRow) return null;
  const games = finite(statRow.Games ?? statRow.GamesPlayed) ?? 1;
  const safeGames = games > 0 ? games : 1;

  const fieldMap = {
    Hits: ["Hits"],
    "Home Runs": ["HomeRuns"],
    RBIs: ["RunsBattedIn", "RBI"],
    Runs: ["Runs"],
    "Total Bases": ["TotalBases"],
    Strikeouts: ["PitchingStrikeouts", "Strikeouts"],
    Walks: ["Walks", "BaseOnBalls"],
    "Fantasy Score": ["FantasyPointsDraftKings", "FantasyPoints", "FantasyPointsFanDuel"],
    "Hits+Runs+RBIs": [],
    "Pitcher Outs": ["InningsPitchedDecimal", "InningsPitched"],
    "Earned Runs": ["EarnedRuns", "PitchingEarnedRuns"],
    "Stolen Bases": ["StolenBases"],
    Doubles: ["Doubles"],
    Singles: ["Singles"],
    "Hits Allowed": ["HitsAllowed", "PitchingHits"],
  };

  if (propLabel === "Hits+Runs+RBIs") {
    const hits = finite(statRow.Hits) ?? 0;
    const runs = finite(statRow.Runs) ?? 0;
    const rbis = finite(statRow.RunsBattedIn ?? statRow.RBI) ?? 0;
    const total = hits + runs + rbis;
    return total > 0 ? Number((total / safeGames).toFixed(2)) : null;
  }

  if (propLabel === "Pitcher Outs") {
    const ip = finite(statRow.InningsPitchedDecimal ?? statRow.InningsPitched);
    if (ip != null) return Number(((ip * 3) / safeGames).toFixed(2));
  }

  const fields = fieldMap[propLabel] || [];
  for (const key of fields) {
    const val = finite(statRow[key]);
    if (val != null) return Number((val / safeGames).toFixed(2));
  }
  return null;
}

export function buildStatFallbackProjection(prop = {}, statRow = {}, propLabel = "") {
  const seasonAvg = resolveSeasonPerGameRate(statRow, propLabel);
  const last5Avg =
    finite(prop.last5Average) ??
    finite(prop.recentAverage) ??
    finite(prop.last10Average) ??
    seasonAvg;

  const projection = computeConservativeStatProjection({
    last5Avg,
    seasonAvg,
    line: prop.line,
    matchupModifier: prop.matchupModifier ?? 1,
  });

  if (projection == null) return null;
  return {
    projection,
    projectionSource: "stat-fallback-weighted",
    last5Avg,
    seasonAvg,
  };
}
