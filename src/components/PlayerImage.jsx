import { useEffect, useMemo, useState } from "react";
import { styles } from "../theme/styles.js";
import { playerInitials } from "../utils/propLabels.js";
import { hasCachedPlayerImage, preloadPlayerImage, rememberPlayerImage } from "../utils/playerImageCache.js";

function initialsBadgeColor(name = "") {
  const text = String(name || "").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    background: `hsl(${hue} 42% 22%)`,
    color: `hsl(${hue} 78% 88%)`,
    border: `1px solid hsl(${hue} 38% 34%)`,
  };
}

function buildHeadshotCandidates(prop = {}) {
  const candidates = [];
  const direct = prop.playerImageUrl || prop.playerImage || prop.headshot || prop.imageUrl || prop.photo || "";
  if (direct) candidates.push(direct);

  const sport = String(prop.sport || prop.league || "").toUpperCase();
  const nbaId = prop.nbaId || prop.nbaPlayerId || (/(nba|wnba)/i.test(sport) ? prop.playerId : null);
  if (nbaId) {
    candidates.push(`https://a.espncdn.com/i/headshots/nba/players/full/${nbaId}.png`);
  }

  const mlbId =
    prop.mlbId ||
    prop.mlbamId ||
    prop.mlbPlayerId ||
    (sport === "MLB" ? prop.playerId : null);
  if (mlbId) {
    candidates.push(
      `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${mlbId}/headshot/67/current`
    );
    candidates.push(`https://midfield.mlbstatic.com/v1/people/${mlbId}/spots/120`);
    candidates.push(`https://a.espncdn.com/i/headshots/mlb/players/full/${mlbId}.png`);
  }
  return candidates.filter(Boolean);
}

export default function PlayerImage({ prop, large = false }) {
  const playerLabel = prop.playerName || prop.player || "";
  const initials = playerInitials(playerLabel);
  const initialsStyle = initialsBadgeColor(playerLabel);
  const candidates = useMemo(() => buildHeadshotCandidates(prop), [prop]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(candidates.length === 0);

  useEffect(() => {
    setIndex(0);
    setFailed(candidates.length === 0);
    candidates.forEach((url) => preloadPlayerImage(url));
  }, [candidates]);

  const wrapStyle = large
    ? { ...styles.playerImageWrap, ...styles.playerImageWrapLarge }
    : styles.playerImageWrap;

  const currentUrl = candidates[index];
  const showInitials = failed || index >= candidates.length;

  return (
    <div className="player-image-wrap" style={wrapStyle} aria-hidden="true">
      {showInitials ? (
        <span
          className="player-initials-text"
          style={{ ...styles.playerInitials, ...initialsStyle }}
          aria-label={playerLabel ? `${playerLabel} initials` : "Player initials"}
        >
          {initials}
        </span>
      ) : (
        <img
          src={currentUrl}
          alt=""
          style={styles.playerImage}
          loading="lazy"
          decoding="async"
          onLoad={() => rememberPlayerImage(currentUrl)}
          onError={() => {
            if (hasCachedPlayerImage(currentUrl) === false) {
              // try next candidate
            }
            if (index + 1 < candidates.length) setIndex((i) => i + 1);
            else setFailed(true);
          }}
        />
      )}
    </div>
  );
}
