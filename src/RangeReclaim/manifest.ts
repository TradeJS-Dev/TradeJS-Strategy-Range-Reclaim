import { isLowLowShort } from "./lowLowShort.js";
import type { StrategyManifest } from "@tradejs/types";
import { parseConfig } from "./config.js";
import { evaluateCombinedEntryPolicy } from "./combinedEntryPolicy.js";
const contextRequirements = {
  // Older hosts know only the core field; current hosts also resolve the profile.
  core: [],
  tickerProfiles: {
    provider: "bybit",
    universeId: "range-reclaim-frozen577-20261111",
  },
};

export const rangeReclaimManifest: StrategyManifest = {
  name: "RangeReclaim",
  contextRequirements,
  hooks: {
    beforeEntryGate: ({ ctx, decision, entry }) => {
      const config = parseConfig(ctx.strategyConfig);
      const signal = decision.signal ?? entry.signal;
      const expanded =
        config.RANGE_RECLAIM_ENTRY_POLICY === "intersection-low-low-short";
      const baseline = evaluateCombinedEntryPolicy(
        expanded ? "intersection" : config.RANGE_RECLAIM_ENTRY_POLICY,
        signal,
      );
      if (expanded && !baseline.allow && isLowLowShort(signal))
        return { allow: true, reason: "RANGE_RECLAIM_LOW_LOW_SHORT_ALLOW" };
      return baseline;
    },
  },
};
