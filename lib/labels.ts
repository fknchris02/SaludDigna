// Etiquetas legibles compartidas por servidor y navegador (sin dependencias de BD).
export const CHANNEL_NAME = { WEB: "el sitio web", APP: "la app", CALL_CENTER: "el Call Center", WHATSAPP: "WhatsApp", SYSTEM: "el sistema" } as const;
export const CHANNEL_LABEL: Record<string, string> = { WEB: "Web", APP: "App", CALL_CENTER: "Call Center", WHATSAPP: "WhatsApp", SYSTEM: "Sistema", CLINICA: "Clínica" };

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
  SWI_EVENTO: "Evento de SWI",
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
  PATIENT_UPDATED: "Datos del paciente capturados",
};

export const INTENT_LABEL: Record<string, string> = {
  CANCELAR: "cancelar",
  HABLAR_ASESOR: "hablar con un asesor",
  PREGUNTA_PREPARACION: "preparación del estudio",
  PREGUNTA_PRECIO: "precio",
  ELEGIR_OPCION: "eligió una opción con sus palabras",
};

export const METHOD_LABEL: Record<string, string> = {
  OTP: "código por SMS",
  BIRTHDATE: "fecha de nacimiento",
  WHATSAPP_NUMBER: "número de WhatsApp (registro nuevo)",
  ASESOR_2_DATOS: "asesor: fecha de nacimiento + últimos 4 dígitos",
};

/** Los recorridos que vienen de SWI llevan este prefijo en el tablero del admin (sus ids no son trámites nuestros). */
export const SWI_PREFIX = "swi:";
/** Folio que ve el paciente en un trámite de SWI: "SD-" + los últimos 6 caracteres del id. */
export const swiFolio = (id: string) => `SD-${id.slice(-6).toUpperCase()}`;

/** Eventos que manda la app SWI (POST /api/integraciones/swi); los desconocidos se muestran con su clave. */
export const SWI_EVENT_LABEL: Record<string, string> = {
  COTIZACION_INICIADA: "Inició cotización",
  DATOS_CAPTURADOS: "Capturó sus datos",
  PAGO_EN_CLINICA: "Pagará en la clínica",
  CORREO_ENVIADO: "Correo enviado",
  NOTA_ASESOR: "Nota del asesor",
  CONTEXTO_CONSULTADO: "Asesor consultó su expediente",
  CITA_VISUALIZADA: "Vio su cita en la app",
  LLAMADA_RECIBIDA: "Llamó al Call Center",
  TRANSFERENCIA_ASESOR: "Pidió hablar con un asesor",
  TRAMITE_ELIMINADO: "Eliminó un trámite",
  REPORTE_ENVIADO: "Reporte de la consulta enviado",
  CITA_PARA_FAMILIAR: "Agendó para un familiar",
  PACIENTE_REGISTRADO: "Paciente registrada",
  ESTUDIO_SELECCIONADO: "Estudio seleccionado",
  CLINICA_SELECCIONADA: "Clínica seleccionada",
  FECHA_SELECCIONADA: "Fecha seleccionada",
  CITA_AGENDADA: "Cita agendada",
  CITA_CONFIRMADA: "Cita confirmada",
  CITA_CANCELADA: "Cita cancelada",
  TRAMITE_ABANDONADO: "Trámite abandonado",
  TRAMITE_RETOMADO: "Trámite retomado",
  MENSAJE_RECIBIDO: "Mensaje recibido",
  MENSAJE_ENVIADO: "Mensaje enviado",
  CHECK_IN: "Llegó a la clínica",
  RESULTADOS_ENTREGADOS: "Resultados entregados",
  PAGO_APROBADO: "Pago aprobado",
  PAGO_RECHAZADO: "Pago rechazado",
};
