import { memo } from "react";
import {
  PROJECTION_MISMATCH_FLAG,
  PROJECTION_OUTLIER_WARNING,
  TIER_A_MIN_SANITY_SCORE,
} from "../utils/projectionSanityAudit.js";

function SideBySideCell({ label, value, highlight = false }) {
  return (
    <div className={`projection-sanity-audit__cell${highlight ? " projection-sanity-audit__cell--highlight" : ""}`}>
      <span className="projection-sanity-audit__cell-label">{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function ProjectionSanityAuditPanel({ audit = null, compact = false }) {
  if (!audit?.supported) return null;

  return (
    <div className={`projection-sanity-audit${compact ? " projection-sanity-audit--compact" : ""}`}>
      <div className="projection-sanity-audit__head">
        <strong>Projection sanity audit</strong>
        {audit.outlierWarning ? (
          <span className="projection-sanity-audit__flag">{audit.outlierWarning}</span>
        ) : null}
        {audit.projectionMismatch ? (
          <span className="projection-sanity-audit__flag projection-sanity-audit__flag--mismatch">
            {PROJECTION_MISMATCH_FLAG}
          </span>
        ) : null}
        {audit.sanityScore != null ? (
          <span className="projection-sanity-audit__score">Sanity {audit.sanityScore}/100</span>
        ) : null}
      </div>

      <div className="projection-sanity-audit__compare" aria-label="Historical averages vs projection">
        <SideBySideCell label="Last 5 Avg" value={audit.last5Label} />
        <SideBySideCell label="Last 10 Avg" value={audit.last10Label} />
        <SideBySideCell label="Season Avg" value={audit.seasonLabel} />
        <SideBySideCell label="Projection" value={audit.projectionLabel} highlight />
      </div>

      <div className="projection-sanity-audit__rates">
        <span>Recent over rate: <strong>{audit.recentOverRateLabel}</strong></span>
        <span>Season over rate: <strong>{audit.seasonOverRateLabel}</strong></span>
        <span>Projection probability: <strong>{audit.projectionProbabilityLabel}</strong></span>
      </div>

      {!compact ? (
        <div className="projection-sanity-audit__weights">
          <span>Source weight {audit.projectionSourceWeight ?? "—"}</span>
          <span>Recent {audit.recentFormPct ?? "—"}%</span>
          <span>Season {audit.seasonPct ?? "—"}%</span>
          <span>Opponent {audit.opponentPct ?? "—"}%</span>
          <span>Matchup {audit.matchupPct ?? "—"}%</span>
        </div>
      ) : null}

      {audit.summary ? <p className="projection-sanity-audit__summary">{audit.summary}</p> : null}
      {audit.sanityScore != null && audit.sanityScore < TIER_A_MIN_SANITY_SCORE ? (
        <p className="projection-sanity-audit__penalty">
          Tier A blocked — sanity score must be ≥{TIER_A_MIN_SANITY_SCORE}.
        </p>
      ) : null}
      {audit.confidencePenalty > 0 || audit.playabilityPenalty > 0 ? (
        <p className="projection-sanity-audit__penalty">
          Confidence −{audit.confidencePenalty || 0} · Playability −{audit.playabilityPenalty || 0}
          {audit.recentOverRateGap != null ? ` · Recent gap ${audit.recentOverRateGap} pts` : ""}
        </p>
      ) : null}
    </div>
  );
}

export default memo(ProjectionSanityAuditPanel);
