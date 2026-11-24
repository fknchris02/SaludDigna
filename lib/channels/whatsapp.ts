import { randomUUID } from "node:crypto";
import { Prisma, type Case, type CaseStep, type ChannelIdentity, type Patient } from "@prisma/client";
import { classifyMessage, normalize, type Intent } from "@/lib/ai/intent";
import { db } from "@/lib/db";
import { formatDate, money, slots } from "@/lib/format";
import { CHANNEL_NAME } from "@/lib/labels";
import { advance, createCase, EngineError, getActiveCase, pendingStep, resumeCase } from "@/lib/engine/case";
import { appendEvent, EventType, publish, recordEvent } from "@/lib/engine/events";
import {
  getOrCreateChannelIdentity,
  maskPhone,
  normalizePhone,
  registerByWhatsApp,
  verifyByBirthdate,
} from "@/lib/engine/identity";

export type Reply = { text: string; options?: string[] };

// Valor de una opción: "STEP:<paso>:<dato>" avanza el trámite, "ASK:<paso>" vuelve a preguntar, "CANCEL:yes|no".
type Option = { label: string; value: string };
type ConvState = {
  awaiting?: "BIRTHDATE" | "NAME" | "OPTION";
  fechaNac?: string;
  options?: Option[];
  caseId?: string | null;
  version?: number | null; // versión del trámite cuando se ofrecieron las opciones (bloqueo optimista)
};

const VERIFICATION_TTL_MS = 24 * 3600_000; // tras 24 h sin verificar, se vuelve a pedir la fecha de nacimiento

/**
 * Punto de entrada ÚNICO para mensajes de WhatsApp (simulador y Twilio).
 * `messageId` hace idempotente el procesamiento: un reintento del proveedor no responde ni avanza dos veces.
 */
export async function handleInboundMessage(input: { from: string; text: string; messageId?: string }) {
  const telefono = normalizePhone(input.from);
  const messageId = input.messageId ?? randomUUID();
  const text = input.text.trim().slice(0, 1000);
  let identity = await getOrCreateChannelIdentity("WHATSAPP", telefono);
  const state = (identity.convState ?? {}) as ConvState;

  try {
    await recordEvent({
      type: EventType.MESSAGE_IN,
      channel: "WHATSAPP",
      patientId: identity.patientId,
      caseId: state.caseId ?? null,
      idempotencyKey: `wa:in:${messageId}`,
      // No guardar la fecha de nacimiento en la bitácora.
      payload: {
        identityId: identity.id,
        text: state.awaiting === "BIRTHDATE" ? "[fecha de nacimiento]" : state.awaiting === "NAME" ? "[nombre]" : text,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { replies: [], duplicate: true };
    throw err;
  }

  let result: Result;
  try {
    result = await respond(identity, state, text, messageId);
  } catch (err) {
    // El mensaje ya quedó registrado (un reintento sería "duplicado"), así que siempre se contesta algo.
    console.error("whatsapp:", err);
    result = { replies: [{ text: "Tuvimos un problema al procesar tu mensaje 🙏 Intenta de nuevo en un momento." }], next: state, caseId: state.caseId ?? null };
  }
  const { replies, next, caseId } = result;

  identity = await db.channelIdentity.update({ where: { id: identity.id }, data: { convState: next as Prisma.InputJsonObject } });
  for (const r of replies) {
    await recordEvent({
      type: EventType.MESSAGE_OUT,
      channel: "WHATSAPP",
      patientId: identity.patientId,
      caseId,
      payload: { identityId: identity.id, text: r.text, options: r.options ?? [] },
    });
  }
  return { replies, duplicate: false };
}

type Result = { replies: Reply[]; next: ConvState; caseId: string | null };

/**
 * Avisos salientes: lo que WhatsApp le habría mandado al paciente mientras usaba otros canales (cita confirmada o
 * cancelada, trámite nuevo pendiente), para que la conversación no se quede con opciones viejas.
 * Solo con identidad verificada. Idempotente: si la conversación ya está al día, no envía nada.
 * shortcut: se dispara al abrir el simulador; con WhatsApp real, enviarlo al ocurrir el evento (plantilla fuera de la ventana de 24 h).
 */
export async function catchUp(telefono: string) {
  const found = await db.channelIdentity.findUnique({ where: { channel_externalId: { channel: "WHATSAPP", externalId: telefono } } });
  if (!found?.patientId) return;
  const sent = await db.$transaction(async (tx) => {
    // Bloquea la conversación: dos pestañas abriendo a la vez no duplican avisos (la segunda ya la ve al día).
    await tx.$queryRaw`SELECT id FROM "ChannelIdentity" WHERE id = ${found.id} FOR UPDATE`;
    const identity = await tx.channelIdentity.findUniqueOrThrow({ where: { id: found.id } });
    return pendingNotices(tx, identity);
  });
  publish(sent);
}

async function pendingNotices(tx: Prisma.TransactionClient, identity: ChannelIdentity) {
  if (!identity.patientId || !identity.verifiedAt || Date.now() - identity.verifiedAt.getTime() >= VERIFICATION_TTL_MS) return [];
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: identity.patientId } });
  const state = (identity.convState ?? {}) as ConvState;

  const lastOut = await tx.event.findFirst({
    where: { type: EventType.MESSAGE_OUT, payload: { path: ["identityId"], equals: identity.id } },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const after = lastOut?.seq ?? 0n;
  const cases = new Map((await tx.case.findMany({ where: { patientId: patient.id } })).map((c) => [c.id, c]));
  const closed = await tx.event.findMany({
    where: {
      caseId: { in: [...cases.keys()] },
      type: { in: [EventType.APPOINTMENT_CONFIRMED, EventType.CASE_CANCELLED] },
      channel: { not: "WHATSAPP" },
      seq: { gt: after },
    },
    orderBy: { seq: "asc" },
  });
  const out: (Reply & { caseId: string | null })[] = closed.map((e) => {
    const c = cases.get(e.caseId!)!;
    const d = c.data as Record<string, string>;
    return e.type === EventType.APPOINTMENT_CONFIRMED
      ? { caseId: c.id, text: `✅ Tu cita quedó confirmada desde ${channelName(e.channel)}.\nFolio: *${d.folio}*\n${summary(c)}` }
      : { caseId: c.id, text: `Tu trámite de ${d.estudio ?? "estudio"} fue cancelado desde ${channelName(e.channel)}.` };
  });

  const active = await getActiveCase(patient.id);
  const stale = (state.caseId ?? null) !== (active?.id ?? null) || (!!active && state.version !== active.version);
  if (!out.length && !stale) return [];

  let next: ConvState = {};
  if (active) {
    const r = await withPrompt(
      [{ text: `${firstName(patient)}, tienes un trámite pendiente (último cambio en ${channelName(active.lastChannel)}):\n${summary(active)}\nSigamos donde te quedaste 👇` }],
      active,
      patient,
    );
    out.push(...r.replies.map((x) => ({ ...x, caseId: active.id })));
    next = r.next;
  } else {
    out.push({ caseId: null, text: "Si quieres agendar otro estudio, escribe *hola*." });
  }

  const sent = [];
  for (const r of out) {
    sent.push(
      await appendEvent(tx, {
        type: EventType.MESSAGE_OUT,
        channel: "WHATSAPP",
        patientId: patient.id,
        caseId: r.caseId,
        payload: { identityId: identity.id, text: r.text, options: r.options ?? [] },
      }),
    );
  }
  await tx.channelIdentity.update({ where: { id: identity.id }, data: { convState: next as Prisma.InputJsonObject } });
  return sent;
}

async function respond(identity: ChannelIdentity, state: ConvState, text: string, messageId: string): Promise<Result> {
  const verified =
    identity.patientId && identity.verifiedAt && Date.now() - identity.verifiedAt.getTime() < VERIFICATION_TTL_MS;
  if (!verified) return verifyFlow(identity, state, text);
  const patient = await db.patient.findUniqueOrThrow({ where: { id: identity.patientId! } });
  return caseFlow(identity, patient, state, text, messageId);
}

// ───────────────────────── Identidad ─────────────────────────

async function verifyFlow(identity: ChannelIdentity, state: ConvState, text: string): Promise<Result> {
  const none = { caseId: null };
  if (state.awaiting === "BIRTHDATE") {
    const fecha = parseDate(text);
    if (!fecha) return { ...none, replies: [{ text: "No reconocí la fecha 🤔 Escríbela así: DD/MM/AAAA (por ejemplo 15/04/1992)." }], next: state };
    const exists = await db.patient.findUnique({ where: { telefono: identity.externalId } });
    if (!exists) {
      return {
        ...none,
        replies: [{ text: "No encontramos un registro con este número. Te registramos en un momento: ¿cuál es tu nombre completo?" }],
        next: { awaiting: "NAME", fechaNac: fecha },
      };
    }
    try {
      const patient = await verifyByBirthdate(identity.id, fecha);
      if (!patient) return { ...none, replies: [{ text: "Los datos no coinciden. Revisa tu fecha de nacimiento e intenta de nuevo." }], next: state };
      return afterVerified(identity, patient);
    } catch (err) {
      if (err instanceof EngineError && err.code === "IDENTITY_REQUIRED") {
        return { ...none, replies: [{ text: "Demasiados intentos. Por seguridad, intenta de nuevo en 10 minutos o llama a nuestro Call Center." }], next: state };
      }
      throw err;
    }
  }

  if (state.awaiting === "NAME" && state.fechaNac) {
    const nombre = text.replace(/\s+/g, " ").trim();
    if (!/^[\p{L} .'-]{3,120}$/u.test(nombre)) {
      return { ...none, replies: [{ text: "Escribe tu nombre completo, solo con letras." }], next: state };
    }
    const patient = await registerByWhatsApp(identity.id, nombre, state.fechaNac);
    return afterVerified(identity, patient);
  }

  return {
    ...none,
    replies: [{ text: "¡Hola! 👋 Soy el asistente de Salud Digna. Para proteger tus datos, confirma tu fecha de nacimiento (DD/MM/AAAA)." }],
    next: { awaiting: "BIRTHDATE" },
  };
}

async function afterVerified(identity: ChannelIdentity, patient: Patient): Promise<Result> {
  const fresh = await db.channelIdentity.findUniqueOrThrow({ where: { id: identity.id } });
  const r = await caseFlow(fresh, patient, {}, "", "", true);
  return { ...r, replies: [{ text: `¡Gracias, ${firstName(patient)}! ✅ Tu identidad quedó verificada.` }, ...r.replies] };
}

// ───────────────────────── Trámite ─────────────────────────

async function caseFlow(
  identity: ChannelIdentity,
  patient: Patient,
  state: ConvState,
  text: string,
  messageId: string,
  justVerified = false,
): Promise<Result> {
  let active = await getActiveCase(patient.id);
  const pre: Reply[] = [];

  // Cambio de canal: el trámite viene de otro lado → se retoma donde se quedó, sin volver a preguntar nada.
  if (active && active.lastChannel !== "WHATSAPP") {
    const from = active.lastChannel;
    active = await resumeCase(active.id, "WHATSAPP");
    // Si un aviso (catchUp) ya ofreció opciones para esta misma versión, la respuesta es válida y se procesa.
    const alreadyOffered = state.awaiting === "OPTION" && state.caseId === active.id && state.version === active.version;
    if (!alreadyOffered) {
      pre.push({ text: `${firstName(patient)}, tienes un trámite pendiente que iniciaste en ${channelName(from)}:\n${summary(active)}\nSigamos donde te quedaste 👇` });
      return withPrompt(pre, active, patient);
    }
  }
  if (justVerified) return withPrompt(pre, active, patient);

  // Opción por número o texto exacto (determinista); si no, la IA interpreta el texto libre ("el del miércoles temprano").
  const offered = state.awaiting === "OPTION" ? (state.options ?? []) : [];
  let option = offered.length ? pickOption(offered, text) : null;
  const { intent, option: aiOption, source } = option
    ? { intent: "OTRO" as Intent, option: null, source: "rules" as const }
    : await classifyMessage(text, offered.map((o) => o.label));
  if (!option && aiOption) {
    option = offered[aiOption - 1];
    await recordEvent({
      type: EventType.INTENT_CLASSIFIED,
      channel: "WHATSAPP",
      patientId: patient.id,
      caseId: active?.id ?? null,
      payload: { intent: "ELEGIR_OPCION", option: option.label, source },
    });
  }

  if (!option && intent !== "OTRO" && intent !== "SALUDO") {
    await recordEvent({
      type: EventType.INTENT_CLASSIFIED,
      channel: "WHATSAPP",
      patientId: patient.id,
      caseId: active?.id ?? null,
      payload: { intent, source },
    });
    const answered = answerIntent(intent, active);
    if (answered) {
      if (answered.next) return { replies: answered.replies, next: answered.next, caseId: active?.id ?? null };
      return withPrompt(answered.replies, active, patient);
    }
  }

  if (!option) {
    const hint = state.awaiting === "OPTION" && intent === "OTRO" ? [{ text: "No te entendí 🙏 Elige una opción con su número." }] : [];
    return withPrompt(hint, active, patient);
  }

  // Las opciones se ofrecieron para un trámite y versión concretos; si cambió en otro canal, avisar y volver a preguntar.
  if ((state.caseId ?? null) !== (active?.id ?? null)) return changedElsewhere(active, patient);

  const [kind, a, b] = option.value.split(":");
  if (kind === "ASK") return { ...(await promptFor(a as CaseStep, active, patient)), caseId: active?.id ?? null };
  if (kind === "CANCEL") {
    if (a !== "yes" || !active) return withPrompt([{ text: "De acuerdo, seguimos con tu trámite." }], active, patient);
    return apply(active, "CANCELADO", {}, state.version!, messageId, patient);
  }

  // kind === "STEP"
  const to = a as CaseStep;
  const data = to === "ESTUDIO_ELEGIDO" ? { studyId: b } : to === "CLINICA_ELEGIDA" ? { clinicId: b } : to === "HORARIO_ELEGIDO" ? { horario: option.value.slice("STEP:HORARIO_ELEGIDO:".length) } : {};
  const target = active ?? (await createCase({ channel: "WHATSAPP", patientId: patient.id }));
  return apply(target, to, data, active ? state.version! : target.version, messageId, patient);
}

async function apply(c: Case, to: CaseStep, data: Record<string, unknown>, version: number, messageId: string, patient: Patient): Promise<Result> {
  try {
    const r = await advance({ caseId: c.id, to, data, channel: "WHATSAPP", expectedVersion: version, idempotencyKey: `wa:${messageId}` });
    const updated = r.case;
    if (updated.step === "CANCELADO") return { replies: [{ text: "Tu trámite fue cancelado. Si quieres agendar otro estudio, escribe *hola*." }], next: {}, caseId: updated.id };
    if (updated.step === "CITA_CONFIRMADA") {
      const d = updated.data as Record<string, string | number>;
      return {
        replies: [{ text: `✅ ¡Cita confirmada!\nFolio: *${d.folio}*\n${summary(updated)}\n\nPreparación: ${d.preparacion}\nPuedes verla en la app de Salud Digna.` }],
        next: {},
        caseId: updated.id,
      };
    }
    return withPrompt([], updated, patient);
  } catch (err) {
    if (err instanceof EngineError && (err.code === "CONFLICT" || err.code === "INVALID_TRANSITION")) {
      return changedElsewhere(await getActiveCase(patient.id), patient);
    }
    if (err instanceof EngineError && err.code === "INVALID_DATA") {
      return withPrompt([{ text: "Esa opción ya no está disponible. Elige otra, por favor." }], c, patient);
    }
    throw err;
  }
}

function changedElsewhere(active: Case | null, patient: Patient) {
  return withPrompt([{ text: "Tu trámite se actualizó desde otro canal. Esto es lo que sigue:" }], active, patient);
}

function answerIntent(intent: Intent, active: Case | null): { replies: Reply[]; next?: ConvState } | null {
  const d = (active?.data ?? {}) as Record<string, string | number>;
  switch (intent) {
    case "HABLAR_ASESOR":
      return {
        replies: [{ text: "Con gusto 🙌 Llama al Call Center de Salud Digna: un asesor ya puede ver tu trámite y no tendrás que repetir tus datos." }],
      };
    case "PREGUNTA_PREPARACION":
      return d.preparacion ? { replies: [{ text: `Para tu ${d.estudio}: ${d.preparacion}` }] } : null;
    case "PREGUNTA_PRECIO":
      return d.precio ? { replies: [{ text: `Tu ${d.estudio} cuesta ${money(Number(d.precio))}.` }] } : null;
    case "CANCELAR":
      if (!active) return null;
      return {
        replies: [{ text: `¿Seguro que quieres cancelar tu trámite?\n${summary(active)}`, options: ["Sí, cancelar", "No, continuar"] }],
        next: {
          awaiting: "OPTION",
          caseId: active.id,
          version: active.version,
          options: [
            { label: "Sí, cancelar", value: "CANCEL:yes" },
            { label: "No, continuar", value: "CANCEL:no" },
          ],
        },
      };
    default:
      return null;
  }
}

// ───────────────────────── Preguntas por paso ─────────────────────────

async function withPrompt(pre: Reply[], active: Case | null, patient: Patient): Promise<Result> {
  const step = active ? pendingStep(active.step) : "ESTUDIO_ELEGIDO";
  const p = await promptFor(step ?? "ESTUDIO_ELEGIDO", active, patient);
  return { replies: [...pre, ...p.replies], next: p.next, caseId: active?.id ?? null };
}

async function promptFor(step: CaseStep, active: Case | null, patient: Patient): Promise<{ replies: Reply[]; next: ConvState }> {
  const ctx = { awaiting: "OPTION" as const, caseId: active?.id ?? null, version: active?.version ?? null };
  const ask = (text: string, options: Option[]) => ({
    replies: [{ text, options: options.map((o) => o.label) }],
    next: { ...ctx, options },
  });

  switch (step) {
    case "ESTUDIO_ELEGIDO": {
      const studies = await db.study.findMany({ orderBy: { nombre: "asc" } });
      return ask(
        active ? "¿Qué estudio quieres agendar?" : `Hola, ${firstName(patient)} 👋 ¿Qué estudio quieres agendar?`,
        studies.map((s) => ({ label: `${s.nombre} (${money(s.precio)})`, value: `STEP:ESTUDIO_ELEGIDO:${s.id}` })),
      );
    }
    case "CLINICA_ELEGIDA": {
      const clinics = await db.clinic.findMany({ orderBy: { nombre: "asc" } });
      return ask("¿En qué clínica?", clinics.map((c) => ({ label: c.nombre, value: `STEP:CLINICA_ELEGIDA:${c.id}` })));
    }
    case "HORARIO_ELEGIDO":
      return ask("Elige un horario:", slots().map((s) => ({ label: formatDate(s), value: `STEP:HORARIO_ELEGIDO:${s}` })));
    case "DATOS_CONFIRMADOS":
      return ask(`Confirma tus datos:\n👤 ${patient.nombre}\n📱 ${maskPhone(patient.telefono)}\n${summary(active!)}\n¿Son correctos?`, [
        { label: "Sí, son correctos", value: "STEP:DATOS_CONFIRMADOS" },
        { label: "Cambiar horario", value: "ASK:HORARIO_ELEGIDO" },
      ]);
    case "CITA_CONFIRMADA":
      return ask(`¿Confirmamos tu cita?\n${summary(active!)}`, [
        { label: "Confirmar cita", value: "STEP:CITA_CONFIRMADA" },
        { label: "Cambiar horario", value: "ASK:HORARIO_ELEGIDO" },
      ]);
    default:
      return { replies: [{ text: "Escribe *hola* para agendar un estudio." }], next: {} };
  }
}

// ───────────────────────── Utilidades ─────────────────────────

/** Acepta "3", "Clínica Centro", "si"… Devuelve la opción solo si la coincidencia es única. */
export function pickOption(options: Option[], text: string): Option | null {
  const t = normalize(text);
  if (!t) return null;
  if (/^\d+$/.test(t)) return options[Number(t) - 1] ?? null;
  const hits = options.filter((o) => {
    const l = normalize(o.label);
    return l.startsWith(t) || (t.length >= 4 && l.includes(t)) || t.includes(l);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** "15/04/1992", "15-4-1992" o "1992-04-15" → "1992-04-15"; null si no es una fecha real y pasada. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  const dmy = t.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/);
  const ymd = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dmy && !ymd) return null;
  const [y, mo, d] = dmy ? [dmy[3], dmy[2], dmy[1]] : [ymd![1], ymd![2], ymd![3]];
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const date = new Date(iso + "T00:00:00Z");
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso || date > new Date() || Number(y) < 1900) return null;
  return iso;
}

function summary(c: Case) {
  const d = c.data as Record<string, string | number>;
  return [d.estudio && `🩺 ${d.estudio}`, d.clinica && `🏥 ${d.clinica}`, d.horario && `🗓️ ${formatDate(String(d.horario))}`]
    .filter(Boolean)
    .join("\n");
}

const firstName = (p: Patient) => p.nombre.split(" ")[0];
const channelName = (c: string) => CHANNEL_NAME[c as keyof typeof CHANNEL_NAME] ?? c;
