export type Intent =
  | "SALUDO"
  | "CANCELAR"
  | "HABLAR_ASESOR"
  | "PREGUNTA_PREPARACION"
  | "PREGUNTA_PRECIO"
  | "OTRO";

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

/** Clasificación por reglas: es el respaldo cuando no hay LLM, así la demo nunca depende de la IA. */
export function classifyByRules(text: string): Intent {
  const t = normalize(text);
  return RULES.find(([, re]) => re.test(t))?.[0] ?? "OTRO";
}

/** Punto único para clasificar intención. Aquí se conectará el LLM (con classifyByRules como respaldo). */
export async function classifyIntent(text: string): Promise<{ intent: Intent; source: "rules" | "llm" }> {
  return { intent: classifyByRules(text), source: "rules" };
}
