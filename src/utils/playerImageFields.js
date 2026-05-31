/** Normalize player image URL fields on prop objects. */

function pickFirstUrl(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("//")) return text;
  }
  return "";
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
  return (
    resolveSportsDataPlayerImage(prop) ||
    prop.playerImageUrl ||
    prop.playerImage ||
    prop.headshot ||
    prop.imageUrl ||
    prop.image_url ||
    prop.player_image ||
    prop.photo ||
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
