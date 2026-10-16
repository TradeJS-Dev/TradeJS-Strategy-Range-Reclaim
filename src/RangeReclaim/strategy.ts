import type { ValidatedStrategyRegistryEntry } from "@tradejs/strategy-kit/config";
import {
  defaultConfig,
  parseConfig,
  type RangeReclaimConfig,
} from "./config.js";
import { createRangeReclaimCore } from "./core.js";
import { rangeReclaimManifest } from "./manifest.js";
export const rangeReclaimStrategy: ValidatedStrategyRegistryEntry<RangeReclaimConfig> =
  {
    defaults: defaultConfig,
    parseConfig,
    createCore: createRangeReclaimCore,
    manifest: rangeReclaimManifest,
  };
