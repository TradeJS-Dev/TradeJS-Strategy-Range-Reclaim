import { parseConfig } from "../dist/index.js";
export const step = 15 * 60_000;
export const hour = 4 * step;
export const config = (overrides = {}) =>
  parseConfig({
    RANGE_RECLAIM_RANGE_INTERVAL: "60",
    RANGE_RECLAIM_ATR_LENGTH: 2,
    RISK_FEE_RATE: 0,
    ...overrides,
  });
export function bar(i, overrides = {}, interval = step) {
  return {
    timestamp: i * interval,
    open: 105,
    high: 110,
    low: 100,
    close: 105,
    volume: 1,
    turnover: 105,
    dt: "",
    ...overrides,
  };
}
export const history = () => Array.from({ length: 4 }, (_, i) => bar(i));
export const long = (i = 4, overrides = {}) =>
  bar(i, { low: 99, close: 101, ...overrides });
export const short = (i = 4, overrides = {}) =>
  bar(i, { high: 111, close: 109, ...overrides });
