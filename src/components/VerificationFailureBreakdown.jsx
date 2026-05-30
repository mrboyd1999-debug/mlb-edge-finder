import { memo } from "react";
import { VERIFICATION_FAILURE_GATE_LABELS } from "../utils/verificationDashboard.js";
import { safeArray } from "../utils/safeStats.js";

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

function AuditTable({ title, rows = [], columns = [], emptyMessage = "None", scrollable = false }) {
  const safeRows = safeArray(rows);
  if (!safeRows.length) {
    return (
      <div className="verification-failure-breakdown__section">
        <h4 className="verification-diagnostics__subtitle">{title}</h4>
        <p className="verification-diagnostics__empty">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="verification-failure-breakdown__section">
      <h4 className="verification-diagnostics__subtitle">{title}</h4>
      <div
        className={`verification-diagnostics__table-wrap${
          scrollable ? " verification-failure-breakdown__table-scroll" : ""
        }`}
      >
        <table className="verification-diagnostics__table verification-failure-breakdown__table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, index) => (
              <tr key={`${row?.player || "row"}-${row?.market || "market"}-${index}`}>
                {columns.map((column) => (
                  <td key={column.key}>
                    {column.render ? column.render(row) : formatMetric(row?.[column.key], column.suffix || "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PLAYABILITY_AUDIT_COLUMNS = [
  { key: "player", label: "Player" },
  { key: "market", label: "Market" },
  { key: "probability", label: "Probability", suffix: "%" },
  { key: "confidence", label: "Confidence", suffix: "%" },
  { key: "historicalComponent", label: "Historical" },
  { key: "trendComponent", label: "Trend" },
  { key: "projectionComponent", label: "Projection" },
  { key: "penaltyComponent", label: "Penalty" },
  { key: "finalPlayability", label: "Final Playability" },
  { key: "reasonRejected", label: "Reason Rejected" },
];

const TOP_SCORE_COLUMNS = [
  { key: "player", label: "Player" },
  { key: "market", label: "Market" },
  { key: "probability", label: "Probability", suffix: "%" },
  { key: "confidence", label: "Confidence", suffix: "%" },
  { key: "finalPlayability", label: "Playability" },
  {
    key: "reasonRejected",
    label: "Verification",
    render: (row) => row.reasonRejected || "Fails gate",
  },
];

function VerificationFailureBreakdown({ filterDiagnostics = null }) {
  const dashboard = filterDiagnostics?.verificationDashboard || null;
  const breakdown = dashboard?.verificationFailureBreakdown;
  const pipelineCounts = filterDiagnostics?.pipelineCounts || null;
  const rejectedAudits = safeArray(dashboard?.rejectedPlayabilityAudits);
  const topConfidenceProps = safeArray(dashboard?.topConfidenceProps);
  const topPlayabilityProps = safeArray(dashboard?.topPlayabilityProps);

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
  const rejected = breakdown?.highestScoringRejectedProp || rejectedAudits[0] || null;

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
        Sequential gate audit — each projected prop is counted at the first gate it fails. Full rejected-prop
        playability audits are logged to the browser console as <code>[PlayabilityAudit]</code>.
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

      <AuditTable
        title="Highest Scoring Rejected Prop"
        rows={rejected ? [rejected] : []}
        columns={[
          { key: "player", label: "Player" },
          { key: "market", label: "Market" },
          { key: "probability", label: "Probability", suffix: "%" },
          { key: "confidence", label: "Confidence", suffix: "%" },
          { key: "historicalComponent", label: "Historical Component" },
          { key: "trendComponent", label: "Trend Component" },
          { key: "projectionComponent", label: "Projection Component" },
          { key: "penaltyComponent", label: "Penalty Component" },
          { key: "finalPlayability", label: "Final Playability" },
          { key: "reasonRejected", label: "Reason Rejected" },
        ]}
        emptyMessage="No rejected projected props to rank yet."
      />

      <AuditTable
        title="Top 10 Highest Confidence Props (includes non-verified)"
        rows={topConfidenceProps}
        columns={TOP_SCORE_COLUMNS}
        emptyMessage="No projected props with confidence scores yet."
      />

      <AuditTable
        title="Top 10 Highest Playability Props (includes non-verified)"
        rows={topPlayabilityProps}
        columns={TOP_SCORE_COLUMNS}
        emptyMessage="No projected props with playability scores yet."
      />

      <AuditTable
        title={`Rejected Prop Playability Audit (${rejectedAudits.length})`}
        rows={rejectedAudits}
        columns={PLAYABILITY_AUDIT_COLUMNS}
        emptyMessage="No rejected projected props."
        scrollable
      />
    </section>
  );
}

export default memo(VerificationFailureBreakdown);
