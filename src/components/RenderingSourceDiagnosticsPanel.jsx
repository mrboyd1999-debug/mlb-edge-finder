import { memo } from "react";
import { formatDataSourceLabel } from "../utils/renderDataSourceAudit.js";

function MetricRow({ label, value }) {
  return (
    <div className="rendering-source-diagnostics__row">
      <span className="rendering-source-diagnostics__label">{label}</span>
      <span className="rendering-source-diagnostics__value">{value ?? "—"}</span>
    </div>
  );
}

function RenderingSourceDiagnosticsPanel({ audit = null }) {
  if (!audit) return null;

  const heroDetail =
    audit.heroPlayPlayer && audit.heroPlaySource
      ? `${audit.heroPlayPlayer} ← ${formatDataSourceLabel(audit.heroPlaySource)}`
      : "—";

  return (
    <section className="rendering-source-diagnostics" aria-label="Rendering source diagnostics">
      <div className="rendering-source-diagnostics__head">
        <strong>Rendering Source</strong>
      </div>
      <div className="rendering-source-diagnostics__grid">
        <MetricRow label="Rendering Source" value={formatDataSourceLabel(audit.renderingSource)} />
        <MetricRow label="Rendered Plays" value={audit.renderedPlays} />
        <MetricRow label="Verified Plays (rendered)" value={audit.verifiedPlaysCount ?? audit.verified} />
        <MetricRow label="Provider Plays (live)" value={audit.providerPlays} />
        <MetricRow label="Cache Plays" value={audit.cachePlays} />
        <MetricRow label="Local Storage Plays" value={audit.localStoragePlays} />
        <MetricRow label="Mock Plays" value={audit.mockPlays} />
        <MetricRow label="Fallback Plays" value={audit.fallbackPlays} />
        <MetricRow label="#1 Overall Play source" value={heroDetail} />
      </div>
      {audit.dataIntegrityMismatch && audit.integrityWarning ? (
        <p className="rendering-source-diagnostics__warn" role="alert">
          {audit.integrityWarning}
        </p>
      ) : null}
    </section>
  );
}

export default memo(RenderingSourceDiagnosticsPanel);
