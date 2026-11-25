import { formatDate, formatTime, TZ } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, INTENT_LABEL, METHOD_LABEL, STEP_LABEL, SWI_EVENT_LABEL } from "@/lib/labels";

export type Ev = { seq: string; type: string; channel: string; payload: Record<string, unknown>; createdAt: string; actorId: string | null };

export const CHANNEL_STYLE: Record<string, string> = {
  WEB: "bg-sky-100 text-sky-800",
  WHATSAPP: "bg-green-100 text-green-800",
  CALL_CENTER: "bg-violet-100 text-violet-800",
  APP: "bg-orange-100 text-orange-800",
  SYSTEM: "bg-slate-100 text-slate-700",
  CLINICA: "bg-rose-100 text-rose-800",
};

export function TimelineItem({ e }: { e: Ev }) {
  const p = e.payload;
  let detail: React.ReactNode = null;
  if (e.type === "MESSAGE_IN" || e.type === "MESSAGE_OUT") detail = <span className="whitespace-pre-line">{String(p.text ?? "")}</span>;
  else if (e.type === "STEP_COMPLETED") detail = `→ ${STEP_LABEL[String(p.to)]}`;
  else if (e.type === "CASE_RESUMED") detail = `${CHANNEL_LABEL[String(p.from)]} → ${CHANNEL_LABEL[String(p.to)]}`;
  else if (e.type === "INTENT_CLASSIFIED") detail = INTENT_LABEL[String(p.intent)] ?? String(p.intent);
  else if (e.type === "IDENTITY_VERIFIED" || e.type === "OTP_FAILED") detail = p.method ? (METHOD_LABEL[String(p.method)] ?? String(p.method)) : null;
  else if (e.type === "APPOINTMENT_CONFIRMED") detail = `Folio ${String((p.data as Record<string, string>)?.folio ?? "")}`;
  else if (e.type === "CONFLICT_DETECTED") detail = `se esperaba v${String(p.expectedVersion)}, había v${String(p.currentVersion)}`;
  else if (e.type === "SWI_EVENTO" && p.texto) detail = <span className="whitespace-pre-line">{String(p.texto)}</span>;

  // Eventos de SWI: su canal real (puede ser Clínica) y su propio nombre de evento.
  const swi = e.type === "SWI_EVENTO";
  const channel = swi ? String(p.canal) : e.channel;
  const label = swi ? (SWI_EVENT_LABEL[String(p.tipoEvento)] ?? String(p.tipoEvento)) : (EVENT_LABEL[e.type] ?? e.type);

  return (
    <li className="text-sm border-l-2 border-slate-200 pl-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] rounded px-1.5 py-0.5 ${CHANNEL_STYLE[channel] ?? CHANNEL_STYLE.SYSTEM}`}>{CHANNEL_LABEL[channel] ?? channel}</span>
        <span className="font-medium">{label}</span>
        {swi && <span className="text-[10px] rounded border border-slate-200 px-1 text-slate-500" title="Recibido de la app SWI">SWI</span>}
        <time className="ml-auto text-xs text-slate-400 tabular-nums">{whenLabel(e.createdAt)}</time>
      </div>
      {detail && <p className={`mt-0.5 text-slate-600 ${e.type === "MESSAGE_OUT" ? "line-clamp-3" : ""}`}>{detail}</p>}
    </li>
  );
}

export function ChannelChip({ channel }: { channel: string }) {
  return <span className={`text-[11px] rounded px-1.5 py-0.5 whitespace-nowrap ${CHANNEL_STYLE[channel] ?? CHANNEL_STYLE.SYSTEM}`}>{CHANNEL_LABEL[channel] ?? channel}</span>;
}

/** Hora si es de hoy; si no, también el día (los eventos de SWI pueden ser de semanas atrás). */
function whenLabel(iso: string) {
  const sameDay = (d: Date) => d.toLocaleDateString("es-MX", { timeZone: TZ });
  return sameDay(new Date(iso)) === sameDay(new Date()) ? formatTime(iso) : formatDate(iso);
}
