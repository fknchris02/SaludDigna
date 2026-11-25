import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, type Channel, type Event, type SwiEvento } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { publish } from "@/lib/engine/events";
import { normalizePhone } from "@/lib/engine/identity";

/**
 * Integración con SWI (la consola del call center de otro equipo). Guarda sus registros tal cual, en sus propias
 * tablas y con su id (upsert: si un registro llega dos veces se actualiza). No usa nuestro OTP ni nuestros trámites.
 * La paciente se liga a nuestro `Patient` por teléfono, la llave entre canales.
 * Los registros pueden llegar en cualquier orden: lo que llega antes que su paciente o trámite se guarda igual
 * y se liga cuando estos llegan.
 */

type Tx = Prisma.TransactionClient;
export const SWI_EVENT_TYPE = "SWI_EVENTO";
export const SWI_MAX_REGISTROS = 40;
const SIN_NOMBRE = "Sin nombre (SWI)";

class SwiError extends Error {}

/** Compara la llave por hash para no filtrar su longitud ni su contenido por el tiempo de respuesta. */
export function validSwiKey(given: string | null) {
  const expected = process.env.SWI_API_KEY;
  if (!expected || expected.length < 16 || !given) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

// ───────────────────────── Formato de SWI ─────────────────────────
// "Cualquier campo puede llegar null, excepto tipo, id y telefono": "", null o ausente → null.
// Los catálogos (estado, canal, metodo…) se aceptan aunque traigan un valor nuevo: se guardan, no se rechazan.

const text = (max = 300) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? null : String(v).trim() || null))
    .refine((v) => v === null || v.length <= max, `máximo ${max} caracteres`);
const Id = z.union([z.string().trim().min(1).max(100), z.number()]).transform(String);
const isoDate = z.union([z.iso.datetime({ offset: true, local: true }), z.iso.date(), z.literal(""), z.null()]).optional();
const date = isoDate.transform((v) => (v ? new Date(v) : null));
const birth = isoDate.transform((v) => (v ? new Date(v.slice(0, 10)) : null)); // solo el día, sin recorrerlo por zona horaria
const Tel = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return normalizePhone(String(v));
  } catch {
    ctx.addIssue({ code: "custom", message: "teléfono inválido (se esperan 10 dígitos)" });
    return z.NEVER;
  }
});
const money = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).nullish().transform((v) => (v == null ? null : Number(v)))
  .refine((v) => v === null || (v >= 0 && v <= 10_000_000), "monto fuera de rango");
const Detalle = z.unknown().optional().refine((v) => JSON.stringify(v ?? {}).length <= 20_000, "detalle demasiado grande (máx. 20 KB)");

const Paciente = z.looseObject({
  tipo: z.literal("PACIENTE"),
  id: Id,
  telefono: Tel,
  nombre: text(),
  nombres: text(),
  primerApellido: text(),
  segundoApellido: text(),
  fechaNacimiento: birth,
  sexo: text(10),
  entidadNacimiento: text(10),
  curp: text(18),
  email: text(),
  telefonoFijo: text(20),
  contactoNombre: text(),
  contactoTelefono: text(20),
  creadoEn: date,
});

const Tramite = z.looseObject({
  tipo: z.literal("TRAMITE"),
  id: Id,
  pacienteId: Id.nullish(),
  telefono: Tel,
  estudio: z.looseObject({ clave: text(60), nombre: text(200), precio: money, preparacion: text(1000) }).nullish(),
  clinica: z.looseObject({ nombre: text(200), ciudad: text(), direccion: text() }).nullish(),
  fechaCita: date,
  estado: text(40),
  canalOrigen: text(20),
  canalActual: text(20),
  folioExterno: text(100),
  recuperadoPor: text(20),
  creadoEn: date,
  actualizadoEn: date,
});

// Estricto (solo sus 12 campos): un campo extra, como un número de tarjeta, se rechaza en vez de guardarse.
const Pago = z.strictObject({
  tipo: z.literal("PAGO"),
  id: Id,
  tramiteId: Id.nullish(),
  monto: money,
  moneda: text(3),
  metodo: text(20),
  estado: text(20),
  marca: text(30),
  ultimos4: z.string().regex(/^\d{4}$/, "ultimos4 deben ser 4 dígitos").or(z.literal("")).nullish().transform((v) => v || null),
  referencia: text(100).refine((v) => !v || !hasCardNumber(v), "la referencia parece un número de tarjeta completo; solo se aceptan los últimos 4"),
  canal: text(20),
  creadoEn: date,
});

const Evento = z.looseObject({
  tipo: z.literal("EVENTO"),
  id: Id,
  pacienteId: Id.nullish(),
  tramiteId: Id.nullish(),
  canal: text(20),
  tipoEvento: text(60),
  detalle: Detalle,
  fecha: date,
});

const Registro = z.discriminatedUnion("tipo", [Paciente, Tramite, Pago, Evento]);
type Registro = z.infer<typeof Registro>;

/** Secuencia de 13-19 dígitos que pasa la verificación de Luhn (la de los números de tarjeta). */
export function hasCardNumber(s: string) {
  for (const m of s.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

// ───────────────────────── Ingesta ─────────────────────────

export type SwiResult = { ok: string[]; errores: { id: string | null; motivo: string }[] };

/** Procesa el lote en orden; cada registro se guarda o falla por separado (SWI reintenta los errores). */
export async function ingestSwi(registros: unknown[]): Promise<SwiResult> {
  const result: SwiResult = { ok: [], errores: [] };
  for (const raw of registros) {
    const id = rawId(raw);
    const parsed = Registro.safeParse(raw);
    if (!parsed.success) {
      result.errores.push({ id, motivo: describe(raw, parsed.error) });
      continue;
    }
    try {
      const events = await db.$transaction((tx) => save(tx, parsed.data, raw as Prisma.InputJsonObject));
      publish(events);
      result.ok.push(parsed.data.id);
    } catch (err) {
      if (err instanceof SwiError) result.errores.push({ id, motivo: err.message });
      else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        result.errores.push({ id, motivo: "conflicto con otro registro que llegó al mismo tiempo; reintenta" });
      else {
        console.error("swi:", err);
        result.errores.push({ id, motivo: "error interno al guardar" });
      }
    }
  }
  return result;
}

function save(tx: Tx, r: Registro, raw: Prisma.InputJsonObject): Promise<Event[]> {
  switch (r.tipo) {
    case "PACIENTE":
      return savePaciente(tx, r, raw);
    case "TRAMITE":
      return saveTramite(tx, r, raw);
    case "PAGO":
      return savePago(tx, r);
    case "EVENTO":
      return saveEvento(tx, r);
  }
}

async function savePaciente(tx: Tx, p: z.infer<typeof Paciente>, raw: Prisma.InputJsonObject) {
  const link = await linkPatient(tx, p.id, p.telefono);
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: link.patientId } });
  const nombre = p.nombre ?? ([p.nombres, p.primerApellido, p.segundoApellido].filter(Boolean).join(" ") || null);
  const email = p.email && z.email().safeParse(p.email).success ? p.email : null;

  // Si la paciente nació en SWI, sus datos mandan; si ya existía en nuestra base, solo se completan huecos.
  const owns = link.creoPaciente;
  const data: Prisma.PatientUpdateInput = {};
  if (nombre && (owns || patient.nombre === SIN_NOMBRE)) data.nombre = nombre;
  if (p.fechaNacimiento && (owns || !patient.fechaNac)) data.fechaNac = p.fechaNacimiento;
  if (email && (owns || !patient.email)) data.email = email;
  if (Object.keys(data).length) await tx.patient.update({ where: { id: patient.id }, data });

  await tx.swiPaciente.update({ where: { id: p.id }, data: { telefono: p.telefono, datos: raw } });
  return adoptOrphans(tx, { pacienteId: p.id }, patient.id);
}

async function saveTramite(tx: Tx, t: z.infer<typeof Tramite>, raw: Prisma.InputJsonObject) {
  // Si el trámite llega antes que su paciente, se crea la paciente con el teléfono y se completa cuando llegue.
  const patientId = t.pacienteId ? (await linkPatient(tx, t.pacienteId, t.telefono)).patientId : (await patientByPhone(tx, t.telefono)).patient.id;
  const data = {
    pacienteId: t.pacienteId ?? null,
    patientId,
    studyId: t.estudio ? await ensureStudy(tx, t.estudio) : null,
    clinicId: t.clinica?.nombre ? await ensureClinic(tx, { ...t.clinica, nombre: t.clinica.nombre }) : null,
    fechaCita: t.fechaCita,
    estado: t.estado,
    canalOrigen: t.canalOrigen,
    canalActual: t.canalActual,
    folioExterno: t.folioExterno,
    recuperadoPor: t.recuperadoPor,
    creadoEnSwi: t.creadoEn,
    actualizadoEnSwi: t.actualizadoEn,
    datos: raw,
  };
  await tx.swiTramite.upsert({ where: { id: t.id }, create: { id: t.id, ...data }, update: data });
  // Si su TRAMITE_ELIMINADO llegó antes que el trámite, se marca ahora.
  const deleted = await tx.swiEvento.findFirst({
    where: { tipoEvento: "TRAMITE_ELIMINADO", OR: [{ tramiteId: t.id }, { detalle: { path: ["tramiteId"], equals: t.id } }] },
  });
  if (deleted) await markDeleted(tx, deleted);
  return [...(await adoptOrphans(tx, { tramiteId: t.id }, patientId)), ...(t.pacienteId ? await adoptOrphans(tx, { pacienteId: t.pacienteId }, patientId) : [])];
}

async function savePago(tx: Tx, p: z.infer<typeof Pago>) {
  // El trámite puede no haber llegado aún: el pago se guarda igual con su tramiteId.
  const data = {
    tramiteId: p.tramiteId ?? null,
    monto: p.monto,
    moneda: p.moneda,
    metodo: p.metodo,
    estado: p.estado,
    marca: p.marca,
    ultimos4: p.ultimos4,
    referencia: p.referencia,
    canal: p.canal,
    creadoEnSwi: p.creadoEn,
  };
  await tx.swiPago.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
  return [];
}

async function saveEvento(tx: Tx, e: z.infer<typeof Evento>) {
  let patientId: string | null = null;
  if (e.pacienteId) patientId = (await tx.swiPaciente.findUnique({ where: { id: e.pacienteId } }))?.patientId ?? null;
  if (!patientId && e.tramiteId) patientId = (await tx.swiTramite.findUnique({ where: { id: e.tramiteId } }))?.patientId ?? null;

  const data = {
    patientId,
    pacienteId: e.pacienteId ?? null,
    tramiteId: e.tramiteId ?? null,
    canal: e.canal,
    tipoEvento: e.tipoEvento,
    detalle: (e.detalle ?? {}) as Prisma.InputJsonValue,
    fecha: e.fecha,
  };
  const row = await tx.swiEvento.upsert({ where: { id: e.id }, create: { id: e.id, ...data }, update: data });
  if (row.tipoEvento === "TRAMITE_ELIMINADO") await markDeleted(tx, row);
  if (!patientId) return []; // huérfano: pasa a la línea de tiempo cuando llegue su paciente o su trámite
  const ev = await toTimeline(tx, row, patientId);
  return ev ? [ev] : [];
}

/**
 * SWI no manda un borrado del TRAMITE: manda el evento TRAMITE_ELIMINADO con detalle.tramiteId.
 * Se marca eliminado (sale del tablero) y se conserva su historia.
 */
async function markDeleted(tx: Tx, ev: SwiEvento) {
  const d = (ev.detalle ?? {}) as Record<string, unknown>;
  const id = typeof d.tramiteId === "string" ? d.tramiteId : ev.tramiteId;
  if (!id) return;
  await tx.swiTramite.updateMany({
    where: { id, eliminadoEn: null },
    data: { eliminadoEn: ev.fecha ?? ev.recibidoEn, motivoEliminacion: typeof d.motivo === "string" ? d.motivo.slice(0, 300) : null },
  });
}

/** Eventos que llegaron antes que su paciente o trámite: se ligan ahora y pasan a la línea de tiempo. */
async function adoptOrphans(tx: Tx, where: { pacienteId: string } | { tramiteId: string }, patientId: string) {
  const orphans = await tx.swiEvento.findMany({ where: { ...where, patientId: null } });
  if (!orphans.length) return [];
  await tx.swiEvento.updateMany({ where: { id: { in: orphans.map((o) => o.id) } }, data: { patientId } });
  const events: Event[] = [];
  for (const o of orphans) {
    const ev = await toTimeline(tx, o, patientId);
    if (ev) events.push(ev);
  }
  return events;
}

/**
 * Copia el evento a nuestra bitácora (línea de tiempo de la paciente, en vivo por SSE), una sola vez.
 * SWI confirmó que un EVENTO no cambia después de enviado, así que la bitácora append-only basta.
 */
async function toTimeline(tx: Tx, e: SwiEvento, patientId: string) {
  const idempotencyKey = `swi:evento:${e.id}`;
  if (await tx.event.findUnique({ where: { idempotencyKey }, select: { seq: true } })) return null;
  const texto = resumen(e.tipoEvento, e.detalle);
  return tx.event.create({
    data: {
      type: SWI_EVENT_TYPE,
      channel: toChannel(e.canal),
      patientId,
      idempotencyKey,
      createdAt: e.fecha ?? e.recibidoEn,
      payload: { origen: "SWI", swiId: e.id, tipoEvento: e.tipoEvento, canal: e.canal, tramiteId: e.tramiteId, ...(texto ? { texto } : {}) },
    },
  });
}

const PAGO_LABEL: Record<string, string> = { PAGADO: "pagado", EN_CLINICA: "paga en clínica", PENDIENTE: "pago pendiente" };

/** Una línea legible del `detalle` para la línea de tiempo (el detalle completo queda en SwiEvento). */
export function resumen(tipo: string | null, detalle: unknown): string | null {
  if (!detalle || typeof detalle !== "object") return null;
  const d = detalle as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]).trim() || null : null);
  const join = (...xs: (string | null | false | undefined)[]) => xs.filter(Boolean).join(" · ") || null;

  if (tipo === "CITA_PARA_FAMILIAR")
    return join(s("familiar") && `Para ${s("familiar")}${s("parentescoTexto") ?? s("parentesco") ? ` (${(s("parentescoTexto") ?? s("parentesco"))!.toLowerCase()})` : ""}`, s("estudio"), s("clinica"));
  if (tipo === "CITA_AGENDADA" && s("agendadaPor")) return join(`Agendada por ${s("agendadaPor")}`, s("clinica"));
  if (tipo === "REPORTE_ENVIADO") {
    const n = Array.isArray(d.estudios) ? d.estudios.length : 0;
    // El enlace al PDF (ruta) no se muestra: vive en el servidor de SWI, solo en la red local, y vence en 30 días.
    return join(s("folio") && `Folio ${s("folio")}`, PAGO_LABEL[s("pago") ?? ""] ?? s("pago"), n > 0 && `${n} estudio${n === 1 ? "" : "s"}`, s("clinica"));
  }
  if (tipo === "TRAMITE_ELIMINADO") return join(s("estudio"), s("motivo"));
  if (tipo === "LLAMADA_RECIBIDA") return join(s("desde") && `Desde el ••${s("desde")!.slice(-4)}`, s("proveedor"));

  const main = s("texto") ?? s("nota") ?? s("motivo") ?? s("asunto");
  if (main) return main.slice(0, 1000);
  const parts = [s("estudio"), s("clinica"), s("monto") && `$${s("monto")}`, s("marca") && s("ultimos4") && `${s("marca")} ••${s("ultimos4")}`, s("asesor")];
  return parts.filter(Boolean).join(" · ") || null;
}

// ───────────────────────── Utilidades ─────────────────────────

/** Liga el id de paciente de SWI con nuestro paciente (por teléfono), creándolo si no existe. */
async function linkPatient(tx: Tx, swiId: string, telefono: string) {
  const existing = await tx.swiPaciente.findUnique({ where: { id: swiId } });
  if (existing) return existing;
  const { patient, created } = await patientByPhone(tx, telefono);
  return tx.swiPaciente.create({ data: { id: swiId, patientId: patient.id, telefono, creoPaciente: created } });
}

async function patientByPhone(tx: Tx, telefono: string) {
  const patient = await tx.patient.findUnique({ where: { telefono } });
  if (patient) return { patient, created: false };
  return { patient: await tx.patient.create({ data: { telefono, nombre: SIN_NOMBRE } }), created: true };
}

/** Busca el estudio por clave (o por nombre); si no está en el catálogo, lo crea con los datos de SWI. */
async function ensureStudy(tx: Tx, e: NonNullable<z.infer<typeof Tramite>["estudio"]>) {
  const or: Prisma.StudyWhereInput[] = [];
  if (e.clave) or.push({ id: e.clave });
  if (e.nombre) or.push({ nombre: { equals: e.nombre, mode: "insensitive" } });
  if (!or.length) return null;
  const found = await tx.study.findFirst({ where: { OR: or }, select: { id: true } });
  if (found) return found.id;
  const nombre = e.nombre ?? e.clave!;
  // SWI confirmó que precio viene en pesos; nuestro catálogo guarda centavos.
  const created = await tx.study.create({
    data: { id: e.clave ?? `swi-${slug(nombre)}`, nombre, precio: Math.round((e.precio ?? 0) * 100), preparacion: e.preparacion ?? "" },
  });
  return created.id;
}

async function ensureClinic(tx: Tx, c: { nombre: string; ciudad: string | null; direccion: string | null }) {
  const found = await tx.clinic.findFirst({ where: { nombre: { equals: c.nombre, mode: "insensitive" } }, select: { id: true } });
  if (found) return found.id;
  return (await tx.clinic.create({ data: { id: `swi-${slug(c.nombre)}`, nombre: c.nombre, ciudad: c.ciudad ?? "", direccion: c.direccion ?? "" } })).id;
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const OUR_CHANNELS: readonly string[] = ["WEB", "APP", "WHATSAPP", "CALL_CENTER"];
/** CLINICA (u otro canal suyo) no es uno de nuestros canales: queda como SYSTEM y el canal real va en el payload. */
const toChannel = (c: string | null): Channel => (c && OUR_CHANNELS.includes(c) ? (c as Channel) : "SYSTEM");

function rawId(raw: unknown): string | null {
  const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : null;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function describe(raw: unknown, error: z.ZodError) {
  const tipo = raw && typeof raw === "object" ? (raw as { tipo?: unknown }).tipo : undefined;
  if (!["PACIENTE", "TRAMITE", "PAGO", "EVENTO"].includes(String(tipo))) return `tipo desconocido: ${JSON.stringify(tipo ?? null)}`;
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "registro"}: ${i.message}`)
    .join("; ");
}
