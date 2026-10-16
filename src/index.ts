import { defineStrategyPlugin } from "@tradejs/core/config";
import { rangeReclaimStrategy } from "./RangeReclaim/strategy.js";
export const STRATEGY_NAME = "RangeReclaim";
export const strategyEntries = defineStrategyPlugin({
  strategyEntries: [rangeReclaimStrategy],
}).strategyEntries;
export default defineStrategyPlugin({ strategyEntries });
export { defaultConfig, parseConfig } from "./RangeReclaim/config.js";
export type { RangeReclaimConfig } from "./RangeReclaim/config.js";
export { createRangeReclaimEngine } from "./RangeReclaim/engine.js";
export type {
  EngineState,
  ReclaimSignal,
  SourceRange,
} from "./RangeReclaim/engine.js";
export { createRangeReclaimCore } from "./RangeReclaim/core.js";
export { buildRangeReclaimFigures } from "./RangeReclaim/figures.js";
