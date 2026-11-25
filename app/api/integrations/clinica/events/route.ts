import { timingSafeEqual } from "node:crypto";
import { ingestClinicEvent } from "@/lib/engine/clinica";
import { toJson } from "@/lib/engine/events";
import { handleError } from "@/lib/http";

function isAuthorized(req: Request): { ok: true } | { ok: false; status: number; message: string } {
  const expected = (process.env.CLINICA_WEBHOOK_SECRET ?? "").trim();
  if (!expected) {
    return { ok: false, status: 503, message: "CLINICA_WEBHOOK_SECRET no configurado en el servidor" };
  }
  const provided = (req.headers.get("x-clinica-webhook-secret") ?? "").trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Secreto de webhook inválido" };
  }
  return { ok: true };
}

/** Recibe eventos en tiempo real desde WEB-CLINICA, los persiste y los publica en el bus SSE. */
export async function POST(req: Request) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const body = await req.json();
    const result = await ingestClinicEvent(body);
    return Response.json(
      { ok: true, duplicate: result.duplicate, events: result.events.map(toJson) },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    return handleError(err);
  }
}
