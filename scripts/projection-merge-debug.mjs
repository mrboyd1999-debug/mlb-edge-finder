/**
 * Inspect runtime shapes of raw props vs projection sources and test merge.
 */
import { fetchPrizePicksProps } from "../src/services/prizepicks.js";
import { fetchUnderdogProps } from "../src/services/underdog.js";
import { fetchPlayerStats } from "../src/services/playerStats.js";
import { mergeProjectionsOntoProps, buildSeasonProjectionLookup } from "../src/services/mlb/projectionMergePipeline.js";
import { buildPropMergeKey } from "../src/utils/propMergeKeys.js";

function sampleKeys(obj) {
  return obj && typeof obj === "object" ? Object.keys(obj).sort() : [];
}

function logSample(label, rows = []) {
  console.log(`\n=== ${label} (count=${rows.length}) ===`);
  rows.slice(0, 5).forEach((row, i) => {
    console.log(`[${i}] keys:`, sampleKeys(row));
    console.log(JSON.stringify(row, null, 2).slice(0, 900));
  });
}

async function fetchSeasonStatsViaProxy() {
  const urls = [
    "http://127.0.0.1:4173/api/sportsdataio/stats/json/PlayerSeasonStats/2025",
    "http://127.0.0.1:5173/api/sportsdataio/stats/json/PlayerSeasonStats/2025",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    } catch {
      /* try next */
    }
  }
  return [];
}

const pp = await fetchPrizePicksProps({ sport: "MLB" });
const ud = await fetchUnderdogProps({ sport: "MLB" });
const rawProps = [...(pp.props || []), ...(ud.props || [])].slice(0, 200);

logSample("RAW PROPS", rawProps);

const statsResult = await fetchPlayerStats({ props: rawProps.slice(0, 50) });
const statsMap = statsResult.stats || new Map();
const statsProfiles = [...statsMap.values()].slice(0, 5);
logSample("STATS MAP PROFILES (projections)", statsProfiles);

const seasonStats = await fetchSeasonStatsViaProxy();
logSample("SEASON STATS ROWS", seasonStats);

const lookup = buildSeasonProjectionLookup(seasonStats);
const projectionRows = [...lookup.byKey.values()].slice(0, 5);
logSample("BUILT PROJECTION LOOKUP ROWS", projectionRows);

const mergeResult = mergeProjectionsOntoProps(rawProps, {
  seasonStats,
  statsMap,
});

const matched = mergeResult.props.filter((p) => Number(p.projection ?? p.projectedValue) > 0);
console.log("\n=== MERGE SUMMARY ===");
console.log({
  rawCount: rawProps.length,
  seasonStatRows: seasonStats.length,
  projectionLookupCount: lookup.projectionCount,
  statsMapSize: statsMap.size,
  matchCount: mergeResult.debug.matchCount,
  withProjection: matched.length,
  unmatchedSample: mergeResult.debug.unmatchedSample,
});

console.log("\n=== MATCHED SAMPLES ===");
matched.slice(0, 5).forEach((p, i) => {
  console.log(`[${i}]`, {
    playerName: p.playerName,
    statType: p.statType,
    line: p.line,
    projection: p.projection,
    mergeKey: buildPropMergeKey(p),
    projectionSource: p.projectionSource,
  });
});

console.log("\n=== UNMATCHED KEY ANALYSIS (first 10) ===");
mergeResult.debug.unmatchedSample.forEach((key) => console.log(key));

process.exit(matched.length > 0 ? 0 : 1);
