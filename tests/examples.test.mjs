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

for (const [name, interval, hold, age, rr] of [
  ["research-730d-15m-grid.json", "15", 16, 4, 1],
  ["research-730d-1h-grid.json", "60", 8, 0, 0.5],
]) {
  test(`${name}: frozen research example parses exactly selected settings`, () => {
    const grid = JSON.parse(
      fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"),
    );
    assert.ok(
      Object.values(grid).every((x) => Array.isArray(x) && x.length === 1),
    );
    const resolved = Object.fromEntries(
      Object.entries(grid).map(([k, v]) => [k, v[0]]),
    );
    const c = strategyEntries[0].parseConfig(resolved);
    assert.equal(c.INTERVAL, interval);
    assert.equal(c.RANGE_RECLAIM_RANGE_INTERVAL, "240");
    assert.equal(c.RANGE_RECLAIM_MAX_HOLD_BARS, hold);
    assert.equal(c.RANGE_RECLAIM_MAX_SOURCE_AGE_BARS, age);
    assert.equal(c.RANGE_RECLAIM_MAX_COST_SHARE, 0.01);
    assert.equal(c.RANGE_RECLAIM_STOP_ATR_BUFFER, 2);
    assert.equal(c.RANGE_RECLAIM_TARGET, "opposite");
    assert.equal(c.LONG.enable, true);
    assert.equal(c.SHORT.enable, true);
    assert.equal(c.LONG.minRiskRatio, rr);
    assert.equal(c.SHORT.minRiskRatio, rr);
    assert.equal(c.AI_ENABLED, false);
    assert.equal(c.ML_ENABLED, false);
    assert.equal(c.MAX_LOSS_VALUE, 10);
  });
}
