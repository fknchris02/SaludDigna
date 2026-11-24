import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { EngineError } from "./case";
import { appendEvent, EventType, publish, recordEvent } from "./events";

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_MAX_PER_WINDOW = 3;
const OTP_WINDOW_MS = 10 * 60_000;

/** Normaliza un teléfono mexicano a E.164 (+52 + 10 dígitos). Lanza si no es válido. */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = "52" + d.slice(3); // prefijo móvil antiguo que aún manda WhatsApp
  if (d.length === 10) d = "52" + d;
  if (d.length !== 12 || !d.startsWith("52")) throw new EngineError("INVALID_DATA", "Teléfono inválido");
  return "+" + d;
}

/** Enmascara PII para vistas sin verificación (p. ej. asesor antes de validar al paciente). */
export function maskPhone(e164: string) {
  return e164.slice(0, 3) + "******" + e164.slice(-4);
}

/** Identidad del visitante en un canal (cookie web, número de WhatsApp, usuario de app). */
export async function getOrCreateChannelIdentity(channel: Channel, externalId: string) {
  const existing = await db.channelIdentity.findUnique({ where: { channel_externalId: { channel, externalId } } });
  if (existing) return existing;
  const { identity, ev } = await db.$transaction(async (tx) => {
    const identity = await tx.channelIdentity.create({ data: { channel, externalId } });
    const ev = await appendEvent(tx, { type: EventType.IDENTITY_ANONYMOUS_CREATED, channel, payload: { identityId: identity.id } });
    return { identity, ev };
  });
  publish([ev]);
  return identity;
}

function hashOtp(telefono: string, code: string) {
  const secret = process.env.OTP_SECRET;
  if (!secret) throw new Error("Falta OTP_SECRET");
  return createHmac("sha256", secret).update(`${telefono}:${code}`).digest("hex");
}

/**
 * Genera un OTP de 6 dígitos. Devuelve el código para que la demo lo muestre.
 * shortcut: sin proveedor SMS, el código se regresa al cliente; en producción enviarlo por SMS/WhatsApp y no regresarlo.
 */
export async function requestOtp(rawPhone: string, channel: Channel) {
  const telefono = normalizePhone(rawPhone);
  const recent = await db.otpChallenge.count({
    where: { telefono, createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) } },
  });
  if (recent >= OTP_MAX_PER_WINDOW) throw new EngineError("INVALID_DATA", "Demasiados códigos solicitados; espera unos minutos");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.otpChallenge.create({
    data: { telefono, codeHash: hashOtp(telefono, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await recordEvent({ type: EventType.OTP_SENT, channel, payload: { telefono: maskPhone(telefono) } });
  return { telefono, code };
}

/** Valida el OTP más reciente del teléfono. Consume el código al acertar. */
export async function verifyOtp(rawPhone: string, code: string, channel: Channel): Promise<boolean> {
  const telefono = normalizePhone(rawPhone);
  const otp = await db.otpChallenge.findFirst({
    where: { telefono, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return false;
  const a = Buffer.from(otp.codeHash, "hex");
  const b = Buffer.from(hashOtp(telefono, code), "hex");
  if (a.length === b.length && timingSafeEqual(a, b)) {
    // updateMany con usedAt: null evita que el mismo código se use dos veces en paralelo.
    const { count } = await db.otpChallenge.updateMany({ where: { id: otp.id, usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }
  await db.otpChallenge.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  await recordEvent({ type: EventType.OTP_FAILED, channel, payload: { telefono: maskPhone(telefono), attempt: otp.attempts + 1 } });
  return false;
}

/**
 * Verifica el OTP y liga la identidad de canal al paciente (lo crea si es nuevo).
 * Los trámites que el visitante hizo como anónimo pasan al paciente: así se "recuerda" lo avanzado.
 */
export async function verifyAndLink(input: {
  identityId: string;
  telefono: string;
  code: string;
  perfil?: { nombre: string; fechaNac: string }; // requerido solo si el paciente no existe
}) {
  const identity = await db.channelIdentity.findUnique({ where: { id: input.identityId } });
  if (!identity) throw new EngineError("NOT_FOUND", "Identidad no encontrada");
  const telefono = normalizePhone(input.telefono);
  // Revisar ANTES de consumir el OTP, para no quemar el código de un paciente nuevo sin perfil.
  if (!input.perfil && !(await db.patient.findUnique({ where: { telefono } }))) {
    throw new EngineError("INVALID_DATA", "Paciente nuevo: se requiere nombre y fecha de nacimiento", { needsProfile: true });
  }
  if (!(await verifyOtp(telefono, input.code, identity.channel))) {
    throw new EngineError("IDENTITY_REQUIRED", "Código incorrecto o expirado");
  }

  const { patient, events } = await db.$transaction(async (tx) => {
    let patient = await tx.patient.findUnique({ where: { telefono } });
    if (!patient) {
      if (!input.perfil) throw new EngineError("INVALID_DATA", "Paciente nuevo: se requiere nombre y fecha de nacimiento");
      patient = await tx.patient.create({
        data: { telefono, nombre: input.perfil.nombre, fechaNac: new Date(input.perfil.fechaNac) },
      });
    }
    await tx.channelIdentity.update({ where: { id: identity.id }, data: { patientId: patient.id, verifiedAt: new Date() } });
    const moved = await tx.case.updateMany({
      where: { anonIdentityId: identity.id, patientId: null },
      data: { patientId: patient.id },
    });
    // Los eventos anónimos de esos trámites también pasan a la línea de tiempo del paciente.
    await tx.event.updateMany({
      where: { case: { anonIdentityId: identity.id }, patientId: null },
      data: { patientId: patient.id },
    });
    const base = { channel: identity.channel, patientId: patient.id };
    const events = [
      await appendEvent(tx, { ...base, type: EventType.IDENTITY_VERIFIED, payload: { method: "OTP" } }),
      await appendEvent(tx, {
        ...base,
        type: EventType.IDENTITY_LINKED,
        payload: { identityId: identity.id, channel: identity.channel, casesLinked: moved.count },
      }),
    ];
    return { patient, events };
  });
  publish(events);
  return patient;
}

/**
 * Segundo factor en WhatsApp: el número ya prueba posesión del teléfono; se confirma con fecha de nacimiento.
 * Devuelve el paciente si coincide, o null.
 */
export async function verifyByBirthdate(identityId: string, fechaNac: string) {
  const identity = await db.channelIdentity.findUnique({ where: { id: identityId } });
  if (!identity) throw new EngineError("NOT_FOUND", "Identidad no encontrada");
  // Sin límite, la fecha de nacimiento se adivina por fuerza bruta.
  const fails = await db.event.count({
    where: {
      type: EventType.OTP_FAILED,
      createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) },
      payload: { path: ["identityId"], equals: identity.id },
    },
  });
  if (fails >= OTP_MAX_ATTEMPTS) throw new EngineError("IDENTITY_REQUIRED", "Demasiados intentos; espera unos minutos");
  const telefono = normalizePhone(identity.externalId);
  const patient = await db.patient.findUnique({ where: { telefono } });
  const ok = !!patient && patient.fechaNac.toISOString().slice(0, 10) === fechaNac;
  if (!ok) {
    await recordEvent({ type: EventType.OTP_FAILED, channel: identity.channel, payload: { method: "BIRTHDATE", identityId: identity.id } });
    return null;
  }
  const { events } = await db.$transaction(async (tx) => {
    await tx.channelIdentity.update({ where: { id: identity.id }, data: { patientId: patient.id, verifiedAt: new Date() } });
    const base = { channel: identity.channel, patientId: patient.id };
    return {
      events: [
        await appendEvent(tx, { ...base, type: EventType.IDENTITY_VERIFIED, payload: { method: "BIRTHDATE" } }),
        await appendEvent(tx, { ...base, type: EventType.IDENTITY_LINKED, payload: { identityId: identity.id, channel: identity.channel } }),
      ],
    };
  });
  publish(events);
  return patient;
}

/** Paciente nuevo que llega por WhatsApp: el número ya está verificado por el canal; se registra con nombre y fecha. */
export async function registerByWhatsApp(identityId: string, nombre: string, fechaNac: string) {
  const identity = await db.channelIdentity.findUnique({ where: { id: identityId } });
  if (!identity || identity.channel !== "WHATSAPP") throw new EngineError("NOT_FOUND", "Identidad no encontrada");
  const telefono = normalizePhone(identity.externalId);
  const { patient, events } = await db.$transaction(async (tx) => {
    if (await tx.patient.findUnique({ where: { telefono } })) {
      throw new EngineError("INVALID_DATA", "Este número ya está registrado; verifica con tu fecha de nacimiento");
    }
    const patient = await tx.patient.create({ data: { telefono, nombre, fechaNac: new Date(fechaNac) } });
    await tx.channelIdentity.update({ where: { id: identity.id }, data: { patientId: patient.id, verifiedAt: new Date() } });
    const base = { channel: identity.channel, patientId: patient.id };
    return {
      patient,
      events: [
        await appendEvent(tx, { ...base, type: EventType.IDENTITY_VERIFIED, payload: { method: "WHATSAPP_NUMBER" } }),
        await appendEvent(tx, { ...base, type: EventType.IDENTITY_LINKED, payload: { identityId: identity.id, channel: identity.channel, nuevo: true } }),
      ],
    };
  });
  publish(events);
  return patient;
}
