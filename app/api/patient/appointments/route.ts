import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EngineError, getActiveCase } from "@/lib/engine/case";
import { handleError } from "@/lib/http";

/** GET /api/patient/appointments?as=APP|WEB → trámite en curso, próximas citas e historial del paciente en sesión. */
export async function GET(req: Request) {
  try {
    const actor = await requireActor(req);
    if (actor.channel === "CALL_CENTER") throw new EngineError("FORBIDDEN", "Solo para pacientes");
    const patientId = actor.session.patientId;
    if (!patientId) throw new EngineError("IDENTITY_REQUIRED", "Inicia sesión con tu teléfono");

    const [patient, active, closed] = await Promise.all([
      db.patient.findUniqueOrThrow({ where: { id: patientId }, select: { id: true, nombre: true } }),
      getActiveCase(patientId),
      db.case.findMany({ where: { patientId, step: { in: ["CITA_CONFIRMADA", "CANCELADO"] } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    ]);
    const clinicIds = [...new Set(closed.map((c) => (c.data as Record<string, string>).clinicId).filter(Boolean))];
    const clinics = new Map((await db.clinic.findMany({ where: { id: { in: clinicIds } } })).map((c) => [c.id, c]));

    const now = Date.now();
    const withClinic = (c: (typeof closed)[number]) => {
      const d = c.data as Record<string, string>;
      return { ...c, direccion: clinics.get(d.clinicId)?.direccion ?? null };
    };
    const isUpcoming = (c: (typeof closed)[number]) =>
      c.step === "CITA_CONFIRMADA" && new Date((c.data as Record<string, string>).horario).getTime() > now;

    return Response.json({
      patient,
      active,
      upcoming: closed.filter(isUpcoming).map(withClinic).sort((a, b) => String((a.data as Record<string, string>).horario).localeCompare(String((b.data as Record<string, string>).horario))),
      history: closed.filter((c) => !isUpcoming(c)).map(withClinic),
    });
  } catch (err) {
    return handleError(err);
  }
}
