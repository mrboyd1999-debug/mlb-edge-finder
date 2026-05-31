import { memo } from "react";
import CompactApiHeader from "./CompactApiHeader.jsx";

/** Production header — refresh + optional debug toggle. */
function AppHeader(props) {
  return <CompactApiHeader {...props} />;
}

export default memo(AppHeader);
