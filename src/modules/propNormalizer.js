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
  normalizeMarketStatType,
  marketDisplayLabel,
} from "../utils/marketNormalization.js";
