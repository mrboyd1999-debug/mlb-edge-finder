/**
 * Phase 2 — MLB-only projection engine facade.
 * NBA/NFL engines will register here in Phase 3; not implemented yet.
 */
export {
  buildRealProjection,
  formatProjectionBreakdownSummary,
  hasRealStatInputs,
  projectMlbHitterProp,
  projectMlbPitcherStrikeouts,
} from "../services/realProjectionEngine.js";

/** Phase 3 hook: sport-specific engines register here. MLB only for now. */
export const PROJECTION_ENGINES = {
  MLB: {
    pitcherMarkets: ["strikeouts", "outs", "pitchesThrown"],
    projectPitcher: (prop, profile, context) =>
      import("../services/realProjectionEngine.js").then((m) => m.projectMlbPitcherStrikeouts(prop, profile, context)),
    projectHitter: (prop, profile, context) =>
      import("../services/realProjectionEngine.js").then((m) => m.projectMlbHitterProp(prop, profile, context)),
  },
};
