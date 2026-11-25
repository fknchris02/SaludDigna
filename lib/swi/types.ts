export type SwiCanal = "WEB" | "APP" | "WHATSAPP" | "CALL_CENTER" | "CLINICA";

export type SwiEstado =
  | "COTIZANDO"
  | "CLINICA_SELECCIONADA"
  | "DATOS_CAPTURADOS"
  | "ABANDONADO"
  | "AGENDADO"
  | "CONFIRMADO"
  | "CANCELADO";

export type SwiPaso = "ESTUDIO" | "CLINICA" | "FECHA" | "DATOS" | "CONFIRMAR" | "LISTO";

export type SwiAccion =
  | "ESTUDIO"
  | "CLINICA"
  | "FECHA"
  | "DATOS"
  | "AGENDAR"
  | "CONFIRMAR"
  | "CANCELAR"
  | "RETOMAR";

export type SwiSexo = "H" | "M";

export const CONTACTO_PARENTESCOS = [
  "HIJO",
  "PAREJA",
  "MADRE_PADRE",
  "HERMANO",
  "ABUELO",
  "NIETO",
  "OTRO",
] as const;

export type ContactoParentesco = (typeof CONTACTO_PARENTESCOS)[number];

export const PARENTESCO_LABELS: Record<ContactoParentesco, string> = {
  HIJO: "Hija o hijo",
  PAREJA: "Esposa, esposo o pareja",
  MADRE_PADRE: "Madre o padre",
  HERMANO: "Hermana o hermano",
  ABUELO: "Abuela o abuelo",
  NIETO: "Nieta o nieto",
  OTRO: "Otro familiar",
};

export const OPCIONES_PARENTESCO: { value: ContactoParentesco; label: string }[] =
  CONTACTO_PARENTESCOS.map((value) => ({ value, label: PARENTESCO_LABELS[value] }));

export const SWI_INTERACCION_TIPOS = [
  "CONTEXTO_CONSULTADO",
  "CITA_VISUALIZADA",
  "CHECK_IN",
  "RESULTADOS_ENTREGADOS",
  "NOTA_ASESOR",
  "MENSAJE_ENVIADO",
  "MENSAJE_RECIBIDO",
  "TRANSFERENCIA_ASESOR",
] as const;

export type SwiInteraccionTipo = (typeof SWI_INTERACCION_TIPOS)[number];

export const SWI_ENTIDADES: Record<string, string> = {
  AS: "Aguascalientes",
  BC: "Baja California",
  BS: "Baja California Sur",
  CC: "Campeche",
  CL: "Coahuila",
  CM: "Colima",
  CS: "Chiapas",
  CH: "Chihuahua",
  DF: "Ciudad de México",
  DG: "Durango",
  GT: "Guanajuato",
  GR: "Guerrero",
  HG: "Hidalgo",
  JC: "Jalisco",
  MC: "Estado de México",
  MN: "Michoacán",
  MS: "Morelos",
  NT: "Nayarit",
  NL: "Nuevo León",
  OC: "Oaxaca",
  PL: "Puebla",
  QT: "Querétaro",
  QR: "Quintana Roo",
  SP: "San Luis Potosí",
  SL: "Sinaloa",
  SR: "Sonora",
  TC: "Tabasco",
  TS: "Tamaulipas",
  TL: "Tlaxcala",
  VZ: "Veracruz",
  YN: "Yucatán",
  ZS: "Zacatecas",
  NE: "Nacido en el extranjero",
};

export const OPCIONES_ENTIDAD: [string, string][] = Object.entries(SWI_ENTIDADES)
  .filter(([c]) => c !== "NE")
  .sort((a, b) => a[1].localeCompare(b[1], "es"))
  .concat([["NE", SWI_ENTIDADES.NE]]);

export type SwiHorarios = Record<string, [string, string] | null>;

export type SwiPaciente = {
  id: string;
  nombre: string | null;
  nombres: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  telefono: string;
  email: string | null;
  fechaNacimiento: string | null;
  sexo: SwiSexo | null;
  entidadNacimiento?: string | null;
  entidad?: string | null;
  curp: string | null;
  telefonoFijo: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  contactoParentesco?: ContactoParentesco | null;
  datosCompletos?: boolean;
  registroCompleto?: boolean;
  faltanDatos?: string[];
  preguntaSeguridad?: string | null;
  adultoMayor?: boolean;
};

export type SwiPagoDetalle = {
  metodo?: string;
  monto: number;
  marca: string | null;
  ultimos4: string | null;
  referencia: string;
  fecha?: string;
  autorizacion?: string | null;
  titular?: string | null;
  folio?: string | null;
};

export type SwiPago = {
  estado: "PAGADO" | "EN_CLINICA" | "PENDIENTE";
  detalle: SwiPagoDetalle | null;
  ultimoRechazo?: {
    mensaje: string | null;
    marca: string | null;
    ultimos4: string | null;
    fecha: string;
  } | null;
  intentosRechazados?: number;
};

export type SwiTramite = {
  id: string;
  folio: string;
  estado: SwiEstado;
  paso: SwiPaso;
  estudio: { id: string; nombre: string; precio: number; preparacion: string };
  clinica: { id: string; nombre: string; ciudad: string; direccion: string } | null;
  fechaCita: string | null;
  canalOrigen: SwiCanal;
  canalActual: SwiCanal;
  creadoEn: string;
  actualizadoEn: string;
  abandonadoEn: string | null;
  recuperadoPor: SwiCanal | null;
  pago: SwiPago;
};

export type SwiInteraccion = {
  id: string;
  tramiteId: string | null;
  canal: SwiCanal;
  tipo: string;
  detalle: Record<string, unknown>;
  fecha: string;
};

export type SwiContexto = {
  paciente: SwiPaciente;
  tramiteActivo: SwiTramite | null;
  tramites: SwiTramite[];
  interacciones: SwiInteraccion[];
  canalesUsados: SwiCanal[];
};

export type SwiEstudio = {
  id: string;
  clave?: string;
  nombre: string;
  categoria?: string;
  precio: number;
  preparacion: string;
  duracionMin?: number;
};

export type SwiClinica = {
  id: string;
  nombre: string;
  ciudad: string;
  direccion: string;
  horarios?: SwiHorarios;
  horariosTexto?: string;
};

export type SwiRegistroPacienteInput = {
  telefono: string;
  nombres: string;
  primerApellido: string;
  segundoApellido: string;
  fechaNacimiento: string; // YYYY-MM-DD
  sexo: SwiSexo;
  entidad: string; // 2 letras, p. ej. "SL"
  curp?: string;
  email: string;
  telefonoFijo: string;
  contactoNombre: string;
  contactoTelefono: string;
  contactoParentesco: ContactoParentesco;
  canal?: SwiCanal;
};

export type SwiDatosTarjeta = {
  numero: string;
  titular: string;
  vencimiento: string; // MM/AA
  cvc: string;
};

export type SwiComprobante = {
  folio?: string | null;
  referencia?: string | null;
  autorizacion?: string | null;
  monto?: number | null;
  marca?: string | null;
  ultimos4?: string | null;
  titular?: string | null;
  metodo?: string | null;
  fecha?: string | null;
  paciente?: string | null;
  estudio?: string | null;
  clinica?: string | null;
  [key: string]: unknown;
};

export type SwiResultadoPago = {
  pago: {
    estado: "APROBADO" | "RECHAZADO" | "PENDIENTE";
    monto: number;
    marca: string | null;
    ultimos4: string | null;
    mensaje: string | null;
    referencia: string;
    fecha?: string;
    autorizacion?: string | null;
    metodo?: string;
  };
  comprobante?: SwiComprobante | null;
  tramite?: SwiTramite;
  error?: string;
};

export type SwiSeguridadVerificacion = {
  correcta: boolean;
  intentosRestantes: number;
};

export type SwiEncuestaInput = {
  telefono: string;
  puntaje: number; // 1-5
  motivo?: string;
  tramiteId?: string;
  canal?: SwiCanal;
};

export type SwiInteraccionInput =
  | {
      tramiteId: string;
      telefono?: string;
      tipo: SwiInteraccionTipo;
      detalle: Record<string, unknown>;
      canal?: SwiCanal;
    }
  | {
      tramiteId?: undefined;
      telefono: string;
      tipo: SwiInteraccionTipo;
      detalle: Record<string, unknown>;
      canal?: SwiCanal;
    };

/** Normaliza un teléfono mexicano a 10 dígitos para SWI (acepta +52, 521, espacios y guiones). */
export function normalizarTelefonoSwi(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  const ten =
    digits.length === 12 && digits.startsWith("52")
      ? digits.slice(2)
      : digits.length === 13 && digits.startsWith("521")
        ? digits.slice(3)
        : digits;
  return /^\d{10}$/.test(ten) ? ten : null;
}

/** Determina si el registro del paciente está completo según SWI (`registroCompleto` o fallback `datosCompletos`). */
export function esRegistroCompleto(p: Pick<SwiPaciente, "registroCompleto" | "datosCompletos" | "faltanDatos"> | null | undefined): boolean {
  if (!p) return false;
  if (typeof p.registroCompleto === "boolean") return p.registroCompleto;
  if (Array.isArray(p.faltanDatos) && p.faltanDatos.length > 0) return false;
  if (typeof p.datosCompletos === "boolean") return p.datosCompletos;
  return true;
}

/** Mensaje estándar de SWI cuando faltan datos del paciente. */
export function mensajeRegistroIncompleto(p: Pick<SwiPaciente, "faltanDatos"> | null | undefined): string {
  const faltan = p?.faltanDatos?.filter(Boolean) ?? [];
  if (faltan.length > 0) {
    return `Completa su registro para continuar: falta ${faltan.join(", ")}.`;
  }
  return "Completa su registro para continuar.";
}

export function etiquetaParentesco(parentesco?: string | null): string {
  if (!parentesco) return "";
  return PARENTESCO_LABELS[parentesco as ContactoParentesco] ?? parentesco;
}
