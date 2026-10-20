import type { Signal } from "@tradejs/types";
import type { RangeReclaimConfig } from "./config.js";
import { buildRangeReclaimGateFeatures } from "./features.js";

/** Frozen research policies, not validated live recommendations. */
export function evaluateCombinedEntryPolicy(
  policy: RangeReclaimConfig["RANGE_RECLAIM_ENTRY_POLICY"],
  signal: Signal | undefined,
): { allow: boolean; reason: string } {
  if (policy === "off")
    return { allow: true, reason: "RANGE_RECLAIM_POLICY_OFF" };
  if (!signal || signal.interval !== "15")
    return { allow: false, reason: "RANGE_RECLAIM_POLICY_INVALID_SIGNAL" };
  const geometry = buildRangeReclaimGateFeatures(signal);
  if (!geometry || geometry.sourceIntervalMinutes !== 240)
    return { allow: false, reason: "RANGE_RECLAIM_POLICY_INVALID_GEOMETRY" };
  const purple = geometry.reclaimRatio >= 0.1;
  const short = signal.direction === "SHORT";
  const orange =
    short && (geometry.rangeWidthAtr > 6 || geometry.rangeWidthBps > 3475);
  let allow: boolean;
  switch (policy) {
    case "purple":
      allow = purple;
      break;
    case "orange":
      allow = orange;
      break;
    case "purple-short":
      allow = purple && short;
      break;
    case "intersection":
      allow = purple && orange;
      break;
    case "union":
      allow = purple || orange;
      break;
    default:
      return { allow: false, reason: "RANGE_RECLAIM_POLICY_UNKNOWN" };
  }
  return {
    allow,
    reason: `RANGE_RECLAIM_POLICY_${policy.toUpperCase().replaceAll("-", "_")}_${allow ? "ALLOW" : "BLOCK"}`,
  };
}
