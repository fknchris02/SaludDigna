import { z } from "zod";
import { assertStaffCanSee, ensurePatientSession, getActor, requireActor, type Actor } from "@/lib/auth/session";
import { createCase, EngineError, getActiveCase } from "@/lib/engine/case";
import { handleError } from "@/lib/http";

/** Crea un trámite. Paciente: para sí mismo (o como anónimo). Asesor: para el paciente indicado. */
export async function POST(req: Request) {
  try {
    // En la web se puede cotizar sin cuenta: el primer trámite crea la sesión de visitante anónimo.
    const actor: Actor =
      (await getActor(req)) ??
      (req.headers.get("x-sd-channel") === "WEB" ? { channel: "WEB", session: await ensurePatientSession("WEB") } : await requireActor(req));
    if (actor.channel === "CALL_CENTER") {
      const { patientId } = z.object({ patientId: z.string().min(1) }).parse(await req.json());
      await assertStaffCanSee(actor.session, patientId);
      return Response.json(await createCase({ channel: actor.channel, patientId }), { status: 201 });
    }
    const { patientId, identityId } = actor.session;
    const c = await createCase(
      patientId ? { channel: actor.channel, patientId } : { channel: actor.channel, anonIdentityId: identityId },
    );
    return Response.json(c, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

/** Trámite abierto que el canal debe ofrecer retomar (o null). Paciente: el suyo. Personal: ?patientId=. */
export async function GET(req: Request) {
  try {
    const actor = await requireActor(req);
    const patientId =
      actor.channel === "CALL_CENTER"
        ? z.string().min(1).parse(new URL(req.url).searchParams.get("patientId"))
        : actor.session.patientId;
    if (actor.channel === "CALL_CENTER") await assertStaffCanSee(actor.session, patientId);
    if (!patientId) throw new EngineError("IDENTITY_REQUIRED", "Verifica tu teléfono para ver tus trámites");
    return Response.json(await getActiveCase(patientId));
  } catch (err) {
    return handleError(err);
  }
}
