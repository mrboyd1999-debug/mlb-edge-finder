import { useEffect, useMemo, useState } from "react";
import { buildPickExplanation, propPayoutLabel } from "../services/projectionEngine.js";
import { readManualStatsForProp } from "../services/pickStore.js";
import PlayerImage from "./PlayerImage.jsx";
import ProjectionSanityAuditPanel from "./ProjectionSanityAuditPanel.jsx";
import ConfidenceComponentsPanel from "./ConfidenceComponentsPanel.jsx";
import TierAuditPanel from "./TierAuditPanel.jsx";
import SectionErrorBoundary from "./SectionErrorBoundary.jsx";
import {
  formatHitRatePercent,
  resolveBreakdownTitle,
  resolveProjectionLeanDisplay,
  validatePickDirectionBeforeRender,
  isVerifiedHighestProbabilityPick,
} from "../utils/pickDirectionAudit.js";
import { formatBestPlayProjectionSource } from "../utils/bestPlayExplanation.js";
import { confidenceBandDisplay, resolveBandScore } from "../utils/mlbConfidenceEngine.js";
import {
  dataSourcesUsed,
  displaySport,
  edgePercentForProp,
  formatDateTime,
  formatLeanSide,
  formatMaybeLine,
  formatNumber,
  formatPercent,
  formatSignedNumber,
  formatSignedPercent,
  keyStatsSummary,
  lineMovementStatusText,
  riskExplanation,
  usageContextForProp,
  warningFlags,
} from "../utils/pickAnalysis.js";
import { buildHistoricalPerformance } from "../utils/historicalPropAnalytics.js";
import { safeArray } from "../utils/safeStats.js";
import { attachBoardQualityFields,
  resolveBoardDataQualityBadge,
  resolveBoardDataQualityLabel,
  resolveFinalTier,
  resolveRecommendedSide,
  resolveTierDisplayLabel,
} from "../utils/boardQuality.js";
import { resolveNormalizedConfidence, resolveNormalizedProbability } from "../utils/propDisplayFields.js";
import { resolveRiskExplanation } from "../utils/risk.js";
import { resolveOpposingPitcherDisplayLabel } from "../utils/opponentStarter.js";
import { resolvePitcherCardLabel } from "../utils/propDisplayFields.js";
import ProviderLabel from "./ProviderLabel.jsx";
import { resolveVerificationStatus } from "../utils/verificationStatus.js";
import { buildHitRateSnapshot } from "../utils/modelValidation.js";
import { resolveSeasonHitRateBundle, formatSeasonHitRateSource } from "../utils/seasonHitRate.js";
import DataIntegrityPanel from "./DataIntegrityPanel.jsx";
import { isManualAnalyzerProp } from "../utils/manualPropBuilder.js";
import {
  AWAITING_PROJECTION_STATUS,
  hasValidProjection,
  leanBadgeStyle,
  manualRiskBadgeStyle,
  NO_VERIFIED_PLAY_STATUS,
  normalizeManualPick,
  payoutBadgeStyle,
  payoutDisplayLabel,
  projectionVsLineLabel,
  riskShortLabel,
  strongPlayBadgeStyle,
} from "../utils/manualPropScoring.js";
import { styles, riskStyle } from "../theme/styles.js";

import { formatHitRatePercentSafe } from "../utils/formatters.js";
import { resolveBettingEdgeMessage } from "../utils/bettingEdgeMessage.js";

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== "—" && trimmed !== "-" && trimmed.toLowerCase() !== "n/a";
  }
  return Number.isFinite(Number(value)) || Boolean(value);
}

function MetricIf({ label, value, strong = false }) {
  if (!hasValue(value)) return null;
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={strong ? styles.metricValueStrong : styles.metricValue}>{value}</strong>
    </div>
  );
}

function SummaryMetric({ label, value, strong = false }) {
  if (!hasValue(value)) return null;
  return (
    <div className="pick-detail-metric">
      <span>{label}</span>
      <strong style={strong ? styles.metricValueStrong : undefined}>{value}</strong>
    </div>
  );
}

function formatModalMatchup(prop = {}) {
  const raw = String(prop.matchup || "").trim();
  if (raw) {
    return raw
      .replace(/^MLB\s*vs\.?\s*/i, "")
      .replace(/^MLB\s*[·•-]\s*/i, "")
      .replace(/\s+vs\.?\s+/gi, " @ ");
  }
  const team = String(prop.team || prop.playerTeam || "").trim();
  const opponent = String(prop.opponent || prop.opponentTeam || "").trim();
  if (team && opponent) {
    if (team.includes("@")) return team;
    return `${team} @ ${opponent}`;
  }
  return team || opponent || "";
}

function buildSimpleProbabilityAuditRows(prop = {}, hitRateSnapshot = {}) {
  const audit = prop.probabilityAudit || {};
  const calibration = prop.probabilityCalibration || audit.calibration || {};
  const explanation = calibration.probabilityExplanation || prop.probabilityExplanation || {};
  const confidence = resolveNormalizedConfidence(prop);
  const probability = resolveNormalizedProbability(prop);
  const integrityScore = prop.integrityScore ?? prop.propIntegrityScore ?? calibration.integrityScore;
  const last10 =
    hitRateSnapshot?.last10Label ??
    audit.last10HitRate ??
    prop.last10HitRate ??
    prop.recentHitRate ??
    null;
  const edge =
    Number.isFinite(Number(prop.edge)) && Number(prop.edge) !== 0
      ? formatSignedNumber(prop.edge)
      : prop.displayEdgeLabel || null;

  return [
    { label: "Confidence", value: confidence != null ? `${confidence}%` : null, strong: true },
    { label: "Probability", value: probability != null ? `${probability}%` : null, strong: true },
    { label: "History", value: explanation.historicalProbability != null ? `${explanation.historicalProbability}%` : audit.historicalProbability ?? null },
    { label: "Projection", value: explanation.projectionProbability != null ? `${explanation.projectionProbability}%` : audit.projectionProbability ?? null },
    { label: "Final", value: explanation.finalProbability != null ? `${explanation.finalProbability}%` : probability != null ? `${probability}%` : null, strong: true },
    { label: "Integrity Score", value: integrityScore != null ? `${integrityScore}/100` : null },
    { label: "Last 10 Hit Rate", value: last10 },
    { label: "Edge", value: edge, strong: true },
  ].filter((row) => hasValue(row.value));
}

function buildConfidenceExplanationRows(prop = {}) {
  const explanation = prop.confidenceExplanation || prop.confidenceBreakdown?.confidenceExplanation || {};
  const lines = explanation.lines || [];
  if (lines.length) {
    return lines.map((line, index) => {
      const [label, value] = String(line).split(":");
      return { label: label?.trim() || `Factor ${index + 1}`, value: value?.trim() || line };
    });
  }
  const breakdown = prop.confidenceBreakdown || prop.confidenceComponents || {};
  return [
    { label: "Data completeness", value: breakdown.dataCompleteness != null ? `${Math.round(breakdown.dataCompleteness)}%` : null },
    { label: "Sample size", value: breakdown.sampleSize != null ? `${Math.round(breakdown.sampleSize)}%` : null },
    { label: "Line verification", value: breakdown.lineVerification != null ? `${Math.round(breakdown.lineVerification)}%` : null },
    { label: "Pitcher available", value: breakdown.pitcherAvailable != null ? `${Math.round(breakdown.pitcherAvailable)}%` : null },
  ].filter((row) => hasValue(row.value));
}

function buildAdvancedProbabilityAuditRows(prop = {}) {
  const audit = prop.probabilityAudit || {};
  const sampleSizeAdjustment =
    audit.calibration?.breakdown?.sampleSizeSmall || audit.probabilityPenalties?.sampleSizeSmall
      ? "Confidence ×0.85"
      : null;
  const probabilityCap =
    audit.probabilityCap != null
      ? `${audit.probabilityCap}%`
      : audit.calibration?.breakdown?.ceiling != null
        ? `${audit.calibration.breakdown.ceiling}%`
        : null;
  const calibratedProbability =
    audit.calibratedProbability != null
      ? `${audit.calibratedProbability}%`
      : audit.finalProbability != null
        ? `${audit.finalProbability}%`
        : null;

  return [
    { label: "Last 5 hit rate", value: audit.last5HitRate },
    { label: "Recent form", value: audit.recentHitRate },
    { label: "Projection vs line", value: audit.projectionVsLine },
    { label: "Calibrated probability", value: calibratedProbability, strong: true },
    { label: "Probability cap", value: probabilityCap },
    { label: "Sample size adjustment", value: sampleSizeAdjustment },
  ].filter((row) => hasValue(row.value));
}

function FlagRow({ flags = [], tone = "positive" }) {
  if (!flags.length) return null;
  const style =
    tone === "positive"
      ? { border: "1px solid #166534", background: "#052e16", color: "#86efac" }
      : { border: "1px solid #991b1b", background: "#450a0a", color: "#fca5a5" };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
      {flags.map((flag) => (
        <span key={flag} style={{ ...styles.scoreBadge, ...style, fontSize: "9px" }}>
          {flag}
        </span>
      ))}
    </div>
  );
}

export default function PickDetailModal({
  prop: rawProp,
  onClose,
  onUpdateResult,
  onSaveManualStats,
  onSavePick,
  isSaved = false,
  showDebugPanels = false,
  variant = "breakdown",
}) {
  const manualProp = variant === "manual" && isManualAnalyzerProp(rawProp);
  const prop = useMemo(
    () => (manualProp ? rawProp : attachBoardQualityFields(rawProp)),
    [manualProp, rawProp]
  );
  const breakdownMode = !manualProp;
  const hasProjection = hasValidProjection(prop);
  const noVerifiedPlay = manualProp && (!hasProjection || prop.projectionUnavailable);
  const pickSide = noVerifiedPlay ? "" : normalizeManualPick(prop.bestPick || prop.side || prop.pick);
  const lean = noVerifiedPlay
    ? null
    : breakdownMode
      ? resolveProjectionLeanDisplay(prop)
      : pickSide === "over"
        ? "Over"
        : pickSide === "under"
          ? "Under"
          : formatLeanSide(prop.bestPick || prop.side || "Watch");
  const tierBadgeLabel = resolveTierDisplayLabel(prop);
  const breakdownTitle = breakdownMode ? resolveBreakdownTitle(prop) : null;
  const projectionSourceLabel = formatBestPlayProjectionSource(prop);
  const last10HitRate = formatHitRatePercent(
    prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate ?? null
  );
  const seasonBundle = useMemo(() => resolveSeasonHitRateBundle(prop), [prop]);
  const hitRateSnapshot = useMemo(() => buildHitRateSnapshot(prop), [prop]);
  const seasonHitRate = seasonBundle.displayLabel;
  const gamesCountLabel = seasonBundle.gamesLabel || prop.seasonGamesLabel || "Season Games";
  const gamesCountValue =
    seasonBundle.gamesCount ??
    (seasonBundle.gamesLabelKey === "sample" ? seasonBundle.sampleGames : seasonBundle.seasonGames);
  const seasonRateSourceLabel = formatSeasonHitRateSource(seasonBundle.seasonHitRateSource);
  const boardDataLabel = resolveBoardDataQualityLabel(prop);
  const badge = manualProp
    ? prop.dataQualityBadge || { label: prop.scoringModeLabel || "Offline scoring mode", tone: "info" }
    : resolveBoardDataQualityBadge(prop);
  const historical = useMemo(
    () => prop.historicalPerformance || buildHistoricalPerformance({
      sport: prop.sport,
      playerName: prop.playerName || prop.player,
      statType: prop.statType || prop.propType,
    }),
    [prop]
  );
  const explanation = buildPickExplanation({
    ...prop,
    dataQualityBadge: badge,
    dataSources: prop.dataSources || dataSourcesUsed(prop),
  });
  const storedManual = readManualStatsForProp(prop.id) || prop.manualStats || {};
  const [manualDraft, setManualDraft] = useState({
    last5Average: storedManual.last5Average ?? "",
    seasonAverage: storedManual.seasonAverage ?? "",
    opponentAllowed: storedManual.opponentAllowed ?? "",
    opponentRank: storedManual.opponentRank ?? "",
    matchupNote: storedManual.matchupNote ?? "",
    confidenceAdjustment: storedManual.confidenceAdjustment ?? "",
    minutesNote: storedManual.minutesNote ?? "",
    pitchCountNote: storedManual.pitchCountNote ?? "",
    injuryNote: storedManual.injuryNote ?? "",
  });
  const [showProbabilityAudit, setShowProbabilityAudit] = useState(false);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  useEffect(() => {
    if (breakdownMode) {
      validatePickDirectionBeforeRender(prop, "PickDetailModal");
    }
  }, [breakdownMode, prop]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function saveManualStats() {
    const payload = {
      last5Average: manualDraft.last5Average === "" ? null : Number(manualDraft.last5Average),
      seasonAverage: manualDraft.seasonAverage === "" ? null : Number(manualDraft.seasonAverage),
      opponentAllowed: manualDraft.opponentAllowed === "" ? null : Number(manualDraft.opponentAllowed),
      opponentRank: manualDraft.opponentRank === "" ? null : Number(manualDraft.opponentRank),
      matchupNote: String(manualDraft.matchupNote || "").trim(),
      confidenceAdjustment: manualDraft.confidenceAdjustment === "" ? null : Number(manualDraft.confidenceAdjustment),
      minutesNote: String(manualDraft.minutesNote || "").trim(),
      pitchCountNote: String(manualDraft.pitchCountNote || "").trim(),
      injuryNote: String(manualDraft.injuryNote || "").trim(),
    };
    onSaveManualStats?.(prop.id, payload);
  }

  const whyText = manualProp
    ? prop.whyThisPick || prop.premiumWhySummary || prop.qualificationReason || ""
    : prop.cardDescription ||
      prop.premiumWhySummary ||
      prop.whyThisPick?.compact ||
      prop.confidenceExplanation ||
      prop.qualificationReason ||
      premiumFallbackWhy(prop);
  const projVsLine = projectionVsLineLabel(prop);
  const payoutLabel = payoutDisplayLabel(prop);
  const finalTier = resolveFinalTier(prop);
  const matchupLine = formatModalMatchup(prop);
  const sportLabel = displaySport(prop);
  const recommendedSideLabel = breakdownMode
    ? (() => {
        const side = resolveRecommendedSide(prop);
        if (side === "OVER") return "Higher";
        if (side === "UNDER") return "Lower";
        if (lean) return String(lean);
        return null;
      })()
    : lean;
  const propLabel = prop.statType || prop.propType || prop.market || null;
  const verificationLabel = prop.verificationStatus || resolveVerificationStatus(prop);
  const probabilityAuditRows = buildSimpleProbabilityAuditRows(prop, hitRateSnapshot);
  const confidenceExplanationRows = buildConfidenceExplanationRows(prop);
  const advancedProbabilityAuditRows = buildAdvancedProbabilityAuditRows(prop);
  const opposingPitcherLabel = resolvePitcherCardLabel(prop);
  const probabilityLabel = (() => {
    const normalized = resolveNormalizedProbability(prop);
    if (normalized != null) return `${normalized}%`;
    if (prop.probabilityScore != null) return `${Math.round(Number(prop.probabilityScore))}%`;
    if (prop.calibratedProbability != null) return `${Math.round(Number(prop.calibratedProbability))}%`;
    if (prop.impliedHitChance != null) return `${prop.impliedHitChance}%`;
    return prop.hitChanceLabel || null;
  })();
  const confidenceLabel = (() => {
    const normalized = resolveNormalizedConfidence(prop);
    if (normalized != null) return `${normalized}%`;
    return null;
  })();
  const riskLevel = String(prop.riskLevel || "HIGH").toUpperCase();
  const riskDetail = prop.riskExplanation || resolveRiskExplanation(riskLevel);
  const providerLabel = prop.providerLabel || null;
  const edgeLabel =
    Number.isFinite(Number(prop.edge)) && Number(prop.edge) !== 0
      ? formatSignedNumber(prop.edge)
      : null;
  const projectionLabel =
    prop.projectedValue != null
      ? formatNumber(prop.projectedValue)
      : prop.projection != null
        ? formatNumber(prop.projection)
        : null;

  const headerActions = (
    <div className="pick-detail-modal-header__actions">
      {onSavePick ? (
        <button
          type="button"
          style={{ ...styles.secondaryButton, padding: "8px 10px", fontSize: "12px" }}
          onClick={() => onSavePick(prop)}
          disabled={isSaved}
        >
          {isSaved ? "Saved" : "Save"}
        </button>
      ) : null}
      <button
        type="button"
        style={{ ...styles.closeButton, padding: "8px 12px", minHeight: "36px", fontSize: "13px" }}
        onClick={onClose}
        aria-label="Close evaluation"
      >
        ✕
      </button>
    </div>
  );

  return (
    <div className="pick-detail-backdrop" role="presentation" onClick={onClose}>
      <section
        className={manualProp ? "pick-detail-modal pick-detail-modal-manual" : "pick-detail-modal"}
        role="dialog"
        aria-modal="true"
        aria-label={breakdownMode ? breakdownTitle : `${prop.playerName} evaluation`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pick-detail-modal-header pick-detail-modal-sticky">
          <div className="pick-detail-modal-header__meta">
            <div style={styles.modalPlayer}>
              <PlayerImage prop={prop} large />
              <div style={{ minWidth: 0 }}>
                <p className="pick-detail-modal-sport">{sportLabel}</p>
                <h2 style={{ ...styles.modalTitle, fontSize: "16px", margin: 0 }}>{prop.playerName}</h2>
                {matchupLine ? <p className="pick-detail-modal-matchup">{matchupLine}</p> : null}
                {manualProp ? (
                  <div className="pick-detail-modal-badges">
                    {noVerifiedPlay ? (
                      <>
                        <span style={{ ...styles.scoreBadge, border: "1px solid #475569", background: "#1e293b", color: "#94a3b8", fontSize: "9px", padding: "2px 6px" }}>
                          {prop.displayStatus || NO_VERIFIED_PLAY_STATUS}
                        </span>
                        <span style={{ ...styles.scoreBadge, ...payoutBadgeStyle(prop), fontSize: "9px", padding: "2px 6px" }}>
                          {payoutLabel}
                        </span>
                      </>
                    ) : (
                      <>
                        {lean === "Over" || lean === "Under" ? (
                          <span style={{ ...styles.scoreBadge, ...leanBadgeStyle(lean), fontSize: "9px", padding: "2px 6px" }}>
                            {lean.toUpperCase()}
                          </span>
                        ) : null}
                        <span style={{ ...styles.scoreBadge, ...payoutBadgeStyle(prop), fontSize: "9px", padding: "2px 6px" }}>
                          {payoutLabel}
                        </span>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {headerActions}
        </header>

        <div className="pick-detail-modal-body">
          {!manualProp && finalTier === "C" ? (
            <p className="pick-detail-modal-tier-warning">Research Candidate — not a locked play</p>
          ) : null}

          <div className="pick-detail-modal-summary">
            {manualProp && noVerifiedPlay ? (
              <>
                <SummaryMetric label="Status" value={prop.displayStatus || NO_VERIFIED_PLAY_STATUS} strong />
                <SummaryMetric label="Line" value={formatNumber(prop.line)} strong />
                <SummaryMetric label="Projection" value="Unavailable" strong />
                <SummaryMetric label="Proj vs Line" value={projVsLine} strong />
              </>
            ) : (
              <>
                {breakdownMode ? <SummaryMetric label="Prop" value={propLabel} /> : null}
                <SummaryMetric label="Recommended side" value={recommendedSideLabel} strong />
                <SummaryMetric label="Line" value={formatNumber(prop.line)} strong />
                <SummaryMetric label="Projection" value={projectionLabel} strong />
                <SummaryMetric label="Edge" value={edgeLabel} strong />
                <SummaryMetric label="Probability" value={probabilityLabel} strong />
                <SummaryMetric label="Confidence" value={confidenceLabel} strong />
                <SummaryMetric label="Risk" value={riskLevel} strong />
                {breakdownMode ? <SummaryMetric label="Tier" value={tierBadgeLabel} strong /> : null}
                {breakdownMode ? <SummaryMetric label="Opposing pitcher" value={opposingPitcherLabel} /> : null}
                {breakdownMode ? <SummaryMetric label="Verification status" value={verificationLabel} /> : null}
                {providerLabel ? <SummaryMetric label="Provider" value={providerLabel} /> : null}
              </>
            )}
          </div>

          <div className="pick-detail-modal-section">
            <strong>{breakdownMode ? "Why it qualifies" : manualProp ? "Grade summary" : "Why this pick"}</strong>
            {manualProp && noVerifiedPlay ? (
              <p>{prop.statusMessage || AWAITING_PROJECTION_STATUS}</p>
            ) : (
              <>
                {manualProp && (prop.dataStatus || prop.projectionLabel) && !noVerifiedPlay ? (
                  <p style={{ color: "#86efac", marginBottom: "6px" }}>
                    {prop.isVerifiedProjection ? "Verified MLB projection" : prop.dataStatus || prop.projectionLabel}
                  </p>
                ) : null}
                <p>{whyText}</p>
                {!manualProp && riskDetail ? (
                  <p style={{ marginTop: "6px", fontSize: "11px" }}>{riskDetail}</p>
                ) : null}
              </>
            )}
          </div>

          {breakdownMode && showDebugPanels && prop.probabilityAudit ? (
            <>
              <button
                type="button"
                className="pick-detail-toggle-btn"
                onClick={() => setShowProbabilityAudit((open) => !open)}
                aria-expanded={showProbabilityAudit}
              >
                {showProbabilityAudit ? "Hide Probability Audit" : "Show Probability Audit"}
              </button>
              {showProbabilityAudit ? (
                <div className="pick-detail-modal-audit">
                  <strong style={{ fontSize: "11px" }}>Probability audit</strong>
                  {prop.probabilityAudit.historicalDataWarning ? (
                    <p className="probability-audit__warning">{prop.probabilityAudit.historicalDataWarning}</p>
                  ) : null}
                  <div className="compact-prop-grid" style={{ marginTop: "8px" }}>
                    {probabilityAuditRows.map((row) => (
                      <SummaryMetric key={row.label} label={row.label} value={row.value} strong={row.strong} />
                    ))}
                  </div>
                  {confidenceExplanationRows.length ? (
                    <>
                      <strong style={{ display: "block", marginTop: "10px", fontSize: "11px" }}>Confidence explanation</strong>
                      <div className="compact-prop-grid" style={{ marginTop: "8px" }}>
                        {confidenceExplanationRows.map((row) => (
                          <SummaryMetric key={row.label} label={row.label} value={row.value} />
                        ))}
                      </div>
                    </>
                  ) : null}
                  {showDebugPanels && advancedProbabilityAuditRows.length ? (
                    <>
                      <strong style={{ display: "block", marginTop: "10px", fontSize: "11px" }}>Advanced calculations</strong>
                      <div className="compact-prop-grid" style={{ marginTop: "8px" }}>
                        {advancedProbabilityAuditRows.map((row) => (
                          <SummaryMetric key={row.label} label={row.label} value={row.value} strong={row.strong} />
                        ))}
                      </div>
                      {prop.probabilityAudit.explanationLines?.length ? (
                        <p style={{ ...styles.compactFlags, margin: "8px 0 0", fontSize: "11px", lineHeight: 1.45, color: "#cbd5e1" }}>
                          {prop.probabilityAudit.explanationLines.join(" · ")}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {showDebugPanels ? (
            <button
              type="button"
              className="pick-detail-toggle-btn"
              onClick={() => setShowAdvancedDetails((open) => !open)}
              aria-expanded={showAdvancedDetails}
            >
              {showAdvancedDetails ? "Hide Advanced Details" : "Show Advanced Details"}
            </button>
          ) : null}

          {showDebugPanels && showAdvancedDetails ? (
            <div className="pick-detail-modal-audit">
              {!manualProp ? (
                <>
                  <FlagRow flags={prop.positiveFlags || prop.smartFlags?.positive} tone="positive" />
                  <FlagRow flags={prop.negativeFlags || prop.smartFlags?.negative} tone="negative" />
                </>
              ) : null}

              {breakdownMode && prop.edgeValidation ? (
                <div className="pick-detail-modal-section">
                  <strong>Edge validation</strong>
                  <p>{prop.edgeValidation.formula}</p>
                  <p style={{ marginTop: "4px" }}>{prop.edgeValidation.substitution}</p>
                  {prop.edgeValidation.note ? <p style={{ marginTop: "4px", color: "#fbbf24" }}>{prop.edgeValidation.note}</p> : null}
                </div>
              ) : null}

              {breakdownMode && prop.matchupAudit ? (
                <div className="pick-detail-modal-section">
                  <strong>Matchup context</strong>
                  <div className="compact-prop-grid" style={{ marginTop: "8px" }}>
                    <MetricIf label="Team" value={prop.matchupAudit.team !== "—" ? prop.matchupAudit.team : null} />
                    <MetricIf label="Opponent" value={prop.matchupAudit.opponent !== "—" ? prop.matchupAudit.opponent : null} />
                    <MetricIf label="Pitcher" value={opposingPitcherLabel !== "—" ? opposingPitcherLabel : null} />
                    <MetricIf label="Matchup score" value={prop.matchupAudit.matchupScore != null ? `${prop.matchupAudit.matchupScore}/100` : null} strong />
                  </div>
                </div>
              ) : null}

              {breakdownMode && hitRateSnapshot ? (
                <div className="pick-detail-modal-section">
                  <strong>Hit rate snapshot</strong>
                  <div className="hit-rate-viz hit-rate-viz--modal">
                    <span>Last 5: <strong>{hitRateSnapshot.last5Label}</strong></span>
                    <span>Last 10: <strong>{hitRateSnapshot.last10Label}</strong></span>
                    <span>Season: <strong>{hitRateSnapshot.seasonLabel !== "0%" ? hitRateSnapshot.seasonLabel : seasonHitRate}</strong></span>
                  </div>
                </div>
              ) : null}

              {prop.projectionSanityAudit?.supported ? (
                <div className="pick-detail-modal-section">
                  <SectionErrorBoundary name="Projection Sanity">
                    <ProjectionSanityAuditPanel audit={prop.projectionSanityAudit} />
                  </SectionErrorBoundary>
                </div>
              ) : null}

              {showDebugPanels && (prop.confidenceComponents || prop.confidenceBreakdown?.components) ? (
                <div className="pick-detail-modal-section">
                  <SectionErrorBoundary name="Confidence Components">
                    <ConfidenceComponentsPanel audit={prop.confidenceComponents || prop.confidenceBreakdown} />
                  </SectionErrorBoundary>
                </div>
              ) : null}

              {showDebugPanels && (prop.tierAudit || prop.confidenceAudit) ? (
                <div className="pick-detail-modal-section">
                  <SectionErrorBoundary name="Tier Audit">
                    <TierAuditPanel auditRows={[prop.tierAudit].filter(Boolean)} limit={1} />
                  </SectionErrorBoundary>
                </div>
              ) : null}

              {showDebugPanels && breakdownMode && prop.dataIntegrity ? (
                <div className="pick-detail-modal-section">
                  <DataIntegrityPanel audit={prop.dataIntegrity} />
                </div>
              ) : null}

              {manualProp ? (
                <div className="pick-detail-modal-section">
                  <strong>Manual stat boost</strong>
                  <div style={styles.controls}>
                    <label style={styles.selectLabel}>
                      Last 5 average
                      <input style={styles.textInput} type="number" step="0.1" value={manualDraft.last5Average} onChange={(e) => setManualDraft((c) => ({ ...c, last5Average: e.target.value }))} />
                    </label>
                    <label style={styles.selectLabel}>
                      Season average
                      <input style={styles.textInput} type="number" step="0.1" value={manualDraft.seasonAverage} onChange={(e) => setManualDraft((c) => ({ ...c, seasonAverage: e.target.value }))} />
                    </label>
                  </div>
                  <button type="button" style={{ ...styles.secondaryButton, marginTop: "8px" }} onClick={saveManualStats}>
                    Apply manual boost
                  </button>
                </div>
              ) : null}

              <div className="pick-detail-modal-section">
                <strong>{manualProp ? "More info" : "More breakdown"}</strong>
                <div className="compact-prop-grid" style={{ marginTop: "8px" }}>
                  <MetricIf label="Projection Source" value={projectionSourceLabel} />
                  <MetricIf label="Last 10 Hit Rate" value={last10HitRate !== "—" ? last10HitRate : null} />
                  <MetricIf label="Season Hit Rate" value={seasonHitRate !== "—" && seasonHitRate !== "0%" ? seasonHitRate : null} />
                  <MetricIf label="Playability" value={Number.isFinite(Number(prop.playabilityScore)) ? `${Math.round(Number(prop.playabilityScore))}/100` : null} />
                  <MetricIf label="Data quality" value={Number.isFinite(Number(prop.dataQualityScore)) ? `${Math.round(Number(prop.dataQualityScore))}/100` : null} />
                  <MetricIf label="Risk" value={prop.riskLevel} />
                  <MetricIf label="Sources" value={(dataSourcesUsed(prop) || []).join(", ") || null} />
                </div>
                <div style={{ ...styles.evaluationText, marginTop: "10px", fontSize: "11px" }}>
                  <p>{keyStatsSummary(prop)}</p>
                  <p>{usageContextForProp(prop)}</p>
                </div>
              </div>
            </div>
          ) : null}

          {onUpdateResult ? (
            <div style={{ ...styles.resultButtons, marginTop: "10px" }}>
              {["Win", "Loss", "Push", "Pending", "Manual"].map((result) => (
                <button
                  key={result}
                  type="button"
                  style={(prop.resultStatus || prop.finalResult) === result ? styles.resultButtonActive : styles.resultButton}
                  onClick={() => onUpdateResult(prop.id, result)}
                >
                  {result}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function premiumFallbackWhy(prop = {}) {
  const edge = Number(prop.edge);
  if (Number.isFinite(edge) && edge >= 1.5) {
    return `Model projects a ${formatNumber(edge)}-point edge against the posted line.`;
  }
  return "Monitor for sharper confirmation before sizing up.";
}
