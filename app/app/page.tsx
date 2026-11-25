"use client";

import { useCallback, useEffect, useState } from "react";
import { BookingFlow } from "@/app/_components/BookingFlow";
import { OtpLogin } from "@/app/_components/OtpLogin";
import { SwiCitas } from "@/app/_components/SwiCitas";
import { api, ApiError } from "@/lib/client/api";
import { ago, formatDate } from "@/lib/format";
import { CHANNEL_NAME, PENDING_LABEL, STEP_LABEL } from "@/lib/labels";

type CaseT = { id: string; step: string; lastChannel: string; updatedAt: string; data: Record<string, string>; direccion?: string | null };
type Summary = { patient: { id: string; nombre: string }; active: CaseT | null; upcoming: CaseT[]; history: CaseT[]; swi?: { grupo: string }[] };

const NEXT: Record<string, string> = {
  INICIADO: "ESTUDIO_ELEGIDO",
  ESTUDIO_ELEGIDO: "CLINICA_ELEGIDA",
  CLINICA_ELEGIDA: "HORARIO_ELEGIDO",
  HORARIO_ELEGIDO: "DATOS_CONFIRMADOS",
  DATOS_CONFIRMADOS: "CITA_CONFIRMADA",
};

/** App del paciente: ve sus citas, retoma trámites de cualquier canal y agenda nuevos. */
export default function PatientApp() {
  const [summary, setSummary] = useState<Summary | null | "anon">(null);
  const [mode, setMode] = useState<"home" | "flow">("home");

  const load = useCallback(async () => {
    try {
      setSummary(await api<Summary>("/api/patient/appointments", { as: "APP" }));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setSummary("anon");
      else throw err;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
    load();
  }, [load]);

  // En vivo: lo que pase en otros canales (WhatsApp, asesor, web) aparece en el inicio sin recargar.
  const patientId = summary && summary !== "anon" ? summary.patient.id : null;
  useEffect(() => {
    if (!patientId) return;
    const es = new EventSource("/api/events?as=APP&since=latest");
    let t: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => {
      clearTimeout(t);
      t = setTimeout(load, 200);
    };
    for (const type of ["CASE_CREATED", "STEP_COMPLETED", "CASE_RESUMED", "APPOINTMENT_CONFIRMED", "CASE_CANCELLED"]) es.addEventListener(type, onEvent);
    return () => {
      clearTimeout(t);
      es.close();
    };
  }, [patientId, load]);

  async function logout() {
    await api("/api/auth/logout", { body: { scope: "APP" } });
    setMode("home");
    setSummary("anon");
  }

  return (
    <main className="min-h-screen bg-[#e7ecea] sm:grid sm:place-items-center sm:p-4">
      <div className="w-full sm:max-w-[400px] h-screen sm:h-[min(820px,calc(100vh-2rem))] bg-[#f4f7f6] sm:rounded-[2rem] sm:border-8 border-neutral-900 sm:shadow-2xl overflow-hidden flex flex-col">
        <header className="bg-teal-700 text-white px-4 pt-5 pb-4 flex items-center gap-3 shrink-0">
          {mode === "flow" ? (
            <button onClick={() => { setMode("home"); load(); }} className="text-sm rounded-md bg-white/15 px-2.5 py-1 hover:bg-white/25">← Inicio</button>
          ) : (
            <span className="w-8 h-8 rounded-full bg-white text-teal-700 font-bold grid place-items-center text-xs" aria-hidden>SD</span>
          )}
          <div className="min-w-0">
            <p className="font-semibold leading-tight truncate">
              {summary && summary !== "anon" ? `Hola, ${summary.patient.nombre.split(" ")[0]}` : "Salud Digna"}
            </p>
            <p className="text-xs text-white/80">{mode === "flow" ? "Agendar estudio" : "Mis citas"}</p>
          </div>
          {summary && summary !== "anon" && (
            <button onClick={logout} className="ml-auto text-xs rounded-md bg-white/15 px-2.5 py-1 hover:bg-white/25">Salir</button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {summary === null && <p className="text-center text-slate-500 text-sm mt-10">Cargando…</p>}
          {summary === "anon" && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <OtpLogin channel="APP" title="Inicia sesión" description="Entra con tu número de celular para ver tus citas y continuar tus trámites." onVerified={load} />
            </div>
          )}
          {summary && summary !== "anon" && mode === "flow" && <BookingFlow channel="APP" />}
          {summary && summary !== "anon" && mode === "home" && <Home s={summary} onContinue={() => setMode("flow")} />}
        </div>
      </div>
    </main>
  );
}

function Home({ s, onContinue }: { s: Summary; onContinue: () => void }) {
  const a = s.active;
  return (
    <div className="space-y-4">
      {s.upcoming.length > 0 ? (
        <section aria-label="Próximas citas" className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Tu próxima cita</h2>
          {s.upcoming.map((c) => (
            <article key={c.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-teal-50 px-4 py-3 border-b border-teal-100">
                <p className="text-xs text-teal-800 font-medium">✓ Confirmada</p>
                <p className="text-lg font-semibold text-slate-900 first-letter:uppercase">{formatDate(c.data.horario)}</p>
              </div>
              <dl className="px-4 py-3 text-sm space-y-1.5">
                <div><dt className="sr-only">Estudio</dt><dd className="font-medium">{c.data.estudio}</dd></div>
                <div><dt className="sr-only">Clínica</dt><dd>{c.data.clinica}{c.direccion ? <span className="block text-xs text-slate-500">{c.direccion}</span> : null}</dd></div>
                <div className="flex gap-2"><dt className="text-slate-500">Folio</dt><dd className="font-mono font-semibold">{c.data.folio}</dd></div>
              </dl>
              {c.data.preparacion && <p className="mx-4 mb-4 text-xs text-slate-600 bg-slate-50 rounded-md px-3 py-2">Preparación: {c.data.preparacion}</p>}
            </article>
          ))}
        </section>
      ) : (
        // Si tiene citas próximas en otros canales (SWI), se muestran abajo; no decir "no tienes citas".
        !s.swi?.some((c) => c.grupo === "PROXIMA") && <p className="text-sm text-slate-500 bg-white rounded-2xl border border-slate-200 p-4">No tienes citas próximas.</p>
      )}

      <SwiCitas as="APP" />

      {a && (
        <section className="bg-white rounded-2xl border border-amber-200 p-4 space-y-2" aria-label="Trámite en curso">
          <p className="text-xs font-medium text-amber-800">Trámite en curso</p>
          <p className="font-medium">{a.data.estudio ?? "Estudio por elegir"}{a.data.clinica ? ` · ${a.data.clinica}` : ""}</p>
          <p className="text-sm text-slate-600">
            Te falta: <strong>{PENDING_LABEL[NEXT[a.step]] ?? STEP_LABEL[a.step]}</strong>. Lo dejaste en {CHANNEL_NAME[a.lastChannel as keyof typeof CHANNEL_NAME]} {ago(a.updatedAt)}.
          </p>
          <button onClick={onContinue} className="w-full rounded-lg bg-teal-700 text-white py-2.5 font-medium hover:bg-teal-800">Continuar aquí</button>
        </section>
      )}

      {!a && (
        <button onClick={onContinue} className="w-full rounded-lg border border-teal-600 text-teal-700 bg-white py-2.5 font-medium hover:bg-teal-50">
          Agendar un estudio
        </button>
      )}

      {s.history.length > 0 && (
        <section aria-label="Historial">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Historial</h2>
          <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {s.history.map((c) => (
              <li key={c.id} className="px-4 py-3 text-sm flex items-baseline gap-2">
                <span className={c.step === "CANCELADO" ? "text-slate-400 line-through" : ""}>{c.data.estudio ?? "Sin estudio"}</span>
                <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">{c.step === "CANCELADO" ? "Cancelado" : c.data.horario ? formatDate(c.data.horario) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
