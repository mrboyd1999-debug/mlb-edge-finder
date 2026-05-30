import { canonicalMarketKey } from "../utils/marketNormalization.js";
import {
  computeWeightedRollingProjection,
  buildRollingFormReason,
} from "../utils/mlbRollingProjection.js";
import { formatNumber } from "../utils/formatters.js";
import {
  buildMlbPitcherDataPackage,
  computeOpponentKAdjustment,
  hasVerifiedPitcherGameLogs,
  hasVerifiedStrikeoutGameLogs,
  isMlbPitcherMarket,
  isStrikeoutMarket,
  MLB_PITCHER_MARKET_KEYS,
} from "./mlbPitcherData.js";
import {
  battingOrderAdjustment,
  buildMlbHitterDataPackage,
  handednessHitterAdjustment,
  hasMlbHitterStatInputs,
  hasVerifiedHitterGameLogs,
  isMlbHitterPhase2Market,
  isoPowerAdjustment,
  MLB_HITTER_PHASE2_MARKETS,
  opponentPitcherAdjustment,
  parkFactorAdjustment,
  vegasAdjustment,
  weatherAdjustment,
} from "./mlbHitterData.js";
import {
  appendDataStatusRow,
  appendFinalProjectionRow,
  buildBreakdownRow,
  buildUnavailableProjectionBreakdown,
  DATA_STATUS,
  dataStatusLabel,
  isFallbackDataStatus,
  isVerifiedProjectionStatus,
  projectionConfidenceFromDataStatus,
  projectionLabelFromDataStatus,
  PROJECTION_UNAVAILABLE_LABEL,
  resolveDataStatus,
  VERIFIED_PROJECTION_LABEL,
} from "./projectionBreakdown.js";

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function baselineRate(last5, season) {
  if (last5 != null && season != null) return last5 * 0.54 + season * 0.46;
  return last5 ?? season ?? null;
}

function opponentStrikeoutRate(data = {}) {
  const core = baselineRate(data.last5Average, data.seasonAverage);
  const oppK = finiteNumber(data.opponentContext?.strikeoutsPerGame);
  if (core == null || oppK == null) return core;
  const leagueK = 8.4;
  return round(core * (1 + ((oppK - leagueK) / leagueK) * 0.35), 2);
}

function pitchCountRate(data = {}, core = null) {
  const base = core ?? baselineRate(data.last5Average, data.seasonAverage);
  const pitches = finiteNumber(data.projectedPitchCount);
  if (base == null || pitches == null) return base;
  return round(base * (pitches / 92), 2);
}

function inningsRate(data = {}, core = null) {
  const base = core ?? baselineRate(data.last5Average, data.seasonAverage);
  const ip = finiteNumber(data.projectedInnings);
  if (base == null || ip == null) return base;
  return round(base * (ip / 5.5), 2);
}

function opponentAllowedRate(data = {}, kind = "hits") {
  const core = baselineRate(data.last5Average, data.seasonAverage);
  const opponent = data.opponentContext || {};
  const league = kind === "hits" ? 8.6 : 4.5;
  const oppVal =
    kind === "hits"
      ? finiteNumber(opponent.hitsAllowedPerGame) ?? finiteNumber(opponent.hitsPerGame)
      : finiteNumber(opponent.runsScoredPerGame);
  if (core == null || oppVal == null) return core;
  return round(core * (1 + ((oppVal - league) / league) * 0.25), 2);
}

function weightedPitcherProjection(components = []) {
  const clean = components.filter((part) => finiteNumber(part.value) != null && part.weight > 0);
  if (!clean.length) return null;
  const weightSum = clean.reduce((sum, part) => sum + part.weight, 0);
  return round(
    clean.reduce((sum, part) => sum + finiteNumber(part.value) * (part.weight / weightSum), 0),
    1
  );
}

function finalizePitcherProjection({ projection, breakdown, dataStatus, data, marketKey, profile = {} }) {
  if (!Number.isFinite(projection) || projection <= 0) {
    return {
      projectedValue: null,
      projectionBreakdown: breakdown,
      projectionSource: "missing",
      projectionLabel: PROJECTION_UNAVAILABLE_LABEL,
      dataStatus: DATA_STATUS.UNAVAILABLE,
      isFallbackProjection: true,
      projectionConfidence: null,
      reasoning: ["Insufficient verified MLB pitcher data for this market."],
      pitcherInputs: data,
    };
  }

  appendFinalProjectionRow(breakdown, projection, "Final Projection");
  appendDataStatusRow(breakdown, dataStatus);

  const isFallback = isFallbackDataStatus(dataStatus);
  const isVerified = isVerifiedProjectionStatus(dataStatus);
  return {
    projectedValue: round(projection, 1),
    projectionBreakdown: breakdown,
    projectionSource: isFallback ? "manual-fallback" : "player-stats-model",
    projectionLabel: isVerified ? VERIFIED_PROJECTION_LABEL : PROJECTION_UNAVAILABLE_LABEL,
    dataStatus,
    isFallbackProjection: isFallback,
    isVerifiedProjection: isVerified,
    projectionConfidence: projectionConfidenceFromDataStatus(dataStatus, data.sampleSize || 0),
    reasoning: breakdown
      .filter((row) => row.label !== "Data status")
      .map((row) => `${row.label}: ${row.display ?? row.value}`),
    pitcherInputs: {
      playerName: data.playerName,
      team: data.team,
      opponent: data.opponent,
      statType: data.statType,
      line: data.line,
      pickDirection: data.pickDirection,
      source: data.source,
      last5AvgKs: data.last5Average,
      seasonAvgKs: data.seasonAverage,
      opponentKAdjustment: data.opponentKAdjustment,
      projectedInnings: data.projectedInnings,
      projectedPitchCount: data.projectedPitchCount,
      pitchCountTrend: data.pitchCountTrend?.label || null,
      handednessMatchup: data.handednessMatchup || null,
    },
  };
}

export function projectPitcherStrikeouts(prop = {}, profile = {}, context = {}) {
  const data = buildMlbPitcherDataPackage(prop, profile, context);
  const breakdown = [];
  const verified = hasVerifiedStrikeoutGameLogs(data, profile);

  if (!verified) {
    const rolling = computeWeightedRollingProjection(data.statValues || data.last5Starts || [], 5, 3);
    if (rolling?.value > 0) {
      breakdown.push(
        buildBreakdownRow("Rolling form fallback (L5)", rolling.value, {
          display: buildRollingFormReason({ window: 5, sampleSize: rolling.sampleSize, statLabel: "starts" }),
          contribution: rolling.value,
        })
      );
      return finalizePitcherProjection({
        projection: rolling.value,
        breakdown,
        dataStatus: DATA_STATUS.PARTIAL,
        data,
        marketKey: "strikeouts",
        profile,
      });
    }
    return finalizePitcherProjection({
      projection: null,
      breakdown: buildUnavailableProjectionBreakdown(null, "No verified MLB starter game logs"),
      dataStatus: DATA_STATUS.UNAVAILABLE,
      data,
      marketKey: "strikeouts",
      profile,
    });
  }

  const last5 = data.last5Average;
  const season = data.seasonAverage;
  const { adjustment: oppAdj, oppRate, core } = computeOpponentKAdjustment(data);

  const pitchRate =
    data.projectedPitchCount != null && core != null ? round(core * (data.projectedPitchCount / 92), 2) : core;
  const ipRate = data.projectedInnings != null && core != null ? round(core * (data.projectedInnings / 5.5), 2) : core;

  const vegasTotal = finiteNumber(context.impliedGameTotal ?? profile.impliedGameTotal ?? profile.impliedTeamTotal);
  const vegasRate =
    core != null && vegasTotal != null ? round(core + (vegasTotal - 8.5) * 0.08, 2) : core;

  const weatherNote = profile.weatherNote || context.weatherNote || data.weatherNote || "";
  const parkNote = profile.parkFactorNote || data.parkFactorNote || "";
  let parkWeatherAdj = 0;
  if (/wind out|blowing out|hot|carry/i.test(weatherNote)) parkWeatherAdj += 0.08;
  else if (/wind in|cold|dome/i.test(weatherNote)) parkWeatherAdj -= 0.06;
  if (/hitter-friendly|offensive/i.test(parkNote)) parkWeatherAdj += 0.05;
  else if (/pitcher-friendly/i.test(parkNote)) parkWeatherAdj -= 0.05;
  const parkWeatherRate = core != null ? round(core + parkWeatherAdj, 2) : core;

  const components = [
    { label: "Recent form (L5)", value: last5, weight: 0.35 },
    { label: "Opponent K rate", value: oppRate ?? last5, weight: 0.25, display: oppAdj != null ? `${oppAdj >= 0 ? "+" : ""}${oppAdj}` : undefined },
    { label: "Innings trend", value: ipRate ?? last5, weight: 0.15 },
    { label: "Pitch count trend", value: pitchRate ?? last5, weight: 0.1 },
    { label: "Vegas / game env", value: vegasRate ?? last5, weight: 0.1, display: vegasTotal != null ? `O/U ${formatNumber(vegasTotal)}` : undefined },
    { label: "Park / weather", value: parkWeatherRate ?? last5, weight: 0.05, display: parkNote || weatherNote || undefined },
  ];

  components.forEach((part) => {
    if (part.value == null) return;
    breakdown.push(
      buildBreakdownRow(part.label, part.value, {
        weight: part.weight,
        contribution: round(part.value * part.weight, 2),
        display: part.display,
      })
    );
  });

  if (data.projectedInnings != null) {
    breakdown.push(
      buildBreakdownRow("Projected Innings", data.projectedInnings, {
        display: `${round(data.projectedInnings, 1)} IP`,
        contribution: 0,
      })
    );
  }

  if (data.pitchCountTrend?.label) {
    breakdown.push(
      buildBreakdownRow("Pitch count trend", data.pitchCountTrend.label, {
        display: data.pitchCountTrend.label,
        contribution: 0,
      })
    );
  }

  if (data.handednessMatchup && data.handednessBoost !== 0) {
    breakdown.push(
      buildBreakdownRow("Handedness matchup", data.handednessMatchup, {
        display: data.handednessMatchup,
        contribution: data.handednessBoost,
      })
    );
  }

  if (data.probableStarterConfirmed) {
    breakdown.push(
      buildBreakdownRow("Probable starter", "Confirmed", {
        display: "Verified starter role",
        contribution: 0,
      })
    );
  }

  if (data.homeAwaySplit) {
    breakdown.push(
      buildBreakdownRow("Home/Away split", data.homeAwaySplit, {
        display: data.homeAwaySplit,
        contribution: 0,
      })
    );
  }

  data.opponentKAdjustment = oppAdj;

  let projection = weightedPitcherProjection(components);
  if (data.handednessBoost) projection = round(projection + data.handednessBoost, 1);

  const dataStatus = resolveDataStatus({
    hasGameLogs: true,
    hasCoreRates: true,
    hasOpponent: data.hasOpponent,
    hasWorkload: data.hasWorkload,
  });

  return finalizePitcherProjection({ projection, breakdown, dataStatus, data, marketKey: "strikeouts", profile });
}

export function projectPitchingOuts(prop = {}, profile = {}, context = {}) {
  const data = buildMlbPitcherDataPackage(prop, profile, context);
  const breakdown = [];
  const { last5Average: last5, seasonAverage: season, projectedInnings: ip } = data;

  if (ip == null && last5 == null && season == null) {
    return finalizePitcherProjection({
      projection: null,
      breakdown: buildUnavailableProjectionBreakdown(null),
      dataStatus: DATA_STATUS.UNAVAILABLE,
      data,
      marketKey: "outs",
    });
  }

  const outsPerInning =
    last5 != null && ip != null
      ? last5 / Math.max(ip, 3.5)
      : season != null && ip != null
        ? season / Math.max(ip, 3.5)
        : 2.9;

  const ipDriven = ip != null ? round(ip * outsPerInning, 1) : null;
  const components = [
    { label: "Last 5 avg", value: last5, weight: 0.25 },
    { label: "Season avg", value: season, weight: 0.2 },
    { label: "Innings factor", value: ipDriven, weight: 0.4 },
    { label: "Opponent adjustment", value: opponentAllowedRate(data, "hits"), weight: 0.15 },
  ];

  components.forEach((part) => {
    if (part.value == null) return;
    breakdown.push(
      buildBreakdownRow(part.label, part.value, {
        weight: part.weight,
        contribution: round(part.value * part.weight, 2),
        display: part.label === "Innings factor" && ip != null ? `${formatNumber(ip)} IP` : undefined,
      })
    );
  });

  const projection = weightedPitcherProjection(components);
  const dataStatus = resolveDataStatus({
    hasGameLogs: hasVerifiedPitcherGameLogs(data),
    hasCoreRates: last5 != null || season != null,
    hasOpponent: Boolean(data.hasOpponent),
    hasWorkload: ip != null,
  });

  return finalizePitcherProjection({ projection, breakdown, dataStatus, data, marketKey: "outs" });
}

export function projectHitsAllowed(prop = {}, profile = {}, context = {}) {
  const data = buildMlbPitcherDataPackage(prop, profile, context);
  const breakdown = [];
  const { last5Average: last5, seasonAverage: season } = data;

  if (last5 == null && season == null) {
    return finalizePitcherProjection({
      projection: null,
      breakdown: buildUnavailableProjectionBreakdown(null),
      dataStatus: DATA_STATUS.UNAVAILABLE,
      data,
      marketKey: "hitsAllowed",
    });
  }

  const components = [
    { label: "Last 5 avg", value: last5, weight: 0.3 },
    { label: "Last 10 avg", value: data.last10Average, weight: 0.15 },
    { label: "Season avg", value: season, weight: 0.3 },
    { label: "Opponent adjustment", value: opponentAllowedRate(data, "hits"), weight: 0.15 },
    { label: "Innings factor", value: inningsRate(data), weight: 0.1 },
  ];

  components.forEach((part) => {
    if (part.value == null) return;
    breakdown.push(
      buildBreakdownRow(part.label, part.value, {
        weight: part.weight,
        contribution: round(part.value * part.weight, 2),
        display: part.label === "Innings factor" && data.projectedInnings != null ? `${formatNumber(data.projectedInnings)} IP` : undefined,
      })
    );
  });

  const projection = weightedPitcherProjection(components);
  const dataStatus = resolveDataStatus({
    hasGameLogs: hasVerifiedPitcherGameLogs(data),
    hasCoreRates: true,
    hasOpponent: Boolean(data.hasOpponent),
    hasWorkload: data.projectedInnings != null,
  });

  return finalizePitcherProjection({ projection, breakdown, dataStatus, data, marketKey: "hitsAllowed" });
}

export function projectEarnedRunsAllowed(prop = {}, profile = {}, context = {}) {
  const data = buildMlbPitcherDataPackage(prop, profile, context);
  const breakdown = [];
  const { last5Average: last5, seasonAverage: season } = data;

  if (last5 == null && season == null) {
    return finalizePitcherProjection({
      projection: null,
      breakdown: buildUnavailableProjectionBreakdown(null),
      dataStatus: DATA_STATUS.UNAVAILABLE,
      data,
      marketKey: "earnedRuns",
    });
  }

  const components = [
    { label: "Last 5 avg", value: last5, weight: 0.35 },
    { label: "Season avg", value: season, weight: 0.3 },
    { label: "Opponent adjustment", value: opponentAllowedRate(data, "runs"), weight: 0.2 },
    { label: "Innings factor", value: inningsRate(data), weight: 0.15 },
  ];

  components.forEach((part) => {
    if (part.value == null) return;
    breakdown.push(
      buildBreakdownRow(part.label, part.value, {
        weight: part.weight,
        contribution: round(part.value * part.weight, 2),
        display: part.label === "Innings factor" && data.projectedInnings != null ? `${formatNumber(data.projectedInnings)} IP` : undefined,
      })
    );
  });

  const projection = weightedPitcherProjection(components);
  const dataStatus = resolveDataStatus({
    hasGameLogs: hasVerifiedPitcherGameLogs(data),
    hasCoreRates: true,
    hasOpponent: Boolean(data.hasOpponent),
    hasWorkload: data.projectedInnings != null,
  });

  return finalizePitcherProjection({ projection, breakdown, dataStatus, data, marketKey: "earnedRuns" });
}

function finalizeHitterProjection({ projection, breakdown, dataStatus, data, marketKey, profile = {} }) {
  return finalizePitcherProjection({ projection, breakdown, dataStatus, data, marketKey, profile });
}

function weightedHitterProjection(components = []) {
  return weightedPitcherProjection(components);
}

function projectVerifiedHitterMarket(prop = {}, profile = {}, context = {}, marketKey = "") {
  const data = buildMlbHitterDataPackage(prop, profile, context);
  const breakdown = [];
  const verified = hasVerifiedHitterGameLogs(data, profile);

  if (!verified) {
    const values = data.statValues || [];
    const rolling = computeWeightedRollingProjection(values, 10, 3);
    if (rolling?.value > 0) {
      breakdown.push(
        buildBreakdownRow("Rolling form fallback (L10)", rolling.value, {
          display: buildRollingFormReason({ window: 10, sampleSize: rolling.sampleSize, statLabel: "games" }),
          contribution: rolling.value,
        })
      );
      return finalizeHitterProjection({
        projection: rolling.value,
        breakdown,
        dataStatus: DATA_STATUS.PARTIAL,
        data,
        marketKey,
        profile,
      });
    }
    return finalizeHitterProjection({
      projection: null,
      breakdown: buildUnavailableProjectionBreakdown(null, "No verified MLB hitter game logs (need 3+ games)"),
      dataStatus: DATA_STATUS.UNAVAILABLE,
      data,
      marketKey,
      profile,
    });
  }

  const recent = data.last10Average ?? data.last5Average;
  const last5 = data.last5Average;
  const season = data.seasonAverage;
  const core = last5 != null && season != null ? last5 * 0.54 + season * 0.46 : last5 ?? season;

  const matchupAdj = opponentPitcherAdjustment(data.opponentPitcherWhip);
  const matchupRate = core != null ? round(core + matchupAdj, 2) : null;
  const handAdj = handednessHitterAdjustment(data.handednessMatchup);
  const handednessRate = core != null ? round(core + handAdj, 2) : null;
  const orderAdj = battingOrderAdjustment(data.battingOrderNote);
  const orderRate = core != null ? round(core + orderAdj, 2) : null;
  const parkAdj = parkFactorAdjustment(data.parkFactorNote);
  const weatherAdj = weatherAdjustment(data.weatherNote);
  const parkWeatherRate = core != null ? round(core + parkAdj + weatherAdj, 2) : null;
  const vegasAdj = vegasAdjustment(data.impliedGameTotal);
  const vegasRate = core != null ? round(core + vegasAdj, 2) : null;

  const components = [
    { label: "Recent form (L10)", value: recent, weight: 0.35 },
    { label: "Season baseline", value: season, weight: 0.2 },
    { label: "Pitcher matchup", value: matchupRate ?? recent, weight: 0.15, display: data.opponentPitcherWhip != null ? `WHIP ${formatNumber(data.opponentPitcherWhip)}` : undefined },
    { label: "Handedness split", value: handednessRate ?? recent, weight: 0.1, display: data.handednessMatchup || undefined },
    { label: "Batting order", value: orderRate ?? recent, weight: 0.1, display: data.battingOrderNote || undefined },
    { label: "Park / weather", value: parkWeatherRate ?? recent, weight: 0.05, display: data.parkFactorNote || data.weatherNote || undefined },
    { label: "Vegas / game env", value: vegasRate ?? recent, weight: 0.05, display: data.impliedGameTotal != null ? `O/U ${formatNumber(data.impliedGameTotal)}` : undefined },
  ];

  components.forEach((part) => {
    if (part.value == null) return;
    breakdown.push(
      buildBreakdownRow(part.label, part.value, {
        weight: part.weight,
        contribution: round(part.value * part.weight, 2),
        display: part.display,
      })
    );
  });

  let projection = weightedHitterProjection(components) ?? core;

  if (marketKey === "totalBases") {
    const isoAdj = isoPowerAdjustment(data.isolatedPower, marketKey);
    if (isoAdj !== 0) {
      breakdown.push(
        buildBreakdownRow("ISO power", data.isolatedPower, {
          display: data.isolatedPower != null ? formatNumber(data.isolatedPower) : "Power context",
          contribution: isoAdj,
        })
      );
      projection = round(projection + isoAdj, 1);
    }
  }

  if (data.opponentStarterNote) {
    breakdown.push(
      buildBreakdownRow("Opponent starter", data.opponentStarterNote, {
        display: data.opponentStarterNote,
        contribution: 0,
      })
    );
  }

  if (data.consistencyScore != null) {
    breakdown.push(
      buildBreakdownRow("Consistency", round(data.consistencyScore * 100, 0), {
        display: `${Math.round(data.consistencyScore * 100)}% stable`,
        contribution: 0,
      })
    );
  }

  const dataStatus = resolveDataStatus({
    hasGameLogs: true,
    hasCoreRates: true,
    hasOpponent: data.hasOpponent,
    hasWorkload: Boolean(data.battingOrderNote || data.handednessMatchup),
  });

  return finalizeHitterProjection({ projection, breakdown, dataStatus, data, marketKey, profile });
}

export function projectHitterFantasyScore(prop = {}, profile = {}, context = {}) {
  return projectVerifiedHitterMarket(prop, profile, context, "fantasyScore");
}

export function projectHitterHrr(prop = {}, profile = {}, context = {}) {
  return projectVerifiedHitterMarket(prop, profile, context, "hrr");
}

export function projectHitterTotalBases(prop = {}, profile = {}, context = {}) {
  return projectVerifiedHitterMarket(prop, profile, context, "totalBases");
}

export function projectMlbHitterProp(prop = {}, profile = {}, context = {}) {
  const key = canonicalMarketKey(prop.statType);
  if (key === "fantasyScore") return projectHitterFantasyScore(prop, profile, context);
  if (key === "hrr") return projectHitterHrr(prop, profile, context);
  if (key === "totalBases") return projectHitterTotalBases(prop, profile, context);
  return null;
}

export function projectMlbPitcherProp(prop = {}, profile = {}, context = {}) {
  const key = canonicalMarketKey(prop.statType);
  if (key === "strikeouts") return projectPitcherStrikeouts(prop, profile, context);
  if (key === "outs") return projectPitchingOuts(prop, profile, context);
  if (key === "hitsAllowed") return projectHitsAllowed(prop, profile, context);
  if (key === "earnedRuns") return projectEarnedRunsAllowed(prop, profile, context);
  return null;
}

export function hasMlbPitcherStatInputs(profile = {}) {
  return Boolean(
    finiteNumber(profile.last5Average) ||
      finiteNumber(profile.seasonAverage) ||
      finiteNumber(profile.last10Average) ||
      (profile.gradingRows || profile.splits || []).length >= 3
  );
}

export {
  isMlbPitcherMarket,
  MLB_PITCHER_MARKET_KEYS,
  buildMlbPitcherDataPackage,
  hasVerifiedPitcherGameLogs,
  hasVerifiedStrikeoutGameLogs,
  isStrikeoutMarket,
} from "./mlbPitcherData.js";
export {
  isMlbHitterPhase2Market,
  MLB_HITTER_PHASE2_MARKETS,
  hasMlbHitterStatInputs,
  buildMlbHitterDataPackage,
  hasVerifiedHitterGameLogs,
} from "./mlbHitterData.js";
export { DATA_STATUS, dataStatusLabel } from "./projectionBreakdown.js";

export const MLB_HITTER_ENGINE = {
  markets: MLB_HITTER_PHASE2_MARKETS,
  project: projectMlbHitterProp,
};

export const MLB_PITCHER_ENGINE = {
  markets: MLB_PITCHER_MARKET_KEYS,
  project: projectMlbPitcherProp,
};
