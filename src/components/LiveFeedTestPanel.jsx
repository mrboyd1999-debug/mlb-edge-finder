import { memo, useCallback, useState } from "react";
import { testPrizePicksFeedProbe, testUnderdogFeedProbe } from "../services/liveFeedProbe.js";
import { LIVE_STAGE_LABELS } from "../utils/liveFeedFailureAnalysis.js";

function ResultBlock({ title, result = null }) {
  if (!result) return null;
  return (
    <div className="live-feed-test__result">
      <strong>{title}</strong>
      <p>
        Status: <strong>{result.status}</strong>
        {result.failure?.label ? ` · ${result.failure.label}` : ""}
      </p>
      <p>
        HTTP: {result.httpStatus ?? "—"} · {result.responseBytes ?? 0} bytes ·{" "}
        {result.responseTimeMs ?? 0} ms · props: {result.propCount ?? 0}
      </p>
      <p className="live-feed-test__endpoint">{result.endpoint || "—"}</p>
      {result.endpointDeprecated ? (
        <p className="live-feed-test__warn" role="alert">
          Endpoint deprecated
        </p>
      ) : null}
      {result.message ? <p className="live-feed-test__error">{result.message}</p> : null}
      <div className="live-feed-test__stages">
        {Object.values(LIVE_STAGE_LABELS).map((stage) => (
          <span key={stage}>
            {stage}: <strong>{result.stages?.[stage] ?? 0}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function LiveFeedTestPanel() {
  const [ppLoading, setPpLoading] = useState(false);
  const [udLoading, setUdLoading] = useState(false);
  const [ppResult, setPpResult] = useState(null);
  const [udResult, setUdResult] = useState(null);

  const runPrizePicks = useCallback(async () => {
    setPpLoading(true);
    try {
      const result = await testPrizePicksFeedProbe();
      setPpResult(result);
      console.log("[Live Feed Test] PrizePicks", result);
    } finally {
      setPpLoading(false);
    }
  }, []);

  const runUnderdog = useCallback(async () => {
    setUdLoading(true);
    try {
      const result = await testUnderdogFeedProbe();
      setUdResult(result);
      console.log("[Live Feed Test] Underdog", result);
    } finally {
      setUdLoading(false);
    }
  }, []);

  return (
    <section className="live-feed-test" aria-label="Live feed test probes">
      <div className="live-feed-test__head">
        <strong>Live Feed Tests</strong>
        <span className="live-feed-test__hint">Isolated HTTP probe — does not run board pipeline</span>
      </div>
      <div className="live-feed-test__actions">
        <button type="button" className="live-feed-test__btn" disabled={ppLoading} onClick={runPrizePicks}>
          {ppLoading ? "Testing PrizePicks…" : "Test PrizePicks Fetch"}
        </button>
        <button type="button" className="live-feed-test__btn" disabled={udLoading} onClick={runUnderdog}>
          {udLoading ? "Testing Underdog…" : "Test Underdog Fetch"}
        </button>
      </div>
      <ResultBlock title="PrizePicks probe" result={ppResult} />
      <ResultBlock title="Underdog probe" result={udResult} />
    </section>
  );
}

export default memo(LiveFeedTestPanel);
