"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatDate, formatTime, money } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, PENDING_LABEL, STEP_LABEL, STEPS } from "@/lib/labels";
import { TimelineItem, type Ev } from "@/app/_components/Timeline";

type CaseT = { id: string; step: string; version: number; lastChannel: string; data: Record<string, string | number>; updatedAt: string };
type Detail = {
  patient: { id: string; nombre: string; telefono: string; fechaNac: string; email: string | null };
  verifiedUntil: string | null;
  activeCase: CaseT | null;
  pending: string | null;
  history: CaseT[];
  summary: { lines: string[]; source: string };
  timeline: Ev[];
};
type Catalog = { studies: { id: string; nombre: string; precio: number }[]; clinics: { id: string; nombre: string }[]; slots: string[] };

// Eventos que cambian el expediente: al llegar por SSE se recarga el detalle.
const RELOAD_ON = new Set(["CASE_CREATED", "STEP_COMPLETED", "CASE_RESUMED", "APPOINTMENT_CONFIRMED", "CASE_CANCELLED", "INTENT_CLASSIFIED"]);

const BANNER_STYLE = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  info: "bg-amber-50 text-amber-900 border-amber-200",
  error: "bg-red-50 text-red-800 border-red-200",
};

export function PatientPanel({ patientId }: { patientId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [live, setLive] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sinceRef = useRef<string | null>(null); // último evento ya cargado: SSE arranca desde ahí

  const load = useCallback(async () => {
    const d = await api<Detail>(`/api/staff/patients/${patientId}`, { as: "CALL_CENTER" });
    sinceRef.current ??= d.timeline.at(-1)?.seq ?? "0";
    setDetail(d);
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
    load();
    api<Catalog>("/api/catalog").then(setCatalog);
  }, [load]);

  // Tiempo real: lo que haga el paciente en otro canal aparece aquí sin recargar.
  const ready = detail !== null;
  useEffect(() => {
    if (!ready) return;
    const es = new EventSource(`/api/events?as=STAFF&patientId=${patientId}&since=${sinceRef.current}`);
    const onEvent = (msg: MessageEvent) => {
      const ev: Ev = JSON.parse(msg.data);
      setDetail((d) => (d && !d.timeline.some((x) => x.seq === ev.seq) ? { ...d, timeline: [...d.timeline, ev] } : d));
      if (RELOAD_ON.has(ev.type)) {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(load, 150);
      }
    };
    for (const t of Object.keys(EVENT_LABEL)) es.addEventListener(t, onEvent);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false); // el navegador reconecta solo y pide lo perdido con Last-Event-ID
    return () => es.close();
  }, [ready, patientId, load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBanner(null);
    try {
      await fn();
      if (ok) setBanner({ kind: "ok", text: ok });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBanner({ kind: "info", text: "El paciente actualizó el trámite desde otro canal mientras lo editabas. Se cargó la versión más reciente." });
      } else {
        setBanner({ kind: "error", text: err instanceof ApiError ? err.message : "Error de red" });
      }
    }
    await load();
  }

  if (!detail) return <p className="text-slate-500 text-sm">Cargando expediente…</p>;
  const { patient, activeCase: c } = detail;

  const advance = (to: string, data: Record<string, unknown> = {}) =>
    act(() => api(`/api/cases/${c!.id}`, { as: "CALL_CENTER", body: { to, data, expectedVersion: c!.version } }), to === "CITA_CONFIRMADA" ? "Cita confirmada." : undefined);

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <h2 className="text-lg font-semibold">{patient.nombre}</h2>
          <p className="text-sm text-slate-600">
            {patient.telefono} · Nac. {patient.fechaNac}
            {patient.email ? ` · ${patient.email}` : ""}
          </p>
        </div>
        <span className="ml-auto text-xs rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1">
          {detail.verifiedUntil ? `Identidad validada hasta ${formatTime(detail.verifiedUntil).slice(0, 5)}` : "Acceso de administrador"}
        </span>
      </section>

      {banner && (
        <div role="status" className={`rounded-lg px-4 py-2 text-sm border ${BANNER_STYLE[banner.kind]}`}>
          {banner.text}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4 min-w-0">
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              Resumen del contexto
              <span className="text-[11px] font-normal text-slate-400">{detail.summary.source === "llm" ? "IA" : "automático"}</span>
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {detail.summary.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </section>

          {c ? (
            <CaseCard c={c} pending={detail.pending} patient={patient} catalog={catalog} onAdvance={advance}
              onCancel={() => confirm("¿Cancelar el trámite del paciente?") && advance("CANCELADO", { motivo: "Cancelado por el paciente vía Call Center" })} />
          ) : (
            <section className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
              <p className="text-sm text-slate-600">El paciente no tiene trámites abiertos.</p>
              <button onClick={() => act(() => api("/api/cases", { as: "CALL_CENTER", body: { patientId } }))}
                className="ml-auto rounded-md bg-teal-700 text-white px-3 py-1.5 text-sm font-medium hover:bg-teal-800">
                Nuevo trámite
              </button>
            </section>
          )}

          {detail.history.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700">Trámites anteriores</h3>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {detail.history.map((h) => (
                  <li key={h.id} className="py-2 flex flex-wrap gap-x-3">
                    <span className={h.step === "CANCELADO" ? "text-slate-500 line-through" : ""}>{String(h.data.estudio ?? "Sin estudio")}</span>
                    <span className="text-slate-500">{String(h.data.clinica ?? "")}</span>
                    {h.data.folio && <span className="font-mono text-xs bg-slate-100 rounded px-1.5 py-0.5">{h.data.folio}</span>}
                    <span className="ml-auto text-slate-500">{STEP_LABEL[h.step]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="bg-white rounded-xl border border-slate-200 p-4 min-w-0">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            Línea de tiempo
            <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-normal ${live ? "text-emerald-700" : "text-slate-400"}`}>
              <span className={`w-2 h-2 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              {live ? "En vivo" : "Reconectando…"}
            </span>
          </h3>
          <ol className="mt-3 space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {[...detail.timeline].reverse().map((e) => <TimelineItem key={e.seq} e={e} />)}
          </ol>
        </section>
      </div>
    </div>
  );
}

function CaseCard({ c, pending, patient, catalog, onAdvance, onCancel }: {
  c: CaseT;
  pending: string | null;
  patient: Detail["patient"];
  catalog: Catalog | null;
  onAdvance: (to: string, data?: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const target = editing ?? pending;
  const current = STEPS.indexOf(c.step as (typeof STEPS)[number]);
  const go = async (to: string, data?: Record<string, unknown>) => {
    await onAdvance(to, data);
    setEditing(null);
  };
  const row = (label: string, value: React.ReactNode, step: string) => (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-20 shrink-0 text-slate-500">{label}</dt>
      <dd className="flex-1 min-w-0">{value ?? <span className="text-slate-400">—</span>}</dd>
      {value != null && STEPS.indexOf(step as (typeof STEPS)[number]) <= current && (
        <button onClick={() => setEditing(step)} className="text-xs text-teal-700 hover:underline">Cambiar</button>
      )}
    </div>
  );

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Trámite abierto</h3>
        <span className="text-xs text-slate-500">último canal: {CHANNEL_LABEL[c.lastChannel]} · v{c.version}</span>
        <button onClick={onCancel} className="ml-auto text-xs text-red-700 hover:underline">Cancelar trámite</button>
      </div>

      <ol className="flex gap-1" aria-label="Progreso">
        {STEPS.slice(1).map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1.5 rounded-full ${i + 1 <= current ? "bg-teal-600" : "bg-slate-200"}`} />
            <p className={`mt-1 text-[11px] ${i + 1 <= current ? "text-teal-800" : "text-slate-400"}`}>{STEP_LABEL[s]}</p>
          </li>
        ))}
      </ol>

      <dl className="text-sm divide-y divide-slate-100">
        {row("Estudio", c.data.estudio ? `${c.data.estudio} · ${money(Number(c.data.precio))}` : null, "ESTUDIO_ELEGIDO")}
        {row("Clínica", c.data.clinica ?? null, "CLINICA_ELEGIDA")}
        {row("Horario", c.data.horario ? formatDate(String(c.data.horario)) : null, "HORARIO_ELEGIDO")}
      </dl>
      {c.data.preparacion && <p className="text-xs text-slate-600 bg-slate-50 rounded-md px-3 py-2">Preparación: {c.data.preparacion}</p>}

      {target && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 space-y-2">
          <p className="text-sm font-medium text-teal-900">
            {editing ? `Cambiar ${STEP_LABEL[editing].toLowerCase()}` : `Siguiente: ${PENDING_LABEL[target]}`}
            {editing && <button onClick={() => setEditing(null)} className="ml-2 text-xs font-normal text-slate-600 hover:underline">cancelar cambio</button>}
          </p>
          <StepAction step={target} patient={patient} catalog={catalog} onSubmit={go} />
        </div>
      )}
    </section>
  );
}

function StepAction({ step, patient, catalog, onSubmit }: {
  step: string;
  patient: Detail["patient"];
  catalog: Catalog | null;
  onSubmit: (to: string, data?: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (data?: Record<string, unknown>) => {
    setBusy(true);
    await onSubmit(step, data);
    setBusy(false);
  };
  const btn = "rounded-md border border-teal-300 bg-white px-3 py-1.5 text-sm hover:bg-teal-50 disabled:opacity-50 text-left";
  if (!catalog) return <p className="text-sm text-slate-500">Cargando catálogo…</p>;

  switch (step) {
    case "ESTUDIO_ELEGIDO":
      return (
        <div className="flex flex-wrap gap-2">
          {catalog.studies.map((s) => (
            <button key={s.id} disabled={busy} className={btn} onClick={() => run({ studyId: s.id })}>
              {s.nombre} <span className="text-slate-500">{money(s.precio)}</span>
            </button>
          ))}
        </div>
      );
    case "CLINICA_ELEGIDA":
      return (
        <div className="flex flex-wrap gap-2">
          {catalog.clinics.map((cl) => <button key={cl.id} disabled={busy} className={btn} onClick={() => run({ clinicId: cl.id })}>{cl.nombre}</button>)}
        </div>
      );
    case "HORARIO_ELEGIDO":
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {catalog.slots.map((s) => <button key={s} disabled={busy} className={btn} onClick={() => run({ horario: s })}>{formatDate(s)}</button>)}
        </div>
      );
    case "DATOS_CONFIRMADOS":
      return (
        <div className="space-y-2 text-sm">
          <p>Confirma con el paciente: <strong>{patient.nombre}</strong>, tel. {patient.telefono}, nacimiento {patient.fechaNac}.</p>
          <button disabled={busy} onClick={() => run()} className="rounded-md bg-teal-700 text-white px-3 py-1.5 font-medium hover:bg-teal-800 disabled:opacity-50">
            Datos confirmados con el paciente
          </button>
        </div>
      );
    case "CITA_CONFIRMADA":
      return (
        <button disabled={busy} onClick={() => run()} className="rounded-md bg-teal-700 text-white px-3 py-1.5 text-sm font-medium hover:bg-teal-800 disabled:opacity-50">
          Confirmar cita
        </button>
      );
    default:
      return null;
  }
}
