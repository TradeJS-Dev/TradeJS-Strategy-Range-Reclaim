import type { CreateStrategyCore } from "@tradejs/types";
import { buildTradeEconomics } from "@tradejs/strategy-kit/risk";
import { parseConfig, type RangeReclaimConfig } from "./config.js";
import { createRangeReclaimEngine, type EngineState } from "./engine.js";
import { buildRangeReclaimFigures } from "./figures.js";

interface CoreState {
  engine: EngineState;
  handledTimestamp: number | null;
  entryTimestamp: number | null;
}

export const createRangeReclaimCore: CreateStrategyCore<
  RangeReclaimConfig
> = async ({ config, data: initialData, strategyApi }) => {
  const c = parseConfig(config);
  const step = Number(c.INTERVAL) * 60_000;
  const state = strategyApi.createStateController<CoreState>(
    "RangeReclaim",
    () => ({
      engine: createRangeReclaimEngine({
        config: c,
        initialCandles: initialData,
      }).getState(),
      handledTimestamp: null,
      entryTimestamp: null,
    }),
    { configKey: JSON.stringify(c) },
  );

  return async () => {
    const { candle, currentPrice, timestamp } =
      await strategyApi.getDecisionPriceContext();
    const s = state.get();
    if (s.handledTimestamp !== null && timestamp <= s.handledTimestamp)
      return strategyApi.skip("RANGE_RECLAIM_ALREADY_HANDLED");
    const engine = createRangeReclaimEngine({ config: c, state: s.engine });
    const result = engine.next(candle);
    state.update((draft) => {
      draft.engine = engine.getState();
      draft.handledTimestamp = timestamp;
    });
    const position = await strategyApi.getCurrentPosition();
    if (position && position.qty > 0) {
      const unknownEntryAge =
        s.entryTimestamp === null ||
        !Number.isSafeInteger(s.entryTimestamp) ||
        s.entryTimestamp < 0 ||
        s.entryTimestamp > timestamp;
      // Position has no opening timestamp in the public contract. A checkpoint is
      // required to know age; close conservatively when that evidence is absent.
      if (
        unknownEntryAge ||
        timestamp >= s.entryTimestamp! + c.RANGE_RECLAIM_MAX_HOLD_BARS * step
      ) {
        return strategyApi.exit({
          direction: position.direction,
          code: unknownEntryAge
            ? "RANGE_RECLAIM_UNKNOWN_POSITION_AGE"
            : "RANGE_RECLAIM_MAX_HOLD",
        });
      }
      return strategyApi.skip("RANGE_RECLAIM_POSITION_EXISTS");
    }
    state.update((draft) => {
      draft.entryTimestamp = null;
    });
    const signal = result.signal;
    if (!signal) return strategyApi.skip(`RANGE_RECLAIM_${result.reason}`);
    const side = c[signal.direction];
    if (!side.enable) return strategyApi.skip("RANGE_RECLAIM_SIDE_DISABLED");
    const buffer = signal.atr * c.RANGE_RECLAIM_STOP_ATR_BUFFER;
    const stop =
      signal.extreme + (signal.direction === "LONG" ? -buffer : buffer);
    const target =
      c.RANGE_RECLAIM_TARGET === "midpoint"
        ? (signal.range.high + signal.range.low) / 2
        : signal.direction === "LONG"
          ? signal.range.high
          : signal.range.low;
    const sign = signal.direction === "LONG" ? 1 : -1;
    if (
      stop <= 0 ||
      sign * (currentPrice - stop) <= 0 ||
      sign * (target - currentPrice) <= 0
    )
      return strategyApi.skip("RANGE_RECLAIM_INVALID_PLAN");
    const economics = buildTradeEconomics({
      entryPrice: currentPrice,
      stopLossPrice: stop,
      takeProfitPrice: target,
      feeRate: c.RISK_FEE_RATE,
      slippageBps: c.RISK_SLIPPAGE_BPS + c.RISK_MARKET_IMPACT_BPS,
    });
    const costShare =
      economics.roundTripEntryTargetCostPerUnit / economics.grossRewardPerUnit;
    if (
      c.RANGE_RECLAIM_MAX_COST_SHARE > 0 &&
      costShare > c.RANGE_RECLAIM_MAX_COST_SHARE
    )
      return strategyApi.skip("RANGE_RECLAIM_COST_SHARE");
    const qty = c.MAX_LOSS_VALUE / economics.lossPerUnit;
    if (
      economics.netRiskRatio < side.minRiskRatio ||
      !Number.isFinite(qty) ||
      qty <= 0
    )
      return strategyApi.skip("RANGE_RECLAIM_INSUFFICIENT_RISK_RATIO");
    const decision = await strategyApi.entry({
      direction: signal.direction,
      signalId: `RangeReclaim:${signal.range.timestamp}:${signal.direction}:${signal.timestamp}`,
      orderPlan: {
        qty,
        stopLossPrice: stop,
        takeProfits: [{ price: target, rate: 1 }],
      },
      figures: buildRangeReclaimFigures(
        signal,
        currentPrice,
        stop,
        target,
        step,
      ),
      additionalIndicators: {
        rangeReclaim: signal,
        netRiskRatio: economics.netRiskRatio,
        ...(c.RANGE_RECLAIM_MAX_COST_SHARE > 0 ? { costShare } : {}),
      },
    });
    state.update((draft) => {
      draft.entryTimestamp = timestamp;
    });
    return decision;
  };
};
