import { createStrategyConfigParser } from "@tradejs/strategy-kit/config";
import type { StrategyConfig } from "@tradejs/types";

export interface RangeReclaimConfig extends StrategyConfig {
  INTERVAL: "15" | "60";
  RANGE_RECLAIM_RANGE_INTERVAL: "60" | "240";
  RANGE_RECLAIM_WAIT_BARS: number;
  RANGE_RECLAIM_MAX_COST_SHARE: number;
  RANGE_RECLAIM_MAX_DEPTH_RATIO: number;
  RANGE_RECLAIM_ATR_LENGTH: number;
  RANGE_RECLAIM_STOP_ATR_BUFFER: number;
  RANGE_RECLAIM_TARGET: "midpoint" | "opposite";
  RANGE_RECLAIM_MAX_HOLD_BARS: number;
  MAX_LOSS_VALUE: number;
  RISK_FEE_RATE: number;
  RISK_SLIPPAGE_BPS: number;
  RISK_MARKET_IMPACT_BPS: number;
  LONG: { enable: boolean; direction: "LONG"; minRiskRatio: number };
  SHORT: { enable: boolean; direction: "SHORT"; minRiskRatio: number };
}

/** Research defaults, not validated trading parameters. */
export const defaultConfig: RangeReclaimConfig = {
  ENV: "BACKTEST",
  MAKE_ORDERS: true,
  CLOSE_OPPOSITE_POSITIONS: false,
  INTERVAL: "15",
  BACKTEST_PRICE_MODE: "open",
  BACKTEST_ENTRY_DELAY_BARS: 1,
  AI_ENABLED: false,
  ML_ENABLED: false,
  RANGE_RECLAIM_RANGE_INTERVAL: "240",
  RANGE_RECLAIM_WAIT_BARS: 1,
  RANGE_RECLAIM_MAX_COST_SHARE: 0,
  RANGE_RECLAIM_MAX_DEPTH_RATIO: 0.25,
  RANGE_RECLAIM_ATR_LENGTH: 14,
  RANGE_RECLAIM_STOP_ATR_BUFFER: 0.1,
  RANGE_RECLAIM_TARGET: "midpoint",
  RANGE_RECLAIM_MAX_HOLD_BARS: 16,
  MAX_LOSS_VALUE: 10,
  RISK_FEE_RATE: 0.001,
  RISK_SLIPPAGE_BPS: 0,
  RISK_MARKET_IMPACT_BPS: 0,
  LONG: { enable: true, direction: "LONG", minRiskRatio: 1 },
  SHORT: { enable: true, direction: "SHORT", minRiskRatio: 1 },
};

const parse = createStrategyConfigParser({
  strategyName: "RangeReclaim",
  defaults: defaultConfig,
});
export function parseConfig(input: unknown): RangeReclaimConfig {
  const c = parse(input);
  const fail = (key: string): never => {
    throw new Error(`RangeReclaim.${key} is invalid`);
  };
  if (
    !["15/240", "15/60", "60/240"].includes(
      `${c.INTERVAL}/${c.RANGE_RECLAIM_RANGE_INTERVAL}`,
    )
  )
    fail("INTERVAL/RANGE_RECLAIM_RANGE_INTERVAL");
  for (const key of [
    "RANGE_RECLAIM_ATR_LENGTH",
    "RANGE_RECLAIM_MAX_HOLD_BARS",
  ] as const) {
    if (!Number.isSafeInteger(c[key]) || c[key] < 1 || c[key] > 10000)
      fail(key);
  }
  if (
    !Number.isSafeInteger(c.RANGE_RECLAIM_WAIT_BARS) ||
    c.RANGE_RECLAIM_WAIT_BARS < 0 ||
    c.RANGE_RECLAIM_WAIT_BARS > 10000
  )
    fail("RANGE_RECLAIM_WAIT_BARS");
  if (c.RANGE_RECLAIM_MAX_COST_SHARE < 0 || c.RANGE_RECLAIM_MAX_COST_SHARE > 1)
    fail("RANGE_RECLAIM_MAX_COST_SHARE");
  for (const key of [
    "MAX_LOSS_VALUE",
    "RANGE_RECLAIM_MAX_DEPTH_RATIO",
    "RANGE_RECLAIM_STOP_ATR_BUFFER",
  ] as const)
    if (c[key] <= 0) fail(key);
  for (const key of [
    "RISK_FEE_RATE",
    "RISK_SLIPPAGE_BPS",
    "RISK_MARKET_IMPACT_BPS",
  ] as const)
    if (c[key] < 0) fail(key);
  if (!["midpoint", "opposite"].includes(c.RANGE_RECLAIM_TARGET))
    fail("RANGE_RECLAIM_TARGET");
  for (const side of ["LONG", "SHORT"] as const) {
    if (c[side].direction !== side || c[side].minRiskRatio <= 0) fail(side);
  }
  return c;
}
