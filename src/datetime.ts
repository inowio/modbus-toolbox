export function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const parts = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const map = new Map(parts.map((p) => [p.type, p.value]));
  const day = map.get("day") ?? "";
  const month = map.get("month") ?? "";
  const year = map.get("year") ?? "";
  const hour = map.get("hour") ?? "";
  const minute = map.get("minute") ?? "";
  const second = map.get("second") ?? "";

  const date = `${day} ${month} ${year}`.trim();
  const time = `${hour}:${minute}:${second}`.replace(/:+$/, "");
  return `${date} ${time}`.trim();
}
