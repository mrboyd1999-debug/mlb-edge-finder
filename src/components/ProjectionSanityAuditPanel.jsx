import { memo } from "react";
import { PROJECTION_OUTLIER_FLAG } from "../utils/projectionSanityAudit.js";

function Metric({ label, value, strong = false }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <span className="projection-sanity-audit__metric">
      {label}: <strong>{value}</strong>
    </span>
  );
}

function ProjectionSanityAuditPanel({ audit = null, compact = false }) {
  if (!audit?.supported) return null;

  return (
    <div className={`projection-sanity-audit${compact ? " projection-sanity-audit--compact" : ""}`}>
      <div className="projection-sanity-audit__head">
        <strong>Projection sanity audit</strong>
        {audit.isOutlier ? (
          <span className="projection-sanity-audit__flag">{PROJECTION_OUTLIER_FLAG}</span>
        ) : null}
        {audit.sanityScore != null ? (
          <span className="projection-sanity-audit__score">Sanity {audit.sanityScore}/100</span>
        ) : null}
      </div>

      <div className="projection-sanity-audit__grid">
        <Metric label="Last 5 Avg" value={audit.last5Label} />
        <Metric label="Last 10 Avg" value={audit.last10Label} />
        <Metric label="Season Avg" value={audit.seasonLabel} />
        <Metric label="Projection" value={audit.projectionLabel} strong />
        <Metric label="Line" value={audit.lineLabel} />
      </div>

      <div className="projection-sanity-audit__weights">
        <span>Source weight {audit.projectionSourceWeight ?? "—"}</span>
        <span>Recent {audit.recentFormPct ?? "—"}%</span>
        <span>Season {audit.seasonPct ?? "—"}%</span>
        <span>Opponent {audit.opponentPct ?? "—"}%</span>
        <span>Matchup {audit.matchupPct ?? "—"}%</span>
      </div>

      {audit.summary ? <p className="projection-sanity-audit__summary">{audit.summary}</p> : null}
      {audit.confidencePenalty > 0 ? (
        <p className="projection-sanity-audit__penalty">
          Confidence reduced by {audit.confidencePenalty} pts for statistical drift.
        </p>
      ) : null}
    </div>
  );
}

export default memo(ProjectionSanityAuditPanel);
