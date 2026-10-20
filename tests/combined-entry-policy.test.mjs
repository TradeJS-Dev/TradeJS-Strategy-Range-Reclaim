import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRangeReclaimGateFeatures,
  defaultConfig,
  evaluateCombinedEntryPolicy,
  parseConfig,
  strategyEntries,
} from "../dist/index.js";

const policies = ["purple", "orange", "purple-short", "intersection", "union"];
const signal = (direction = "SHORT", overrides = {}) => ({
  symbol: "TESTUSDT",
  strategy: "RangeReclaim",
  signalId: "combined-boundary",
  interval: "15",
  direction,
  timestamp: 15_300_000,
  prices: { currentPrice: 108, takeProfitPrice: 100, stopLossPrice: 114 },
  additionalIndicators: {
    rangeReclaim: {
      direction,
      timestamp: 14_400_000,
      confirmationTimestamp: 15_300_000,
      extreme: direction === "LONG" ? 99 : 111,
      atr: 2,
      close: direction === "LONG" ? 102 : 108,
      range: { timestamp: 0, end: 14_400_000, high: 110, low: 100 },
      ...overrides,
    },
    netRiskRatio: 1.5,
    costShare: 0.005,
  },
});
const allowed = (policy, s) => evaluateCombinedEntryPolicy(policy, s).allow;

for (const direction of ["LONG", "SHORT"]) {
  test(`purple ${direction}: inclusive 10% return and adjacent rejection`, () => {
    const close = direction === "LONG" ? 101 : 109;
    const s = signal(direction, { close });
    assert.equal(buildRangeReclaimGateFeatures(s).reclaimRatio, 0.1);
    assert.equal(allowed("purple", s), true);
    assert.equal(
      allowed(
        "purple",
        signal(direction, {
          close: close + (direction === "LONG" ? -1e-7 : 1e-7),
        }),
      ),
      false,
    );
    assert.equal(
      allowed(
        "purple",
        signal(direction, {
          close: close + (direction === "LONG" ? 1e-7 : -1e-7),
        }),
      ),
      true,
    );
  });
}

test("orange: ATR width 6 is excluded; only strictly greater width qualifies", () => {
  const s = signal("SHORT", { atr: 10 / 6 });
  assert.equal(buildRangeReclaimGateFeatures(s).rangeWidthAtr, 6);
  assert.equal(allowed("orange", s), false);
  assert.equal(
    allowed("orange", signal("SHORT", { atr: 10 / 6 - 1e-7 })),
    true,
  );
  assert.equal(
    allowed("orange", signal("SHORT", { atr: 10 / 6 + 1e-7 })),
    false,
  );
});

test("orange: width 3475 bps is excluded and independent of the ATR branch", () => {
  const make = (close) =>
    signal("SHORT", {
      range: { timestamp: 0, end: 14_400_000, high: 439, low: 300 },
      close,
      extreme: 440,
      atr: 30,
    });
  assert.ok(
    Math.abs(buildRangeReclaimGateFeatures(make(400)).rangeWidthBps - 3475) <
      1e-9,
  );
  assert.equal(allowed("orange", make(400)), false);
  assert.equal(allowed("orange", make(400 - 1e-6)), true);
  assert.equal(allowed("orange", make(400 + 1e-6)), false);
});

test("SHORT-only policies suppress LONG even when geometric predicates pass", () => {
  const s = signal("LONG", { atr: 1 });
  for (const policy of ["orange", "purple-short", "intersection"])
    assert.equal(allowed(policy, s), false, policy);
  assert.equal(allowed("purple", s), true);
  assert.equal(allowed("union", s), true);
});

test("five policies implement the frozen truth table, including overlapping union", () => {
  for (const [orange, purple] of [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ]) {
    const s = signal("SHORT", {
      atr: orange ? 1 : 2,
      close: purple ? 108 : 109.5,
    });
    const expected = {
      orange,
      purple,
      "purple-short": purple,
      intersection: orange && purple,
      union: orange || purple,
    };
    for (const policy of policies) {
      const result = evaluateCombinedEntryPolicy(policy, s);
      assert.equal(
        result.allow,
        expected[policy],
        `${policy}: orange=${orange}, purple=${purple}`,
      );
      assert.equal(typeof result.reason, "string");
      assert.ok(result.reason.length > 0);
    }
    // An overlap is one admission decision, never an array/two executions.
    assert.deepEqual(
      Object.keys(evaluateCombinedEntryPolicy("union", s)).sort(),
      ["allow", "reason"],
    );
  }
});

test("missing, invalid or future setup fails closed rather than entering orange", () => {
  const mutations = [
    (s) => {
      delete s.additionalIndicators;
    },
    (s) => {
      s.additionalIndicators.rangeReclaim = null;
    },
    (s) => {
      s.additionalIndicators.rangeReclaim.direction = "LONG";
    },
    (s) => {
      s.additionalIndicators.rangeReclaim.confirmationTimestamp =
        s.timestamp + 1;
    },
    (s) => {
      s.additionalIndicators.rangeReclaim.range.end = s.timestamp + 1;
    },
    (s) => {
      s.additionalIndicators.rangeReclaim.range.high = 100;
    },
    (s) => {
      s.additionalIndicators.rangeReclaim.close = 110;
    },
    ...[null, undefined, NaN, Infinity, -Infinity, "1", 0].map(
      (value) => (s) => {
        s.additionalIndicators.rangeReclaim.atr = value;
      },
    ),
  ];
  for (const mutate of mutations) {
    const s = signal();
    mutate(s);
    for (const policy of policies)
      assert.equal(allowed(policy, s), false, policy);
  }
});

test("active policies reject unsupported execution/source pairs", () => {
  for (const s of [
    { ...signal(), interval: "60" },
    { ...signal(), interval: "5" },
    signal("SHORT", {
      range: { timestamp: 10_800_000, end: 14_400_000, high: 110, low: 100 },
    }),
  ])
    for (const policy of policies)
      assert.equal(allowed(policy, s), false, policy);
});

test("off preserves existing admission even without usable geometry", () => {
  assert.equal(defaultConfig.RANGE_RECLAIM_ENTRY_POLICY, "off");
  assert.equal(parseConfig({}).RANGE_RECLAIM_ENTRY_POLICY, "off");
  assert.equal(allowed("off", signal()), true);
  assert.equal(
    allowed("off", { interval: "60", additionalIndicators: {} }),
    true,
  );
});

test("config accepts only the five registered policies plus off", () => {
  for (const policy of ["off", ...policies])
    assert.equal(
      parseConfig({ RANGE_RECLAIM_ENTRY_POLICY: policy })
        .RANGE_RECLAIM_ENTRY_POLICY,
      policy,
    );
  for (const value of [null, true, 1, "", "short", "purple_short", "OR", []])
    assert.throws(
      () => parseConfig({ RANGE_RECLAIM_ENTRY_POLICY: value }),
      /RangeReclaim/,
    );
});

test("manifest uses ctx.strategyConfig and decision.signal without AI payload enrichment", async () => {
  const hook = strategyEntries[0].manifest.hooks.beforeEntryGate;
  assert.equal(typeof hook, "function");
  const s = signal("LONG");
  const params = (policy) => ({
    ctx: {
      strategyName: "RangeReclaim",
      env: "BACKTEST",
      strategyConfig: parseConfig({ RANGE_RECLAIM_ENTRY_POLICY: policy }),
    },
    decision: {
      kind: "entry",
      signal: s,
      entryContext: { direction: s.direction },
    },
    entry: { signal: s },
  });
  assert.equal((await hook(params("purple-short"))).allow, false);
  assert.equal((await hook(params("purple"))).allow, true);
  const off = await hook(params("off"));
  assert.equal(off?.allow ?? true, true);
});

test("gate outcome is deterministic and does not mutate the causal signal", () => {
  const s = signal("SHORT", { atr: 1 });
  const before = structuredClone(s);
  for (const policy of policies) {
    const first = evaluateCombinedEntryPolicy(policy, s);
    assert.deepEqual(evaluateCombinedEntryPolicy(policy, s), first);
    assert.deepEqual(s, before);
  }
  const changedOutcome = structuredClone(s);
  changedOutcome.tradeResult = { netProfit: -1e9, exitTimestamp: 9e15 };
  changedOutcome.additionalIndicators.rows = 99999;
  for (const policy of policies)
    assert.deepEqual(
      evaluateCombinedEntryPolicy(policy, changedOutcome),
      evaluateCombinedEntryPolicy(policy, s),
    );
});
