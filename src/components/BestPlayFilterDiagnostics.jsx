import { memo } from "react";
import { safeArray } from "../utils/safeStats.js";

function Metric({ label, value }) {
  return (
    <div className="verification-diagnostics__metric">
      <span className="verification-diagnostics__metric-label">{label}</span>
      <span className="verification-diagnostics__metric-value">{value ?? 0}</span>
    </div>
  );
}

function BestPlayFilterDiagnostics({ filterDiagnostics = null }) {
  const audit = filterDiagnostics?.bestPlayFilterAudit;
  const samples = safeArray(filterDiagnostics?.bestPlayRejectionSamples);

  if (!audit) return null;

  return (
    <section className="verification-diagnostics best-play-filter-diagnostics" aria-label="Best Plays filter diagnostics">
      <h3 className="verification-diagnostics__title">Best Plays Filter Diagnostics</h3>
      <p className="verification-diagnostics__meta">
        Active board tier: {audit.activeTier || "A"}
        {filterDiagnostics?.bestPlayUsedFallback ? " · Fallback fill active" : ""}
      </p>
      <div className="verification-diagnostics__grid">
        <Metric label="Total Projected" value={audit.totalProjected} />
        <Metric label="Tier A (pool)" value={audit.tierA ?? audit.tierAFullData} />
        <Metric label="Tier B (pool)" value={audit.tierB ?? audit.tierBFullData} />
        <Metric label="Tier C (pool)" value={audit.tierC ?? audit.tierCFullData} />
        <Metric label="Tier A (shown)" value={audit.tierADisplayed} />
        <Metric label="Tier B (shown)" value={audit.tierBDisplayed} />
        <Metric label="Tier C (shown)" value={audit.tierCDisplayed} />
        <Metric label="Qualified A/B" value={filterDiagnostics?.bestPlayQualifiedStrict ?? audit.qualifiedStrict} />
      </div>
      {samples.length ? (
        <div className="verification-diagnostics__table-wrap">
          <table className="verification-diagnostics__table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Market</th>
                <th>Conf</th>
                <th>Play</th>
                <th>Edge</th>
                <th>L10</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((row, index) => (
                <tr key={`${row.player}-${row.market}-${index}`}>
                  <td>{row.player}</td>
                  <td>{row.market}</td>
                  <td>{row.confidence ?? "—"}%</td>
                  <td>{row.playability ?? "—"}</td>
                  <td>{row.edge ?? "—"}</td>
                  <td>{row.last10HitRate ?? "—"}%</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default memo(BestPlayFilterDiagnostics);
