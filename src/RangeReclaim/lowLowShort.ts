import type { Signal } from "@tradejs/types";

export function isLowLowShort(signal: Signal | undefined): boolean {
  if (signal?.direction !== "SHORT") return false;
  const profile: unknown = signal.additionalIndicators?.tickerProfile;
  if (typeof profile !== "object" || profile === null) return false;
  const p = profile as Record<string, unknown>;
  return (
    p.symbol === signal.symbol &&
    typeof p.asOf === "number" &&
    typeof p.validUntil === "number" &&
    Number.isFinite(p.asOf) &&
    Number.isFinite(p.validUntil) &&
    p.asOf <= signal.timestamp &&
    signal.timestamp < p.validUntil &&
    p.moneyGroup === "low" &&
    p.volatilityGroup === "low"
  );
}
