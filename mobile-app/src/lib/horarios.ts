import type { Horarios } from "../types/swi";

// México (CDMX) usa UTC-6 fijo desde 2022, así que construimos las fechas con offset -06:00.
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type DiaDisponible = {
  fecha: string;
  etiqueta: string;
  diaSemana: number;
  horas: string[];
};

/** Fecha local CDMX (YYYY-MM-DD) de un Date, con fallback determinístico a UTC-6. */
export function fechaLocal(d: Date): string {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  } catch {
    // fallback a cálculo directo UTC-6
  }
  const cdmx = new Date(d.getTime() - 6 * 3600_000);
  const y = cdmx.getUTCFullYear();
  const m = String(cdmx.getUTCMonth() + 1).padStart(2, "0");
  const day = String(cdmx.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function aFechaCDMX(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora}:00-06:00`);
}

function etiquetaDia(fecha: string): string {
  const ref = new Date(`${fecha}T12:00:00-06:00`);
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(ref);
  } catch {
    return `${DIAS[ref.getUTCDay()]}, ${ref.getUTCDate()} ${MESES[ref.getUTCMonth()]}`;
  }
}

/**
 * Próximos `n` días con espacios cada 30 min dentro del horario de la clínica
 * (descarta horas pasadas o menores a `anticipacionMin` minutos).
 */
export function espaciosDisponibles(
  h: Horarios,
  n = 7,
  ahora = new Date(),
  anticipacionMin = 60,
): DiaDisponible[] {
  const dias: DiaDisponible[] = [];
  const hoy = fechaLocal(ahora);
  for (let i = 0; i < n + 3 && dias.length < n; i++) {
    const base = new Date(`${hoy}T12:00:00-06:00`);
    base.setUTCDate(base.getUTCDate() + i);
    const fecha = fechaLocal(base);
    const diaSemana = new Date(`${fecha}T12:00:00-06:00`).getUTCDay();
    const rango = h[String(diaSemana)];
    if (!rango) continue;
    const horas: string[] = [];
    const [ah, am] = rango[0].split(":").map(Number);
    const [ch, cm] = rango[1].split(":").map(Number);
    for (let m = ah * 60 + am; m <= ch * 60 + cm - 30; m += 30) {
      const hora = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      if (aFechaCDMX(fecha, hora).getTime() > ahora.getTime() + anticipacionMin * 60 * 1000) {
        horas.push(hora);
      }
    }
    if (horas.length === 0) continue;
    dias.push({ fecha, etiqueta: etiquetaDia(fecha), diaSemana, horas });
  }
  return dias;
}
