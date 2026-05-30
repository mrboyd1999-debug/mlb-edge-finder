import { memo } from "react";
import { VERIFICATION_FAILURE_GATE_LABELS } from "../utils/verificationDashboard.js";

function Metric({ label, value, highlight = false }) {
  return (
    <div
      className={`verification-diagnostics__metric${
        highlight ? " verification-diagnostics__metric--bottleneck" : ""
      }`}
    >
      <span className="verification-diagnostics__metric-label">{label}</span>
      <span className="verification-diagnostics__metric-value">{value ?? 0}</span>
    </div>
  );
}

function formatMetric(value, suffix = "") {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  return `${value}${suffix}`;
}

function VerificationFailureBreakdown({ filterDiagnostics = null }) {
  const breakdown = filterDiagnostics?.verificationDashboard?.verificationFailureBreakdown;
  const pipelineCounts = filterDiagnostics?.pipelineCounts || null;

  const totalProps = breakdown?.totalProps ?? pipelineCounts?.rawProps ?? 0;
  const propsWithProjections =
    breakdown?.propsWithProjections ?? pipelineCounts?.withProjections ?? breakdown?.projected ?? 0;
  const verifiedPlays = breakdown?.verifiedPlays ?? filterDiagnostics?.verifiedPicksCount ?? 0;
  const verifiedTierCount = breakdown?.verifiedTierCount ?? breakdown?.passedTierGate ?? 0;
  const failedProbability = breakdown?.failedProbability ?? 0;
  const failedConfidence = breakdown?.failedConfidence ?? 0;
  const failedPlayability = breakdown?.failedPlayability ?? 0;
  const failedSanity = breakdown?.failedSanity ?? 0;
  const failedHistoricalData = breakdown?.failedHistoricalData ?? 0;
  const failedTierGate = breakdown?.failedTierGate ?? 0;
  const bottleneckLabel = breakdown?.primaryBottleneck;
  const rejected = breakdown?.highestScoringRejectedProp;

  const summaryRows = [
    { key: "totalProps", label: VERIFICATION_FAILURE_GATE_LABELS.totalProps, value: totalProps },
    {
      key: "propsWithProjections",
      label: VERIFICATION_FAILURE_GATE_LABELS.propsWithProjections,
      value: propsWithProjections,
    },
    { key: "verifiedPlays", label: VERIFICATION_FAILURE_GATE_LABELS.verifiedPlays, value: verifiedPlays },
    {
      key: "failedProbability",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedProbability,
      value: failedProbability,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedProbability,
    },
    {
      key: "failedConfidence",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedConfidence,
      value: failedConfidence,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedConfidence,
    },
    {
      key: "failedPlayability",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedPlayability,
      value: failedPlayability,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedPlayability,
    },
    {
      key: "failedSanity",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedSanity,
      value: failedSanity,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedSanity,
    },
    {
      key: "failedHistoricalData",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedHistoricalData,
      value: failedHistoricalData,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedHistoricalData,
    },
    {
      key: "failedTierGate",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedTierGate,
      value: failedTierGate,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedTierGate,
    },
  ];

  const showTierHiddenNote =
    verifiedTierCount > verifiedPlays && breakdown?.blockedByDisplayRankingGate > 0;

  return (
    <section className="verification-diagnostics verification-failure-breakdown" aria-label="Verification failure breakdown">
      <h3 className="verification-diagnostics__title">Verification Failure Breakdown</h3>
      <p className="verification-diagnostics__meta">
        Sequential gate audit — each projected prop is counted at the first gate it fails.
      </p>

      <div className="verification-diagnostics__grid">
        {summaryRows.map(({ key, label, value, highlight }) => (
          <Metric key={key} label={label} value={value} highlight={highlight} />
        ))}
      </div>

      {verifiedPlays === 0 && propsWithProjections > 0 && bottleneckLabel ? (
        <p className="verification-diagnostics__meta">
          Largest drop-off: <strong>{bottleneckLabel}</strong> ({breakdown?.primaryBottleneckCount ?? 0} props).
        </p>
      ) : null}

      {showTierHiddenNote ? (
        <p className="verification-diagnostics__meta">
          {verifiedTierCount} props passed tier gates; {breakdown.blockedByDisplayRankingGate} hidden by display
          ranking filters (not shown in Verified Plays list).
        </p>
      ) : null}

      <div className="verification-failure-breakdown__rejected">
        <h4 className="verification-diagnostics__subtitle">Highest Scoring Rejected Prop</h4>
        {rejected ? (
          <div className="verification-diagnostics__table-wrap">
            <table className="verification-diagnostics__table verification-failure-breakdown__table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Market</th>
                  <th>Probability</th>
                  <th>Confidence</th>
                  <th>Playability</th>
                  <th>Sanity</th>
                  <th>Reason Rejected</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{rejected.player}</td>
                  <td>{rejected.market}</td>
                  <td>{formatMetric(rejected.probability, "%")}</td>
                  <td>{formatMetric(rejected.confidence, "%")}</td>
                  <td>{formatMetric(rejected.playability)}</td>
                  <td>{formatMetric(rejected.sanity)}</td>
                  <td>{rejected.reasonRejected || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="verification-diagnostics__empty">No rejected projected props to rank yet.</p>
        )}
      </div>
    </section>
  );
}

export default memo(VerificationFailureBreakdown);
