import { Prisma, type Case, type Event } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { EngineError, isOpen } from "./case";
import { appendEvent, EventType, publish } from "./events";
import { maskPhone, normalizePhone } from "./identity";

export const CLINIC_EVENT_TYPES = [
  EventType.CLINIC_CHECK_IN,
  EventType.CLINIC_APPOINTMENT_BOOKED,
  EventType.APPOINTMENT_CONFIRMED,
  EventType.CLINIC_RESULTS_DELIVERED,
  EventType.CLINIC_FAMILY_APPOINTMENT,
  EventType.CASE_CANCELLED,
  EventType.CLINIC_CASE_DELETED,
  EventType.CLINIC_PAYMENT_APPROVED,
  EventType.CLINIC_PAYMENT_REJECTED,
  EventType.CLINIC_PAYMENT_PENDING,
  EventType.CLINIC_PATIENT_REGISTERED,
  EventType.CLINIC_REPORT_SENT,
  EventType.CLINIC_STAFF_LOGIN,
  EventType.CLINIC_STAFF_LOGOUT,
  EventType.CLINIC_PATIENT_VIEWED,
] as const;

export type ClinicEventType = (typeof CLINIC_EVENT_TYPES)[number];

/** Eventos de clínica que participan en el recorrido de un trámite y pueden registrar cambio de canal. */
const CASE_LINKABLE_TYPES = new Set<string>([
  EventType.CLINIC_CHECK_IN,
  EventType.CLINIC_APPOINTMENT_BOOKED,
  EventType.APPOINTMENT_CONFIRMED,
  EventType.CLINIC_RESULTS_DELIVERED,
  EventType.CLINIC_FAMILY_APPOINTMENT,
  EventType.CASE_CANCELLED,
  EventType.CLINIC_CASE_DELETED,
  EventType.CLINIC_PAYMENT_APPROVED,
  EventType.CLINIC_PAYMENT_REJECTED,
  EventType.CLINIC_PAYMENT_PENDING,
  EventType.CLINIC_REPORT_SENT,
]);

export const ClinicEventSchema = z.object({
  type: z.enum(CLINIC_EVENT_TYPES),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  telefono: z.string().trim().max(30).optional().nullable(),
  pacienteNombre: z.string().trim().max(200).optional().nullable(),
  folio: z.string().trim().max(60).optional().nullable(),
  estudio: z.string().trim().max(200).optional().nullable(),
  clinica: z.string().trim().max(200).optional().nullable(),
  clinicaId: z.string().trim().max(100).optional().nullable(),
  fechaCita: z.string().trim().max(60).optional().nullable(),
  recepcion: z.string().trim().max(120).optional().nullable(),
  monto: z.number().nonnegative().optional().nullable(),
  marca: z.string().trim().max(40).optional().nullable(),
  ultimos4: z.string().trim().regex(/^\d{4}$/).optional().nullable(),
  referencia: z.string().trim().max(100).optional().nullable(),
  motivo: z.string().trim().max(300).optional().nullable(),
  familiarNombre: z.string().trim().max(200).optional().nullable(),
  parentesco: z.string().trim().max(40).optional().nullable(),
  accion: z.string().trim().max(40).optional().nullable(),
  tramiteId: z.string().trim().max(100).optional().nullable(),
  canalOrigen: z.string().trim().max(40).optional().nullable(),
});

export type ClinicEventInput = z.infer<typeof ClinicEventSchema>;

function tryNormalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

function findMatchingCase(cases: Case[], input: ClinicEventInput): Case | null {
  if (cases.length === 0) return null;
  if (input.folio) {
    const byFolio = cases.find((c) => (c.data as Record<string, unknown>)?.folio === input.folio);
    if (byFolio) return byFolio;
  }
  if (input.type === EventType.CLINIC_APPOINTMENT_BOOKED || input.type === EventType.APPOINTMENT_CONFIRMED || input.type === EventType.CASE_CANCELLED) {
    return cases.find(isOpen) ?? cases[0];
  }
  return cases[0];
}

function buildPayload(input: ClinicEventInput, telefonoE164: string | null, fallbackNombre?: string | null): Prisma.InputJsonObject {
  const payload: Record<string, unknown> = {};
  const nombre = input.pacienteNombre || fallbackNombre || null;
  if (nombre) payload.pacienteNombre = nombre;
  if (telefonoE164) payload.telefonoMasked = maskPhone(telefonoE164);
  if (input.folio) payload.folio = input.folio;
  if (input.estudio) payload.estudio = input.estudio;
  if (input.clinica) payload.clinica = input.clinica;
  if (input.clinicaId) payload.clinicaId = input.clinicaId;
  if (input.fechaCita) payload.fechaCita = input.fechaCita;
  if (input.recepcion) payload.recepcion = input.recepcion;
  if (typeof input.monto === "number" && Number.isFinite(input.monto)) payload.monto = input.monto;
  if (input.marca) payload.marca = input.marca;
  if (input.ultimos4) payload.ultimos4 = input.ultimos4;
  if (input.referencia) payload.referencia = input.referencia;
  if (input.motivo) payload.motivo = input.motivo;
  if (input.familiarNombre) payload.familiarNombre = input.familiarNombre;
  if (input.parentesco) payload.parentesco = input.parentesco;
  if (input.accion) payload.accion = input.accion;
  if (input.tramiteId) payload.tramiteId = input.tramiteId;
  if (input.canalOrigen) payload.canalOrigen = input.canalOrigen;

  // Compatibilidad con los nodos existentes de JourneyGraph y TimelineItem para eventos estándar.
  if (input.type === EventType.APPOINTMENT_CONFIRMED || input.type === EventType.CASE_CANCELLED) {
    payload.to = input.type === EventType.APPOINTMENT_CONFIRMED ? "CITA_CONFIRMADA" : "CANCELADO";
    payload.data = {
      ...(input.estudio ? { estudio: input.estudio } : {}),
      ...(input.clinica ? { clinica: input.clinica } : {}),
      ...(input.fechaCita ? { horario: input.fechaCita } : {}),
      ...(input.folio ? { folio: input.folio } : {}),
      ...(input.motivo ? { motivoCancelacion: input.motivo } : {}),
    };
  }
  return payload as Prisma.InputJsonObject;
}

/**
 * Ingesta de un evento proveniente de WEB-CLINICA (Opción B):
 * - Si el teléfono coincide con un Patient existente en SaludDigna, enlaza patientId y caseId
 *   (emitiendo CASE_RESUMED si cambió de canal hacia CLINICA).
 * - Si el paciente no existe localmente, NO crea espejos de Patient/Case: guarda el Event
 *   con channel: "CLINICA" y lo publica en el bus SSE para el panel del administrador.
 */
export async function ingestClinicEvent(raw: unknown): Promise<{ duplicate: boolean; events: Event[] }> {
  const parsed = ClinicEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EngineError("INVALID_DATA", "Evento de clínica inválido", { issues: parsed.error.issues });
  }
  const input = parsed.data;
  const telefonoE164 = tryNormalizePhone(input.telefono);

  try {
    const result = await db.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const seen = await tx.event.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (seen) return { duplicate: true as const, events: [seen] };
      }

      const patient = telefonoE164 ? await tx.patient.findUnique({ where: { telefono: telefonoE164 } }) : null;
      let matchedCase: Case | null = null;
      const events: Event[] = [];

      if (patient && CASE_LINKABLE_TYPES.has(input.type)) {
        const cases = await tx.case.findMany({
          where: { patientId: patient.id },
          orderBy: { updatedAt: "desc" },
          take: 10,
        });
        matchedCase = findMatchingCase(cases, input);

        if (matchedCase) {
          const prevChannel = matchedCase.lastChannel;
          const prevData = (matchedCase.data ?? {}) as Record<string, unknown>;
          const nextData: Record<string, unknown> = { ...prevData };
          let nextStep = matchedCase.step;

          if (input.type === EventType.APPOINTMENT_CONFIRMED && matchedCase.step !== "CITA_CONFIRMADA" && matchedCase.step !== "CANCELADO") {
            nextStep = "CITA_CONFIRMADA";
            if (input.folio) nextData.folio = input.folio;
            if (input.estudio && !nextData.estudio) nextData.estudio = input.estudio;
            if (input.clinica && !nextData.clinica) nextData.clinica = input.clinica;
            if (input.fechaCita && !nextData.horario) nextData.horario = input.fechaCita;
          } else if (input.type === EventType.CASE_CANCELLED && matchedCase.step !== "CANCELADO") {
            nextStep = "CANCELADO";
            if (input.motivo) nextData.motivoCancelacion = input.motivo;
          }

          if (prevChannel !== "CLINICA" || nextStep !== matchedCase.step) {
            await tx.case.update({
              where: { id: matchedCase.id },
              data: {
                lastChannel: "CLINICA",
                step: nextStep,
                data: nextData as Prisma.InputJsonObject,
              },
            });
          }

          if (prevChannel !== "CLINICA") {
            events.push(
              await appendEvent(tx, {
                type: EventType.CASE_RESUMED,
                channel: "CLINICA",
                caseId: matchedCase.id,
                patientId: patient.id,
                payload: {
                  from: prevChannel,
                  to: "CLINICA",
                  step: matchedCase.step,
                  ...(input.recepcion ? { recepcion: input.recepcion } : {}),
                  ...(input.clinica ? { clinica: input.clinica } : {}),
                },
              }),
            );
          }
        }
      }

      const payload = buildPayload(input, telefonoE164, patient?.nombre);

      const ev = await appendEvent(tx, {
        type: input.type,
        channel: "CLINICA",
        caseId: matchedCase?.id ?? null,
        patientId: patient?.id ?? null,
        idempotencyKey: input.idempotencyKey,
        payload,
      });
      events.push(ev);

      return { duplicate: false as const, events };
    });

    if (!result.duplicate) publish(result.events);
    return result;
  } catch (err) {
    if (input.idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const seen = await db.event.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (seen) return { duplicate: true, events: [seen] };
    }
    throw err;
  }
}
