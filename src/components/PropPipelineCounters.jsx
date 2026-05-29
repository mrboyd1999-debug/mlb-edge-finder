import { memo } from "react";

function PropPipelineCounters({ counts = null }) {
  if (!counts) return null;
  const {
    fetched = 0,
    normalized = 0,
    rendered = 0,
    filteredOut = 0,
    withProjections = 0,
    verified = 0,
    filteredMissingProjection = 0,
    filteredLowConfidence = 0,
    filteredWeakEdge = 0,
  } = counts;
  const hasBestPlaysAudit =
    filteredMissingProjection + filteredLowConfidence + filteredWeakEdge > 0;
  return (
    <p className="prop-pipeline-counters" aria-label="Prop pipeline counts">
      Props: {fetched} fetched · {normalized} normalized · {withProjections} with projections · {verified}{" "}
      verified · {rendered} rendered · {filteredOut} filtered out
      {hasBestPlaysAudit ? (
        <>
          {" "}
          · Best Plays: {filteredMissingProjection} missing projection · {filteredLowConfidence} low confidence ·{" "}
          {filteredWeakEdge} weak edge
        </>
      ) : null}
    </p>
  );
}

export default memo(PropPipelineCounters);
