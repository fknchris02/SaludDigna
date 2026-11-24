"use client";

import { useState } from "react";
import { BookingFlow, type Me } from "@/app/_components/BookingFlow";
import { api } from "@/lib/client/api";

export default function PatientWeb() {
  const [patient, setPatient] = useState<Me["patient"]>(null);
  const [session, setSession] = useState(0); // al cerrar sesión se reinicia el flujo con un visitante nuevo

  async function logout() {
    await api("/api/auth/logout", { body: { scope: "WEB" } });
    setPatient(null);
    setSession((n) => n + 1);
  }

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
            {patient ? (
              <>
                <span className="text-slate-600 hidden sm:inline">Hola, {patient.nombre.split(" ")[0]}</span>
                <button onClick={logout} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">Salir</button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Sin cuenta: tu avance se guarda en este navegador</span>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 md:py-10">
        <BookingFlow key={session} channel="WEB" onMe={(m) => setPatient(m.patient)} />
      </main>
    </div>
  );
}
