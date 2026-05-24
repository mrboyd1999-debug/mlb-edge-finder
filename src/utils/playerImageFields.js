/** Normalize player image URL fields on prop objects. */

export function resolvePlayerImageUrl(prop = {}) {
  return (
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
  const mlbId =
    prop.mlbId ||
    prop.mlbamId ||
    prop.mlbPlayerId ||
    prop.sportsDataSeason?.PlayerID ||
    (String(prop.sport || "").toUpperCase() === "MLB" ? prop.playerId : null);

  return {
    ...prop,
    playerImageUrl,
    playerImage: playerImageUrl || prop.playerImage || "",
    headshot: playerImageUrl || prop.headshot || "",
    imageUrl: playerImageUrl || prop.imageUrl || "",
    mlbId: mlbId || prop.mlbId || null,
  };
}
