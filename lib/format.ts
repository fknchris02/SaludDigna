// Formato compartido por servidor y navegador (sin dependencias de BD).
export const TZ = "America/Mazatlan"; // Sinaloa

/** Próximos 2 días hábiles (lun-sáb) a las 08, 10 y 12 h de Sinaloa. shortcut: horarios fijos; usar disponibilidad real de la clínica. */
export function slots(now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 1; out.length < 6 && i < 10; i++) {
    const day = new Date(now.getTime() + i * 86400_000);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(day);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    if (get("weekday") === "Sun") continue;
    for (const h of ["08", "10", "12"]) out.push(`${get("year")}-${get("month")}-${get("day")}T${h}:00:00-07:00`);
  }
  return out;
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatTime(iso: string | Date) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

/** "hace 3 min", "hace 2 h" */
export function ago(iso: string | Date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export const money = (centavos: number) => (centavos / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
