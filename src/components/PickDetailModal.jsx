import { useEffect, useState } from "react";
import { dataQualityBadge } from "../services/dataQuality.js";
import { buildPickExplanation, propPayoutLabel } from "../services/projectionEngine.js";
import { isReadyToBet, READY_MIN_CONFIDENCE, READY_MIN_DATA_QUALITY, PROJECTION_CONFIDENCE_THRESHOLDS } from "../services/pickScoring.js";
import { readManualStatsForProp } from "../services/pickStore.js";
import DataQualityBadge from "./DataQualityBadge.jsx";
import PlayerImage from "./PlayerImage.jsx";
import { confidenceTier } from "../utils/propLabels.js";
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
import { styles, riskStyle, tierStyle } from "../theme/styles.js";

const NO_EDGE_MESSAGE = "No betting edge detected. More data needed before this becomes a confident pick.";
const STREAK_WARNING = "Low multiplier does not guarantee the pick will hit. Verify before adding to streak.";

function Metric({ label, value, strong = false }) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={strong ? styles.metricValueStrong : styles.metricValue}>{value}</strong>
    </div>
  );
}

export default function PickDetailModal({ prop, onClose, onUpdateResult, onSaveManualStats, onSavePick }) {
  const lean = formatLeanSide(prop.bestPick || prop.side || "Watch");
  const ready = isReadyToBet(prop);
  const tier = confidenceTier(prop);
  const badge = prop.dataQualityBadge || dataQualityBadge(prop);
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

  return (
    <div style={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        style={styles.modalPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`${prop.playerName} evaluation`}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div style={styles.modalPlayer}>
            <PlayerImage prop={prop} large />
            <div>
              <p style={styles.platform}>{prop.platform}</p>
              <h2 style={styles.modalTitle}>{prop.playerName}</h2>
              <p style={styles.gameLine}>
                {displaySport(prop)} · {prop.team || "—"} vs {prop.opponent || "—"}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {onSavePick ? (
              <button type="button" style={styles.secondaryButton} onClick={() => onSavePick(prop)}>
                Save this pick
              </button>
            ) : null}
            <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close evaluation">
              ✕ Close
            </button>
          </div>
        </div>

        <div style={styles.tagRow}>
          <span style={tierStyle(tier)}>{tier}</span>
          <span style={riskStyle(prop.riskLevel)}>{prop.riskLevel || "Medium"}</span>
          <span style={ready ? styles.segmentActive : styles.segment}>{ready ? "Ready to Bet" : "Research only"}</span>
          <DataQualityBadge badge={badge} />
          {prop.statsMissingBadge?.label ? <span style={styles.valueTag}>{prop.statsMissingBadge.label}</span> : null}
          {prop.researchMissingBadge?.label && prop.researchMissingBadge.label !== prop.statsMissingBadge?.label ? (
            <span style={styles.valueTag}>{prop.researchMissingBadge.label}</span>
          ) : null}
          {(prop.payoutLabel || propPayoutLabel(prop)) !== "standard" && (
            <span style={styles.valueTag}>{prop.payoutLabel || propPayoutLabel(prop)}</span>
          )}
        </div>

        <div style={styles.modalGrid}>
          <Metric label="Prop" value={prop.statType} />
          <Metric label="Line" value={formatNumber(prop.line)} strong />
          <Metric label="Lean" value={ready ? lean : "Research"} strong />
          <Metric label="Confidence" value={`${prop.confidenceScore ?? "—"}%`} strong />
          <Metric
            label="Calibrated confidence"
            value={prop.calibratedConfidence != null ? `${prop.calibratedConfidence}%` : "—"}
            strong={Boolean(prop.calibratedConfidence && prop.calibratedConfidence !== prop.confidenceScore)}
          />
          <Metric label="Data quality" value={`${prop.dataQualityScore ?? "—"}/100`} />
          <Metric label="Completeness" value={`${prop.dataCompleteness ?? "—"}%`} />
          <Metric label="Edge score" value={prop.edgeScore ?? prop.edgeRating ?? "—"} strong />
          <Metric
            label="Projection"
            value={
              prop.projectedValue != null
                ? formatNumber(prop.projectedValue)
                : prop.projection == null
                  ? "Needs stats"
                  : formatNumber(prop.projection)
            }
          />
          <Metric label="Sportsbook line" value={formatMaybeLine(prop.sportsbookLine ?? prop.sportsbookComparison?.marketAverageLine)} />
          <Metric label="Stat edge" value={formatSignedNumber(prop.edge)} strong />
          <Metric label="Edge %" value={formatSignedPercent(edgePercentForProp(prop) != null ? edgePercentForProp(prop) / 100 : null)} />
          <Metric label="Risk level" value={prop.riskLevel || "Medium"} />
          <Metric label="Model prob" value={formatPercent(prop.modelProbability)} />
          <Metric label="EV (prob)" value={formatSignedPercent(prop.expectedValue)} />
          <Metric label="EV score" value={Number.isFinite(Number(prop.expectedValueScore)) ? `${Math.round(Number(prop.expectedValueScore))}/100` : "—"} strong />
          <Metric label="Volatility score" value={Number.isFinite(Number(prop.volatilityScore)) ? `${Math.round(Number(prop.volatilityScore))}/100` : "—"} />
          <Metric label="Line value score" value={Number.isFinite(Number(prop.lineValueScore)) ? `${Math.round(Number(prop.lineValueScore))}/100` : "—"} />
          <Metric label="Decision rank" value={Number.isFinite(Number(prop.decisionRankScore)) ? formatNumber(prop.decisionRankScore) : "—"} />
          <Metric label="L5 / L10" value={`${formatPercent(prop.last5HitRate)} / ${formatPercent(prop.last10HitRate || prop.recentHitRate)}`} />
          <Metric label="Historical hit" value={prop.historicalHitRate == null ? "—" : formatPercent(prop.historicalHitRate)} />
          <Metric
            label="Market hit rate"
            value={
              prop.marketHistoricalHitRate == null
                ? "—"
                : `${formatPercent(prop.marketHistoricalHitRate)} (${prop.marketHistoricalSample || 0})`
            }
          />
          <Metric label="Line movement trust" value={prop.lineMovementTrustLabel || "—"} />
          <Metric label="Matchup" value={prop.matchupRating || "Neutral"} />
          <Metric label="Injury/news" value={prop.injuryRisk || "Low"} />
          <Metric label="Opening line" value={formatMaybeLine(prop.lineMovement?.openingLine)} />
          <Metric label="Current line" value={formatMaybeLine(prop.lineMovement?.currentLine ?? prop.line)} />
          <Metric label="Movement" value={lineMovementStatusText(prop)} />
          <Metric label="Sources" value={dataSourcesUsed(prop).join(", ") || "—"} />
          <Metric label="Risks" value={riskExplanation(prop)} />
          <Metric label="Flags" value={warningFlags(prop).join(", ") || "None"} />
          <Metric label="Start" value={formatDateTime(prop.startTime)} />
        </div>

        {prop.qualificationReason ? (
          <div style={styles.explanationBlock}>
            <strong>Why this pick qualifies</strong>
            <p style={styles.compactFlags}>{prop.qualificationReason}</p>
          </div>
        ) : null}

        {prop.bookDisagreement?.summary ? (
          <div style={styles.explanationBlock}>
            <strong>Book disagreement</strong>
            <p style={styles.compactFlags}>{prop.bookDisagreement.summary}</p>
          </div>
        ) : null}

        {!ready && (prop.lowConfidenceReasons || []).length > 0 && (
          <div style={styles.explanationBlock}>
            <strong>Why confidence is low</strong>
            <ul style={styles.explanationList}>
              {(prop.lowConfidenceReasons || []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p style={styles.compactFlags}>
              Ready to Bet needs confidence ≥ {READY_MIN_CONFIDENCE}, data quality ≥ {READY_MIN_DATA_QUALITY}, positive edge, and valid fields.
            </p>
          </div>
        )}

        {((prop.confidenceBreakdown || []).length > 0 || (prop.projectionReasoning || []).length > 0) && (
          <details style={styles.compactDetails} open>
            <summary style={styles.detailsSummary}>
              <span>
                <span style={styles.eyebrow}>Model</span>
                <strong>Projection &amp; confidence details</strong>
              </span>
              <span style={styles.countPill}>{prop.confidenceScore ?? "—"}% conf</span>
            </summary>
            <div style={{ ...styles.compactPanel, marginTop: "8px" }}>
              {(prop.projectionReasoning || []).length > 0 && (
                <div style={styles.explanationBlock}>
                  <strong>Stat projection reasoning</strong>
                  <ul style={styles.explanationList}>
                    {(prop.projectionReasoning || []).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(prop.confidenceBreakdown || []).length > 0 && (
                <div style={styles.explanationBlock}>
                  <strong>Confidence breakdown ({prop.confidenceScore ?? "—"}% total)</strong>
                  <ul style={styles.explanationList}>
                    {(prop.confidenceBreakdown || []).map((row) => (
                      <li key={row.key}>
                        {row.label}: {row.score}/{row.max} — {row.detail}
                      </li>
                    ))}
                  </ul>
                  <p style={styles.compactFlags}>
                    Top Picks need ≥ {PROJECTION_CONFIDENCE_THRESHOLDS.TOP_PICKS}% · Ready to Bet needs ≥ {PROJECTION_CONFIDENCE_THRESHOLDS.READY}%.
                  </p>
                </div>
              )}
            </div>
          </details>
        )}

        {prop.statsMissingExplanation ? (
          <div style={styles.explanationBlock}>
            <strong>Stats missing</strong>
            <p style={styles.compactFlags}>{prop.statsMissingExplanation}</p>
          </div>
        ) : null}

        {prop.researchGaps?.length > 0 && (
          <div style={styles.explanationBlock}>
            <strong>Research gaps</strong>
            <ul style={styles.explanationList}>
              {prop.researchGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        )}

        {(prop.lineComparison || prop.sportsbookComparison) && (
          <div style={styles.comparisonBox}>
            {prop.lineComparison && <span>PP: {formatMaybeLine(prop.lineComparison.prizePicksLine)}</span>}
            {prop.lineComparison && <span>UD: {formatMaybeLine(prop.lineComparison.underdogLine)}</span>}
            {prop.sportsbookComparison && <span>Books avg: {formatMaybeLine(prop.sportsbookComparison.marketAverageLine)}</span>}
          </div>
        )}

        <div style={styles.explanationSections}>
          {explanation.map((section) => (
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

        <details style={styles.compactDetails}>
          <summary style={styles.detailsSummary}>
            <span>
              <span style={styles.eyebrow}>Boost</span>
              <strong>Manual Stat Boost</strong>
            </span>
            <span style={styles.countPill}>recalculates DQ</span>
          </summary>
          <div style={{ ...styles.compactPanel, marginTop: "8px" }}>
          <div style={styles.controls}>
            <label style={styles.selectLabel}>
              Last 5 average
              <input
                style={styles.textInput}
                type="number"
                step="0.1"
                value={manualDraft.last5Average}
                onChange={(e) => setManualDraft((c) => ({ ...c, last5Average: e.target.value }))}
              />
            </label>
            <label style={styles.selectLabel}>
              Season average
              <input
                style={styles.textInput}
                type="number"
                step="0.1"
                value={manualDraft.seasonAverage}
                onChange={(e) => setManualDraft((c) => ({ ...c, seasonAverage: e.target.value }))}
              />
            </label>
            <label style={styles.selectLabel}>
              Opponent allowed avg
              <input
                style={styles.textInput}
                type="number"
                step="0.1"
                value={manualDraft.opponentAllowed}
                onChange={(e) => setManualDraft((c) => ({ ...c, opponentAllowed: e.target.value }))}
              />
            </label>
            <label style={styles.selectLabel}>
              Opponent rank
              <input
                style={styles.textInput}
                type="number"
                step="1"
                value={manualDraft.opponentRank}
                onChange={(e) => setManualDraft((c) => ({ ...c, opponentRank: e.target.value }))}
              />
            </label>
            <label style={styles.selectLabel}>
              Confidence +/-
              <input
                style={styles.textInput}
                type="number"
                step="1"
                min="-15"
                max="15"
                value={manualDraft.confidenceAdjustment}
                onChange={(e) => setManualDraft((c) => ({ ...c, confidenceAdjustment: e.target.value }))}
                placeholder="-15 to +15"
              />
            </label>
            <label style={styles.selectLabel}>
              Matchup context
              <input
                style={styles.textInput}
                value={manualDraft.matchupNote}
                onChange={(e) => setManualDraft((c) => ({ ...c, matchupNote: e.target.value }))}
                placeholder="e.g. weak returner, tough defense"
              />
            </label>
            <label style={styles.selectLabel}>
              Minutes / role note
              <input
                style={styles.textInput}
                value={manualDraft.minutesNote}
                onChange={(e) => setManualDraft((c) => ({ ...c, minutesNote: e.target.value }))}
                placeholder="e.g. 32 min avg, stable role"
              />
            </label>
            <label style={styles.selectLabel}>
              Pitch count note
              <input
                style={styles.textInput}
                value={manualDraft.pitchCountNote}
                onChange={(e) => setManualDraft((c) => ({ ...c, pitchCountNote: e.target.value }))}
                placeholder="e.g. 95 pitches last start"
              />
            </label>
            <label style={{ ...styles.selectLabel, gridColumn: "1 / -1" }}>
              Injury / news note
              <input
                style={styles.textInput}
                value={manualDraft.injuryNote}
                onChange={(e) => setManualDraft((c) => ({ ...c, injuryNote: e.target.value }))}
                placeholder="e.g. questionable, minutes limit"
              />
            </label>
          </div>
          <button type="button" style={{ ...styles.secondaryButton, marginTop: "8px" }} onClick={saveManualStats}>
            Apply manual stat boost & recalculate
          </button>
          </div>
        </details>

        <div style={styles.evaluationText}>
          <strong>Why this pick</strong>
          <p>{keyStatsSummary(prop)}</p>
          <p>{usageContextForProp(prop)}</p>
          <p>{ready ? prop.reasoningSummary : prop.watchlistMessage || NO_EDGE_MESSAGE}</p>
          {prop.side && <p>{STREAK_WARNING}</p>}
        </div>

        {onUpdateResult && (
          <div style={{ ...styles.resultButtons, marginTop: "12px" }}>
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
