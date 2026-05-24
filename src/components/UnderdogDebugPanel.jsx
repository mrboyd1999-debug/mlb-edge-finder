import { styles } from "../theme/styles.js";
import { UNDERDOG_PARSER_MISMATCH_MESSAGE } from "../utils/parseUnderdogProp.js";

export default function UnderdogDebugPanel({ snapshot = null }) {
  if (!snapshot) {
    return (
      <div className="underdog-debug-panel" style={{ ...styles.compactPanel, marginTop: "10px", padding: "10px 12px" }}>
        <strong style={{ fontSize: 13 }}>Underdog Debug</strong>
        <p style={{ ...styles.compactFlags, margin: "6px 0 0" }}>No Underdog feed data yet — refresh the board.</p>
      </div>
    );
  }

  const parser = snapshot.parserDiagnostics || {};
  const mismatch = snapshot.parserMismatch || (snapshot.rawUdCount > 0 && snapshot.parsedUdCount === 0);

  return (
    <div className="underdog-debug-panel" style={{ ...styles.compactPanel, marginTop: "10px", padding: "10px 12px" }}>
      <strong style={{ fontSize: 13 }}>Underdog Debug</strong>
      {mismatch ? (
        <p style={{ ...styles.compactFlags, margin: "6px 0 0", color: "#fca5a5", fontWeight: 700 }}>
          {UNDERDOG_PARSER_MISMATCH_MESSAGE}
        </p>
      ) : null}
      <div style={{ marginTop: "8px", display: "grid", gap: "4px" }}>
        <span style={styles.compactFlags}>API status: {snapshot.apiStatus ?? "—"}</span>
        <span style={styles.compactFlags}>Raw UD props count: {snapshot.rawUdCount ?? 0}</span>
        <span style={styles.compactFlags}>Parsed UD props count: {snapshot.parsedUdCount ?? 0}</span>
        <span style={styles.compactFlags}>MLB UD props: {snapshot.sportCounts?.MLB ?? snapshot.mlbUdCount ?? 0}</span>
        <span style={styles.compactFlags}>NBA UD props: {snapshot.sportCounts?.NBA ?? 0}</span>
        <span style={styles.compactFlags}>WNBA UD props: {snapshot.sportCounts?.WNBA ?? 0}</span>
        <span style={styles.compactFlags}>NHL UD props: {snapshot.sportCounts?.NHL ?? 0}</span>
        <span style={styles.compactFlags}>Soccer UD props: {snapshot.sportCounts?.Soccer ?? 0}</span>
        <span style={styles.compactFlags}>Tennis UD props: {snapshot.sportCounts?.Tennis ?? 0}</span>
        <span style={styles.compactFlags}>Selected sport: {snapshot.selectedSport ?? "MLB"}</span>
        <span style={styles.compactFlags}>Selected category: {snapshot.selectedCategory ?? "all"}</span>
        <span style={styles.compactFlags}>Eligible Underdog (sport + category): {snapshot.eligibleUnderdogCount ?? 0}</span>
        <span style={styles.compactFlags}>Rejected wrong sport: {snapshot.rejectedWrongSport ?? 0}</span>
        <span style={styles.compactFlags}>Rejected wrong category: {snapshot.rejectedWrongCategory ?? 0}</span>
        <span style={styles.compactFlags}>Rejected invalid prop: {snapshot.rejectedInvalidProp ?? 0}</span>
        <span style={styles.compactFlags}>Streak eligible MLB UD props: {snapshot.streakEligibleCount ?? 0}</span>
        <span style={styles.compactFlags}>Parser accepted: {parser.acceptedCount ?? snapshot.parsedUdCount ?? 0}</span>
        <span style={styles.compactFlags}>Parser rejected: {parser.rejectedCount ?? 0}</span>
      </div>
      {Object.keys(parser.rejectionReasons || {}).length ? (
        <details style={{ marginTop: "8px" }}>
          <summary style={{ ...styles.compactFlags, cursor: "pointer" }}>Parser rejection reasons</summary>
          <pre
            style={{
              margin: "6px 0 0",
              padding: "8px",
              borderRadius: "6px",
              background: "#0b1220",
              border: "1px solid #1e293b",
              fontSize: "10px",
              lineHeight: 1.4,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(parser.rejectionReasons, null, 2)}
          </pre>
        </details>
      ) : null}
      {Object.keys(snapshot.curatedRejectionReasons || {}).length ? (
        <details style={{ marginTop: "8px" }}>
          <summary style={{ ...styles.compactFlags, cursor: "pointer" }}>Curated rejection reasons</summary>
          <pre
            style={{
              margin: "6px 0 0",
              padding: "8px",
              borderRadius: "6px",
              background: "#0b1220",
              border: "1px solid #1e293b",
              fontSize: "10px",
              lineHeight: 1.4,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(snapshot.curatedRejectionReasons, null, 2)}
          </pre>
        </details>
      ) : null}
      <details style={{ marginTop: "8px" }}>
        <summary style={{ ...styles.compactFlags, cursor: "pointer" }}>First 3 UD props JSON preview</summary>
        <pre
          style={{
            margin: "6px 0 0",
            padding: "8px",
            borderRadius: "6px",
            background: "#0b1220",
            border: "1px solid #1e293b",
            fontSize: "10px",
            lineHeight: 1.4,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(snapshot.rawPreview || snapshot.preview || [], null, 2)}
        </pre>
      </details>
      {snapshot.parsedPreview?.length ? (
        <details open style={{ marginTop: "8px" }}>
          <summary style={{ ...styles.compactFlags, cursor: "pointer" }}>First 5 parsed Underdog props (sport inference)</summary>
          <div style={{ marginTop: "6px", display: "grid", gap: "6px" }}>
            {snapshot.parsedPreview.map((row) => (
              <div
                key={row.id || row.player}
                style={{
                  padding: "6px 8px",
                  borderRadius: "6px",
                  background: "#0b1220",
                  border: "1px solid #1e293b",
                  fontSize: "10px",
                  lineHeight: 1.45,
                }}
              >
                <div>
                  <strong>{row.player}</strong> · {row.statType} · line {row.line}
                </div>
                <div>Raw sport: {row.rawSport || "—"}</div>
                <div>Inferred sport: {row.inferredSport || "—"}</div>
                <div>Why: {row.sportInferenceReason || "—"}</div>
                <div>Tab: {snapshot.selectedSport ?? "MLB"} · Category: {snapshot.selectedCategory ?? "all"}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
