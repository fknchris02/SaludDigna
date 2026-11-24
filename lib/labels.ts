// Etiquetas legibles compartidas por servidor y navegador (sin dependencias de BD).
export const CHANNEL_NAME = { WEB: "el sitio web", APP: "la app", CALL_CENTER: "el Call Center", WHATSAPP: "WhatsApp", SYSTEM: "el sistema" } as const;
export const CHANNEL_LABEL: Record<string, string> = { WEB: "Web", APP: "App", CALL_CENTER: "Call Center", WHATSAPP: "WhatsApp", SYSTEM: "Sistema" };

export const STEPS = ["INICIADO", "ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS", "CITA_CONFIRMADA"] as const;
export const STEP_LABEL: Record<string, string> = {
  INICIADO: "Iniciado",
  ESTUDIO_ELEGIDO: "Estudio",
  CLINICA_ELEGIDA: "Clínica",
  HORARIO_ELEGIDO: "Horario",
  DATOS_CONFIRMADOS: "Datos confirmados",
  CITA_CONFIRMADA: "Cita confirmada",
  CANCELADO: "Cancelado",
};
/** Qué falta cuando el trámite está en ese paso. */
export const PENDING_LABEL: Record<string, string> = {
  ESTUDIO_ELEGIDO: "elegir estudio",
  CLINICA_ELEGIDA: "elegir clínica",
  HORARIO_ELEGIDO: "elegir horario",
  DATOS_CONFIRMADOS: "confirmar datos",
  CITA_CONFIRMADA: "confirmar cita",
};

export const EVENT_LABEL: Record<string, string> = {
  IDENTITY_ANONYMOUS_CREATED: "Visitante anónimo",
  IDENTITY_LINKED: "Identidad ligada",
  IDENTITY_VERIFIED: "Identidad verificada",
  OTP_SENT: "Código enviado",
  OTP_FAILED: "Verificación fallida",
  CASE_CREATED: "Trámite creado",
  STEP_COMPLETED: "Paso completado",
  CASE_RESUMED: "Cambio de canal",
  MESSAGE_IN: "Mensaje del paciente",
  MESSAGE_OUT: "Respuesta del bot",
  INTENT_CLASSIFIED: "Intención detectada",
  ADVISOR_OPENED_CASE: "Expediente consultado",
  APPOINTMENT_CONFIRMED: "Cita confirmada",
  CASE_CANCELLED: "Trámite cancelado",
  CONFLICT_DETECTED: "Conflicto entre canales",
};

export const INTENT_LABEL: Record<string, string> = {
  CANCELAR: "cancelar",
  HABLAR_ASESOR: "hablar con un asesor",
  PREGUNTA_PREPARACION: "preparación del estudio",
  PREGUNTA_PRECIO: "precio",
};

export const METHOD_LABEL: Record<string, string> = {
  OTP: "código por SMS",
  BIRTHDATE: "fecha de nacimiento",
  WHATSAPP_NUMBER: "número de WhatsApp (registro nuevo)",
  ASESOR_2_DATOS: "asesor: fecha de nacimiento + últimos 4 dígitos",
};
