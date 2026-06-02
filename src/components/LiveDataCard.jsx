import { memo } from "react";
import ProviderFeedModeBanner from "./ProviderFeedModeBanner.jsx";

/** Live data availability + compact provider status row. */
function LiveDataCard(props) {
  return <ProviderFeedModeBanner {...props} />;
}

export default memo(LiveDataCard);
