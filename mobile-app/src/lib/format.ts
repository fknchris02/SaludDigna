export const TZ = "America/Mexico_City";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    const cdmx = new Date(d.getTime() - 6 * 3600_000);
    const hh = String(cdmx.getUTCHours()).padStart(2, "0");
    const mm = String(cdmx.getUTCMinutes()).padStart(2, "0");
    return `${DIAS[cdmx.getUTCDay()]}, ${cdmx.getUTCDate()} ${MESES[cdmx.getUTCMonth()]}, ${hh}:${mm}`;
  }
}

export function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "hace 3 min", "hace 2 h" — mismo formato que SaludDigna/lib/format.ts */
export function ago(iso: string | Date, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** SWI devuelve precios en pesos MXN (ej. 450 -> "$450"). */
export function formatMoney(pesos: number): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(pesos);
  } catch {
    return `$${Math.round(pesos)}`;
  }
}
