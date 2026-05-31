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

function BestPlayBoardDiagnosticsSummary({ boardDiagnostics = null }) {
  if (!boardDiagnostics) return null;
  const reasons = safeArray(boardDiagnostics.topRejectionReasons);

  return (
    <section className="verification-diagnostics best-play-board-diagnostics" aria-label="Best Plays board diagnostics">
      <h3 className="verification-diagnostics__title">Best Play Diagnostics</h3>
      <div className="verification-diagnostics__grid">
        <Metric label="Props Evaluated" value={boardDiagnostics.propsEvaluated} />
        <Metric label="Props Rejected" value={boardDiagnostics.propsRejected} />
        <Metric label="Props Shown" value={boardDiagnostics.propsShown} />
        <Metric label="HRR Shown" value={`${boardDiagnostics.hrrShown ?? 0}/${boardDiagnostics.hrrCap ?? 2}`} />
      </div>
      {reasons.length ? (
        <div style={{ marginTop: 10 }}>
          <h4 className="verification-diagnostics__subtitle">Top Rejection Reasons</h4>
          <p className="verification-diagnostics__meta">
            {boardDiagnostics.propsRejected} rejected:
          </p>
          <ul className="verification-diagnostics__reason-list" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {reasons.slice(0, 6).map(({ reason, count }) => (
              <li key={reason}>
                {count} · {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function BestPlayFilterDiagnostics({ filterDiagnostics = null, showExtended = false }) {
  const audit = filterDiagnostics?.bestPlayFilterAudit;
  const boardDiagnostics = filterDiagnostics?.boardDiagnostics ?? audit?.boardDiagnostics;
  const samples = safeArray(filterDiagnostics?.bestPlayRejectionSamples);
  const top10 = safeArray(filterDiagnostics?.top10ByScore ?? audit?.top10ByScore);

  if (!audit && !boardDiagnostics) return null;

  return (
    <>
      <BestPlayBoardDiagnosticsSummary boardDiagnostics={boardDiagnostics} />
      {showExtended && audit ? (
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
          {top10.length ? (
            <div className="verification-diagnostics__table-wrap">
              <h4 className="verification-diagnostics__subtitle">Top 10 by score</h4>
              <table className="verification-diagnostics__table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Conf</th>
                    <th>Prob</th>
                    <th>Play</th>
                    <th>Tier</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((row, index) => (
                    <tr key={`${row.player}-${row.market}-${index}`}>
                      <td>{row.player}</td>
                      <td>{row.confidence ?? "—"}%</td>
                      <td>{row.probability ?? "—"}%</td>
                      <td>{row.playability ?? "—"}</td>
                      <td>{row.tier ?? "—"}</td>
                      <td>{row.reason ?? row.tierReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {samples.length ? (
            <div className="verification-diagnostics__table-wrap">
              <h4 className="verification-diagnostics__subtitle">Tier C rejections (sample)</h4>
              <table className="verification-diagnostics__table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Market</th>
                    <th>Conf</th>
                    <th>Prob</th>
                    <th>Play</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((row, index) => (
                    <tr key={`${row.player}-${row.market}-${index}`}>
                      <td>{row.player}</td>
                      <td>{row.market}</td>
                      <td>{row.confidence ?? "—"}%</td>
                      <td>{row.probability ?? "—"}%</td>
                      <td>{row.playability ?? "—"}</td>
                      <td>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

export default memo(BestPlayFilterDiagnostics);
