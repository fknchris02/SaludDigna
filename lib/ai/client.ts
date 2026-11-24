import Anthropic from "@anthropic-ai/sdk";

// Modelo configurable por entorno; por defecto el Opus actual con esfuerzo bajo (tareas cortas de clasificación/resumen).
export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null | undefined;

/**
 * Cliente de Claude, o null si la IA está apagada (sin ANTHROPIC_API_KEY o con AI_DISABLED=1).
 * Con null, todo el sistema funciona con reglas: la demo nunca depende del LLM.
 */
export function getAi(): Anthropic | null {
  if (process.env.AI_DISABLED === "1") return null;
  if (client === undefined) {
    // Timeout corto y sin reintentos: si tarda, el paciente recibe la respuesta por reglas en lugar de esperar.
    client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 6000, maxRetries: 0 }) : null;
  }
  return client;
}

/** Quita lo que parezca dato personal antes de mandar texto al LLM (teléfonos, folios largos, correos). */
export function redact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[correo]")
    .replace(/\+?\d(?:[\s-]?\d){6,}/g, "[número]"); // 7+ dígitos (con espacios o guiones) que terminan en dígito
}
