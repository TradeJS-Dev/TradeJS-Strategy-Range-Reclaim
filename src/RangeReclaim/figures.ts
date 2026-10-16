import type { StrategyEntryModelFigures } from "@tradejs/types";
import type { ReclaimSignal } from "./engine.js";

export function buildRangeReclaimFigures(
  signal: ReclaimSignal,
  entry: number,
  stop: number,
  target: number,
  step: number,
): StrategyEntryModelFigures {
  const start = signal.range.timestamp;
  const end = signal.confirmationTimestamp + step;
  return {
    zones: [
      {
        id: "range",
        kind: "range_reclaim_source",
        start: { timestamp: start, value: signal.range.high },
        end: { timestamp: end, value: signal.range.low },
        color: "rgba(59,130,246,0.12)",
      },
    ],
    lines: [
      ["range_high", signal.range.high],
      ["range_low", signal.range.low],
      ["midpoint", (signal.range.high + signal.range.low) / 2],
      ["stop", stop],
      ["target", target],
    ].map(([kind, value]) => ({
      id: String(kind),
      kind: `range_reclaim_${kind}`,
      points: [
        { timestamp: start, value: Number(value) },
        { timestamp: end, value: Number(value) },
      ],
      color:
        kind === "stop" ? "#ef4444" : kind === "target" ? "#22c55e" : "#3b82f6",
    })),
    points: [
      {
        id: "sweep",
        kind: "range_reclaim_sweep",
        points: [
          {
            timestamp: signal.timestamp,
            value:
              signal.direction === "LONG"
                ? signal.range.low
                : signal.range.high,
          },
        ],
        color: "#f59e0b",
        radius: 4,
      },
      {
        id: "extreme",
        kind: "range_reclaim_extreme",
        points: [{ timestamp: signal.extremeTimestamp, value: signal.extreme }],
        color: "#f59e0b",
        radius: 4,
      },
      {
        id: "confirmation",
        kind: "range_reclaim_confirmation",
        points: [
          { timestamp: signal.confirmationTimestamp, value: signal.close },
        ],
        color: "#8b5cf6",
        radius: 7,
      },
      {
        id: "entry",
        kind: "range_reclaim_entry",
        points: [{ timestamp: signal.confirmationTimestamp, value: entry }],
        color: "#22c55e",
        radius: 3,
      },
    ],
  };
}
