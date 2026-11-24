import { EventEmitter } from "node:events";
import type { Channel, Event, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

// Catálogo de eventos (ver docs/eventos.md).
export const EventType = {
  IDENTITY_ANONYMOUS_CREATED: "IDENTITY_ANONYMOUS_CREATED",
  IDENTITY_LINKED: "IDENTITY_LINKED",
  IDENTITY_VERIFIED: "IDENTITY_VERIFIED",
  OTP_SENT: "OTP_SENT",
  OTP_FAILED: "OTP_FAILED",
  CASE_CREATED: "CASE_CREATED",
  STEP_COMPLETED: "STEP_COMPLETED",
  CASE_RESUMED: "CASE_RESUMED",
  MESSAGE_IN: "MESSAGE_IN",
  MESSAGE_OUT: "MESSAGE_OUT",
  INTENT_CLASSIFIED: "INTENT_CLASSIFIED",
  ADVISOR_OPENED_CASE: "ADVISOR_OPENED_CASE",
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",
  CASE_CANCELLED: "CASE_CANCELLED",
  CONFLICT_DETECTED: "CONFLICT_DETECTED",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export type NewEvent = {
  type: EventType;
  channel: Channel;
  payload?: Prisma.InputJsonValue;
  caseId?: string | null;
  patientId?: string | null;
  actorId?: string | null;
  idempotencyKey?: string | null;
};

// shortcut: bus en memoria = un solo proceso; con varias instancias usar Postgres LISTEN/NOTIFY o Redis.
const g = globalThis as unknown as { eventBus?: EventEmitter };
export const bus = g.eventBus ?? new EventEmitter().setMaxListeners(0);
g.eventBus = bus;

/** Inserta un evento dentro de una transacción. Publicar con `publish` DESPUÉS del commit. */
export function appendEvent(tx: Tx, e: NewEvent) {
  return tx.event.create({ data: { ...e, payload: e.payload ?? {} } });
}

export function publish(events: Event[]) {
  for (const e of events) bus.emit("event", e);
}

/** Inserta y publica un evento suelto (fuera de una transacción mayor). */
export async function recordEvent(e: NewEvent) {
  const ev = await db.event.create({ data: { ...e, payload: e.payload ?? {} } });
  publish([ev]);
  return ev;
}

export type EventFilter = { caseId?: string; patientId?: string };

export function matches(e: Event, f: EventFilter) {
  return (!f.caseId || e.caseId === f.caseId) && (!f.patientId || e.patientId === f.patientId);
}

/** Eventos posteriores a `afterSeq` (para replay en reconexión SSE y para la línea de tiempo). */
export function eventsSince(f: EventFilter, afterSeq = 0n, take = 500) {
  return db.event.findMany({
    where: { seq: { gt: afterSeq }, caseId: f.caseId, patientId: f.patientId },
    orderBy: { seq: "asc" },
    take,
  });
}

/** Forma JSON del evento (BigInt no es serializable). */
export function toJson(e: Event) {
  return { ...e, seq: e.seq.toString() };
}

/**
 * Auditoría: el personal consultó el expediente. Se registra una vez cada 10 min por persona y paciente,
 * para que las recargas en vivo de la consola no llenen la bitácora.
 */
export async function recordStaffAccess(staffId: string, role: string, patientId: string, caseId: string | null) {
  const recent = await db.event.findFirst({
    where: { type: EventType.ADVISOR_OPENED_CASE, actorId: staffId, patientId, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
  });
  if (recent) return;
  await recordEvent({ type: EventType.ADVISOR_OPENED_CASE, channel: "CALL_CENTER", patientId, caseId, actorId: staffId, payload: { role } });
}
