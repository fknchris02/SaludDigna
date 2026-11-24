import { randomBytes } from "node:crypto";
import { Prisma, type Case, type CaseStep, type Channel, type Event } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { appendEvent, EventType, publish, recordEvent } from "./events";

export class EngineError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_TRANSITION"
      | "INVALID_DATA"
      | "IDENTITY_REQUIRED"
      | "UNAUTHENTICATED"
      | "FORBIDDEN",
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get status() {
    return {
      NOT_FOUND: 404,
      CONFLICT: 409,
      INVALID_TRANSITION: 422,
      INVALID_DATA: 400,
      IDENTITY_REQUIRED: 403,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
    }[this.code];
  }
}

// Orden del flujo "agendar estudio". CANCELADO queda fuera del orden.
export const FLOW: CaseStep[] = [
  "INICIADO",
  "ESTUDIO_ELEGIDO",
  "CLINICA_ELEGIDA",
  "HORARIO_ELEGIDO",
  "DATOS_CONFIRMADOS",
  "CITA_CONFIRMADA",
];

// Llaves de `data` que llena cada paso; al regresar a un paso se borran las de los pasos posteriores.
const STEP_KEYS: Partial<Record<CaseStep, string[]>> = {
  ESTUDIO_ELEGIDO: ["studyId", "estudio", "precio", "preparacion"],
  CLINICA_ELEGIDA: ["clinicId", "clinica"],
  HORARIO_ELEGIDO: ["horario"],
  CITA_CONFIRMADA: ["folio"],
};

const STEP_INPUT = {
  ESTUDIO_ELEGIDO: z.object({ studyId: z.string().min(1) }),
  CLINICA_ELEGIDA: z.object({ clinicId: z.string().min(1) }),
  HORARIO_ELEGIDO: z.object({ horario: z.iso.datetime({ offset: true }) }),
  DATOS_CONFIRMADOS: z.object({}),
  CITA_CONFIRMADA: z.object({}),
  CANCELADO: z.object({ motivo: z.string().max(200).optional() }),
} satisfies Partial<Record<CaseStep, z.ZodType>>;
type TargetStep = keyof typeof STEP_INPUT;

/** Regla de transición: avanzar un paso, repetir o regresar para corregir; cancelar desde cualquier estado abierto. */
export function canTransition(from: CaseStep, to: CaseStep): boolean {
  if (from === "CANCELADO") return false;
  if (to === "CANCELADO") return true;
  if (from === "CITA_CONFIRMADA") return false;
  const i = FLOW.indexOf(from);
  const j = FLOW.indexOf(to);
  return j >= 1 && j <= i + 1;
}

/** Siguiente paso pendiente (lo que un canal debe pedir al retomar), o null si el trámite terminó. */
export function pendingStep(step: CaseStep): CaseStep | null {
  if (step === "CANCELADO" || step === "CITA_CONFIRMADA") return null;
  return FLOW[FLOW.indexOf(step) + 1];
}

export function isOpen(c: Pick<Case, "step">) {
  return pendingStep(c.step) !== null;
}

export async function createCase(input: { channel: Channel; patientId?: string; anonIdentityId?: string }) {
  if (!input.patientId && !input.anonIdentityId) throw new EngineError("INVALID_DATA", "El caso necesita paciente o identidad anónima");
  const { c, ev } = await db.$transaction(async (tx) => {
    const c = await tx.case.create({
      data: { lastChannel: input.channel, patientId: input.patientId, anonIdentityId: input.anonIdentityId },
    });
    const ev = await appendEvent(tx, {
      type: EventType.CASE_CREATED,
      channel: input.channel,
      caseId: c.id,
      patientId: c.patientId,
      payload: { tipo: c.tipo },
    });
    return { c, ev };
  });
  publish([ev]);
  return c;
}

/** Trámite abierto más reciente del paciente: es lo que cualquier canal ofrece retomar. */
export async function getActiveCase(patientId: string) {
  const cases = await db.case.findMany({ where: { patientId }, orderBy: { updatedAt: "desc" }, take: 20 });
  return cases.find(isOpen) ?? null;
}

/** El paciente aparece en otro canal y se le ofrece continuar: registra el cambio de canal sin tocar el estado. */
export async function resumeCase(caseId: string, channel: Channel) {
  const c = await db.case.findUnique({ where: { id: caseId } });
  if (!c) throw new EngineError("NOT_FOUND", "Caso no encontrado");
  if (c.lastChannel === channel) return c;
  // lastChannel es metadato: no sube `version` para no invalidar a quien esté editando.
  const updated = await db.case.update({ where: { id: caseId }, data: { lastChannel: channel } });
  await recordEvent({
    type: EventType.CASE_RESUMED,
    channel,
    caseId,
    patientId: c.patientId,
    payload: { from: c.lastChannel, to: channel, step: c.step },
  });
  return updated;
}

export type AdvanceInput = {
  caseId: string;
  to: CaseStep;
  data?: Record<string, unknown>;
  channel: Channel;
  expectedVersion: number;
  actorId?: string;
  idempotencyKey?: string;
};

/**
 * ÚNICA forma de cambiar el estado de un trámite. En una transacción:
 * valida transición y datos → actualiza el caso con bloqueo optimista → agrega eventos.
 * Publica en el bus solo después del commit.
 */
export async function advance(input: AdvanceInput): Promise<{ case: Case; events: Event[]; duplicate: boolean }> {
  if (input.to === "INICIADO") throw new EngineError("INVALID_TRANSITION", "No se puede regresar a INICIADO");
  const parsed = STEP_INPUT[input.to as TargetStep].safeParse(input.data ?? {});
  if (!parsed.success) throw new EngineError("INVALID_DATA", "Datos inválidos para el paso", { issues: parsed.error.issues });
  const stepData = parsed.data as Record<string, unknown>;

  try {
    const result = await db.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const seen = await tx.event.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (seen) return { duplicate: true as const };
      }

      const c = await tx.case.findUnique({ where: { id: input.caseId } });
      if (!c) throw new EngineError("NOT_FOUND", "Caso no encontrado");
      if (c.version !== input.expectedVersion) throw conflict(c);
      if (!canTransition(c.step, input.to)) {
        throw new EngineError("INVALID_TRANSITION", `No se puede pasar de ${c.step} a ${input.to}`, { from: c.step, to: input.to });
      }

      const data = clearLaterSteps(c.data as Record<string, unknown>, input.to);
      switch (input.to) {
        case "ESTUDIO_ELEGIDO": {
          const s = await tx.study.findUnique({ where: { id: String(stepData.studyId) } });
          if (!s) throw new EngineError("INVALID_DATA", "Estudio no existe");
          Object.assign(data, { studyId: s.id, estudio: s.nombre, precio: s.precio, preparacion: s.preparacion });
          break;
        }
        case "CLINICA_ELEGIDA": {
          const cl = await tx.clinic.findUnique({ where: { id: String(stepData.clinicId) } });
          if (!cl) throw new EngineError("INVALID_DATA", "Clínica no existe");
          Object.assign(data, { clinicId: cl.id, clinica: cl.nombre });
          break;
        }
        case "HORARIO_ELEGIDO":
          if (new Date(String(stepData.horario)) <= new Date()) throw new EngineError("INVALID_DATA", "El horario debe ser futuro");
          data.horario = stepData.horario;
          break;
        case "DATOS_CONFIRMADOS":
          if (!c.patientId) throw new EngineError("IDENTITY_REQUIRED", "Se requiere identidad verificada para confirmar datos");
          break;
        case "CITA_CONFIRMADA":
          data.folio = "SD-" + randomBytes(4).toString("hex").toUpperCase();
          break;
        case "CANCELADO":
          if (stepData.motivo) data.motivoCancelacion = stepData.motivo;
          break;
      }

      // Bloqueo optimista: si otro canal escribió entre la lectura y aquí, no se actualiza nada.
      const { count } = await tx.case.updateMany({
        where: { id: c.id, version: input.expectedVersion },
        data: { step: input.to, data: data as Prisma.InputJsonObject, version: { increment: 1 }, lastChannel: input.channel },
      });
      if (count === 0) throw conflict(await tx.case.findUniqueOrThrow({ where: { id: c.id } }));

      const base = { channel: input.channel, caseId: c.id, patientId: c.patientId, actorId: input.actorId };
      const events: Event[] = [];
      if (c.lastChannel !== input.channel) {
        events.push(
          await appendEvent(tx, { ...base, type: EventType.CASE_RESUMED, payload: { from: c.lastChannel, to: input.channel, step: c.step } }),
        );
      }
      const type =
        input.to === "CITA_CONFIRMADA" ? EventType.APPOINTMENT_CONFIRMED
        : input.to === "CANCELADO" ? EventType.CASE_CANCELLED
        : EventType.STEP_COMPLETED;
      events.push(
        await appendEvent(tx, {
          ...base,
          type,
          idempotencyKey: input.idempotencyKey,
          payload: { from: c.step, to: input.to, data } as Prisma.InputJsonObject,
        }),
      );
      const updated = await tx.case.findUniqueOrThrow({ where: { id: c.id } });
      return { duplicate: false as const, case: updated, events };
    });

    if (result.duplicate) return { duplicate: true, events: [], case: await db.case.findUniqueOrThrow({ where: { id: input.caseId } }) };
    publish(result.events);
    return result;
  } catch (err) {
    // Dos peticiones con la misma llave a la vez: la segunda choca con el índice único → es un duplicado.
    // Si esperó el candado de la primera, choca por versión: también es duplicado si su llave ya quedó guardada.
    const sameKeySaved =
      !!input.idempotencyKey &&
      ((err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") ||
        (err instanceof EngineError && err.code === "CONFLICT" &&
          !!(await db.event.findUnique({ where: { idempotencyKey: input.idempotencyKey } }))));
    if (sameKeySaved) {
      return { duplicate: true, events: [], case: await db.case.findUniqueOrThrow({ where: { id: input.caseId } }) };
    }
    if (err instanceof EngineError && err.code === "CONFLICT") {
      await recordEvent({
        type: EventType.CONFLICT_DETECTED,
        channel: input.channel,
        caseId: input.caseId,
        patientId: (err.details?.patientId as string | null) ?? null,
        actorId: input.actorId,
        payload: { expectedVersion: input.expectedVersion, currentVersion: err.details?.currentVersion ?? null, to: input.to },
      });
    }
    throw err;
  }
}

function conflict(c: Case) {
  return new EngineError("CONFLICT", "El trámite cambió en otro canal; recarga para continuar", {
    currentVersion: c.version,
    patientId: c.patientId,
  });
}

function clearLaterSteps(current: Record<string, unknown>, to: CaseStep) {
  const data = { ...current };
  const j = FLOW.indexOf(to);
  if (j < 0) return data; // CANCELADO conserva todo para trazabilidad
  for (const step of FLOW.slice(j + 1)) for (const k of STEP_KEYS[step] ?? []) delete data[k];
  return data;
}
