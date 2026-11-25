"use client";

import { useEffect, useRef, useState } from "react";
import { SwiPagos } from "@/app/_components/SwiPagos";
import { TimelineItem, type Ev } from "@/app/_components/Timeline";
import type { AdminStats } from "@/lib/admin-stats";
import { ago, formatTime, money, TZ } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, STEP_LABEL, STEPS, SWI_PREFIX } from "@/lib/labels";
import { CHANNEL_VISUAL } from "./JourneyGraph";
import type { Journey, Overview } from "./types";

/**
 * Dashboard del administrador (diseño OmniTrack 360°) con datos reales de las dos fuentes:
 * trámites propios + trámites de SWI. Lo que el sistema no mide no se muestra.
 */

export const DASH_CHANNELS = ["WHATSAPP", "WEB", "CALL_CENTER", "APP", "CLINICA"] as const;

const KANBAN = [
  { id: "seleccion", title: "1. Estudio y clínica", hint: "Eligiendo qué y dónde", tone: "slate", match: (j: Journey) => j.status === "ACTIVO" && ["INICIADO", "ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA"].includes(j.step) },
  { id: "horario", title: "2. Horario y datos", hint: "A un paso de confirmar", tone: "blue", match: (j: Journey) => j.status === "ACTIVO" && ["HORARIO_ELEGIDO", "DATOS_CONFIRMADOS"].includes(j.step) },
  { id: "pausados", title: "3. Pausados · recuperar", hint: "Más de 10 min sin actividad", tone: "amber", match: (j: Journey) => j.status === "PAUSADO" },
  { id: "confirmados", title: "4. Cita confirmada", hint: "Folio generado", tone: "emerald", match: (j: Journey) => j.status === "CONFIRMADO" },
] as const;

const TONE = {
  slate: { col: "bg-slate-50/70 border-slate-200/60", count: "bg-slate-200/80 text-slate-700", folio: "text-slate-700 bg-slate-100", more: "border-slate-300 hover:border-slate-400 text-slate-500" },
  blue: { col: "bg-blue-50/40 border-blue-100", count: "bg-blue-100 text-blue-700", folio: "text-blue-700 bg-blue-50", more: "border-blue-200 hover:border-blue-300 text-blue-600" },
  amber: { col: "bg-amber-50/50 border-amber-200/70", count: "bg-amber-100 text-amber-800", folio: "text-amber-800 bg-amber-100", more: "border-amber-300 hover:border-amber-400 text-amber-800" },
  emerald: { col: "bg-emerald-50/50 border-emerald-100", count: "bg-emerald-200 text-emerald-800", folio: "text-emerald-800 bg-emerald-100", more: "border-emerald-200 hover:border-emerald-300 text-emerald-700" },
} as const;

const STATUS_SLICES = [
  { id: "CONFIRMADO", label: "Citas confirmadas", color: "#00875A" },
  { id: "ACTIVO", label: "En flujo ahora", color: "#1E60D5" },
  { id: "PAUSADO", label: "Pausados (riesgo de abandono)", color: "#FFAB00" },
  { id: "CANCELADO", label: "Cancelados", color: "#94A3B8" },
] as const;

const fmt = (n: number) => n.toLocaleString("es-MX");
/** Retraso de la animación de entrada (escalonado). */
const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

/** Número que cuenta desde su valor anterior hasta el nuevo (al cargar y con cada dato en vivo). */
function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    const from = last.current;
    const ms = from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
    const start = performance.now();
    let raf = requestAnimationFrame(function step(t) {
      const p = ms ? Math.min(1, (t - start) / ms) : 1;
      last.current = from + (value - from) * (1 - (1 - p) ** 3);
      setShown(last.current);
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tabular-nums">{fmt(Math.round(shown))}{suffix}</span>;
}
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

/** 95 → "1 h 35 min"; 3000 → "2 d 2 h". */
export function duration(min: number | null) {
  if (min === null) return "sin datos";
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
  return `${Math.floor(min / 1440)} d ${Math.round((min % 1440) / 60)} h`;
}

export function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export function Dashboard({ me, data, stats, feed, live, onOpen, onShowPaused }: {
  me: { nombre: string } | null;
  data: Overview;
  stats: AdminStats | null;
  feed: Ev[];
  live: boolean;
  onOpen: (caseId: string) => void;
  onShowPaused: () => void;
}) {
  const k = data.kpis;
  const js = data.journeys;
  const [channel, setChannel] = useState<string>("ALL");
  const [shown, setShown] = useState<Record<string, number>>({});
  const [allClinics, setAllClinics] = useState(false);

  // Distribución: trámites que pasaron por cada canal (uno puede pasar por varios).
  const byChannel = DASH_CHANNELS.map((c) => ({ c, n: js.filter((j) => j.channels.includes(c)).length }));
  const touches = byChannel.reduce((s, x) => s + x.n, 0);
  // Embudo: estado actual de cada trámite.
  const byStatus = STATUS_SLICES.map((s) => ({ ...s, n: js.filter((j) => j.status === s.id).length }));
  let acc = 0;
  const conic = byStatus.map((s) => {
    const from = acc;
    acc += pct(s.n, js.length);
    return `${s.color} ${from}% ${s.id === "CANCELADO" ? 100 : acc}%`;
  }).join(", ");
  const effectiveness = pct(byStatus[0].n, js.length);

  const prev = stats?.confirmedPrev24h ?? null;
  const delta = prev ? Math.round((100 * (k.confirmed24h - prev)) / prev) : null;
  const advisorsActive = stats?.staff.active.filter((s) => s.role === "ASESOR").length ?? 0;
  const recovery = stats?.recovery;
  const clinics = stats?.clinics ?? [];
  const kanbanJourneys = channel === "ALL" ? js : js.filter((j) => j.channels.includes(channel));

  function exportCsv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Paciente", "Estudio", "Clínica", "Folio", "Etapa", "Estado", "Canales", "Último canal", "Actualizado", "Fuente"],
      ...js.map((j) => [j.paciente ?? "Visitante anónimo", j.estudio, j.clinica, j.folio, STEP_LABEL[j.step] ?? j.step, j.status, j.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(" > "), CHANNEL_LABEL[j.lastChannel] ?? j.lastChannel, j.updatedAt, j.caseId.startsWith(SWI_PREFIX) ? "SWI" : "Propio"]),
    ];
    const blob = new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `corte-omnicanal-${new Date().toLocaleDateString("en-CA", { timeZone: TZ })}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Saludo */}
      <section className="dash-rise flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{greeting()}, {me?.nombre.split(" ")[0] ?? "admin"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">El pulso omnicanal de Salud Digna en tiempo real: canales propios y los cinco canales de SWI.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${live ? "bg-emerald-100/70 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
            <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-600 animate-pulse" : "bg-slate-300"}`} aria-hidden />
            {live ? "Centro de mando en vivo" : "Reconectando…"}
          </span>
          <button onClick={exportCsv} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl shadow-sm transition" title="Descarga un CSV con todos los recorridos">
            Exportar corte
          </button>
        </div>
      </section>

      {/* Indicadores */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Indicadores principales">
        <KpiCard delay={60} label="Pacientes en flujo" value={<CountUp value={k.open} />} icon="users" tone="blue"
          foot={<><span className="font-semibold text-slate-700"><CountUp value={k.multichannelPct} suffix="%" /></span> pasaron por 2+ canales</>} />
        <KpiCard delay={130} label="Confirmadas · 24 h" value={<CountUp value={k.confirmed24h} />} icon="check" tone="emerald"
          foot={delta === null ? <>Sin confirmaciones ayer para comparar</> : <Trend up={delta >= 0} text={`${delta >= 0 ? "+" : ""}${delta}%`} sub={`vs ayer (${fmt(prev!)})`} good={delta >= 0} />} />
        <KpiCard delay={200} label="Trámites en riesgo" value={<CountUp value={k.paused} />} icon="clock" tone="amber" onClick={onShowPaused}
          foot={recovery?.abandoned ? <><span className="font-semibold text-emerald-700">{pct(recovery.recovered, recovery.abandoned)}%</span> recuperados tras abandono</> : <>Pausados más de 10 min · ver lista →</>} />
        <KpiCard delay={270} label="Capacidad de atención" value={<CountUp value={advisorsActive} />} icon="team" tone="violet"
          foot={<><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" aria-hidden /> asesores activos hoy <span className="text-slate-400">/ {stats?.staff.asesores ?? "…"} · 1 bot de WhatsApp</span></>} />
      </section>

      {/* Canales · embudo · clínicas */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Panel delay={340} id="canales" className="lg:col-span-4" title="Distribución por canales" aside={<span className="text-[11px] text-slate-400">{fmt(js.length)} trámites</span>}
          footer={<><span>Tiempo medio para confirmar:</span><span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">{duration(stats?.conversionMedianMin ?? null)}</span></>}>
          <ul className="space-y-4">
            {byChannel.map(({ c, n }, i) => (
              <li key={c} className="group">
                <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                  <span className="font-bold text-slate-800 flex items-center gap-2 min-w-0">
                    <span className="dash-icon w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] text-white shrink-0" style={{ background: CHANNEL_VISUAL[c].hex }} aria-hidden>{CHANNEL_LABEL[c].slice(0, 2).toUpperCase()}</span>
                    <span className="truncate">{CHANNEL_LABEL[c]}</span>
                  </span>
                  <span className="whitespace-nowrap"><span className="font-bold text-slate-900"><CountUp value={pct(n, touches)} suffix="%" /></span><span className="text-slate-400 text-[11px] ml-1">(<CountUp value={n} />)</span></span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className="dash-bar h-2 rounded-full group-hover:brightness-110" style={{ width: `${pct(n, touches)}%`, background: CHANNEL_VISUAL[c].hex, ...d(500 + i * 90) }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel delay={410} className="lg:col-span-4" title="Embudo de conversión" aside={<span className="text-[11px] text-slate-400">Total: {fmt(js.length)}</span>}
          footer={<><span>Recuperados tras abandono (SWI):</span><span className="font-bold text-slate-800">{recovery?.abandoned ? `${pct(recovery.recovered, recovery.abandoned)}% · ${recovery.recovered} de ${recovery.abandoned}` : "sin abandonos"}</span></>}>
          <div className="flex items-center justify-center my-2">
            <div className="relative w-36 h-36 rounded-full flex items-center justify-center transition-transform duration-500 hover:scale-105" style={{ background: "#e2e8f0" }}
              role="img" aria-label={`${effectiveness}% de los trámites terminaron en cita confirmada`}>
              {/* La dona se dibuja en barrido sobre un aro gris */}
              <div className="dash-donut absolute inset-0 rounded-full" style={{ background: js.length ? `conic-gradient(${conic})` : "#e2e8f0" }} aria-hidden />
              <div className="relative w-24 h-24 bg-white rounded-full flex flex-col items-center justify-center shadow-inner">
                <span className="text-2xl font-extrabold text-slate-900"><CountUp value={effectiveness} suffix="%" /></span>
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Efectividad</span>
              </div>
            </div>
          </div>
          <ul className="space-y-2 mt-3">
            {byStatus.map((s, i) => (
              <li key={s.id} className="dash-rise flex items-center justify-between text-xs gap-2" style={d(700 + i * 80)}>
                <span className="flex items-center gap-2 min-w-0"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} aria-hidden /><span className="font-medium text-slate-600 truncate">{s.label}</span></span>
                <span className="font-bold text-slate-800 whitespace-nowrap tabular-nums"><CountUp value={s.n} /> ({pct(s.n, js.length)}%)</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel delay={480} id="clinicas" className="lg:col-span-4" title="Clínicas de mayor tráfico"
          aside={clinics.length > 4 ? <button onClick={() => setAllClinics(!allClinics)} className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">{allClinics ? "Ver menos" : "Todas"} ›</button> : null}>
          {clinics.length === 0 ? <p className="text-sm text-slate-400">{stats ? "Todavía no hay trámites con clínica." : "Cargando…"}</p> : (
            <ol className={`space-y-3.5 ${allClinics ? "max-h-[300px] overflow-y-auto pr-1" : ""}`}>
              {(allClinics ? clinics : clinics.slice(0, 4)).map((c, i) => {
                const p = pct(c.confirmed, c.total);
                return (
                  <li key={c.id} className="dash-rise group relative flex items-center justify-between gap-2 pb-1.5" style={d(560 + i * 70)}>
                    {/* barra fina: % de trámites confirmados */}
                    <span className="absolute left-[42px] right-0 bottom-0 h-1 rounded-full bg-slate-100" aria-hidden>
                      <span className="dash-bar block h-1 rounded-full bg-sd-green" style={{ width: `${p}%`, ...d(700 + i * 70) }} />
                    </span>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="dash-icon w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 group-hover:bg-emerald-50 group-hover:text-emerald-700 transition-colors">{String(i + 1).padStart(2, "0")}</span>
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-800 leading-snug truncate">{c.nombre}</h4>
                        <p className="text-[11px] text-slate-400 truncate">{c.ciudad ? `${c.ciudad} · ` : ""}{fmt(c.total)} trámite{c.total === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-slate-800 block"><CountUp value={p} suffix="%" /></span>
                      <span className={`text-[10px] font-semibold ${p >= 75 ? "text-emerald-600" : p >= 40 ? "text-slate-500" : "text-amber-600"}`}>confirmadas</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {clinics.length > 4 && !allClinics && (
            <button onClick={() => setAllClinics(true)} className="w-full mt-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold border border-slate-200/70 transition">
              Ver las {clinics.length} clínicas con trámites
            </button>
          )}
        </Panel>
      </section>

      {/* Monitoreo en vivo (kanban por etapa) */}
      <section id="tramites" style={d(560)} className="dash-rise scroll-mt-20 bg-white rounded-2xl p-4 md:p-6 border border-slate-200/80 shadow-card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-100/70 text-emerald-700 flex items-center justify-center" aria-hidden>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" strokeLinecap="round" /></svg>
            </span>
            <div>
              <h2 className="font-extrabold text-base text-slate-900">Monitoreo de trámites omnicanal en vivo</h2>
              <p className="text-xs text-slate-400">De la cotización a la cita confirmada. Clic en una tarjeta para ver su recorrido.</p>
            </div>
          </div>
          <nav className="flex items-center gap-1.5 overflow-x-auto" aria-label="Filtrar el monitoreo por canal">
            {["ALL", ...DASH_CHANNELS].map((c) => (
              <button key={c} onClick={() => setChannel(c)} aria-pressed={channel === c}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap transition ${channel === c ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-transparent"}`}>
                {c === "ALL" ? "Todos los canales" : CHANNEL_LABEL[c]}
              </button>
            ))}
          </nav>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {KANBAN.map((col) => {
            const t = TONE[col.tone];
            const items = kanbanJourneys.filter(col.match);
            const limit = shown[col.id] ?? 3;
            return (
              <div key={col.id} className={`rounded-2xl p-3.5 border flex flex-col ${t.col}`}>
                <div className="flex items-center justify-between mb-3 px-1 gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-xs text-slate-800">{col.title}</span>
                    <p className="text-[10px] text-slate-500">{col.hint}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${t.count}`}><CountUp value={items.length} /></span>
                </div>
                <div className="space-y-2.5 flex-1">
                  {items.length === 0 && <p className="text-[11px] text-slate-400 px-1 py-4 text-center">Nadie en este paso ahora.</p>}
                  {items.slice(0, limit).map((j, i) => <KanbanCard key={j.caseId} j={j} delay={700 + Math.min(i, 6) * 70} folioCls={t.folio} paused={col.id === "pausados"} onOpen={() => onOpen(j.caseId)} />)}
                </div>
                {items.length > limit && (
                  <button onClick={() => setShown({ ...shown, [col.id]: limit + 6 })} className={`w-full mt-3 py-1.5 border border-dashed rounded-xl text-xs font-semibold transition ${t.more}`}>
                    + Ver {Math.min(6, items.length - limit)} más (quedan {fmt(items.length - limit)})
                  </button>
                )}
                {col.id === "pausados" && items.length > 0 && (
                  <button onClick={onShowPaused} className="w-full mt-2 py-1.5 bg-amber-100/70 hover:bg-amber-200/70 text-amber-900 rounded-xl text-xs font-bold transition">
                    Recuperar en Pacientes Omnicanal
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Etapas · cambios de canal · actividad */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_400px]">
        <Card delay={640} title="Trámites por etapa actual"><StepBars steps={data.steps} /></Card>
        <Card delay={700} title="Cambios de canal" subtitle="De dónde a dónde continúan los pacientes"><TransitionMatrix channels={data.channels} t={data.transitions} /></Card>
        <Card delay={760} title="Actividad en vivo" className="xl:row-span-2">
          <ol className="space-y-3 max-h-[620px] overflow-y-auto pr-1">{feed.map((e, i) => <TimelineItem key={e.seq} e={e} className="dash-rise" style={d(i < 10 ? 800 + i * 40 : 0)} />)}</ol>
        </Card>
        {/* Agentes y bots */}
        <div id="agentes" className="scroll-mt-20 xl:col-span-2 grid gap-5 md:grid-cols-2">
          <Card delay={820} title="Personal activo · 24 h" subtitle="Acciones registradas en la bitácora">
            {!stats ? <p className="text-sm text-slate-400">Cargando…</p> : stats.staff.active.length === 0 ? <p className="text-sm text-slate-400">Nadie del personal ha actuado en las últimas 24 h.</p> : (
              <ul className="space-y-2.5">
                {stats.staff.active.slice(0, 6).map((s, i) => (
                  <li key={s.nombre} className="dash-rise group flex items-center justify-between gap-2 text-sm" style={d(900 + i * 70)}>
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="dash-icon w-8 h-8 rounded-full bg-gradient-to-tr from-sd-green-dark to-sd-green text-white flex items-center justify-center text-[11px] font-bold shrink-0" aria-hidden>{s.nombre.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                      <span className="min-w-0"><span className="font-semibold text-slate-800 block truncate">{s.nombre}</span><span className="text-[11px] text-slate-400">{s.role === "ADMIN" ? "Administración" : "Asesor · Call Center"}</span></span>
                    </span>
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums"><CountUp value={s.acciones} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card delay={880} title="Bot de WhatsApp e IA · 24 h" subtitle="Atención automática de los canales propios">
            <dl className="grid grid-cols-2 gap-3">
              <Stat delay={950} label="Mensajes enviados por el bot" value={stats ? <CountUp value={stats.bot.messagesOut24h} /> : "…"} />
              <Stat delay={1010} label="Mensajes entendidos con IA" value={stats ? <CountUp value={stats.bot.aiIntents24h} /> : "…"} />
              <Stat delay={1070} label="Conflictos bloqueados" value={<CountUp value={k.conflicts24h} />} />
              <Stat delay={1130} label="Cambios de canal" value={<CountUp value={k.switches24h} />} />
            </dl>
          </Card>
        </div>
        <Card delay={920} title="Pagos de SWI" subtitle="Solo «Pagado» cuenta como cobrado; «Pagará en clínica» se cobra al llegar" className="xl:col-span-3">
          {!stats ? <p className="text-sm text-slate-400">Cargando…</p> : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <dl className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                <Stat delay={960} label={`Cobrado · ${fmt(stats.payments.approved.count)} pagos aprobados`} value={money(Math.round(stats.payments.approved.total * 100))} />
                <Stat delay={1020} label={`Pagará en clínica · ${fmt(stats.payments.pending.count)} citas`} value={money(Math.round(stats.payments.pending.total * 100))} />
                <Stat delay={1080} label="Intentos rechazados" value={<CountUp value={stats.payments.rejected.count} />} />
              </dl>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 mb-1">Últimos pagos</p>
                {stats.payments.recent.length ? <SwiPagos pagos={stats.payments.recent.map((p) => ({ ...p, fecha: String(p.fecha) }))} /> : <p className="text-sm text-slate-400">Todavía no llegan pagos de SWI.</p>}
              </div>
            </div>
          )}
        </Card>
        <Card delay={940} title="Auditoría de accesos del personal" className="xl:col-span-3"><AuditTable rows={data.audit} /></Card>
      </section>
    </div>
  );
}

function KanbanCard({ j, folioCls, paused, delay, onOpen }: { j: Journey; folioCls: string; paused: boolean; delay: number; onOpen: () => void }) {
  return (
    <button onClick={onOpen} style={d(delay)} className={`dash-rise w-full text-left bg-white p-3 rounded-xl shadow-sm hover:shadow-card-hover hover:-translate-y-0.5 transition-[box-shadow,translate] ${paused ? "border-2 border-amber-300/80" : "border border-slate-200"}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${folioCls}`}>{j.folio ?? `…${j.caseId.slice(-6)}`}</span>
          <h4 className="text-xs font-bold text-slate-900 mt-1 truncate">{j.estudio ?? "Estudio por elegir"}</h4>
          <p className="text-[11px] text-slate-500 truncate">{j.paciente ?? "Visitante anónimo"}</p>
        </div>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: CHANNEL_VISUAL[j.lastChannel]?.hex ?? "#64748b" }}>{CHANNEL_LABEL[j.lastChannel] ?? j.lastChannel}</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 gap-2">
        <span className="flex items-center gap-1 min-w-0 truncate">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${paused ? "bg-amber-500 animate-pulse" : j.status === "CONFIRMADO" ? "bg-emerald-500" : "bg-blue-500 animate-pulse"}`} aria-hidden />
          {paused ? `Sin actividad ${ago(j.updatedAt)}` : ago(j.updatedAt)}
        </span>
        <span className="text-slate-700 font-medium shrink-0">{j.caseId.startsWith(SWI_PREFIX) ? "SWI" : j.channels.length > 1 ? `${j.channels.length} canales` : "1 canal"}</span>
      </div>
    </button>
  );
}

const ICONS = {
  users: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  check: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  team: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
};
const ICON_TONE = { blue: "bg-blue-50 text-blue-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", violet: "bg-purple-50 text-purple-600" };

function KpiCard({ label, value, foot, icon, tone, delay, onClick }: { label: string; value: React.ReactNode; foot: React.ReactNode; icon: keyof typeof ICONS; tone: keyof typeof ICON_TONE; delay: number; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} style={d(delay)} className="dash-rise group text-left bg-white rounded-2xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between gap-3 hover:shadow-card-hover hover:-translate-y-0.5 transition-[box-shadow,translate] duration-300">
      <div className="space-y-1 min-w-0">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-extrabold text-slate-900 tracking-tight tabular-nums">{value}</p>
        <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">{foot}</p>
      </div>
      <span className={`dash-icon w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${ICON_TONE[tone]}`} aria-hidden>
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={ICONS[icon]} strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </Tag>
  );
}

function Trend({ up, text, sub, good }: { up: boolean; text: string; sub: string; good: boolean }) {
  return (
    <span className={`flex items-center gap-1 font-medium ${good ? "text-emerald-600" : "text-rose-600"}`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden><path d={up ? "M5 10l7-7m0 0l7 7m-7-7v18" : "M19 14l-7 7m0 0l-7-7m7 7V3"} strokeLinecap="round" strokeLinejoin="round" /></svg>
      {text}<span className="text-slate-400 font-normal ml-0.5">{sub}</span>
    </span>
  );
}

function Panel({ id, title, aside, footer, delay, className = "", children }: { id?: string; title: string; aside?: React.ReactNode; footer?: React.ReactNode; delay: number; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={d(delay)} className={`dash-rise hover:shadow-card-hover transition-shadow duration-300 scroll-mt-20 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-card flex flex-col justify-between min-w-0 ${className}`}>
      <div>
        <div className="flex items-center justify-between mb-4 gap-2">
          <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
          {aside}
        </div>
        {children}
      </div>
      {footer && <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">{footer}</div>}
    </section>
  );
}

function Stat({ label, value, delay }: { label: string; value: React.ReactNode; delay: number }) {
  return (
    <div style={d(delay)} className="dash-pop rounded-xl bg-slate-50 border border-slate-100 p-3 hover:bg-white hover:shadow-card-hover transition">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-xl font-extrabold text-slate-900 tabular-nums">{value}</dd>
    </div>
  );
}

function Card({ title, subtitle, delay, className = "", children }: { title: string; subtitle?: string; delay: number; className?: string; children: React.ReactNode }) {
  return (
    <section style={d(delay)} className={`dash-rise bg-white rounded-[28px] border border-white/80 shadow-soft-card p-5 min-w-0 ${className}`}>
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Barras horizontales de una sola serie: magnitud por etapa (un solo tono; cancelado en gris neutro). */
function StepBars({ steps }: { steps: Record<string, number> }) {
  const rows = [...STEPS, "CANCELADO"].map((s) => ({ step: s, n: steps[s] ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.step} className="grid grid-cols-[120px_1fr_40px] items-center gap-2 text-sm" title={`${STEP_LABEL[r.step]}: ${r.n} trámite(s)`}>
          <span className="text-slate-600 truncate">{STEP_LABEL[r.step]}</span>
          <span className="h-5 bg-slate-100 rounded-r-full">
            {r.n > 0 && <span className={`dash-bar block h-full rounded-r-full ${r.step === "CANCELADO" ? "bg-slate-400" : "bg-sd-blue"}`} style={{ width: `${(100 * r.n) / max}%`, ...d(800 + i * 80) }} />}
          </span>
          <span className="text-right tabular-nums font-semibold text-slate-700"><CountUp value={r.n} /></span>
        </li>
      ))}
    </ul>
  );
}

/** Matriz origen → destino; intensidad secuencial de un solo tono, con el número siempre visible. */
function TransitionMatrix({ channels, t }: { channels: string[]; t: Record<string, Record<string, number>> }) {
  const max = Math.max(1, ...channels.flatMap((a) => channels.map((b) => t[a]?.[b] ?? 0)));
  const shade = (n: number) => {
    if (n === 0) return "bg-slate-50 text-slate-300";
    const r = n / max;
    return r > 0.75 ? "bg-blue-700 text-white" : r > 0.5 ? "bg-blue-500 text-white" : r > 0.25 ? "bg-blue-300 text-slate-900" : "bg-blue-100 text-slate-900";
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left text-[11px] font-normal text-slate-400 p-1">De ↓ · A →</th>
            {channels.map((c) => <th key={c} className="text-[11px] font-semibold text-slate-600 p-1">{CHANNEL_LABEL[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {channels.map((from, r) => (
            <tr key={from}>
              <th className="text-left text-[11px] font-semibold text-slate-600 p-1 whitespace-nowrap">{CHANNEL_LABEL[from]}</th>
              {channels.map((to, c) => {
                const n = t[from]?.[to] ?? 0;
                return from === to ? (
                  <td key={to} className="text-center text-slate-300 rounded-xl">·</td>
                ) : (
                  <td key={to} style={d(850 + (r * channels.length + c) * 25)} className={`dash-pop text-center tabular-nums font-semibold rounded-xl py-2.5 transition-transform hover:scale-110 ${shade(n)}`} title={`${CHANNEL_LABEL[from]} → ${CHANNEL_LABEL[to]}: ${n}`}><CountUp value={n} /></td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ rows }: { rows: Overview["audit"] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">Sin accesos del personal todavía.</p>;
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
            <th className="py-2 font-semibold">Hora</th>
            <th className="py-2 font-semibold">Personal</th>
            <th className="py-2 font-semibold">Acción</th>
            <th className="py-2 font-semibold">Paciente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq} className="border-b border-slate-50">
              <td className="py-2 pr-3 tabular-nums text-slate-400 font-mono text-xs whitespace-nowrap">{formatTime(r.createdAt)}</td>
              <td className="py-2 pr-3 font-semibold">{r.staff ? `${r.staff.nombre} (${r.staff.role === "ADMIN" ? "admin" : "asesor"})` : "—"}</td>
              <td className="py-2 pr-3 text-slate-600">{EVENT_LABEL[r.type] ?? r.type}</td>
              <td className="py-2">{r.paciente ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
