import type { Case, Event } from "@prisma/client";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AI_MODEL, getAi, redact } from "./client";
import { ago, formatDate } from "@/lib/format";
import { CHANNEL_LABEL, INTENT_LABEL, PENDING_LABEL, SWI_EVENT_LABEL } from "@/lib/labels";
import { SWI_INTERNAL } from "@/lib/integrations/swi";

// Eventos de SWI (sus cinco canales): su canal real va en el payload. Los internos (CONTEXTO_CONSULTADO) se omiten.
type SwiPayload = { tipoEvento?: string; canal?: string; texto?: string };
const isSwi = (e: Event) => e.type === "SWI_EVENTO" && !SWI_INTERNAL.has(String((e.payload as SwiPayload).tipoEvento));
const channelOf = (e: Event) => (e.type === "SWI_EVENTO" ? String((e.payload as SwiPayload).canal ?? e.channel) : e.channel);
/** «Cita agendada (Call Center)» */
const swiLabel = (e: Event) => {
  const p = e.payload as SwiPayload;
  return `${SWI_EVENT_LABEL[p.tipoEvento ?? ""] ?? p.tipoEvento} (${CHANNEL_LABEL[channelOf(e)] ?? channelOf(e)})`;
};
// Su texto puede traer el nombre de un familiar o los dígitos de quien llamó: al LLM solo va la etiqueta.
const SWI_SIN_DETALLE = new Set(["CITA_PARA_FAMILIAR", "LLAMADA_RECIBIDA", "PACIENTE_REGISTRADO"]);

/**
 * Resumen para el asesor: lo que necesita saber en 5 segundos para no pedirle nada al paciente.
 * Por reglas (determinista): es el respaldo de summarizeWithAI y lo que se muestra al instante.
 */
export function summarizeJourney(events: Event[], active: Case | null, now = Date.now()): { lines: string[]; source: "rules" | "llm" } {
  const lines: string[] = [];
  const journey = events.filter(
    (e) =>
      [
        "CASE_CREATED",
        "STEP_COMPLETED",
        "CASE_RESUMED",
        "MESSAGE_IN",
        "APPOINTMENT_CONFIRMED",
        "CLINIC_CHECK_IN",
        "CLINIC_APPOINTMENT_BOOKED",
        "CLINIC_PAYMENT_APPROVED",
        "CLINIC_RESULTS_DELIVERED",
      ].includes(e.type) || isSwi(e),
  );
  const channels = journey.map(channelOf).filter((c, i, a) => c !== "SYSTEM" && c !== a[i - 1]);
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

  const swi = events.filter(isSwi);
  if (swi.length) lines.push(`En SWI: ${swi.slice(-3).map(swiLabel).join("; ")}.`);

  const intents = [...new Set(events.filter((e) => e.type === "INTENT_CLASSIFIED").map((e) => (e.payload as { intent: string }).intent))];
  const asked = intents.filter((i) => i !== "HABLAR_ASESOR" && i !== "ELEGIR_OPCION").map((i) => INTENT_LABEL[i]).filter(Boolean);
  if (asked.length) lines.push(`Preguntó por: ${asked.join(", ")}.`);
  const wantsAdvisor = events.findLast((e) => e.type === "INTENT_CLASSIFIED" && (e.payload as { intent: string }).intent === "HABLAR_ASESOR");
  if (wantsAdvisor) lines.push(`Pidió hablar con un asesor por ${CHANNEL_LABEL[wantsAdvisor.channel]} ${ago(wantsAdvisor.createdAt, now)}.`);

  const last = journey.at(-1);
  if (last) lines.push(`Último contacto: ${CHANNEL_LABEL[channelOf(last)] ?? channelOf(last)}, ${ago(last.createdAt, now)}.`);
  return { lines, source: "rules" };
}

/** Cierra con punto sin duplicarlo ("10:00 a.m." ya termina en punto). */
const sentence = (t: string) => (t.endsWith(".") ? t : t + ".");

const ORDER = ["INICIADO", "ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS", "CITA_CONFIRMADA"];
const nextStep = (step: string) => ORDER[ORDER.indexOf(step) + 1] ?? "";

// ───────────── Resumen con IA (con el resumen por reglas como respaldo) ─────────────

const AiSummary = z.object({ lines: z.array(z.string()).min(1).max(5) });

const SUMMARY_SYSTEM = `Eres el copiloto de un asesor de Call Center de Salud Digna (laboratorio clínico e imagenología en México).
Recibes el historial de un paciente en distintos canales (Web, WhatsApp, App, Call Center y Clínica), incluidos los eventos del sistema SWI, y su trámite abierto.
Escribe de 3 a 5 líneas cortas en español para que el asesor atienda SIN pedirle al paciente que repita nada:
qué quiere, en qué paso va y por qué canales pasó, qué falta, qué dudas o preocupaciones mostró, y la siguiente acción sugerida.
Usa solo lo que está en el historial; no inventes datos. Sin saludos ni markdown.`;

// shortcut: caché en memoria por proceso; con varias instancias, moverla a Redis o a la BD.
const summaryCache = new Map<string, { lines: string[]; source: "rules" | "llm" }>();

/** Resumen para el asesor con Claude. Se cachea por (trámite, último evento): solo se recalcula si algo cambió. */
export async function summarizeWithAI(events: Event[], active: Case | null, now = Date.now()) {
  const rules = summarizeJourney(events, active, now);
  const ai = getAi();
  if (!ai || events.length === 0) return rules;

  const key = `${active?.id ?? "-"}:${events.at(-1)!.seq}`;
  const hit = summaryCache.get(key);
  if (hit) return hit;

  try {
    const res = await ai.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AiSummary) },
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: journeyFacts(events, active, now) }],
    });
    const out = res.stop_reason === "refusal" ? null : res.parsed_output;
    if (!out) return rules;
    const result = { lines: out.lines, source: "llm" as const };
    if (summaryCache.size > 500) summaryCache.delete(summaryCache.keys().next().value!);
    summaryCache.set(key, result);
    return result;
  } catch (err) {
    console.warn("ia: resumen por reglas (falló el LLM):", err instanceof Error ? err.message : err);
    return rules;
  }
}

/** Historial en texto para el LLM. Sin nombre, teléfono ni fecha de nacimiento del paciente. */
export function journeyFacts(events: Event[], active: Case | null, now = Date.now()) {
  const lines: string[] = [];
  for (const e of events.slice(-60)) {
    const p = e.payload as Record<string, unknown>;
    const when = ago(e.createdAt, now);
    const ch = CHANNEL_LABEL[e.channel];
    if (e.type === "MESSAGE_IN") lines.push(`${when} · ${ch} · paciente escribió: "${redact(String(p.text ?? "")).slice(0, 200)}"`);
    else if (e.type === "STEP_COMPLETED" || e.type === "APPOINTMENT_CONFIRMED" || e.type === "CASE_CANCELLED") lines.push(`${when} · ${ch} · trámite pasó a ${String(p.to)}`);
    else if (e.type === "CASE_RESUMED") lines.push(`${when} · cambió de ${CHANNEL_LABEL[String(p.from)]} a ${CHANNEL_LABEL[String(p.to)]}`);
    else if (e.type === "INTENT_CLASSIFIED") lines.push(`${when} · ${ch} · intención detectada: ${String(p.intent)}`);
    else if (e.type === "CASE_CREATED") lines.push(`${when} · ${ch} · inició un trámite`);
    else if (e.type === "CONFLICT_DETECTED") lines.push(`${when} · ${ch} · edición simultánea bloqueada`);
    else if (isSwi(e)) {
      const sw = e.payload as SwiPayload;
      const detail = sw.texto && !SWI_SIN_DETALLE.has(sw.tipoEvento ?? "") ? `: ${redact(sw.texto).slice(0, 160)}` : "";
      lines.push(`${when} · SWI · ${swiLabel(e)}${detail}`);
    } else if (e.type === "CLINIC_CHECK_IN") lines.push(`${when} · ${ch} · registró llegada en clínica${p.clinica ? ` (${String(p.clinica)})` : ""}`);
    else if (e.type === "CLINIC_APPOINTMENT_BOOKED") lines.push(`${when} · ${ch} · agendó cita en mostrador${p.estudio ? ` (${String(p.estudio)})` : ""}`);
    else if (e.type === "CLINIC_PAYMENT_APPROVED") lines.push(`${when} · ${ch} · pago aprobado en clínica`);
    else if (e.type === "CLINIC_PAYMENT_REJECTED") lines.push(`${when} · ${ch} · pago rechazado en clínica`);
    else if (e.type === "CLINIC_RESULTS_DELIVERED") lines.push(`${when} · ${ch} · recibió resultados en clínica`);
  }
  let tramite = "Sin trámite abierto.";
  if (active) {
    const d = active.data as Record<string, string>;
    tramite = [
      `Paso actual: ${active.step}. Falta: ${PENDING_LABEL[nextStep(active.step)] ?? "nada"}.`,
      d.estudio && `Estudio: ${d.estudio}.`,
      d.clinica && `Clínica: ${d.clinica}.`,
      d.horario && `Horario: ${formatDate(d.horario)}.`,
      d.preparacion && `Preparación del estudio: ${d.preparacion}`,
    ].filter(Boolean).join("\n");
  }
  return `Trámite abierto:\n${tramite}\n\nHistorial (más antiguo primero):\n${lines.join("\n") || "(sin eventos)"}`;
}
