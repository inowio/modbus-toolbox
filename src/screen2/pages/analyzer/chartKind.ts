export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getChartKind(configJson: string | null | undefined): string | null {
  if (!configJson) return null;
  const parsed = safeJsonParse(configJson);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const v = obj.chartKind;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}
