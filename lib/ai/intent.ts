import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AI_MODEL, getAi, redact } from "./client";

export const INTENTS = ["SALUDO", "CANCELAR", "HABLAR_ASESOR", "PREGUNTA_PREPARACION", "PREGUNTA_PRECIO", "OTRO"] as const;
export type Intent = (typeof INTENTS)[number];

/** minúsculas, sin acentos ni signos: "¿Necesito AYUNO?" → "necesito ayuno" */
export function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
}

const RULES: [Intent, RegExp][] = [
  ["CANCELAR", /\b(cancelar|cancela|cancelo|ya no quiero)\b/],
  ["HABLAR_ASESOR", /\b(asesor|agente|persona|humano|llamar|ayuda)\b/],
  ["PREGUNTA_PREPARACION", /\b(ayuno|ayunas|preparacion|prepararme|preparar|desodorante|comer|tomar agua)\b/],
  ["PREGUNTA_PRECIO", /\b(precio|cuesta|costo|cuanto|pagar)\b/],
  ["SALUDO", /^(hola|buenas|buenos dias|buenas tardes|buenas noches|menu|inicio|hey|que tal)\b/],
];

/** Clasificación por reglas: el respaldo cuando no hay LLM, así la demo nunca depende de la IA. */
export function classifyByRules(text: string): Intent {
  const t = normalize(text);
  return RULES.find(([, re]) => re.test(t))?.[0] ?? "OTRO";
}

export type Classification = { intent: Intent; option: number | null; source: "rules" | "llm" };

const LlmResult = z.object({
  intent: z.enum(INTENTS),
  // Índice (desde 1) de la opción que el paciente eligió con sus palabras, o null si no eligió ninguna.
  option: z.number().int().nullable(),
});

const SYSTEM = `Clasificas mensajes que pacientes de Salud Digna (laboratorio clínico e imagenología en México) mandan por WhatsApp a un asistente de agendado de estudios.

Devuelve:
- option: si el mensaje elige una de las opciones ofrecidas, aunque sea con otras palabras ("el del miércoles temprano", "la clínica del centro", "sí, adelante"), su número (empezando en 1). Si no elige ninguna o es ambiguo, null.
- intent: lo que quiere el paciente.
  CANCELAR: quiere cancelar o desistir del trámite.
  HABLAR_ASESOR: pide hablar con una persona o necesita ayuda que el asistente no da.
  PREGUNTA_PREPARACION: pregunta cómo prepararse (ayuno, comer, medicamentos, ropa, desodorante, agua).
  PREGUNTA_PRECIO: pregunta cuánto cuesta o cómo pagar.
  SALUDO: solo saluda o pide empezar.
  OTRO: cualquier otra cosa, incluido elegir una opción.

No respondas al paciente; solo clasifica.`;

/**
 * Entiende el mensaje del paciente. Primero reglas (rápidas y deterministas); si no bastan y hay LLM,
 * le pide a Claude la intención y si el texto libre corresponde a alguna de las opciones ofrecidas.
 * Cualquier falla del LLM (sin llave, timeout, rechazo) regresa al resultado por reglas.
 */
export async function classifyMessage(text: string, options: string[] = []): Promise<Classification> {
  const byRules = classifyByRules(text);
  const ai = getAi();
  if (byRules !== "OTRO" || !ai || !text.trim()) return { intent: byRules, option: null, source: "rules" };

  try {
    const offered = options.length ? options.map((o, i) => `${i + 1}. ${o}`).join("\n") : "(ninguna)";
    const res = await ai.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // si el modelo declina, el servidor reintenta con otro modelo en la misma llamada
      output_config: { effort: "low", format: betaZodOutputFormat(LlmResult) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Opciones ofrecidas:\n${offered}\n\nMensaje del paciente:\n${redact(text).slice(0, 500)}` }],
    });
    const out = res.stop_reason === "refusal" ? null : res.parsed_output;
    if (!out) return { intent: byRules, option: null, source: "rules" };
    const option = out.option !== null && out.option >= 1 && out.option <= options.length ? out.option : null;
    return { intent: out.intent, option, source: "llm" };
  } catch (err) {
    console.warn("ia: clasificación por reglas (falló el LLM):", err instanceof Error ? err.message : err);
    return { intent: byRules, option: null, source: "rules" };
  }
}
