export type AnalyzerAddressFormat = "dec" | "hex";

export function formatAnalyzerAddress(
  address: number | null | undefined,
  fmt: AnalyzerAddressFormat,
): string {
  if (address == null || !Number.isFinite(address)) return "";
  const n = Math.trunc(address);
  if (fmt === "hex") {
    return `0x${n.toString(16).toUpperCase()}`;
  }
  return String(n);
}
