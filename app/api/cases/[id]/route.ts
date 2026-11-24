import { z } from "zod";
import { db } from "@/lib/db";
import { advance, EngineError, pendingStep } from "@/lib/engine/case";
import { eventsSince, toJson } from "@/lib/engine/events";
import { ChannelSchema, handleError } from "@/lib/http";

// shortcut: sin autenticación todavía; actorId y canal deben salir de la sesión.

type Ctx = { params: Promise<{ id: string }> };

/** Contexto completo del trámite: estado, siguiente paso pendiente y línea de tiempo. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const c = await db.case.findUnique({ where: { id } });
    if (!c) throw new EngineError("NOT_FOUND", "Caso no encontrado");
    const timeline = (await eventsSince({ caseId: id })).map(toJson);
    return Response.json({ case: c, pending: pendingStep(c.step), timeline });
  } catch (err) {
    return handleError(err);
  }
}

const AdvanceBody = z.object({
  to: z.enum(["ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS", "CITA_CONFIRMADA", "CANCELADO"]),
  data: z.record(z.string(), z.unknown()).optional(),
  channel: ChannelSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().max(200).optional(),
});

/** POST /api/cases/:id → avanza el trámite. 409 si otro canal lo cambió antes (recargar y reintentar). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = AdvanceBody.parse(await req.json());
    const r = await advance({ caseId: id, ...body });
    return Response.json({ case: r.case, pending: pendingStep(r.case.step), duplicate: r.duplicate });
  } catch (err) {
    return handleError(err);
  }
}
