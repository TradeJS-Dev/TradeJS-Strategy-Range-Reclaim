import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { defaultConfig, strategyEntries } from "../dist/index.js";

test("single-cell research grid is complete, strict and matches exported defaults", () => {
  const grid = JSON.parse(
    fs.readFileSync(
      new URL("../examples/backtest-grid.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(
    Object.values(grid).every((x) => Array.isArray(x) && x.length === 1),
  );
  const resolved = Object.fromEntries(
    Object.entries(grid).map(([k, v]) => [k, v[0]]),
  );
  assert.deepEqual(resolved, defaultConfig);
  assert.deepEqual(strategyEntries[0].parseConfig(resolved), defaultConfig);
  assert.equal(resolved.MAX_LOSS_VALUE, 10);
  assert.equal(resolved.LONG.enable, true);
  assert.equal(resolved.SHORT.enable, true);
});
