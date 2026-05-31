/** Normalize player image URL fields on prop objects — SportsDataIO, provider feed, then MLB static. */

function pickFirstUrl(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("//")) return text;
  }
  return "";
}

export function resolveMlbStaticPlayerImage(mlbId = null) {
  const id = String(mlbId || "").trim();
  if (!id || !/^\d+$/.test(id)) return "";
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${id}/headshot/67/current`;
}

export function resolveSportsDataPlayerImage(prop = {}) {
  const season = prop.sportsDataSeason || prop.sportsDataPlayer || prop.sportsDataProfile || {};
  return pickFirstUrl(
    season.PhotoUrl,
    season.Photo,
    season.Headshot,
    season.ImageUrl,
    prop.PhotoUrl,
    prop.Photo,
    prop.Headshot,
    prop.ImageUrl
  );
}

export function resolvePlayerImageUrl(prop = {}) {
  const sportsDataPlayerId =
    prop.sportsDataSeason?.PlayerID ||
    prop.sportsDataPlayerId ||
    prop.PlayerID ||
    null;
  const mlbId =
    prop.mlbId ||
    prop.mlbamId ||
    prop.mlbPlayerId ||
    sportsDataPlayerId ||
    (String(prop.sport || "").toUpperCase() === "MLB" ? prop.playerId : null);

  return (
    resolveSportsDataPlayerImage(prop) ||
    prop.playerImageUrl ||
    prop.playerImage ||
    prop.headshot ||
    prop.imageUrl ||
    prop.image_url ||
    prop.player_image ||
    prop.photo ||
    resolveMlbStaticPlayerImage(mlbId) ||
    ""
  );
}

export function withPlayerImageUrl(prop = {}) {
  const playerImageUrl = resolvePlayerImageUrl(prop);
  const sportsDataPlayerId =
    prop.sportsDataSeason?.PlayerID ||
    prop.sportsDataPlayerId ||
    prop.PlayerID ||
    null;
  const mlbId =
    prop.mlbId ||
    prop.mlbamId ||
    prop.mlbPlayerId ||
    sportsDataPlayerId ||
    (String(prop.sport || "").toUpperCase() === "MLB" ? prop.playerId : null);

  return {
    ...prop,
    playerImageUrl,
    playerImage: playerImageUrl || prop.playerImage || "",
    headshot: playerImageUrl || prop.headshot || "",
    imageUrl: playerImageUrl || prop.imageUrl || "",
    photo: playerImageUrl || prop.photo || "",
    sportsDataPlayerId: sportsDataPlayerId || prop.sportsDataPlayerId || null,
    mlbId: mlbId || prop.mlbId || null,
  };
}
