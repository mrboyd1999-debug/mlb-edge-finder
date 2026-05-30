import { memo, useEffect } from "react";
import { AUDIT_LABELS } from "../utils/verificationDashboard.js";

function Metric({ label, value }) {
  return (
    <div className="verification-diagnostics__metric">
      <span className="verification-diagnostics__metric-label">{label}</span>
      <span className="verification-diagnostics__metric-value">{value ?? 0}</span>
    </div>
  );
}

function formatCell(value, suffix = "") {
  if (value == null || value === "") return "N/A";
  if (typeof value === "number" && !Number.isFinite(value)) return "N/A";
  if (value === "N/A") return "N/A";
  return `${value}${suffix}`;
}

function DiagnosticTable({
  rows = [],
  emptyMessage = "None",
  showFailureReason = false,
  showMatchup = false,
  showPropDetails = false,
}) {
  const safeRows = Array.isArray(rows) ? rows : [];

  if (!safeRows.length) {
    return <p className="verification-diagnostics__empty">{emptyMessage}</p>;
  }

  return (
    <div className="verification-diagnostics__table-wrap">
      <table className="verification-diagnostics__table">
        <thead>
          <tr>
            <th>Player</th>
            {showPropDetails ? (
              <>
                <th>Prop Type</th>
                <th>Line</th>
                <th>Projection</th>
                <th>Edge</th>
              </>
            ) : null}
            <th>Probability</th>
            {showPropDetails ? <th>Cal Prob</th> : null}
            {showPropDetails ? (
              <>
                <th>L5</th>
                <th>L10</th>
                <th>Season</th>
                <th>Edge In</th>
                <th>Matchup</th>
              </>
            ) : null}
            <th>Confidence</th>
            <th>Playability</th>
            <th>Score</th>
            {showPropDetails ? <th>Cap</th> : null}
            {showMatchup ? (
              <>
                <th>Team</th>
                <th>Opponent</th>
                <th>Pitcher</th>
                <th>Venue</th>
                <th>Matchup</th>
              </>
            ) : null}
            {showFailureReason ? <th>Failure Reason</th> : null}
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row, index) => (
            <tr key={`${row?.player || "row"}-${index}`}>
              <td>{formatCell(row?.player)}</td>
              {showPropDetails ? (
                <>
                  <td>{formatCell(row?.propType)}</td>
                  <td>{formatCell(row?.line)}</td>
                  <td>{formatCell(row?.projection)}</td>
                  <td>{formatCell(row?.edge)}</td>
                </>
              ) : null}
              <td>{formatCell(row?.probability, "%")}</td>
              {showPropDetails ? <td>{formatCell(row?.probabilityRaw, "%")}</td> : null}
              {showPropDetails ? (
                <>
                  <td>{formatCell(row?.last5HitRate)}</td>
                  <td>{formatCell(row?.last10HitRate)}</td>
                  <td>{formatCell(row?.seasonHitRate)}</td>
                  <td>{formatCell(row?.edgeInput)}</td>
                  <td>{formatCell(row?.matchupInput)}</td>
                </>
              ) : null}
              <td>{formatCell(row?.confidence, "%")}</td>
              <td>{formatCell(row?.playability)}</td>
              <td>{formatCell(row?.score)}</td>
              {showPropDetails ? <td>{formatCell(row?.capFlag)}</td> : null}
              {showMatchup ? (
                <>
                  <td>{formatCell(row?.team)}</td>
                  <td>{formatCell(row?.opponent)}</td>
                  <td>{formatCell(row?.pitcher)}</td>
                  <td>{formatCell(row?.venue)}</td>
                  <td>{formatCell(row?.matchupScore)}</td>
                </>
              ) : null}
              {showFailureReason ? <td>{formatCell(row?.failureReason)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributionSummary({ title, summary = {}, histogram = [] }) {
  const formatPct = (value) =>
    value == null || !Number.isFinite(Number(value)) ? "N/A" : `${value}%`;

  return (
    <div className="verification-diagnostics__distribution-block">
      <h5 className="verification-diagnostics__distribution-title">{title}</h5>
      <div className="verification-diagnostics__grid verification-diagnostics__grid--compact">
        <Metric label="Minimum Probability" value={formatPct(summary.min)} />
        <Metric label="Maximum Probability" value={formatPct(summary.max)} />
        <Metric label="Average Probability" value={formatPct(summary.average)} />
        <Metric label="Spread (Max − Min)" value={formatPct(summary.spread)} />
      </div>
      <div className="verification-diagnostics__histogram">
        {histogram.map((bucket) => (
          <div key={bucket.id} className="verification-diagnostics__histogram-row">
            <span className="verification-diagnostics__histogram-label">{bucket.label}</span>
            <span className="verification-diagnostics__histogram-count">{bucket.count ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalibrationInputsSummary({ title, summary = {} }) {
  if (!summary?.count) return null;
  const format = (value) => (value == null || value === "—" ? "—" : `${value} pts`);

  return (
    <div className="verification-diagnostics__distribution-block">
      <h5 className="verification-diagnostics__distribution-title">{title}</h5>
      <div className="verification-diagnostics__grid verification-diagnostics__grid--compact">
        <Metric label="Avg L5 contribution" value={format(summary.last5HitRate)} />
        <Metric label="Avg L10 contribution" value={format(summary.last10HitRate)} />
        <Metric label="Avg Season contribution" value={format(summary.seasonHitRate)} />
        <Metric label="Avg Edge contribution" value={format(summary.edgeContribution)} />
        <Metric label="Avg Matchup adj." value={format(summary.matchupAdjustment)} />
      </div>
    </div>
  );
}

function VerificationDashboard({ dashboard = null }) {
  const topProjectedProps = Array.isArray(dashboard?.topProjectedProps)
    ? dashboard.topProjectedProps
    : Array.isArray(dashboard?.topBeforeVerification)
      ? dashboard.topBeforeVerification
      : [];

  useEffect(() => {
    if (!dashboard) return;
    console.info("[MLB Pipeline] verification dashboard render", {
      topProjectedPropsLength: topProjectedProps.length,
      projectedCount: dashboard.projectedCount ?? dashboard.projected ?? 0,
      firstRow: topProjectedProps[0] || null,
    });
  }, [dashboard, topProjectedProps]);

  if (!dashboard) return null;

  const {
    projectedCount = 0,
    projected = projectedCount,
    verifiedCount = 0,
    verifiedPasses = 0,
    passedProbability = 0,
    failedProbability = 0,
    passedConfidence = 0,
    failedConfidence = 0,
    passedDataQuality = 0,
    failedDataQuality = 0,
    passedMatchup = 0,
    failedMatchup = 0,
    tierA = 0,
    tierB = 0,
    tierC = 0,
    topAfterVerification = [],
    ruleRejectionCounts = {},
    failureBreakdown = {},
    regressionReasons = {},
    usedVerifiedFallback = false,
    probabilityDistribution = null,
  } = dashboard;

  const showRejections = verifiedPasses === 0;
  const rejectionRows = Object.entries(ruleRejectionCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => b[1] - a[1]);

  const regressionRows = showRejections
    ? Object.entries(regressionReasons || {})
        .filter(([, count]) => Number(count) > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    : [];

  const compression = probabilityDistribution?.compressionAudit || null;

  return (
    <section className="verification-diagnostics" aria-label="Verification diagnostics">
      <h3 className="verification-diagnostics__title">Verification Diagnostics</h3>

      <div className="verification-diagnostics__grid">
        <Metric label="Projected Count" value={projectedCount || projected} />
        <Metric label="Passed Probability" value={passedProbability} />
        <Metric label="Failed Probability" value={failedProbability} />
        <Metric label="Passed Confidence" value={passedConfidence} />
        <Metric label="Failed Confidence" value={failedConfidence} />
        <Metric label="Passed Data Quality" value={passedDataQuality} />
        <Metric label="Failed Data Quality" value={failedDataQuality} />
        <Metric label="Passed Matchup" value={passedMatchup} />
        <Metric label="Failed Matchup" value={failedMatchup} />
        <Metric label="Tier A Count" value={tierA} />
        <Metric label="Tier B Count" value={tierB} />
        <Metric label="Tier C Count" value={tierC} />
      </div>

      {showRejections ? (
        <div className="verification-diagnostics__rejections">
          <h4 className="verification-diagnostics__subtitle">
            Rejection counts by rule (verified passes = 0)
          </h4>
          {rejectionRows.length ? (
            <ul className="verification-diagnostics__rejection-list">
              {rejectionRows.map(([label, count]) => (
                <li key={label}>
                  {label}: {count}
                </li>
              ))}
            </ul>
          ) : (
            <p className="verification-diagnostics__empty">No rule rejections recorded.</p>
          )}
          {Object.entries(failureBreakdown || {})
            .filter(([, count]) => Number(count) > 0)
            .length ? (
            <p className="verification-diagnostics__meta">
              Audit breakdown:{" "}
              {Object.entries(failureBreakdown)
                .filter(([, count]) => Number(count) > 0)
                .map(([key, count]) => `${AUDIT_LABELS[key] || key}: ${count}`)
                .join(" · ")}
            </p>
          ) : null}
          {regressionRows.length ? (
            <>
              <h4 className="verification-diagnostics__subtitle">Exact rejection reasons</h4>
              <ul className="verification-diagnostics__rejection-list">
                {regressionRows.map(([reason, count]) => (
                  <li key={reason}>
                    {reason}: {count}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {usedVerifiedFallback ? (
        <p className="verification-diagnostics__meta">
          Verified tier pool was empty — top projected props promoted by score.
        </p>
      ) : null}

      <h4 className="verification-diagnostics__subtitle">Probability Calibration</h4>
      {probabilityDistribution ? (
        <>
          <DistributionSummary
            title="Probability Histogram — all projected props"
            summary={probabilityDistribution.projected}
            histogram={probabilityDistribution.projected?.histogram}
          />
          <CalibrationInputsSummary
            title="Average calibration inputs (projected pool)"
            summary={probabilityDistribution.calibrationInputs}
          />
          <DistributionSummary
            title="Probability Histogram — top 20 projected props"
            summary={probabilityDistribution.top20}
            histogram={probabilityDistribution.top20?.histogram}
          />
          <CalibrationInputsSummary
            title="Average calibration inputs (top 20)"
            summary={probabilityDistribution.top20CalibrationInputs}
          />
          {compression ? (
            <div className="verification-diagnostics__compression">
              <p className="verification-diagnostics__meta">
                Compression check: {compression.exact70Count ?? 0} at exactly 70% ·{" "}
                {compression.band68to70Count ?? 0} in 68–70% band ·{" "}
                {compression.uniqueDisplayedValues ?? 0} unique displayed values ·{" "}
                {compression.researchCapHits ?? 0} research-cap hits
              </p>
              {compression.statSpecificHigherCount > 0 ? (
                <p className="verification-diagnostics__meta">
                  {compression.statSpecificHigherCount} props have stat-specific probability above
                  displayed value (cap or confidence ceiling likely applied).
                </p>
              ) : null}
              {Array.isArray(compression.notes) && compression.notes.length ? (
                <ul className="verification-diagnostics__rejection-list">
                  {compression.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="verification-diagnostics__empty">Distribution audit unavailable.</p>
      )}

      <h4 className="verification-diagnostics__subtitle">Top 20 projected props</h4>
      <p className="verification-diagnostics__meta">Rows Loaded: {topProjectedProps.length}</p>
      <DiagnosticTable
        rows={topProjectedProps}
        emptyMessage="No projected props."
        showFailureReason
        showMatchup
        showPropDetails
      />

      <h4 className="verification-diagnostics__subtitle">Top 10 props after verification</h4>
      <p className="verification-diagnostics__meta">
        Rows Loaded: {Array.isArray(topAfterVerification) ? topAfterVerification.length : 0}
      </p>
      <DiagnosticTable rows={topAfterVerification} emptyMessage="No verified props on board." />
    </section>
  );
}

export default memo(VerificationDashboard);
