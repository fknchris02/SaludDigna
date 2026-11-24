"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { formatDate, money } from "@/lib/format";
import { CHANNEL_NAME } from "@/lib/labels";

type CaseT = { id: string; step: string; version: number; lastChannel: string; data: Record<string, string | number> };
type Me = { patient: { id: string; nombre: string } | null; activeCase: CaseT | null };
type Catalog = {
  studies: { id: string; nombre: string; precio: number; preparacion: string }[];
  clinics: { id: string; nombre: string; ciudad: string; direccion: string }[];
  slots: string[];
};
type View = "ESTUDIO" | "CLINICA" | "IDENTIDAD" | "HORARIO" | "DATOS" | "CITA" | "LISTO";

const OPEN = new Set(["INICIADO", "ESTUDIO_ELEGIDO", "CLINICA_ELEGIDA", "HORARIO_ELEGIDO", "DATOS_CONFIRMADOS"]);
const WIZARD: { view: View; label: string }[] = [
  { view: "ESTUDIO", label: "Estudio" },
  { view: "CLINICA", label: "Clínica" },
  { view: "IDENTIDAD", label: "Tus datos" },
  { view: "HORARIO", label: "Horario" },
  { view: "CITA", label: "Confirmar" },
];

/** Qué pantalla toca según el estado real del trámite (vive en el servidor, no en el navegador). */
function viewFor(c: CaseT | null, verified: boolean): View {
  if (!c || c.step === "CANCELADO") return "ESTUDIO";
  switch (c.step) {
    case "INICIADO": return "ESTUDIO";
    case "ESTUDIO_ELEGIDO": return "CLINICA";
    case "CLINICA_ELEGIDA": return verified ? "HORARIO" : "IDENTIDAD";
    case "HORARIO_ELEGIDO": return verified ? "DATOS" : "IDENTIDAD";
    case "DATOS_CONFIRMADOS": return "CITA";
    default: return "LISTO";
  }
}

export default function PatientWeb() {
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [editing, setEditing] = useState<View | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CaseT | null>(null); // cita recién confirmada (ya no es un trámite "abierto")
  const seenChannel = useRef<string | null>(null);
  const lastCaseId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("/api/auth/me", { as: "WEB" });
      const c = m.activeCase && OPEN.has(m.activeCase.step) ? m.activeCase : null;
      // El trámite que estábamos viendo se cerró (p. ej. el asesor confirmó la cita): mostrar el resultado.
      if (!c && lastCaseId.current) {
        const prev = await api<{ case: CaseT }>(`/api/cases/${lastCaseId.current}`, { as: "WEB" }).catch(() => null);
        if (prev?.case.step === "CITA_CONFIRMADA") {
          setDone(prev.case);
          setBanner(null);
        }
      }
      lastCaseId.current = c?.id ?? null;
      // Si el trámite avanzó en otro canal mientras esta pestaña estaba abierta (o desde la última visita), avisarlo.
      if (c && c.lastChannel !== "WEB" && seenChannel.current !== c.lastChannel && OPEN.has(c.step)) {
        setBanner(`Retomamos tu trámite donde lo dejaste en ${CHANNEL_NAME[c.lastChannel as keyof typeof CHANNEL_NAME]}. No tienes que repetir nada.`);
      }
      seenChannel.current = c?.lastChannel ?? null;
      setMe({ ...m, activeCase: c });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe({ patient: null, activeCase: null }); // visitante nuevo
      else throw err;
    }
  }, []);

  useEffect(() => {
    load();
    api<Catalog>("/api/catalog").then(setCatalog);
  }, [load]);

  // Tiempo real: si el paciente sigue en WhatsApp o con un asesor, esta pestaña se actualiza sola.
  const caseId = me?.activeCase?.id;
  useEffect(() => {
    if (!caseId) return;
    const es = new EventSource(`/api/events?as=WEB&caseId=${caseId}&since=latest`);
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
  }, [caseId, load]);

  async function advance(to: string, data: Record<string, unknown> = {}) {
    setBusy(true);
    setBanner(null);
    try {
      let c = me?.activeCase && OPEN.has(me.activeCase.step) ? me.activeCase : null;
      if (!c) c = await api<CaseT>("/api/cases", { as: "WEB", body: {} });
      const r = await api<{ case: CaseT }>(`/api/cases/${c.id}`, { as: "WEB", body: { to, data, expectedVersion: c.version } });
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

  async function logout() {
    await api("/api/auth/logout", { body: { scope: "WEB" } });
    seenChannel.current = null;
    lastCaseId.current = null;
    setDone(null);
    setBanner(null);
    await load();
  }

  if (!me || !catalog) return <main className="min-h-screen grid place-items-center text-slate-500">Cargando…</main>;
  const c = done ?? me.activeCase;
  const verified = !!me.patient;
  const view = done ? "LISTO" : (editing ?? viewFor(c, verified));
  const d = (c?.data ?? {}) as Record<string, string | number>;
  const wizardIndex = view === "DATOS" ? 4 : view === "LISTO" ? 5 : WIZARD.findIndex((w) => w.view === view);

  return (
    <div className="min-h-screen bg-[#f4f7f6] text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-teal-700 text-white font-bold grid place-items-center text-sm" aria-hidden>SD</span>
          <div>
            <p className="font-semibold leading-tight">Salud Digna</p>
            <p className="text-xs text-slate-500">Agenda tu estudio en línea</p>
          </div>
          <div className="ml-auto text-sm flex items-center gap-3">
            {me.patient ? (
              <>
                <span className="text-slate-600 hidden sm:inline">Hola, {me.patient.nombre.split(" ")[0]}</span>
                <button onClick={logout} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">Salir</button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Sin cuenta: tu avance se guarda en este navegador</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 md:py-10">
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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 min-w-0">
            {editing && (
              <button onClick={() => setEditing(null)} className="text-sm text-teal-700 hover:underline mb-3">← Volver sin cambiar</button>
            )}
            {view === "ESTUDIO" && <StudyStep catalog={catalog} busy={busy} onPick={(id) => advance("ESTUDIO_ELEGIDO", { studyId: id })} />}
            {view === "CLINICA" && <ClinicStep catalog={catalog} busy={busy} onPick={(id) => advance("CLINICA_ELEGIDA", { clinicId: id })} />}
            {view === "IDENTIDAD" && <IdentityStep onVerified={load} />}
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
                {c.lastChannel !== "WEB" && (
                  <p className="text-sm text-teal-800">Confirmada desde {CHANNEL_NAME[c.lastChannel as keyof typeof CHANNEL_NAME]}, sin que repitieras tus datos.</p>
                )}
                <p className="text-sm text-slate-500">La puedes ver en la app de Salud Digna o preguntar por ella en WhatsApp o al Call Center.</p>
                <button onClick={() => setDone(null)} className="mt-2 rounded-md border border-teal-600 text-teal-700 px-4 py-2 text-sm hover:bg-teal-50">
                  Agendar otro estudio
                </button>
              </div>
            )}
          </section>

          {c && view !== "LISTO" && d.estudio && (
            <aside className="bg-white rounded-2xl border border-slate-200 p-5 h-fit lg:sticky lg:top-6">
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
      </main>
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
      <p className="text-sm text-slate-600 mt-1">Cotiza sin registrarte. Precios de demostración.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
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
      <ul className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3">
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

/** Guardar avance: teléfono + código. Si el teléfono es nuevo, pide nombre y fecha de nacimiento. */
function IdentityStep({ onVerified }: { onVerified: () => Promise<void> }) {
  const [telefono, setTelefono] = useState("");
  const [sent, setSent] = useState<{ telefono: string; demoCode: string } | null>(null);
  const [code, setCode] = useState("");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [nombre, setNombre] = useState("");
  const [fechaNac, setFechaNac] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-600/40";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.body.needsProfile) setNeedsProfile(true);
      else setError(err instanceof ApiError ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  const request = () => run(async () => setSent(await api("/api/auth/otp/request", { body: { telefono, channel: "WEB" } })));
  const verify = () =>
    run(async () => {
      await api("/api/auth/otp/verify", { body: { telefono, code, channel: "WEB", perfil: needsProfile ? { nombre, fechaNac } : undefined } });
      await onVerified();
    });

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Guarda tu avance</h1>
        <p className="text-sm text-slate-600 mt-1">
          Para apartar un horario verificamos tu teléfono. Así podrás continuar después por WhatsApp o con un asesor sin repetir nada.
        </p>
      </div>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); request(); }} className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-700">Teléfono celular (10 dígitos)</span>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" autoComplete="tel" required placeholder="667 000 0001" className={input} />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="rounded-lg bg-teal-700 text-white px-5 py-2.5 font-medium hover:bg-teal-800 disabled:opacity-60">
            {busy ? "Enviando…" : "Enviar código"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-3">
          <p className="text-sm text-slate-600">Enviamos un código a {sent.telefono}.</p>
          <p className="text-xs rounded-md bg-slate-100 text-slate-700 px-3 py-2">
            Demo sin SMS · tu código es <span className="font-mono font-semibold">{sent.demoCode}</span>
          </p>
          <label className="block text-sm">
            <span className="text-slate-700">Código de 6 dígitos</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" className={`${input} tracking-[0.4em] font-mono`} />
          </label>
          {needsProfile && (
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
              <legend className="text-sm px-1 text-slate-700">Eres nuevo: completa tu registro</legend>
              <label className="block text-sm">
                <span className="text-slate-700">Nombre completo</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="name" className={input} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Fecha de nacimiento</span>
                <input type="date" value={fechaNac} onChange={(e) => setFechaNac(e.target.value)} required autoComplete="bday" className={input} />
              </label>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3 items-center">
            <button disabled={busy} className="rounded-lg bg-teal-700 text-white px-5 py-2.5 font-medium hover:bg-teal-800 disabled:opacity-60">
              {busy ? "Verificando…" : "Verificar"}
            </button>
            <button type="button" onClick={() => { setSent(null); setCode(""); }} className="text-sm text-slate-600 hover:underline">Cambiar teléfono</button>
          </div>
        </form>
      )}
    </div>
  );
}
