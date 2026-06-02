import { memo, useMemo, useState } from "react";
import { formatNumber } from "../utils/formatters.js";
import { resolveNormalizedConfidence, resolveNormalizedProbability, resolveProviderDisplayLabel, resolveProviderLineFields } from "../utils/propDisplayFields.js";
import { withPlayerImageUrl } from "../utils/playerImageFields.js";
import PlayerImage from "./PlayerImage.jsx";
import { resolveRecommendedSide, resolveTierDisplayLabel } from "../utils/boardQuality.js";
import { resolveProjectionValue } from "../utils/projectionQuality.js";
import { formatEdgeDisplay } from "../utils/conservativeProjection.js";
import { displayFullMarketLabel } from "../utils/propLabels.js";

function normalizeSearch(value = "") {
  return String(value || "").trim().toLowerCase();
}

function formatMatchup(prop = {}) {
  const raw = String(prop.matchup || "").trim();
  if (raw) return raw.replace(/\s+vs\.?\s+/gi, " @ ");
  const team = prop.team || prop.playerTeam || "";
  const opponent = prop.opponent || prop.opponentTeam || "";
  if (team && opponent) return `${team} @ ${opponent}`;
  return team || opponent || "—";
}

function resolveSideLabel(prop = {}) {
  const side = resolveRecommendedSide(prop);
  if (side === "OVER") return "Higher";
  if (side === "UNDER") return "Lower";
  return prop.lean || prop.side || "—";
}

function PlayerLookupPanel({ boardProps = [], loading = false, onOpenProp }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = normalizeSearch(query);
    if (!needle || needle.length < 2) return [];
    const rows = (boardProps || []).filter((prop) => {
      const name = normalizeSearch(prop.playerName || prop.player);
      return name.includes(needle);
    });
    return rows.sort((a, b) => {
      const confA = resolveNormalizedConfidence(a) ?? 0;
      const confB = resolveNormalizedConfidence(b) ?? 0;
      if (confB !== confA) return confB - confA;
      const probA = Number(a.probabilityScore ?? a.verifiedProbability ?? 0);
      const probB = Number(b.probabilityScore ?? b.verifiedProbability ?? 0);
      return probB - probA;
    });
  }, [boardProps, query]);

  const groupedByPlayer = useMemo(() => {
    const map = new Map();
    for (const prop of matches) {
      const key = prop.playerName || prop.player || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(prop);
    }
    return [...map.entries()];
  }, [matches]);

  return (
    <div className="compact-tab-panel player-lookup-panel">
      <div className="compact-section__head">
        <h2>Player Lookup</h2>
        <p>Search current board props by player name.</p>
      </div>

      <label className="compact-form-field player-lookup-search">
        <span className="compact-form-field__label">Search player</span>
        <input
          type="search"
          className="compact-form-field__input"
          placeholder="e.g. Aaron Judge"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={loading}
        />
      </label>

      {loading ? <p className="compact-empty">Loading board props…</p> : null}

      {!loading && normalizeSearch(query).length >= 2 && !matches.length ? (
        <p className="compact-empty">No current props found for this player.</p>
      ) : null}

      {!loading && normalizeSearch(query).length < 2 ? (
        <p className="compact-empty">Enter at least 2 characters to search the live board.</p>
      ) : null}

      {groupedByPlayer.map(([playerName, props]) => {
        const sample = props[0] || {};
        const recentHitRate = formatHitRatePercent(
          sample.last10HitRate ?? sample.recentHitRate ?? sample.hitRateSnapshot?.last10Label ?? null
        );
        return (
          <section key={playerName} className="player-lookup-group compact-section">
            <div className="player-lookup-group__head">
              <h3>{playerName}</h3>
              <p>
                {sample.team || "—"} · {formatMatchup(sample)}
              </p>
              {recentHitRate !== "—" ? <p className="player-lookup-group__meta">Recent hit rate: {recentHitRate}</p> : null}
            </div>
            <div className="player-lookup-results">
              {props.map((prop, index) => {
                const enriched = withPlayerImageUrl(prop);
                const projection = resolveProjectionValue(enriched);
                const edge = formatEdgeDisplay(enriched);
                const probability = resolveNormalizedProbability(enriched);
                const confidence = resolveNormalizedConfidence(enriched);
                const providerLabel = resolveProviderDisplayLabel(enriched);
                const lineFields = resolveProviderLineFields(enriched);
                return (
                  <button
                    key={enriched.id || `${playerName}-${index}`}
                    type="button"
                    className="player-lookup-row"
                    onClick={() => onOpenProp?.(enriched)}
                  >
                    <PlayerImage prop={enriched} />
                    <div className="player-lookup-row__main">
                      <strong>{enriched.statType || enriched.propType || displayFullMarketLabel(enriched)}</strong>
                      <span>
                        Side {resolveSideLabel(enriched)}
                        {lineFields.prizePicksLineLabel ? ` · PrizePicks ${lineFields.prizePicksLineLabel}` : ""}
                        {lineFields.underdogLineLabel ? ` · Underdog ${lineFields.underdogLineLabel}` : ""}
                        {" · Line Used "}
                        {lineFields.activeLineLabel ?? formatNumber(enriched.line)} · Proj{" "}
                        {projection != null ? formatNumber(projection) : "—"}
                      </span>
                    </div>
                    <div className="player-lookup-row__metrics">
                      <span>Edge {edge?.displayEdgeLabel ?? "—"}</span>
                      <span>Prob {Number.isFinite(Number(probability)) ? `${Math.round(Number(probability))}%` : "—"}</span>
                      <span>Conf {Number.isFinite(Number(confidence)) ? `${Math.round(Number(confidence))}%` : "—"}</span>
                      <span>{resolveTierDisplayLabel(enriched)}</span>
                      {providerLabel ? <span>{providerLabel}</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default memo(PlayerLookupPanel);
