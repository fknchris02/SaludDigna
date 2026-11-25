import type { CaseStep, Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { EventType, toJson } from "./events";

export const PAUSE_AFTER_MS = 10 * 60_000; // trámite abierto sin actividad por 10 min = pausado (candidato a recuperar)
const PATIENT_CHANNELS: Channel[] = ["WEB", "WHATSAPP", "CALL_CENTER", "APP", "CLINICA"];
const JOURNEY_TYPES = [
  EventType.CASE_CREATED,
  EventType.STEP_COMPLETED,
  EventType.CASE_RESUMED,
  EventType.APPOINTMENT_CONFIRMED,
  EventType.CASE_CANCELLED,
  EventType.CLINIC_CHECK_IN,
  EventType.CLINIC_APPOINTMENT_BOOKED,
  EventType.CLINIC_RESULTS_DELIVERED,
  EventType.CLINIC_FAMILY_APPOINTMENT,
  EventType.CLINIC_CASE_DELETED,
  EventType.CLINIC_PAYMENT_APPROVED,
  EventType.CLINIC_PAYMENT_REJECTED,
  EventType.CLINIC_PAYMENT_PENDING,
];

export type JourneyStatus = "ACTIVO" | "PAUSADO" | "CONFIRMADO" | "CANCELADO";

export function journeyStatus(step: CaseStep, updatedAt: Date, now: number): JourneyStatus {
  if (step === "CITA_CONFIRMADA") return "CONFIRMADO";
  if (step === "CANCELADO") return "CANCELADO";
  return now - updatedAt.getTime() > PAUSE_AFTER_MS ? "PAUSADO" : "ACTIVO";
}

/** Canales por los que pasó un trámite, en orden y sin repetir consecutivos: WEB → WHATSAPP → CALL_CENTER. */
export function channelPath(channels: Channel[]): Channel[] {
  return channels.filter((c, i) => c !== "SYSTEM" && c !== channels[i - 1]);
}

/**
 * Todo lo que el tablero del administrador necesita en una sola consulta.
 * shortcut: agrega en memoria sobre los 100 trámites más recientes y todos los cambios de canal;
 * con volumen real, mover a agregados SQL o una vista materializada alimentada por los eventos.
 */
export async function getOverview(now = Date.now()) {
  const since24h = new Date(now - 86400_000);
  const [byStep, cases, resumed, confirmed24h, switches24h, conflicts24h, clinicEvents24h, auditEvents, recent] = await Promise.all([
    db.case.groupBy({ by: ["step"], _count: { _all: true } }),
    db.case.findMany({ orderBy: { updatedAt: "desc" }, take: 100, include: { patient: { select: { nombre: true } } } }),
    db.event.findMany({ where: { type: EventType.CASE_RESUMED }, select: { payload: true } }),
    db.event.count({ where: { type: EventType.APPOINTMENT_CONFIRMED, createdAt: { gt: since24h } } }),
    db.event.count({ where: { type: EventType.CASE_RESUMED, createdAt: { gt: since24h } } }),
    db.event.count({ where: { type: EventType.CONFLICT_DETECTED, createdAt: { gt: since24h } } }),
    db.event.count({ where: { channel: "CLINICA", createdAt: { gt: since24h } } }),
    db.event.findMany({
      where: { OR: [{ actorId: { not: null } }, { channel: "CLINICA" }] },
      orderBy: { seq: "desc" },
      take: 25,
      include: { patient: { select: { nombre: true } } },
    }),
    db.event.findMany({ orderBy: { seq: "desc" }, take: 40 }),
  ]);

  const pathEvents = await db.event.findMany({
    where: { caseId: { in: cases.map((c) => c.id) }, type: { in: JOURNEY_TYPES } },
    orderBy: { seq: "asc" },
    select: { caseId: true, channel: true },
  });
  const paths = new Map<string, Channel[]>();
  for (const e of pathEvents) paths.set(e.caseId!, [...(paths.get(e.caseId!) ?? []), e.channel]);

  const journeys = cases.map((c) => {
    const d = c.data as Record<string, string>;
    return {
      caseId: c.id,
      paciente: c.patient?.nombre ?? null, // null = visitante anónimo
      estudio: d.estudio ?? null,
      clinica: d.clinica ?? null,
      folio: d.folio ?? null,
      step: c.step,
      status: journeyStatus(c.step, c.updatedAt, now),
      channels: channelPath(paths.get(c.id) ?? [c.lastChannel]),
      lastChannel: c.lastChannel,
      updatedAt: c.updatedAt,
    };
  });

  const steps = Object.fromEntries(byStep.map((g) => [g.step, g._count._all])) as Partial<Record<CaseStep, number>>;
  const open = byStep.filter((g) => g.step !== "CITA_CONFIRMADA" && g.step !== "CANCELADO").reduce((n, g) => n + g._count._all, 0);

  const transitions: Record<string, Record<string, number>> = {};
  for (const { payload } of resumed) {
    const { from, to } = payload as { from: string; to: string };
    (transitions[from] ??= {})[to] = (transitions[from][to] ?? 0) + 1;
  }

  const staffIds = [...new Set(auditEvents.map((e) => e.actorId).filter((x): x is string => !!x))];
  const staff = new Map(
    staffIds.length
      ? (await db.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, nombre: true, role: true } })).map((s) => [s.id, s])
      : [],
  );

  return {
    kpis: {
      open,
      paused: journeys.filter((j) => j.status === "PAUSADO").length,
      confirmed24h,
      switches24h,
      conflicts24h,
      clinicEvents24h,
      multichannelPct: journeys.length ? Math.round((100 * journeys.filter((j) => j.channels.length > 1).length) / journeys.length) : 0,
    },
    steps,
    transitions,
    channels: PATIENT_CHANNELS,
    journeys,
    audit: auditEvents.map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const staffMember = e.actorId ? (staff.get(e.actorId) ?? null) : null;
      const recepcionNombre = typeof p.recepcion === "string" && p.recepcion ? p.recepcion : null;
      const clinicaNombre = typeof p.clinica === "string" && p.clinica ? p.clinica : null;
      return {
        seq: e.seq.toString(),
        type: e.type,
        channel: e.channel,
        createdAt: e.createdAt,
        staff: staffMember ?? (recepcionNombre ? { nombre: recepcionNombre, role: "RECEPCION" } : null),
        clinica: clinicaNombre,
        paciente: e.patient?.nombre ?? (typeof p.pacienteNombre === "string" ? p.pacienteNombre : null),
        payload: e.payload,
      };
    }),
    recent: recent.reverse().map(toJson),
  };
}
