import { useEffect, useState } from "react";
import { styles } from "../theme/styles.js";
import { playerInitials } from "../utils/propLabels.js";

export default function PlayerImage({ prop, large = false }) {
  const initials = playerInitials(prop.playerName);
  const remoteSrc = prop.playerImage || prop.headshot || prop.imageUrl || "";
  const [showInitials, setShowInitials] = useState(!remoteSrc);
  const [src, setSrc] = useState(remoteSrc);

  useEffect(() => {
    setSrc(remoteSrc);
    setShowInitials(!remoteSrc);
  }, [remoteSrc]);

  const wrapStyle = large
    ? { ...styles.playerImageWrap, ...styles.playerImageWrapLarge }
    : styles.playerImageWrap;

  return (
    <div style={wrapStyle} aria-hidden="true">
      {showInitials ? (
        <span style={styles.playerInitials}>{initials}</span>
      ) : (
        <img
          src={src}
          alt=""
          style={styles.playerImage}
          loading="lazy"
          onError={() => setShowInitials(true)}
        />
      )}
    </div>
  );
}
