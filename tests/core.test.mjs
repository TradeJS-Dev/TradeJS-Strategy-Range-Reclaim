import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createStrategyAPI } from "@tradejs/core/strategies";
import { createRangeReclaimCore } from "../dist/index.js";
import { config, bar, history, long, short, step } from "./helpers.mjs";

// Only connector I/O is replaced. Entry/exit builders, state controllers,
// risk economics, detector and figures are the real public implementations.
async function harness(overrides = {}, initialData = history(), saved) {
  const c = config(overrides),
    cachedData = [...initialData];
  const controllers = new Map();
  let position = null;
  const api = createStrategyAPI({
    strategy: "RangeReclaim",
    symbol: "TESTUSDT",
    interval: c.INTERVAL,
    env: "BACKTEST",
    cachedData,
    connector: { getPosition: async () => position },
  });
  const create = api.createStateController;
  api.createStateController = (key, init, options) => {
    const controller = create(key, init, options);
    if (saved?.[key]) controller.set(structuredClone(saved[key]));
    controllers.set(key, controller);
    return controller;
  };
  const run = await createRangeReclaimCore({
    config: c,
    data: [...initialData],
    strategyApi: api,
  });
  return {
    async next(candle) {
      cachedData.push(candle);
      return run(candle, candle);
    },
    position(value) {
      position = value;
    },
    snapshot() {
      return JSON.parse(
        JSON.stringify(
          Object.fromEntries(
            [...controllers].map(([k, v]) => [k, v.snapshot()]),
          ),
        ),
      );
    },
  };
}
for (const [side, candle, target] of [
  ["LONG", long(), 105],
  ["SHORT", short(), 105],
]) {
  test(`${side}: real StrategyAPI entry, risk sizing and visible geometry`, async () => {
    const h = await harness();
    const d = await h.next(candle);
    assert.equal(d.kind, "entry");
    assert.equal(d.signal.direction, side);
    assert.equal(d.entryContext.timestamp, 4 * step);
    assert.equal(d.entryContext.prices.currentPrice, candle.close);
    assert.equal(d.orderPlan.takeProfits[0].price, target);
    const stop = side === "LONG" ? 97.95 : 112.05;
    assert.ok(Math.abs(d.orderPlan.stopLossPrice - stop) < 1e-10);
    assert.ok(
      Math.abs(d.orderPlan.qty * Math.abs(candle.close - stop) - 10) < 1e-10,
    );
    assert.equal(d.signal.signalId, `RangeReclaim:0:${side}:${4 * step}`);
    const f = d.signal.figures;
    assert.equal(f.zones[0].start.value, 110);
    assert.equal(f.zones[0].end.value, 100);
    assert.deepEqual(
      f.points.map((x) => x.id),
      ["sweep", "extreme", "confirmation", "entry"],
    );
    assert.ok(f.lines.some((x) => x.id === "stop"));
    assert.ok(f.lines.some((x) => x.id === "target"));
    assert.equal((await h.next(candle)).code, "RANGE_RECLAIM_ALREADY_HANDLED");
    assert.equal(
      (await h.next(side === "LONG" ? long(5) : short(5))).code,
      "RANGE_RECLAIM_RANGE_SPENT",
    );
  });
}
test("CJS package root exports the same plugin contract", () => {
  const require = createRequire(import.meta.url),
    cjs = require("../dist/index.cjs");
  assert.equal(cjs.strategyEntries[0].manifest.name, "RangeReclaim");
});
test("opposite boundary target and next-bar extreme are used by order plan", async () => {
  const h = await harness({ RANGE_RECLAIM_TARGET: "opposite" });
  await h.next(long(4, { close: 99 }));
  const d = await h.next(long(5, { open: 99, low: 98.5 }));
  assert.equal(d.kind, "entry");
  assert.equal(d.orderPlan.takeProfits[0].price, 110);
  assert.ok(d.orderPlan.stopLossPrice < 98.5);
  assert.equal(
    d.signal.figures.points.find((x) => x.id === "extreme").points[0].timestamp,
    5 * step,
  );
});
test("net R rejects after costs even when gross R passes; rejected range cannot retry", async () => {
  const h = await harness({ RISK_FEE_RATE: 0.01 });
  assert.equal(
    (await h.next(long())).code,
    "RANGE_RECLAIM_INSUFFICIENT_RISK_RATIO",
  );
  assert.equal((await h.next(long(5))).code, "RANGE_RECLAIM_RANGE_SPENT");
});
test("sizing includes fees, slippage and impact", async () => {
  const h = await harness({
    RISK_FEE_RATE: 0.001,
    RISK_SLIPPAGE_BPS: 2,
    RISK_MARKET_IMPACT_BPS: 3,
    LONG: { minRiskRatio: 0.5 },
  });
  const d = await h.next(long());
  assert.equal(d.kind, "entry");
  const entry = 101,
    stop = d.orderPlan.stopLossPrice,
    slip = 0.0005;
  const loss =
    entry -
    stop +
    (entry + stop) * slip +
    (entry * (1 + slip) + stop * (1 - slip)) * 0.001;
  assert.ok(Math.abs(d.orderPlan.qty * loss - 10) < 1e-10);
  assert.ok(
    d.signal.additionalIndicators.netRiskRatio <
      d.entryContext.prices.riskRatio,
  );
});
test("target behind entry is rejected; disabled side also spends range", async () => {
  assert.equal(
    (await (await harness()).next(long(4, { close: 106 }))).code,
    "RANGE_RECLAIM_INVALID_PLAN",
  );
  const h = await harness({ LONG: { enable: false } });
  assert.equal((await h.next(long())).code, "RANGE_RECLAIM_SIDE_DISABLED");
  assert.equal((await h.next(long(5))).code, "RANGE_RECLAIM_RANGE_SPENT");
});
test("existing position cannot add size or reverse; max hold exits at exact deadline", async () => {
  const h = await harness({ RANGE_RECLAIM_MAX_HOLD_BARS: 2 });
  assert.equal((await h.next(long())).kind, "entry");
  h.position({ symbol: "TESTUSDT", qty: 1, price: 101, direction: "LONG" });
  assert.equal((await h.next(short(5))).code, "RANGE_RECLAIM_POSITION_EXISTS");
  const d = await h.next(bar(6));
  assert.equal(d.kind, "exit");
  assert.equal(d.code, "RANGE_RECLAIM_MAX_HOLD");
  assert.equal(d.closePlan.price, 105);
  assert.equal(d.closePlan.timestamp, 6 * step);
  assert.equal(d.closePlan.direction, "LONG");
});
test("restored open position without age evidence exits conservatively", async () => {
  const h = await harness();
  h.position({ symbol: "TESTUSDT", qty: 1, price: 101, direction: "SHORT" });
  const d = await h.next(bar(4));
  assert.equal(d.kind, "exit");
  assert.equal(d.code, "RANGE_RECLAIM_UNKNOWN_POSITION_AGE");
});
test("JSON checkpoint restores pending signal and produces byte-equivalent entry", async () => {
  const h = await harness();
  await h.next(long(4, { close: 99 }));
  const restored = await harness({}, [], h.snapshot());
  assert.deepEqual(await restored.next(long(5)), await h.next(long(5)));
  assert.deepEqual(restored.snapshot(), h.snapshot());
});
test("checkpoint restores used range, duplicate guard and hold clock across core reconstruction", async () => {
  const options = { RANGE_RECLAIM_MAX_HOLD_BARS: 2 };
  const h = await harness(options);
  await h.next(long());
  const r = await harness(options, [], h.snapshot());
  assert.equal((await r.next(long())).code, "RANGE_RECLAIM_ALREADY_HANDLED");
  const position = {
    symbol: "TESTUSDT",
    qty: 1,
    price: 101,
    direction: "LONG",
  };
  h.position(position);
  r.position(position);
  assert.deepEqual(await r.next(bar(5)), await h.next(bar(5)));
  assert.deepEqual(await r.next(bar(6)), await h.next(bar(6)));
  h.position(null);
  r.position(null);
  assert.deepEqual(await r.next(long(7)), await h.next(long(7)));
});
test("history reconstruction retains pending and spent ranges", async () => {
  const pending = await harness({}, [...history(), long(4, { close: 99 })]);
  assert.equal((await pending.next(long(5))).kind, "entry");
  const spent = await harness({}, [...history(), long()]);
  assert.equal((await spent.next(long(5))).code, "RANGE_RECLAIM_RANGE_SPENT");
});
test("parallel config cells have independent state", async () => {
  const a = await harness(),
    b = await harness({ RANGE_RECLAIM_WAIT_BARS: 0 });
  await a.next(long(4, { close: 99 }));
  await b.next(long(4, { close: 99 }));
  assert.equal((await a.next(long(5))).kind, "entry");
  assert.equal((await b.next(long(5))).code, "RANGE_RECLAIM_RANGE_SPENT");
});

test("a signal observed while occupied cannot enter after that position closes", async () => {
  const h = await harness({ RANGE_RECLAIM_MAX_HOLD_BARS: 10 });
  await h.next(long());
  h.position({ symbol: "TESTUSDT", qty: 1, price: 101, direction: "LONG" });
  for (let i = 5; i < 8; i++) await h.next(bar(i));
  assert.equal(
    (await h.next(bar(8, { low: 98, close: 100 }))).code,
    "RANGE_RECLAIM_POSITION_EXISTS",
  );
  h.position(null);
  assert.equal(
    (await h.next(bar(9, { low: 98, close: 100 }))).code,
    "RANGE_RECLAIM_RANGE_SPENT",
  );
});

test("a time gap cannot extend the maximum holding deadline", async () => {
  const h = await harness({ RANGE_RECLAIM_MAX_HOLD_BARS: 2 });
  await h.next(long());
  h.position({ symbol: "TESTUSDT", qty: 1, price: 101, direction: "LONG" });
  assert.equal((await h.next(bar(9))).code, "RANGE_RECLAIM_MAX_HOLD");
});

for (const [direction, sweep] of [
  ["LONG", long],
  ["SHORT", short],
]) {
  test(`${direction}: cost share rejects with diagnostic; zero control preserves exact economics`, async () => {
    const opts = {
      RISK_FEE_RATE: 0.003,
      LONG: { minRiskRatio: 0.1 },
      SHORT: { minRiskRatio: 0.1 },
    };
    const base = await harness(opts),
      zero = await harness({ ...opts, RANGE_RECLAIM_MAX_COST_SHARE: 0 }),
      filtered = await harness({ ...opts, RANGE_RECLAIM_MAX_COST_SHARE: 0.15 });
    const decision = await base.next(sweep());
    assert.equal(decision.kind, "entry");
    assert.deepEqual(await zero.next(sweep()), decision);
    assert.equal(
      Object.hasOwn(decision.signal.additionalIndicators, "costShare"),
      false,
    );
    assert.equal(
      (await filtered.next(sweep())).code,
      "RANGE_RECLAIM_COST_SHARE",
    );
    assert.equal(
      (await filtered.next(sweep(5))).code,
      "RANGE_RECLAIM_RANGE_SPENT",
    );
    const admitted = await harness({
      ...opts,
      RANGE_RECLAIM_MAX_COST_SHARE: 0.3,
    });
    const d = await admitted.next(sweep());
    assert.equal(d.kind, "entry");
    assert.deepEqual(d.orderPlan, decision.orderPlan);
    assert.ok(d.signal.additionalIndicators.costShare > 0.15);
    assert.ok(d.signal.additionalIndicators.costShare < 0.3);
  });
  test(`${direction}: exact target cost formula includes fee/slippage/impact and admits equality`, async () => {
    const opts = {
      RISK_FEE_RATE: 0.001,
      RISK_SLIPPAGE_BPS: 2,
      RISK_MARKET_IMPACT_BPS: 3,
      LONG: { minRiskRatio: 0.1 },
      SHORT: { minRiskRatio: 0.1 },
    };
    const candle = sweep();
    const target = 105,
      slip = 0.0005,
      sign = direction === "LONG" ? 1 : -1;
    const entryCost =
      candle.close * slip +
      candle.close * (1 + sign * slip) * opts.RISK_FEE_RATE;
    const targetCost =
      target * slip + target * (1 - sign * slip) * opts.RISK_FEE_RATE;
    const expected = (entryCost + targetCost) / Math.abs(target - candle.close);
    const d = await (
      await harness({ ...opts, RANGE_RECLAIM_MAX_COST_SHARE: expected })
    ).next(candle);
    assert.equal(d.kind, "entry");
    assert.equal(d.signal.additionalIndicators.costShare, expected);
    const rejected = await (
      await harness({ ...opts, RANGE_RECLAIM_MAX_COST_SHARE: expected - 1e-10 })
    ).next(candle);
    assert.equal(rejected.code, "RANGE_RECLAIM_COST_SHARE");
  });
}

test("cost-share checkpoint restores pending decision and rejected range without retry", async () => {
  const opts = {
    RISK_FEE_RATE: 0.003,
    RANGE_RECLAIM_MAX_COST_SHARE: 0.15,
    LONG: { minRiskRatio: 0.1 },
  };
  const h = await harness(opts);
  await h.next(long(4, { close: 99 }));
  const r = await harness(opts, [], h.snapshot());
  const original = await h.next(long(5));
  assert.equal(original.code, "RANGE_RECLAIM_COST_SHARE");
  assert.deepEqual(await r.next(long(5)), original);
  const rejected = await harness(opts, [], r.snapshot());
  assert.equal(
    (await rejected.next(long(6))).code,
    "RANGE_RECLAIM_RANGE_SPENT",
  );
});
