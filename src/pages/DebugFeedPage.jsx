import { useCallback, useEffect, useState } from "react";
import { fetchPrizePicksProps } from "../services/prizepicks.js";
import { fetchUnderdogProps } from "../services/underdog.js";
import { getDebugFeedEvidence } from "../utils/feedHardEvidence.js";

function Row({ label, value }) {
  return (
    <p>
      {label}: {value ?? "—"}
    </p>
  );
}

function ProviderBlock({ title, data = null }) {
  if (!data) {
    return (
      <section>
        <h2>{title}</h2>
        <p>No evidence yet — run live fetch.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>{title}</h2>
      <Row label="URL" value={data.url} />
      <Row label="Status" value={data.httpStatus} />
      <Row label="Response size" value={data.responseSize} />
      <Row label="FETCH SUCCESS?" value={String(Boolean(data.fetchSuccess))} />
      <Row label="PARSE SUCCESS?" value={String(Boolean(data.parseSuccess))} />
      <Row label="NORMALIZE SUCCESS?" value={String(Boolean(data.normalizeSuccess))} />
      <Row label="FILTER SUCCESS?" value={String(Boolean(data.filterSuccess))} />
      <Row label="Raw count" value={data.counts?.raw} />
      <Row label="Parsed count" value={data.counts?.parsed} />
      <Row label="Normalized count" value={data.counts?.normalized} />
      <Row label="Filtered count" value={data.counts?.filtered} />
      {data.error ? <pre>{data.error}</pre> : null}
      {data.errorStack ? <pre>{data.errorStack}</pre> : null}
      {data.bodyPreview ? <pre>{data.bodyPreview}</pre> : null}
    </section>
  );
}

export default function DebugFeedPage() {
  const [evidence, setEvidence] = useState(() => getDebugFeedEvidence());
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  const run = useCallback(async () => {
    setRunning(true);
    setRunError("");
    try {
      await fetchPrizePicksProps({ sport: "MLB", statType: "all" });
    } catch (error) {
      console.error("DebugFeed PrizePicks run failed", error);
    }
    try {
      await fetchUnderdogProps({ sport: "MLB", statType: "all" });
    } catch (error) {
      console.error("DebugFeed Underdog run failed", error);
    }
    setEvidence(getDebugFeedEvidence());
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main>
      <h1>/debug-feed</h1>
      <p>Temporary live ingestion proof page. Open browser console for PP/UD logs.</p>
      <button type="button" onClick={run} disabled={running}>
        {running ? "Running…" : "Run live fetches"}
      </button>
      {runError ? <pre>{runError}</pre> : null}
      <ProviderBlock title="PrizePicks" data={evidence.prizepicks} />
      <ProviderBlock title="Underdog" data={evidence.underdog} />
    </main>
  );
}
