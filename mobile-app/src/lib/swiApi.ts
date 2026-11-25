import { APP_CANAL, REQUEST_TIMEOUT_MS, SWI_API_KEY, SWI_BASE_URL } from "../config";
import type {
  Accion,
  Clinica,
  Contexto,
  Estudio,
  Paciente,
  RegistroPacienteInput,
  ResultadoPago,
  Tramite,
} from "../types/swi";
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

export function buildSwiUrl(path: string, baseUrl = SWI_BASE_URL): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
  const apiBase = cleanBase.endsWith("/api") ? cleanBase : `${cleanBase}/api`;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const [pathname, rawQuery = ""] = normalizedPath.split("?");
  const params = new URLSearchParams(rawQuery);
  if (!params.has("canal")) params.set("canal", APP_CANAL);
  return `${apiBase}${pathname}?${params.toString()}`;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
};

export async function swiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const url = buildSwiUrl(path, opts.baseUrl);
  const apiKey = opts.apiKey ?? SWI_API_KEY;
  const fetchFn = opts.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-api-key": apiKey,
  };

  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify({ canal: APP_CANAL, ...opts.body });
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
      throw new SwiError(res.status, msg, json.detalles);
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
  const qs = registrar ? "?registrar=1" : "";
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
  const r = await swiRequest<{ tramite: Tramite }>(
    `/tramites/${encodeURIComponent(tramiteId)}/avanzar`,
    {
      method: "POST",
      body: { accion, ...(datos ? { datos } : {}) },
    },
  );
  return r.tramite;
}

export function pagarConTarjeta(tramiteId: string, tarjeta: DatosTarjeta): Promise<ResultadoPago> {
  return swiRequest<ResultadoPago>(`/tramites/${encodeURIComponent(tramiteId)}/pagos`, {
    method: "POST",
    body: { metodo: "TARJETA", tarjeta },
  });
}

export function marcarPagoEnClinica(tramiteId: string): Promise<ResultadoPago> {
  return swiRequest<ResultadoPago>(`/tramites/${encodeURIComponent(tramiteId)}/pagos`, {
    method: "POST",
    body: { metodo: "CLINICA" },
  });
}

export function registrarInteraccion(
  tramiteId: string,
  tipo: string,
  detalle?: Record<string, unknown>,
): Promise<unknown> {
  return swiRequest("/interacciones", {
    method: "POST",
    body: { tramiteId, tipo, ...(detalle ? { detalle } : {}) },
  });
}
