"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatDate, money } from "@/lib/format";
import { CHANNEL_NAME } from "@/lib/labels";
import { OtpLogin } from "./OtpLogin";

type CaseT = { id: string; step: string; version: number; lastChannel: string; data: Record<string, string | number> };
type Catalog = {
  studies: { id: string; nombre: string; precio: number; preparacion: string }[];
  clinics: { id: string; nombre: string; ciudad: string; direccion: string }[];
  slots: string[];
};
type View = "ESTUDIO" | "CLINICA" | "IDENTIDAD" | "HORARIO" | "DATOS" | "CITA" | "LISTO";

const OPEN = new Set(["INICIADO", "ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS"]);
const WIZARD: { view: View; label: string }[] = [
  { view: "IDENTIDAD", label: "Tu teléfono" },
  { view: "ESTUDIO", label: "Estudio" },
  { view: "CLINICA", label: "Clínica" },
  { view: "HORARIO", label: "Horario" },
  { view: "CITA", label: "Confirmar" },
];

/** Qué pantalla toca según el estado real del trámite (vive en el servidor, no en el navegador). */
function viewFor(c: CaseT | null): View {
  if (!c || c.step === "CANCELADO") return "ESTUDIO";
  switch (c.step) {
    case "INICIADO": return "ESTUDIO";
    case "ESTUDIO_ELEGIDO": return "CLINICA";
    case "CLINICA_ELEGIDA": return "HORARIO";
    case "HORARIO_ELEGIDO": return "DATOS";
    case "DATOS_CONFIRMADOS": return "CITA";
    default: return "LISTO";
  }
}

export type Me = { patient: { id: string; nombre: string } | null; activeCase: CaseT | null };

/**
 * Flujo de agendado compartido por los canales del paciente (Web y App). El estado vive en el servidor:
 * cualquier canal retoma donde se quedó el otro. `onMe` avisa al contenedor quién es el paciente.
 */
export function BookingFlow({ channel, onMe }: { channel: "WEB" | "APP"; onMe?: (me: Me) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [editing, setEditing] = useState<View | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CaseT | null>(null); // cita recién confirmada (ya no es un trámite "abierto")
  const seenChannel = useRef<string | null>(null);
  const lastCaseId = useRef<string | null>(null);
  const onMeRef = useRef(onMe);
  useEffect(() => {
    onMeRef.current = onMe;
  });

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("/api/auth/me", { as: channel });
      const c = m.activeCase && OPEN.has(m.activeCase.step) ? m.activeCase : null;
      // El trámite que estábamos viendo se cerró (p. ej. el asesor confirmó la cita): mostrar el resultado.
      if (!c && lastCaseId.current) {
        const prev = await api<{ case: CaseT }>(`/api/cases/${lastCaseId.current}`, { as: channel }).catch(() => null);
        if (prev?.case.step === "CITA_CONFIRMADA") {
          setDone(prev.case);
          setBanner(null);
        }
      }
      lastCaseId.current = c?.id ?? null;
      // Si el trámite avanzó en otro canal mientras esta pestaña estaba abierta (o desde la última visita), avisarlo.
      if (c && c.lastChannel !== channel && seenChannel.current !== c.lastChannel && OPEN.has(c.step)) {
        setBanner(`Retomamos tu trámite donde lo dejaste en ${CHANNEL_NAME[c.lastChannel as keyof typeof CHANNEL_NAME]}. No tienes que repetir nada.`);
      }
      seenChannel.current = c?.lastChannel ?? null;
      setMe({ ...m, activeCase: c });
      onMeRef.current?.(m);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe({ patient: null, activeCase: null }); // visitante nuevo
      else throw err;
    }
  }, [channel]);

  useEffect(() => {
    load();
    api<Catalog>("/api/catalog").then(setCatalog);
  }, [load]);

  // Tiempo real: si el paciente sigue en WhatsApp o con un asesor, esta pestaña se actualiza sola.
  const caseId = me?.activeCase?.id;
  useEffect(() => {
    if (!caseId) return;
    const es = new EventSource(`/api/events?as=${channel}&caseId=${caseId}&since=latest`);
    let t: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => {
      clearTimeout(t);
      t = setTimeout(load, 200);
    };
    for (const type of ["STEP_COMPLETED", "CASE_RESUMED", "APPOINTMENT_CONFIRMED", "CASE_CANCELLED"]) es.addEventListener(type, onEvent);
    return () => {
      clearTimeout(t);
      es.close();
    };
  }, [caseId, channel, load]);

  async function advance(to: string, data: Record<string, unknown> = {}) {
    setBusy(true);
    setBanner(null);
    try {
      let c = me?.activeCase && OPEN.has(me.activeCase.step) ? me.activeCase : null;
      if (!c) c = await api<CaseT>("/api/cases", { as: channel, body: {} });
      const r = await api<{ case: CaseT }>(`/api/cases/${c.id}`, { as: channel, body: { to, data, expectedVersion: c.version } });
      if (r.case.step === "CITA_CONFIRMADA") setDone(r.case);
      setEditing(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setBanner("Tu trámite se actualizó desde otro canal. Te mostramos la información más reciente.");
      else setBanner(err instanceof ApiError ? err.message : "No pudimos guardar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      await load();
      setBusy(false);
    }
  }

  if (!me || !catalog) return <main className="min-h-screen grid place-items-center text-slate-500">Cargando…</main>;
  const c = done ?? me.activeCase;
  const verified = !!me.patient;
  // Primero el teléfono: sin él los pasos quedarían en un trámite anónimo que ningún otro canal puede ver.
  const view = done ? "LISTO" : !verified ? "IDENTIDAD" : (editing ?? viewFor(c));
  const d = (c?.data ?? {}) as Record<string, string | number>;
  const wizardIndex = view === "DATOS" ? 4 : view === "LISTO" ? 5 : WIZARD.findIndex((w) => w.view === view);

  return (
    <div className="@container">
        {view !== "LISTO" && (
          <ol className="flex gap-2 mb-6" aria-label="Pasos">
            {WIZARD.map((w, i) => (
              <li key={w.view} className="flex-1 min-w-0">
                <div className={`h-1.5 rounded-full ${i < wizardIndex ? "bg-teal-600" : i === wizardIndex ? "bg-teal-300" : "bg-slate-200"}`} />
                <p className={`mt-1.5 text-xs truncate ${i <= wizardIndex ? "text-teal-800 font-medium" : "text-slate-400"}`} aria-current={i === wizardIndex ? "step" : undefined}>
                  {w.label}
                </p>
              </li>
            ))}
          </ol>
        )}

        {banner && (
          <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">{banner}</div>
        )}

        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="bg-white rounded-2xl border border-slate-200 p-5 @md:p-6 min-w-0">
            {editing && (
              <button onClick={() => setEditing(null)} className="text-sm text-teal-700 hover:underline mb-3">← Volver sin cambiar</button>
            )}
            {view === "ESTUDIO" && <StudyStep catalog={catalog} busy={busy} onPick={(id) => advance("ESTUDIO_ELEGIDO", { studyId: id })} />}
            {view === "CLINICA" && <ClinicStep catalog={catalog} busy={busy} onPick={(id) => advance("CLINICA_ELEGIDA", { clinicId: id })} />}
            {view === "IDENTIDAD" && (
              <OtpLogin channel={channel} title="Empieza con tu teléfono" onVerified={load}
                description="Verificamos tu teléfono para guardar cada paso al momento. Así podrás continuar cuando quieras por WhatsApp, con un asesor o en la app, sin repetir nada." />
            )}
            {view === "HORARIO" && <SlotStep slots={catalog.slots} busy={busy} onPick={(s) => advance("HORARIO_ELEGIDO", { horario: s })} />}
            {view === "DATOS" && (
              <ConfirmStep title="Confirma tus datos" busy={busy} action="Mis datos son correctos" onConfirm={() => advance("DATOS_CONFIRMADOS")}>
                <p>A nombre de <strong>{me.patient?.nombre}</strong>. Te enviaremos la confirmación al teléfono que verificaste.</p>
              </ConfirmStep>
            )}
            {view === "CITA" && (
              <ConfirmStep title="Confirma tu cita" busy={busy} action="Confirmar cita" onConfirm={() => advance("CITA_CONFIRMADA")}>
                <p>{String(d.estudio)} en {String(d.clinica)}, {d.horario ? formatDate(String(d.horario)) : ""}.</p>
                <p className="text-slate-600">Pagas en la clínica el día de tu estudio.</p>
              </ConfirmStep>
            )}
            {view === "LISTO" && c && (
              <div className="text-center py-6 space-y-3">
                <p className="text-4xl" aria-hidden>✅</p>
                <h1 className="text-2xl font-semibold">¡Tu cita está confirmada!</h1>
                <p className="text-slate-600">Folio <span className="font-mono font-semibold text-slate-900">{String(d.folio)}</span></p>
                <p className="text-slate-600">{String(d.estudio)} · {String(d.clinica)} · {d.horario ? formatDate(String(d.horario)) : ""}</p>
                {c.lastChannel !== channel && (
                  <p className="text-sm text-teal-800">Confirmada desde {CHANNEL_NAME[c.lastChannel as keyof typeof CHANNEL_NAME]}, sin que repitieras tus datos.</p>
                )}
                <p className="text-sm text-slate-500">
                  {channel === "APP" ? "Ya aparece en tu inicio." : "La puedes ver en la app de Salud Digna o preguntar por ella en WhatsApp o al Call Center."}
                </p>
                <button onClick={() => setDone(null)} className="mt-2 rounded-md border border-teal-600 text-teal-700 px-4 py-2 text-sm hover:bg-teal-50">
                  Agendar otro estudio
                </button>
              </div>
            )}
          </section>

          {c && view !== "LISTO" && d.estudio && (
            <aside className="bg-white rounded-2xl border border-slate-200 p-5 h-fit @3xl:sticky @3xl:top-6">
              <h2 className="text-sm font-semibold text-slate-700">Tu cotización</h2>
              <dl className="mt-3 text-sm space-y-3">
                <SummaryRow label="Estudio" value={String(d.estudio)} onChange={() => setEditing("ESTUDIO")} />
                <SummaryRow label="Clínica" value={d.clinica ? String(d.clinica) : null} onChange={d.clinica ? () => setEditing("CLINICA") : undefined} />
                <SummaryRow label="Horario" value={d.horario ? formatDate(String(d.horario)) : null} onChange={d.horario ? () => setEditing("HORARIO") : undefined} />
              </dl>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-baseline justify-between">
                <span className="text-sm text-slate-600">Total</span>
                <span className="text-xl font-semibold">{money(Number(d.precio))}</span>
              </div>
              {d.preparacion && <p className="mt-3 text-xs text-slate-600 bg-slate-50 rounded-md px-3 py-2">Preparación: {String(d.preparacion)}</p>}
              <p className="mt-3 text-xs text-slate-500">¿Tienes que irte? Tu avance queda guardado: continúa por WhatsApp o llamando al Call Center.</p>
            </aside>
          )}
        </div>
    </div>
  );
}

function SummaryRow({ label, value, onChange }: { label: string; value: string | null; onChange?: () => void }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-16 shrink-0 text-slate-500">{label}</dt>
      <dd className="flex-1 min-w-0">{value ?? <span className="text-slate-400">Por elegir</span>}</dd>
      {onChange && <button onClick={onChange} className="text-xs text-teal-700 hover:underline">Cambiar</button>}
    </div>
  );
}

const choice =
  "w-full text-left rounded-xl border border-slate-200 px-4 py-3 hover:border-teal-600 hover:bg-teal-50/40 focus:outline-none focus:ring-2 focus:ring-teal-600/40 disabled:opacity-50";

function StudyStep({ catalog, busy, onPick }: { catalog: Catalog; busy: boolean; onPick: (id: string) => void }) {
  return (
    <>
      <h1 className="text-xl font-semibold">¿Qué estudio necesitas?</h1>
      <p className="text-sm text-slate-600 mt-1">Precios de demostración.</p>
      <ul className="mt-4 grid gap-3 @md:grid-cols-2">
        {catalog.studies.map((s) => (
          <li key={s.id}>
            <button disabled={busy} onClick={() => onPick(s.id)} className={choice}>
              <span className="flex items-baseline gap-2">
                <span className="font-medium">{s.nombre}</span>
                <span className="ml-auto font-semibold text-teal-800">{money(s.precio)}</span>
              </span>
              <span className="block text-xs text-slate-500 mt-1">{s.preparacion}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function ClinicStep({ catalog, busy, onPick }: { catalog: Catalog; busy: boolean; onPick: (id: string) => void }) {
  return (
    <>
      <h1 className="text-xl font-semibold">Elige tu clínica</h1>
      <ul className="mt-4 grid gap-3">
        {catalog.clinics.map((c) => (
          <li key={c.id}>
            <button disabled={busy} onClick={() => onPick(c.id)} className={choice}>
              <span className="font-medium">{c.nombre}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{c.direccion} · {c.ciudad}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function SlotStep({ slots, busy, onPick }: { slots: string[]; busy: boolean; onPick: (s: string) => void }) {
  return (
    <>
      <h1 className="text-xl font-semibold">Elige un horario</h1>
      <ul className="mt-4 grid gap-3 grid-cols-2 @lg:grid-cols-3">
        {slots.map((s) => (
          <li key={s}>
            <button disabled={busy} onClick={() => onPick(s)} className={`${choice} text-center`}>{formatDate(s)}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function ConfirmStep({ title, action, busy, onConfirm, children }: { title: string; action: string; busy: boolean; onConfirm: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="text-sm space-y-1">{children}</div>
      <button disabled={busy} onClick={onConfirm} className="rounded-lg bg-teal-700 text-white px-5 py-2.5 font-medium hover:bg-teal-800 disabled:opacity-60">
        {busy ? "Guardando…" : action}
      </button>
    </div>
  );
}
