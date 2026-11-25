import { formatDate, formatTime, moneyPesos, TZ } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, INTENT_LABEL, METHOD_LABEL, STEP_LABEL, SWI_EVENT_LABEL } from "@/lib/labels";

export type Ev = { seq: string; type: string; channel: string; payload: Record<string, unknown>; createdAt: string; actorId: string | null };

export const CHANNEL_STYLE: Record<string, string> = {
  WEB: "bg-sky-100 text-sky-800",
  WHATSAPP: "bg-green-100 text-green-800",
  CALL_CENTER: "bg-violet-100 text-violet-800",
  APP: "bg-orange-100 text-orange-800",
  CLINICA: "bg-rose-100 text-rose-800",
  SYSTEM: "bg-slate-100 text-slate-700",
};

function clinicMeta(p: Record<string, unknown>, extra: (string | null | undefined | false)[] = []) {
  const parts = [
    ...extra,
    typeof p.pacienteNombre === "string" && p.pacienteNombre,
    typeof p.estudio === "string" && p.estudio,
    typeof p.folio === "string" && `Folio ${p.folio}`,
    typeof p.clinica === "string" && p.clinica.replace(/^Salud Digna\s+/i, ""),
    typeof p.recepcion === "string" && `atendió ${p.recepcion}`,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : null;
}

function cardLabel(p: Record<string, unknown>) {
  const marca = typeof p.marca === "string" && p.marca ? p.marca : "Tarjeta";
  const last4 = typeof p.ultimos4 === "string" && p.ultimos4 ? ` •••• ${p.ultimos4}` : "";
  return `${marca}${last4}`;
}

export function TimelineItem({ e, className = "", style }: { e: Ev; className?: string; style?: React.CSSProperties }) {
  const p = e.payload;
  let detail: React.ReactNode = null;
  if (e.type === "MESSAGE_IN" || e.type === "MESSAGE_OUT") detail = <span className="whitespace-pre-line">{String(p.text ?? "")}</span>;
  else if (e.type === "STEP_COMPLETED") detail = `→ ${STEP_LABEL[String(p.to)]}`;
  else if (e.type === "CASE_RESUMED") detail = `${CHANNEL_LABEL[String(p.from)] ?? String(p.from)} → ${CHANNEL_LABEL[String(p.to)] ?? String(p.to)}`;
  else if (e.type === "INTENT_CLASSIFIED") detail = INTENT_LABEL[String(p.intent)] ?? String(p.intent);
  else if (e.type === "IDENTITY_VERIFIED" || e.type === "OTP_FAILED") detail = p.method ? (METHOD_LABEL[String(p.method)] ?? String(p.method)) : null;
  else if (e.type === "APPOINTMENT_CONFIRMED") {
    const folio = String((p.data as Record<string, string>)?.folio ?? p.folio ?? "");
    detail = e.channel === "CLINICA" ? <span className="text-emerald-700 font-medium">{clinicMeta(p)}</span> : `Folio ${folio}`;
  } else if (e.type === "CASE_CANCELLED") {
    const motivo = String((p.data as Record<string, string>)?.motivoCancelacion ?? p.motivo ?? "");
    detail = <span className="text-red-600 font-medium">{e.channel === "CLINICA" ? clinicMeta(p, [motivo]) : motivo || "Trámite cancelado"}</span>;
  } else if (e.type === "CONFLICT_DETECTED") {
    detail = `se esperaba v${String(p.expectedVersion)}, había v${String(p.currentVersion)}`;
  } else if (e.type === "SWI_EVENTO" && p.texto) {
    detail = <span className="whitespace-pre-line">{String(p.texto)}</span>;
  } else if (e.type === "CLINIC_CHECK_IN" || e.type === "CLINIC_PATIENT_VIEWED") detail = clinicMeta(p);
  else if (e.type === "CLINIC_RESULTS_DELIVERED") {
    detail = <span className="text-emerald-700 font-medium">{clinicMeta(p)}</span>;
  } else if (e.type === "CLINIC_APPOINTMENT_BOOKED") {
    detail = clinicMeta(p, [typeof p.fechaCita === "string" ? formatDate(p.fechaCita) : null]);
  } else if (e.type === "CLINIC_FAMILY_APPOINTMENT") {
    const fam = [p.familiarNombre, p.parentesco ? `(${String(p.parentesco).toLowerCase().replace("_", "/")})` : null].filter(Boolean).join(" ");
    detail = clinicMeta(p, [fam ? `Familiar: ${fam}` : null]);
  } else if (e.type === "CLINIC_CASE_DELETED") {
    detail = <span className="text-red-600 font-medium">{clinicMeta(p, [typeof p.motivo === "string" ? p.motivo : null])}</span>;
  } else if (e.type === "CLINIC_PAYMENT_APPROVED") {
    const monto = typeof p.monto === "number" ? moneyPesos(p.monto) : null;
    const ref = typeof p.referencia === "string" ? `Ref. ${p.referencia}` : null;
    detail = <span className="text-emerald-700 font-medium tabular-nums">{clinicMeta(p, [monto, cardLabel(p), ref])}</span>;
  } else if (e.type === "CLINIC_PAYMENT_REJECTED") {
    const monto = typeof p.monto === "number" ? moneyPesos(p.monto) : null;
    const motivo = typeof p.motivo === "string" ? p.motivo : "Tarjeta rechazada";
    detail = <span className="text-red-600 font-medium tabular-nums">{clinicMeta(p, [motivo, monto, cardLabel(p)])}</span>;
  } else if (e.type === "CLINIC_PAYMENT_PENDING") {
    const monto = typeof p.monto === "number" ? moneyPesos(p.monto) : null;
    detail = <span className="text-amber-700 font-medium tabular-nums">{clinicMeta(p, ["Pagará en clínica", monto])}</span>;
  } else if (e.type === "CLINIC_PATIENT_REGISTERED") {
    detail = clinicMeta(p, [p.accion === "ACTUALIZACION" ? "Expediente completado" : "Alta nueva"]);
  } else if (e.type === "CLINIC_REPORT_SENT") {
    detail = clinicMeta(p, [p.accion === "DESCARGADO" ? "PDF consultado" : "Reporte reenviado"]);
  } else if (e.type === "CLINIC_STAFF_LOGIN" || e.type === "CLINIC_STAFF_LOGOUT") {
    const parts = [typeof p.recepcion === "string" && p.recepcion, typeof p.clinica === "string" && p.clinica.replace(/^Salud Digna\s+/i, "")].filter(Boolean);
    detail = parts.join(" · ") || null;
  }

  // Eventos de SWI: su canal real (puede ser Clínica) y su propio nombre de evento.
  const swi = e.type === "SWI_EVENTO";
  const channel = swi ? String(p.canal) : e.channel;
  const label = swi ? (SWI_EVENT_LABEL[String(p.tipoEvento)] ?? String(p.tipoEvento)) : (EVENT_LABEL[e.type] ?? e.type);

  return (
    <li className={`text-sm border-l-2 border-slate-200 pl-3 ${className}`} style={style}>
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
