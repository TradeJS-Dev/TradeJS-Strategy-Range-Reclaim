import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, strategyEntries } from "../dist/index.js";

const hook = strategyEntries[0].manifest.hooks.beforeEntryGate;
const ts = 14400000;
const profile = {
  symbol: "TESTUSDT",
  asOf: ts,
  validUntil: ts + 1,
  moneyGroup: "low",
  volatilityGroup: "low",
};
function decide({
  p = profile,
  direction = "SHORT",
  atr = 2,
  policy = "intersection-low-low-short",
} = {}) {
  const signal = {
    symbol: "TESTUSDT",
    direction,
    interval: "15",
    timestamp: ts,
    prices: { currentPrice: 108, stopLossPrice: 114, takeProfitPrice: 100 },
    additionalIndicators: {
      tickerProfile: p,
      rangeReclaim: {
        direction,
        timestamp: ts,
        confirmationTimestamp: ts,
        extreme: direction === "SHORT" ? 111 : 99,
        atr,
        close: direction === "SHORT" ? 108 : 102,
        range: { timestamp: 0, end: ts, high: 110, low: 100 },
      },
    },
  };
  return hook({
    ctx: {
      strategyConfig: { ...defaultConfig, RANGE_RECLAIM_ENTRY_POLICY: policy },
    },
    decision: { signal },
    entry: { signal },
  });
}
test("only the explicit expansion admits a rejected low/low SHORT", () => {
  assert.equal(decide().reason, "RANGE_RECLAIM_LOW_LOW_SHORT_ALLOW");
  assert.equal(decide({ policy: "intersection" }).allow, false);
  assert.equal(decide({ direction: "LONG" }).allow, false);
});
test("unknown, wrong-symbol, future and expired profiles do not add trades", () => {
  for (const p of [
    null,
    { ...profile, moneyGroup: "unknown" },
    { ...profile, volatilityGroup: "middle" },
    { ...profile, symbol: "OTHERUSDT" },
    { ...profile, asOf: ts + 1 },
    { ...profile, validUntil: ts },
  ])
    assert.equal(decide({ p }).allow, false);
});
test("intersection remains admitted when profile is missing", () => {
  assert.equal(decide({ atr: 1, p: null }).allow, true);
});

test("the runtime requests the exact frozen Bybit profile universe", () => {
  assert.deepEqual(
    strategyEntries[0].manifest.contextRequirements.tickerProfiles,
    {
      provider: "bybit",
      universeId: "range-reclaim-frozen577-20261111",
    },
  );
});
