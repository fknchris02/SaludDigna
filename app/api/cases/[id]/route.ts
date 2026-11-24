import { z } from "zod";
import { assertStaffCanSee, canAccessCase, requireActor, type Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { advance, EngineError, pendingStep } from "@/lib/engine/case";
import { eventsSince, recordStaffAccess, toJson } from "@/lib/engine/events";
import { handleError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

async function loadAuthorized(actor: Actor, id: string) {
  const c = await db.case.findUnique({ where: { id } });
  // 404 también cuando no es suyo: no revelar que el trámite existe.
  if (!c || !canAccessCase(actor, c)) throw new EngineError("NOT_FOUND", "Caso no encontrado");
  if (actor.channel === "CALL_CENTER") await assertStaffCanSee(actor.session, c.patientId);
  return c;
}

/** Contexto completo del trámite: estado, siguiente paso pendiente y línea de tiempo. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const actor = await requireActor(req);
    const c = await loadAuthorized(actor, (await params).id);
    // Auditoría: quién del personal consultó qué expediente y cuándo.
    if (actor.channel === "CALL_CENTER" && c.patientId) {
      await recordStaffAccess(actor.session.staffId, actor.session.role, c.patientId, c.id);
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
