import { memo } from "react";
import {
  formatPipelineDisplayValue,
  resolveMlbPipelineFailureView,
} from "../utils/mlbPipelineFailureDisplay.js";

const ROW_STYLE = {
  margin: 0,
  fontSize: "11px",
  lineHeight: 1.45,
  color: "#fca5a5",
};

const LABEL_STYLE = {
  color: "#f87171",
  fontWeight: 800,
  letterSpacing: "0.03em",
};

const WRAP_STYLE = {
  marginTop: "6px",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #7f1d1d",
  background: "#1a0f0f",
  display: "grid",
  gap: "3px",
};

function Row({ label, value }) {
  return (
    <p style={ROW_STYLE}>
      <span style={LABEL_STYLE}>{label}: </span>
      <span style={{ color: "#fecaca", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{value}</span>
    </p>
  );
}

function MlbPipelineFailureBlock({ prop }) {
  const view = resolveMlbPipelineFailureView(prop);
  if (!view.show) return null;

  return (
    <div className="mlb-pipeline-failure-block" style={WRAP_STYLE} data-failure-code={view.failureReason}>
      <Row label="Failure reason" value={view.failureReason} />
      <Row label="Last successful stage" value={formatPipelineDisplayValue("lastSuccessfulStage", view.lastSuccessfulStage)} />
      <Row label="Normalized name" value={formatPipelineDisplayValue("normalizedName", view.normalizedName)} />
      <Row label="Matched player" value={formatPipelineDisplayValue("matchedPlayer", view.matchedPlayer)} />
      <Row label="Player ID" value={formatPipelineDisplayValue("playerId", view.playerId)} />
      <Row label="Logs count" value={formatPipelineDisplayValue("logsCount", view.logsCount)} />
      {view.apiStatusCode != null ? (
        <Row label="API status code" value={formatPipelineDisplayValue("apiStatusCode", view.apiStatusCode)} />
      ) : null}
      {view.detailReason && view.detailReason !== view.failureReason ? (
        <Row label="Detail" value={view.detailReason} />
      ) : null}
    </div>
  );
}

export default memo(MlbPipelineFailureBlock);
