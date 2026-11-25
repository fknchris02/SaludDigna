import type { CaseStep, SwiTramite } from "@prisma/client";
import { db } from "@/lib/db";
import { pendingStep } from "@/lib/engine/case";
import { toJson } from "@/lib/engine/events";
import { PAUSE_AFTER_MS, type JourneyStatus } from "@/lib/engine/overview";
import { SWI_PREFIX } from "@/lib/labels";
import { SWI_EVENT_TYPE } from "./swi";

/**
 * Los trámites de SWI vistos como recorridos del tablero del admin (mismo formato que los nuestros).
 * Sus datos siguen en sus tablas: aquí solo se traducen su estado y sus canales.
 */

type T = Pick<SwiTramite, "estado" | "clinicId" | "fechaCita" | "actualizadoEnSwi" | "actualizadoEn">;
const updatedAt = (t: T) => t.actualizadoEnSwi ?? t.actualizadoEn;

/** Su estado → nuestra etapa. Si no es explícito, se deduce de lo que ya eligió. */
export function swiStep(t: T): CaseStep {
  if (t.estado === "AGENDADO" || t.estado === "CONFIRMADO") return "CITA_CONFIRMADA";
  if (t.estado === "CANCELADO") return "CANCELADO";
  if (t.estado === "DATOS_CAPTURADOS") return "DATOS_CONFIRMADOS";
  return t.fechaCita ? "HORARIO_ELEGIDO" : t.clinicId ? "CLINICA_ELEGIDA" : "ESTUDIO_ELEGIDO";
}

export function swiStatus(t: T, now: number): JourneyStatus {
  const step = swiStep(t);
  if (step === "CITA_CONFIRMADA") return "CONFIRMADO";
  if (step === "CANCELADO") return "CANCELADO";
  if (t.estado === "ABANDONADO") return "PAUSADO";
  return now - updatedAt(t).getTime() > PAUSE_AFTER_MS ? "PAUSADO" : "ACTIVO";
}

/** Canales en orden y sin repetir consecutivos. */
const dedupe = (cs: (string | null)[]) => cs.filter((c, i): c is string => !!c && c !== cs[i - 1]);

/**
 * Indicadores, etapas, cambios de canal y todos los recorridos de SWI (la lista coincide con los indicadores).
 * shortcut: agrega en memoria todos los trámites y eventos (~10 mil filas); con más volumen, agregados SQL.
 */
export async function getSwiOverview(now = Date.now()) {
  const since24h = new Date(now - 86400_000);
  const [tramites, events, confirmed24h] = await Promise.all([
    db.swiTramite.findMany({ where: { eliminadoEn: null }, select: { id: true, estado: true, clinicId: true, fechaCita: true, actualizadoEnSwi: true, actualizadoEn: true, canalOrigen: true, canalActual: true } }),
    db.swiEvento.findMany({ where: { tramiteId: { not: null } }, select: { tramiteId: true, canal: true, fecha: true }, orderBy: [{ fecha: "asc" }, { recibidoEn: "asc" }] }),
    db.swiEvento.count({ where: { tipoEvento: "CITA_CONFIRMADA", fecha: { gt: since24h } } }),
  ]);

  const byTramite = new Map<string, { canal: string | null; fecha: Date | null }[]>();
  for (const e of events) byTramite.set(e.tramiteId!, [...(byTramite.get(e.tramiteId!) ?? []), e]);

  const steps: Partial<Record<CaseStep, number>> = {};
  const transitions: Record<string, Record<string, number>> = {};
  let open = 0, paused = 0, multichannel = 0, switches24h = 0;
  const info = new Map<string, { step: CaseStep; status: JourneyStatus; channels: string[] }>();

  for (const t of tramites) {
    const step = swiStep(t);
    const status = swiStatus(t, now);
    steps[step] = (steps[step] ?? 0) + 1;
    if (status === "ACTIVO" || status === "PAUSADO") open++;
    if (status === "PAUSADO") paused++;

    // Cambios de canal: dos eventos seguidos del trámite en canales distintos.
    const path = (byTramite.get(t.id) ?? []).filter((e) => e.canal);
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      if (a.canal === b.canal) continue;
      (transitions[a.canal!] ??= {})[b.canal!] = (transitions[a.canal!][b.canal!] ?? 0) + 1;
      if (b.fecha && b.fecha > since24h) switches24h++;
    }
    const channels = dedupe(path.length ? path.map((e) => e.canal) : [t.canalOrigen, t.canalActual]);
    if (channels.length > 1) multichannel++;
    info.set(t.id, { step, status, channels });
  }

  const recent = await db.swiTramite.findMany({
    where: { eliminadoEn: null },
    orderBy: [{ actualizadoEnSwi: { sort: "desc", nulls: "last" } }, { actualizadoEn: "desc" }],
    include: { patient: { select: { nombre: true } }, study: { select: { nombre: true } }, clinic: { select: { nombre: true } } },
  });

  return {
    kpis: { open, paused, confirmed24h, switches24h, multichannel, total: tramites.length },
    steps,
    transitions,
    journeys: recent.map((t) => {
      const i = info.get(t.id)!;
      return {
        caseId: SWI_PREFIX + t.id,
        paciente: t.patient.nombre,
        estudio: t.study?.nombre ?? null,
        clinica: t.clinic?.nombre ?? null,
        folio: t.folioExterno,
        step: i.step,
        status: i.status,
        channels: i.channels.length ? i.channels : ["WEB"],
        lastChannel: t.canalActual ?? i.channels.at(-1) ?? "WEB",
        updatedAt: updatedAt(t),
      };
    }),
  };
}

/** Un trámite de SWI con su línea de tiempo, en el formato que usa el mapa del recorrido. */
export async function getSwiJourney(id: string) {
  const t = await db.swiTramite.findUnique({ where: { id }, include: { study: true, clinic: true } });
  if (!t) return null;
  // Eventos del trámite + los de la paciente sin trámite (llamadas, mensajes, correos) que ocurrieron mientras este
  // era su trámite más reciente: desde que se creó hasta que creó el siguiente.
  const [all, siblings] = await Promise.all([
    db.event.findMany({ where: { type: SWI_EVENT_TYPE, patientId: t.patientId }, orderBy: [{ createdAt: "asc" }, { seq: "asc" }] }),
    db.swiTramite.findMany({ where: { patientId: t.patientId }, select: { id: true, creadoEnSwi: true } }),
  ]);
  const start = t.creadoEnSwi;
  const next = siblings
    .map((x) => x.creadoEnSwi)
    .filter((d): d is Date => !!d && !!start && d > start)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const timeline = all.filter((e) => {
    const tid = (e.payload as { tramiteId?: string | null }).tramiteId;
    if (tid) return tid === id;
    return !!start && e.createdAt >= start && (!next || e.createdAt < next);
  });
  const step = swiStep(t);
  return {
    patientId: t.patientId,
    detail: {
      case: {
        id: SWI_PREFIX + t.id,
        step,
        data: {
          estudio: t.study?.nombre ?? "",
          clinica: t.clinic?.nombre ?? "",
          horario: t.fechaCita?.toISOString() ?? "",
          folio: t.folioExterno ?? "",
          estadoSwi: t.estado ?? "",
        },
        version: 0,
        lastChannel: t.canalActual ?? "WEB",
        updatedAt: updatedAt(t),
      },
      pending: pendingStep(step),
      timeline: timeline.map(toJson),
      actors: {},
    },
  };
}
