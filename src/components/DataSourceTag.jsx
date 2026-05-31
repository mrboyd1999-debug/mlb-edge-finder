import { memo } from "react";
import { formatDataSourceLabel, resolvePropDataSourceTag } from "../utils/renderDataSourceAudit.js";

function DataSourceTag({ prop = null, tag = "", cacheStatus = "", compact = false }) {
  const resolved =
    tag ||
    prop?.dataSourceTag ||
    (prop ? resolvePropDataSourceTag(prop, { cacheStatus }) : "");
  const label = formatDataSourceLabel(resolved);
  if (!label) return null;
  return (
    <span className={`data-source-tag${compact ? " data-source-tag--compact" : ""}`} data-source={label}>
      Data Source: {label}
    </span>
  );
}

export default memo(DataSourceTag);
