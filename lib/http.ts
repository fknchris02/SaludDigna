import { z } from "zod";
import { EngineError } from "@/lib/engine/case";

/** Convierte errores del motor y de validación en respuestas HTTP; lo demás es 500. */
export function handleError(err: unknown) {
  if (err instanceof EngineError) return Response.json({ error: err.code, message: err.message, ...err.details }, { status: err.status });
  if (err instanceof z.ZodError) return Response.json({ error: "INVALID_DATA", issues: err.issues }, { status: 400 });
  console.error(err);
  return Response.json({ error: "INTERNAL" }, { status: 500 });
}

export const ChannelSchema = z.enum(["WEB", "WHATSAPP", "CALL_CENTER", "APP"]);
