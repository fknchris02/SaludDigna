import type { Contexto, Paciente, Tramite } from "../types/swi";
import { ESTADOS_EN_CURSO, esRegistroCompleto } from "./constantes";
import { fechaLocal } from "./horarios";

export type BookingView = "ESTUDIO" | "CLINICA" | "HORARIO" | "DATOS" | "CITA" | "LISTO";

export const WIZARD_STEPS: { view: BookingView | "IDENTIDAD"; label: string }[] = [
  { view: "IDENTIDAD", label: "Tu teléfono" },
  { view: "ESTUDIO", label: "Estudio" },
  { view: "CLINICA", label: "Clínica" },
  { view: "HORARIO", label: "Horario" },
  { view: "CITA", label: "Confirmar" },
];

/**
 * Determina qué pantalla toca en BookingFlow según el estado real del trámite en SWI.
 * Refleja la máquina de estados de SaludDigna/app sobre el modelo de trámites de SWI.
 */
export function viewForTramite(
  t: Tramite | null,
  paciente: Pick<Paciente, "datosCompletos" | "registroCompleto" | "faltanDatos"> | null,
): BookingView {
  if (!t || t.estado === "CANCELADO") return "ESTUDIO";
  if (t.estado === "AGENDADO" || t.estado === "CONFIRMADO") return "LISTO";

  if (!t.estudio?.id) return "ESTUDIO";
  if (!t.clinica?.id) return "CLINICA";
  if (!t.fechaCita) return "HORARIO";

  if (t.paso === "CONFIRMAR" || t.estado === "DATOS_CAPTURADOS") {
    return !esRegistroCompleto(paciente) ? "DATOS" : "CITA";
  }
  return "DATOS";
}

export function wizardIndexFor(view: BookingView): number {
  if (view === "DATOS") return 4;
  if (view === "LISTO") return 5;
  return WIZARD_STEPS.findIndex((w) => w.view === view);
}

/** Separa los trámites del contexto SWI en: trámite en curso, próximas citas e historial. */
export function splitContextoTramites(ctx: Contexto, ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  const enCurso =
    (ctx.tramiteActivo && ESTADOS_EN_CURSO.includes(ctx.tramiteActivo.estado)
      ? ctx.tramiteActivo
      : ctx.tramites.find((t) => ESTADOS_EN_CURSO.includes(t.estado))) ?? null;

  const cerrados = ctx.tramites.filter((t) => !ESTADOS_EN_CURSO.includes(t.estado));
  const upcoming = cerrados
    .filter(
      (t) =>
        (t.estado === "AGENDADO" || t.estado === "CONFIRMADO") &&
        Boolean(t.fechaCita) &&
        fechaLocal(new Date(t.fechaCita!)) >= hoy,
    )
    .sort((a, b) => +new Date(a.fechaCita!) - +new Date(b.fechaCita!));

  const upcomingIds = new Set(upcoming.map((t) => t.id));
  const history = cerrados
    .filter((t) => !upcomingIds.has(t.id))
    .sort((a, b) => +new Date(b.actualizadoEn) - +new Date(a.actualizadoEn));

  return { active: enCurso, upcoming, history };
}
