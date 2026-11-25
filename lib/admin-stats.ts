import { db } from "@/lib/db";
import { EventType } from "@/lib/engine/events";
import { pagoView } from "@/lib/integrations/swi";

/**
 * Estadísticas del dashboard que no salen de la lista de recorridos: comparación con ayer, tiempo de conversión,
 * recuperación tras abandono, tráfico por clínica, personal, bot e integración SWI. Junta trámites propios y de SWI.
 * shortcut: agrega en memoria (~10 mil filas); con volumen real, mover a agregados SQL.
 */
const SWI_CONFIRMED = ["AGENDADO", "CONFIRMADO"];

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function getAdminStats(now = Date.now()) {
  const d24 = new Date(now - 86400_000);
  const d48 = new Date(now - 2 * 86400_000);
  const h1 = new Date(now - 3600_000);

  const [
    prevOurs, prevSwi, ourConfirms, swiFirstConfirm, swiAbandoned, cases, swiByClinic, asesores,
    staff24h, botOut24h, aiIntents24h, swiLast, swiLastHour, pagosByEstado, recentPagos,
  ] = await Promise.all([
    db.event.count({ where: { type: EventType.APPOINTMENT_CONFIRMED, createdAt: { gt: d48, lte: d24 } } }),
    db.swiEvento.count({ where: { tipoEvento: "CITA_CONFIRMADA", fecha: { gt: d48, lte: d24 } } }),
    db.event.findMany({ where: { type: EventType.APPOINTMENT_CONFIRMED }, select: { createdAt: true, case: { select: { createdAt: true } } } }),
    db.swiEvento.groupBy({ by: ["tramiteId"], where: { tipoEvento: { in: ["CITA_AGENDADA", "CITA_CONFIRMADA"] }, tramiteId: { not: null } }, _min: { fecha: true } }),
    db.swiEvento.groupBy({ by: ["tramiteId"], where: { tipoEvento: "TRAMITE_ABANDONADO", tramiteId: { not: null } } }),
    db.case.findMany({ select: { step: true, data: true } }),
    db.swiTramite.groupBy({ by: ["clinicId", "estado"], where: { eliminadoEn: null, clinicId: { not: null } }, _count: { _all: true } }),
    db.staffUser.count({ where: { role: "ASESOR" } }),
    db.event.groupBy({ by: ["actorId"], where: { actorId: { not: null }, createdAt: { gt: d24 } }, _count: { _all: true } }),
    db.event.count({ where: { type: EventType.MESSAGE_OUT, createdAt: { gt: d24 } } }),
    db.event.count({ where: { type: EventType.INTENT_CLASSIFIED, createdAt: { gt: d24 }, payload: { path: ["source"], equals: "llm" } } }),
    db.swiEvento.aggregate({ _max: { recibidoEn: true } }),
    db.swiEvento.count({ where: { recibidoEn: { gt: h1 } } }),
    db.swiPago.groupBy({ by: ["estado"], _count: { _all: true }, _sum: { monto: true } }),
    db.swiPago.findMany({ orderBy: [{ creadoEnSwi: { sort: "desc", nulls: "last" } }, { recibidoEn: "desc" }], take: 6 }),
  ]);

  // Tiempo de conversión: de que se crea el trámite a que se confirma la cita.
  const swiIds = swiFirstConfirm.map((g) => g.tramiteId!);
  const abandonedIds = swiAbandoned.map((g) => g.tramiteId!);
  const [swiCreated, recovered] = await Promise.all([
    db.swiTramite.findMany({ where: { id: { in: swiIds }, creadoEnSwi: { not: null } }, select: { id: true, creadoEnSwi: true } }),
    db.swiTramite.count({ where: { id: { in: abandonedIds }, estado: { in: SWI_CONFIRMED } } }),
  ]);
  const firstConfirm = new Map(swiFirstConfirm.map((g) => [g.tramiteId!, g._min.fecha]));
  const minutes = [
    ...ourConfirms.filter((e) => e.case).map((e) => (e.createdAt.getTime() - e.case!.createdAt.getTime()) / 60_000),
    ...swiCreated.flatMap((t) => {
      const f = firstConfirm.get(t.id);
      return f ? [(f.getTime() - t.creadoEnSwi!.getTime()) / 60_000] : [];
    }),
  ].filter((m) => m >= 0);

  // Tráfico por clínica: trámites propios (data.clinicId) + de SWI.
  const traffic = new Map<string, { total: number; confirmed: number }>();
  const bump = (id: string, n: number, confirmed: boolean) => {
    const t = traffic.get(id) ?? { total: 0, confirmed: 0 };
    t.total += n;
    if (confirmed) t.confirmed += n;
    traffic.set(id, t);
  };
  for (const c of cases) {
    const id = (c.data as Record<string, string>).clinicId;
    if (id) bump(id, 1, c.step === "CITA_CONFIRMADA");
  }
  for (const g of swiByClinic) bump(g.clinicId!, g._count._all, SWI_CONFIRMED.includes(g.estado ?? ""));
  const clinicInfo = new Map((await db.clinic.findMany({ where: { id: { in: [...traffic.keys()] } } })).map((c) => [c.id, c]));

  // Pagos de SWI: solo APROBADO cuenta como cobrado; PENDIENTE = pagará en clínica; RECHAZADO = intento fallido.
  const byEstado = (e: string) => pagosByEstado.find((g) => g.estado === e);
  const pagoTramites = new Map(
    (await db.swiTramite.findMany({
      where: { id: { in: recentPagos.map((p) => p.tramiteId!).filter(Boolean) } },
      select: { id: true, patient: { select: { nombre: true } }, study: { select: { nombre: true } } },
    })).map((t) => [t.id, t]),
  );

  // Personal que actuó en las últimas 24 h.
  const people = new Map((await db.staffUser.findMany({ where: { id: { in: staff24h.map((s) => s.actorId!) } }, select: { id: true, nombre: true, role: true } })).map((s) => [s.id, s]));

  return {
    confirmedPrev24h: prevOurs + prevSwi,
    conversionMedianMin: median(minutes),
    conversionSamples: minutes.length,
    recovery: { abandoned: abandonedIds.length, recovered },
    clinics: [...traffic.entries()]
      .map(([id, t]) => ({ id, nombre: clinicInfo.get(id)?.nombre ?? id, ciudad: clinicInfo.get(id)?.ciudad ?? "", ...t }))
      .sort((a, b) => b.total - a.total),
    staff: {
      asesores,
      active: staff24h
        .map((s) => ({ nombre: people.get(s.actorId!)?.nombre ?? "Personal", role: people.get(s.actorId!)?.role ?? "ASESOR", acciones: s._count._all }))
        .sort((a, b) => b.acciones - a.acciones),
    },
    bot: { messagesOut24h: botOut24h, aiIntents24h },
    swi: { lastReceivedAt: swiLast._max.recibidoEn, lastHour: swiLastHour },
    payments: {
      approved: { count: byEstado("APROBADO")?._count._all ?? 0, total: Number(byEstado("APROBADO")?._sum.monto ?? 0) },
      pending: { count: byEstado("PENDIENTE")?._count._all ?? 0, total: Number(byEstado("PENDIENTE")?._sum.monto ?? 0) },
      rejected: { count: byEstado("RECHAZADO")?._count._all ?? 0 },
      recent: recentPagos.map((p) => {
        const t = pagoTramites.get(p.tramiteId ?? "");
        return { ...pagoView(p), paciente: t?.patient.nombre ?? null, estudio: t?.study?.nombre ?? null };
      }),
    },
  };
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
