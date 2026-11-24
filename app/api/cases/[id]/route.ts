import { z } from "zod";
import { canAccessCase, requireActor, type Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { advance, EngineError, pendingStep } from "@/lib/engine/case";
import { eventsSince, EventType, recordEvent, toJson } from "@/lib/engine/events";
import { handleError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

async function loadAuthorized(actor: Actor, id: string) {
  const c = await db.case.findUnique({ where: { id } });
  // 404 también cuando no es suyo: no revelar que el trámite existe.
  if (!c || !canAccessCase(actor, c)) throw new EngineError("NOT_FOUND", "Caso no encontrado");
  return c;
}

/** Contexto completo del trámite: estado, siguiente paso pendiente y línea de tiempo. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const actor = await requireActor(req);
    const c = await loadAuthorized(actor, (await params).id);
    if (actor.channel === "CALL_CENTER") {
      // Auditoría: quién del personal consultó qué expediente y cuándo.
      await recordEvent({
        type: EventType.ADVISOR_OPENED_CASE,
        channel: "CALL_CENTER",
        caseId: c.id,
        patientId: c.patientId,
        actorId: actor.session.staffId,
        payload: { role: actor.session.role },
      });
    }
    const timeline = (await eventsSince({ caseId: c.id })).map(toJson);
    return Response.json({ case: c, pending: pendingStep(c.step), timeline });
  } catch (err) {
    return handleError(err);
  }
}

const AdvanceBody = z.object({
  to: z.enum(["ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS", "CITA_CONFIRMADA", "CANCELADO"]),
  data: z.record(z.string(), z.unknown()).optional(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().max(200).optional(),
});

/** Avanza el trámite. 409 si otro canal lo cambió antes (recargar y reintentar). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requireActor(req);
    const c = await loadAuthorized(actor, (await params).id);
    const body = AdvanceBody.parse(await req.json());
    const r = await advance({
      caseId: c.id,
      ...body,
      channel: actor.channel,
      actorId: actor.channel === "CALL_CENTER" ? actor.session.staffId : undefined,
    });
    return Response.json({ case: r.case, pending: pendingStep(r.case.step), duplicate: r.duplicate });
  } catch (err) {
    return handleError(err);
  }
}
