import type { StrategyManifest } from "@tradejs/types";
import { parseConfig } from "./config.js";
import { evaluateCombinedEntryPolicy } from "./combinedEntryPolicy.js";
export const rangeReclaimManifest: StrategyManifest = {
  name: "RangeReclaim",
  hooks: {
    beforeEntryGate: ({ ctx, decision, entry }) => {
      const config = parseConfig(ctx.strategyConfig);
      return evaluateCombinedEntryPolicy(
        config.RANGE_RECLAIM_ENTRY_POLICY,
        decision.signal ?? entry.signal,
      );
    },
  },
};
