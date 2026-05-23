import { useEffect, useMemo, useState } from "react";
import { styles } from "../theme/styles.js";
import { playerInitials } from "../utils/propLabels.js";

/**
 * Resolve the ordered list of headshot URLs to try for a prop, oldest fallback last:
 *   1. Provider-supplied headshot (PrizePicks/Underdog/playerStats enrichment)
 *   2. MLB Photos CDN by player id (mlbId / playerId / mlbamId)
 *   3. SportsDataIO baseball headshot by id (if api key configured & id present)
 *   4. Initials placeholder (handled by parent state)
 */
function buildHeadshotCandidates(prop = {}) {
  const candidates = [];
  const direct = prop.playerImage || prop.headshot || prop.imageUrl || prop.photo || "";
  if (direct) candidates.push(direct);

  const sport = String(prop.sport || "").toUpperCase();
  const mlbId =
    prop.mlbId ||
    prop.mlbamId ||
    prop.mlbPlayerId ||
    (sport === "MLB" ? prop.playerId : null);
  if (mlbId) {
    candidates.push(
      `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${mlbId}/headshot/67/current`
    );
    candidates.push(
      `https://midfield.mlbstatic.com/v1/people/${mlbId}/spots/120`
    );
  }
  return candidates.filter(Boolean);
}

export default function PlayerImage({ prop, large = false }) {
  const initials = playerInitials(prop.playerName);
  const candidates = useMemo(() => buildHeadshotCandidates(prop), [prop]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(candidates.length === 0);

  useEffect(() => {
    setIndex(0);
    setFailed(candidates.length === 0);
  }, [candidates]);

  const wrapStyle = large
    ? { ...styles.playerImageWrap, ...styles.playerImageWrapLarge }
    : styles.playerImageWrap;

  const showInitials = failed || index >= candidates.length;

  return (
    <div className="player-image-wrap" style={wrapStyle} aria-hidden="true">
      {showInitials ? (
        <span className="player-initials-text" style={styles.playerInitials}>{initials}</span>
      ) : (
        <img
          src={candidates[index]}
          alt=""
          style={styles.playerImage}
          loading="lazy"
          onError={() => {
            if (index + 1 < candidates.length) setIndex((i) => i + 1);
            else setFailed(true);
          }}
        />
      )}
    </div>
  );
}
