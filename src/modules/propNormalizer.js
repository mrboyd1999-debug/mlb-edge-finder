/**
 * Prop normalization facade — single import for shape + market canonicalization.
 */
export {
  normalizeUnifiedProp,
  normalizeUnifiedProps,
} from "../utils/unifiedPropNormalizer.js";

export {
  slimPropForUi,
} from "../utils/renderProp.js";

export {
  canonicalMarketKey,
  resolvePropMarketKey,
  normalizeMarketStatType,
  marketDisplayLabel,
} from "../utils/marketNormalization.js";
