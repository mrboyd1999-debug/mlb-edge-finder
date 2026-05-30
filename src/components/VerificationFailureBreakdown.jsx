import { memo, useMemo } from "react";
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

function VerificationFailureBreakdown({ breakdown = null, verifiedCount = null }) {
  const rows = useMemo(() => {
    if (!breakdown) return [];
    return [
      { key: "projected", label: VERIFICATION_FAILURE_GATE_LABELS.projected, value: breakdown.projected },
      { key: "passedProbability", label: VERIFICATION_FAILURE_GATE_LABELS.passedProbability, value: breakdown.passedProbability },
      { key: "failedProbability", label: VERIFICATION_FAILURE_GATE_LABELS.failedProbability, value: breakdown.failedProbability },
      { key: "passedConfidence", label: VERIFICATION_FAILURE_GATE_LABELS.passedConfidence, value: breakdown.passedConfidence },
      { key: "failedConfidence", label: VERIFICATION_FAILURE_GATE_LABELS.failedConfidence, value: breakdown.failedConfidence },
      { key: "passedPlayability", label: VERIFICATION_FAILURE_GATE_LABELS.passedPlayability, value: breakdown.passedPlayability },
      { key: "failedPlayability", label: VERIFICATION_FAILURE_GATE_LABELS.failedPlayability, value: breakdown.failedPlayability },
      { key: "passedSanity", label: VERIFICATION_FAILURE_GATE_LABELS.passedSanity, value: breakdown.passedSanity },
      { key: "failedSanity", label: VERIFICATION_FAILURE_GATE_LABELS.failedSanity, value: breakdown.failedSanity },
      { key: "passedHistoricalData", label: VERIFICATION_FAILURE_GATE_LABELS.passedHistoricalData, value: breakdown.passedHistoricalData },
      { key: "failedHistoricalData", label: VERIFICATION_FAILURE_GATE_LABELS.failedHistoricalData, value: breakdown.failedHistoricalData },
      { key: "passedTierGate", label: VERIFICATION_FAILURE_GATE_LABELS.passedTierGate, value: breakdown.passedTierGate },
      { key: "failedTierGate", label: VERIFICATION_FAILURE_GATE_LABELS.failedTierGate, value: breakdown.failedTierGate },
    ];
  }, [breakdown]);

  if (!breakdown) return null;

  const resolvedVerifiedCount = verifiedCount ?? breakdown.verifiedDisplayCount ?? 0;
  const showZeroVerifiedSummary = resolvedVerifiedCount === 0 && breakdown.projected > 0;
  const bottleneckLabel = breakdown.primaryBottleneck;

  return (
    <section className="verification-diagnostics" aria-label="Verification failure breakdown">
      <h3 className="verification-diagnostics__title">Verification Failure Breakdown</h3>
      <p className="verification-diagnostics__meta">
        Sequential gate audit on projected props — each prop is counted at the first gate it fails.
      </p>

      <div className="verification-diagnostics__grid">
        {rows.map(({ key, label, value }) => (
          <Metric
            key={key}
            label={label}
            value={value}
            highlight={bottleneckLabel === label && String(key).startsWith("failed")}
          />
        ))}
      </div>

      {showZeroVerifiedSummary ? (
        <div className="verification-diagnostics__rejections">
          <h4 className="verification-diagnostics__subtitle">Why verified props = 0</h4>
          {bottleneckLabel ? (
            <p className="verification-diagnostics__meta">
              Largest drop-off: <strong>{bottleneckLabel}</strong> ({breakdown.primaryBottleneckCount}{" "}
              props).
            </p>
          ) : null}
          {breakdown.passedTierGate > 0 && breakdown.blockedByDisplayRankingGate > 0 ? (
            <p className="verification-diagnostics__meta">
              {breakdown.passedTierGate} passed tier gates, but {breakdown.blockedByDisplayRankingGate}{" "}
              were blocked by display ranking gates (playability/confidence/research-only filters).
            </p>
          ) : breakdown.passedTierGate === 0 ? (
            <p className="verification-diagnostics__meta">
              No props passed all tier gates — review failed counts above in order.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default memo(VerificationFailureBreakdown);
