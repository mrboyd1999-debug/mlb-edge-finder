import { attachSportsbookVerifiedFields } from "./propValidation.js";
import { normalizeSportLabel } from "./sportMappings.js";
import { isUsableParsedProp, normalizePropShape } from "./propShape.js";

const SAMPLE_LIMIT = 3;

function sampleProp(prop = {}) {
  const shaped = normalizePropShape(prop);
  return {
    player: shaped.playerName,
    sport: shaped.sport || shaped.league,
    market: shaped.market || shaped.statType,
    line: shaped.line,
    source: shaped.source || shaped.platform,
  };
}

export function samplePropsAtStage(props = [], limit = SAMPLE_LIMIT) {
  return (props || []).slice(0, limit).map(sampleProp);
}

export function buildPipelineStageReport({
  totalFetched = 0,
  normalized = 0,
  verified = 0,
  sportFiltered = 0,
  scoreFiltered = 0,
  finalDisplayed = 0,
  samples = {},
} = {}) {
  return {
    totalFetched,
    normalized,
    verified,
    sportFiltered,
    scoreFiltered,
    finalDisplayed,
    samples,
  };
}

export function logPipelineStageReport(report = {}, label = "Prop Pipeline") {
  console.info(`[${label}] stage counts`, {
    totalFetched: report.totalFetched,
    normalized: report.normalized,
    verified: report.verified,
    sportFiltered: report.sportFiltered,
    scoreFiltered: report.scoreFiltered,
    finalDisplayed: report.finalDisplayed,
  });
  Object.entries(report.samples || {}).forEach(([stage, rows]) => {
    if (rows?.length) console.info(`[${label}] sample @ ${stage}`, rows);
  });
}

export function buildUsablePropsPool(rawProps = []) {
  return (rawProps || [])
    .filter(isUsableParsedProp)
    .map((prop) => {
      const platform = String(prop.platform || prop.feedSource || prop.source || "").trim();
      const shaped = normalizePropShape(prop, { platform, source: platform || prop.source });
      const sport = normalizeSportLabel(shaped.sport, shaped.league) || shaped.sport || shaped.league;
      return attachSportsbookVerifiedFields(
        { ...shaped, sport, league: shaped.league || sport },
        platform || shaped.platform
      );
    });
}
