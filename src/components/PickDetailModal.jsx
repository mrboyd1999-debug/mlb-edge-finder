import { useEffect, useMemo, useState } from "react";
import { dataQualityBadge } from "../services/dataQuality.js";
import { buildPickExplanation, propPayoutLabel } from "../services/projectionEngine.js";
import { isReadyToBet, READY_MIN_CONFIDENCE, READY_MIN_DATA_QUALITY, PROJECTION_CONFIDENCE_THRESHOLDS } from "../services/pickScoring.js";
import { readManualStatsForProp } from "../services/pickStore.js";
import DataQualityBadge from "./DataQualityBadge.jsx";
import PlayerImage from "./PlayerImage.jsx";
import ProjectionSanityAuditPanel from "./ProjectionSanityAuditPanel.jsx";
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

const NO_EDGE_MESSAGE = "No betting edge detected. More data needed before this becomes a confident pick.";

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

export default function PickDetailModal({ prop, onClose, onUpdateResult, onSaveManualStats, onSavePick, variant = "breakdown" }) {
  const manualProp = variant === "manual" && isManualAnalyzerProp(prop);
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
  const ready = prop.isDisplayPlayable !== false && (Boolean(prop.isQualificationAccepted) || isReadyToBet(prop));
  const verifiedPick = isVerifiedHighestProbabilityPick(prop);
  const bandLabel = breakdownMode
    ? verifiedPick
      ? prop.verifiedTierLabel || prop.pickTierLabel || "Verified Play"
      : prop.pickTierLabel === "Research Candidate" || prop.displayResearchOnly
        ? "Research Candidate"
        : confidenceBandDisplay(resolveBandScore(prop))
    : confidenceBandDisplay(resolveBandScore(prop));
  const breakdownTitle = breakdownMode ? resolveBreakdownTitle(prop) : null;
  const projectionSourceLabel = formatBestPlayProjectionSource(prop);
  const last10HitRate = formatHitRatePercent(
    prop.last10HitRate ?? prop.recentHitRate ?? prop.last5HitRate
  );
  const seasonHitRate = formatHitRatePercent(prop.seasonHitRate);
  const badge = manualProp
    ? prop.dataQualityBadge || { label: prop.scoringModeLabel || "Offline scoring mode", tone: "info" }
    : prop.dataQualityBadge || dataQualityBadge(prop);
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
    : prop.premiumWhySummary ||
      prop.whyThisPick?.compact ||
      prop.confidenceExplanation ||
      prop.qualificationReason ||
      premiumFallbackWhy(prop);
  const projVsLine = projectionVsLineLabel(prop);
  const payoutLabel = payoutDisplayLabel(prop);

  return (
    <div style={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={manualProp ? "pick-detail-modal pick-detail-modal-manual" : "pick-detail-modal"}
        style={{ ...styles.modalPanel, maxHeight: manualProp ? "76vh" : "80vh", padding: manualProp ? "4px 6px" : "6px 8px" }}
        role="dialog"
        aria-modal="true"
        aria-label={breakdownMode ? breakdownTitle : `${prop.playerName} evaluation`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pick-detail-modal-sticky" style={{ ...styles.modalHeader, position: "sticky", top: 0, zIndex: 2, background: "#0f172a", paddingBottom: "4px", marginBottom: "4px", borderBottom: "1px solid #1e293b" }}>
          <div style={styles.modalPlayer}>
            <PlayerImage prop={prop} large />
            <div style={{ minWidth: 0 }}>
              <p style={styles.platform}>{breakdownMode ? breakdownTitle : prop.platform}</p>
              <h2 style={{ ...styles.modalTitle, fontSize: "15px" }}>{prop.playerName}</h2>
              {(prop.team || prop.opponent) ? (
                <p style={{ ...styles.gameLine, fontSize: "11px", margin: "2px 0 0" }}>
                  {displaySport(prop)}{prop.team ? ` · ${prop.team}` : ""}{prop.opponent ? ` vs ${prop.opponent}` : ""}
                </p>
              ) : (
                <p style={{ ...styles.gameLine, fontSize: "11px", margin: "2px 0 0" }}>{displaySport(prop)}</p>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "flex-start" }}>
            {onSavePick ? (
              <button type="button" style={{ ...styles.secondaryButton, padding: manualProp ? "6px 8px" : "8px 10px", fontSize: manualProp ? "11px" : "12px" }} onClick={() => onSavePick(prop)}>
                Save
              </button>
            ) : null}
            <button type="button" style={{ ...styles.closeButton, padding: manualProp ? "6px 10px" : "8px 12px", minHeight: manualProp ? "30px" : "36px", fontSize: manualProp ? "12px" : "13px" }} onClick={onClose} aria-label="Close evaluation">
              ✕
            </button>
          </div>
        </div>

        <div style={{ ...styles.tagRow, marginBottom: manualProp ? "4px" : "6px", gap: "3px" }}>
          {manualProp ? (
            noVerifiedPlay ? (
              <>
                <span style={{ ...styles.scoreBadge, border: "1px solid #475569", background: "#1e293b", color: "#94a3b8", fontSize: "9px", padding: "1px 5px" }}>
                  {prop.displayStatus || NO_VERIFIED_PLAY_STATUS}
                </span>
                <span style={{ ...styles.scoreBadge, ...payoutBadgeStyle(prop), fontSize: "9px", padding: "1px 5px" }}>
                  {payoutLabel}
                </span>
              </>
            ) : (
            <>
              {lean === "Over" || lean === "Under" ? (
                <span style={{ ...styles.scoreBadge, ...leanBadgeStyle(lean), fontSize: "9px", padding: "1px 5px" }}>
                  {lean.toUpperCase()}
                </span>
              ) : null}
              {prop.riskLevel ? (
                <span style={{ ...styles.scoreBadge, ...manualRiskBadgeStyle(prop.riskLevel), fontSize: "9px", padding: "1px 5px" }}>
                  {riskShortLabel(prop.riskLevel)} RISK
                </span>
              ) : null}
              {prop.confidenceScore != null && prop.confidenceScore > 0 ? (
                <span style={{ ...styles.scoreBadge, border: "1px solid #166534", background: "#052e16", color: "#86efac", fontSize: "9px", padding: "1px 5px" }}>
                  {prop.confidenceScore}%
                </span>
              ) : null}
              <span style={{ ...styles.scoreBadge, ...payoutBadgeStyle(prop), fontSize: "9px", padding: "1px 5px" }}>
                {payoutLabel}
              </span>
              {prop.playTag === "Strong Play" ? (
                <span style={{ ...styles.scoreBadge, ...strongPlayBadgeStyle(), fontSize: "9px", padding: "1px 5px" }}>
                  Strong Play
                </span>
              ) : null}
            </>
            )
          ) : (
            <>
              <span style={ready ? styles.segmentActive : styles.segment}>{bandLabel}</span>
              <span style={riskStyle(prop.riskLevel)}>{prop.riskLevel || "Medium"}</span>
              {Number.isFinite(Number(prop.playabilityScore)) ? (
                <span style={styles.valueTag}>Playability {Math.round(Number(prop.playabilityScore))}</span>
              ) : null}
              <DataQualityBadge badge={badge} />
              {(prop.payoutLabel || propPayoutLabel(prop)) !== "standard" && (
                <span style={styles.valueTag}>{prop.payoutLabel || propPayoutLabel(prop)}</span>
              )}
            </>
          )}
        </div>

        {!manualProp ? (
          <>
            <FlagRow flags={prop.positiveFlags || prop.smartFlags?.positive} tone="positive" />
            <FlagRow flags={prop.negativeFlags || prop.smartFlags?.negative} tone="negative" />
          </>
        ) : null}

        <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: manualProp ? "3px" : "4px", marginBottom: manualProp ? "4px" : "6px" }}>
          {manualProp && noVerifiedPlay ? (
            <>
              <MetricIf label="Status" value={prop.displayStatus || NO_VERIFIED_PLAY_STATUS} strong />
              <MetricIf label="Line" value={formatNumber(prop.line)} strong />
              <MetricIf label="Projection" value="Unavailable" strong />
              <MetricIf label="Proj vs Line" value={projVsLine} strong />
            </>
          ) : (
            <>
          <MetricIf label="Confidence" value={prop.confidenceScore != null && prop.confidenceScore > 0 ? `${prop.confidenceScore}%` : null} strong />
          <MetricIf
            label="Hit Chance"
            value={
              prop.impliedHitChance != null
                ? `${prop.impliedHitChance}%`
                : prop.hitChanceLabel || null
            }
            strong
          />
          <MetricIf label="Edge" value={Number.isFinite(Number(prop.edge)) && Number(prop.edge) > 0 ? formatSignedNumber(prop.edge) : null} strong />
          <MetricIf label="Proj vs Line" value={projVsLine} strong />
          {manualProp ? (
            <>
              <MetricIf label="Line" value={formatNumber(prop.line)} strong />
              <MetricIf
                label="Projection"
                value={
                  prop.projectedValue != null
                    ? formatNumber(prop.projectedValue)
                    : prop.projection != null
                      ? formatNumber(prop.projection)
                      : null
                }
                strong
              />
            </>
          ) : null}
          <MetricIf label="Prop" value={prop.statType} />
          {breakdownMode ? <MetricIf label="Projection Source" value={projectionSourceLabel} /> : null}
          {breakdownMode ? <MetricIf label="Last 10 Hit Rate" value={last10HitRate !== "—" ? last10HitRate : null} /> : null}
          {breakdownMode ? <MetricIf label="Season Hit Rate" value={seasonHitRate !== "—" ? seasonHitRate : null} /> : null}
          {breakdownMode ? <MetricIf label="Source" value={prop.platform || prop.source} /> : null}
          {breakdownMode ? <MetricIf label="Line" value={formatNumber(prop.line)} strong /> : null}
          {breakdownMode ? (
            <MetricIf
              label="Projection"
              value={
                prop.projectedValue != null
                  ? formatNumber(prop.projectedValue)
                  : prop.projection != null
                    ? formatNumber(prop.projection)
                    : null
              }
              strong
            />
          ) : null}
          {breakdownMode ? <MetricIf label="Lean" value={lean} strong /> : null}
          {manualProp && !noVerifiedPlay ? <MetricIf label="Risk" value={prop.riskLevel} /> : null}
          {!manualProp ? <MetricIf label="Risk" value={prop.riskLevel} /> : null}
          {!noVerifiedPlay ? <MetricIf label="Volatility" value={prop.volatilityLabel || null} /> : null}
            </>
          )}
          {!manualProp ? (
            <>
              <MetricIf
                label="Edge %"
                value={
                  prop.edgePercent != null && Number.isFinite(Number(prop.edgePercent))
                    ? formatSignedPercent(Number(prop.edgePercent) / 100)
                    : formatSignedPercent(edgePercentForProp(prop) != null ? edgePercentForProp(prop) / 100 : null)
                }
              />
              <MetricIf label="Playability" value={Number.isFinite(Number(prop.playabilityScore)) ? `${Math.round(Number(prop.playabilityScore))}/100` : null} />
            </>
          ) : null}
        </div>

        <div style={{ ...styles.explanationBlock, padding: manualProp ? "5px 6px" : "6px 8px", marginBottom: "3px" }}>
          <strong style={{ fontSize: "11px" }}>{breakdownMode ? "Why it qualifies" : manualProp ? "Grade summary" : "Why this pick"}</strong>
          {manualProp && noVerifiedPlay ? (
            <p style={{ ...styles.compactFlags, margin: "3px 0 0", fontSize: "11px", lineHeight: 1.35, color: "#94a3b8" }}>
              {prop.statusMessage || AWAITING_PROJECTION_STATUS}
            </p>
          ) : (
            <>
          {manualProp && (prop.dataStatus || prop.projectionLabel) && !noVerifiedPlay ? (
            <p style={{ ...styles.compactFlags, margin: "3px 0 0", fontSize: "10px", color: "#86efac" }}>
              {prop.isVerifiedProjection ? "Verified MLB projection" : prop.dataStatus || prop.projectionLabel}
            </p>
          ) : null}
          <p style={{ ...styles.compactFlags, margin: "3px 0 0", fontSize: "11px", lineHeight: 1.35 }}>{whyText}</p>
            </>
          )}
          {!manualProp ? (
            <p style={{ ...styles.compactFlags, margin: "3px 0 0", color: "#94a3b8", fontSize: "10px" }}>{riskExplanation(prop)}</p>
          ) : null}
        </div>

        {breakdownMode && prop.probabilityAudit ? (
          <div style={{ ...styles.explanationBlock, padding: "6px 8px", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Probability audit</strong>
            {prop.probabilityAudit.historicalDataWarning ? (
              <p className="probability-audit__warning">{prop.probabilityAudit.historicalDataWarning}</p>
            ) : null}
            <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "3px", marginTop: "4px" }}>
              <MetricIf label="Last 5 hit rate" value={prop.probabilityAudit.last5HitRate} />
              <MetricIf label="Last 10 hit rate" value={prop.probabilityAudit.last10HitRate} />
              <MetricIf label="Season hit rate" value={prop.probabilityAudit.seasonHitRate} />
              <MetricIf label="Projection vs line" value={prop.probabilityAudit.projectionVsLine} />
              <MetricIf label="Opponent adjustment" value={prop.probabilityAudit.opponentAdjustment} />
              <MetricIf label="Park adjustment" value={prop.probabilityAudit.parkAdjustment} />
              <MetricIf label="Final probability" value={prop.probabilityAudit.finalProbability != null ? `${prop.probabilityAudit.finalProbability}%` : null} strong />
            </div>
            {prop.probabilityAudit.explanationLines?.length ? (
              <p style={{ ...styles.compactFlags, margin: "4px 0 0", fontSize: "10px", lineHeight: 1.45, color: "#cbd5e1" }}>
                {prop.probabilityAudit.explanationLines.join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {breakdownMode && prop.edgeValidation ? (
          <div style={{ ...styles.explanationBlock, padding: "6px 8px", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Edge validation</strong>
            <p style={{ ...styles.compactFlags, margin: "3px 0 0", fontSize: "10px", lineHeight: 1.45, color: "#cbd5e1" }}>
              {prop.edgeValidation.formula}
            </p>
            <p style={{ ...styles.compactFlags, margin: "2px 0 0", fontSize: "10px", lineHeight: 1.45, color: "#e2e8f0" }}>
              {prop.edgeValidation.substitution}
            </p>
            {prop.edgeValidation.note ? (
              <p style={{ ...styles.compactFlags, margin: "2px 0 0", fontSize: "10px", color: "#fbbf24" }}>
                {prop.edgeValidation.note}
              </p>
            ) : null}
          </div>
        ) : null}

        {breakdownMode && prop.matchupAudit ? (
          <div style={{ ...styles.explanationBlock, padding: "6px 8px", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Matchup context</strong>
            <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "3px", marginTop: "4px" }}>
              <MetricIf label="Team" value={prop.matchupAudit.team !== "—" ? prop.matchupAudit.team : null} />
              <MetricIf label="Opponent" value={prop.matchupAudit.opponent !== "—" ? prop.matchupAudit.opponent : null} />
              <MetricIf label="Pitcher" value={prop.matchupAudit.pitcher !== "—" ? prop.matchupAudit.pitcher : null} />
              <MetricIf label="Venue" value={prop.matchupAudit.venue !== "—" ? prop.matchupAudit.venue : null} />
              <MetricIf label="Matchup score" value={prop.matchupAudit.matchupScore != null ? `${prop.matchupAudit.matchupScore}/100` : null} strong />
              <MetricIf label="Matchup confidence" value={prop.matchupAudit.matchupConfidence !== "—" ? prop.matchupAudit.matchupConfidence : null} />
            </div>
            {prop.matchupAudit.matchupNote ? (
              <p style={{ ...styles.compactFlags, margin: "3px 0 0", fontSize: "10px", color: "#94a3b8" }}>
                {prop.matchupAudit.matchupNote}
              </p>
            ) : null}
          </div>
        ) : null}

        {breakdownMode && prop.hitRateSnapshot ? (
          <div style={{ ...styles.explanationBlock, padding: "6px 8px", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Hit rate snapshot</strong>
            <div className="hit-rate-viz hit-rate-viz--modal">
              <span>
                Last 5: <strong>{prop.hitRateSnapshot.last5Label}</strong>
              </span>
              <span>
                Last 10: <strong>{prop.hitRateSnapshot.last10Label}</strong>
              </span>
              <span>
                Season: <strong>{prop.hitRateSnapshot.seasonLabel}</strong>
              </span>
            </div>
          </div>
        ) : null}

        {(manualProp || Array.isArray(prop.projectionBreakdown)) && Array.isArray(prop.projectionBreakdown) && prop.projectionBreakdown.length > 0 ? (
          <div style={{ ...styles.explanationBlock, padding: "5px 6px", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Projection breakdown</strong>
            {prop.projectionLabel || prop.dataStatus ? (
              <p style={{ ...styles.compactFlags, margin: "3px 0 0", fontSize: "10px", color: noVerifiedPlay ? "#94a3b8" : "#86efac" }}>
                {noVerifiedPlay ? prop.statusMessage || AWAITING_PROJECTION_STATUS : prop.dataStatus || prop.projectionLabel}
              </p>
            ) : null}
            <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "3px", marginTop: "4px" }}>
              {prop.projectionBreakdown
                .filter((row) => row.label !== "Projected Output" && row.label !== "Projected Ks" && row.label !== "Data status")
                .slice(0, 10)
                .map((row) => (
                  <MetricIf key={row.label} label={row.label} value={row.display ?? row.value} strong={/projected/i.test(row.label)} />
                ))}
              {prop.projectionBreakdown.find((row) => /projected|final projection/i.test(row.label)) ? (
                <MetricIf
                  label="Projected"
                  value={prop.projectionBreakdown.find((row) => /projected|final projection/i.test(row.label))?.display}
                  strong
                />
              ) : null}
              {prop.dataStatus || prop.projectionBreakdown.find((row) => row.label === "Data status") ? (
                <MetricIf
                  label="Data status"
                  value={prop.dataStatus || prop.projectionBreakdown.find((row) => row.label === "Data status")?.display}
                  strong={!noVerifiedPlay}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {prop.projectionSanityAudit?.supported ? (
          <div style={{ ...styles.explanationBlock, padding: "6px 8px", marginBottom: "4px" }}>
            <ProjectionSanityAuditPanel audit={prop.projectionSanityAudit} />
          </div>
        ) : null}

        {manualProp && prop.sideEngineDebug ? (
          <details style={{ ...styles.compactDetails, marginTop: "4px" }}>
            <summary style={styles.detailsSummary}>
              <span>
                <span style={styles.eyebrow}>Debug</span>
                <strong>Projection engine</strong>
              </span>
            </summary>
            <div style={{ ...styles.compactPanel, marginTop: "4px" }}>
              <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px" }}>
                <MetricIf label="Projection source" value={prop.sideEngineDebug.projectionSource} />
                <MetricIf label="Data status" value={prop.sideEngineDebug.dataStatus} />
                <MetricIf label="Edge formula" value={prop.sideEngineDebug.edgeFormula} />
                {prop.sideEngineDebug.projectionUnavailable ? (
                  <MetricIf label="Edge calculation" value={prop.sideEngineDebug.edgeCalculation || "Edge calculation unavailable"} />
                ) : (
                  <>
                    <MetricIf label="Raw edge" value={prop.sideEngineDebug.rawEdge != null ? formatSignedNumber(prop.sideEngineDebug.rawEdge) : null} />
                    <MetricIf label="Recommended side" value={prop.sideEngineDebug.recommendedSide?.toUpperCase()} />
                    <MetricIf label="Side aligned" value={prop.sideEngineDebug.sideAligned == null ? null : prop.sideEngineDebug.sideAligned ? "Yes" : "No"} />
                    <MetricIf label="Recent average" value={prop.sideEngineDebug.recentAverage != null ? formatNumber(prop.sideEngineDebug.recentAverage) : null} />
                    <MetricIf label="Matchup adjustment" value={prop.sideEngineDebug.matchupNote} />
                    <MetricIf label="Volatility tier" value={prop.sideEngineDebug.volatilityTier} />
                  </>
                )}
                <MetricIf label="Sportsbook line" value={prop.sideEngineDebug.sportsbookLine != null ? formatNumber(prop.sideEngineDebug.sportsbookLine) : null} />
              </div>
            </div>
          </details>
        ) : null}

        {!manualProp && (historical.last10.sample > 0 || historical.last20.sample > 0) && (
          <div style={{ ...styles.explanationBlock, marginTop: "8px" }}>
            <strong>Historical tracking</strong>
            <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px", marginTop: "6px" }}>
              <MetricIf label="Last 5 hit" value={historical.last5.hitPct != null ? `${historical.last5.hitPct}%` : null} />
              <MetricIf label="Last 10 hit" value={historical.last10.hitPct != null ? `${historical.last10.hitPct}%` : null} />
              <MetricIf label="Last 20 hit" value={historical.last20.hitPct != null ? `${historical.last20.hitPct}%` : null} />
              <MetricIf label="Avg edge (10)" value={historical.last10.avgEdge != null ? formatSignedNumber(historical.last10.avgEdge) : null} />
              <MetricIf label="ROI sim (10)" value={historical.last10.roiPct != null ? `${historical.last10.roiPct}%` : null} />
              <MetricIf label="Trend" value={historical.last10.streakTrend !== "flat" ? historical.last10.streakTrend : null} />
            </div>
          </div>
        )}

        {(prop.lineComparison || prop.sportsbookComparison) && !manualProp && (
          <div style={{ ...styles.comparisonBox, marginTop: "8px", padding: "6px 8px", fontSize: "11px" }}>
            {prop.lineComparison?.prizePicksLine != null ? <span>PP {formatMaybeLine(prop.lineComparison.prizePicksLine)}</span> : null}
            {prop.lineComparison?.underdogLine != null ? <span>UD {formatMaybeLine(prop.lineComparison.underdogLine)}</span> : null}
            {prop.sportsbookComparison?.marketAverageLine != null ? (
              <span>Books {formatMaybeLine(prop.sportsbookComparison.marketAverageLine)}</span>
            ) : null}
          </div>
        )}

        <details style={{ ...styles.compactDetails, marginTop: manualProp ? "4px" : "8px" }} open={breakdownMode ? false : undefined}>
          <summary style={styles.detailsSummary}>
            <span>
              <span style={styles.eyebrow}>{manualProp ? "Details" : "Deep dive"}</span>
              <strong>{breakdownMode ? "More breakdown" : manualProp ? "More info" : "More research"}</strong>
            </span>
          </summary>
          <div style={{ ...styles.compactPanel, marginTop: "4px" }}>
            {manualProp ? (
              <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px", marginBottom: "4px" }}>
                <MetricIf label="Line" value={formatNumber(prop.line)} />
                <MetricIf label="Projection" value={prop.projectedValue != null ? formatNumber(prop.projectedValue) : prop.projection != null ? formatNumber(prop.projection) : null} />
                <MetricIf label="Edge %" value={prop.edgePercent != null ? `${prop.edgePercent}%` : null} />
                <MetricIf label="Grade source" value={prop.scoringModeLabel || "Projection unavailable"} />
              </div>
            ) : null}
            {!manualProp ? (
            <div style={{ ...styles.modalGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px" }}>
              <MetricIf label="Calibrated conf" value={prop.calibratedConfidence != null ? `${prop.calibratedConfidence}%` : null} />
              <MetricIf label="Data quality" value={Number.isFinite(Number(prop.dataQualityScore)) ? `${Math.round(Number(prop.dataQualityScore))}/100` : null} />
              <MetricIf label="Completeness" value={Number.isFinite(Number(prop.dataCompleteness)) ? `${Math.round(Number(prop.dataCompleteness))}%` : null} />
              <MetricIf label="EV score" value={Number.isFinite(Number(prop.expectedValueScore)) ? `${Math.round(Number(prop.expectedValueScore))}/100` : null} />
              <MetricIf label="Volatility" value={Number.isFinite(Number(prop.volatilityScore)) ? `${Math.round(Number(prop.volatilityScore))}/100` : null} />
              <MetricIf label="Model prob" value={formatPercent(prop.modelProbability)} />
              <MetricIf label="EV (prob)" value={formatSignedPercent(prop.expectedValue)} />
              <MetricIf
                label="L5 / L10"
                value={
                  prop.last5HitRate != null || prop.last10HitRate != null || prop.recentHitRate != null
                    ? `${formatPercent(prop.last5HitRate)} / ${formatPercent(prop.last10HitRate || prop.recentHitRate)}`
                    : null
                }
              />
              <MetricIf label="Historical hit" value={prop.historicalHitRate == null ? null : formatPercent(prop.historicalHitRate)} />
              <MetricIf label="Sportsbook line" value={formatMaybeLine(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine)} />
              <MetricIf label="Line movement" value={lineMovementStatusText(prop) !== "No movement yet" ? lineMovementStatusText(prop) : null} />
              <MetricIf label="Matchup" value={prop.matchupRating && prop.matchupRating !== "Neutral" ? prop.matchupRating : null} />
              <MetricIf label="Injury/news" value={prop.injuryRisk && prop.injuryRisk !== "Low" ? prop.injuryRisk : null} />
              <MetricIf label="Sources" value={(dataSourcesUsed(prop) || []).join(", ") || null} />
            </div>
            ) : null}

            {!manualProp && !ready && (prop.lowConfidenceReasons || []).length > 0 && (
              <div style={{ ...styles.explanationBlock, marginTop: "8px" }}>
                <strong>Why not playable yet</strong>
                <ul style={styles.explanationList}>
                  {(prop.lowConfidenceReasons || []).slice(0, 4).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {!manualProp && prop.researchGaps?.length > 0 && (
              <div style={{ ...styles.explanationBlock, marginTop: "8px" }}>
                <strong>Research gaps</strong>
                <ul style={styles.explanationList}>
                  {prop.researchGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}

            {!manualProp && (prop.confidenceBreakdown?.length > 0 || prop.projectionReasoning?.length > 0) && (
              <details style={{ ...styles.compactDetails, marginTop: "8px" }}>
                <summary style={styles.detailsSummary}>Model breakdown</summary>
                <div style={{ marginTop: "6px" }}>
                  {(prop.projectionReasoning || []).length > 0 && (
                    <ul style={styles.explanationList}>
                      {(prop.projectionReasoning || []).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {(prop.confidenceBreakdown || []).length > 0 && (
                    <ul style={styles.explanationList}>
                      {(prop.confidenceBreakdown || []).slice(0, 6).map((row) => (
                        <li key={row.key}>{row.label}: {row.score}/{row.max}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            )}

            <div style={{ ...styles.explanationSections, marginTop: manualProp ? "4px" : "8px" }}>
              {!manualProp && explanation.slice(1).map((section) => (
                <div key={section.title} style={styles.explanationBlock}>
                  <strong>{section.title}</strong>
                  <ul style={styles.explanationList}>
                    {section.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {manualProp ? (
            <details style={{ ...styles.compactDetails, marginTop: "8px" }}>
              <summary style={styles.detailsSummary}>Manual stat boost</summary>
              <div style={{ ...styles.compactPanel, marginTop: "6px" }}>
                <div style={styles.controls}>
                  <label style={styles.selectLabel}>
                    Last 5 average
                    <input style={styles.textInput} type="number" step="0.1" value={manualDraft.last5Average} onChange={(e) => setManualDraft((c) => ({ ...c, last5Average: e.target.value }))} />
                  </label>
                  <label style={styles.selectLabel}>
                    Season average
                    <input style={styles.textInput} type="number" step="0.1" value={manualDraft.seasonAverage} onChange={(e) => setManualDraft((c) => ({ ...c, seasonAverage: e.target.value }))} />
                  </label>
                  <label style={{ ...styles.selectLabel, gridColumn: "1 / -1" }}>
                    Matchup context
                    <input style={styles.textInput} value={manualDraft.matchupNote} onChange={(e) => setManualDraft((c) => ({ ...c, matchupNote: e.target.value }))} />
                  </label>
                </div>
                <button type="button" style={{ ...styles.secondaryButton, marginTop: "8px" }} onClick={saveManualStats}>
                  Apply manual boost
                </button>
              </div>
            </details>
            ) : null}

            <div style={{ ...styles.evaluationText, marginTop: "8px", fontSize: "11px" }}>
              <p>{keyStatsSummary(prop)}</p>
              <p>{usageContextForProp(prop)}</p>
              {!ready ? <p>{prop.watchlistMessage || NO_EDGE_MESSAGE}</p> : null}
            </div>
          </div>
        </details>

        {onUpdateResult && (
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
        )}
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
