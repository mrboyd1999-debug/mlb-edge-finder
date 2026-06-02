import { memo, useState } from "react";
import { teamLogoUrl } from "../utils/mlbTeamLogos.js";

function TeamLogo({ team = "", size = 18 }) {
  const url = teamLogoUrl(team);
  const [failed, setFailed] = useState(!url);

  if (failed || !url) return null;

  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      className="team-logo"
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        flexShrink: 0,
      }}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default memo(TeamLogo);
