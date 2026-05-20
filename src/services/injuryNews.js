import { cachedFetch } from "./fetchUtil.js";

const ESPN_INJURY_URLS = {
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
  Soccer: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/injuries",
};

export async function fetchInjuryNews({ props = [] } = {}) {
  const sports = Array.from(new Set(props.map((prop) => prop.sport).filter((sport) => ESPN_INJURY_URLS[sport])));
  if (!sports.length) {
    return { source: "Injury/news", news: new Map(), warnings: [] };
  }

  const settled = await Promise.allSettled(sports.map((sport) => fetchSportInjuries(sport)));
  const news = new Map();

  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((item) => {
      props
        .filter((prop) => sameName(prop.playerName, item.playerName))
        .forEach((prop) => news.set(newsLookupKey(prop), item));
    });
  });

  const failed = settled.some((result) => result.status === "rejected");
  return {
    source: "Injury/news",
    news,
    warnings: failed ? ["Could not load injury/news data."] : [],
  };
}

async function fetchSportInjuries(sport) {
  const response = await cachedFetch(ESPN_INJURY_URLS[sport]);
  if (!response.ok) throw new Error("Could not load injury/news data.");
  const payload = await response.json();
  return extractInjuryItems(payload, sport);
}

function extractInjuryItems(payload, sport) {
  const teams = payload.teams || payload.items || [];
  return teams.flatMap((team) => {
    const athletes = team.athletes || team.injuries || team.players || [];
    return athletes.map((athlete) => {
      const record = athlete.athlete || athlete.player || athlete;
      const status = athlete.status || athlete.type || athlete.description || "News concern";
      return {
        sport,
        playerName: record.displayName || record.fullName || record.name || athlete.name || "",
        status: String(status),
        risk: classifyRisk(status),
      };
    });
  }).filter((item) => item.playerName);
}

function classifyRisk(status) {
  const text = String(status || "").toLowerCase();
  if (text.includes("out") || text.includes("doubtful") || text.includes("il")) return "High";
  if (text.includes("questionable") || text.includes("day-to-day")) return "Medium";
  return "Low";
}

function sameName(a, b) {
  return normalize(a) === normalize(b);
}

function newsLookupKey(prop) {
  return [prop.platform, prop.sport, prop.playerName, prop.statType, prop.startTime]
    .map(normalize)
    .join("|");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
