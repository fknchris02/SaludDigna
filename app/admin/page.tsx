"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChannelChip, TimelineItem, type Ev } from "@/app/_components/Timeline";
import { api, ApiError } from "@/lib/client/api";
import { ago, formatTime } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, STEP_LABEL, STEPS } from "@/lib/labels";
import { CHANNEL_VISUAL, JourneyGraph, type CaseDetail, type JourneyStatus } from "./JourneyGraph";

type Journey = {
  caseId: string;
  paciente: string | null;
  estudio: string | null;
  clinica: string | null;
  folio: string | null;
  step: string;
  status: JourneyStatus;
  channels: string[];
  lastChannel: string;
  updatedAt: string;
};
type Overview = {
  kpis: { open: number; paused: number; confirmed24h: number; switches24h: number; conflicts24h: number; multichannelPct: number };
  steps: Record<string, number>;
  transitions: Record<string, Record<string, number>>;
  channels: string[];
  journeys: Journey[];
  audit: { seq: string; type: string; createdAt: string; staff: { nombre: string; role: string } | null; paciente: string | null; payload: Record<string, unknown> }[];
  recent: Ev[];
};
type Filter = "ALL" | "WHATSAPP" | "WEB" | "CALL_CENTER" | "APP" | "PAUSADO";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "ALL", label: "Todos" },
  { id: "WHATSAPP", label: "WhatsApp" },
  { id: "WEB", label: "Página Web" },
  { id: "CALL_CENTER", label: "Call Center" },
  { id: "APP", label: "App Salud Digna" },
];

const STATUS = {
  ACTIVO: { icon: "●", label: "Activo", cls: "text-emerald-700", badge: "Activo" },
  PAUSADO: { icon: "⏸", label: "Pausado", cls: "text-amber-700", badge: "Pausado · recuperar" },
  CONFIRMADO: { icon: "✓", label: "Cita confirmada", cls: "text-teal-700", badge: "Cita confirmada" },
  CANCELADO: { icon: "✕", label: "Cancelado", cls: "text-slate-500", badge: "Cancelado" },
} as const;

export default function AdminDashboard() {
  const router = useRouter();
  const [me, setMe] = useState<{ nombre: string; role: string } | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<Ev[]>([]);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [, setTick] = useState(0);
  const sinceRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    let d: Overview;
    try {
      d = await api<Overview>("/api/admin/overview", { as: "CALL_CENTER" });
    } catch (err) {
      // Sesión vencida o personal recreado (p. ej. tras `db:seed`): volver a iniciar sesión en lugar de romper la pantalla.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) router.replace("/asesor/login");
      else console.warn("No se pudo actualizar el tablero:", err);
      return;
    }
    if (sinceRef.current === null) {
      sinceRef.current = d.recent.at(-1)?.seq ?? "0";
      setFeed([...d.recent].reverse());
    }
    setData(d);
    // Por defecto (o si el seleccionado ya no existe, p. ej. tras `db:seed`), el recorrido más reciente de un paciente identificado.
    const fallback = d.journeys.find((j) => j.paciente)?.caseId ?? d.journeys[0]?.caseId ?? null;
    setSelectedId((cur) => (cur && d.journeys.some((j) => j.caseId === cur) ? cur : fallback));
  }, [router]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<CaseDetail>(`/api/cases/${id}`, { as: "CALL_CENTER" });
      if (selectedRef.current === id) setDetail(d);
    } catch (err) {
      // Trámite borrado (404) o sesión vencida (401/403): load() elige otro recorrido o manda a iniciar sesión.
      if (err instanceof ApiError && [401, 403, 404].includes(err.status)) load();
      else console.warn("No se pudo cargar el recorrido:", err);
    }
  }, [load]);

  useEffect(() => {
    api<{ staff: { nombre: string; role: string } }>("/api/auth/me", { as: "CALL_CENTER" })
      .then((r) => {
        setMe(r.staff);
        if (r.staff.role === "ADMIN") load();
      })
      .catch(() => router.replace("/asesor/login"));
  }, [router, load]);

  useEffect(() => {
    selectedRef.current = selectedId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cargar el recorrido al cambiar la selección
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Tiempo real: cada evento entra al feed, recalcula el tablero y, si es del recorrido abierto, redibuja el mapa.
  const ready = data !== null;
  useEffect(() => {
    if (!ready) return;
    const es = new EventSource(`/api/events?as=STAFF&since=${sinceRef.current}`);
    const onEvent = (msg: MessageEvent) => {
      const ev: Ev & { caseId?: string | null } = JSON.parse(msg.data);
      setFeed((f) => (f.some((x) => x.seq === ev.seq) ? f : [ev, ...f].slice(0, 60)));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        load();
        if (selectedRef.current && ev.caseId === selectedRef.current) loadDetail(selectedRef.current);
      }, 400);
    };
    for (const t of Object.keys(EVENT_LABEL)) es.addEventListener(t, onEvent);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const tick = setInterval(() => setTick((n) => n + 1), 30_000); // refresca los "hace X min"
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, [ready, load, loadDetail]);

  const journeys = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.journeys ?? []).filter((j) => {
      if (filter === "PAUSADO" ? j.status !== "PAUSADO" : filter !== "ALL" && !j.channels.includes(filter)) return false;
      return !term || [j.paciente, j.estudio, j.folio, j.clinica].some((x) => x?.toLowerCase().includes(term));
    });
  }, [data, filter, q]);

  async function logout() {
    await api("/api/auth/logout", { body: { scope: "STAFF" } });
    router.replace("/asesor/login");
  }

  if (me && me.role !== "ADMIN") {
    return (
      <main className="min-h-screen grid place-items-center text-sm text-slate-600 p-4 text-center">
        <p>Este tablero es solo para administradores. <Link href="/asesor" className="text-teal-700 underline">Ir a la consola del asesor</Link></p>
      </main>
    );
  }
  if (!data) return <main className="min-h-screen grid place-items-center text-slate-500 bg-sd-bg">Cargando…</main>;
  const k = data.kpis;
  const selected = data.journeys.find((j) => j.caseId === selectedId) ?? null;
  const showMap = selected && detail?.case.id === selected.caseId;

  return (
    <div className="min-h-screen bg-sd-bg text-slate-800 p-3 md:p-6 lg:p-8">
      <main className="w-full max-w-[1720px] mx-auto bg-white/70 backdrop-blur-xl rounded-[32px] md:rounded-[40px] border border-white/80 shadow-[0_30px_90px_-20px_rgba(20,45,95,0.08)] overflow-hidden">
        {/* Encabezado: marca, búsqueda, filtros por canal y estado en vivo */}
        <header className="px-5 md:px-8 py-5 flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-slate-100/60">
          <div className="flex items-center gap-2">
            <span className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">Salud Digna<span className="text-sd-blue">.</span></span>
            <span className="text-[11px] font-bold tracking-wider uppercase bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full border border-blue-200/50">Omnitrack 360°</span>
          </div>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Buscar paciente, folio o estudio</span>
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
              <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente, folio o estudio…"
              className="w-full pl-10 pr-4 py-2 bg-slate-100/70 rounded-full text-xs font-semibold text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-sd-blue focus:bg-white transition-all shadow-inner" />
          </label>
          <nav className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full" aria-label="Filtrar recorridos por canal">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
                className={`px-4 py-2 rounded-full text-xs whitespace-nowrap transition-all ${filter === f.id ? "font-bold bg-sd-dark text-white shadow-sm" : "font-medium text-slate-500 hover:text-slate-900"}`}>
                {f.label}
              </button>
            ))}
            <button onClick={() => setFilter(filter === "PAUSADO" ? "ALL" : "PAUSADO")} aria-pressed={filter === "PAUSADO"}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap border flex items-center gap-1.5 transition-colors ${filter === "PAUSADO" ? "bg-amber-500 text-white border-amber-500" : "text-amber-700 bg-amber-50 border-amber-200/50 hover:bg-amber-100"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${filter === "PAUSADO" ? "bg-white" : "bg-amber-500 animate-pulse"}`} aria-hidden />
              Pausados ({k.paused})
            </button>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className={`inline-flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-full border whitespace-nowrap ${live ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" : "bg-slate-100 text-slate-400 border-slate-200"}`}>
              <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} aria-hidden />
              {live ? "En vivo" : "Reconectando…"}
            </span>
            <div className="text-right hidden xl:block">
              <p className="font-bold text-slate-800">{me?.nombre}</p>
              <Link href="/asesor" className="text-[11px] text-sd-blue hover:underline">Consola de asesor</Link>
            </div>
            <button onClick={logout} className="rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-white">Salir</button>
          </div>
        </header>

        {/* Indicadores */}
        <section className="px-5 md:px-8 py-4 grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 border-b border-slate-100/60" aria-label="Indicadores">
          <Kpi label="Trámites abiertos" value={k.open} />
          <Kpi label="Pausados (+10 min)" value={k.paused} hint="Candidatos a recuperar" tone="warning" />
          <Kpi label="Citas confirmadas · 24 h" value={k.confirmed24h} />
          <Kpi label="Cambios de canal · 24 h" value={k.switches24h} />
          <Kpi label="Recorridos multicanal" value={`${k.multichannelPct}%`} hint="Pasaron por 2+ canales" />
          <Kpi label="Conflictos detectados · 24 h" value={k.conflicts24h} hint="Ediciones simultáneas bloqueadas" />
        </section>

        {/* Área de trabajo: expediente del recorrido + mapa */}
        <div className="flex flex-col lg:flex-row">
          <aside className="lg:w-[320px] p-5 md:p-6 flex flex-col gap-5 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-100" aria-label="Recorrido seleccionado">
            {showMap ? <JourneySidebar j={selected} d={detail} /> : <p className="text-sm text-slate-400">{selected ? "Cargando recorrido…" : "Selecciona un recorrido abajo."}</p>}
          </aside>
          <section className="flex-1 min-w-0 h-[640px] relative" aria-label="Mapa del recorrido">
            {showMap ? <JourneyGraph detail={detail} status={selected.status} /> : <div className="h-full grid place-items-center text-sm text-slate-400">Sin recorrido seleccionado.</div>}
          </section>
        </div>

        {/* Lista de recorridos (filtrable) */}
        <section className="px-5 md:px-8 py-6 border-t border-slate-100/60">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-sm font-bold text-slate-800">Recorridos de pacientes</h2>
            <span className="text-xs text-slate-400">{journeys.length} de {data.journeys.length} · clic para ver su mapa</span>
          </div>
          {journeys.length === 0 ? (
            <p className="text-sm text-slate-400">Ningún recorrido coincide con el filtro.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {journeys.map((j) => (
                <li key={j.caseId}>
                  <JourneyCard j={j} active={j.caseId === selectedId} onOpen={() => { setSelectedId(j.caseId); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Operación: etapas, cambios de canal, actividad en vivo y auditoría */}
      <div className="max-w-[1720px] mx-auto mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_420px]">
        <Card title="Trámites por etapa actual"><StepBars steps={data.steps} /></Card>
        <Card title="Cambios de canal" subtitle="De dónde a dónde continúan los pacientes"><TransitionMatrix channels={data.channels} t={data.transitions} /></Card>
        <Card title="Actividad en vivo" className="xl:row-span-2">
          <ol className="space-y-3 max-h-[620px] overflow-y-auto pr-1">{feed.map((e) => <TimelineItem key={e.seq} e={e} />)}</ol>
        </Card>
        <Card title="Auditoría de accesos del personal" className="xl:col-span-2"><AuditTable rows={data.audit} /></Card>
      </div>
    </div>
  );
}

function JourneySidebar({ j, d }: { j: Journey; d: CaseDetail }) {
  const st = STATUS[j.status];
  const switches = d.timeline.filter((e) => e.type === "CASE_RESUMED").length;
  // Quién intervino: personal por nombre; autoservicio por canal.
  const people = new Map<string, { label: string; sub: string; initials: string; channel: string; n: number }>();
  for (const e of d.timeline) {
    if (e.type === "ADVISOR_OPENED_CASE" && e.payload.role === "ADMIN") continue; // monitoreo, no atención
    const staff = e.actorId ? d.actors[e.actorId] : null;
    const key = staff ? `staff:${e.actorId}` : `ch:${e.channel}`;
    const row =
      people.get(key) ??
      (staff
        ? { label: staff.nombre, sub: staff.role === "ADMIN" ? "Administración" : "Asesor · Call Center", initials: staff.nombre.split(" ").map((w) => w[0]).join("").slice(0, 2), channel: "CALL_CENTER", n: 0 }
        : {
            label: e.channel === "WHATSAPP" ? "Asistente de WhatsApp" : e.channel === "CALL_CENTER" ? "Call Center" : `${CHANNEL_LABEL[e.channel]} (autoservicio)`,
            sub: e.channel === "WHATSAPP" ? "Bot de citas" : e.channel === "CALL_CENTER" ? "Asesor no registrado" : "El paciente por su cuenta",
            initials: e.channel === "WHATSAPP" ? "WA" : CHANNEL_LABEL[e.channel].slice(0, 2).toUpperCase(),
            channel: e.channel,
            n: 0,
          });
    row.n++;
    people.set(key, row);
  }

  return (
    <>
      <div className="bg-sd-dark text-white p-6 rounded-[28px] shadow-dark-panel">
        <span className="inline-block text-[11px] font-semibold text-slate-300 bg-white/10 px-3 py-1 rounded-full uppercase tracking-wider">{st.badge}</span>
        <h2 className="text-2xl font-bold leading-tight tracking-tight mt-4">{j.paciente ?? "Visitante anónimo"}</h2>
        <p className="text-xs text-slate-400 mt-1">
          {j.folio ? <>Folio <span className="font-mono text-blue-400 font-semibold">#{j.folio}</span></> : <>Trámite <span className="font-mono text-blue-400">…{j.caseId.slice(-6)}</span></>}
          {" · "}
          {ago(j.updatedAt)}
        </p>
        <div className="border-t border-white/10 pt-3 mt-4 flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-400">Estudio:</span>
          <span className="font-semibold text-emerald-400 flex items-center gap-1.5 min-w-0">
            {j.status === "ACTIVO" && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" aria-hidden />}
            <span className="truncate">{j.estudio ?? "Por elegir"}</span>
          </span>
        </div>
        {j.clinica && <p className="text-[11px] text-slate-400 mt-1 text-right truncate">{j.clinica}</p>}
      </div>

      <div className="bg-sd-blue text-white p-5 rounded-[26px] shadow-lg">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center" aria-hidden>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-100">Bitácora del trámite</span>
        </div>
        <div className="flex items-center gap-1.5 my-3" aria-hidden>
          {j.channels.map((c, i) => (
            <span key={i} className={`rounded-full border-2 border-white ${i === j.channels.length - 1 ? "w-3.5 h-3.5" : "w-2.5 h-2.5"}`} style={{ background: CHANNEL_VISUAL[c]?.hex }} />
          ))}
        </div>
        <h3 className="text-base font-bold leading-tight">{j.channels.map((c) => CHANNEL_LABEL[c]).join(" → ")}</h3>
        <p className="text-xs text-blue-100">
          {d.timeline.length} eventos registrados · {switches} cambio{switches === 1 ? "" : "s"} de canal
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quién intervino</p>
        {[...people.values()].map((p) => (
          <div key={p.label} className="flex items-center justify-between p-2.5 rounded-2xl bg-white border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shrink-0" style={{ background: CHANNEL_VISUAL[p.channel]?.hex }} aria-hidden>{p.initials}</span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">{p.label}</p>
                <p className="text-[10px] text-slate-400 truncate">{p.sub}</p>
              </div>
            </div>
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full" title="Eventos">{p.n}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function JourneyCard({ j, active, onOpen }: { j: Journey; active: boolean; onOpen: () => void }) {
  const st = STATUS[j.status];
  return (
    <button onClick={onOpen} aria-current={active ? "true" : undefined}
      className={`w-full text-left rounded-2xl p-4 bg-white border transition-all hover:-translate-y-0.5 hover:shadow-soft-card ${active ? "border-sd-blue ring-2 ring-sd-blue/20" : "border-slate-100 shadow-sm"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-900 truncate">{j.paciente ?? <span className="italic text-slate-400 font-medium">Visitante anónimo</span>}</span>
        <span className={`text-[11px] font-semibold whitespace-nowrap ${st.cls}`}><span aria-hidden>{st.icon}</span> {st.label}</span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5 truncate">{j.estudio ?? "Estudio por elegir"}</p>
      <div className="mt-3"><StepDots step={j.step} /></div>
      <div className="mt-3 flex items-center gap-1 flex-wrap">
        {j.channels.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300" aria-hidden>→</span>}
            <ChannelChip channel={c} />
          </span>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">{ago(j.updatedAt)}</span>
      </div>
    </button>
  );
}

function Card({ title, subtitle, className = "", children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`bg-white rounded-[28px] border border-white/80 shadow-soft-card p-5 min-w-0 ${className}`}>
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "warning" }) {
  return (
    <div className={`rounded-2xl px-4 py-3 border ${tone === "warning" && Number(value) > 0 ? "bg-amber-50/70 border-amber-200/60" : "bg-white border-slate-100 shadow-sm"}`}>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums text-slate-900 mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Barras horizontales de una sola serie: magnitud por etapa (un solo tono; cancelado en gris neutro). */
function StepBars({ steps }: { steps: Record<string, number> }) {
  const rows = [...STEPS, "CANCELADO"].map((s) => ({ step: s, n: steps[s] ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.step} className="grid grid-cols-[120px_1fr_32px] items-center gap-2 text-sm" title={`${STEP_LABEL[r.step]}: ${r.n} trámite(s)`}>
          <span className="text-slate-600 truncate">{STEP_LABEL[r.step]}</span>
          <span className="h-5 bg-slate-100 rounded-r-full">
            {r.n > 0 && <span className={`block h-full rounded-r-full ${r.step === "CANCELADO" ? "bg-slate-400" : "bg-sd-blue"}`} style={{ width: `${(100 * r.n) / max}%` }} />}
          </span>
          <span className="text-right tabular-nums font-semibold text-slate-700">{r.n}</span>
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
          {channels.map((from) => (
            <tr key={from}>
              <th className="text-left text-[11px] font-semibold text-slate-600 p-1 whitespace-nowrap">{CHANNEL_LABEL[from]}</th>
              {channels.map((to) => {
                const n = t[from]?.[to] ?? 0;
                return from === to ? (
                  <td key={to} className="text-center text-slate-300 rounded-xl">·</td>
                ) : (
                  <td key={to} className={`text-center tabular-nums font-semibold rounded-xl py-2.5 ${shade(n)}`} title={`${CHANNEL_LABEL[from]} → ${CHANNEL_LABEL[to]}: ${n}`}>{n}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepDots({ step }: { step: string }) {
  const i = STEPS.indexOf(step as (typeof STEPS)[number]);
  return (
    <span className="flex items-center gap-2" title={STEP_LABEL[step]}>
      <span className="flex gap-0.5" aria-hidden>
        {STEPS.slice(1).map((s, k) => (
          <span key={s} className={`w-4 h-1.5 rounded-full ${step !== "CANCELADO" && k + 1 <= i ? "bg-sd-blue" : "bg-slate-200"}`} />
        ))}
      </span>
      <span className="text-[11px] text-slate-600 whitespace-nowrap">{STEP_LABEL[step]}</span>
    </span>
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
