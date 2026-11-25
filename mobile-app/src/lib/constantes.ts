import type { Canal, Estado, Paso } from "../types/swi";

export const CANALES: readonly Canal[] = ["WEB", "APP", "WHATSAPP", "CALL_CENTER", "CLINICA"];

/** Estados en los que el trámite sigue abierto y se puede retomar. */
export const ESTADOS_EN_CURSO: readonly Estado[] = [
  "COTIZANDO",
  "CLINICA_SELECCIONADA",
  "DATOS_CAPTURADOS",
  "ABANDONADO",
];

/** Estados que representan una cita agendada o confirmada. */
export const ESTADOS_CITA: readonly Estado[] = ["AGENDADO", "CONFIRMADO"];

export const ETIQUETA_CANAL: Record<Canal, string> = {
  WEB: "Web",
  APP: "App",
  WHATSAPP: "WhatsApp",
  CALL_CENTER: "Call Center",
  CLINICA: "Clínica",
};

/** Forma natural en frases ("Lo dejaste en ...", "Retomamos tu trámite donde lo dejaste en ..."). */
export const CANAL_NOMBRE: Record<Canal, string> = {
  WEB: "el sitio web",
  APP: "la app",
  WHATSAPP: "WhatsApp",
  CALL_CENTER: "el Call Center",
  CLINICA: "la clínica",
};

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  COTIZANDO: "Cotizando",
  CLINICA_SELECCIONADA: "Clínica seleccionada",
  DATOS_CAPTURADOS: "Datos capturados",
  ABANDONADO: "Abandonado",
  AGENDADO: "Agendado",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
};

export const ETIQUETA_PASO: Record<Paso, string> = {
  ESTUDIO: "elegir estudio",
  CLINICA: "elegir clínica",
  FECHA: "elegir horario",
  DATOS: "confirmar datos",
  CONFIRMAR: "confirmar cita",
  LISTO: "cita confirmada",
};

/** Normaliza un teléfono mexicano a 10 dígitos (quita +52, 521, espacios y guiones). */
export function normalizarTelefono(input: string): string | null {
  const digitos = (input || "").replace(/\D/g, "");
  const diez =
    digitos.length === 12 && digitos.startsWith("52")
      ? digitos.slice(2)
      : digitos.length === 13 && digitos.startsWith("521")
        ? digitos.slice(3)
        : digitos;
  return /^\d{10}$/.test(diez) ? diez : null;
}

export function formatearTelefono(tel: string): string {
  const limpio = normalizarTelefono(tel) ?? tel;
  return limpio.length === 10
    ? `${limpio.slice(0, 3)} ${limpio.slice(3, 6)} ${limpio.slice(6)}`
    : tel;
}

export function enmascararTelefono(tel: string): string {
  const limpio = normalizarTelefono(tel);
  if (!limpio) return tel;
  return `+52******${limpio.slice(-4)}`;
}

export function generarCodigoDemo(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}
