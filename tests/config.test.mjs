import assert from "node:assert/strict";
import test from "node:test";
import plugin, {
  strategyEntries,
  defaultConfig,
  parseConfig,
} from "../dist/index.js";
test("root plugin exports a single strict RangeReclaim entry", () => {
  assert.deepEqual(plugin.strategyEntries, strategyEntries);
  assert.equal(strategyEntries.length, 1);
  assert.equal(strategyEntries[0].manifest.name, "RangeReclaim");
  assert.deepEqual(parseConfig({}), defaultConfig);
  assert.equal(parseConfig({ LONG: { enable: false } }).LONG.minRiskRatio, 1);
});
test("strict config rejects typos, coercion, invalid options and side directions", () => {
  for (const c of [
    null,
    [],
    { RANGE_RECLAIM_WAIT_BAR: 1 },
    { RANGE_RECLAIM_WAIT_BARS: "1" },
    { RANGE_RECLAIM_WAIT_BARS: -1 },
    { RANGE_RECLAIM_WAIT_BARS: 1.5 },
    { RANGE_RECLAIM_ATR_LENGTH: 0 },
    { RANGE_RECLAIM_MAX_HOLD_BARS: Infinity },
    { RANGE_RECLAIM_STOP_ATR_BUFFER: 0 },
    { RANGE_RECLAIM_MAX_DEPTH_RATIO: 0 },
    { MAX_LOSS_VALUE: -1 },
    { RISK_FEE_RATE: -1 },
    { RANGE_RECLAIM_TARGET: "wick" },
    { INTERVAL: "60", RANGE_RECLAIM_RANGE_INTERVAL: "60" },
    { LONG: { minRiskRatio: 0 } },
    { SHORT: { direction: "LONG" } },
    { LONG: { enabel: false } },
  ])
    assert.throws(() => parseConfig(c), /RangeReclaim/);
  const c = parseConfig({});
  c.LONG.enable = false;
  assert.equal(defaultConfig.LONG.enable, true);
});

test("backtest runtime execution overrides remain valid strict config", () => {
  const parsed = parseConfig({
    ...defaultConfig,
    MAKE_ORDERS: true,
    CLOSE_OPPOSITE_POSITIONS: false,
  });
  assert.equal(parsed.MAKE_ORDERS, true);
  assert.equal(parsed.CLOSE_OPPOSITE_POSITIONS, false);
  assert.throws(() => parseConfig({ MAKE_ORDERS: "true" }), /RangeReclaim/);
});
