"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChannelChip, TimelineItem, type Ev } from "@/app/_components/Timeline";
import { api } from "@/lib/client/api";
import { ago, formatDate, formatTime } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, STEP_LABEL, STEPS } from "@/lib/labels";

type Journey = {
  caseId: string;
  paciente: string | null;
  estudio: string | null;
  clinica: string | null;
  folio: string | null;
  step: string;
  status: "ACTIVO" | "PAUSADO" | "CONFIRMADO" | "CANCELADO";
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

export default function AdminDashboard() {
  const router = useRouter();
  const [me, setMe] = useState<{ nombre: string; role: string } | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<Ev[]>([]);
  const [live, setLive] = useState(false);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const sinceRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const d = await api<Overview>("/api/admin/overview", { as: "CALL_CENTER" });
    if (sinceRef.current === null) {
      sinceRef.current = d.recent.at(-1)?.seq ?? "0";
      setFeed([...d.recent].reverse());
    }
    setData(d);
  }, []);

  useEffect(() => {
    api<{ staff: { nombre: string; role: string } }>("/api/auth/me", { as: "CALL_CENTER" })
      .then((r) => {
        setMe(r.staff);
        if (r.staff.role === "ADMIN") load();
      })
      .catch(() => router.replace("/asesor/login"));
  }, [router, load]);

  // Tiempo real: cada evento entra al feed y recalcula el tablero (agrupando ráfagas).
  const ready = data !== null;
  useEffect(() => {
    if (!ready) return;
    const es = new EventSource(`/api/events?as=STAFF&since=${sinceRef.current}`);
    const onEvent = (msg: MessageEvent) => {
      const ev: Ev = JSON.parse(msg.data);
      setFeed((f) => (f.some((x) => x.seq === ev.seq) ? f : [ev, ...f].slice(0, 60)));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 400);
    };
    for (const t of Object.keys(EVENT_LABEL)) es.addEventListener(t, onEvent);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const tick = setInterval(() => setTick((n) => n + 1), 30_000); // refresca los "hace X min"
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, [ready, load]);

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
  if (!data) return <main className="min-h-screen grid place-items-center text-slate-500">Cargando…</main>;
  const k = data.kpis;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 h-14 flex items-center gap-4">
        <p className="font-semibold whitespace-nowrap">
          <span className="text-teal-700">Salud Digna</span><span className="hidden sm:inline"> · Patient journey</span>
        </p>
        <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${live ? "text-emerald-700" : "text-slate-400"}`}>
          <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
          {live ? "En vivo" : "Reconectando…"}
        </span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/asesor" className="text-teal-700 hover:underline hidden sm:inline">Consola de asesor</Link>
          <span className="text-slate-600 hidden md:inline">{me?.nombre}</span>
          <button onClick={logout} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">Salir</button>
        </div>
      </header>

      <main className="p-4 md:p-6 space-y-4 max-w-[1500px] mx-auto">
        <section className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Indicadores">
          <Kpi label="Trámites abiertos" value={k.open} />
          <Kpi label="Pausados (+10 min)" value={k.paused} hint="Candidatos a recuperar" />
          <Kpi label="Citas confirmadas (24 h)" value={k.confirmed24h} />
          <Kpi label="Cambios de canal (24 h)" value={k.switches24h} />
          <Kpi label="Recorridos multicanal" value={`${k.multichannelPct}%`} hint="Pasaron por 2+ canales" />
          <Kpi label="Conflictos detectados (24 h)" value={k.conflicts24h} hint="Ediciones simultáneas bloqueadas" />
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_400px]">
          <Card title="Trámites por etapa actual">
            <StepBars steps={data.steps} />
          </Card>
          <Card title="Cambios de canal" subtitle="De dónde a dónde continúan los pacientes">
            <TransitionMatrix channels={data.channels} t={data.transitions} />
          </Card>
          <Card title="Actividad en vivo" className="xl:row-span-2">
            <ol className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
              {feed.map((e) => <TimelineItem key={e.seq} e={e} />)}
            </ol>
          </Card>
          <Card title="Recorridos de pacientes" subtitle="Clic en un renglón para ver su línea de tiempo" className="xl:col-span-2">
            <JourneyTable journeys={data.journeys} onOpen={setOpenCase} />
          </Card>
        </div>

        <Card title="Auditoría de accesos del personal">
          <AuditTable rows={data.audit} />
        </Card>
      </main>

      {openCase && <CaseDrawer caseId={openCase} onClose={() => setOpenCase(null)} />}
    </div>
  );
}

function Card({ title, subtitle, className = "", children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 p-4 min-w-0 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Barras horizontales de una sola serie: magnitud por etapa (un solo tono; cancelado en gris neutro). */
function StepBars({ steps }: { steps: Record<string, number> }) {
  const rows = [...STEPS, "CANCELADO"].map((s) => ({ step: s, n: steps[s] ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.step} className="grid grid-cols-[120px_1fr_32px] items-center gap-2 text-sm" title={`${STEP_LABEL[r.step]}: ${r.n} trámite(s)`}>
          <span className="text-slate-600 truncate">{STEP_LABEL[r.step]}</span>
          <span className="h-5 bg-slate-100 rounded-r">
            {r.n > 0 && (
              <span className={`block h-full rounded-r-[4px] ${r.step === "CANCELADO" ? "bg-slate-400" : "bg-teal-600"}`}
                style={{ width: `${(100 * r.n) / max}%` }} />
            )}
          </span>
          <span className="text-right tabular-nums text-slate-700">{r.n}</span>
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
    return r > 0.75 ? "bg-teal-700 text-white" : r > 0.5 ? "bg-teal-500 text-white" : r > 0.25 ? "bg-teal-300 text-slate-900" : "bg-teal-100 text-slate-900";
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="text-left text-xs font-normal text-slate-500 p-1">De ↓ · A →</th>
            {channels.map((c) => <th key={c} className="text-xs font-medium text-slate-600 p-1">{CHANNEL_LABEL[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {channels.map((from) => (
            <tr key={from}>
              <th className="text-left text-xs font-medium text-slate-600 p-1 whitespace-nowrap">{CHANNEL_LABEL[from]}</th>
              {channels.map((to) => {
                const n = t[from]?.[to] ?? 0;
                return from === to ? (
                  <td key={to} className="bg-white text-center text-slate-300 rounded">·</td>
                ) : (
                  <td key={to} className={`text-center tabular-nums rounded py-2 ${shade(n)}`} title={`${CHANNEL_LABEL[from]} → ${CHANNEL_LABEL[to]}: ${n}`}>
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS = {
  ACTIVO: { icon: "●", label: "Activo", cls: "text-emerald-700" },
  PAUSADO: { icon: "⏸", label: "Pausado", cls: "text-amber-700" },
  CONFIRMADO: { icon: "✓", label: "Cita confirmada", cls: "text-teal-700" },
  CANCELADO: { icon: "✕", label: "Cancelado", cls: "text-slate-500" },
} as const;

function JourneyTable({ journeys, onOpen }: { journeys: Journey[]; onOpen: (id: string) => void }) {
  if (journeys.length === 0) return <p className="text-sm text-slate-500">Aún no hay trámites.</p>;
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-2 font-normal">Paciente</th>
            <th className="py-2 font-normal">Estudio</th>
            <th className="py-2 font-normal">Etapa</th>
            <th className="py-2 font-normal">Canales recorridos</th>
            <th className="py-2 font-normal">Estado</th>
            <th className="py-2 font-normal text-right">Última actividad</th>
          </tr>
        </thead>
        <tbody>
          {journeys.map((j) => {
            const st = STATUS[j.status];
            return (
              <tr key={j.caseId} onClick={() => onOpen(j.caseId)} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                <td className="py-2 pr-3">
                  <button className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(j.caseId); }}>
                    {j.paciente ?? <span className="text-slate-400 italic">Visitante anónimo</span>}
                  </button>
                </td>
                <td className="py-2 pr-3 text-slate-600">{j.estudio ?? "—"}</td>
                <td className="py-2 pr-3">
                  <StepDots step={j.step} />
                </td>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-1 flex-wrap">
                    {j.channels.map((c, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-slate-300" aria-hidden>→</span>}
                        <ChannelChip channel={c} />
                      </span>
                    ))}
                  </span>
                </td>
                <td className={`py-2 pr-3 whitespace-nowrap ${st.cls}`}>
                  <span aria-hidden>{st.icon}</span> {st.label}
                </td>
                <td className="py-2 text-right text-slate-500 whitespace-nowrap">{ago(j.updatedAt)}</td>
              </tr>
            );
          })}
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
          <span key={s} className={`w-3 h-1.5 rounded-sm ${step === "CANCELADO" ? "bg-slate-200" : k + 1 <= i ? "bg-teal-600" : "bg-slate-200"}`} />
        ))}
      </span>
      <span className="text-xs text-slate-600 whitespace-nowrap">{STEP_LABEL[step]}</span>
    </span>
  );
}

function AuditTable({ rows }: { rows: Overview["audit"] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">Sin accesos del personal todavía.</p>;
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-2 font-normal">Hora</th>
            <th className="py-2 font-normal">Personal</th>
            <th className="py-2 font-normal">Acción</th>
            <th className="py-2 font-normal">Paciente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq} className="border-b border-slate-100">
              <td className="py-2 pr-3 tabular-nums text-slate-500 whitespace-nowrap">{formatTime(r.createdAt)}</td>
              <td className="py-2 pr-3">{r.staff ? `${r.staff.nombre} (${r.staff.role === "ADMIN" ? "admin" : "asesor"})` : "—"}</td>
              <td className="py-2 pr-3">{EVENT_LABEL[r.type] ?? r.type}</td>
              <td className="py-2">{r.paciente ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CaseDetail = { case: { id: string; step: string; data: Record<string, string>; version: number; lastChannel: string }; pending: string | null; timeline: Ev[] };

function CaseDrawer({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const [d, setD] = useState<CaseDetail | null>(null);
  useEffect(() => {
    api<CaseDetail>(`/api/cases/${caseId}`, { as: "CALL_CENTER" }).then(setD);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [caseId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Detalle del trámite">
      <button className="absolute inset-0 bg-slate-900/30" aria-label="Cerrar" onClick={onClose} />
      <aside className="relative w-full max-w-[460px] h-full bg-white shadow-xl overflow-y-auto p-5 space-y-4">
        <div className="flex items-center">
          <h2 className="font-semibold">Detalle del trámite</h2>
          <button onClick={onClose} className="ml-auto rounded-md border border-slate-300 px-2 py-0.5 text-sm hover:bg-slate-50">Cerrar</button>
        </div>
        {!d ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          <>
            <dl className="text-sm grid grid-cols-[90px_1fr] gap-y-1">
              <dt className="text-slate-500">Etapa</dt><dd>{STEP_LABEL[d.case.step]}</dd>
              <dt className="text-slate-500">Estudio</dt><dd>{d.case.data.estudio ?? "—"}</dd>
              <dt className="text-slate-500">Clínica</dt><dd>{d.case.data.clinica ?? "—"}</dd>
              <dt className="text-slate-500">Horario</dt><dd>{d.case.data.horario ? formatDate(d.case.data.horario) : "—"}</dd>
              {d.case.data.folio && (<><dt className="text-slate-500">Folio</dt><dd className="font-mono">{d.case.data.folio}</dd></>)}
              <dt className="text-slate-500">Último canal</dt><dd><ChannelChip channel={d.case.lastChannel} /></dd>
            </dl>
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Línea de tiempo</h3>
              <ol className="space-y-3">{[...d.timeline].reverse().map((e) => <TimelineItem key={e.seq} e={e} />)}</ol>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
