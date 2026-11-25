"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { formatDate } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/labels";

type SwiCita = {
  id: string;
  folio: string;
  folioExterno: string | null;
  estudio: string | null;
  preparacion: string | null;
  clinica: string | null;
  direccion: string | null;
  fechaCita: string | null;
  estado: string | null;
  canalOrigen: string | null;
  canalActual: string | null;
  grupo: "PROXIMA" | "A_MEDIAS" | "PASADA" | "CANCELADA";
};

const canal = (c: string | null) => (c ? CHANNEL_LABEL[c] ?? c : "otro canal");

/**
 * Citas que la paciente hizo en los canales de SWI (WhatsApp, Web, Call Center, App o Clínica), ligadas por su teléfono.
 * Se muestran como sus citas; SWI es el dueño de esos trámites, así que aquí no se editan. Se actualizan en vivo.
 */
export function SwiCitas({ as }: { as: "APP" | "WEB" }) {
  const [citas, setCitas] = useState<SwiCita[] | null>(null);

  const load = useCallback(() => {
    api<{ swi?: SwiCita[] }>("/api/patient/appointments", { as })
      .then((r) => setCitas(r.swi ?? []))
      .catch(() => setCitas([])); // sin sesión o sin conexión: no se muestra la sección
  }, [as]);

  useEffect(() => {
    load();
    const es = new EventSource(`/api/events?as=${as}&since=latest`);
    let t: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener("SWI_EVENTO", () => {
      clearTimeout(t);
      t = setTimeout(load, 300);
    });
    return () => {
      clearTimeout(t);
      es.close();
    };
  }, [as, load]);

  if (!citas?.length) return null;
  const proximas = citas.filter((c) => c.grupo === "PROXIMA").sort((a, b) => (a.fechaCita ?? "").localeCompare(b.fechaCita ?? ""));
  const aMedias = citas.filter((c) => c.grupo === "A_MEDIAS");
  const cerradas = citas.filter((c) => c.grupo === "PASADA" || c.grupo === "CANCELADA");

  return (
    <section aria-label="Citas de otros canales" className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Tus citas en otros canales de Salud Digna</h2>

      {proximas.map((c) => (
        <article key={c.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="bg-teal-50 px-4 py-3 border-b border-teal-100">
            <p className="text-xs text-teal-800 font-medium">
              ✓ {c.estado === "CONFIRMADO" ? "Confirmada" : "Agendada"} en {canal(c.canalOrigen)}
            </p>
            <p className="text-lg font-semibold text-slate-900 first-letter:uppercase">{c.fechaCita ? formatDate(c.fechaCita) : "Fecha por confirmar"}</p>
          </div>
          <dl className="px-4 py-3 text-sm space-y-1.5">
            <div><dt className="sr-only">Estudio</dt><dd className="font-medium">{c.estudio ?? "Estudio"}</dd></div>
            {c.clinica && <div><dt className="sr-only">Clínica</dt><dd>{c.clinica}{c.direccion && <span className="block text-xs text-slate-500">{c.direccion}</span>}</dd></div>}
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-500">Folio</dt>
              <dd className="font-mono font-semibold">{c.folio}{c.folioExterno && <span className="font-normal text-slate-500"> · {c.folioExterno}</span>}</dd>
            </div>
          </dl>
          {c.preparacion && <p className="mx-4 mb-4 text-xs text-slate-600 bg-slate-50 rounded-md px-3 py-2">Preparación: {c.preparacion}</p>}
        </article>
      ))}

      {aMedias.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 divide-y divide-amber-100">
          <p className="px-4 pt-3 pb-2 text-xs font-medium text-amber-800">A medias</p>
          {aMedias.map((c) => (
            <div key={c.id} className="px-4 py-3 text-sm">
              <p className="font-medium">{c.estudio ?? "Cotización sin estudio"}{c.clinica ? ` · ${c.clinica}` : ""}</p>
              <p className="text-xs text-slate-600">
                {c.estado === "ABANDONADO" ? "La dejaste" : "Va en curso"} en {canal(c.canalActual ?? c.canalOrigen)}. Continúa por ese canal o llama al Call Center.
              </p>
            </div>
          ))}
        </div>
      )}

      {cerradas.length > 0 && (
        <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {cerradas.map((c) => (
            <li key={c.id} className="px-4 py-3 text-sm flex items-baseline gap-2">
              <span className={c.grupo === "CANCELADA" ? "text-slate-400 line-through" : ""}>{c.estudio ?? "Estudio"}</span>
              <span className="text-xs text-slate-400">{canal(c.canalOrigen)}</span>
              <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">{c.grupo === "CANCELADA" ? "Cancelada" : c.fechaCita ? formatDate(c.fechaCita) : "Realizada"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
