import { memo } from "react";

function FailureRow({ provider, reason, tone = "error" }) {
  if (!reason) return null;
  return (
    <p className={`provider-failure-reasons__row provider-failure-reasons__row--${tone}`}>
      <strong>{provider}:</strong> {reason}
    </p>
  );
}

function ProviderFailureReasons({ audit = null }) {
  const ppReason = audit?.prizepicksFailureReason;
  const udReason = audit?.underdogFailureReason;
  const cacheNote = audit?.cacheBoardMessage;

  if (!ppReason && !udReason && !cacheNote) return null;

  return (
    <section className="provider-failure-reasons" aria-label="Provider fetch failures">
      <FailureRow provider="PrizePicks" reason={ppReason} />
      <FailureRow provider="Underdog" reason={udReason} />
      {cacheNote ? <p className="provider-failure-reasons__cache">{cacheNote}</p> : null}
    </section>
  );
}

export default memo(ProviderFailureReasons);
