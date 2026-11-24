// Cliente HTTP para el navegador. `as` elige qué sesión (cookie) usa la petición.
export class ApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string; [k: string]: unknown }) {
    super(body.message ?? `Error ${status}`);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; as?: "WEB" | "APP" | "CALL_CENTER" } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.as ? { "x-sd-channel": opts.as } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
