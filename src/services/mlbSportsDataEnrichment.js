import { getSportsDataApiKey } from "../config/apiConfig.js";
import { cleanApiKey } from "../utils/cleanApiKey.js";
import { ENRICHMENT_TIMEOUT_MESSAGE, getApiTimeoutMs, withFetchTimeout } from "../utils/apiTimeout.js";
import { normalizePlayerName } from "../utils/playerNames.js";
import { SOURCE_LABELS } from "./statEnrichment.js";
import { SPORTSDATA_UNAVAILABLE_MESSAGE } from "./sportsDataService.js";
import {
  fetchBattingAverages,
  fetchPitcherSeasonSplits,
  fetchPlayerGameStats,
  fetchPlayerSeasonStats,
} from "./sportsDataService.js";

function normalizeSportsDataName(value = "") {
  return normalizePlayerName(value);
}

function trendLabel(values = []) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (nums.length < 3) return "";
  const recent = nums.slice(0, 3);
  const prior = nums.slice(3, 6);
  if (!prior.length) return "";
  const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const priorAvg = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  if (recentAvg > priorAvg * 1.1) return "up";
  if (recentAvg < priorAvg * 0.9) return "down";
  return "flat";
}

function recentAverage(rows = [], field, limit = 5) {
  const values = rows
    .map((row) => Number(row?.[field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  const slice = values.slice(0, limit);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

/**
 * Optional MLB enrichment via SportsDataIO proxy — never throws; PP/UD board stays live.
 */
export async function enrichMlbProfilesFromSportsData(profiles = new Map(), props = []) {
  if (!cleanApiKey(getSportsDataApiKey()) || !profiles.size) {
    return { profiles, warnings: [] };
  }

  let enrichment = null;
  try {
    enrichment = await withFetchTimeout(
      async () => {
        const [seasonResult, gameResult, battingResult] = await Promise.all([
          fetchPlayerSeasonStats(),
          fetchPlayerGameStats(),
          fetchBattingAverages(),
        ]);
        return { seasonResult, gameResult, battingResult };
      },
      getApiTimeoutMs({ enrichment: true }),
      {
        label: "SportsDataIO MLB enrichment",
        fallback: () => null,
      }
    );
  } catch {
    enrichment = null;
  }

  if (!enrichment) {
    return {
      profiles,
      warnings: [ENRICHMENT_TIMEOUT_MESSAGE, SPORTSDATA_UNAVAILABLE_MESSAGE],
      sportsDataFailed: true,
    };
  }

  const seasonData = enrichment.seasonResult?.data || [];
  const gameData = enrichment.gameResult?.data || [];
  const battingData = enrichment.battingResult?.data || [];
  const allEmpty = !seasonData.length && !gameData.length && !battingData.length;
  const enrichmentWarnings = [
    ...(enrichment.seasonResult?.warnings || []),
    ...(enrichment.gameResult?.warnings || []),
    ...(enrichment.battingResult?.warnings || []),
  ].filter(Boolean);

  if (allEmpty) {
    return {
      profiles,
      warnings: uniqueWarnings([...enrichmentWarnings, SPORTSDATA_UNAVAILABLE_MESSAGE]),
      sportsDataFailed: true,
    };
  }

  const seasonByName = new Map();
  for (const row of enrichment.seasonResult?.data || []) {
    const key = normalizeSportsDataName(row?.Name);
    if (key) seasonByName.set(key, row);
  }

  const gameRowsByName = new Map();
  for (const row of enrichment.gameResult?.data || []) {
    const key = normalizeSportsDataName(row?.Name);
    if (!key) continue;
    if (!gameRowsByName.has(key)) gameRowsByName.set(key, []);
    gameRowsByName.get(key).push(row);
  }

  const warnings = [...enrichmentWarnings];
  const enriched = new Map(profiles);
  for (const [nameKey, profile] of profiles.entries()) {
    const seasonRow = seasonByName.get(nameKey);
    const recentGames = gameRowsByName.get(nameKey) || [];
    if (!seasonRow && !recentGames.length) continue;

    const strikeoutValues = recentGames.map((row) => Number(row?.PitchingStrikeouts)).filter(Number.isFinite);
    const hitsValues = recentGames.map((row) => Number(row?.Hits)).filter(Number.isFinite);
    const nextProfile = {
      ...profile,
      statSources: [...new Set([...(profile.statSources || []), SOURCE_LABELS.sportsdata])],
      sportsDataSeason: seasonRow || null,
      sportsDataRecentGames: recentGames.slice(0, 10),
      strikeoutTrend: profile.strikeoutTrend || trendLabel(strikeoutValues),
      recentStrikeoutAverage: recentAverage(recentGames, "PitchingStrikeouts"),
      recentHitsAverage: profile.recentHitsAverage ?? recentAverage(recentGames, "Hits"),
      battingAverage:
        profile.battingAverage ??
        (Number.isFinite(Number(seasonRow?.BattingAverage)) ? Number(seasonRow.BattingAverage) : null),
      seasonStrikeouts: Number.isFinite(Number(seasonRow?.PitchingStrikeouts))
        ? Number(seasonRow.PitchingStrikeouts)
        : null,
      seasonInningsPitched: Number.isFinite(Number(seasonRow?.InningsPitchedDecimal))
        ? Number(seasonRow.InningsPitchedDecimal)
        : null,
      hasSportsDataEnrichment: true,
    };

    if (seasonRow?.PlayerID && /strikeout|pitch/i.test(String(profile?.position || ""))) {
      try {
        const splits = await fetchPitcherSeasonSplits(seasonRow.PlayerID);
        if (splits?.data?.length) {
          nextProfile.pitcherSplits = splits.data;
          nextProfile.statSources = [...new Set([...(nextProfile.statSources || []), SOURCE_LABELS.sportsdata])];
        }
        warnings.push(...(splits?.warnings || []));
      } catch {
        // optional enrichment only
      }
    }

    enriched.set(nameKey, nextProfile);
  }

  void props;
  return { profiles: enriched, warnings: uniqueWarnings(warnings), sportsDataFailed: false };
}

function uniqueWarnings(items = []) {
  return [...new Set(items.filter(Boolean))];
}
