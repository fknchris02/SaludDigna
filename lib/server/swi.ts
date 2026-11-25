import {
  SWI_INTERACCION_TIPOS,
  esRegistroCompleto,
  mensajeRegistroIncompleto,
  normalizarTelefonoSwi,
  type SwiAccion,
  type SwiCanal,
  type SwiClinica,
  type SwiContexto,
  type SwiDatosTarjeta,
  type SwiEncuestaInput,
  type SwiEstudio,
  type SwiInteraccionInput,
  type SwiPaciente,
  type SwiRegistroPacienteInput,
  type SwiResultadoPago,
  type SwiSeguridadVerificacion,
  type SwiTramite,
} from "@/lib/swi/types";

export const DEFAULT_SWI_CANAL: SwiCanal = "CLINICA";
const DEFAULT_TIMEOUT_MS = 12_000;

export class SwiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SwiError";
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type SwiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  /** Canal por defecto "CLINICA". Solo el pago con tarjeta desde celular del paciente usa "APP". */
  canal?: SwiCanal;
  /** Si es false, no inyecta `canal` automáticamente en el cuerpo. */
  includeCanalInBody?: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

export function getSwiConfig(overrides?: { baseUrl?: string; apiKey?: string }) {
  const rawBase = (overrides?.baseUrl ?? process.env.SWI_URL ?? "").trim();
  const apiKey = (overrides?.apiKey ?? process.env.SWI_API_KEY ?? "").trim();
  return { rawBase, apiKey };
}

export function isSwiConfigured(): boolean {
  const { rawBase, apiKey } = getSwiConfig();
  return Boolean(rawBase && apiKey);
}

/** Construye la URL hacia SWI asegurando el prefijo `/api` sin duplicarlo. */
export function buildSwiUrl(path: string, baseUrl?: string): string {
  const { rawBase } = getSwiConfig({ baseUrl });
  if (!rawBase) {
    throw new SwiError(503, "SWI_URL no está configurado en .env.local.");
  }
  const cleanBase = rawBase.replace(/\/+$/, "");
  const apiBase = cleanBase.endsWith("/api") ? cleanBase : `${cleanBase}/api`;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}

/**
 * Cliente proxy servidor → SWI.
 * - Siempre envía `x-api-key: <SWI_API_KEY>` (nunca se expone al navegador).
 * - En peticiones con cuerpo inyecta `"canal": "CLINICA"` por defecto (salvo que se especifique otro,
 *   como `"canal": "APP"` en el pago con tarjeta desde el celular de la paciente).
 * - Preserva el mensaje exacto de `error` en respuestas 400, 401, 403, 404 y 429.
 */
export async function swiRequest<T = unknown>(
  path: string,
  opts: SwiRequestOptions = {},
): Promise<T> {
  const { apiKey } = getSwiConfig({ baseUrl: opts.baseUrl, apiKey: opts.apiKey });
  if (!apiKey) {
    throw new SwiError(503, "SWI_API_KEY no está configurado en .env.local.");
  }

  const url = buildSwiUrl(path, opts.baseUrl);
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const canal = opts.canal ?? DEFAULT_SWI_CANAL;
  const fetchFn = opts.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-api-key": apiKey,
  };

  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    const bodyWithCanal =
      opts.includeCanalInBody === false
        ? opts.body
        : { canal, ...opts.body };
    payload = JSON.stringify(bodyWithCanal);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      method,
      headers,
      body: payload,
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 204) return undefined as T;

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof json.error === "string" && json.error) ||
        (typeof json.message === "string" && json.message) ||
        `Error de SWI (HTTP ${res.status}).`;
      throw new SwiError(res.status, msg, json);
    }
    return json as T;
  } catch (err) {
    if (err instanceof SwiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SwiError(
        504,
        "Tiempo de espera agotado al conectar con SWI. Verifica la red Wi-Fi y SWI_URL.",
      );
    }
    throw new SwiError(
      502,
      "No se pudo conectar con SWI. Verifica que estés en la misma red Wi-Fi y revisa SWI_URL.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ───────────────────────── Catálogos ─────────────────────────

export async function getEstudios(opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">): Promise<SwiEstudio[]> {
  const res = await swiRequest<{ estudios?: SwiEstudio[] } | SwiEstudio[]>("/estudios", opts);
  return Array.isArray(res) ? res : (res.estudios ?? []);
}

export async function getClinicas(opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">): Promise<SwiClinica[]> {
  const res = await swiRequest<{ clinicas?: SwiClinica[] } | SwiClinica[]>("/clinicas", opts);
  return Array.isArray(res) ? res : (res.clinicas ?? []);
}

// ───────────────────────── Pacientes y Contexto ─────────────────────────

export async function buscarPacientePorTelefono(
  telefono: string,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<{ paciente: SwiPaciente | null; encontrado: boolean }> {
  const tel = normalizarTelefonoSwi(telefono) ?? telefono.trim();
  const qs = new URLSearchParams({ metodo: "telefono", telefono: tel });
  const res = await swiRequest<{ paciente?: SwiPaciente | null; pacientes?: SwiPaciente[]; encontrado?: boolean }>(
    `/pacientes/buscar?${qs.toString()}`,
    opts,
  );
  const paciente = res.paciente ?? res.pacientes?.[0] ?? null;
  return { paciente, encontrado: res.encontrado ?? Boolean(paciente) };
}

/**
 * Consulta el contexto completo del paciente en SWI.
 * Con `registrar: true` envía `?registrar=1&canal=CLINICA` para que SWI registre `CONTEXTO_CONSULTADO`
 * (SWI deduplica automáticamente una vez cada 30 min).
 */
export async function getContextoPaciente(
  telefono: string,
  options?: {
    registrar?: boolean;
    canal?: SwiCanal;
    baseUrl?: string;
    apiKey?: string;
    fetchImpl?: FetchLike;
  },
): Promise<SwiContexto> {
  const tel = normalizarTelefonoSwi(telefono) ?? telefono.trim();
  const params = new URLSearchParams();
  if (options?.registrar) {
    params.set("registrar", "1");
    params.set("canal", options.canal ?? DEFAULT_SWI_CANAL);
  }
  const qs = params.toString();
  const path = `/pacientes/${encodeURIComponent(tel)}/contexto${qs ? `?${qs}` : ""}`;
  return swiRequest<SwiContexto>(path, {
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
    fetchImpl: options?.fetchImpl,
  });
}

/**
 * Valida antes de agendar, confirmar, cobrar o hacer check-in que el registro del paciente esté completo.
 * Lanza `SwiError(400, ...)` con `faltanDatos` si falta algún campo obligatorio.
 */
export async function verificarRegistroCompleto(
  telefono: string,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<SwiContexto> {
  const ctx = await getContextoPaciente(telefono, opts);
  if (!esRegistroCompleto(ctx.paciente)) {
    throw new SwiError(400, mensajeRegistroIncompleto(ctx.paciente), {
      registroCompleto: false,
      faltanDatos: ctx.paciente.faltanDatos ?? [],
      paciente: ctx.paciente,
    });
  }
  return ctx;
}

/** Registra o actualiza un paciente en SWI con todos los campos obligatorios (incluyendo contactoParentesco). */
export async function registrarPaciente(
  datos: SwiRegistroPacienteInput,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<{ paciente?: SwiPaciente; [key: string]: unknown }> {
  const tel = normalizarTelefonoSwi(datos.telefono) ?? datos.telefono.trim();
  const fijo = normalizarTelefonoSwi(datos.telefonoFijo) ?? datos.telefonoFijo.trim();
  const famTel = normalizarTelefonoSwi(datos.contactoTelefono) ?? datos.contactoTelefono.trim();

  return swiRequest("/pacientes", {
    method: "POST",
    canal: datos.canal ?? DEFAULT_SWI_CANAL,
    body: {
      telefono: tel,
      nombres: datos.nombres.trim(),
      primerApellido: datos.primerApellido.trim(),
      segundoApellido: datos.segundoApellido.trim(),
      fechaNacimiento: datos.fechaNacimiento,
      sexo: datos.sexo,
      entidad: datos.entidad.trim().toUpperCase(),
      ...(datos.curp?.trim() ? { curp: datos.curp.trim().toUpperCase() } : {}),
      email: datos.email.trim(),
      telefonoFijo: fijo,
      contactoNombre: datos.contactoNombre.trim(),
      contactoTelefono: famTel,
      contactoParentesco: datos.contactoParentesco,
      canal: datos.canal ?? DEFAULT_SWI_CANAL,
    },
    ...opts,
  });
}

// ───────────────────────── Trámites ─────────────────────────

export async function crearTramite(
  telefono: string,
  estudioId: string,
  options?: { canal?: SwiCanal } & Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<SwiTramite> {
  const tel = normalizarTelefonoSwi(telefono) ?? telefono.trim();
  const res = await swiRequest<{ tramite: SwiTramite }>("/tramites", {
    method: "POST",
    canal: options?.canal ?? DEFAULT_SWI_CANAL,
    body: { telefono: tel, estudioId, canal: options?.canal ?? DEFAULT_SWI_CANAL },
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
    fetchImpl: options?.fetchImpl,
  });
  return res.tramite;
}

/**
 * Avanza un trámite paso a paso (`CLINICA` → `FECHA` → `AGENDAR` → `CONFIRMAR`, etc.).
 * Si se pasa `telefono` y la acción es `AGENDAR` o `CONFIRMAR`, valida primero `registroCompleto`.
 */
export async function avanzarTramite(
  tramiteId: string,
  accion: SwiAccion,
  datos?: Record<string, unknown>,
  options?: {
    canal?: SwiCanal;
    telefonoParaValidar?: string;
  } & Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<SwiTramite> {
  if (
    options?.telefonoParaValidar &&
    (accion === "AGENDAR" || accion === "CONFIRMAR")
  ) {
    await verificarRegistroCompleto(options.telefonoParaValidar, {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
    });
  }

  const canal = options?.canal ?? DEFAULT_SWI_CANAL;
  const res = await swiRequest<{ tramite: SwiTramite }>(
    `/tramites/${encodeURIComponent(tramiteId)}/avanzar`,
    {
      method: "POST",
      canal,
      body: {
        accion,
        canal,
        ...(datos && Object.keys(datos).length > 0 ? { datos } : {}),
      },
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      fetchImpl: options?.fetchImpl,
    },
  );
  return res.tramite;
}

/** Elimina un trámite en SWI (`DELETE /tramites/{id}?motivo=...`). SWI registra `TRAMITE_ELIMINADO`. */
export async function eliminarTramite(
  tramiteId: string,
  motivo: string,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<unknown> {
  const qs = new URLSearchParams({ motivo: motivo.trim() || "Eliminado desde recepción" });
  return swiRequest(`/tramites/${encodeURIComponent(tramiteId)}?${qs.toString()}`, {
    method: "DELETE",
    ...opts,
  });
}

// ───────────────────────── Pagos ─────────────────────────

/**
 * Pago con tarjeta desde el celular de la paciente.
 * Regla SWI: SIEMPRE envía `"canal": "APP"` en esta petición (con `"canal": "CLINICA"` SWI responde 403).
 */
export async function pagarConTarjetaApp(
  tramiteId: string,
  tarjeta: SwiDatosTarjeta,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<SwiResultadoPago> {
  return swiRequest<SwiResultadoPago>(`/tramites/${encodeURIComponent(tramiteId)}/pagos`, {
    method: "POST",
    canal: "APP",
    body: {
      metodo: "TARJETA",
      canal: "APP",
      tarjeta: {
        numero: tarjeta.numero.replace(/\D/g, ""),
        titular: tarjeta.titular.trim(),
        vencimiento: tarjeta.vencimiento.trim(),
        cvc: tarjeta.cvc.replace(/\D/g, ""),
      },
    },
    ...opts,
  });
}

/**
 * Registra que la paciente pagará en clínica (`metodo: "CLINICA"`, `canal: "CLINICA"`).
 * Valida `registroCompleto` antes si se proporciona `telefonoParaValidar`.
 */
export async function registrarPagoEnClinica(
  tramiteId: string,
  options?: {
    canal?: SwiCanal;
    telefonoParaValidar?: string;
  } & Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<SwiResultadoPago> {
  if (options?.telefonoParaValidar) {
    await verificarRegistroCompleto(options.telefonoParaValidar, {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
    });
  }
  const canal = options?.canal ?? DEFAULT_SWI_CANAL;
  return swiRequest<SwiResultadoPago>(`/tramites/${encodeURIComponent(tramiteId)}/pagos`, {
    method: "POST",
    canal,
    body: {
      metodo: "CLINICA",
      canal,
    },
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
    fetchImpl: options?.fetchImpl,
  });
}

// ───────────────────────── Pregunta de Seguridad ─────────────────────────

/** Registra o actualiza la pregunta de seguridad (la respuesta se cifra en SWI y nunca se devuelve). */
export async function guardarPreguntaSeguridad(
  telefono: string,
  pregunta: string,
  respuesta: string,
  options?: { canal?: SwiCanal } & Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<{ ok?: boolean; preguntaSeguridad?: string; [key: string]: unknown }> {
  const tel = normalizarTelefonoSwi(telefono) ?? telefono.trim();
  const canal = options?.canal ?? DEFAULT_SWI_CANAL;
  return swiRequest(`/pacientes/${encodeURIComponent(tel)}/seguridad`, {
    method: "PUT",
    canal,
    body: {
      pregunta: pregunta.trim(),
      respuesta: respuesta.trim(),
      canal,
    },
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
    fetchImpl: options?.fetchImpl,
  });
}

/** Verifica la respuesta de seguridad. Tras 3 errores en 15 min SWI responde 429. */
export async function verificarPreguntaSeguridad(
  telefono: string,
  respuesta: string,
  options?: { canal?: SwiCanal } & Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<SwiSeguridadVerificacion> {
  const tel = normalizarTelefonoSwi(telefono) ?? telefono.trim();
  const canal = options?.canal ?? DEFAULT_SWI_CANAL;
  return swiRequest<SwiSeguridadVerificacion>(
    `/pacientes/${encodeURIComponent(tel)}/seguridad`,
    {
      method: "POST",
      canal,
      body: {
        respuesta: respuesta.trim(),
        canal,
      },
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      fetchImpl: options?.fetchImpl,
    },
  );
}

// ───────────────────────── Encuesta de Satisfacción ─────────────────────────

/** Registra la encuesta de satisfacción (1-5). Con puntaje < 3, `motivo` es obligatorio. */
export async function enviarEncuesta(
  input: SwiEncuestaInput,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<unknown> {
  const puntaje = Math.round(input.puntaje);
  if (puntaje < 1 || puntaje > 5) {
    throw new SwiError(400, "El puntaje debe ser un número entre 1 y 5.");
  }
  const motivo = input.motivo?.trim();
  if (puntaje < 3 && !motivo) {
    throw new SwiError(400, "El motivo es obligatorio cuando el puntaje es menor a 3.");
  }
  const tel = normalizarTelefonoSwi(input.telefono) ?? input.telefono.trim();
  const canal = input.canal ?? DEFAULT_SWI_CANAL;

  return swiRequest("/encuestas", {
    method: "POST",
    canal,
    body: {
      telefono: tel,
      puntaje,
      canal,
      ...(motivo ? { motivo } : {}),
      ...(input.tramiteId ? { tramiteId: input.tramiteId } : {}),
    },
    ...opts,
  });
}

// ───────────────────────── Interacciones (Eventos 8b) ─────────────────────────

const ALLOWED_INTERACCIONES = new Set<string>(SWI_INTERACCION_TIPOS);

/**
 * Registra un evento en SWI (`POST /interacciones`).
 * Solo acepta los 8 tipos exactos permitidos por SWI.
 * Con `tramiteId` cuelga del trámite; sin él, usa `telefono`.
 * Para `CHECK_IN` y `RESULTADOS_ENTREGADOS`, valida primero `registroCompleto` si se pasa `telefono`.
 */
export async function registrarInteraccion(
  input: SwiInteraccionInput,
  opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">,
): Promise<unknown> {
  if (!ALLOWED_INTERACCIONES.has(input.tipo)) {
    throw new SwiError(400, `Tipo de interacción no permitido por SWI: ${input.tipo}`);
  }
  if (!input.tramiteId && !input.telefono) {
    throw new SwiError(400, "Se requiere tramiteId o telefono para registrar la interacción.");
  }

  if (
    input.telefono &&
    (input.tipo === "CHECK_IN" || input.tipo === "RESULTADOS_ENTREGADOS")
  ) {
    await verificarRegistroCompleto(input.telefono, opts);
  }

  const canal = input.canal ?? DEFAULT_SWI_CANAL;
  const tel = input.telefono ? (normalizarTelefonoSwi(input.telefono) ?? input.telefono.trim()) : undefined;

  return swiRequest("/interacciones", {
    method: "POST",
    canal,
    body: {
      ...(input.tramiteId ? { tramiteId: input.tramiteId } : { telefono: tel }),
      canal,
      tipo: input.tipo,
      detalle: input.detalle ?? {},
    },
    ...opts,
  });
}

/** Helper específico para eventos de recepción (`CHECK_IN` y `RESULTADOS_ENTREGADOS`). */
export async function registrarEventoRecepcion(params: {
  tramiteId: string;
  telefono?: string;
  tipo: "CHECK_IN" | "RESULTADOS_ENTREGADOS";
  recepcion: string;
  estudio?: string;
}, opts?: Pick<SwiRequestOptions, "baseUrl" | "apiKey" | "fetchImpl">): Promise<unknown> {
  const detalle: Record<string, unknown> = {
    recepcion: params.recepcion.trim(),
    ...(params.tipo === "RESULTADOS_ENTREGADOS" && params.estudio ? { estudio: params.estudio } : {}),
  };
  return registrarInteraccion(
    {
      tramiteId: params.tramiteId,
      telefono: params.telefono,
      tipo: params.tipo,
      canal: "CLINICA",
      detalle,
    },
    opts,
  );
}
