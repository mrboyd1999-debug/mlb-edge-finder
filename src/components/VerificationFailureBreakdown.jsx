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

const TOP_VERIFIED_COLUMNS = [
  { key: "rank", label: "#" },
  { key: "player", label: "Player" },
  { key: "market", label: "Market" },
  { key: "rawProjection", label: "Raw Proj" },
  { key: "sportsDataProjection", label: "SDIO Proj" },
  { key: "marketAverage", label: "Mkt Avg" },
  { key: "line", label: "Line" },
  { key: "edge", label: "Edge" },
  {
    key: "probability",
    label: "Probability (raw)",
    render: (row) => formatMetric(row.probability),
  },
  {
    key: "confidence",
    label: "Confidence (raw)",
    render: (row) => formatMetric(row.confidence),
  },
  {
    key: "playability",
    label: "Playability (raw)",
    render: (row) => formatMetric(row.playability),
  },
  {
    key: "probabilityFormulaOutput",
    label: "Prob Formula",
    render: (row) => formatMetric(row.probabilityFormulaOutput),
  },
  {
    key: "confidenceFormulaOutput",
    label: "Conf Formula",
    render: (row) => formatMetric(row.confidenceFormulaOutput),
  },
  {
    key: "playabilityFormulaOutput",
    label: "Play Formula",
    render: (row) => formatMetric(row.playabilityFormulaOutput),
  },
  { key: "compositeScore", label: "Composite" },
  {
    key: "probabilityDisplay",
    label: "Prob UI",
    suffix: "%",
    render: (row) => formatMetric(row.probabilityDisplay, "%"),
  },
  {
    key: "confidenceDisplay",
    label: "Conf UI",
    suffix: "%",
    render: (row) => formatMetric(row.confidenceDisplay, "%"),
  },
  {
    key: "playabilityDisplay",
    label: "Play UI",
    render: (row) => formatMetric(row.playabilityDisplay),
  },
  { key: "verifiedTier", label: "Tier" },
];

const HISTORICAL_PIPELINE_COLUMNS = [
  { key: "player", label: "Player" },
  { key: "market", label: "Market" },
  { key: "last5", label: "Last5" },
  { key: "last10", label: "Last10" },
  { key: "seasonAverage", label: "Season Avg" },
  { key: "gameLogCount", label: "Game Logs" },
  { key: "historicalSource", label: "Historical Source" },
  {
    key: "dropTrace",
    label: "Drop Trace",
    render: (row) => row.dropTrace || (row.historicalPresent ? "OK" : "—"),
  },
];

function VerificationFailureBreakdown({ filterDiagnostics = null }) {
  const dashboard = filterDiagnostics?.verificationDashboard || null;
  const breakdown = dashboard?.verificationFailureBreakdown;
  const pipelineCounts = filterDiagnostics?.pipelineCounts || null;
  const rejectedAudits = safeArray(dashboard?.rejectedPlayabilityAudits);
  const topConfidenceProps = safeArray(dashboard?.topConfidenceProps);
  const topPlayabilityProps = safeArray(dashboard?.topPlayabilityProps);
  const topVerifiedPlays = safeArray(dashboard?.topVerifiedPlays);
  const scoreCloneAudit = dashboard?.scoreCloneAudit || null;
  const historicalCoverageAudit = dashboard?.historicalCoverageAudit || null;
  const historicalSampleRows = safeArray(historicalCoverageAudit?.sampleRows);

  const projectedProps =
    breakdown?.propsWithProjections ?? pipelineCounts?.withProjections ?? breakdown?.projected ?? 0;
  const verifiedProps = breakdown?.verifiedPlays ?? filterDiagnostics?.verifiedPicksCount ?? 0;
  const propsMissingHistoricalData = breakdown?.propsMissingHistoricalData ?? 0;
  const propsUsingNeutralHistoricalFallback = breakdown?.propsUsingNeutralHistoricalFallback ?? 0;
  const historicalDataCoveragePercent =
    breakdown?.historicalDataCoveragePercent ?? historicalCoverageAudit?.coveragePercent ?? 0;
  const failedProbability = breakdown?.failedProbability ?? 0;
  const failedConfidence = breakdown?.failedConfidence ?? 0;
  const failedPlayability = breakdown?.failedPlayability ?? 0;
  const failedSanity = breakdown?.failedSanity ?? 0;
  const failedTierGate = breakdown?.failedTierGate ?? 0;
  const bottleneckLabel = breakdown?.primaryBottleneck;
  const rejected = breakdown?.highestScoringRejectedProp || rejectedAudits[0] || null;

  const summaryRows = [
    {
      key: "projectedProps",
      label: VERIFICATION_FAILURE_GATE_LABELS.propsWithProjections,
      value: projectedProps,
    },
    {
      key: "verifiedProps",
      label: VERIFICATION_FAILURE_GATE_LABELS.verifiedPlays,
      value: verifiedProps,
    },
    {
      key: "propsMissingHistoricalData",
      label: VERIFICATION_FAILURE_GATE_LABELS.propsMissingHistoricalData,
      value: propsMissingHistoricalData,
    },
    {
      key: "propsUsingNeutralHistoricalFallback",
      label: VERIFICATION_FAILURE_GATE_LABELS.propsUsingNeutralHistoricalFallback,
      value: propsUsingNeutralHistoricalFallback,
    },
    {
      key: "historicalDataCoveragePercent",
      label: VERIFICATION_FAILURE_GATE_LABELS.historicalDataCoveragePercent,
      value: `${historicalDataCoveragePercent}%`,
      highlight: historicalDataCoveragePercent < 70,
    },
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
      key: "failedTierGate",
      label: VERIFICATION_FAILURE_GATE_LABELS.failedTierGate,
      value: failedTierGate,
      highlight: bottleneckLabel === VERIFICATION_FAILURE_GATE_LABELS.failedTierGate,
    },
  ];

  return (
    <section className="verification-diagnostics verification-failure-breakdown" aria-label="Verification failure breakdown">
      <h3 className="verification-diagnostics__title">Verification Failure Breakdown</h3>
      <p className="verification-diagnostics__meta">
        Historical data is informational only — missing Last5/Last10 uses neutral scoring and a small
        confidence adjustment, not auto-rejection. Full rejected-prop audits log as{" "}
        <code>[PlayabilityAudit]</code> in the console.
      </p>

      <div className="verification-diagnostics__grid">
        {summaryRows.map(({ key, label, value, highlight }) => (
          <Metric key={key} label={label} value={value} highlight={highlight} />
        ))}
      </div>

      {verifiedProps === 0 && projectedProps > 0 && bottleneckLabel ? (
        <p className="verification-diagnostics__meta">
          Largest drop-off: <strong>{bottleneckLabel}</strong> ({breakdown?.primaryBottleneckCount ?? 0} props).
        </p>
      ) : null}

      {scoreCloneAudit?.suspects?.length ? (
        <p className="verification-diagnostics__meta verification-failure-breakdown__clone-warning">
          Score clone audit:{" "}
          {scoreCloneAudit.suspects
            .map(({ field, value, count }) => `${field}=${value} (${count} props)`)
            .join(" · ")}
          {scoreCloneAudit.identicalScoreGroups
            ? ` · ${scoreCloneAudit.identicalScoreGroups} identical prob/conf/play triplets`
            : ""}
        </p>
      ) : null}

      {historicalCoverageAudit ? (
        <p className="verification-diagnostics__meta">
          Historical pipeline: statsMap {historicalCoverageAudit.statsMapSize ?? 0} profiles · matched{" "}
          {historicalCoverageAudit.profileMatchCount ?? 0} · with game logs{" "}
          {historicalCoverageAudit.profileWithLogsCount ?? 0} · attached from profile{" "}
          {historicalCoverageAudit.attachedFromProfileCount ?? 0}
        </p>
      ) : null}

      <AuditTable
        title="Historical Stats Sample (10 projected props)"
        rows={historicalSampleRows}
        columns={HISTORICAL_PIPELINE_COLUMNS}
        emptyMessage="No projected props available for historical audit."
        scrollable
      />

      <AuditTable
        title="Top 20 Verified Plays (full precision, sorted by composite score)"
        rows={topVerifiedPlays}
        columns={TOP_VERIFIED_COLUMNS}
        emptyMessage="No props passed verification and display gates yet."
        scrollable
      />

      <AuditTable
        title="Highest Scoring Rejected Prop"
        rows={rejected ? [rejected] : []}
        columns={PLAYABILITY_AUDIT_COLUMNS}
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
