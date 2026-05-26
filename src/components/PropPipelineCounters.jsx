import { memo } from "react";

function PropPipelineCounters({ counts = null }) {
  if (!counts) return null;
  const { fetched = 0, normalized = 0, rendered = 0, filteredOut = 0 } = counts;
  return (
    <p className="prop-pipeline-counters" aria-label="Prop pipeline counts">
      Props: {fetched} fetched · {normalized} normalized · {rendered} rendered · {filteredOut} filtered out
    </p>
  );
}

export default memo(PropPipelineCounters);
