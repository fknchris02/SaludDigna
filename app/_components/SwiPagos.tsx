import { formatDate, money } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/labels";

export type Pago = {
  id: string; monto: number | null; moneda: string | null; metodo: string | null; estado: string | null;
  marca: string | null; ultimos4: string | null; referencia: string | null; canal: string | null; fecha: string;
  paciente?: string | null; estudio?: string | null;
};

// Solo APROBADO cuenta como pagado; PENDIENTE = pagará en clínica; RECHAZADO = intento fallido.
const ESTADO: Record<string, { label: string; cls: string }> = {
  APROBADO: { label: "Pagado", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  PENDIENTE: { label: "Pagará en clínica", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  RECHAZADO: { label: "Rechazado", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};
const METODO: Record<string, string> = { TARJETA: "Tarjeta", CLINICA: "En clínica" };

/** Pagos que llegan de SWI (monto en pesos). Nunca hay número de tarjeta completo: solo marca y últimos 4. */
export function SwiPagos({ pagos }: { pagos: Pago[] }) {
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {pagos.map((p) => {
        const e = ESTADO[p.estado ?? ""] ?? { label: p.estado ?? "Sin estado", cls: "bg-slate-50 text-slate-600 border-slate-200" };
        return (
          <li key={p.id} className="py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold tabular-nums">{p.monto === null ? "—" : money(Math.round(p.monto * 100))}</span>
            <span className={`text-[11px] font-semibold rounded-full border px-2 py-0.5 ${e.cls}`}>{e.label}</span>
            <span className="text-slate-600">
              {METODO[p.metodo ?? ""] ?? p.metodo ?? ""}
              {p.marca || p.ultimos4 ? ` · ${p.marca ?? "Tarjeta"} •••• ${p.ultimos4 ?? "····"}` : ""}
            </span>
            <span className="ml-auto text-xs text-slate-500 whitespace-nowrap">{CHANNEL_LABEL[p.canal ?? ""] ?? p.canal ?? ""} · {formatDate(p.fecha)}</span>
            {(p.paciente || p.estudio) && <span className="basis-full text-xs text-slate-600">{[p.paciente, p.estudio].filter(Boolean).join(" · ")}</span>}
            {p.referencia && <span className="basis-full font-mono text-[11px] text-slate-400 truncate">Ref. {p.referencia}</span>}
          </li>
        );
      })}
    </ul>
  );
}
