import { resolveBoardDataQualityBadge } from "../utils/boardQuality.js";
import { dataBadgeStyle, styles } from "../theme/styles.js";

export default function DataQualityBadge({ prop, badge: badgeProp }) {
  const badge = badgeProp || (prop ? resolveBoardDataQualityBadge(prop) : null);
  if (!badge?.label) return null;
  return <span style={dataBadgeStyle(badge.tone)}>{badge.label}</span>;
}
