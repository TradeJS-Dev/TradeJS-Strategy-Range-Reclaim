import type { Candle, Direction } from "@tradejs/types";
import { parseConfig, type RangeReclaimConfig } from "./config.js";

export interface SourceRange {
  timestamp: number;
  end: number;
  high: number;
  low: number;
}
interface Bucket extends SourceRange {
  count: number;
  completeStart: boolean;
}
interface Sweep {
  direction: Direction;
  timestamp: number;
  extreme: number;
  extremeTimestamp: number;
}
export interface ReclaimSignal extends Sweep {
  range: SourceRange;
  confirmationTimestamp: number;
  close: number;
  atr: number;
}
export interface EngineState {
  version: 1;
  configKey: string;
  lastTimestamp: number | null;
  previousClose: number | null;
  atr: number;
  atrCount: number;
  bucket: Bucket | null;
  range: SourceRange | null;
  pending: Sweep | null;
  spent: boolean;
  result: { signal: ReclaimSignal | null; reason: string };
}

/** Candle timestamps are UTC bar OPEN times. Inputs must be closed execution bars. */
export function createRangeReclaimEngine({
  config,
  initialCandles = [],
  state,
}: {
  config: RangeReclaimConfig;
  initialCandles?: readonly Candle[];
  state?: EngineState;
}) {
  const c = parseConfig(config);
  const configKey = JSON.stringify(c);
  if (state && (state.version !== 1 || state.configKey !== configKey))
    throw new Error("Incompatible RangeReclaim snapshot");
  let s: EngineState = state
    ? structuredClone(state)
    : {
        version: 1,
        configKey,
        lastTimestamp: null,
        previousClose: null,
        atr: 0,
        atrCount: 0,
        bucket: null,
        range: null,
        pending: null,
        spent: false,
        result: { signal: null, reason: "WARMUP" },
      };
  const step = Number(c.INTERVAL) * 60_000;
  const higher = Number(c.RANGE_RECLAIM_RANGE_INTERVAL) * 60_000;
  const cancel = (reason: string) => {
    s.pending = null;
    s.spent = true;
    s.result = { signal: null, reason };
  };
  const next = (bar: Candle): EngineState["result"] => {
    if (
      !Number.isSafeInteger(bar.timestamp) ||
      bar.timestamp < 0 ||
      bar.timestamp % step !== 0 ||
      ![bar.open, bar.high, bar.low, bar.close].every(
        (x) => Number.isFinite(x) && x > 0,
      ) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close)
    )
      throw new Error("Invalid closed execution candle");
    if (s.lastTimestamp !== null && bar.timestamp < s.lastTimestamp)
      throw new Error("Out-of-order candle");
    if (bar.timestamp === s.lastTimestamp) return structuredClone(s.result);
    if (s.lastTimestamp !== null && bar.timestamp !== s.lastTimestamp + step) {
      s.bucket = null;
      s.range = null;
      s.pending = null;
      s.spent = false;
      s.previousClose = null;
      s.atr = 0;
      s.atrCount = 0;
    }
    s.lastTimestamp = bar.timestamp;
    s.result = { signal: null, reason: "WAIT_SWEEP" };
    const start = Math.floor(bar.timestamp / higher) * higher;
    if (s.bucket?.timestamp !== start) {
      const old = s.bucket;
      s.range =
        old &&
        old.end === start &&
        old.completeStart &&
        old.count === higher / step &&
        old.high > old.low
          ? {
              timestamp: old.timestamp,
              end: old.end,
              high: old.high,
              low: old.low,
            }
          : null;
      s.pending = null;
      s.spent = false;
      s.bucket = {
        timestamp: start,
        end: start + higher,
        high: bar.high,
        low: bar.low,
        count: 0,
        completeStart: bar.timestamp === start,
      };
    }
    const b = s.bucket!;
    b.high = Math.max(b.high, bar.high);
    b.low = Math.min(b.low, bar.low);
    b.count++;
    const tr = Math.max(
      bar.high - bar.low,
      s.previousClose === null ? 0 : Math.abs(bar.high - s.previousClose),
      s.previousClose === null ? 0 : Math.abs(bar.low - s.previousClose),
    );
    s.atrCount = Math.min(s.atrCount + 1, c.RANGE_RECLAIM_ATR_LENGTH);
    s.atr += (tr - s.atr) / s.atrCount;
    s.previousClose = bar.close;
    const r = s.range;
    if (!r || s.atrCount < c.RANGE_RECLAIM_ATR_LENGTH || s.atr <= 0) {
      s.result.reason = "WARMUP";
      return structuredClone(s.result);
    }
    if (s.spent) {
      s.result.reason = "RANGE_SPENT";
      return structuredClone(s.result);
    }
    if (
      c.RANGE_RECLAIM_MAX_SOURCE_AGE_BARS > 0 &&
      bar.timestamp >= r.end + c.RANGE_RECLAIM_MAX_SOURCE_AGE_BARS * step
    ) {
      cancel("SOURCE_EXPIRED");
      return structuredClone(s.result);
    }
    const below = bar.low < r.low,
      above = bar.high > r.high;
    if (below && above) {
      cancel("AMBIGUOUS_BOTH_BOUNDARIES");
      return structuredClone(s.result);
    }
    if (
      s.pending &&
      bar.timestamp > s.pending.timestamp + c.RANGE_RECLAIM_WAIT_BARS * step
    ) {
      cancel("EXPIRED");
      return structuredClone(s.result);
    }
    if (
      s.pending &&
      ((s.pending.direction === "LONG" && above) ||
        (s.pending.direction === "SHORT" && below))
    ) {
      cancel("OPPOSITE_BOUNDARY");
      return structuredClone(s.result);
    }
    if (!s.pending && (below || above)) {
      s.pending = {
        direction: below ? "LONG" : "SHORT",
        timestamp: bar.timestamp,
        extreme: below ? bar.low : bar.high,
        extremeTimestamp: bar.timestamp,
      };
    }
    const p = s.pending;
    if (!p) return structuredClone(s.result);
    const extreme =
      p.direction === "LONG"
        ? Math.min(p.extreme, bar.low)
        : Math.max(p.extreme, bar.high);
    if (extreme !== p.extreme) {
      p.extreme = extreme;
      p.extremeTimestamp = bar.timestamp;
    }
    const depth =
      p.direction === "LONG" ? r.low - p.extreme : p.extreme - r.high;
    if (depth > (r.high - r.low) * c.RANGE_RECLAIM_MAX_DEPTH_RATIO)
      cancel("TOO_DEEP");
    else if (bar.close > r.low && bar.close < r.high) {
      s.result = {
        signal: {
          ...p,
          range: { ...r },
          confirmationTimestamp: bar.timestamp,
          close: bar.close,
          atr: s.atr,
        },
        reason: "RECLAIM",
      };
      s.spent = true;
      s.pending = null;
    } else if (bar.timestamp >= p.timestamp + c.RANGE_RECLAIM_WAIT_BARS * step)
      cancel("EXPIRED");
    else s.result.reason = "WAIT_RECLAIM";
    return structuredClone(s.result);
  };
  if (state && initialCandles.length)
    throw new Error("Use snapshot OR initialCandles");
  for (const candle of initialCandles) next(candle);
  return { next, getState: () => structuredClone(s) };
}
