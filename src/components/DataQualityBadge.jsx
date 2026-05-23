import { dataQualityBadge } from "../services/dataQuality.js";
import { dataBadgeStyle, styles } from "../theme/styles.js";

export default function DataQualityBadge({ prop, badge: badgeProp }) {
  const badge = badgeProp || prop?.dataQualityBadge || (prop ? dataQualityBadge(prop) : null);
  if (!badge?.label) return null;
  return <span style={dataBadgeStyle(badge.tone)}>{badge.label}</span>;
}
