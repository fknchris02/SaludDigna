import type { Case, Event } from "@prisma/client";
import { ago, formatDate } from "@/lib/format";
import { CHANNEL_LABEL, INTENT_LABEL, PENDING_LABEL } from "@/lib/labels";

/**
 * Resumen para el asesor: lo que necesita saber en 5 segundos para no pedirle nada al paciente.
 * Por reglas (determinista); aquí se conectará el LLM con esto como respaldo.
 */
export function summarizeJourney(events: Event[], active: Case | null, now = Date.now()): { lines: string[]; source: "rules" | "llm" } {
  const lines: string[] = [];
  const journey = events.filter((e) => ["CASE_CREATED", "STEP_COMPLETED", "CASE_RESUMED", "MESSAGE_IN", "APPOINTMENT_CONFIRMED"].includes(e.type));
  const channels = journey.map((e) => e.channel).filter((c, i, a) => c !== "SYSTEM" && c !== a[i - 1]);
  if (channels.length) lines.push(`Recorrido: ${channels.map((c) => CHANNEL_LABEL[c]).join(" → ")}.`);

  if (active) {
    const d = active.data as Record<string, string>;
    const parts = [d.estudio, d.clinica && `en ${d.clinica}`, d.horario && `el ${formatDate(d.horario)}`].filter(Boolean);
    lines.push(parts.length ? sentence(`Trámite abierto: ${parts.join(" ")}`) : "Trámite abierto sin estudio elegido.");
    const next = PENDING_LABEL[nextStep(active.step)];
    if (next) lines.push(`Falta: ${next}.`);
  } else {
    const last = events.findLast((e) => e.type === "APPOINTMENT_CONFIRMED");
    const d = (last?.payload as { data?: Record<string, string> } | undefined)?.data;
    lines.push(
      d ? sentence(`Sin trámites abiertos. Última cita confirmada: ${d.estudio} en ${d.clinica} el ${formatDate(d.horario)} (folio ${d.folio})`)
        : "Sin trámites abiertos.",
    );
  }

  const intents = [...new Set(events.filter((e) => e.type === "INTENT_CLASSIFIED").map((e) => (e.payload as { intent: string }).intent))];
  const asked = intents.filter((i) => i !== "HABLAR_ASESOR").map((i) => INTENT_LABEL[i]).filter(Boolean);
  if (asked.length) lines.push(`Preguntó por: ${asked.join(", ")}.`);
  const wantsAdvisor = events.findLast((e) => e.type === "INTENT_CLASSIFIED" && (e.payload as { intent: string }).intent === "HABLAR_ASESOR");
  if (wantsAdvisor) lines.push(`Pidió hablar con un asesor por ${CHANNEL_LABEL[wantsAdvisor.channel]} ${ago(wantsAdvisor.createdAt, now)}.`);

  const last = journey.at(-1);
  if (last) lines.push(`Último contacto: ${CHANNEL_LABEL[last.channel]}, ${ago(last.createdAt, now)}.`);
  return { lines, source: "rules" };
}

/** Cierra con punto sin duplicarlo ("10:00 a.m." ya termina en punto). */
const sentence = (t: string) => (t.endsWith(".") ? t : t + ".");

const ORDER = ["INICIADO", "ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS", "CITA_CONFIRMADA"];
const nextStep = (step: string) => ORDER[ORDER.indexOf(step) + 1] ?? "";
