import { memo } from "react";

function AttemptRow({ attempt }) {
  if (!attempt) return null;
  return (
    <div style={{ fontSize: 11, marginTop: 6, opacity: 0.92 }}>
      <div>
        <strong>{attempt.provider}</strong> · {attempt.endpoint || "—"}
      </div>
      <div>
        {attempt.ok ? "success" : "failed"} · count {attempt.responseCount ?? "—"}
        {attempt.statusCode != null ? ` · HTTP ${attempt.statusCode}` : ""}
      </div>
      {attempt.error ? <div style={{ color: "#fecaca" }}>{attempt.error}</div> : null}
    </div>
  );
}

function ProjectionProviderWarning({ status = null }) {
  const statsFailed = Boolean(status?.statsEnrichmentFailed);
  if (!status?.unavailable && !statsFailed) return null;

  const title = statsFailed
    ? "MLB projection stats failed to load"
    : "Projection provider unavailable";

  return (
    <div
      role="alert"
      style={{
        margin: "12px 0",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(248, 113, 113, 0.55)",
        background: "rgba(127, 29, 29, 0.35)",
        color: "#fecaca",
      }}
    >
      <div style={{ fontWeight: 700, color: "#fca5a5", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>{status.reason || "No real player projections were returned."}</div>
      <div style={{ fontSize: 12, marginTop: 8, color: "#fda4af" }}>
        Stats profiles: {status.statsMapSize ?? 0} · with projection: {status.withProfileProjection ?? 0} · season rows:{" "}
        {status.seasonStatRows ?? 0} · merged: {status.mergedWithProjection ?? 0}
      </div>
      {!status.sportsDataConfigured ? (
        <div style={{ fontSize: 12, marginTop: 6, color: "#fde68a" }}>
          SportsDataIO key is not configured. Add it in Settings to enable season-stat projections.
        </div>
      ) : null}
      {(status.attempts || []).slice(-3).map((attempt) => (
        <AttemptRow key={`${attempt.provider}-${attempt.at}`} attempt={attempt} />
      ))}
    </div>
  );
}

export default memo(ProjectionProviderWarning);
