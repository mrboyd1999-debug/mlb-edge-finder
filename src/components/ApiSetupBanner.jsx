import { memo } from "react";
import { getOddsApiKey, getSportsDataApiKey } from "../services/runtimeSettings.js";
import { isOddsApiKeyUsable, ODDS_API_INVALID_KEY_MESSAGE } from "../services/oddsApiClient.js";
import { isSourceAuthBlocked, SOURCE_IDS } from "../services/sourceRateLimit.js";

function ApiSetupBanner({ onOpenSettings }) {
  const oddsKey = getOddsApiKey();
  const sportsDataKey = getSportsDataApiKey();
  const oddsBlocked = Boolean(oddsKey) && (!isOddsApiKeyUsable() || isSourceAuthBlocked(SOURCE_IDS.ODDS_API));
  const missingSportsData = !sportsDataKey;

  if (!oddsBlocked && !missingSportsData) return null;

  return (
    <div
      role="status"
      className="api-setup-banner"
      style={{
        margin: "10px 0 0",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(250, 204, 21, 0.45)",
        background: "rgba(120, 53, 15, 0.35)",
        color: "#fde68a",
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Quick setup</div>
      {missingSportsData ? (
        <p style={{ margin: "0 0 6px" }}>
          Add your <strong>SportsDataIO MLB key</strong> in Settings for verified season projections. PrizePicks and
          Underdog lines still load; picks are only graded when real stats are available.
        </p>
      ) : null}
      {oddsBlocked ? (
        <p style={{ margin: missingSportsData ? "0 0 6px" : 0 }}>
          {ODDS_API_INVALID_KEY_MESSAGE} Update or remove the Odds API key in Settings. Core MLB picks use PrizePicks +
          Underdog + MLB Stats API.
        </p>
      ) : null}
      {typeof onOpenSettings === "function" ? (
        <button
          type="button"
          onClick={onOpenSettings}
          style={{
            marginTop: 8,
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid rgba(253, 224, 71, 0.5)",
            background: "rgba(234, 179, 8, 0.15)",
            color: "#fef9c3",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Open Settings
        </button>
      ) : null}
    </div>
  );
}

export default memo(ApiSetupBanner);
