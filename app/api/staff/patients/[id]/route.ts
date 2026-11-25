import { assertStaffCanSee, requireStaff } from "@/lib/auth/session";
import { summarizeJourney } from "@/lib/ai/summary";
import { db } from "@/lib/db";
import { EngineError, getActiveCase, pendingStep } from "@/lib/engine/case";
import { recordStaffAccess, toJson } from "@/lib/engine/events";
import { isVerifiedByStaff } from "@/lib/engine/identity";
import { handleError } from "@/lib/http";
import { isInternalSwi, pagoView } from "@/lib/integrations/swi";

/** Expediente completo para el asesor (requiere validación previa): paciente, trámite abierto, resumen y línea de tiempo. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await params;
    await assertStaffCanSee(staff, id);
    const patient = await db.patient.findUnique({
      where: { id },
      select: { id: true, nombre: true, telefono: true, fechaNac: true, email: true, createdAt: true },
    });
    if (!patient) throw new EngineError("NOT_FOUND", "Paciente no encontrado");
    const active = await getActiveCase(id);
    await recordStaffAccess(staff.staffId, staff.role, id, active?.id ?? null);

    const events = (await db.event.findMany({ where: { patientId: id }, orderBy: { seq: "desc" }, take: 200 })).reverse().filter((e) => !isInternalSwi(e));
    const history = await db.case.findMany({
      where: { patientId: id, step: { in: ["CITA_CONFIRMADA", "CANCELADO"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
    const swiTramites = await db.swiTramite.findMany({ where: { patientId: id }, select: { id: true, study: { select: { nombre: true } } } });
    const estudio = new Map(swiTramites.map((t) => [t.id, t.study?.nombre ?? null]));
    const pagos = await db.swiPago.findMany({
      where: { tramiteId: { in: [...estudio.keys()] } },
      orderBy: [{ creadoEnSwi: { sort: "desc", nulls: "last" } }, { recibidoEn: "desc" }],
      take: 10,
    });
    return Response.json({
      swiPayments: pagos.map((p) => ({ ...pagoView(p), estudio: estudio.get(p.tramiteId ?? "") ?? null })),
      patient: { ...patient, fechaNac: patient.fechaNac?.toISOString().slice(0, 10) ?? null },
      verifiedUntil: await isVerifiedByStaff(staff.staffId, id),
      activeCase: active,
      pending: active ? pendingStep(active.step) : null,
      history,
      summary: summarizeJourney(events, active),
      timeline: events.map(toJson),
    });
  } catch (err) {
    return handleError(err);
  }
}
