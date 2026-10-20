import type { Signal } from "@tradejs/types";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Signal-time geometry only. No labels, execution results or provider coverage. */
export function buildRangeReclaimGateFeatures(signal: Signal) {
  const extra = record(signal.additionalIndicators);
  const setup = record(extra.rangeReclaim);
  const range = record(setup.range);
  const values = [
    range.high,
    range.low,
    range.timestamp,
    range.end,
    setup.atr,
    setup.close,
    setup.extreme,
    setup.timestamp,
    setup.confirmationTimestamp,
    signal.timestamp,
  ];
  if (!values.every(finite)) return null;
  const high = range.high as number;
  const low = range.low as number;
  const width = high - low;
  const atr = setup.atr as number;
  const close = setup.close as number;
  const extreme = setup.extreme as number;
  const confirmation = setup.confirmationTimestamp as number;
  const sweep = setup.timestamp as number;
  const end = range.end as number;
  const sourceStart = range.timestamp as number;
  const step = Number(signal.interval) * 60_000;
  const long = signal.direction === "LONG";
  if (
    (signal.direction !== "LONG" && signal.direction !== "SHORT") ||
    setup.direction !== signal.direction ||
    !Number.isFinite(step) ||
    step <= 0 ||
    width <= 0 ||
    atr <= 0 ||
    low <= 0 ||
    close <= low ||
    close >= high ||
    sourceStart < 0 ||
    end <= sourceStart ||
    end > sweep ||
    sweep > confirmation ||
    confirmation > Number(signal.timestamp) ||
    (long ? extreme >= low : extreme <= high)
  )
    return null;
  return {
    sourceIntervalMinutes: (end - sourceStart) / 60_000,
    rangeWidthAtr: width / atr,
    rangeWidthBps: (width / close) * 10_000,
    sweepDepthRatio: (long ? low - extreme : extreme - high) / width,
    reclaimRatio: (long ? close - low : high - close) / width,
    waitBars: (confirmation - sweep) / step,
    sourceAgeBars: (confirmation - end) / step,
    netRiskRatio: finite(extra.netRiskRatio) ? extra.netRiskRatio : null,
    costShare: finite(extra.costShare) ? extra.costShare : null,
  };
}

export type RangeReclaimGateFeatures = NonNullable<
  ReturnType<typeof buildRangeReclaimGateFeatures>
>;
