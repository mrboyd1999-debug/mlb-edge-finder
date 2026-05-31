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
        Strict qualified: {filterDiagnostics?.bestPlayQualifiedStrict ?? 0} · Projected pool:{" "}
        {filterDiagnostics?.bestPlayProjectedCount ?? 0}
        {filterDiagnostics?.bestPlayUsedFallback ? " · Fallback fill active" : ""}
      </p>
      <div className="verification-diagnostics__grid">
        <Metric label="Tier A Full Data" value={audit.tierAFullData} />
        <Metric label="Tier B Full Data" value={audit.tierBFullData} />
        <Metric label="Tier C Full Data" value={audit.tierCFullData} />
        <Metric label="Partial Data" value={audit.partialData} />
        <Metric label="Rejected By Confidence" value={audit.rejectedByConfidence} />
        <Metric label="Rejected By Probability" value={audit.rejectedByProbability} />
      </div>
      {samples.length ? (
        <div className="verification-diagnostics__table-wrap">
          <table className="verification-diagnostics__table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Market</th>
                <th>Confidence</th>
                <th>Probability</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((row, index) => (
                <tr key={`${row.player}-${row.market}-${index}`}>
                  <td>{row.player}</td>
                  <td>{row.market}</td>
                  <td>{row.confidence}%</td>
                  <td>{row.probability}%</td>
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
