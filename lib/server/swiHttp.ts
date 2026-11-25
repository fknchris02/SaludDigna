import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { SwiError } from "./swi";

/**
 * Convierte errores de SWI y de validación Zod en respuestas JSON conservando el texto exacto de `error`
 * que devuelve SWI (p. ej. 400 registro incompleto, 403 pago con tarjeta en CLINICA, 429 seguridad).
 */
export function handleSwiError(err: unknown): Response {
  unstable_rethrow(err);
  if (err instanceof SwiError) {
    return Response.json(
      {
        ...(err.body ?? {}),
        error: err.message,
      },
      { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
  if (err instanceof z.ZodError) {
    const first = err.issues[0]?.message ?? "Datos inválidos.";
    return Response.json({ error: first, issues: err.issues }, { status: 400 });
  }
  console.error("[swi-proxy]", err);
  return Response.json({ error: "Error interno al comunicarse con SWI." }, { status: 500 });
}
