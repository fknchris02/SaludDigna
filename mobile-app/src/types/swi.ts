export type Canal = "WEB" | "APP" | "WHATSAPP" | "CALL_CENTER" | "CLINICA";

export type Estado =
  | "COTIZANDO"
  | "CLINICA_SELECCIONADA"
  | "DATOS_CAPTURADOS"
  | "ABANDONADO"
  | "AGENDADO"
  | "CONFIRMADO"
  | "CANCELADO";

export type Paso = "ESTUDIO" | "CLINICA" | "FECHA" | "DATOS" | "CONFIRMAR" | "LISTO";

export type Accion =
  | "ESTUDIO"
  | "CLINICA"
  | "FECHA"
  | "DATOS"
  | "AGENDAR"
  | "CONFIRMAR"
  | "CANCELAR"
  | "RETOMAR";

export type ContactoParentesco =
  | "HIJO"
  | "PAREJA"
  | "MADRE_PADRE"
  | "HERMANO"
  | "ABUELO"
  | "NIETO"
  | "OTRO";

export type SwiInteraccionTipo =
  | "CONTEXTO_CONSULTADO"
  | "CITA_VISUALIZADA"
  | "CHECK_IN"
  | "RESULTADOS_ENTREGADOS"
  | "NOTA_ASESOR"
  | "MENSAJE_ENVIADO"
  | "MENSAJE_RECIBIDO"
  | "TRANSFERENCIA_ASESOR";

export type Horarios = Record<string, [string, string] | null>;

export type Sexo = "H" | "M";

export type Paciente = {
  id: string;
  nombre: string | null;
  nombres: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  telefono: string;
  email: string | null;
  fechaNacimiento: string | null;
  sexo: Sexo | null;
  entidadNacimiento: string | null;
  entidad?: string | null;
  curp: string | null;
  telefonoFijo: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  contactoParentesco?: ContactoParentesco | null;
  datosCompletos: boolean;
  registroCompleto?: boolean;
  faltanDatos?: string[];
  preguntaSeguridad?: string | null;
  adultoMayor?: boolean;
};

export type Pago = {
  estado: "PAGADO" | "EN_CLINICA" | "PENDIENTE";
  detalle: {
    metodo: string;
    monto: number;
    marca: string | null;
    ultimos4: string | null;
    referencia: string;
    fecha: string;
  } | null;
  ultimoRechazo: {
    mensaje: string | null;
    marca: string | null;
    ultimos4: string | null;
    fecha: string;
  } | null;
  intentosRechazados: number;
};

export type Tramite = {
  id: string;
  folio: string;
  estado: Estado;
  paso: Paso;
  estudio: { id: string; nombre: string; precio: number; preparacion: string };
  clinica: { id: string; nombre: string; ciudad: string; direccion: string } | null;
  fechaCita: string | null;
  canalOrigen: Canal;
  canalActual: Canal;
  creadoEn: string;
  actualizadoEn: string;
  abandonadoEn: string | null;
  recuperadoPor: Canal | null;
  pago: Pago;
};

export type Interaccion = {
  id: string;
  tramiteId: string | null;
  canal: Canal;
  tipo: string;
  detalle: Record<string, unknown>;
  fecha: string;
};

export type Contexto = {
  paciente: Paciente;
  tramiteActivo: Tramite | null;
  tramites: Tramite[];
  interacciones: Interaccion[];
  canalesUsados: Canal[];
};

export type Clinica = {
  id: string;
  nombre: string;
  ciudad: string;
  direccion: string;
  horarios: Horarios;
  horariosTexto: string;
};

export type Estudio = {
  id: string;
  clave: string;
  nombre: string;
  categoria: string;
  precio: number;
  preparacion: string;
  duracionMin: number;
};

export type ComprobantePago = {
  folio?: string | null;
  referencia?: string | null;
  autorizacion?: string | null;
  monto?: number | null;
  marca?: string | null;
  ultimos4?: string | null;
  metodo?: string | null;
  fecha?: string | null;
  paciente?: string | null;
  estudio?: string | null;
  clinica?: string | null;
  [key: string]: unknown;
};

export type ResultadoPago = {
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
  comprobante?: ComprobantePago | null;
  tramite: Tramite & { pago: Pago };
  error?: string;
};

export type RegistroPacienteInput = {
  telefono: string;
  nombres: string;
  primerApellido: string;
  segundoApellido: string;
  fechaNacimiento: string;
  sexo: Sexo;
  entidad: string;
  curp?: string;
  email: string;
  telefonoFijo: string;
  contactoNombre: string;
  contactoTelefono: string;
  contactoParentesco: ContactoParentesco;
};

export type SeguridadVerificacion = {
  correcta: boolean;
  intentosRestantes: number;
};

export type EncuestaInput = {
  telefono: string;
  puntaje: number;
  motivo?: string;
  tramiteId?: string;
  canal?: Canal;
};
