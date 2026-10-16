import assert from "node:assert/strict";
import test from "node:test";
import { createRangeReclaimEngine, parseConfig } from "../dist/index.js";
import { config, bar, history, long, short, step } from "./helpers.mjs";
const engine = (overrides = {}, candles = history()) =>
  createRangeReclaimEngine({
    config: config(overrides),
    initialCandles: candles,
  });

for (const [direction, candle, extreme] of [
  ["LONG", long(), 99],
  ["SHORT", short(), 111],
]) {
  test(`${direction}: same-bar reclaim, exact source, ATR and extreme`, () => {
    const e = engine();
    const s = e.next(candle).signal;
    assert.equal(s.direction, direction);
    assert.equal(s.extreme, extreme);
    assert.deepEqual(s.range, {
      timestamp: 0,
      end: 4 * step,
      high: 110,
      low: 100,
    });
    assert.equal(s.atr, 10.5);
    assert.equal(s.confirmationTimestamp, 4 * step);
    assert.equal(e.next(bar(5)).reason, "RANGE_SPENT");
  });
}
for (const [direction, a, b, extreme] of [
  [
    "LONG",
    long(4, { close: 99 }),
    long(5, { open: 99, low: 98.5, close: 101 }),
    98.5,
  ],
  [
    "SHORT",
    short(4, { close: 111 }),
    short(5, { open: 111, high: 111.5, close: 109 }),
    111.5,
  ],
]) {
  test(`${direction}: next-bar return retains first timestamp and worst extreme`, () => {
    const e = engine();
    assert.equal(e.next(a).reason, "WAIT_RECLAIM");
    const s = e.next(b).signal;
    assert.equal(s.direction, direction);
    assert.equal(s.timestamp, 4 * step);
    assert.equal(s.extreme, extreme);
    assert.equal(s.extremeTimestamp, 5 * step);
  });
}
test("expiry cannot be extended or restarted by another sweep", () => {
  const e = engine();
  e.next(long(4, { close: 99 }));
  assert.equal(e.next(long(5, { close: 99 })).reason, "EXPIRED");
  assert.equal(e.next(long(6)).reason, "RANGE_SPENT");
});
test("wait=0 requires same-bar return; wait=2 includes exact second following bar", () => {
  assert.equal(
    engine({ RANGE_RECLAIM_WAIT_BARS: 0 }).next(long(4, { close: 99 })).reason,
    "EXPIRED",
  );
  const e = engine({ RANGE_RECLAIM_WAIT_BARS: 2 });
  e.next(long(4, { close: 99 }));
  e.next(long(5, { close: 99 }));
  assert.ok(e.next(long(6)).signal);
});
test("touch is not breakout and close on either boundary is not a return", () => {
  const e = engine();
  assert.equal(e.next(bar(4)).signal, null);
  assert.equal(e.next(long(5, { close: 100 })).reason, "WAIT_RECLAIM");
  assert.equal(e.next(long(6, { close: 110 })).reason, "EXPIRED");
});
test("ambiguous double-boundary bar cancels and spends range", () => {
  const e = engine();
  assert.equal(
    e.next(bar(4, { high: 111, low: 99 })).reason,
    "AMBIGUOUS_BOTH_BOUNDARIES",
  );
  assert.equal(e.next(long(5)).reason, "RANGE_SPENT");
});
test("opposite-boundary excursion cancels pending instead of reversing", () => {
  const e = engine();
  e.next(long(4, { close: 99 }));
  assert.equal(e.next(short(5)).reason, "OPPOSITE_BOUNDARY");
});
test("depth uses full excursion, accepts equality and rejects excess on return", () => {
  assert.ok(engine().next(long(4, { low: 97.5 })).signal);
  assert.equal(engine().next(long(4, { low: 97.49 })).reason, "TOO_DEEP");
  const e = engine();
  e.next(long(4, { close: 99 }));
  assert.equal(e.next(long(5, { open: 99, low: 97 })).reason, "TOO_DEEP");
});
for (const [execution, higher, count] of [
  ["15", "240", 16],
  ["15", "60", 4],
  ["60", "240", 4],
]) {
  test(`${execution}/${higher}: final source bar cannot trade its own high/low`, () => {
    const interval = Number(execution) * 60_000;
    const c = parseConfig({
      INTERVAL: execution,
      RANGE_RECLAIM_RANGE_INTERVAL: higher,
      RANGE_RECLAIM_ATR_LENGTH: 1,
    });
    const e = createRangeReclaimEngine({ config: c });
    for (let i = 0; i < count; i++)
      assert.equal(
        e.next(bar(i, i === count - 1 ? { high: 120 } : {}, interval)).signal,
        null,
      );
    assert.equal(e.getState().range, null);
    const s = e.next(bar(count, { low: 99, close: 101 }, interval)).signal;
    assert.equal(s.range.high, 120);
    assert.equal(s.range.end, count * interval);
    // Open bucket gets a huge high, but source remains fixed.
    assert.equal(e.getState().bucket.high, 110);
  });
}
test("forming higher candle extrema never change the already active source", () => {
  const e = engine();
  e.next(bar(4, { high: 120 })); // opposite sweep, no return
  assert.equal(e.getState().range.high, 110);
  e.next(bar(5, { high: 130 }));
  assert.equal(e.getState().range.high, 110);
});
test("new range cancels pending even when wait would allow confirmation", () => {
  const e = engine({ RANGE_RECLAIM_WAIT_BARS: 10 });
  for (let i = 4; i < 7; i++) e.next(bar(i));
  e.next(long(7, { close: 99 }));
  const out = e.next(bar(8));
  assert.equal(out.signal, null);
  assert.equal(e.getState().pending, null);
  assert.equal(e.getState().range.low, 99);
});
test("a new complete range resets spent state", () => {
  const e = engine();
  e.next(long());
  for (let i = 5; i < 8; i++) e.next(bar(i));
  assert.ok(e.next(bar(8, { low: 98, close: 100 })).signal);
});
test("partial startup, missing bar and gap cannot produce a stale range", () => {
  const e = engine({}, [bar(1), bar(2), bar(3)]);
  assert.equal(e.next(long()).reason, "WARMUP");
  const g = engine();
  g.next(long(4, { close: 99 }));
  assert.equal(g.next(long(6)).reason, "WARMUP");
  assert.equal(g.getState().range, null);
  g.next(bar(7));
  assert.equal(g.next(long(8)).reason, "WARMUP");
  for (let i = 9; i < 12; i++) g.next(bar(i));
  assert.ok(g.next(long(12, { low: 98 })).signal);
});
test("ATR requires full warmup and zero-width source cannot signal", () => {
  assert.equal(
    engine({ RANGE_RECLAIM_ATR_LENGTH: 20 }).next(long()).reason,
    "WARMUP",
  );
  const flat = history().map((x) => ({ ...x, high: 105, low: 105 }));
  assert.equal(engine({}, flat).next(long()).signal, null);
});
test("continuous, history replay and JSON snapshot agree at every split", () => {
  const candles = [
    ...history(),
    long(4, { close: 99 }),
    long(5, { low: 98.5, close: 101 }),
    bar(6),
    bar(7),
    long(8),
  ];
  for (let split = 0; split < candles.length; split++) {
    const prefix = candles.slice(0, split);
    const a = createRangeReclaimEngine({
      config: config(),
      initialCandles: prefix,
    });
    const b = createRangeReclaimEngine({
      config: config(),
      state: JSON.parse(JSON.stringify(a.getState())),
    });
    const c = createRangeReclaimEngine({ config: config() });
    for (const x of prefix) c.next(x);
    for (const x of candles.slice(split)) {
      assert.deepEqual(a.next(x), b.next(x));
      assert.deepEqual(a.getState(), c.next(x) && c.getState());
    }
  }
});
test("duplicate timestamp is idempotent and snapshots cannot mutate engine", () => {
  const e = engine();
  const out = e.next(long());
  const before = e.getState();
  assert.deepEqual(e.next(long(4, { low: 90 })), out);
  assert.deepEqual(e.getState(), before);
  const snapshot = e.getState();
  snapshot.range.high = 999;
  out.signal.range.low = 0;
  assert.equal(e.getState().range.high, 110);
  assert.equal(e.getState().result.signal.range.low, 100);
  assert.throws(() => e.next(bar(3)), /Out-of-order/);
});
test("checkpoint rejects changed config; malformed candles fail without transition", () => {
  const e = engine();
  const s = e.getState();
  assert.throws(
    () =>
      createRangeReclaimEngine({
        config: config({ RANGE_RECLAIM_WAIT_BARS: 2 }),
        state: s,
      }),
    /Incompatible/,
  );
  for (const patch of [
    { timestamp: 1 },
    { close: NaN },
    { high: 90 },
    { low: 120 },
    { open: 0 },
  ])
    assert.throws(() => e.next(bar(4, patch)), /Invalid/);
  assert.deepEqual(e.getState(), s);
});

test("future paths cannot change common-prefix signals or state", () => {
  const prefix = [...history(), long(4, { close: 99 }), long(5)];
  const a = createRangeReclaimEngine({ config: config() });
  const outputs = prefix.map((x) => a.next(x));
  const b = createRangeReclaimEngine({
    config: config(),
    initialCandles: [...prefix, bar(6, { high: 1000 }), bar(7, { low: 1 })],
  });
  // Historical outputs are independent copies and still match replaying only prefix.
  const replay = createRangeReclaimEngine({ config: config() });
  assert.deepEqual(
    prefix.map((x) => replay.next(x)),
    outputs,
  );
  assert.equal(outputs[5].signal.range.high, 110);
  assert.equal(outputs[5].signal.range.low, 100);
  assert.notDeepEqual(a.getState(), b.getState());
});

test("state stays bounded after thousands of bars", () => {
  const e = createRangeReclaimEngine({ config: config() });
  for (let i = 0; i < 2000; i++) e.next(bar(i));
  const snapshot = e.getState();
  assert.equal(snapshot.bucket.count, 4);
  assert.ok(JSON.stringify(snapshot).length < 2500);
  assert.equal(snapshot.atrCount, 2);
});
