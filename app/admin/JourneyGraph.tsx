"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Ev } from "@/app/_components/Timeline";
import type { Pago } from "@/app/_components/SwiPagos";
import { ago, formatDate, formatTime, money, moneyPesos, TZ } from "@/lib/format";
import { CHANNEL_LABEL, EVENT_LABEL, INTENT_LABEL, PENDING_LABEL, STEP_LABEL, STEPS, SWI_EVENT_LABEL } from "@/lib/labels";

export type CaseDetail = {
  case: { id: string; step: string; data: Record<string, string>; version: number; lastChannel: string; updatedAt: string };
  pending: string | null;
  timeline: Ev[];
  actors: Record<string, { nombre: string; role: string }>;
  payments?: Pago[]; // solo trámites de SWI
};
export type JourneyStatus = "ACTIVO" | "PAUSADO" | "CONFIRMADO" | "CANCELADO";

// Carriles del mapa: un canal por fila (mismos colores que los chips de canal del resto de la app).
// CLINICA la usan los recorridos que llegan de SWI / WEB-CLINICA (recepción, check-in, resultados).
const LANES = ["WEB", "WHATSAPP", "CALL_CENTER", "APP", "CLINICA"] as const;
export const CHANNEL_VISUAL: Record<string, { dot: string; text: string; hex: string }> = {
  WEB: { dot: "bg-sky-500 shadow-sky-500/30", text: "text-sky-700", hex: "#0ea5e9" },
  WHATSAPP: { dot: "bg-emerald-500 shadow-emerald-500/30", text: "text-emerald-700", hex: "#10b981" },
  CALL_CENTER: { dot: "bg-violet-600 shadow-violet-500/30", text: "text-violet-700", hex: "#7c3aed" },
  APP: { dot: "bg-orange-500 shadow-orange-500/30", text: "text-orange-700", hex: "#f97316" },
  CLINICA: { dot: "bg-rose-500 shadow-rose-500/30", text: "text-rose-700", hex: "#f43f5e" },
};

// Margen arriba y abajo de media tarjeta grande (~200 px de alto) para que la del primer y último carril no se corte.
const LANE_Y0 = 125;
const LANE_GAP = 100;
const X0 = 150;
const X_STEP = 260;
const W = { card: 224, pill: 240, hero: 240 } as const;

type Node = {
  key: string;
  kind: keyof typeof W;
  channel: string;
  lane: number;
  title: string;
  subtitle?: string;
  meta?: string;
  time?: string;
  tone?: "danger" | "warning" | "ok" | "pending";
  badge?: string;
  ev?: Ev; // el evento real detrás del nodo (el "Falta" no tiene)
};

/** Eventos reales del trámite → nodos del mapa. Lo que el sistema no registra no se dibuja. */
function buildNodes(d: CaseDetail, status: JourneyStatus): Node[] {
  const nodes: Node[] = [];
  const by = (e: Ev) => {
    if (e.actorId && d.actors[e.actorId]) return `por ${d.actors[e.actorId].nombre}`;
    const rec = (e.payload as Record<string, unknown>)?.recepcion;
    return typeof rec === "string" && rec ? `por ${rec}` : undefined;
  };
  for (const e of d.timeline) {
    const p = e.payload as Record<string, unknown>;
    const data = (p.data ?? {}) as Record<string, string | number>;
    const channel = e.type === "SWI_EVENTO" ? String(p.canal ?? "WEB") : e.channel; // en SWI el canal real va en el payload
    const base = { key: e.seq, ev: e, channel, lane: Math.max(0, LANES.indexOf(channel as (typeof LANES)[number])), time: shortWhen(e.createdAt) };
    if (e.type === "CASE_CREATED") nodes.push({ ...base, kind: "card", title: "Inició un trámite", subtitle: "Cotización de estudio", meta: by(e) });
    else if (e.type === "STEP_COMPLETED") {
      const to = String(p.to);
      const back = STEPS.indexOf(to as (typeof STEPS)[number]) <= STEPS.indexOf(String(p.from) as (typeof STEPS)[number]);
      const sub =
        to === "ESTUDIO_ELEGIDO" ? `${data.estudio} · ${money(Number(data.precio))}`
        : to === "CLINICA_ELEGIDA" ? String(data.clinica)
        : to === "HORARIO_ELEGIDO" ? formatDate(String(data.horario))
        : "Datos del paciente verificados";
      const title = to === "DATOS_CONFIRMADOS" ? "Confirmó sus datos" : `${back ? "Cambió" : "Eligió"} ${STEP_LABEL[to].toLowerCase()}`;
      nodes.push({ ...base, kind: "card", title, subtitle: sub, meta: by(e) });
    } else if (e.type === "APPOINTMENT_CONFIRMED")
      nodes.push({ ...base, kind: "hero", tone: "ok", title: String(data.estudio ?? p.estudio ?? "Cita confirmada"), subtitle: `${data.clinica ?? p.clinica ?? ""} · ${data.horario ? formatDate(String(data.horario)) : ""}`.replace(/^\s*·\s*|\s*·\s*$/g, ""), badge: `Folio ${data.folio ?? p.folio ?? ""}`, meta: by(e) });
    else if (e.type === "CASE_CANCELLED") nodes.push({ ...base, kind: "card", tone: "danger", title: "Trámite cancelado", subtitle: String(data.motivoCancelacion ?? p.motivo ?? "Sin motivo registrado"), meta: by(e) });
    else if (e.type === "INTENT_CLASSIFIED") {
      const intent = String(p.intent);
      const label = intent === "HABLAR_ASESOR" ? "Pidió hablar con un asesor" : intent === "ELEGIR_OPCION" ? "Eligió con sus palabras (IA)" : `Preguntó por ${INTENT_LABEL[intent] ?? intent}`;
      nodes.push({ ...base, kind: "pill", title: label, tone: p.source === "llm" ? "ok" : undefined });
    }
    // La consulta del asesor es parte de la atención; el monitoreo del admin solo va a la auditoría, no al recorrido.
    else if (e.type === "ADVISOR_OPENED_CASE" && p.role !== "ADMIN") nodes.push({ ...base, kind: "pill", title: "Consulta del asesor", meta: by(e)?.replace("por ", "") });
    else if (e.type === "CONFLICT_DETECTED") nodes.push({ ...base, kind: "pill", tone: "warning", title: "Edición simultánea bloqueada" });
    else if (e.type === "SWI_EVENTO") {
      const tipo = String(p.tipoEvento ?? "");
      const c = d.case.data;
      if (tipo === "CITA_CONFIRMADA")
        nodes.push({ ...base, kind: "hero", tone: "ok", title: c.estudio || "Cita", subtitle: [c.clinica, c.horario && formatDate(c.horario)].filter(Boolean).join(" · "), badge: c.folio ? `Folio ${c.folio}` : "SWI" });
      else nodes.push({ ...base, kind: "card", title: SWI_EVENT_LABEL[tipo] ?? tipo, subtitle: p.texto ? String(p.texto) : undefined, tone: SWI_DANGER.has(tipo) ? "danger" : undefined });
    } else if (e.type === "CLINIC_CHECK_IN") nodes.push({ ...base, kind: "card", title: "Llegada a clínica", subtitle: String(p.clinica ?? p.estudio ?? "Check-in registrado"), meta: by(e) });
    else if (e.type === "CLINIC_APPOINTMENT_BOOKED") nodes.push({ ...base, kind: "card", title: "Cita en mostrador", subtitle: [p.estudio, p.clinica].filter(Boolean).join(" · ") || "Agendada en clínica", meta: by(e) });
    else if (e.type === "CLINIC_PAYMENT_APPROVED")
      nodes.push({ ...base, kind: "card", title: "Pago aprobado", subtitle: [typeof p.monto === "number" ? moneyPesos(p.monto) : null, p.ultimos4 ? `•••• ${p.ultimos4}` : null].filter(Boolean).join(" · ") || "Cobro en clínica", meta: by(e) });
    else if (e.type === "CLINIC_PAYMENT_REJECTED") nodes.push({ ...base, kind: "card", tone: "danger", title: "Pago rechazado", subtitle: String(p.motivo ?? "Tarjeta rechazada"), meta: by(e) });
    else if (e.type === "CLINIC_PAYMENT_PENDING") nodes.push({ ...base, kind: "pill", tone: "warning", title: "Pagará en clínica", meta: by(e)?.replace("por ", "") });
    else if (e.type === "CLINIC_RESULTS_DELIVERED") nodes.push({ ...base, kind: "card", title: "Resultados entregados", subtitle: String(p.estudio ?? p.clinica ?? "Entrega en clínica"), meta: by(e) });
    else if (e.type === "CLINIC_FAMILY_APPOINTMENT") nodes.push({ ...base, kind: "card", title: "Cita para familiar", subtitle: [p.familiarNombre, p.estudio].filter(Boolean).join(" · ") || "Familiar registrado", meta: by(e) });
    else if (e.type === "CLINIC_CASE_DELETED") nodes.push({ ...base, kind: "card", tone: "danger", title: "Trámite eliminado", subtitle: String(p.motivo ?? "Eliminado en mostrador"), meta: by(e) });
    else if (e.type === "CLINIC_REPORT_SENT") nodes.push({ ...base, kind: "pill", title: p.accion === "DESCARGADO" ? "PDF consultado" : "Reporte reenviado", meta: by(e)?.replace("por ", "") });
  }
  // Lo que falta: en el carril del último canal. Si está pausado, como el "abortado" del diseño.
  if (status === "ACTIVO" || status === "PAUSADO") {
    const lane = Math.max(0, LANES.indexOf(d.case.lastChannel as (typeof LANES)[number]));
    nodes.push({
      key: "pending",
      kind: "hero",
      channel: d.case.lastChannel,
      lane,
      tone: status === "PAUSADO" ? "danger" : "pending",
      title: `Falta: ${PENDING_LABEL[d.pending ?? ""] ?? "continuar"}`,
      subtitle: status === "PAUSADO" ? `Sin actividad desde ${ago(d.case.updatedAt)}` : "El paciente está en proceso",
      badge: status === "PAUSADO" ? "Pausado" : "En curso",
    });
  }
  return nodes;
}

const SWI_DANGER = new Set(["CITA_CANCELADA", "TRAMITE_ABANDONADO", "TRAMITE_ELIMINADO", "PAGO_RECHAZADO"]);

/** Hora si es de hoy; si no, día y hora (los recorridos de SWI pueden ser de semanas atrás). */
function shortWhen(iso: string) {
  const day = (x: Date) => x.toLocaleDateString("es-MX", { timeZone: TZ });
  const date = new Date(iso);
  const time = formatTime(iso).slice(0, 5);
  return day(date) === day(new Date()) ? time : `${date.toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "short" })} ${time}`;
}

const pos = (i: number, n: Node) => ({ x: X0 + i * X_STEP, y: LANE_Y0 + n.lane * LANE_GAP });

export function JourneyGraph({ detail, status }: { detail: CaseDetail; status: JourneyStatus }) {
  const nodes = useMemo(() => buildNodes(detail, status), [detail, status]);
  const [shown, setShown] = useState<number | null>(null); // null = todo visible; número = reproducción en curso
  const playing = shown !== null && shown < nodes.length;
  const viewport = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Nota abierta: ligada al trámite, así al cambiar de recorrido se cierra sola.
  const [note, setNote] = useState<{ caseId: string; key: string } | null>(null);
  const openKey = note?.caseId === detail.case.id ? note.key : null;

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNote(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openKey]);

  // Al abrir un recorrido, mostrar el final (lo más reciente).
  useEffect(() => {
    viewport.current?.scrollTo({ left: viewport.current.scrollWidth });
  }, [detail.case.id]);

  // Reproducción: revela un nodo cada 700 ms y lo centra en pantalla.
  useEffect(() => {
    if (shown === null) return;
    nodeRefs.current[shown - 1]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    if (shown >= nodes.length) return;
    const t = setTimeout(() => setShown(shown + 1), 700);
    return () => clearTimeout(t);
  }, [shown, nodes.length]);

  const visible = shown ?? nodes.length;
  const width = X0 + Math.max(nodes.length, 1) * X_STEP + 40;
  const height = LANE_Y0 * 2 + (LANES.length - 1) * LANE_GAP;

  return (
    <div className="h-full flex flex-col">
      <div ref={viewport} className="overflow-auto flex-1 min-h-0" data-purpose="journey-graph-area">
        <div className="relative" style={{ width, height }} onClick={(e) => !(e.target as HTMLElement).closest("[data-node]") && setNote(null)}>
          {/* Carriles */}
          {LANES.map((l, i) => (
            <div key={l} className="absolute left-0 right-0 flex items-center" style={{ top: LANE_Y0 + i * LANE_GAP - 12 }}>
              <span className="w-[120px] pl-6 text-[11px] font-bold uppercase tracking-wider text-slate-300">{CHANNEL_LABEL[l]}</span>
              <span className="flex-1 border-t border-dashed border-slate-200/70" />
            </div>
          ))}

          {/* Conexiones (curvas Bézier entre nodos consecutivos) */}
          <svg className="absolute inset-0 pointer-events-none" width={width} height={height} aria-hidden>
            <defs>
              <linearGradient id="lineGrad" x1="0%" x2="100%">
                <stop offset="0%" stopColor="#0066FF" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#3B82F6" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#0066FF" stopOpacity="0.8" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" floodColor="#0066FF" floodOpacity="0.25" stdDeviation="3" />
              </filter>
            </defs>
            {nodes.slice(1).map((n, k) => {
              const i = k + 1;
              const a = pos(i - 1, nodes[i - 1]);
              const b = pos(i, n);
              const x1 = a.x + W[nodes[i - 1].kind];
              const dx = (b.x - x1) / 2;
              const paused = n.key === "pending" && n.tone === "danger";
              return (
                <path
                  key={n.key}
                  d={`M ${x1} ${a.y} C ${x1 + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`}
                  fill="none"
                  stroke={paused ? "#F87171" : n.key === "pending" ? "#93C5FD" : "url(#lineGrad)"}
                  strokeWidth={paused || n.key === "pending" ? 2.5 : 3}
                  strokeDasharray={n.key === "pending" ? "6 6" : undefined}
                  strokeLinecap="round"
                  filter={n.key === "pending" ? undefined : "url(#glow)"}
                  className="transition-opacity duration-500"
                  opacity={i < visible ? 1 : 0}
                />
              );
            })}
          </svg>

          {/* Nodos */}
          {nodes.map((n, i) => {
            const p = pos(i, n);
            const open = openKey === n.key;
            return (
              <div
                key={n.key}
                data-node
                ref={(el) => {
                  nodeRefs.current[i] = el;
                }}
                className={`absolute omni-node transition-all duration-500 ${open ? "z-30" : ""} ${i < visible ? "opacity-100" : "opacity-0 translate-y-2 pointer-events-none"}`}
                style={{ left: p.x, top: p.y, width: W[n.kind], transform: "translateY(-50%)" }}
              >
                <button
                  type="button"
                  onClick={() => setNote(open ? null : { caseId: detail.case.id, key: n.key })}
                  aria-expanded={open}
                  aria-controls={open ? "event-note" : undefined}
                  title="Ver nota del evento"
                  className={`block w-full text-left rounded-[28px] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sd-blue ${open ? "ring-2 ring-sd-blue/40" : ""}`}
                >
                  <NodeView n={n} />
                </button>
                {open && (
                  // Carriles de arriba: la nota abre hacia abajo; los de abajo, hacia arriba. El último nodo la alinea a la derecha.
                  <EventNote n={n} note={noteFor(n, detail, status)} below={n.lane <= 2} alignRight={i > 0 && i === nodes.length - 1} onClose={() => setNote(null)} />
                )}
              </div>
            );
          })}
          {nodes.length === 0 && <p className="absolute left-[150px] top-[60px] text-sm text-slate-400">Sin eventos en este trámite.</p>}
        </div>
      </div>

      {/* Control: minimapa + reproducir, debajo del mapa para no tapar el último carril */}
      <div className="self-center my-3 shrink-0 z-40 bg-sd-dark/90 backdrop-blur-xl border border-white/10 rounded-3xl p-2.5 shadow-2xl flex items-center gap-3 text-white">
        <MiniMap nodes={nodes} visible={visible} />
        <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
          <button
            onClick={() => setShown(playing ? null : 1)}
            className="w-10 h-10 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-lg hover:bg-slate-200 transition-colors"
            aria-label={playing ? "Detener reproducción" : "Reproducir el recorrido"}
            title={playing ? "Detener" : "Reproducir el recorrido paso a paso"}
          >
            {playing ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button
            onClick={() => {
              setShown(null);
              viewport.current?.scrollTo({ left: viewport.current.scrollWidth, behavior: "smooth" });
            }}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            aria-label="Ir al paso más reciente"
            title="Ir al paso más reciente"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden><path d="M13 5l7 7-7 7M5 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <p className="hidden sm:block border-l border-white/10 pl-3 pr-2 text-[11px] leading-tight text-white/60">Clic en un evento<br />para ver su nota</p>
      </div>
    </div>
  );
}

function MiniMap({ nodes, visible }: { nodes: Node[]; visible: number }) {
  const n = Math.max(nodes.length - 1, 1);
  const pt = (i: number, node: Node) => ({ x: 6 + (i / n) * 88, y: 6 + node.lane * 7 });
  const pct = nodes.length ? Math.round((100 * Math.min(visible, nodes.length)) / nodes.length) : 0;
  return (
    <div className="w-44 h-14 bg-slate-900/80 rounded-2xl p-1.5 relative overflow-hidden border border-white/5" aria-hidden>
      <svg className="w-full h-full" viewBox="0 0 100 40">
        <polyline points={nodes.map((node, i) => `${pt(i, node).x},${pt(i, node).y}`).join(" ")} fill="none" stroke="#0066FF" strokeWidth="1.5" opacity="0.7" />
        {nodes.map((node, i) => (
          <circle key={node.key} {...{ cx: pt(i, node).x, cy: pt(i, node).y }} r={node.kind === "hero" ? 3.2 : 2.4}
            fill={i < visible ? (node.tone === "danger" ? "#F87171" : CHANNEL_VISUAL[node.channel]?.hex ?? "#fff") : "#334155"} />
        ))}
      </svg>
      <span className="absolute bottom-0.5 right-2 text-[8px] font-mono text-slate-400">Ruta {pct}%</span>
    </div>
  );
}

function ChannelIcon({ channel, className = "w-5 h-5" }: { channel: string; className?: string }) {
  if (channel === "WHATSAPP")
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.83 9.83 0 001.746 5.634l-.999 3.648 3.742-.981z" />
      </svg>
    );
  const d =
    channel === "CALL_CENTER" ? "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
    : channel === "APP" ? "M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
    : channel === "CLINICA" ? "M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M12 8v4M10 10h4"
    : "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9";
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NodeView({ n }: { n: Node }) {
  const v = CHANNEL_VISUAL[n.channel] ?? CHANNEL_VISUAL.WEB;
  if (n.kind === "pill") {
    const dot = n.tone === "warning" ? "bg-amber-500" : n.tone === "ok" ? "bg-violet-500" : "bg-emerald-500";
    return (
      <div className="bg-white/90 backdrop-blur rounded-full px-4 py-2 shadow-soft-card border border-slate-200/70 flex items-center gap-2.5">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} aria-hidden />
        <span className="text-xs font-bold text-slate-800 truncate">{n.title}</span>
        <span className="ml-auto text-[10px] text-slate-400 font-mono shrink-0">{n.meta ?? n.time}</span>
      </div>
    );
  }
  if (n.kind === "hero" && n.tone === "ok") {
    return (
      <div className="bg-sd-blue text-white p-5 rounded-[28px] shadow-xl">
        <div className="flex items-center justify-between">
          <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center" aria-hidden>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="text-[10px] font-bold bg-white/20 px-2.5 py-1 rounded-full uppercase tracking-wider">Cita confirmada</span>
        </div>
        <h3 className="text-lg font-bold mt-4 leading-tight">{n.title}</h3>
        {n.subtitle && <p className="text-xs text-blue-100 mt-1">{n.subtitle}</p>}
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/20 text-[11px]">
          <span className="font-mono font-bold">{n.badge}</span>
          <span className="text-blue-100">{CHANNEL_LABEL[n.channel]} · {n.time}</span>
        </div>
      </div>
    );
  }
  if (n.kind === "hero") {
    const danger = n.tone === "danger";
    return (
      <div className={`bg-white rounded-2xl p-4 shadow-soft-card relative overflow-hidden ${danger ? "border-2 border-red-200/80" : "border-2 border-dashed border-blue-200"}`}>
        <span className={`absolute top-0 right-0 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-bl-lg ${danger ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
          {danger ? "⏸ " : "● "}{n.badge}
        </span>
        <span className={`text-[10px] font-bold uppercase ${v.text}`}>{CHANNEL_LABEL[n.channel]}</span>
        <h5 className="text-sm font-bold text-slate-900 mt-0.5">{n.title}</h5>
        <p className={`text-[11px] font-medium mt-1 ${danger ? "text-red-600" : "text-slate-500"}`}>{n.subtitle}</p>
      </div>
    );
  }
  return (
    <div className={`bg-white rounded-2xl p-3.5 shadow-soft-card border flex items-center gap-3 ${n.tone === "danger" ? "border-red-200" : "border-slate-100"}`}>
      <span className={`w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 shadow-md ${n.tone === "danger" ? "bg-red-500" : v.dot}`}>
        <ChannelIcon channel={n.channel} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-[10px] font-bold uppercase ${v.text}`}>{CHANNEL_LABEL[n.channel]}</span>
          <span className="text-[10px] text-slate-400 font-mono">{n.time}</span>
        </div>
        <h5 className="text-xs font-bold text-slate-800 truncate">{n.title}</h5>
        {n.subtitle && <p className="text-[10px] text-slate-500 truncate">{n.subtitle}</p>}
        {n.meta && <p className="text-[10px] text-violet-600 truncate">{n.meta}</p>}
      </div>
    </div>
  );
}

// ---------- Nota informativa de un evento ----------

/** Qué significa cada evento propio, en palabras del admin. */
const EXPLAIN: Record<string, string> = {
  CASE_CREATED: "El paciente abrió un trámite nuevo. Desde aquí cualquier canal puede continuarlo sin pedirle los datos otra vez.",
  STEP_COMPLETED: "Se guardó un paso del trámite. El cambio queda visible al instante en todos los canales.",
  APPOINTMENT_CONFIRMED: "La cita quedó confirmada y se generó su folio. El paciente la ve en la app y en WhatsApp.",
  CASE_CANCELLED: "El trámite se canceló. Ningún canal puede seguir avanzándolo.",
  INTENT_CLASSIFIED: "El sistema interpretó lo que escribió el paciente y actuó en consecuencia.",
  ADVISOR_OPENED_CASE: "Un asesor abrió el expediente para atenderlo. El acceso queda en la auditoría.",
  CONFLICT_DETECTED: "Dos canales intentaron cambiar el trámite al mismo tiempo. Se bloqueó el cambio desactualizado para no perder datos.",
};

/** Lo mismo para los eventos que llegan de SWI (su tipoEvento). */
const SWI_EXPLAIN: Record<string, string> = {
  PACIENTE_REGISTRADO: "Se registró al paciente en SWI.",
  COTIZACION_INICIADA: "El paciente empezó a cotizar un estudio.",
  ESTUDIO_SELECCIONADO: "El paciente eligió el estudio que se va a hacer.",
  CLINICA_SELECCIONADA: "Se eligió la clínica donde será la cita.",
  FECHA_SELECCIONADA: "Se eligió la fecha y hora de la cita.",
  DATOS_CAPTURADOS: "Se capturaron los datos del paciente para la cita.",
  CITA_AGENDADA: "La cita quedó agendada.",
  CITA_CONFIRMADA: "La cita quedó confirmada.",
  CITA_CANCELADA: "La cita se canceló.",
  CITA_VISUALIZADA: "El paciente revisó su cita en la app.",
  CITA_PARA_FAMILIAR: "El paciente agendó una cita para un familiar.",
  TRAMITE_ABANDONADO: "El paciente dejó el trámite sin terminar. Es candidato a recuperar.",
  TRAMITE_RETOMADO: "El paciente retomó un trámite que había dejado.",
  TRAMITE_ELIMINADO: "Se eliminó el trámite. Ya no cuenta en el tablero, pero su historial se conserva.",
  LLAMADA_RECIBIDA: "El paciente llamó al Call Center.",
  TRANSFERENCIA_ASESOR: "La conversación pasó a un asesor.",
  NOTA_ASESOR: "Un asesor dejó una nota en el expediente.",
  CONTEXTO_CONSULTADO: "Un asesor consultó el expediente del paciente.",
  MENSAJE_RECIBIDO: "Mensaje que escribió el paciente.",
  MENSAJE_ENVIADO: "Mensaje que se le envió al paciente.",
  CORREO_ENVIADO: "Se le envió un correo al paciente.",
  PAGO_EN_CLINICA: "El paciente pagará al llegar a la clínica.",
  PAGO_APROBADO: "El pago se aprobó.",
  PAGO_RECHAZADO: "El pago fue rechazado.",
  CHECK_IN: "El paciente llegó a la clínica y registró su llegada.",
  RESULTADOS_ENTREGADOS: "Se entregaron los resultados del estudio.",
  REPORTE_ENVIADO: "Se envió al paciente el reporte de su consulta. El PDF vive en SWI; aquí solo se guardan los datos.",
};

type Note = { kicker: string; title: string; explain: string; rows: [string, string][] };

function noteFor(n: Node, d: CaseDetail, status: JourneyStatus): Note {
  const channel = CHANNEL_LABEL[n.channel] ?? n.channel;
  const e = n.ev;
  if (!e) {
    // El nodo "Falta…": no es un evento, es lo que el paciente aún no hace.
    const paused = status === "PAUSADO";
    return {
      kicker: paused ? "Pausado" : "En curso",
      title: n.title,
      explain: paused
        ? "El paciente dejó el trámite en este paso y lleva más de 10 minutos sin actividad. Es candidato a recuperar por WhatsApp o Call Center."
        : "El paciente está en este paso ahora mismo.",
      rows: [["Último canal", channel], ["Última actividad", `${formatDate(d.case.updatedAt)} · ${ago(d.case.updatedAt)}`]],
    };
  }
  const p = e.payload as Record<string, unknown>;
  const data = (p.data ?? {}) as Record<string, string | number>;
  const swi = e.type === "SWI_EVENTO";
  const tipo = String(p.tipoEvento ?? "");
  const staff = e.actorId ? d.actors[e.actorId] : null;
  const who = staff
    ? `${staff.nombre} (${staff.role === "ADMIN" ? "admin" : "asesor"})`
    : swi ? "Registrado por SWI"
    : e.type === "INTENT_CLASSIFIED" || e.type === "CONFLICT_DETECTED" ? "El sistema"
    : e.channel === "CALL_CENTER" ? "Un asesor del Call Center"
    : e.channel === "WHATSAPP" ? "El paciente, por WhatsApp"
    : "El paciente, por su cuenta";

  const rows: [string, string][] = [["Canal", channel], ["Cuándo", `${formatDate(e.createdAt)} · ${ago(e.createdAt)}`], ["Quién", who]];
  const add = (k: string, v: unknown) => v !== undefined && v !== null && v !== "" && rows.push([k, String(v)]);
  if (e.type === "STEP_COMPLETED") {
    add("Paso", `${STEP_LABEL[String(p.from)] ?? p.from} → ${STEP_LABEL[String(p.to)] ?? p.to}`);
    if (p.to === "ESTUDIO_ELEGIDO") add("Estudio", data.precio ? `${data.estudio} · ${money(Number(data.precio))}` : data.estudio);
    if (p.to === "CLINICA_ELEGIDA") add("Clínica", data.clinica);
    if (p.to === "HORARIO_ELEGIDO" && data.horario) add("Horario", formatDate(String(data.horario)));
  } else if (e.type === "APPOINTMENT_CONFIRMED") {
    add("Estudio", data.estudio);
    add("Clínica", data.clinica);
    if (data.horario) add("Horario", formatDate(String(data.horario)));
    add("Folio", data.folio);
  } else if (e.type === "CASE_CANCELLED") add("Motivo", data.motivoCancelacion ?? "Sin motivo registrado");
  else if (e.type === "INTENT_CLASSIFIED") {
    add("Entendió", INTENT_LABEL[String(p.intent)] ?? p.intent);
    add("Cómo", p.source === "llm" ? "Con IA" : "Por reglas");
  } else if (e.type === "CONFLICT_DETECTED") add("Versiones", `esperaba v${p.expectedVersion}, había v${p.currentVersion}`);
  else if (swi) {
    add("Detalle", p.texto);
    add("Tipo en SWI", tipo);
  }

  return {
    kicker: swi ? `${channel} · SWI` : channel,
    title: swi ? (SWI_EVENT_LABEL[tipo] ?? tipo) : (EVENT_LABEL[e.type] ?? n.title),
    explain: swi ? (SWI_EXPLAIN[tipo] ?? "Evento registrado en SWI y recibido por la integración.") : (EXPLAIN[e.type] ?? "Evento registrado en la bitácora del trámite."),
    rows,
  };
}

function EventNote({ n, note, below, alignRight, onClose }: { n: Node; note: Note; below: boolean; alignRight: boolean; onClose: () => void }) {
  const v = CHANNEL_VISUAL[n.channel] ?? CHANNEL_VISUAL.WEB;
  return (
    <div
      id="event-note"
      role="dialog"
      aria-label={`Nota: ${note.title}`}
      className={`absolute ${below ? "top-full mt-2" : "bottom-full mb-2"} ${alignRight ? "right-0" : "left-0"} w-[300px] bg-white rounded-2xl border border-slate-200 shadow-2xl p-4 text-left`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-wider ${v.text}`}>{note.kicker}</p>
          <h4 className="text-sm font-bold text-slate-900 leading-snug">{note.title}</h4>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar nota" className="w-7 h-7 shrink-0 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 grid place-items-center">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
        </button>
      </div>
      <p className="text-xs text-slate-600 mt-2 leading-relaxed">{note.explain}</p>
      <dl className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
        {note.rows.map(([k, val]) => (
          <Fragment key={k}>
            <dt className="text-slate-400">{k}</dt>
            <dd className="text-slate-700 font-medium break-words whitespace-pre-line">{val}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
