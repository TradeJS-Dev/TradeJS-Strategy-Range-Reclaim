import { defineConfig } from "@tradejs/core/config";

// Merge into the research Project's existing config after installing this package.
export default defineConfig({
  strategies: ["@tradejs/strategy-range-reclaim"],
});
