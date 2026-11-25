import { APP_CANAL, REQUEST_TIMEOUT_MS, SWI_API_KEY, SWI_BASE_URL } from "../config";
import type {
  Accion,
  Canal,
  Clinica,
  Contexto,
  EncuestaInput,
  Estudio,
  Paciente,
  RegistroPacienteInput,
  ResultadoPago,
  SeguridadVerificacion,
  SwiInteraccionTipo,
  Tramite,
} from "../types/swi";
import { SWI_INTERACCION_TIPOS } from "./constantes";
import type { DatosTarjeta } from "./tarjetas";

export class SwiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detalles?: unknown,
  ) {
    super(message);
    this.name = "SwiError";
  }
}

export function buildSwiUrl(path: string, baseUrl = SWI_BASE_URL, canal: Canal = APP_CANAL): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
  const apiBase = cleanBase.endsWith("/api") ? cleanBase : `${cleanBase}/api`;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const [pathname, rawQuery = ""] = normalizedPath.split("?");
  const params = new URLSearchParams(rawQuery);
  if (!params.has("canal")) params.set("canal", canal);
  return `${apiBase}${pathname}?${params.toString()}`;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  canal?: Canal;
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
};

export async function swiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const canal = opts.canal ?? APP_CANAL;
  const url = buildSwiUrl(path, opts.baseUrl, canal);
  const apiKey = opts.apiKey ?? SWI_API_KEY;
  const fetchFn = opts.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-api-key": apiKey,
  };

  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify({ canal, ...opts.body });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchFn(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    if (res.status === 204) return undefined as T;

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof json.error === "string" && json.error) ||
        (typeof json.message === "string" && json.message) ||
        `Error del servidor (HTTP ${res.status}).`;
      throw new SwiError(res.status, msg, json.detalles ?? json);
    }
    return json as T;
  } catch (err) {
    if (err instanceof SwiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SwiError(
        0,
        `Tiempo de espera agotado al conectar con ${SWI_BASE_URL}. Verifica tu Wi-Fi y que el servidor esté encendido.`,
      );
    }
    throw new SwiError(
      0,
      `No hay conexión con el servidor (${SWI_BASE_URL}). Revisa tu red Wi-Fi e intenta de nuevo.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getEstudios(): Promise<Estudio[]> {
  const r = await swiRequest<{ estudios: Estudio[] }>("/estudios");
  return r.estudios ?? [];
}

export async function getClinicas(): Promise<Clinica[]> {
  const r = await swiRequest<{ clinicas: Clinica[] }>("/clinicas");
  return r.clinicas ?? [];
}

export function getContexto(telefono: string, registrar = false): Promise<Contexto> {
  const qs = registrar ? `?registrar=1&canal=${APP_CANAL}` : "";
  return swiRequest<Contexto>(`/pacientes/${encodeURIComponent(telefono)}/contexto${qs}`);
}

export function registrarPaciente(
  datos: RegistroPacienteInput,
): Promise<{ paciente?: Paciente; correo?: { estado?: string; para?: string | null } }> {
  return swiRequest("/pacientes", {
    method: "POST",
    body: {
      telefono: datos.telefono,
      nombres: datos.nombres.trim(),
      primerApellido: datos.primerApellido.trim(),
      segundoApellido: datos.segundoApellido.trim(),
      fechaNacimiento: datos.fechaNacimiento,
      sexo: datos.sexo,
      entidad: datos.entidad,
      ...(datos.curp?.trim() ? { curp: datos.curp.trim().toUpperCase() } : {}),
      email: datos.email.trim(),
      telefonoFijo: datos.telefonoFijo.trim(),
      contactoNombre: datos.contactoNombre.trim(),
      contactoTelefono: datos.contactoTelefono.trim(),
      contactoParentesco: datos.contactoParentesco,
    },
  });
}

export async function crearTramite(telefono: string, estudioId: string): Promise<Tramite> {
  const r = await swiRequest<{ tramite: Tramite }>("/tramites", {
    method: "POST",
    body: { telefono, estudioId },
  });
  return r.tramite;
}

export async function avanzarTramite(
  tramiteId: string,
  accion: Accion,
  datos?: Record<string, unknown>,
): Promise<Tramite> {
  const hasDatos = datos && Object.keys(datos).length > 0;
  const r = await swiRequest<{ tramite: Tramite }>(
    `/tramites/${encodeURIComponent(tramiteId)}/avanzar`,
    {
      method: "POST",
      body: { accion, ...(hasDatos ? { datos } : {}) },
    },
  );
  return r.tramite;
}

export function eliminarTramite(tramiteId: string, motivo: string): Promise<unknown> {
  const qs = new URLSearchParams({ motivo: motivo.trim() || "Eliminado desde la app" });
  return swiRequest(`/tramites/${encodeURIComponent(tramiteId)}?${qs.toString()}`, {
    method: "DELETE",
  });
}

/** Pago con tarjeta desde el celular de la paciente: envía siempre `"canal": "APP"`. */
export function pagarConTarjeta(tramiteId: string, tarjeta: DatosTarjeta): Promise<ResultadoPago> {
  return swiRequest<ResultadoPago>(`/tramites/${encodeURIComponent(tramiteId)}/pagos`, {
    method: "POST",
    canal: "APP",
    body: { metodo: "TARJETA", canal: "APP", tarjeta },
  });
}

export function marcarPagoEnClinica(tramiteId: string): Promise<ResultadoPago> {
  return swiRequest<ResultadoPago>(`/tramites/${encodeURIComponent(tramiteId)}/pagos`, {
    method: "POST",
    body: { metodo: "CLINICA" },
  });
}

export function guardarPreguntaSeguridad(
  telefono: string,
  pregunta: string,
  respuesta: string,
): Promise<unknown> {
  return swiRequest(`/pacientes/${encodeURIComponent(telefono)}/seguridad`, {
    method: "PUT",
    body: { pregunta: pregunta.trim(), respuesta: respuesta.trim() },
  });
}

export function verificarPreguntaSeguridad(
  telefono: string,
  respuesta: string,
): Promise<SeguridadVerificacion> {
  return swiRequest<SeguridadVerificacion>(
    `/pacientes/${encodeURIComponent(telefono)}/seguridad`,
    {
      method: "POST",
      body: { respuesta: respuesta.trim() },
    },
  );
}

export function enviarEncuesta(input: EncuestaInput): Promise<unknown> {
  const puntaje = Math.round(input.puntaje);
  if (puntaje < 1 || puntaje > 5) {
    return Promise.reject(new SwiError(400, "El puntaje debe estar entre 1 y 5."));
  }
  const motivo = input.motivo?.trim();
  if (puntaje < 3 && !motivo) {
    return Promise.reject(
      new SwiError(400, "El motivo es obligatorio cuando el puntaje es menor a 3."),
    );
  }
  return swiRequest("/encuestas", {
    method: "POST",
    canal: input.canal ?? APP_CANAL,
    body: {
      telefono: input.telefono,
      puntaje,
      ...(motivo ? { motivo } : {}),
      ...(input.tramiteId ? { tramiteId: input.tramiteId } : {}),
    },
  });
}

const ALLOWED_TYPES = new Set<string>(SWI_INTERACCION_TIPOS);

export function registrarInteraccion(params: {
  tramiteId?: string;
  telefono?: string;
  tipo: SwiInteraccionTipo;
  detalle?: Record<string, unknown>;
  canal?: Canal;
}): Promise<unknown> {
  if (!ALLOWED_TYPES.has(params.tipo)) {
    return Promise.reject(new SwiError(400, `Tipo de interacción no permitido: ${params.tipo}`));
  }
  if (!params.tramiteId && !params.telefono) {
    return Promise.reject(
      new SwiError(400, "Se requiere tramiteId o telefono para registrar la interacción."),
    );
  }
  return swiRequest("/interacciones", {
    method: "POST",
    canal: params.canal ?? APP_CANAL,
    body: {
      ...(params.tramiteId ? { tramiteId: params.tramiteId } : { telefono: params.telefono }),
      tipo: params.tipo,
      detalle: params.detalle ?? {},
    },
  });
}
