"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { PatientPanel } from "./PatientPanel";

type Staff = { nombre: string; role: "ASESOR" | "ADMIN" };
type Result = { id: string; nombre: string; telefono: string; tramitePendiente: boolean };

export default function AdvisorConsole() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Result | null>(null);

  useEffect(() => {
    api<{ staff: Staff }>("/api/auth/me", { as: "CALL_CENTER" })
      .then((r) => setStaff(r.staff))
      .catch(() => router.replace("/asesor/login"));
  }, [router]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const r = await api<{ results: Result[] }>(`/api/staff/patients?q=${encodeURIComponent(q)}`, { as: "CALL_CENTER" });
    setResults(r.results);
    setSearched(true);
  }

  async function logout() {
    await api("/api/auth/logout", { body: { scope: "STAFF" } });
    router.replace("/asesor/login");
  }

  if (!staff) return <main className="min-h-screen grid place-items-center text-slate-500">Cargando…</main>;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 h-14 flex items-center gap-4 shrink-0">
        <p className="font-semibold">
          <span className="text-teal-700">Salud Digna</span> · Consola de asesor
        </p>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-slate-600 hidden sm:inline">
            {staff.nombre} · {staff.role === "ADMIN" ? "Administrador" : "Asesor"}
          </span>
          <button onClick={logout} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">Salir</button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <aside className="lg:w-80 shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-3">
          <form onSubmit={search} className="space-y-2">
            <label htmlFor="q" className="text-sm font-medium text-slate-700">Buscar paciente</label>
            <div className="flex gap-2">
              <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Teléfono o nombre"
                className="flex-1 min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/40" />
              <button className="rounded-md bg-teal-700 text-white px-3 text-sm font-medium hover:bg-teal-800">Buscar</button>
            </div>
            <p className="text-xs text-slate-500">Mínimo 4 dígitos o 3 letras. Los datos se muestran ocultos hasta validar.</p>
          </form>

          <ul className="space-y-1">
            {results.map((r) => (
              <li key={r.id}>
                <button onClick={() => setSelected(r)}
                  className={`w-full text-left rounded-md px-3 py-2 border ${selected?.id === r.id ? "border-teal-600 bg-teal-50" : "border-transparent hover:bg-slate-50"}`}>
                  <span className="block font-medium">{r.nombre}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {r.telefono}
                    {r.tramitePendiente && <span className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">Trámite pendiente</span>}
                  </span>
                </button>
              </li>
            ))}
            {searched && results.length === 0 && <li className="text-sm text-slate-500 px-1">Sin resultados.</li>}
          </ul>
        </aside>

        <main className="flex-1 min-w-0 p-4 md:p-6">
          {selected ? (
            <Selected key={selected.id} result={selected} />
          ) : (
            <div className="h-full grid place-items-center text-slate-500 text-sm">Busca al paciente que está en la llamada.</div>
          )}
        </main>
      </div>
    </div>
  );
}

/** Si el asesor ya validó a este paciente (o es admin) muestra el expediente; si no, pide los 2 datos. */
function Selected({ result }: { result: Result }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");

  useEffect(() => {
    api(`/api/staff/patients/${result.id}`, { as: "CALL_CENTER" })
      .then(() => setState("open"))
      .catch(() => setState("locked"));
  }, [result.id]);

  if (state === "checking") return <p className="text-slate-500 text-sm">Cargando…</p>;
  if (state === "open") return <PatientPanel patientId={result.id} />;
  return <VerifyForm result={result} onVerified={() => setState("open")} />;
}

function VerifyForm({ result, onVerified }: { result: Result; onVerified: () => void }) {
  const [fechaNac, setFechaNac] = useState("");
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/staff/patients/${result.id}/verify`, { as: "CALL_CENTER", body: { fechaNac, last4 } });
      onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Validar identidad</h2>
        <p className="text-sm text-slate-600 mt-1">
          <span className="font-medium">{result.nombre}</span> · {result.telefono}
        </p>
        <p className="text-sm text-slate-600 mt-2">Pide al paciente su fecha de nacimiento y los últimos 4 dígitos de su teléfono.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-slate-700">Fecha de nacimiento</span>
          <input type="date" required value={fechaNac} onChange={(e) => setFechaNac(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" />
        </label>
        <label className="text-sm">
          <span className="text-slate-700">Últimos 4 dígitos</span>
          <input required inputMode="numeric" pattern="\d{4}" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 tracking-widest" />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="rounded-md bg-teal-700 text-white px-4 py-2 font-medium hover:bg-teal-800 disabled:opacity-60">
        {busy ? "Validando…" : "Validar"}
      </button>
    </form>
  );
}
