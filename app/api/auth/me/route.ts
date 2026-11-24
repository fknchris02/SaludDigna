import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getActiveCase } from "@/lib/engine/case";
import { handleError } from "@/lib/http";

/** GET /api/auth/me?as=WEB|APP|STAFF → quién soy y, si soy paciente, qué trámite tengo pendiente. */
export async function GET(req: Request) {
  try {
    const actor = await requireActor(req);
    if (actor.channel === "CALL_CENTER") return Response.json({ staff: actor.session });
    const { patientId, identityId } = actor.session;
    if (!patientId) {
      const anonCase = await db.case.findFirst({ where: { anonIdentityId: identityId, patientId: null }, orderBy: { updatedAt: "desc" } });
      return Response.json({ patient: null, activeCase: anonCase });
    }
    const patient = await db.patient.findUnique({ where: { id: patientId }, select: { id: true, nombre: true } });
    return Response.json({ patient, activeCase: await getActiveCase(patientId) });
  } catch (err) {
    return handleError(err);
  }
}
