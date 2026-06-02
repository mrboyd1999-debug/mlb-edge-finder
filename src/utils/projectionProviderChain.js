/**
 * Projection provider chain: SportsDataIO → MLB Stats → Generated → Fallback (capped).
 */

import { findStatProfile } from "../services/playerStats.js";
import { buildStatFallbackProjection } from "../services/mlb/statBasedFallbackProjection.js";
import { buildNormalizedProjectionFallback } from "./pipelineProjectionAttach.js";
import { generateProjectionForProp } from "./generatedProjectionEngine.js";
import { resolvePropSport } from "./mlbOnlyMode.js";

const MAX_FALLBACK_RATIO = 0.25;

function finite(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeProjectionSourceBucket(source = "", prop = {}) {
  const key = String(source || prop.projectionStatus || "").toLowerCase();
  if (/sportsdata|sportsdataio|daily projection|merged-projection/.test(key)) return "sportsdataio";
  if (/mlbstats|stats-map|player-stats|stat-fallback|stats api|mlb stat|player-stats-model|player-stats-estimate/.test(key)) {
    return "mlbstats";
  }
  if (prop.isGeneratedProjection || key === "generated" || /generated|engine-model/.test(key)) {
    return "generated";
  }
  if (
    prop.isFallbackProjection ||
    prop.isNormalizedFallbackProjection ||
    /fallback|line-based|normalized-fallback|neutral-historical|line-neutral/.test(key)
  ) {
    return "fallback";
  }
  if (key && !/missing|unavailable|unknown/.test(key)) return "generated";
  return "fallback";
}

export function formatProjectionSourceLabel(source = "", prop = {}) {
  const bucket = normalizeProjectionSourceBucket(source, prop);
  if (bucket === "sportsdataio") return "SportsDataIO";
  if (bucket === "mlbstats") return "MLB Stats";
  if (bucket === "generated") return "Generated";
  return "Fallback";
}

function hasUsableProjection(prop = {}) {
  const projection = finite(prop.projection ?? prop.projectedValue);
  return projection != null && projection > 0;
}

function resolveExistingProviderProjection(prop = {}) {
  if (!hasUsableProjection(prop)) return null;
  const bucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
  if (bucket === "fallback") return null;
  return {
    projection: finite(prop.projection ?? prop.projectedValue),
    projectionSource: bucket,
    projectionStatus: prop.projectionStatus || bucket,
    isFallbackProjection: false,
    isGeneratedProjection: bucket === "generated",
    projectionMerged: true,
  };
}

function resolveMlbStatsProjection(prop = {}, statsMap = null, seasonStats = []) {
  if (statsMap instanceof Map) {
    const profile = findStatProfile(statsMap, prop);
    const profileProjection = finite(profile?.projection ?? profile?.projectedValue);
    if (profileProjection != null && profileProjection > 0 && !profile?.fallback) {
      return {
        projection: profileProjection,
        projectedValue: profileProjection,
        projectionSource: "mlbstats",
        projectionStatus: "mlbstats",
        isFallbackProjection: false,
        projectionMerged: true,
        last5Average: profile.last5Average ?? prop.last5Average,
        seasonAverage: profile.seasonAverage ?? prop.seasonAverage,
      };
    }
  }

  const statRow =
    (seasonStats || []).find(
      (row) =>
        String(row?.Name || row?.name || "")
          .trim()
          .toLowerCase() === String(prop.playerName || prop.player || "").trim().toLowerCase()
    ) || null;

  if (statRow) {
    const fallback = buildStatFallbackProjection(prop, statRow, prop.statType || prop.market || "");
    if (fallback?.projection > 0) {
      return {
        projection: fallback.projection,
        projectedValue: fallback.projection,
        projectionSource: "mlbstats",
        projectionStatus: "mlbstats",
        isFallbackProjection: false,
        projectionMerged: true,
        last5Average: fallback.last5Avg,
        seasonAverage: fallback.seasonAvg,
      };
    }
  }

  return null;
}

function attachProjection(prop = {}, patch = {}) {
  const projection = finite(patch.projection ?? patch.projectedValue);
  return {
    ...prop,
    ...patch,
    projection,
    projectedValue: projection,
    displayProjectionSource: formatProjectionSourceLabel(patch.projectionSource, patch),
  };
}

function countBucket(props = []) {
  const counts = { sportsdataio: 0, mlbstats: 0, generated: 0, fallback: 0 };
  for (const prop of props) {
    const bucket = normalizeProjectionSourceBucket(prop.projectionSource, prop);
    counts[bucket] += 1;
  }
  return counts;
}

/** Apply provider chain to every prop; cap line fallbacks at 25% of pool. */
export function applyProjectionProviderChain(props = [], context = {}) {
  const statsMap = context.statsMap instanceof Map ? context.statsMap : null;
  const seasonStats = context.seasonStats || [];
  const maxFallbackRatio = context.maxFallbackRatio ?? MAX_FALLBACK_RATIO;
  const mlbProps = (props || []).filter((prop) => {
    const sport = resolvePropSport(prop);
    return !sport || sport === "MLB";
  });

  const staged = mlbProps.map((prop) => {
    const existing = resolveExistingProviderProjection(prop);
    if (existing) return attachProjection(prop, existing);

    const mlbStats = resolveMlbStatsProjection(prop, statsMap, seasonStats);
    if (mlbStats) return attachProjection(prop, mlbStats);

    const profile = statsMap ? findStatProfile(statsMap, prop) : null;
    const generated = generateProjectionForProp(prop, profile);
    if (generated) return attachProjection(prop, generated);

    return { ...prop, needsLineFallback: true };
  });

  const maxFallback = Math.max(1, Math.floor(staged.length * maxFallbackRatio));
  let fallbackUsed = 0;
  const output = staged.map((prop) => {
    if (!prop.needsLineFallback) return prop;
    if (fallbackUsed >= maxFallback) {
      const generated = generateProjectionForProp(prop, statsMap ? findStatProfile(statsMap, prop) : null);
      if (generated) return attachProjection({ ...prop, needsLineFallback: false }, generated);
    }
    fallbackUsed += 1;
    const fallback = buildNormalizedProjectionFallback(prop);
    return attachProjection(
      { ...prop, needsLineFallback: false },
      {
        projection: finite(fallback.projection ?? fallback.projectedValue),
        projectionSource: "fallback",
        projectionStatus: "fallback",
        isFallbackProjection: true,
        isNormalizedFallbackProjection: true,
      }
    );
  });

  const counts = countBucket(output);
  const nonMlb = (props || []).filter((prop) => {
    const sport = resolvePropSport(prop);
    return sport && sport !== "MLB";
  });

  return {
    props: [...output, ...nonMlb],
    counts,
    verifiedProjections: counts.sportsdataio,
    generatedProjections: counts.generated,
    fallbackProjections: counts.fallback,
    mlbStatsProjections: counts.mlbstats,
    fallbackCap: maxFallback,
    fallbackUsed,
  };
}

export function auditProjectionSourceCounts(props = []) {
  return countBucket(props);
}
