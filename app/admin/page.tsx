"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChannelChip, type Ev } from "@/app/_components/Timeline";
import type { AdminStats } from "@/lib/admin-stats";
import { api, ApiError } from "@/lib/client/api";
import { ago, TZ } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, STEP_LABEL, STEPS, SWI_PREFIX } from "@/lib/labels";
import { Dashboard } from "./Dashboard";
import { CHANNEL_VISUAL, JourneyGraph, type CaseDetail } from "./JourneyGraph";
import type { Journey, Overview, SwiOverview } from "./types";

export type Filter = "ALL" | "WHATSAPP" | "WEB" | "CALL_CENTER" | "APP" | "CLINICA" | "PAUSADO";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "ALL", label: "Todos" },
  { id: "WHATSAPP", label: "WhatsApp" },
  { id: "WEB", label: "Página Web" },
  { id: "CALL_CENTER", label: "Call Center" },
  { id: "APP", label: "App Salud Digna" },
  { id: "CLINICA", label: "Clínica" },
];

const isSwi = (id: string) => id.startsWith(SWI_PREFIX);
const PAGE = 24; // tarjetas por tanda en la lista de recorridos

// Como ago(): depende de la hora; el tick de 30 s vuelve a pintar el estado.
const isRecent = (d: Date, ms: number) => Date.now() - d.getTime() < ms;

type View = "dashboard" | "pacientes";
// Navegación lateral: el dashboard ya reúne canales, clínicas, trámites y agentes; solo hay dos vistas.
const NAV: { label: string; icon: string; view: View }[] = [
  { label: "Dashboard", view: "dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { label: "Pacientes Omnicanal", view: "pacientes", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
];

/** Suma los recorridos de SWI a los nuestros: un solo tablero para todos los canales. */
function withSwi(o: Overview, s: SwiOverview | null): Overview {
  if (!s?.kpis.total) return o;
  const add = (a: Record<string, number>, b: Record<string, number>) => {
    const r = { ...a };
    for (const [k, v] of Object.entries(b)) r[k] = (r[k] ?? 0) + v;
    return r;
  };
  const transitions = { ...o.transitions };
  for (const [from, row] of Object.entries(s.transitions)) transitions[from] = add(transitions[from] ?? {}, row);
  const n = o.journeys.length;
  return {
    ...o,
    kpis: {
      ...o.kpis,
      open: o.kpis.open + s.kpis.open,
      paused: o.kpis.paused + s.kpis.paused,
      confirmed24h: o.kpis.confirmed24h + s.kpis.confirmed24h,
      switches24h: o.kpis.switches24h + s.kpis.switches24h,
      multichannelPct: Math.round((o.kpis.multichannelPct * n + 100 * s.kpis.multichannel) / (n + s.kpis.total)),
    },
    steps: add(o.steps, s.steps),
    transitions,
    channels: [...new Set([...o.channels, ...Object.keys(s.transitions), ...Object.values(s.transitions).flatMap((r) => Object.keys(r))])],
    journeys: [...o.journeys, ...s.journeys].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

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
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const swipeX = useRef<number | null>(null);
  const [feed, setFeed] = useState<Ev[]>([]);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [, setTick] = useState(0);
  const sinceRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    let d: Overview;
    try {
      const [ours, swi] = await Promise.all([
        api<Overview>("/api/admin/overview", { as: "CALL_CENTER" }),
        // Si SWI falla, el tablero sigue con lo nuestro.
        api<SwiOverview>("/api/integraciones/swi/resumen", { as: "CALL_CENTER" }).catch((err) => (console.warn("Sin datos de SWI:", err), null)),
      ]);
      // Estadísticas del dashboard: aparte, para que una falla no tumbe el tablero.
      api<AdminStats>("/api/admin/stats", { as: "CALL_CENTER" }).then(setStats, (err) => console.warn("Sin estadísticas:", err));
      d = withSwi(ours, swi);
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
      const url = isSwi(id) ? `/api/integraciones/swi/tramites/${encodeURIComponent(id.slice(SWI_PREFIX.length))}` : `/api/cases/${id}`;
      const d = await api<CaseDetail>(url, { as: "CALL_CENTER" });
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leer la vista del hash al montar (no existe en el servidor)
    if (location.hash === "#pacientes") setView("pacientes");
  }, []);

  // Barra lateral deslizable: Esc la cierra.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  function go(next: View, opts: { paused?: boolean } = {}) {
    setNavOpen(false); // al elegir un apartado, la barra se esconde
    setView(next);
    history.replaceState(null, "", next === "pacientes" ? "#pacientes" : location.pathname);
    if (opts.paused) { setFilter("PAUSADO"); setLimit(PAGE); }
    // Esperar a que se pinte la vista antes de desplazarse.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
        const swiOfSelected = ev.type === "SWI_EVENTO" && selectedRef.current === SWI_PREFIX + String(ev.payload?.tramiteId);
        if (selectedRef.current && (ev.caseId === selectedRef.current || swiOfSelected)) loadDetail(selectedRef.current);
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

  const swiLast = stats?.swi.lastReceivedAt ? new Date(stats.swi.lastReceivedAt) : null;
  const swiOnline = !!swiLast && isRecent(swiLast, 5 * 60_000);
  const initials = (me?.nombre ?? "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800">
      {/* Fondo: tocar fuera cierra la barra */}
      <div onClick={() => setNavOpen(false)} aria-hidden
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${navOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`} />
      {/* Barra lateral */}
      <aside id="admin-nav" aria-label="Navegación del administrador" inert={!navOpen}
        onTouchStart={(e) => (swipeX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => { if (swipeX.current !== null && swipeX.current - e.changedTouches[0].clientX > 60) setNavOpen(false); swipeX.current = null; }}
        className={`fixed left-0 top-0 z-50 flex w-72 max-w-[85vw] h-dvh overflow-y-auto bg-white border-r border-slate-200/80 shadow-2xl flex-col justify-between gap-6 p-5 transition-transform duration-300 ease-out motion-reduce:transition-none ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div>
          <div className="flex items-center gap-3 px-2 py-1 mb-8">
            <button onClick={() => setNavOpen(false)} aria-label="Cerrar menú" className="order-last ml-auto w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 grid place-items-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sd-green-dark to-sd-green flex items-center justify-center text-white shadow-md shadow-emerald-900/10" aria-hidden>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeLinecap="round" /></svg>
            </span>
            <div>
              <span className="block text-base font-extrabold tracking-tight text-slate-900">Salud Digna</span>
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 tracking-wide uppercase">OmniTrack 360°</span>
            </div>
          </div>
          <nav className="space-y-1.5">
            {NAV.map((n) => {
              const active = n.view === view;
              return (
                <button key={n.label} onClick={() => go(n.view)} aria-current={active ? "page" : undefined}
                  className={`w-full text-left flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-sm whitespace-nowrap transition-colors group ${active ? "bg-emerald-50/80 text-emerald-800 font-semibold" : "text-slate-500 hover:text-slate-900 hover:bg-slate-100 font-medium"}`}>
                  <span className="flex items-center gap-3.5">
                    <svg className={`w-5 h-5 ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden><path d={n.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {n.label}
                  </span>
                  {n.view === "pacientes" && k.paused > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full" title={`${k.paused} pausados por recuperar`}>{k.paused}</span>}
                </button>
              );
            })}
          </nav>
        </div>
        {/* Estado real de la integración con SWI */}
        <div className={`rounded-2xl p-4 text-white shadow-lg ${swiOnline ? "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 shadow-emerald-900/15" : "bg-gradient-to-br from-slate-600 to-slate-800"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center ${swiOnline ? "dash-float" : ""}`} aria-hidden>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold bg-white/15 px-2 py-0.5 rounded-full border border-white/20">{swiOnline && <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-ping" aria-hidden />}{swiOnline ? "En línea" : "Sin datos recientes"}</span>
          </div>
          <h4 className="font-bold text-sm mb-1">Integración SWI</h4>
          <p className="text-xs text-white/85 leading-relaxed mb-3">
            {swiLast ? <>Último dato {ago(swiLast)} · {stats!.swi.lastHour.toLocaleString("es-MX")} eventos en la última hora.</> : "Todavía no llegan datos de SWI."}
          </p>
          <Link href="/asesor" className="w-full bg-white text-emerald-800 text-xs font-bold py-2 px-3 rounded-xl hover:bg-emerald-50 transition flex items-center justify-center gap-1.5">
            Consola del asesor <span aria-hidden>›</span>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex flex-col">
        {/* Barra superior */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 md:px-8 py-3.5 flex flex-wrap items-center gap-3 md:gap-4">
          <button onClick={() => setNavOpen(true)} aria-label="Abrir menú" aria-expanded={navOpen} aria-controls="admin-nav"
            className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-slate-600 hover:bg-slate-100 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>
            <span className="hidden sm:inline text-xs font-extrabold text-slate-900">{view === "dashboard" ? "Dashboard" : "Pacientes Omnicanal"}</span>
          </button>
          <label className="flex-1 min-w-[200px] max-w-xl relative">
            <span className="sr-only">Buscar paciente, folio, clínica o estudio</span>
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); if (view !== "pacientes") { setFilter("ALL"); go("pacientes"); } }}
              placeholder="Buscar paciente por nombre, folio, clínica o estudio…"
              className="w-full bg-slate-100/80 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-800 placeholder-slate-400 font-medium outline-none focus:ring-2 focus:ring-emerald-500 transition" />
          </label>
          <div className="flex items-center gap-3 ml-auto">
            <span className="hidden sm:flex items-center gap-2 bg-slate-100/80 border border-slate-200/60 text-slate-700 text-xs font-semibold px-3 py-2 rounded-xl">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" /></svg>
              Hoy, {new Date().toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" })}
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} title={live ? "En vivo" : "Reconectando…"} aria-hidden />
            </span>
            <button onClick={() => go("pacientes", { paused: true })} className="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              aria-label={`${k.paused} trámites pausados por recuperar`} title={`${k.paused} trámites pausados por recuperar`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {k.paused > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden />}
            </button>
            <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
              <span className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-white text-xs ring-2 ring-emerald-500/20" aria-hidden>{initials}</span>
              <div className="hidden md:block text-left">
                <p className="text-xs font-bold text-slate-800 leading-tight">{me?.nombre}</p>
                <p className="text-[11px] text-slate-400 font-medium">Administración · Omnicanalidad</p>
              </div>
              <button onClick={logout} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Salir</button>
            </div>
          </div>
        </header>

        {view === "dashboard" ? (
          <Dashboard me={me} data={data} stats={stats} feed={feed} live={live}
            onOpen={(id) => { setSelectedId(id); go("pacientes"); }}
            onShowPaused={() => go("pacientes", { paused: true })} />
        ) : (
          <div className="p-3 md:p-6 lg:p-8">
            <main className="w-full max-w-[1720px] mx-auto bg-white/70 backdrop-blur-xl rounded-[32px] md:rounded-[40px] border border-white/80 shadow-[0_30px_90px_-20px_rgba(20,45,95,0.08)] overflow-hidden">
              {/* Pacientes Omnicanal: filtros por canal */}
              <header className="px-5 md:px-8 py-5 flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-slate-100/60">
                <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Pacientes omnicanal</h1>
                <nav className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full" aria-label="Filtrar recorridos por canal">
                  {FILTERS.map((f) => (
                    <button key={f.id} onClick={() => { setFilter(f.id); setLimit(PAGE); }} aria-pressed={filter === f.id}
                      className={`px-4 py-2 rounded-full text-xs whitespace-nowrap transition-all ${filter === f.id ? "font-bold bg-sd-dark text-white shadow-sm" : "font-medium text-slate-500 hover:text-slate-900"}`}>
                      {f.label}
                    </button>
                  ))}
                  <button onClick={() => { setFilter(filter === "PAUSADO" ? "ALL" : "PAUSADO"); setLimit(PAGE); }} aria-pressed={filter === "PAUSADO"}
                    className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap border flex items-center gap-1.5 transition-colors ${filter === "PAUSADO" ? "bg-amber-500 text-white border-amber-500" : "text-amber-700 bg-amber-50 border-amber-200/50 hover:bg-amber-100"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${filter === "PAUSADO" ? "bg-white" : "bg-amber-500 animate-pulse"}`} aria-hidden />
                    Pausados ({k.paused})
                  </button>
                </nav>
              </header>

              {/* Indicadores */}
              <section className="px-5 md:px-8 py-4 grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 border-b border-slate-100/60" aria-label="Indicadores">
                <Kpi label="Trámites abiertos" value={k.open} />
                <Kpi label="Pausados (+10 min)" value={k.paused} hint="Ver candidatos a recuperar →" tone="warning"
                  onClick={() => { setFilter("PAUSADO"); setLimit(PAGE); document.getElementById("recorridos")?.scrollIntoView({ behavior: "smooth" }); }} />
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
                <section className="flex-1 min-w-0 h-[752px] relative" aria-label="Mapa del recorrido">
                  {showMap ? <JourneyGraph detail={detail} status={selected.status} /> : <div className="h-full grid place-items-center text-sm text-slate-400">Sin recorrido seleccionado.</div>}
                </section>
              </div>

              {/* Lista de recorridos (filtrable) */}
              <section id="recorridos" className="px-5 md:px-8 py-6 border-t border-slate-100/60 scroll-mt-20">
                <div className="flex items-baseline gap-3 mb-4">
                  <h2 className="text-sm font-bold text-slate-800">Recorridos de pacientes</h2>
                  <span className="text-xs text-slate-400">{journeys.length} de {data.journeys.length} · clic para ver su mapa</span>
                </div>
                {journeys.length === 0 ? (
                  <p className="text-sm text-slate-400">Ningún recorrido coincide con el filtro.</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {journeys.slice(0, limit).map((j) => (
                      <li key={j.caseId}>
                        <JourneyCard j={j} active={j.caseId === selectedId} onOpen={() => { setSelectedId(j.caseId); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
                      </li>
                    ))}
                  </ul>
                )}
                {journeys.length > limit && (
                  <button onClick={() => setLimit(limit + PAGE)}
                    className="mt-4 mx-auto block rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold text-slate-600 hover:border-sd-blue hover:text-sd-blue transition-colors">
                    Mostrar {Math.min(PAGE, journeys.length - limit)} más · quedan {journeys.length - limit}
                  </button>
                )}
              </section>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function JourneySidebar({ j, d }: { j: Journey; d: CaseDetail }) {
  const st = STATUS[j.status];
  const switches = d.timeline.filter((e) => e.type === "CASE_RESUMED").length || Math.max(0, j.channels.length - 1);
  // Quién intervino: personal por nombre; autoservicio por canal.
  const people = new Map<string, { label: string; sub: string; initials: string; channel: string; n: number }>();
  for (const e of d.timeline) {
    if (e.type === "ADVISOR_OPENED_CASE" && e.payload.role === "ADMIN") continue; // monitoreo, no atención
    const staff = e.actorId ? d.actors[e.actorId] : null;
    const swiCh = e.type === "SWI_EVENTO" ? String(e.payload.canal ?? "WEB") : null; // canal real del evento de SWI
    const key = staff ? `staff:${e.actorId}` : `ch:${swiCh ?? e.channel}`;
    const row =
      people.get(key) ??
      (swiCh
        ? { label: swiCh === "CLINICA" ? "Clínica (recepción)" : CHANNEL_LABEL[swiCh] ?? swiCh, sub: "Registrado por SWI", initials: (CHANNEL_LABEL[swiCh] ?? swiCh).slice(0, 2).toUpperCase(), channel: swiCh, n: 0 }
        : staff
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
        {isSwi(j.caseId) && <span className="ml-2 inline-block text-[11px] font-semibold text-blue-200 bg-blue-500/20 px-3 py-1 rounded-full uppercase tracking-wider" title="Datos recibidos de la consola SWI">SWI</span>}
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
      <div className="mt-3 flex items-start gap-2">
        <div className="flex items-center gap-1 flex-wrap min-w-0 flex-1">
          {j.channels.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300" aria-hidden>→</span>}
              <ChannelChip channel={c} />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          {isSwi(j.caseId) && <span className="text-[10px] rounded border border-slate-200 px-1 text-slate-500" title="Datos recibidos de la consola SWI">SWI</span>}
          <span className="text-[11px] text-slate-400 whitespace-nowrap">{ago(j.updatedAt)}</span>
        </div>
      </div>
    </button>
  );
}

function Kpi({ label, value, hint, tone, onClick }: { label: string; value: number | string; hint?: string; tone?: "warning"; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`text-left rounded-2xl px-4 py-3 border ${tone === "warning" && Number(value) > 0 ? "bg-amber-50/70 border-amber-200/60" : "bg-white border-slate-100 shadow-sm"} ${onClick ? "hover:-translate-y-0.5 hover:shadow-soft-card transition-all" : ""}`}>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums text-slate-900 mt-0.5">{value}</p>
      {hint && <p className={`text-[10px] ${onClick ? "text-amber-700 font-semibold" : "text-slate-400"}`}>{hint}</p>}
    </Tag>
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

