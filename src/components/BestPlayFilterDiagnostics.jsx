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
        Strict qualified: {filterDiagnostics?.bestPlayQualifiedStrict ?? 0}
        {filterDiagnostics?.bestPlayUsedFallback ? " · Fallback fill active" : ""}
      </p>
      <div className="verification-diagnostics__grid">
        <Metric label="Total Projected" value={audit.totalProjected} />
        <Metric label="Full Data" value={audit.fullData} />
        <Metric label="Partial Data" value={audit.partialData} />
        <Metric label="Tier A" value={audit.tierA ?? audit.tierAFullData} />
        <Metric label="Tier B" value={audit.tierB ?? audit.tierBFullData} />
        <Metric label="Tier C" value={audit.tierC ?? audit.tierCFullData} />
        <Metric label="Rejected By Confidence" value={audit.rejectedByConfidence} />
        <Metric label="Rejected By Probability" value={audit.rejectedByProbability} />
        <Metric label="Rejected By Playability" value={audit.rejectedByPlayability} />
        <Metric label="Rejected By Tier C" value={audit.rejectedByTierC} />
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
                <th>Data</th>
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
                  <td>{row.fullDataReason || "—"}</td>
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
