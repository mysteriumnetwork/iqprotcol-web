import { formatUnits } from "ethers";
import { MYST_DECIMALS } from "./config";

/** Format raw MYST (18 decimals) for display. */
export function formatMyst(value: bigint, fractionDigits = 2): string {
  const asNumber = Number(formatUnits(value, MYST_DECIMALS));
  if (!Number.isFinite(asNumber)) {
    return formatUnits(value, MYST_DECIMALS);
  }
  return asNumber.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
