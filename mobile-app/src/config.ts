export const SWI_BASE_URL = (
  process.env.EXPO_PUBLIC_SWI_URL ?? "http://10.35.9.162:3000"
)
  .trim()
  .replace(/\/+$/, "");

export const SWI_API_KEY = (
  process.env.EXPO_PUBLIC_SWI_API_KEY ?? "demo-canales-2026"
).trim();

export const APP_CANAL = "APP" as const;

/** Mismo ritmo de sincronización en todos los canales de SWI (consola, recepción y portal). */
export const POLL_INTERVAL_MS = 4_000;

export const REQUEST_TIMEOUT_MS = 12_000;
