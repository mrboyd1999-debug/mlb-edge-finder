import { memo } from "react";
import { healthStateStyle } from "../services/sourceHealth.js";

function ProviderFeedModeBanner({ audit = null, loading = false }) {
  if (!audit && !loading) return null;

  const mode = audit?.feedMode === "LIVE" ? "LIVE" : "CACHE";
  const isLive = mode === "LIVE";
  const label = isLive ? "LIVE MODE" : "CACHE MODE";
  const detail = isLive
    ? "Provider feeds refreshed live on last load."
    : `Running from cache — PP usable ${audit?.prizepicksUsable ?? 0} · UD usable ${audit?.underdogUsable ?? 0} · cache ${audit?.cacheUsable ?? 0}`;

  return (
    <section className="provider-feed-mode-banner" aria-label="Provider feed mode">
      <div className="provider-feed-mode-banner__head">
        <strong>{loading ? "Loading feeds…" : label}</strong>
        {!loading ? (
          <span style={healthStateStyle(isLive ? "Connected" : "Warning")}>{isLive ? "Live" : "Cached"}</span>
        ) : null}
      </div>
      {!loading ? <p className="provider-feed-mode-banner__detail">{detail}</p> : null}
    </section>
  );
}

export default memo(ProviderFeedModeBanner);
